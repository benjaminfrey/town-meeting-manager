/**
 * Phase E, wave 3, Task 1 — meetings: a town-wide list (the kanban), a
 * board-scoped list (the board's Meetings tab), one meeting's detail, and
 * three writes — `insert`, `cancel`, and `updateStatus`.
 *
 * ─── Why this router is different from every other one so far ────────────
 *
 * Unit 0 and waves 1–2 converted only ACTOR-only writes (`requireActor`) —
 * admin gates with no board. `insert`/`cancel`/`updateStatus` are this
 * codebase's first REAL call sites for the board-scoped half of conventions
 * item 2: `assertCanInsertMeeting`/`assertCanUpdateMeeting` (`rules.ts`) both
 * take a `BoardScope` and were, until this task, exercised only by
 * `board-scope.test.ts`'s synthetic router. See `phase-e-conventions.md`
 * item 2's "Known gaps" bullet naming this — it is retired by this commit.
 * `insert` uses `requireBoardPermission("A1", boardIdFrom())` rather than
 * importing `assertCanInsertMeeting` directly — that function is exactly
 * `assertPermission(actor, "A1", {boardId, ...})`, the identical call
 * `requireBoardPermission` makes internally, so calling it through the code
 * form (as `board-scope.test.ts`'s own single-code examples do) is not a
 * shortcut, it is the same check. `cancel`/`updateStatus` cannot do the
 * same — see below.
 *
 * ─── `scheduled_date` needs no `::text` cast, and this is why ───────────
 *
 * Investigated and DECLINED in wave 4, Task 3, recorded so the next author
 * does not spend the round rediscovering it. `agenda-item.ts`'s
 * `insertMinutesApprovalItems` casts `m.scheduled_date::text` and calls the
 * cast "load-bearing, not decorative: postgres.js parses a `date` column
 * into a JS Date." That is true of a BARE `postgres()` client and NOT true
 * of the path every router here actually uses. Probed both ways against the
 * local database rather than reasoned about:
 *
 *     postgres()          SELECT '2026-03-15'::date  →  Date  (ISO string over the wire)
 *     drizzle(postgres()) SELECT '2026-03-15'::date  →  "2026-03-15"  (a string)
 *
 * `drizzle-orm/postgres-js` installs identity parsers, so `tx.execute(sql…)`
 * — which is how every procedure in this file reads — hands back the raw
 * text for `date` AND `timestamptz`. So `scheduled_date: string` was accurate
 * all along, `new Date(scheduled_date + "T00:00:00")` works in every consumer,
 * and adding casts here would have been churn justified by a claim that does
 * not reproduce on this code path. The same probe is what makes the `::int`
 * casts elsewhere genuinely load-bearing: `count(*)` really does come back as
 * the string `"1"`.
 *
 * ─── Reads carry no guard ──────────────────────────────────────────────
 *
 * `meeting_tenant_isolation` (`0000_baseline.sql`) is `FOR ALL USING
 * (town_id = get_current_town_id())` — tenancy-only, no board or role
 * predicate. The Supabase queries these three reads replace had no
 * application-level check either, so `protectedProcedure` + `ctx.withTenant`
 * is the same policy carried forward, per conventions item 2's "a read whose
 * old policy was tenancy-only gets protectedProcedure and no guard."
 *
 * ─── NOT_FOUND, not FORBIDDEN, for a board or meeting in another town ─────
 *
 * `byBoard` calls `assertBoardExists` first, exactly as `board.stats`/
 * `board.recentMeetings` do — its correlated scan degrades to `[]` for a
 * foreign or nonexistent board just as readily as for a real, empty one.
 * `detail` answers NOT_FOUND directly from its own missing-row check, the
 * same shape as `board.detail`.
 *
 * ─── `insert`: the FK hazard, closed the same way three times before ─────
 *
 * `insert` takes a client-supplied `boardId` that becomes `meeting.board_id`
 * — a foreign key. Postgres's own docs say FK enforcement bypasses row
 * security, so `assertBoardExists` runs first, inside the same
 * `withTenant` transaction as the write, exactly like `board-member.ts`'s
 * `addBoardMember`/`addToBoard` and `person.ts`'s `insertStaffAccount`.
 * Verified by mutation: with the call removed, an admin in one town can
 * create a meeting whose `board_id` names another town's board — reproduced
 * once during this task, then restored; see `meeting.test.ts`'s own FK test
 * for the automated form of the same check.
 *
 * `created_by` is `ctx.tenant.userAccountId` — the caller's own session —
 * never taken from client input, unlike the raw Supabase insert this
 * replaces (`CreateMeetingDialog.tsx` sent `currentUser?.id` itself). A
 * client that controlled its own `created_by` could attribute a meeting to
 * someone else's account.
 *
 * `status`/`agenda_status`/`formality_override` are hardcoded
 * (`'draft'`/`'draft'`/`null`) rather than accepted from input — a NEW
 * meeting is always freshly drafted; there is no legitimate reason for a
 * caller to create one in any other state, and accepting the fields would
 * open a way to mint a meeting that is already `'noticed'` or `'approved'`
 * with no history behind it.
 *
 * ─── `cancel`/`updateStatus`: why they do NOT copy `insert`'s guard verbatim
 *
 * Two divergences from the literal wave-3 task brief
 * (".use(requireBoardPermission("A1", boardIdFrom())).input(...)" for every
 * write), both load-bearing enough to report rather than silently deviate
 * from, and both now generalised into `trpc.ts` rather than left as a
 * one-off local middleware (this task's own first version had a local
 * `requireCanUpdateMeeting`; the review round generalised it — see
 * `requireBoardActor`'s own doc comment in `trpc.ts` for the full case,
 * summarised here):
 *
 * 1. **`assertCanUpdateMeeting` is not a single-code check.** It is
 *    `isAdmin(actor) OR A1@board OR M1@board` (`rules.ts`, "meeting UPDATE").
 *    `requireBoardPermission` always resolves exactly ONE `PermissionCode`
 *    via `assertPermission` — it cannot express an OR across two codes plus
 *    a role check. The `isAdmin` branch happens to be subsumed already
 *    (`hasPermission` returns `true` for role `admin` before it ever
 *    consults a matrix or a board — see `packages/shared/src/utils/
 *    permissions.ts`), so `requireBoardPermission("A1", ...)` alone would
 *    still pass an admin. The M1 branch is NOT subsumed: a caller holding
 *    only M1 (`start_run_meeting`) — e.g. a presiding officer with no A1 —
 *    would be wrongly refused by a straight A1-only guard. Both `cancel` and
 *    `updateStatus` are `meeting` UPDATEs (`status` changes), exactly
 *    `assertCanUpdateMeeting`'s own stated scope, so both get the real rule
 *    via `requireBoardActor(assertCanUpdateMeeting)` — `requireActor`'s
 *    board-scoped sibling, taking the RULE FUNCTION rather than a code, so
 *    it can express an OR across codes and a role check the way
 *    `requireBoardPermission` cannot. See `trpc.ts` for why this is a
 *    generalised primitive rather than staying a local one-off — the
 *    reviewer found two MORE `BoardScope` rules (`assertCanInsertExhibit`,
 *    `assertCanInsertVoteRecord`) that also do not fit
 *    `requireBoardPermission`, so this shape needed a name other authors can
 *    reach for, not a second bespoke copy.
 *
 * 2. **`meeting` has no board-level RLS, so a client-supplied board id is
 *    not safe to trust for authorization the way `insert`'s is.** `insert`
 *    uses `boardId` for the FK it is ABOUT to write — the guard's
 *    pre-validation value and the resolver's post-validation value are
 *    identical by construction (no `.transform()`), exactly the case item 2
 *    already covers. `cancel`/`updateStatus` both target an EXISTING row by
 *    `meetingId`, and that row already has its own, true `board_id` from
 *    when it was created. Because `meeting_tenant_isolation` has no board
 *    predicate, any signed-in member of the town can already SEE any
 *    meeting's real board via `detail`/`byTown` — so a caller holding A1 on
 *    their OWN board could send `{meetingId: <someone else's board's
 *    meeting>, boardId: <their own board>}`. The middleware guard, reading
 *    the CLAIMED board off unvalidated input exactly as `boardIdFrom`
 *    always does, would correctly authorize against the board the caller
 *    named — which is not the board the write is actually about. This is
 *    the `.transform()` hazard item 2 already names ("the guard authorizes
 *    the PRE-validation board id while the resolver acts on the
 *    POST-validation one... do not transform a value a guard authorizes
 *    on"), reached a different way: not by a schema transform, but by the
 *    write's true subject being a different id than the one the guard
 *    checked. Both resolvers close it by calling
 *    `assertMatchesAuthorizedBoard(ctx, meeting.board_id)` — `trpc.ts`'s
 *    mechanical, greppable half of `requireBoardActor`'s mismatch defence —
 *    against the ROW's real `board_id`, read fresh from the database,
 *    before performing the update. This is NOT `cancel`'s special case: any
 *    future board-scoped write in this router (or any other table with no
 *    board-level RLS) targeting a row by an id other than the board id
 *    needs the identical call — see `trpc.ts`'s own doc comment on
 *    `requireBoardActor` for which of waves 4–6's tables are already known
 *    to be in that shape.
 *
 *    This design no longer needs a second `ctx.actor()` call inside the
 *    transaction at all — `assertMatchesAuthorizedBoard` only compares two
 *    board id strings, one already resolved by the guard
 *    (`ctx.authorizedBoardId`) and one just read from the row. The earlier
 *    version of `cancel` DID call `ctx.actor()` a second time, resolver-side,
 *    to re-run `assertCanUpdateMeeting` against the real board — and
 *    mutation-testing THAT design (deleting the guard to prove the
 *    resolver's re-check alone still refused unauthorized callers) is what
 *    found a real bug: resolving `ctx.actor()` for the first time from
 *    INSIDE `ctx.withTenant`'s own callback opens a second, nested
 *    transaction on the same connection, which self-deadlocked the test
 *    harness's single-connection pool instead of failing. `context.ts` now
 *    closes that structurally (a per-request reentrancy guard, not a
 *    convention to remember), but this design change also means the
 *    specific call pattern that trap needs no longer appears here at all.
 *
 * The middleware guard is still required, still declared before `.input()`,
 * and still answers FORBIDDEN before BAD_REQUEST for a refused caller whose
 * OTHER input fails to parse (`meeting.test.ts`'s reorder pins) — it is not
 * redundant with the resolver's re-check. Removing it would mean an
 * unauthenticated-for-any-board caller's malformed `meetingId` gets
 * BAD_REQUEST instead of FORBIDDEN, which is exactly the defect item 2 spent
 * two fix rounds on. The resolver's re-check is a SECOND, independent gate,
 * not a replacement for the first.
 *
 * ─── `updateStatus`: the gap the review round found ───────────────────────
 *
 * `routes/meetings.tsx`'s kanban drags a meeting between columns via a raw
 * `supabase.from("meeting").update({status: newStatus})` with **no
 * authorization check of any kind** — any signed-in town member, any role,
 * could move any meeting to any status, including `'noticed'`. This
 * procedure closes that with the identical `requireBoardActor
 * (assertCanUpdateMeeting)` + `assertMatchesAuthorizedBoard` shape `cancel`
 * uses. It does NOT enforce that `'noticed'` is only reachable by generating
 * and publishing a notice — the product's own stated rule for that status
 * (see project memory, "Session 13.x: Meeting notice template system...
 * `noticed` status gated behind notice generation") is a materially larger
 * feature (a whole planned session), not an authorization check, and
 * inventing that gate here would be exactly the "design decision smuggled
 * into a migration" conventions item 1 warns against — the raw code this
 * replaces enforced no such precondition either, so this is not a
 * regression, only an unclosed gap this task did not own closing. Nor does
 * it validate that a requested transition is a LEGAL one for the meeting's
 * CURRENT status (`draft` → `approved` directly, say) — the client-side
 * `VALID_TRANSITIONS` map in `meetings.tsx` is the only thing that has ever
 * enforced that, and this procedure preserves exactly the level of
 * server-side validation the raw update had, which was none. `'cancelled'`
 * is excluded from this procedure's accepted values on purpose — `cancel`
 * is the dedicated procedure for that transition, with its own tests: two
 * procedures answering the identical question would be the same logic in
 * two places instead of one, conventions item 1's "one noun, one router"
 * concern one level down. `meetings.tsx` also sends `"active"` as a target
 * status for its noticed→active kanban transition, which is not a real
 * `meeting_status` value (the enum has `open`, not `active`; that screen's
 * kanban column id and its DB status are different strings pre-existing
 * this task) — Task 2, which migrates that screen, inherits reconciling the
 * two, not this task. **Task 2 did it** (`routes/meetings.tsx`): its
 * `VALID_TRANSITIONS` map now carries `column` (the kanban drop target's id)
 * and `status` (the real `meeting_status` value) as separate fields, and the
 * noticed→active drag sends `"open"`. Recorded here rather than left as a
 * live forward-reference — conventions item 14's lens, applied to a router
 * header instead of a Known-gaps bullet.
 *
 * ─── `publishAgenda`: the third raw write, and the code that had no rule ──
 *
 * Phase E wave 4, Task 2. `PublishAgendaDialog.tsx` writes
 * `meeting.agenda_status = 'published'` through raw Supabase with no
 * authorization check of any kind — the same shape wave 3 closed for
 * `status`, on a different column, and flagged there by that dialog's own
 * `TODO(phase-e-wave-4)` marker.
 *
 * What made it worse than `updateStatus`'s hole: there was no rule to reach
 * for. `PERMISSIONS.A5` is `publish_agenda` and A5 is one of the 18
 * `BOARD_SCOPED_CODES`, but before this task the only occurrences of "A5" in
 * `packages/api` were two test fixtures — no `assertCanPublishAgenda`
 * existed at all. `rules.ts` now carries it (see its own "21a" section for
 * why it is a rule rather than a bare code, given Task 1 declined to add
 * `assertCanDeleteAgendaItem` on what looks like the opposite reasoning),
 * and this procedure reaches A5 through
 * `requireBoardPermission("A5", boardIdFrom())` — the single-code form
 * conventions item 2 says to reach for FIRST, and the same `assertPermission`
 * call the rule itself makes.
 *
 * A5, not A2 and not `assertCanUpdateMeeting`: publishing is a distinct
 * governable action from editing the agenda's contents (A2) and from moving
 * the meeting's own `status` (rule 21). The permission matrix grants the
 * three independently, so folding this into either would hand publication to
 * everyone holding the other.
 *
 * Row re-authorization is `cancel`'s and `updateStatus`'s, exactly: the
 * target is named by `meetingId`, the guard authorized a CLIENT-CLAIMED
 * `boardId`, and `meeting_tenant_isolation` has no board predicate — so the
 * resolver re-reads the row's real `board_id` inside the write's own
 * transaction and calls `assertMatchesAuthorizedBoard` before the UPDATE.
 *
 * What it does NOT do, stated so a reviewer does not read the absence as an
 * oversight: it does not require the agenda to have at least one item. The
 * dialog checks that client-side (`hasItems`) and the raw write it replaces
 * enforced nothing server-side, so adding the precondition here would be a
 * new rule rather than a preserved one — conventions item 1's "the query you
 * are replacing is a specification." It also does not touch `meeting.status`:
 * `agenda_status` and `status` are separate columns with separate
 * procedures, and the raw write set only this one. Nor does it accept a
 * target value — `'published'` is the only transition the dialog performs,
 * and an `agenda_status` input would let a caller move a published agenda
 * back to `'draft'` through a guard named "publish".
 *
 * **Wiring:** Task 3 wires `PublishAgendaDialog.tsx` to this. Until it does,
 * the hole is NOT closed — the procedure exists and the dialog still writes
 * raw Supabase. Wave 3 reported a hole closed at the moment its procedure
 * shipped and had to correct itself; recorded here so the same claim is not
 * made twice.
 *
 * ─── All four writes publish, as of Phase E wave 5, Task 3 ────────────────
 *
 * `meeting` is one of the eight `LIVE_MEETING_TOPICS` (`realtime/events.ts`),
 * and `insert`, `cancel`, `updateStatus` and `publishAgenda` were four of the
 * eleven entries on `router-wiring.test.ts`'s `AWAITING_PUBLISH` ledger. Each
 * now calls `publishRealtimeEvent(tx, …)` as the last statement inside its own
 * transaction, so the announcement commits or rolls back with the write it
 * announces.
 *
 * **`insert` publishes for a meeting nobody can be watching yet, and that is
 * deliberate rather than an oversight.** A subscriber names one `meetingId`
 * (`routers/realtime.ts`), so a just-created meeting has no subscribers and
 * the event reaches nobody. It is published anyway because the alternative is
 * a ledger entry: an exception on the "every live-meeting write announces
 * itself" rule that a reader would have to re-derive as harmless every time
 * they met it, in exchange for saving one `pg_notify` per meeting created.
 */

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  router,
  protectedProcedure,
  requireBoardPermission,
  requireBoardActor,
  assertMatchesAuthorizedBoard,
  boardIdFrom,
} from "../trpc.js";
import { assertCanUpdateMeeting } from "../authorization/rules.js";
import { publishRealtimeEvent, type LiveMeetingTopic } from "../../realtime/events.js";
import {
  assertAgendaItemsOnMeeting,
  assertBoardMembersOnBoard,
  assertMotionsOnMeeting,
} from "../board-derivation.js";
import { assertBoardExists } from "./board.js";
import { toRows } from "../../db/rows.js";
import type { TenantTx } from "../../db/with-tenant.js";

const MEETING_TYPES = [
  "regular",
  "special",
  "annual_town_meeting",
  "special_town_meeting",
  "public_hearing",
  "workshop",
  "emergency",
] as const;

/**
 * Every `meeting_status` value `updateStatus` accepts — the full DB enum
 * (`db/schema.ts`'s `meetingStatus`) minus `'cancelled'`, which is
 * `cancel`'s own job — see this file's header.
 */
const UPDATABLE_MEETING_STATUSES = [
  "draft",
  "noticed",
  "open",
  "adjourned",
  "minutes_draft",
  "approved",
] as const;

/**
 * Confirm the meeting exists in the caller's own town before answering a
 * question ABOUT it — the identical shape as `board.ts`'s `assertBoardExists`
 * and for the same reason (conventions item 3): RLS makes a foreign or
 * nonexistent meeting invisible, not merely filtered, but a correlated
 * count/scan (e.g. `agendaItem.countByMeeting`) degrades to `0`/`[]` for
 * either case just as readily as for a real meeting with nothing recorded
 * yet, and a screen calling only that procedure would render a convincing,
 * empty-but-real meeting for an id that is not there.
 *
 * Exported (wave 3, Task 3) so `agenda-item.ts`, `minutes-document.ts` and
 * `meeting-attendance.ts` can each run the identical check for their own
 * meeting-scoped reads rather than duplicating the query — the same reuse
 * `board.ts`'s own export already gets from `agenda-template.ts`.
 */
export async function assertMeetingExists(tx: TenantTx, meetingId: string): Promise<void> {
  const rows = toRows<{ id: string }>(
    await tx.execute(sql`SELECT id FROM meeting WHERE id = ${meetingId}`),
    (message) => new Error(`meeting.assertMeetingExists: ${message}`),
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
}

export const meetingRouter = router({
  /**
   * The kanban's read (`routes/meetings.tsx`) — every non-cancelled meeting
   * in the caller's town, oldest-scheduled first, with just enough of each
   * board to render the card. Cancelled meetings are excluded and ordering
   * is ascending by date then time, matching the Supabase query this
   * replaces exactly (`the query you are replacing is a specification`).
   *
   * Flattened `board_id`/`board_name` rather than a nested `{board: {id,
   * name}}` object — the old PostgREST embed forced a cast through
   * `unknown` on the client (`board:board_id(id, name)` infers as an array
   * for a to-one relation; see `meetings.tsx`'s own comment on that cast).
   * A real join has no such ambiguity, and every other converted router in
   * this phase (`boardMember.roster`, `board.list`) already returns flat
   * columns rather than a nested shape.
   *
   * No `WHERE m.town_id = ...`: RLS on both `meeting` and `board` already
   * scopes this to the caller's town, and a redundant clause makes the
   * tenancy test vacuous — conventions item 2's "no redundant WHERE town_id
   * alongside RLS."
   *
   * **`started_at` ADDED in wave 6, Task 5, for a SECOND caller.**
   * `routes/home.tsx`'s "Happening now" hero renders `started N min ago` off
   * it, and that screen's `select("*")` used to supply it. Conventions item
   * 1's "add it back the day something does", the same treatment
   * `meeting.detail`'s own four packet/notice columns got in wave 4 — every
   * other column `home.tsx` got from `SELECT *` (`town_id`, `location`,
   * `created_by`, …) is still absent because nothing on either screen reads
   * it. Invisible to `meetings.tsx`, which does not read it (`test/trpc.ts`'s
   * "the gap runs one way").
   */
  byTown: protectedProcedure.query(async ({ ctx }) => {
    return ctx.withTenant(async (tx) =>
      toRows<{
        id: string;
        title: string;
        status: string;
        meeting_type: string;
        scheduled_date: string;
        scheduled_time: string | null;
        started_at: string | null;
        board_id: string;
        board_name: string;
      }>(
        await tx.execute(sql`
          SELECT m.id, m.title, m.status, m.meeting_type, m.scheduled_date, m.scheduled_time,
                 m.started_at, m.board_id, b.name AS board_name
          FROM meeting m
          JOIN board b ON b.id = m.board_id
          WHERE m.status != 'cancelled'
          ORDER BY m.scheduled_date ASC, m.scheduled_time ASC, m.id
        `),
        (message) => new Error(`meeting.byTown: ${message}`),
      ),
    );
  }),

  /**
   * Phase E, wave 6, Task 2 — `AppShell.tsx`'s sidebar live-meeting indicator:
   * the id of the town's most recently started `open` meeting, or `null`.
   *
   * ─── Why `byTown` above is not a drop-in — verified, not assumed ─────────
   *
   * The router's own `TODO(phase-e-wave-6)` on `useLiveMeetingId` says
   * `byTown` "selects no `started_at`, which is this query's ordering
   * column." True: `byTown`'s SELECT list four procedures up has no
   * `started_at`, and it also lists every non-cancelled meeting rather than
   * the one most recently opened — two reasons it cannot be reused, not one.
   * The marker was accurate; three of this wave's eight markers named
   * procedures that already existed, and this was not a fourth.
   *
   * ─── The raw query, and the one clause NOT carried over ──────────────────
   *
   * Replaces `useLiveMeetingId`'s `supabase.from("meeting").select("id")
   * .eq("town_id", townId).in("status", ["open", "in_progress"])
   * .order("started_at", {ascending: false}).limit(1)`. `'in_progress'` is
   * DROPPED from the status filter rather than reproduced, and this is not a
   * narrowing of real behaviour: `meeting_status`'s enum (`0000_baseline.sql`)
   * has exactly `draft, noticed, open, adjourned, minutes_draft, approved,
   * cancelled` — no `in_progress` — so no `meeting` row has ever been able to
   * hold that value. Probed directly rather than inferred from the schema
   * alone: `SELECT 'in_progress'::meeting_status` itself raises "invalid
   * input value for enum meeting_status." Reproducing the literal filter as a
   * typed comparison here (`status = ANY(ARRAY['open','in_progress']::
   * meeting_status[])`) would make EVERY call to this procedure throw that
   * same error — worse than the original, which silently degraded instead:
   * the browser's `.in(...)` call carries no `.throwOnError()`, so
   * PostgREST's identical rejection of the same invalid literal left `data`
   * `undefined` and the hook falling to `null` on every 30-second poll,
   * meaning the sidebar's live-meeting indicator has never actually lit up in
   * production. `status = 'open'` matches every row the original filter
   * could ever have matched (since `in_progress` matched none) and no row it
   * could not — the honest form of the same intent, not a widened one.
   *
   * `NULLS LAST` on the DESC order for the reason `byBoard`'s own comment
   * gives for its own DESC clause: Postgres's default for DESC is NULLS
   * FIRST, which would let a stray `open` meeting with no `started_at` (a
   * state nothing in this codebase should produce, but not one this router
   * can assume against) shadow a real live one instead of sorting behind it.
   *
   * ─── No guard, no existence check ─────────────────────────────────────────
   *
   * `meeting_tenant_isolation` is tenancy-only (this file's header), and the
   * raw Supabase read had no application-level check either — the same
   * "protectedProcedure and no guard" shape `byTown` states just above.
   * Unlike `byBoard`/`detail`, this takes no id from the caller at all: the
   * only scope is the caller's own town, which RLS already enforces, so there
   * is no foreign id for a correlated scan to hide behind an empty result —
   * conventions item 3's hazard does not arise when there is nothing for the
   * caller to name.
   */
  liveByTown: protectedProcedure.query(async ({ ctx }) => {
    return ctx.withTenant(async (tx) => {
      const rows = toRows<{ id: string }>(
        await tx.execute(sql`
          SELECT id FROM meeting
          WHERE status = 'open'::meeting_status
          ORDER BY started_at DESC NULLS LAST
          LIMIT 1
        `),
        (message) => new Error(`meeting.liveByTown: ${message}`),
      );
      return { id: rows[0]?.id ?? null };
    });
  }),

  /**
   * The board's Meetings tab (`routes/boards.$boardId.meetings.tsx`) —
   * every meeting on one board, most-recent-first, INCLUDING cancelled ones
   * (that screen renders them dimmed, not hidden — unlike the kanban). Same
   * `DESC ... NULLS LAST` shape as `board.recentMeetings`, for the same
   * reason: a DESC order's Postgres default is `NULLS FIRST`, which would
   * put every meeting with no time set ahead of ones that have one.
   */
  byBoard: protectedProcedure
    .input(z.object({ boardId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertBoardExists(tx, input.boardId);
        return toRows<{
          id: string;
          title: string;
          status: string;
          meeting_type: string;
          agenda_status: string;
          scheduled_date: string;
          scheduled_time: string | null;
        }>(
          await tx.execute(sql`
            SELECT id, title, status, meeting_type, agenda_status, scheduled_date, scheduled_time
            FROM meeting
            WHERE board_id = ${input.boardId}
            ORDER BY scheduled_date DESC, scheduled_time DESC NULLS LAST, id
          `),
          (message) => new Error(`meeting.byBoard: ${message}`),
        );
      });
    }),

  /**
   * `routes/meetings.$meetingId.tsx`'s own read of the `meeting` row —
   * NOT the other eight reads that screen makes against `board`/`person`/
   * `agenda_item`/`minutes_document`/`meeting_attendance` (those belong to
   * their own routers and are wave 3 Task 3's job, not this router's).
   * Columns checked against that screen's `const status = meeting.status`
   * block onward: `board_id` (every board-scoped guard the agenda/live/
   * minutes/review tabs need downstream reads it off this row — see this
   * wave's plan, Task 3's own note), `presiding_officer_id`/
   * `recording_secretary_id` (looked up by id there), `started_at`/
   * `ended_at` (rendered conditionally). Not `SELECT *`, unlike the query
   * this replaces — conventions item 1.
   *
   * **Four columns ADDED in wave 4, Task 3, for a SECOND screen.**
   * `routes/meetings.$meetingId.agenda.tsx` migrated its own
   * `select("*").eq("id", …).single()` onto this procedure and reads
   * `agenda_packet_url`/`agenda_packet_generated_at`/`meeting_notice_url`/
   * `meeting_notice_generated_at` — the four the "Generate/Regenerate
   * Packet" and "Generate/Regenerate Notice" buttons switch their label on
   * and the "Packet generated …" line renders. This is conventions item 1's
   * "add it back the day something does", not a widening: every other column
   * that screen used to get from `SELECT *` (`town_id`, `formality_override`,
   * `created_by`, …) is still absent because nothing reads it.
   *
   * The two `generated_at` columns are `timestamp with time zone` and are
   * NOT cast to `::text`, matching `started_at`/`ended_at` immediately above
   * them — but NOT for the reason a first draft of this comment gave.
   * Probed the same way `scheduled_date` was above, because "postgres.js
   * hands back a `Date`" is a claim about a BARE `postgres()` client, and
   * every procedure in this file reads through `drizzle(postgres())`:
   *
   *     drizzle(postgres()) SELECT now()::timestamptz  →  "2026-09-10 19:53:56.526853-04"
   *
   * — raw postgres text, not a `Date`, and not the ISO-8601 string this row
   * type's declared `string | null` would suggest. `toRows` does no
   * conversion (`packages/api/src/db/rows.ts`) and no tRPC transformer is
   * configured (`trpc.ts` / `web/src/lib/trpc.ts` set none), so that raw text
   * is what actually reaches the browser and what an API test calling the
   * caller directly sees too — there is no `Date` on either side of this
   * boundary. `new Date(agendaPacketGeneratedAt).toLocaleString()` still
   * works today because V8 happens to parse a space-separated timestamp with
   * a 6-digit fraction and a 2-digit offset, not because the value is
   * ISO-8601 — a stricter engine is not obligated to accept it. See
   * `meeting.test.ts`'s "returns the agenda-packet and meeting-notice
   * document columns" for the `typeof`/shape assertion pinning this, the
   * same treatment `scheduled_date` gets above.
   *
   * **`adjournment` ADDED in wave 6, Task 4, for a THIRD screen.**
   * `routes/meetings.$meetingId.review.tsx` renders the "Adjourned by motion
   * / without objection" badge off `adjournment.method` and hands the whole
   * object to `buildStructuredMeetingRecord`, the exported meeting record.
   * Same "add it back the day something does" as the four above. Typed
   * `unknown`, matching every other `jsonb` column this codebase returns
   * (`motion.vote_summary`, `executiveSession.post_session_action_motion_ids`):
   * nothing here validates its shape, and `unknown` is the honest declaration
   * for a value the database does not constrain. Its five keys, and the
   * `adjourned_by` misattribution that lived in the assembler's read of one of
   * them (fixed in backlog 11), are documented on `adjourn` below — a reader
   * of this column should start there.
   *
   * **`board_name` ADDED in wave 6, Task 5, for a FOURTH caller**, and it is
   * the first column here that is not a `meeting` column at all.
   * `components/MeetingSubnavHeader.tsx` — the shared context header
   * `MeetingLayout` renders above the agenda/live/review/minutes screens —
   * shows the board's name beside the meeting title, and did it with its own
   * raw `board:board_id(id, name)` PostgREST embed. The alternative was a
   * dependent `board.detail` call on the client (21 columns, a second round
   * trip, and a board id it cannot know until this query resolves) for one
   * string. The JOIN is the same shape `byTown` above already uses, and it is
   * INNER rather than LEFT on purpose: `meeting.board_id` is `NOT NULL` and
   * both tables carry the same tenancy policy, so a meeting visible to this
   * caller always has a visible board — a LEFT JOIN would only be pretending
   * otherwise. The embed's `board.id` is deliberately NOT added: the subnav
   * renders the name only, and `board_id` is already here.
   */
  detail: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.withTenant(async (tx) =>
        toRows<{
          id: string;
          board_id: string;
          title: string;
          status: string;
          meeting_type: string;
          agenda_status: string;
          scheduled_date: string;
          scheduled_time: string | null;
          location: string | null;
          presiding_officer_id: string | null;
          recording_secretary_id: string | null;
          current_agenda_item_id: string | null;
          started_at: string | null;
          ended_at: string | null;
          agenda_packet_url: string | null;
          agenda_packet_generated_at: string | null;
          meeting_notice_url: string | null;
          meeting_notice_generated_at: string | null;
          adjournment: unknown;
          board_name: string;
        }>(
          await tx.execute(sql`
            SELECT m.id, m.board_id, m.title, m.status, m.meeting_type, m.agenda_status,
                   m.scheduled_date, m.scheduled_time, m.location, m.presiding_officer_id,
                   m.recording_secretary_id, m.current_agenda_item_id,
                   m.started_at, m.ended_at, m.agenda_packet_url, m.agenda_packet_generated_at,
                   m.meeting_notice_url, m.meeting_notice_generated_at, m.adjournment,
                   b.name AS board_name
            FROM meeting m
            JOIN board b ON b.id = m.board_id
            WHERE m.id = ${input.meetingId}
          `),
          (message) => new Error(`meeting.detail: ${message}`),
        ),
      );
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  /**
   * `CreateMeetingDialog.tsx`'s write. See this file's header for the FK
   * hazard, why `created_by` is server-derived, and why `status`/
   * `agenda_status`/`formality_override` are hardcoded rather than accepted.
   *
   * Does NOT instantiate the agenda from a template — the original
   * component did that as a SEPARATE step after the insert succeeded
   * (`instantiateAgendaFromTemplate`, a client-side helper writing
   * `agenda_item` rows directly), and that write belongs to whichever
   * router owns `agenda_item` (wave 4's agenda surface, per this wave's
   * plan — "out of scope, and verify before assuming"), not this one.
   * `Task 2` wires the two calls together client-side exactly as the
   * component already sequences them today.
   */
  insert: protectedProcedure
    .use(
      requireBoardPermission("A1", boardIdFrom(), {
        action: "to schedule a meeting for this board",
      }),
    )
    .input(
      z.object({
        boardId: z.string().uuid(),
        title: z.string().min(2).max(200),
        meetingType: z.enum(MEETING_TYPES),
        scheduledDate: z.string().min(1),
        scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
        location: z.string().max(200).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertBoardExists(tx, input.boardId);
        const rows = toRows<{ id: string }>(
          await tx.execute(sql`
            INSERT INTO meeting (
              board_id, town_id, title, meeting_type, scheduled_date, scheduled_time,
              location, status, agenda_status, formality_override, created_by
            )
            VALUES (
              ${input.boardId}, ${ctx.tenant.townId}, ${input.title}, ${input.meetingType},
              ${input.scheduledDate}, ${input.scheduledTime}, ${input.location},
              'draft'::meeting_status, 'draft', NULL, ${ctx.tenant.userAccountId}
            )
            RETURNING id
          `),
          (message) => new Error(`meeting.insert: ${message}`),
        );
        const meetingId = rows[0]!.id;
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId,
          topic: "meeting",
        });
        return { id: meetingId };
      });
    }),

  /**
   * `CancelMeetingDialog.tsx`'s write. See this file's header, "why
   * `cancel`/`updateStatus` do NOT copy `insert`'s guard verbatim" — this
   * is one of the two procedures that section is about.
   */
  cancel: protectedProcedure
    .use(requireBoardActor(assertCanUpdateMeeting))
    .input(z.object({ meetingId: z.string().uuid(), boardId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const rows = toRows<{ id: string; board_id: string }>(
          await tx.execute(sql`SELECT id, board_id FROM meeting WHERE id = ${input.meetingId}`),
          (message) => new Error(`meeting.cancel: ${message}`),
        );
        const meeting = rows[0];
        if (!meeting) throw new TRPCError({ code: "NOT_FOUND" });
        assertMatchesAuthorizedBoard(ctx, meeting.board_id);

        await tx.execute(sql`
          UPDATE meeting SET status = 'cancelled'::meeting_status, updated_at = now()
          WHERE id = ${input.meetingId}
        `);
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId: input.meetingId,
          topic: "meeting",
        });
        return { id: input.meetingId };
      });
    }),

  /**
   * `routes/meetings.tsx`'s kanban drag-and-drop write, closing the
   * no-authorization-at-all gap the review round found — see this file's
   * header, "`updateStatus`: the gap the review round found," for exactly
   * what this does and does not enforce.
   */
  updateStatus: protectedProcedure
    .use(requireBoardActor(assertCanUpdateMeeting))
    .input(
      z.object({
        meetingId: z.string().uuid(),
        boardId: z.string().uuid(),
        status: z.enum(UPDATABLE_MEETING_STATUSES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const rows = toRows<{ id: string; board_id: string }>(
          await tx.execute(sql`SELECT id, board_id FROM meeting WHERE id = ${input.meetingId}`),
          (message) => new Error(`meeting.updateStatus: ${message}`),
        );
        const meeting = rows[0];
        if (!meeting) throw new TRPCError({ code: "NOT_FOUND" });
        assertMatchesAuthorizedBoard(ctx, meeting.board_id);

        await tx.execute(sql`
          UPDATE meeting SET status = ${input.status}::meeting_status, updated_at = now()
          WHERE id = ${input.meetingId}
        `);
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId: input.meetingId,
          topic: "meeting",
        });
        return { id: input.meetingId, status: input.status };
      });
    }),

  /**
   * `PublishAgendaDialog.tsx`'s write — see this file's header,
   * "`publishAgenda`: the third raw write, and the code that had no rule."
   *
   * `updated_at` is set alongside `agenda_status`, matching the raw update
   * this replaces (it sent `updated_at: new Date().toISOString()` from the
   * browser's clock; `now()` is the database's, which is the same intent
   * without trusting a client clock).
   */
  publishAgenda: protectedProcedure
    .use(
      requireBoardPermission("A5", boardIdFrom(), {
        action: "to publish this meeting's agenda",
      }),
    )
    .input(z.object({ meetingId: z.string().uuid(), boardId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const rows = toRows<{ id: string; board_id: string }>(
          await tx.execute(sql`SELECT id, board_id FROM meeting WHERE id = ${input.meetingId}`),
          (message) => new Error(`meeting.publishAgenda: ${message}`),
        );
        const meeting = rows[0];
        if (!meeting) throw new TRPCError({ code: "NOT_FOUND" });
        assertMatchesAuthorizedBoard(ctx, meeting.board_id);

        await tx.execute(sql`
          UPDATE meeting SET agenda_status = 'published', updated_at = now()
          WHERE id = ${input.meetingId}
        `);
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId: input.meetingId,
          topic: "meeting",
        });
        return { id: input.meetingId, agenda_status: "published" as const };
      });
    }),

  /**
   * `MeetingStartFlow.tsx`'s "Call to Order" — ONE of the two `meeting.status`
   * holes wave 5 closes, and the first of this router's three COMPOSITE
   * procedures.
   *
   * Today it is four sequential Supabase writes with no transaction and **no
   * authorization check of any kind**: the recording secretary's
   * `meeting_attendance` flag, `meeting` (`status = 'open'`, `started_at`,
   * both officers, `current_agenda_item_id`), the first agenda item's
   * `status = 'active'`, and the opening `agenda_item_transition`. A failure
   * after the second leaves a meeting that is OPEN with no current item and no
   * clock running.
   *
   * ─── The guard, and the one real cost in this task ───────────────────────
   *
   * `requireBoardActor(assertCanUpdateMeeting)` — the same guard `cancel` and
   * `updateStatus` carry, for the same reason (`meeting.status` is exactly
   * that rule's stated scope), plus the same resolver-side
   * `assertMatchesAuthorizedBoard` against the row's real `board_id`.
   *
   * **That is ONE rule for an act that writes FOUR tables, and the other three
   * rules are not additionally required. Stated as a decision, with its cost,
   * rather than left to be discovered:**
   *
   *   | write                          | its own rule                              |
   *   | ------------------------------ | ----------------------------------------- |
   *   | `meeting.status` etc.          | 21, `assertCanUpdateMeeting` — admin/A1/M1 |
   *   | `meeting_attendance` flag      | 8, `assertCanUpdateMeetingAttendance` — M2 |
   *   | `agenda_item.status`           | 2a, `assertCanUpdateAgendaItemProgress` — A2 or M1 |
   *   | `agenda_item_transition` INSERT | 21d, `assertCanInsertAgendaItemTransition` — M1 |
   *
   * A caller holding A1 and none of M1/M2/A2 passes the guard and performs all
   * four. Three alternatives were considered:
   *
   *   - **Require every rule.** Coherent on paper, and it refuses an M1
   *     presiding officer who holds no M2 — who is precisely the person this
   *     button exists for. That is the failure `rules.ts`'s rule 2a comment is
   *     organised around ("a partial adjournment, which is worse than either
   *     answer"), reached one act earlier.
   *   - **Require M1 alone.** M1 satisfies 21, 2a and 21d in one code, and is
   *     the honest description of the act. Rejected because `updateStatus`
   *     ALREADY lets an A1 holder drag a meeting to `open` from the kanban:
   *     the same status transition would then be allowed through one procedure
   *     and refused through another, an inconsistency no rule asks for. If the
   *     product wants live-run acts to be M1-only, that is a change to rule 21
   *     and to `updateStatus` together, not a guard chosen differently here.
   *   - **What shipped**: the rule governing the act's PRIMARY write, applied
   *     to the whole act.
   *
   * The cost is real and is bounded: it is a NARROWING of today's behaviour
   * (four writes authorized by nothing become four writes authorized by
   * admin/A1/M1 on the meeting's own board), and it stops short of the rules
   * for M2 specifically. Revisit it with rule 21, not here.
   *
   * ─── Idempotent when the meeting is already open ─────────────────────────
   *
   * `SELECT … FOR UPDATE` holds the meeting row for the transaction, and a
   * meeting already `open` returns without writing. That is an ADDED
   * precondition — the raw writes had none — and it exists because two clerks
   * pressing "Call to Order" is the ordinary case, not an edge one: without
   * it the second press moves `started_at`, re-picks the officers and opens a
   * SECOND transition on the same item. No other precondition is added; in
   * particular this does not require the meeting to be `noticed`, because
   * nothing required that before.
   *
   * ─── Foreign keys, derived values, and one bug faithfully preserved ──────
   *
   * `presidingOfficerId` is a `board_member.id` (`meeting_presiding_officer_id_fkey`)
   * and is checked against THIS MEETING'S BOARD.
   * `recordingSecretaryId` is a `person.id` with **no foreign key at all** on
   * that column, so nothing has ever checked it; it is checked here for
   * existence within the caller's town, which is ADDED. `firstItemId` is
   * checked to be an agenda item of this meeting.
   *
   * Every timestamp is the DATABASE's `now()`, not the browser's clock.
   *
   * The recording-secretary flag is SET and never cleared on a previously
   * flagged row — matching the raw write exactly. Calling a meeting to order
   * twice with two different secretaries would flag both. Preserved rather
   * than "fixed" because which row should win is a product question, and the
   * idempotency guard above makes the sequence unreachable through this
   * procedure.
   */
  callToOrder: protectedProcedure
    .use(requireBoardActor(assertCanUpdateMeeting))
    .input(
      z.object({
        meetingId: z.string().uuid(),
        boardId: z.string().uuid(),
        presidingOfficerId: z.string().uuid().nullable(),
        recordingSecretaryId: z.string().uuid().nullable(),
        firstItemId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const meeting = await lockMeetingOnAuthorizedBoard(ctx, tx, input.meetingId, "callToOrder");
        if (meeting.status === "open") {
          return { id: input.meetingId, alreadyOpen: true as const };
        }

        if (input.presidingOfficerId !== null) {
          await assertBoardMembersOnBoard(tx, meeting.board_id, [input.presidingOfficerId]);
        }
        if (input.recordingSecretaryId !== null) {
          await assertPersonInTown(tx, input.recordingSecretaryId, "callToOrder");
        }
        if (input.firstItemId !== null) {
          await assertAgendaItemsOnMeeting(tx, input.meetingId, [input.firstItemId]);
        }

        if (input.recordingSecretaryId !== null) {
          await tx.execute(sql`
            UPDATE meeting_attendance SET is_recording_secretary = true
            WHERE meeting_id = ${input.meetingId} AND person_id = ${input.recordingSecretaryId}
          `);
        }

        await tx.execute(sql`
          UPDATE meeting SET
            status = 'open'::meeting_status,
            started_at = now(),
            presiding_officer_id = ${input.presidingOfficerId},
            recording_secretary_id = ${input.recordingSecretaryId},
            current_agenda_item_id = ${input.firstItemId},
            updated_at = now()
          WHERE id = ${input.meetingId}
        `);

        if (input.firstItemId !== null) {
          await tx.execute(sql`
            UPDATE agenda_item SET status = 'active'::agenda_item_status, updated_at = now()
            WHERE id = ${input.firstItemId}
          `);
          await tx.execute(sql`
            INSERT INTO agenda_item_transition (meeting_id, agenda_item_id, town_id)
            VALUES (${input.meetingId}, ${input.firstItemId}, ${ctx.tenant.townId})
          `);
        }

        await publishLiveMeetingTopics(tx, ctx.tenant.townId, input.meetingId, [
          "meeting",
          "meeting_attendance",
          "agenda_item",
          "agenda_item_transition",
        ]);
        return { id: input.meetingId, alreadyOpen: false as const };
      });
    }),

  /**
   * `live.tsx`'s `navigateToItem` — the presiding officer moves the meeting to
   * an agenda item. Four writes today, sequential and untransacted, with no
   * authorization check of any kind.
   *
   * Guarded the same way and for the same reasons as `callToOrder` above; the
   * primary write is `meeting.current_agenda_item_id`, which is
   * `assertCanUpdateMeeting`'s own scope and is the exact accompaniment
   * `rules.ts` rule 21d cites when explaining why a transition row takes M1.
   *
   * **It does NOT mark the departed item `completed`.** `live.tsx`'s own cache
   * comment says it does ("Sets the departed item to `completed` and the
   * arrived one to `active`") and that does not reproduce — the handler
   * updates exactly one `agenda_item`, the one being navigated TO. Marking an
   * item complete is `agendaItem.markComplete`, a separate button in
   * `AgendaItemDetailPanel`. Reported to Task 5 rather than silently added
   * here; adding it would be a product change smuggled into a migration.
   *
   * **The transition close is WIDER than the client's, deliberately.** The
   * browser closed the one transition it happened to be holding in memory
   * (`currentTransition`, the open row on the current item) and only if it had
   * one. This closes every still-open transition on the meeting. In the normal
   * case that is the same single row; in the case where it is not — a client
   * that missed one, a browser closed mid-navigation — the old code leaked a
   * transition that never ends, and the item timer read off it runs forever.
   * Stated as an added clause per conventions item 1.
   */
  navigateToAgendaItem: protectedProcedure
    .use(requireBoardActor(assertCanUpdateMeeting))
    .input(
      z.object({
        meetingId: z.string().uuid(),
        boardId: z.string().uuid(),
        itemId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await lockMeetingOnAuthorizedBoard(ctx, tx, input.meetingId, "navigateToAgendaItem");
        await assertAgendaItemsOnMeeting(tx, input.meetingId, [input.itemId]);

        await tx.execute(sql`
          UPDATE agenda_item_transition SET ended_at = now()
          WHERE meeting_id = ${input.meetingId} AND ended_at IS NULL
        `);
        await tx.execute(sql`
          UPDATE agenda_item SET status = 'active'::agenda_item_status, updated_at = now()
          WHERE id = ${input.itemId}
        `);
        await tx.execute(sql`
          UPDATE meeting SET current_agenda_item_id = ${input.itemId}, updated_at = now()
          WHERE id = ${input.meetingId}
        `);
        await tx.execute(sql`
          INSERT INTO agenda_item_transition (meeting_id, agenda_item_id, town_id)
          VALUES (${input.meetingId}, ${input.itemId}, ${ctx.tenant.townId})
        `);

        await publishLiveMeetingTopics(tx, ctx.tenant.townId, input.meetingId, [
          "meeting",
          "agenda_item",
          "agenda_item_transition",
        ]);
        return { id: input.meetingId, currentAgendaItemId: input.itemId };
      });
    }),

  /**
   * `live.tsx`'s `handleMeetingEnd`, moved WHOLE — the second `meeting.status`
   * hole, and the procedure wave 5's plan singles out.
   *
   * Today it is: close the current transition; loop over every unreached item
   * writing an `agenda_item` UPDATE **and** a `future_item_queue` INSERT per
   * item, one round trip each; loop again over tabled items; then update
   * `meeting`. Unbounded, sequential, and with no transaction — so a failure
   * partway leaves items marked `deferred` with no queue row behind them,
   * which is a silently lost agenda item rather than a visible error. It is
   * also authorized by nothing at all.
   *
   * The two loops become two statements. The deferred one is a data-modifying
   * CTE — the `UPDATE … RETURNING` feeds the `INSERT … SELECT`, so an item
   * cannot be marked deferred without its queue row being written from the
   * same rows, in the same statement.
   *
   * ─── The authorization cost, stated as `callToOrder`'s doc comment states
   * its own — added in the single fix wave after wave 5's review, the one
   * composite in this file that had shipped without this section ─────────
   *
   * `requireBoardActor(assertCanUpdateMeeting)` — the same guard `callToOrder`
   * and `navigateToAgendaItem` carry, and for the same reason: `meeting.status`
   * is that rule's stated scope. **That is ONE rule for an act that writes
   * FOUR tables** (`performAdjournment` below is the shared body for both of
   * this act's origins — see its own doc comment):
   *
   *   | write                               | its own rule                                       |
   *   | ----------------------------------- | --------------------------------------------------- |
   *   | `meeting.status` etc.               | 21, `assertCanUpdateMeeting` — admin/A1/M1           |
   *   | `agenda_item_transition.ended_at`   | 21d, `assertCanUpdateAgendaItemTransition` — M1      |
   *   | `agenda_item.status = 'deferred'`   | 2a, `assertCanUpdateAgendaItemProgress` — A2 or M1   |
   *   | `future_item_queue` INSERT (x2)     | 21e, `assertCanInsertFutureItem` — M1                |
   *
   * A caller holding A1 alone (no M1, no A2) passes the guard and performs all
   * four — the identical shape `callToOrder`'s own table names, for the
   * identical reason (rule 2a's and 21d's own comments: refusing an M1
   * presiding officer who holds no A1/A2 would be the "partial adjournment,
   * worse than either answer" `rules.ts` rule 2a is organised around,
   * reached one act later here). Revisit it with rule 21, not here.
   *
   * ─── What is preserved exactly ───────────────────────────────────────────
   *
   *   - **The unreached filter**: a CHILD item (`parent_item_id IS NOT NULL`)
   *     whose status is `pending` or `active`, other than the current one.
   *     `id IS DISTINCT FROM ${current}` reproduces the client's
   *     `item.id !== currentItemId` including when there is no current item.
   *   - **The tabled filter**: a child item with a `table` motion that
   *     `passed`. It is applied INDEPENDENTLY of the deferred pass, so an item
   *     that is both unreached AND tabled produces TWO queue rows — one
   *     `source = 'deferred'`, one `source = 'tabled'`. The client does the
   *     same thing, for the same structural reason, and "fixing" it would
   *     change what `routes/meetings.$meetingId.review.tsx` lists.
   *   - **The `adjournment` JSONB's five keys**, with their current meanings.
   *
   * ─── A misattribution that lived in the READER, not this write — fixed in
   * backlog 11, decided at the wave-6 close-out ────────────────────────────
   *
   * `adjournment.adjourned_by` receives a **`person.id`** (the acting user's)
   * below, and always has, for every row this procedure has ever written.
   * `services/minutes-assembler.ts`'s `buildAdjournment` used to read it with
   * `memberName(adjData.adjourned_by)`, whose lookup is
   * `boardMemberById.get(...)` — a **`board_member.id`** map, the wrong map
   * for a `person.id`. That lookup always resolved to `null`, and
   * `minutes-formatters.ts`'s `formatAdjournmentText` treats a null
   * `adjourned_by` as "not recorded" and falls back to
   * `attendance.presiding_officer` — it does **not** print a blank. So when
   * the clerk adjourns and the chair presides, the generated legal record
   * stated that the chair adjourned the meeting, silently, with nothing
   * anywhere flagging it as wrong.
   *
   * The owner decision (backlog 11): fix the READ, not this write.
   * `buildAdjournment` now resolves `adjourned_by` with `personName`, the
   * `person.id` map the assembler already builds, instead of `memberName`.
   * Two reasons this write stays exactly as it is: every existing row already
   * holds a `person.id`, so historical records become correct with no data
   * migration; and a clerk who adjourns may have no `board_member` row at all
   * on this board, which is precisely the case that produced the wrong name —
   * a `board_member.id` could not have represented them even in principle.
   * The presiding-officer fallback in `formatAdjournmentText` is unchanged and
   * still applies when `adjourned_by` is genuinely absent (a row from before
   * this field existed, or a method that never records one).
   *
   * `adjourned_by_name` (the presiding officer's name, a different person from
   * `adjourned_by` whenever the clerk is not the chair) is written below and
   * read by nothing at all — the formatter independently recomputes the same
   * value as its own fallback instead. Left as-is; not part of this fix.
   *
   * ─── A second cache comment that does not reproduce ──────────────────────
   *
   * The cache comment that sat on `live.tsx`'s `handleMeetingEnd` — a function
   * wave 5, Task 5 removed from that file when this procedure replaced it — said
   * adjournment "marks the remaining items `completed` and moves tabled ones
   * to `future_agenda_item`." Neither half is what this procedure does: the
   * unreached items are marked `deferred` (not `completed`), and both the
   * deferred and the tabled rows are written to `future_item_queue` (not
   * `future_agenda_item`) — see the two statements above. `live.tsx` is
   * Task 5's file, not edited here; recorded per conventions item 1.
   *
   * ─── Idempotent, because two devices race to call it ─────────────────────
   *
   * ~~The adjourn-on-motion path is a `useEffect` that fires on the motion row
   * arriving over the subscription, deduplicated only by an in-memory
   * `useRef<Set>`… Task 5 still owns the client-side design.~~ — **Task 5
   * decided it, and the answer removed the effect rather than deduplicating
   * it.** Adjournment has two origins now and neither observes anything: the
   * "without objection" declaration calls THIS procedure, and a passed motion
   * to adjourn is performed inside `voteRecord.recordForMotion`'s own
   * transaction (`performAdjournment` below is the shared body, so the two can
   * never diverge). `SELECT … FOR UPDATE` plus the early return for a meeting
   * already `adjourned` is still the floor, and it is what makes two
   * concurrent callers of either origin produce one adjournment.
   */
  adjourn: protectedProcedure
    .use(requireBoardActor(assertCanUpdateMeeting))
    .input(
      z.object({
        meetingId: z.string().uuid(),
        boardId: z.string().uuid(),
        method: z.enum(["motion", "without_objection"]),
        adjournMotionId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const meeting = await lockMeetingOnAuthorizedBoard(ctx, tx, input.meetingId, "adjourn");
        if (meeting.status === "adjourned") {
          return { id: input.meetingId, alreadyAdjourned: true as const, deferred: 0, tabled: 0 };
        }
        if (input.adjournMotionId !== null) {
          await assertMotionsOnMeeting(tx, input.meetingId, [input.adjournMotionId]);
        }

        const outcome = await performAdjournment(tx, {
          townId: ctx.tenant.townId,
          personId: ctx.tenant.personId,
          meetingId: input.meetingId,
          meeting,
          method: input.method,
          adjournMotionId: input.adjournMotionId,
        });

        await publishLiveMeetingTopics(tx, ctx.tenant.townId, input.meetingId, [
          "meeting",
          "agenda_item",
          "agenda_item_transition",
        ]);
        return {
          id: input.meetingId,
          alreadyAdjourned: false as const,
          deferred: outcome.deferred,
          tabled: outcome.tabled,
        };
      });
    }),
});

/** The live-run columns `performAdjournment` needs off an already-locked meeting row. */
export interface LockedMeetingRow {
  board_id: string;
  status: string;
  current_agenda_item_id: string | null;
  presiding_officer_id: string | null;
}

/**
 * Every row-write an adjournment performs, on a meeting row the CALLER has
 * already locked.
 *
 * Extracted in Phase E wave 5, Task 5 because adjournment has two origins and
 * only one of them is a button. The other is a passed motion to adjourn, which
 * `voteRecord.recordForMotion` now performs inside the transaction that
 * decides the motion's outcome — see that procedure's doc comment for why the
 * reactive `useEffect` in `live.tsx` could not stay where it was. Both callers
 * must see the identical writes, and two copies of a data-modifying CTE is how
 * they stop being identical.
 *
 * **The lock is the caller's, deliberately.** Both callers hold the meeting row
 * `FOR UPDATE` before they get here — `adjourn` through
 * `lockMeetingOnAuthorizedBoard`, `recordForMotion` through the same function —
 * and both read `status` off that locked row to decide whether to call at all.
 * Putting the lock inside would either take it twice or leave the caller's
 * status check racing the write it guards.
 *
 * It does NOT publish. `meeting.adjourn`'s own resolver does, and so does
 * `recordForMotion`, because `trpc/__tests__/router-wiring.test.ts`'s publish
 * inventory attributes a helper's writes to the mutations that NAME it but
 * reads `publishes` only one level deep — a publish buried here would be
 * invisible to it and the inventory would start failing for the wrong reason.
 */
export async function performAdjournment(
  tx: TenantTx,
  args: {
    townId: string;
    personId: string;
    meetingId: string;
    meeting: LockedMeetingRow;
    method: "motion" | "without_objection";
    adjournMotionId: string | null;
  },
): Promise<{ deferred: number; tabled: number }> {
  const { townId, personId, meetingId, meeting, method, adjournMotionId } = args;

  await tx.execute(sql`
    UPDATE agenda_item_transition SET ended_at = now()
    WHERE meeting_id = ${meetingId} AND ended_at IS NULL
  `);

  const deferred = toRows<{ id: string }>(
    await tx.execute(sql`
      WITH unreached AS (
        UPDATE agenda_item SET status = 'deferred'::agenda_item_status, updated_at = now()
        WHERE meeting_id = ${meetingId}
          AND parent_item_id IS NOT NULL
          AND status IN ('pending', 'active')
          AND id IS DISTINCT FROM ${meeting.current_agenda_item_id}
        RETURNING id, title, description
      )
      INSERT INTO future_item_queue (
        board_id, town_id, source_meeting_id, source_agenda_item_id,
        title, description, source, status
      )
      SELECT ${meeting.board_id}, ${townId}, ${meetingId}, u.id,
             u.title, u.description, 'deferred', 'pending'
      FROM unreached u
      RETURNING id
    `),
    (message) => new Error(`meeting.performAdjournment: ${message}`),
  );

  const tabled = toRows<{ id: string }>(
    await tx.execute(sql`
      INSERT INTO future_item_queue (
        board_id, town_id, source_meeting_id, source_agenda_item_id,
        title, description, source, status
      )
      SELECT ${meeting.board_id}, ${townId}, ${meetingId}, ai.id,
             ai.title, ai.description, 'tabled', 'pending'
      FROM agenda_item ai
      WHERE ai.meeting_id = ${meetingId}
        AND ai.parent_item_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM motion m
          WHERE m.agenda_item_id = ai.id
            AND m.motion_type = 'table'
            AND m.status = 'passed'
        )
      RETURNING id
    `),
    (message) => new Error(`meeting.performAdjournment: ${message}`),
  );

  const adjournedByName = await presidingOfficerName(tx, meeting.presiding_officer_id);
  await tx.execute(sql`
    UPDATE meeting SET
      status = 'adjourned'::meeting_status,
      ended_at = now(),
      current_agenda_item_id = NULL,
      adjournment = jsonb_build_object(
        'method', ${method}::text,
        'adjourned_by', ${personId}::text,
        'adjourned_by_name', ${adjournedByName}::text,
        'motion_id', ${adjournMotionId}::text,
        'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      updated_at = now()
    WHERE id = ${meetingId}
  `);

  return { deferred: deferred.length, tabled: tabled.length };
}

/**
 * Read a meeting's live-run columns, LOCK the row, and refuse unless it sits
 * on the board the guard authorized.
 *
 * `FOR UPDATE` is what makes the three composite procedures above safe against
 * the multi-device race `live.tsx`'s reactive `useEffect`s create: two clerks
 * whose screens both decide to adjourn serialize here rather than both
 * proceeding on a stale `status`.
 *
 * `board-derivation.ts`'s `assertMeetingOnAuthorizedBoard` is the same check
 * without the lock and without the extra columns; it is used where a procedure
 * needs the board and nothing else. This is not a second copy of the mismatch
 * defence — both end in the same `assertMatchesAuthorizedBoard` call.
 */
export async function lockMeetingOnAuthorizedBoard(
  ctx: { authorizedBoardId?: string },
  tx: TenantTx,
  meetingId: string,
  label: string,
): Promise<LockedMeetingRow> {
  const rows = toRows<LockedMeetingRow>(
    await tx.execute(sql`
      SELECT board_id, status::text AS status, current_agenda_item_id, presiding_officer_id
      FROM meeting WHERE id = ${meetingId}
      FOR UPDATE
    `),
    (message) => new Error(`meeting.${label}: ${message}`),
  );
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  assertMatchesAuthorizedBoard(ctx, row.board_id);
  return row;
}

/**
 * The name `live.tsx` puts in `adjournment.adjourned_by_name`: the presiding
 * officer's, or the literal `"Chair"` when there is none.
 *
 * `presiding_officer_id` is a `board_member.id`
 * (`meeting_presiding_officer_id_fkey`), so this is one join to `person`. The
 * `"Chair"` fallback is the client's (`presidingOfficerName`'s
 * `?? "Chair"`), carried over rather than replaced with `null`, because the
 * string is what any existing row already holds.
 */
async function presidingOfficerName(
  tx: TenantTx,
  presidingOfficerId: string | null,
): Promise<string> {
  if (!presidingOfficerId) return "Chair";
  const rows = toRows<{ name: string }>(
    await tx.execute(sql`
      SELECT p.name FROM board_member bm
      JOIN person p ON p.id = bm.person_id
      WHERE bm.id = ${presidingOfficerId}
    `),
    (message) => new Error(`meeting.presidingOfficerName: ${message}`),
  );
  return rows[0]?.name ?? "Chair";
}

/**
 * Confirm a `person` row exists in the caller's own town.
 *
 * `meeting.recording_secretary_id` has NO foreign key constraint on it
 * (`grep -n "recording_secretary_id_fkey" drizzle/0000_baseline.sql` is
 * empty), so nothing in the database has ever checked that value — this is an
 * ADDED check, and it is the cheap half of conventions item 3 rather than the
 * FK-bypass half: there is no constraint to bypass, only a column that renders
 * as a missing name on every screen if it names nothing.
 */
async function assertPersonInTown(tx: TenantTx, personId: string, label: string): Promise<void> {
  const rows = toRows<{ id: string }>(
    await tx.execute(sql`SELECT id FROM person WHERE id = ${personId}`),
    (message) => new Error(`meeting.${label}: ${message}`),
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
}

/**
 * Announce several topics for one meeting, from inside the write's own
 * transaction.
 *
 * The three composite procedures above each write three or four of the eight
 * `LIVE_MEETING_TOPICS` in one act, and they publish EVERY topic they can
 * touch rather than only the ones a particular call actually wrote —
 * `callToOrder` announces `meeting_attendance` even when no recording
 * secretary was named, and `agenda_item` even when the meeting has no items.
 * That is deliberate: an event carries no payload and means only "refetch
 * this", so an extra one costs one query on the other device and is never
 * wrong, while a MISSING one is a panel that stops updating with no error
 * anywhere — the failure `realtime/events.ts` is organised around. Conditional
 * publishing would put a branch on the side of that trade where being wrong is
 * silent.
 */
export async function publishLiveMeetingTopics(
  tx: TenantTx,
  townId: string,
  meetingId: string,
  topics: readonly LiveMeetingTopic[],
): Promise<void> {
  // Sequential, not `Promise.all`: `tx` is one pooled connection inside an
  // open transaction, and postgres.js has no pipelining there — issuing these
  // concurrently would interleave statements on a connection that expects one
  // at a time.
  for (const topic of topics) {
    await publishRealtimeEvent(tx, { townId, meetingId, topic });
  }
}
