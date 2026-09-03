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
 * two, not this task.
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
        board_id: string;
        board_name: string;
      }>(
        await tx.execute(sql`
          SELECT m.id, m.title, m.status, m.meeting_type, m.scheduled_date, m.scheduled_time,
                 m.board_id, b.name AS board_name
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
          started_at: string | null;
          ended_at: string | null;
        }>(
          await tx.execute(sql`
            SELECT id, board_id, title, status, meeting_type, agenda_status, scheduled_date,
                   scheduled_time, location, presiding_officer_id, recording_secretary_id,
                   started_at, ended_at
            FROM meeting WHERE id = ${input.meetingId}
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
        return { id: rows[0]!.id };
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
        return { id: input.meetingId, status: input.status };
      });
    }),
});
