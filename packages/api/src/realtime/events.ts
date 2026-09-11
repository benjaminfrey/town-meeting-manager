/**
 * Phase E, wave 5, Task 1 — what a realtime event IS, and how one is published.
 *
 * ─── An event is an invalidation signal, and carries no row data ──────────
 *
 * `docs/superpowers/specs/2026-08-29-phase-e-web-restoration-design.md` leaves
 * "payloads or pure invalidation signals" open for this wave and says to
 * default to invalidation-only "unless live-meeting latency demands
 * otherwise". It does not, and that is a fact about the existing screen rather
 * than a preference: read the eight `useRealtimeSubscription(...)` call sites
 * in `routes/meetings.$meetingId.live.tsx` (the hook's only consumer in the
 * repo — `grep -rn "useRealtimeSubscription(" packages/web/src`) and every one
 * of their callbacks is a `queryClient.invalidateQueries(...)` body and
 * nothing else. Not one reads the payload argument it is handed. So the
 * payload Supabase Realtime was already delivering was dead weight, and the
 * latency argument the spec would need is not available: there is no consumer
 * for whom a payload would save a round trip, because none of them render
 * from it.
 *
 * A payload would have to be authorized separately from the query that reads
 * the same rows, in a place (this file, and a `LISTEN` connection that cannot
 * carry tenant context — see `bus.ts`) where RLS cannot help. So an event
 * names a TOPIC and nothing else. Authorization stays in the procedure that
 * refetches, where RLS is running.
 *
 * The three fields below are the minimum the fan-out needs and are all
 * non-secret identifiers:
 *
 *   townId    — the ONLY reason it is here: `bus.ts` filters on it. Never
 *               reaches a subscriber (see `bus.ts`'s `subscribe`, which yields
 *               a bare topic).
 *   meetingId — which live meeting this concerns. Same: filter only.
 *   topic     — which of the eight live-meeting reads is now stale.
 *
 * ─── Why the payload's non-secrecy has to be stated, not assumed ──────────
 *
 * A Postgres `NOTIFY` channel is GLOBAL to the database. Every session that
 * can connect can `LISTEN tmm_realtime` and read every town's payloads — there
 * is no per-channel privilege to grant and no policy that applies. That is not
 * a new exposure (anything holding database credentials already reads more
 * than this), but it is the reason the payload is restricted to two UUIDs and
 * an enum member: a payload carrying, say, a motion's text would be readable
 * by every tenant's connection, and nothing in the schema would say so.
 *
 * ─── Publication is transactional, and that is load-bearing ───────────────
 *
 * `pg_notify` inside a transaction is queued and delivered at COMMIT, and
 * discarded on ROLLBACK. Measured directly during this task against a real
 * Postgres: a `pg_notify` in a transaction that then threw was never delivered
 * to a listening connection, while one in a committed transaction was.
 * `__tests__/events.test.ts` pins it.
 *
 * That is what makes `publishRealtimeEvent(tx, ...)` correct to call from
 * inside the same `ctx.withTenant` transaction as the write it announces: the
 * client is told to refetch only once the row it would read is actually
 * visible. The obvious alternative — publishing after the transaction returns
 * — has a window in which the client refetches and gets the OLD row, then
 * never hears about it again, which presents as "the other clerk's motion
 * didn't show up" and is invisible in a log.
 *
 * ─── Why the writers are not wired here ───────────────────────────────────
 *
 * Task 1 owns the transport; Task 3 owns the live-meeting routers that write
 * these nine tables, and Task 5 owns the screen. `publishRealtimeEvent` is the
 * seam between them. The cost of an application-level publisher rather than a
 * database trigger, stated rather than discovered: **a write that forgets to
 * publish leaves every other device stale, with no error anywhere.** A trigger
 * on the nine tables could not be forgotten and would also cover writes this
 * process does not make.
 *
 * It was still declined, for two reasons that are about correctness rather
 * than effort. First, a trigger knows the TABLE, and the topic is not always
 * the table: `future_item_queue` and `agenda_item` are written together by
 * `handleMeetingEnd` and both invalidate the agenda read, while
 * `notification_event` is written on this path and no live screen watches it.
 * Deriving a topic from a table name means encoding that mapping in SQL, where
 * the client's query keys are not visible. Second, a trigger fires for the
 * 60-second notification sweep and every background `TenantJob`, waking every
 * connected client for rows no live screen reads.
 *
 * The mitigation is therefore a test, and it exists:
 * `trpc/__tests__/router-wiring.test.ts`'s "the live-meeting publish
 * inventory" reads every router as text, finds each `.mutation(` that writes
 * one of the eight tables below — directly or through a helper it calls — and
 * requires it to either call `publishRealtimeEvent` or sit on that file's
 * `AWAITING_PUBLISH` ledger, marked `TODO(phase-e-wave-5-publish)`. Task 3
 * discharges the ledger; a live-meeting mutation Task 3 adds without a publish
 * fails that test by name rather than shipping silently. The check's limits
 * are stated there rather than here — it is a floor under an otherwise
 * invisible failure, not a proof.
 *
 * (This paragraph previously described that check in the present tense while
 * the only occurrence of `phase-e-wave-5-publish` in the repository was the
 * sentence itself. It was written before the check and is now written after
 * it.)
 *
 * If Task 3 finds the per-mutation call unwieldy across its thirty-five write
 * sites, the trigger is the documented escalation and this paragraph is the
 * reason it would be chosen.
 */

import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/with-tenant.js";

/**
 * The `LISTEN`/`NOTIFY` channel name.
 *
 * One channel for the whole application rather than one per town: a channel
 * name cannot be parameterised in `LISTEN` (it is an identifier, not a value),
 * so per-town channels would mean issuing a `LISTEN` per connected town on a
 * shared connection and un-listening when the last subscriber leaves — state
 * to get wrong, in exchange for filtering Postgres would do no more securely
 * than `bus.ts` does. The filter is application code either way; see `bus.ts`.
 */
export const REALTIME_CHANNEL = "tmm_realtime";

/**
 * The reads a live meeting keeps fresh, named by the table whose rows back
 * them.
 *
 * Exactly the `useRealtimeSubscription` call sites in
 * `routes/meetings.$meetingId.live.tsx` — that hook has no other consumer in
 * the repo, so this list is the complete realtime surface as it stands. Quote
 * the grep, not the count (conventions item 11); it answered 8 at 769e9d0:
 *
 *     $ grep -rc "useRealtimeSubscription(" "packages/web/src/routes/meetings.\$meetingId.live.tsx"
 *
 * Deliberately NOT "every table this wave writes". `future_item_queue`,
 * `minutes_document` and `notification_event` are written by the live screen
 * and watched by nothing, so giving them topics would add wake-ups no client
 * acts on. Adding one later is a one-line change plus a client mapping.
 */
export const LIVE_MEETING_TOPICS = [
  "agenda_item",
  "agenda_item_transition",
  "executive_session",
  "guest_speaker",
  "meeting",
  "meeting_attendance",
  "motion",
  "vote_record",
] as const;

export type LiveMeetingTopic = (typeof LIVE_MEETING_TOPICS)[number];

const TOPICS: ReadonlySet<string> = new Set(LIVE_MEETING_TOPICS);

export interface RealtimeEvent {
  /** Filter only — never yielded to a subscriber. See this file's header. */
  readonly townId: string;
  readonly meetingId: string;
  readonly topic: LiveMeetingTopic;
}

/**
 * Announce that `topic` changed for `meetingId`, from inside the transaction
 * that changed it.
 *
 * `tx` is the `TenantTx` the caller already has — the same handle the write
 * uses — so the notification commits or rolls back with the write. Call it
 * LAST in the transaction, after the write, for no correctness reason (the
 * commit orders both) but so a reader sees the announcement next to what it
 * announces.
 *
 * `pg_notify(channel, payload)` rather than `NOTIFY channel, 'payload'`:
 * `NOTIFY`'s channel and payload are syntax, not parameters, so the payload
 * would have to be string-concatenated into SQL. `pg_notify` is an ordinary
 * function call and both arguments bind.
 */
export function publishRealtimeEvent(tx: TenantTx, event: RealtimeEvent): Promise<unknown> {
  const payload = JSON.stringify({
    townId: event.townId,
    meetingId: event.meetingId,
    topic: event.topic,
  });
  return tx.execute(sql`SELECT pg_notify(${REALTIME_CHANNEL}, ${payload})`);
}

/**
 * Turn a notification payload back into an event, or `undefined`.
 *
 * Returns `undefined` rather than throwing for anything unrecognised. A
 * `LISTEN` connection receives whatever any session on the database chose to
 * send on this channel — including, one day, a payload from a newer deploy
 * carrying a topic this process has never heard of. Throwing from the
 * notification handler would take down the one connection every live meeting
 * in the process depends on, to reject a message it could simply ignore.
 *
 * The topic check is not cosmetic: it is what stops an unrecognised string
 * reaching a subscriber, where it would be forwarded verbatim to a browser as
 * a cache key.
 */
export function parseRealtimeEvent(payload: string): RealtimeEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;

  const { townId, meetingId, topic } = parsed as Record<string, unknown>;
  if (typeof townId !== "string" || townId.length === 0) return undefined;
  if (typeof meetingId !== "string" || meetingId.length === 0) return undefined;
  if (typeof topic !== "string" || !TOPICS.has(topic)) return undefined;

  return { townId, meetingId, topic: topic as LiveMeetingTopic };
}
