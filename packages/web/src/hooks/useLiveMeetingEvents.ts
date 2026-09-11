/**
 * The live meeting's realtime transport — ONE SSE stream, and the topic →
 * query-key mapping that stream needs to mean anything.
 *
 * Phase E, wave 5, Task 4. This replaces `hooks/useRealtimeSubscription.ts`
 * wholesale (deleted in the same commit): that hook had exactly eight call
 * sites, all in `routes/meetings.$meetingId.live.tsx`, and no other consumer
 * anywhere in the repo. Every one of those eight callbacks was a
 * `queryClient.invalidateQueries(...)` body and nothing else, and the `status`
 * the hook returned was never destructured at a single call site — so the
 * replacement returns `void` rather than carrying a value forward that nothing
 * has ever read. Whoever rebuilds `ConnectionStatusBar` (wave 5, Task 6) will
 * want a connection state; the honest place to take it from is
 * `useSubscription`'s own result, which this hook deliberately does not
 * pre-empt by inventing a second vocabulary for it.
 *
 * ─── One stream, not eight, and the cost that buys ────────────────────────
 *
 * `packages/api/src/trpc/routers/realtime.ts`'s header states why the server
 * multiplexes: SSE is plain HTTP, a browser allows six concurrent HTTP/1.1
 * connections per origin, and eight streams would consume all six and then
 * block every ordinary query the screen makes. Production is HTTP/2 where the
 * cap does not apply and the Vite dev proxy is HTTP/1.1 where it does, so the
 * eight-stream shape would have been broken in development and fine in
 * production.
 *
 * The cost lands here: **the server publishes a TOPIC and does not know what
 * the client does with it.** `LIVE_MEETING_TOPICS` (in `realtime/events.ts`)
 * and `TOPIC_INVALIDATIONS` below have to be extended in lockstep, and a topic
 * with no entry here would be received, matched by nothing, and dropped — a
 * panel that silently stops updating on other devices, with no error anywhere.
 *
 * That coupling is made loud twice over, deliberately, because one of the two
 * mechanisms alone would not be enough:
 *
 *   1. `TOPIC_INVALIDATIONS` is typed `Record<LiveMeetingTopic, …>`, and
 *      `LiveMeetingTopic` is derived from the ROUTER'S OWN OUTPUT TYPE, not
 *      restated here. A topic added server-side is a missing property and
 *      `npx turbo run typecheck --force` fails naming it.
 *   2. `__tests__/useLiveMeetingEvents.test.ts` reads
 *      `packages/api/src/realtime/events.ts` as TEXT, parses the
 *      `LIVE_MEETING_TOPICS` array out of it, and asserts this object's keys
 *      match. That check is independent of the type (it would catch the union
 *      and the array disagreeing, which the type cannot see) and it is a
 *      named, failing TEST rather than a compiler error, which is what the
 *      brief asks for.
 *
 * Neither one is redundant: (1) cannot run without a build, and (2) cannot see
 * a mapping whose VALUE is wrong. Both of them together still cannot tell you
 * a mapping invalidates the wrong router — that is what the per-site deletion
 * sweep (conventions item 8) is for, and it was run.
 *
 * ─── What each topic invalidates, and why it is a router filter ───────────
 *
 * `trpc.<router>.pathFilter()`, per conventions item 7's default: "a writer
 * should not have to know which procedures some screen happens to call." A
 * realtime event is the same shape of writer — it is another device's write,
 * arriving here — and the screen's reads move between procedures far more
 * often than the tables move between routers.
 *
 * The legacy `queryKeys.*` keys the eight deleted callbacks invalidated are
 * NOT reproduced here. They were invalidated because the LIVE SCREEN read
 * them; it no longer does (this task moved all nine of its reads onto tRPC),
 * and the other files still on those keys — `meetings.$meetingId.review.tsx`,
 * `components/minutes/SourceDataPanel.tsx` — are not subscribed to anything
 * and never were. Invalidating a key no subscribed screen reads is the
 * "invalidate everything" shape conventions item 7 bans, one size down.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { trpc } from "@/lib/trpc";

/**
 * One event as the CLIENT sees it, taken from the procedure rather than
 * restated.
 *
 * Worth a sentence, because the obvious spelling is wrong and the compiler
 * says so in a way that is easy to misread. `RouterOutputs` (i.e.
 * `inferRouterOutputs`) hands back the SERVER'S output —
 * `AsyncGenerator<TrackedEnvelope<{topic}>>`, where `TrackedEnvelope` is the
 * three-member TUPLE `[id, data, symbol]`. The client never sees that tuple:
 * `httpSubscriptionLink` splits it, feeding the id to the resume handshake and
 * handing `onData` the `{ id, data }` object. The DECORATED procedure's own
 * `~types.output` is the type after that transformation, which is the one this
 * file needs.
 *
 * `~types` rather than the package's `inferOutput` helper, and that is not a
 * style choice: `inferOutput` is constrained to
 * `DecorateQueryProcedure | DecorateInfiniteQueryProcedure | DecorateMutationProcedure`,
 * and a SUBSCRIPTION decoration satisfies none of the three —
 * `TS2344: ... is missing the following properties from type
 * 'DecorateMutationProcedure<any>': mutationOptions, mutationKey`. The helper
 * and the property read the same field; only the helper has a constraint that
 * excludes this procedure.
 */
type LiveMeetingEvent =
  (typeof trpc.realtime.onMeetingChange)["~types"]["output"] extends AsyncIterable<infer TEvent>
    ? TEvent
    : never;

/** The topics `realtime.onMeetingChange` can yield. Never restated by hand. */
export type LiveMeetingTopic = LiveMeetingEvent extends {
  data: { topic: infer TTopic extends string };
}
  ? TTopic
  : never;

/**
 * Topic → the routers whose cached reads that topic invalidates.
 *
 * Router NAMES rather than pre-built filters, so the mapping is data a test
 * can compare against `trpc.<name>.pathFilter()` itself rather than a bag of
 * opaque closures.
 *
 * **`agenda_item` maps to TWO routers, and that is a preserved behaviour, not
 * a widening.** The Supabase subscription this replaces invalidated
 * `queryKeys.agendaItems.byMeeting(meetingId)`, and that one key backed a
 * `select("*, exhibit(*)")` — so an `agenda_item` change refetched the
 * meeting's EXHIBITS too, as a side effect of them being embedded. Those are
 * two procedures now (`agendaItem.byMeeting` and `exhibit.byMeeting`), so
 * keeping the old behaviour means naming both. There is no `exhibit` topic and
 * there was no `exhibit` Supabase channel either — an exhibit added on another
 * device has never propagated to a live meeting on its own, and giving it a
 * topic is a feature, not a migration.
 *
 * The remaining seven are one-to-one with the table the topic is named for.
 * `meeting` is the one whose reach GREW: its old callback invalidated
 * `queryKeys.meetings.detail(meetingId)` alone, while `trpc.meeting.pathFilter()`
 * also reaches `byTown`/`byBoard` — the kanban and the board Meetings tab,
 * which render a status this stream announces changes to. Stated because
 * conventions item 1 asks for added clauses to be stated: this is a strictly
 * larger invalidation than the query it replaces, and the old narrowness was
 * a gap rather than a decision (wave 3, Task 2's fix round found and fixed the
 * same gap in this file's own adjournment handler).
 */
const TOPIC_INVALIDATIONS = {
  agenda_item: ["agendaItem", "exhibit"],
  agenda_item_transition: ["agendaItemTransition"],
  executive_session: ["executiveSession"],
  guest_speaker: ["guestSpeaker"],
  meeting: ["meeting"],
  meeting_attendance: ["meetingAttendance"],
  motion: ["motion"],
  vote_record: ["voteRecord"],
} as const satisfies Record<LiveMeetingTopic, readonly LiveMeetingRouterName[]>;

/** The routers a live-meeting topic is allowed to name. */
type LiveMeetingRouterName =
  | "agendaItem"
  | "agendaItemTransition"
  | "exhibit"
  | "executiveSession"
  | "guestSpeaker"
  | "meeting"
  | "meetingAttendance"
  | "motion"
  | "voteRecord";

/**
 * Exported for the mapping test, which is the whole point of it being a
 * separate value — a test that reached into the hook's closure would be
 * testing its own construction.
 */
export const LIVE_MEETING_TOPIC_ROUTERS: Readonly<
  Record<LiveMeetingTopic, readonly LiveMeetingRouterName[]>
> = TOPIC_INVALIDATIONS;

/** The `pathFilter()` for one router name, resolved through the real proxy. */
export function liveMeetingPathFilter(name: LiveMeetingRouterName) {
  return trpc[name].pathFilter();
}

/**
 * Subscribe to one meeting's change stream and invalidate what it names.
 *
 * Called unconditionally by `routes/meetings.$meetingId.live.tsx`, exactly as
 * the eight `useRealtimeSubscription` calls it replaces were — they sat above
 * that component's status routing too, so a `noticed` meeting waiting in
 * `MeetingStartFlow` has been subscribed the whole time and still is.
 *
 * Returns nothing. See this file's header.
 */
export function useLiveMeetingEvents(meetingId: string): void {
  const queryClient = useQueryClient();

  const onData = useCallback(
    (event: LiveMeetingEvent) => {
      for (const name of LIVE_MEETING_TOPIC_ROUTERS[event.data.topic]) {
        void queryClient.invalidateQueries(liveMeetingPathFilter(name));
      }
    },
    [queryClient],
  );

  useSubscription(trpc.realtime.onMeetingChange.subscriptionOptions({ meetingId }, { onData }));
}
