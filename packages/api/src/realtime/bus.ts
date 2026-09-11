/**
 * Phase E, wave 5, Task 1 — the `LISTEN` bridge, and the one place tenancy is
 * enforced for a realtime event.
 *
 * ─── Why the filter is application code, and cannot be anything else ──────
 *
 * Every other read in this API is scoped by row level security, and
 * `phase-e-conventions.md` forbids a redundant `WHERE town_id` alongside it. A
 * realtime event is the one thing in this system RLS cannot reach, by
 * construction rather than by omission:
 *
 *   - `LISTEN` is SESSION-scoped. It is issued once, outside any transaction,
 *     and stays in effect for the life of the connection.
 *   - `app.town_id` is TRANSACTION-scoped — `set_config(..., true)`, which is
 *     the entire safety property of `db/with-tenant.ts` (see its header for
 *     why the session-scoped form is a cross-tenant disclosure).
 *   - A notification is delivered to the client between transactions, so there
 *     is no transaction for `get_current_town_id()` to read and no policy that
 *     applies to the delivery.
 *
 * So a `LISTEN` connection receives EVERY town's events and there is no
 * database-side setting that would change that. `eventMatchesSubscriber` below
 * is therefore the whole of the tenancy guarantee for this transport, and it
 * is pinned by `__tests__/bus.test.ts` and, end-to-end through the real
 * procedure, by `trpc/routers/__tests__/realtime.test.ts` — a subscriber in
 * town B publishing-and-listening against an event for town A. Delete the
 * `townId` comparison and both go red; that is the check, not this paragraph.
 *
 * The town a subscriber is compared against comes from `ctx.tenant.townId`,
 * which the Fastify gate derived from the session (`auth/tenant-context.ts`),
 * never from subscription input. There is no procedure input that can name a
 * town.
 *
 * ─── What role this connection runs as ────────────────────────────────────
 *
 * The same one every other query runs as — `tmm_app`, the non-owner runtime
 * role from `DATABASE_URL`. `LISTEN` and `pg_notify` require no privilege in
 * Postgres, so this connection needs nothing the application pool does not
 * already have, and it is NOT an RLS bypass sitting in the process. It also
 * never runs a query: the only statement it issues is the `LISTEN` that
 * `postgres.js` sends on its behalf. `__tests__/bus.test.ts` drives it through
 * `connectAsAppRole`, so "the app role can do this" is measured rather than
 * assumed.
 *
 * ─── Why `postgres.js` and not `pg` ───────────────────────────────────────
 *
 * `test/db-harness.ts` says "`pg` is expected to back the dedicated `LISTEN`
 * connection later", and `pg` 8.23.0 is a declared dependency imported
 * nowhere. That expectation is not followed here, deliberately, and the reason
 * was measured rather than argued:
 *
 * The failure that matters for this connection is that it dies and nothing
 * says so — every live meeting in the process then stops updating, with no
 * error, no log line and a perfectly healthy-looking API. `postgres.js`'s
 * `sql.listen(channel, onNotify, onListen)` reconnects on its own and calls
 * `onListen` again on each (re)subscribe. Measured against a real Postgres by
 * terminating the listening backend from another session with
 * `pg_terminate_backend`: the handle reconnected unprompted, `onListen` fired
 * a second time, and a notification published afterwards was delivered. With
 * `pg` that reconnect loop and its backoff would be hand-written here and
 * hand-tested, for no gain — and `onListen` is exactly the hook the resync
 * below needs, which `pg` has no equivalent of.
 *
 * `pg` therefore remains imported nowhere. That is worth saying out loud
 * rather than leaving a dependency that looks provisioned for a purpose it was
 * not used for.
 *
 * ─── Events are coalesced, and that is a property of what they are ────────
 *
 * A subscriber holds a SET of stale topics, not a queue. Ten motions inserted
 * in one second while a subscriber is between reads collapse into one
 * `motion` wake-up, because the event carries no data (see `events.ts`) and
 * "refetch motions" twice is the same instruction as once. The pending set is
 * therefore bounded at `LIVE_MEETING_TOPICS.length` per subscriber no matter
 * what a burst does — there is no unbounded buffer, and no backpressure policy
 * to get wrong, because there is nothing to drop that has not been subsumed.
 *
 * ─── The reconnect resync ─────────────────────────────────────────────────
 *
 * While the `LISTEN` connection is down, notifications are LOST — Postgres does
 * not queue them for an absent listener. So when `onListen` fires for a second
 * or later time, every live subscriber is marked stale on every topic. A burst
 * of refetches on an event the clients cannot otherwise learn about is the
 * correct trade; silently serving a stale live meeting is not.
 *
 * The same reasoning is why there is no replay buffer keyed by event id. One
 * would have to live in this process, and a client that reconnects to a
 * DIFFERENT api process (the production stack can run more than one; `NOTIFY`
 * is broadcast to every listening backend, so every process sees every event)
 * would resume against a sequence that process never issued. Resync is the
 * scale-safe answer; a buffer is a correctness bug waiting for a second
 * replica.
 */

import type postgres from "postgres";
import {
  LIVE_MEETING_TOPICS,
  REALTIME_CHANNEL,
  parseRealtimeEvent,
  type LiveMeetingTopic,
  type RealtimeEvent,
} from "./events.js";

/** Who is listening, and to what. Both fields are server-derived. */
export interface RealtimeSubscriber {
  /** From `ctx.tenant.townId` — the session's town, never subscription input. */
  readonly townId: string;
  readonly meetingId: string;
}

/**
 * The tenancy guarantee for this transport, as one function so a test can
 * delete one comparison and watch a named test go red.
 *
 * Both halves matter and they fail differently. Without the `townId`
 * comparison a subscriber learns when another town's meeting changes — the
 * cross-tenant leak the phase spec requires a test for. Without the
 * `meetingId` comparison a subscriber is merely woken for its own town's other
 * meetings: noisy, not a disclosure. They are checked together because the
 * expensive one to get wrong is first.
 */
export function eventMatchesSubscriber(
  event: RealtimeEvent,
  subscriber: RealtimeSubscriber,
): boolean {
  return event.townId === subscriber.townId && event.meetingId === subscriber.meetingId;
}

export interface RealtimeBus {
  /**
   * Yield the topics that have gone stale for `subscriber`, until `signal`
   * aborts.
   *
   * Yields a bare topic: the event's `townId` and `meetingId` are filter
   * inputs and stop here. See `events.ts` for why nothing else travels.
   */
  subscribe(
    subscriber: RealtimeSubscriber,
    signal: AbortSignal,
  ): AsyncGenerator<LiveMeetingTopic, void, void>;
  /** How many streams are currently attached. For tests and for logging. */
  readonly subscriberCount: number;
  close(): Promise<void>;
}

interface Registration {
  readonly subscriber: RealtimeSubscriber;
  readonly pending: Set<LiveMeetingTopic>;
  wake: (() => void) | undefined;
}

export interface CreateRealtimeBusOptions {
  /**
   * A `postgres.js` handle dedicated to listening.
   *
   * Injected rather than built from `DATABASE_URL` here so the tests can hand
   * it a `connectAsAppRole` client pointed at a scratch database — the same
   * non-owner role production uses, against a real schema. A bus built from an
   * environment variable could only be tested against a paraphrase of itself.
   *
   * The bus does not own this handle's lifetime beyond `close()`, which calls
   * `end()` on it: give it a handle nothing else uses.
   */
  readonly sql: postgres.Sql;
  /** Optional sink for the two things worth knowing about. */
  readonly log?: {
    info(payload: Record<string, unknown>, message: string): void;
    warn(payload: Record<string, unknown>, message: string): void;
  };
}

export async function createRealtimeBus(opts: CreateRealtimeBusOptions): Promise<RealtimeBus> {
  const registrations = new Set<Registration>();
  let listenCount = 0;

  const deliver = (event: RealtimeEvent): void => {
    for (const registration of registrations) {
      if (!eventMatchesSubscriber(event, registration.subscriber)) continue;
      registration.pending.add(event.topic);
      registration.wake?.();
    }
  };

  /** Mark every live subscriber stale on every topic. See the header. */
  const resyncEveryone = (): void => {
    for (const registration of registrations) {
      for (const topic of LIVE_MEETING_TOPICS) registration.pending.add(topic);
      registration.wake?.();
    }
  };

  await opts.sql.listen(
    REALTIME_CHANNEL,
    (payload) => {
      const event = parseRealtimeEvent(payload);
      if (!event) {
        // Not an error worth taking the connection down for — see
        // `parseRealtimeEvent`'s own comment. Logged because a steady stream
        // of these means a deploy is publishing a shape this process cannot
        // read, and no other signal would say so.
        opts.log?.warn({ payload }, "realtime: ignoring an unrecognised notification payload");
        return;
      }
      deliver(event);
    },
    () => {
      listenCount += 1;
      if (listenCount === 1) {
        opts.log?.info({ channel: REALTIME_CHANNEL }, "realtime: listening");
        return;
      }
      // A RE-listen: the connection dropped and came back, and whatever was
      // published while it was gone is lost for good.
      opts.log?.warn(
        { channel: REALTIME_CHANNEL, listenCount, subscribers: registrations.size },
        "realtime: LISTEN reconnected; resyncing every subscriber",
      );
      resyncEveryone();
    },
  );

  async function* subscribe(
    subscriber: RealtimeSubscriber,
    signal: AbortSignal,
  ): AsyncGenerator<LiveMeetingTopic, void, void> {
    const registration: Registration = {
      subscriber,
      pending: new Set<LiveMeetingTopic>(),
      wake: undefined,
    };
    registrations.add(registration);
    try {
      while (!signal.aborted) {
        if (registration.pending.size === 0) {
          await waitForWake(registration, signal);
          // Re-checked rather than assumed: `waitForWake` resolves for EITHER
          // reason, and an aborted stream must not yield whatever the abort
          // raced with.
          if (signal.aborted) return;
        }
        // Drained into a local array before yielding: a `yield` suspends this
        // generator, and `deliver` can add to `pending` while it is suspended.
        // Iterating the live set would either miss that event or throw on a
        // concurrent modification depending on where it landed.
        const stale = [...registration.pending];
        registration.pending.clear();
        for (const topic of stale) {
          if (signal.aborted) return;
          yield topic;
        }
      }
    } finally {
      // Reached on abort, on the consumer breaking out of its `for await`
      // (which calls `.return()` on this generator), and on a throw. Without
      // it, a process serving a long-lived SSE endpoint accumulates one dead
      // registration per disconnect for its whole uptime — a leak that grows
      // with traffic and never surfaces as an error.
      registrations.delete(registration);
    }
  }

  return {
    subscribe,
    get subscriberCount() {
      return registrations.size;
    },
    async close() {
      // Wakes every suspended `subscribe` so its `finally` runs, rather than
      // leaving generators parked on a promise nothing will ever resolve.
      for (const registration of registrations) registration.wake?.();
      await opts.sql.end();
    },
  };
}

/**
 * Park until this registration has something to yield, or the stream aborts.
 *
 * The abort listener is removed on either outcome. Left attached, a stream
 * that woke a thousand times would hold a thousand listeners on one signal —
 * and Node warns at eleven, which would make a working system look broken.
 */
function waitForWake(registration: Registration, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      registration.wake = undefined;
      signal.removeEventListener("abort", finish);
      resolve();
    };
    registration.wake = finish;
    signal.addEventListener("abort", finish, { once: true });
  });
}
