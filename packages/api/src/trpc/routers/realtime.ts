/**
 * Phase E, wave 5, Task 1 — the first subscription in this codebase.
 *
 * One procedure, `realtime.onMeetingChange`, replacing the eight Supabase
 * Realtime channels `routes/meetings.$meetingId.live.tsx` opens today.
 *
 * ─── Why one stream and not eight ─────────────────────────────────────────
 *
 * The obvious migration is one subscription per table, mirroring the eight
 * `useRealtimeSubscription` call sites one-for-one. It would not work in a
 * browser. SSE is plain HTTP, and HTTP/1.1 caps a browser at six concurrent
 * connections per origin — eight open streams would consume all six and then
 * block every ordinary query the screen makes, which presents as the live
 * meeting hanging rather than as a transport limit. Production serves the app
 * over HTTP/2 (`infrastructure/nginx/nginx.conf`), where the cap does not
 * apply, but the Vite dev server proxies `/api` over HTTP/1.1 — so the eight-
 * stream shape would be broken in development and fine in production, which is
 * the worst way for a limit to present.
 *
 * One stream per meeting, carrying a topic, costs one connection and needs no
 * cap to reason about.
 *
 * ─── The authorization discipline for a subscription ──────────────────────
 *
 * `phase-e-conventions.md` item 2 states the mutation rule: guards are
 * declared BEFORE `.input()`, because tRPC runs middleware and parses input in
 * chain order and anything after `.input()` can be preempted by a validation
 * error. That rule applies to a subscription unchanged, and it was verified
 * here rather than assumed to carry over — measured against a real Fastify
 * server and a real `httpSubscriptionLink` client during this task:
 *
 *   - Middleware runs at SUBSCRIBE time, before the generator body runs at
 *     all. A middleware that throws means the generator never starts (its
 *     first line never logged).
 *   - `opts.getRawInput()` resolves for a subscription, even though the
 *     request is a GET with input in the query string — so
 *     `requireBoardPermission` / `requireBoardActor` / `boardIdFrom()` work on
 *     a subscription exactly as they do on a mutation.
 *   - On a reconnect, the client merges `lastEventId` into that same raw
 *     input, and the whole middleware chain runs again against it.
 *
 * There is ONE addition, and it is the rule this file exists to establish for
 * the subscriptions waves 5 and 6 add: **nothing may be yielded until every
 * refusal has had its chance.** A guard that runs after the first `yield` is
 * not a guard — the client has already acted on an event it was not entitled
 * to, and no later refusal takes that back. In this procedure that means the
 * meeting's tenant-scoped existence check completes before the loop starts.
 *
 * A refusal is reported properly in both positions, which was also measured:
 * a `TRPCError` thrown from middleware at subscribe time, and one thrown from
 * inside the generator after events have flowed, BOTH reach the client's
 * `onError`, and the client stops rather than retrying. (A plain `Error`
 * behaves differently — the client treats it as a dropped connection and
 * silently resumes. Refuse with a `TRPCError`.)
 *
 * ─── Why this procedure has no permission code ────────────────────────────
 *
 * Its only rule is tenancy. `meeting` carries tenancy-only RLS
 * (`FOR ALL USING (town_id = get_current_town_id())`, verified in
 * `drizzle/0000_baseline.sql`), so every account in a town may read every
 * meeting in it, and the reads this stream invalidates are the same reads the
 * screen already makes under their own authorization. Inventing a code here
 * would refuse people the product lets read the underlying rows, and would
 * make the stream stricter than the data.
 *
 * That is `phase-e-conventions.md` item 2's "a query whose only rule is
 * tenancy is answered by RLS", and it has a consequence worth naming: this
 * procedure never calls `ctx.actor()`, so `bindTenantAccess`'s memo is never
 * warmed and there is no stale actor to reason about for the life of the
 * stream. See `context.ts`'s "How long a context lives" for the general
 * answer, which covers a future subscription that does need a code.
 *
 * ─── Exactly one transaction, for the whole stream ────────────────────────
 *
 * `ctx.withTenant` is called once, at subscribe time, and never again. The
 * events carry no payload (`realtime/events.ts`), so there is nothing per
 * event to read; and one transaction per event on a stream that bursts during
 * a roll-call vote would take a pooled connection per event for no purpose.
 * It is also what makes `bindTenantAccess`'s `inTransaction` guard
 * unreachable here — the hazard is two OVERLAPPING calls, and there is only
 * one call. `__tests__/realtime.test.ts` counts it.
 */

import { z } from "zod";
import { sql } from "drizzle-orm";
import { TRPCError, tracked } from "@trpc/server";
// Load-bearing, and it looks exactly like a stray import someone should
// delete. It is what lets `tsc` EMIT this package's declarations at all.
//
// `tracked()` returns `TrackedEnvelope<TData>`, whose third tuple member is a
// `unique symbol` declared inside `@trpc/server`'s bundled internal module and
// not re-exported from the package root. With `declaration: true`
// (`tsconfig.base.json`), `tsc` has to WRITE that type into
// `dist/trpc/routers/realtime.d.ts`, cannot name the module it lives in, and
// refuses:
//
//     src/trpc/routers/realtime.ts: error TS2742: The inferred type of
//     'realtimeRouter' cannot be named without a reference to
//     '../../../node_modules/@trpc/server/dist/unstable-core-do-not-import.d-*.mjs'.
//
// It propagates: `appRouter` in `router.ts` fails the same way, and
// `dist/trpc/router.d.ts` is the ONE thing `packages/web` imports — so without
// this line the web package has no types for the API at all.
//
// Two fixes were tried and only one works. Annotating the resolver's return
// type as `AsyncGenerator<TrackedEnvelope<...>>` does NOT help — `tsc` still
// has to write the symbol, and `TrackedEnvelope` being exported from the
// package root is not enough. This side-effect-only type import gives `tsc` a
// package-relative name for the module that DECLARES the symbol, and the emit
// succeeds; with it present the return annotation is then unnecessary, so the
// resolver below carries none.
import type {} from "@trpc/server/unstable-core-do-not-import";
import { router, subscriptionProcedure } from "../trpc.js";
import { toRows } from "../../db/rows.js";
import { LIVE_MEETING_TOPICS, type LiveMeetingTopic } from "../../realtime/events.js";

/**
 * `lastEventId` is REQUIRED to be in the schema, and is not decoration.
 *
 * `httpSubscriptionLink` merges the last `tracked()` id it saw into the
 * subscription input on every reconnection attempt
 * (`docs/advisory-resolutions/5.1-realtime-transport.md`), so a schema without
 * the field strips it during parsing and the resume handshake binds to
 * nothing. What this procedure does with it is below.
 */
const onMeetingChangeInput = z.object({
  meetingId: z.uuid(),
  lastEventId: z.string().nullish(),
});

export const realtimeRouter = router({
  /**
   * Tell one client which of a live meeting's reads have gone stale.
   *
   * Yields `{ topic }` — a member of `LIVE_MEETING_TOPICS` — and nothing else.
   * The client maps a topic to the query keys it invalidates; the server does
   * not know or care which those are.
   */
  onMeetingChange: subscriptionProcedure.input(onMeetingChangeInput).subscription(async function* ({
    ctx,
    input,
    signal,
  }) {
    // ─── Everything that can refuse, before the first yield ────────────
    //
    // tRPC types a subscription resolver's `signal` as `AbortSignal |
    // undefined`, and it genuinely can be absent — `createCaller(ctx)`
    // supplies one only if the caller passes `{ signal }`. Over the real
    // adapter it is always present (measured: it is the signal tRPC aborts
    // on client disconnect and at `sse.maxDurationMs`).
    //
    // Refusing is the only honest answer to its absence rather than papering
    // over it with a controller that never fires. Without a signal the loop
    // below has no termination condition: the generator parks inside
    // `bus.subscribe` waiting for an event, `.return()` on a generator
    // suspended at an `await` cannot run its `finally` until that await
    // settles, and the bus registration is therefore leaked for the life of
    // the process. One per abandoned stream, growing with traffic, visible
    // as nothing at all.
    if (!signal) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "realtime.onMeetingChange was invoked without an AbortSignal, so the stream would " +
          "have no way to end and its bus registration would leak. Over HTTP tRPC always " +
          "supplies one; a direct caller must pass createCaller(ctx, { signal }).",
      });
    }
    //
    // A tenant-scoped existence check, which is also the authorization: RLS
    // scopes this SELECT to the caller's town, so a meeting in another town
    // returns zero rows and is indistinguishable from one that does not
    // exist. NOT_FOUND rather than FORBIDDEN, per conventions item 3 — a
    // refusal that distinguishes the two tells a caller whether a uuid they
    // guessed belongs to somebody.
    //
    // No redundant `WHERE town_id`: the policy is the filter. And exactly
    // one `ctx.withTenant` for the whole stream — see this file's header.
    const exists = await ctx.withTenant(async (tx) =>
      toRows<{ id: string }>(
        await tx.execute(sql`SELECT id FROM meeting WHERE id = ${input.meetingId}`),
        (message) => new Error(`realtime.onMeetingChange: ${message}`),
      ),
    );
    if (exists.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "That meeting does not exist.",
      });
    }

    // ─── Resume ────────────────────────────────────────────────────────
    //
    // Ids continue from where the previous connection left off rather than
    // restarting at 0, so the sequence a client sees is monotonic across
    // reconnects. `Number("")` is 0 and `Number("nope")` is NaN, so anything
    // unparseable falls back to 0 — a client-supplied id may be any string,
    // and this one only has to be unique within the stream.
    const resumedFrom = Number(input.lastEventId ?? "");
    const resuming = input.lastEventId != null;
    let sequence = Number.isFinite(resumedFrom) ? resumedFrom + 1 : 0;

    // A reconnect means there was a window with no connection, and Postgres
    // does not queue notifications for an absent listener — so anything
    // published during the gap is gone. Marking every topic stale is the
    // only correct answer: the alternative is a live meeting quietly missing
    // the motion that was passed while the stream was re-establishing.
    //
    // This is also what the server-forced reconnect in `trpc.ts`
    // (`SSE_MAX_STREAM_DURATION_MS`) rides on, and it is why that bound is
    // five minutes rather than thirty seconds.
    const initial: readonly LiveMeetingTopic[] = resuming ? LIVE_MEETING_TOPICS : [];
    for (const topic of initial) {
      yield tracked(String(sequence++), { topic });
    }

    // ─── The stream ────────────────────────────────────────────────────
    //
    // `signal` is tRPC's: it aborts when the client disconnects AND at
    // `sse.maxDurationMs`. `bus.subscribe`'s own `finally` deregisters on
    // either, and on this loop being returned into.
    //
    // `ctx.tenant.townId` — the town the session resolved to — is what the
    // bus filters on. No input on this procedure can name a town; see
    // `realtime/bus.ts` for why that filter is application code and cannot
    // be RLS.
    for await (const topic of ctx.realtime.subscribe(
      { townId: ctx.tenant.townId, meetingId: input.meetingId },
      signal,
    )) {
      yield tracked(String(sequence++), { topic });
    }
  }),
});
