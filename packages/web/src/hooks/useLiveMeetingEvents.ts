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
 * replacement returned `void` rather than carrying a value forward that
 * nothing had ever read, leaving the connection vocabulary to whoever rebuilt
 * `ConnectionStatusBar`.
 *
 * ~~Returns nothing.~~ **Wave 5, Task 6 is that rebuild, and it took the
 * offer.** The hook now returns a `LiveStreamStatus`, derived from
 * `useSubscription`'s own result — the "honest place to take it from" this
 * header named — and `live.tsx` renders it through `LiveStreamStatusBar`. See
 * "A healthy client reconnects every five minutes" below for the one piece of
 * logic that could not be a straight rename of the transport's own vocabulary.
 *
 * That argument covers the `status` and NOT the `error`, which the first
 * version of this hook discarded along with it — a refusal on the stream left
 * a live meeting permanently stale with nothing visible anywhere. See
 * `onError` at the bottom of this file.
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
 * them; it no longer does (this task moved all nine of its raw Supabase reads
 * onto tRPC, where they are eleven procedures),
 * and the other files still on those keys — `meetings.$meetingId.review.tsx`
 * (`components/minutes/SourceDataPanel.tsx` was one too, until Phase E wave 6,
 * Task 3) — are not subscribed to anything
 * and never were. Invalidating a key no subscribed screen reads is the
 * "invalidate everything" shape conventions item 7 bans, one size down.
 */

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { useSubscription } from "@trpc/tanstack-react-query";
import { toast } from "sonner";
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

/**
 * The topics `realtime.onMeetingChange` can yield. Never restated by hand.
 *
 * `Extract<…, string>` rather than `infer TTopic extends string`, because the
 * procedure's payload is `LiveMeetingTopic | null` — `null` is the resume
 * handshake (see `onData` below and the procedure's "The handshake event"),
 * and a constrained `infer` over that union does not narrow, it FAILS: the
 * whole conditional falls to `never`, every `TOPIC_INVALIDATIONS` key becomes
 * an error, and the cause is nowhere near the message. Extract keeps the eight
 * real topics and drops the sentinel, so the exhaustive mapping below still
 * has exactly the keys `LIVE_MEETING_TOPICS` has.
 */
export type LiveMeetingTopic = LiveMeetingEvent extends { data: { topic: infer TTopic } }
  ? Extract<TTopic, string>
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
 * The id the stream's failure toast is raised under.
 *
 * Stable, so a reconnect loop that refuses repeatedly replaces one toast
 * instead of stacking a column of identical ones over the operator's controls.
 */
export const LIVE_STREAM_ERROR_TOAST_ID = "live-meeting-stream-error";

/**
 * What the live meeting screen may say about its own stream.
 *
 * Three values, not `useSubscription`'s four, and the mapping is not a rename
 * — see `useLiveMeetingEvents` below.
 */
export type LiveStreamStatus =
  | "healthy" // Connected, or bouncing so briefly it is not worth saying.
  | "reconnecting" // Not connected for longer than a routine bounce takes.
  | "stopped"; // The client gave up. Nothing comes back without a reload.

/**
 * How long the stream may be disconnected before the screen says so.
 *
 * **This constant exists because a HEALTHY client reconnects every five
 * minutes, by design, and a naive indicator would cry wolf every time.**
 * `SSE_MAX_STREAM_DURATION_MS` (`packages/api/src/trpc/trpc.ts`) bounds how
 * stale a subscription's authorization may get by ending every stream at five
 * minutes; `__tests__/sse-bounds.test.ts` measured that the deadline ends the
 * response WITHOUT `event: return`, which is precisely what makes
 * `httpSubscriptionLink` treat it as a dropped connection and resume with
 * `Last-Event-ID` rather than stop. The client-side trace of that, measured
 * from `@trpc/client`'s own SSE state machine, is
 * `pending → connecting → pending` — a real transition through `connecting`,
 * twelve times an hour, on a stream that is working perfectly.
 *
 * An indicator wired straight to `status === "connecting"` would therefore
 * flash amber over a clerk's controls twelve times an hour during a public
 * meeting, which is worse than no indicator: the one time it means something
 * is the one time nobody looks. Five seconds is the discriminator. A
 * reconnect that is going to succeed is a fresh HTTP request to the same
 * origin and completes in well under a second; one that is still unresolved
 * after five is an outage, and stays one.
 *
 * Note what this does NOT do: it delays the SAYING, never the invalidation.
 * `onData` fires the moment the resumed stream delivers its catch-up topics
 * (`realtime.ts` re-yields every topic when a `lastEventId` is present), so
 * the screen's data is refreshed on the transport's schedule regardless of
 * what the banner is doing.
 *
 * **That was true only of a stream that had already delivered something, until
 * wave 5, Task 7.** A browser sends `Last-Event-ID` only once it has received
 * an `id:` frame, so a meeting in recess — which is most of a meeting —
 * reconnected carrying no id at all, took the fresh-subscribe path, and lost
 * whatever was published during the bounce. The server now emits a handshake
 * event at the top of every connection, so the condition this paragraph
 * describes is always satisfiable. See `onData`.
 */
export const LIVE_STREAM_RECONNECT_GRACE_MS = 5_000;

/**
 * Subscribe to one meeting's change stream and invalidate what it names.
 *
 * Called unconditionally by `routes/meetings.$meetingId.live.tsx`, exactly as
 * the eight `useRealtimeSubscription` calls it replaces were — they sat above
 * that component's status routing too, so a `noticed` meeting waiting in
 * `MeetingStartFlow` has been subscribed the whole time and still is.
 *
 * Returns the screen's connection state. `live.tsx` renders it through
 * `LiveStreamStatusBar`; the `MeetingStartFlow` branch does not, which is why
 * `onError` below still raises a toast — see that comment.
 */
export function useLiveMeetingEvents(meetingId: string): LiveStreamStatus {
  const queryClient = useQueryClient();

  const onData = useCallback(
    (event: LiveMeetingEvent) => {
      // `null` is the RESUME HANDSHAKE, not a topic. The server emits one
      // `tracked()` event at the top of every connection so that a browser
      // `EventSource` has a `Last-Event-ID` to send back even on a stream that
      // has never delivered anything — without it, a quiet meeting reconnects
      // as a fresh subscribe and loses every write made during the gap. See
      // `packages/api/src/trpc/routers/realtime.ts`, "The handshake event".
      // There is nothing stale to invalidate: the acknowledgement IS the work.
      const topic = event.data.topic;
      if (topic === null) return;
      for (const name of LIVE_MEETING_TOPIC_ROUTERS[topic]) {
        void queryClient.invalidateQueries(liveMeetingPathFilter(name));
      }
    },
    [queryClient],
  );

  /**
   * **A dead stream must not be silent, and without this it was.**
   *
   * Added in this task's fix round. The `void` return above is a good answer
   * for the subscription's `status` — nothing has ever read it, and inventing
   * a connection-state vocabulary ahead of Task 6's `ConnectionStatusBar`
   * would only have to be unpicked. It is NOT a good answer for its `error`,
   * and the two were conflated: discarding the result discarded both.
   *
   * What that cost. `realtime.onMeetingChange` refuses with a `TRPCError` —
   * `NOT_FOUND` for a meeting not visible in the caller's tenant, or anything
   * the auth chain throws at subscribe — and `docs/advisory-resolutions/
   * 5.1-realtime-transport.md`'s addendum measured what a `TRPCError` does to
   * this client: unlike a plain `Error` (which reconnects silently, with
   * resume) it STOPS. So the failure mode was a live meeting whose panels
   * quietly stop reflecting other devices, permanently, for the rest of the
   * session, with nothing red anywhere on the screen — and, until Task 6
   * rebuilt it, a `ConnectionStatusBar` still reporting a Supabase heartbeat
   * this screen no longer uses, i.e. an indicator showing healthy while the
   * transport that matters is dead.
   *
   * A toast rather than a rendered banner, deliberately: this hook is called
   * above the screen's status routing, so it fires for a meeting sitting in
   * `MeetingStartFlow` as well as one in the three-panel layout, and a toast
   * needs no place in either. `duration: Infinity` because the stream does not
   * come back on its own — the standard objection to a toast for something
   * important ("one that has timed out is a message nobody can go back and
   * read", as `AgendaItemDetailPanel`'s refusals argue) applies in full to a
   * condition that persists, and dismissing it is the operator's choice rather
   * than a timer's.
   *
   * **Task 6 added a banner and KEPT this, which is two surfaces for one
   * condition — on purpose, and on the same reasoning conventions item 12
   * gives for `RouteErrorBoundary` versus an in-component `role="alert"`.**
   * They answer different questions at different moments. The toast is the
   * EVENT: raised once, by the hook, the instant the stream dies, and
   * guaranteed regardless of what the caller renders — including the
   * `MeetingStartFlow` branch and the loading branches, where `live.tsx`
   * renders no banner at all, and including any future second caller of this
   * hook that forgets to render one. The banner is the STATE: a standing
   * sentence for whoever walks up to the clerk's laptop ten minutes later,
   * long after a toast has been dismissed, and it is the only surface for
   * `"reconnecting"`, which is not an event and has no moment to fire at.
   * Deleting either one loses a case the other does not cover. The
   * `Toaster` that makes this work is mounted in `root.tsx`, above `Outlet` —
   * app-global, not `live.tsx`'s — so it is above every branch this hook can
   * fire from.
   */
  const onError = useCallback((error: unknown) => {
    toast.error("Live updates have stopped", {
      id: LIVE_STREAM_ERROR_TOAST_ID,
      description: isTRPCClientError(error)
        ? `${error.message} Changes made on other devices will not appear here until you reload this page.`
        : "Changes made on other devices will not appear here until you reload this page.",
      duration: Infinity,
    });
  }, []);

  const transport = useSubscription(
    trpc.realtime.onMeetingChange.subscriptionOptions({ meetingId }, { onData, onError }),
  ).status;

  /**
   * Transport state → what the screen may say, with the grace window that
   * keeps a routine five-minute reconnect silent.
   *
   * The three non-obvious mappings:
   *
   * - **`"connecting"` does not immediately mean trouble.** It is the state a
   *   healthy stream passes through twelve times an hour (see
   *   `LIVE_STREAM_RECONNECT_GRACE_MS`), so it starts a timer instead of
   *   setting anything. If the stream comes back first the cleanup clears it
   *   and nothing was ever said. If the previous state was already
   *   `"reconnecting"`, it is left alone rather than reset to healthy — a
   *   flapping connection must not strobe the banner.
   * - **`"error"` is immediate, with no grace at all.** The transport ADR's
   *   addendum measured that a `TRPCError` makes this client STOP rather than
   *   resume, so there is nothing to wait for; waiting five seconds to say so
   *   would only delay the one message that needs a human.
   * - **`"idle"` is also `"stopped"`, and is not reachable today.**
   *   `useSubscription` reports `idle` when the subscription completes, which
   *   over SSE means the server sent `event: return`. `realtime.onMeetingChange`
   *   never returns — it throws, or loops until its signal aborts — and
   *   `sse-bounds.test.ts` pins that the five-minute deadline specifically does
   *   NOT emit that frame. Mapping it to `"stopped"` is the fail-loud answer
   *   for a stream that ended and is not coming back; mapping it to healthy
   *   would be the silent one.
   */
  const [status, setStatus] = useState<LiveStreamStatus>("healthy");

  useEffect(() => {
    if (transport === "pending") {
      setStatus("healthy");
      return;
    }
    if (transport === "error" || transport === "idle") {
      setStatus("stopped");
      return;
    }
    const timer = setTimeout(() => setStatus("reconnecting"), LIVE_STREAM_RECONNECT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [transport]);

  return status;
}
