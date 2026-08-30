/**
 * Board reads and writes.
 *
 * No permission guard on the reads (`detail`, `stats`, `recentMeetings`,
 * `list`, `listActive`), deliberately: `board` carried a pure tenancy policy
 * and nothing else, so any authenticated member of a town may read that
 * town's boards. `protectedProcedure` + `ctx.withTenant` is exactly that
 * rule. `copyNoticeTemplate`, `insert` and `update` are the exceptions —
 * they are writes, and get the matching admin gate (`assertCanUpdateBoard` or
 * `assertCanInsertBoard`), `.use(requireActor(...))` before `.input()` per
 * conventions item 2.
 *
 * A board that does not exist, or belongs to another town, answers NOT_FOUND
 * from every procedure here that names a specific board — `detail`, `stats`,
 * `recentMeetings`, `update`, and `copyNoticeTemplate`'s two board ids. That
 * is a deliberate, and enforced, convention: `detail`'s query already had to
 * answer this question (a missing row), but `stats`'s correlated subqueries
 * and `recentMeetings`'s filtered scan do not — they degrade to `{0,0}` and
 * `[]` for an id that never existed just as readily as for a real board with
 * no members or meetings yet. A caller of `stats` alone (no `detail` in the
 * same screen) would render a convincing, empty-but-real looking board for an
 * id that is not there. `assertBoardExists` below closes that gap for the two
 * counting procedures explicitly, and `copyNoticeTemplate` reuses it for its
 * source board — see that procedure's own doc comment for why its target
 * board needs no separate call to it. Exported (Task 1, wave 2) so
 * `agenda-template.ts` can reuse the identical check for ITS board-scoped
 * reads/writes rather than duplicating the query.
 *
 * ─── Task 1, wave 2 — the four markers wave 1 left ────────────────────────
 *
 * `listActive` below answers one of the four `TODO(phase-e-wave-2)` markers
 * wave 1 left naming procedures this task owes: `board.byTown`
 * (`settings.town.tsx`) and `board.listByTown` (`StaffAccountFlow.tsx`)
 * become `listActive`. See its own doc comment for why. The other three
 * markers — `agendaTemplate.countForBoard` (`boards.$boardId.tsx`), the
 * write rules this task also owes (`assertCanInsert/Update/DeleteAgendaTemplate`,
 * living in the new `agenda-template.ts` router), and `boardMember.countByTown`
 * (`ProgressChecklist.tsx`) — are answered elsewhere.
 *
 * `boardMember.countByTown` WAS answered here, temporarily, as `memberCount`
 * (wave 2, Task 1) — no `boardMember` router existed yet, and creating one
 * for a single count ahead of any write landing there would have been a
 * router Task 3 then had to either reuse awkwardly or abandon. Task 3 has
 * now shipped that router's real write surface
 * (`packages/api/src/trpc/routers/board-member.ts` — `AddMemberDialog` and
 * its siblings), so `memberCount` moved there — it counts `board_member`
 * rows, which is that router's noun by conventions item 1, not `board`'s.
 * `ProgressChecklist.tsx` now reads `trpc.boardMember.memberCount`.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireActor } from "../trpc.js";
import { assertCanInsertBoard, assertCanUpdateBoard } from "../authorization/rules.js";
import { toRows } from "../../db/rows.js";
import type { TenantTx } from "../../db/with-tenant.js";

/**
 * Confirm the board exists in the caller's own town before answering a
 * question ABOUT it. Relies on RLS the same way `detail` does: the row is
 * invisible, not merely filtered, if it belongs to another town.
 *
 * Exported so `agenda-template.ts` can run the identical check for its own
 * board-scoped procedures — see this file's header.
 */
export async function assertBoardExists(tx: TenantTx, boardId: string): Promise<void> {
  const rows = toRows<{ id: string }>(
    await tx.execute(sql`SELECT id FROM board WHERE id = ${boardId}`),
    (message) => new Error(`board.assertBoardExists: ${message}`),
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
}

/**
 * Is this the `board_name_unique_per_town` collision, and not some other
 * write error? Checked by constraint name, not just `23505` — see
 * `town.ts`'s `isSubdomainCollision`, whose reasoning and depth-limited
 * `cause`-chain walk this mirrors exactly (Drizzle wraps a driver failure in
 * `DrizzleQueryError` and keeps the original on `cause`).
 */
function isBoardNameCollision(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const e = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
    if (e.code === "23505") {
      const constraint = e.constraint_name ?? e.constraint;
      return constraint === "board_name_unique_per_town" || constraint === undefined;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export const boardRouter = router({
  /**
   * Every column `packages/web/src/routes/boards.$boardId.tsx` reads off a
   * board row, once Task 4 replaces its `select("*")` with this procedure —
   * checked against the `const b = { ... }` mapping (Overview tab) and the
   * `<NoticeTemplateEditor>` / `<MinutesWorkflowEditor>` props built in the
   * `activeTab === "settings"` block. Cited by symbol and tab, not line
   * number: Task 4 already rewrote this screen once since this comment was
   * first written, which is exactly why a line-range citation does not
   * survive — see conventions item 1. Not `SELECT *`: an explicit list means
   * a schema change that removes a column this screen depends on fails here,
   * at the query, instead of silently producing `undefined` deep inside a
   * settings form.
   *
   * `board_type` (wave 2, Task 2) — no longer excluded. Added back the day
   * something reads it, exactly as this comment used to promise:
   * `routes/boards.$boardId.templates.tsx`'s auto-create effect needs it to
   * pick which of `getDefaultTemplateSections`'s four fixed outputs to seed a
   * brand-new board with, and that screen now reads its board row through
   * this procedure rather than its own separate `select("id, name,
   * board_type")`.
   */
  detail: protectedProcedure
    .input(z.object({ boardId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.withTenant(async (tx) =>
        toRows<{
          id: string;
          name: string;
          board_type: string;
          elected_or_appointed: string | null;
          member_count: number | null;
          election_method: string | null;
          officer_election_method: string | null;
          is_governing_board: boolean;
          meeting_formality_override: string | null;
          minutes_style_override: string | null;
          quorum_type: string | null;
          quorum_value: number | null;
          motion_display_format: string | null;
          archived_at: string | null;
          created_at: string;
          notice_template_blocks: unknown | null;
          minutes_consent_agenda: boolean;
          minutes_requires_second: boolean;
          r4_board_member_default: boolean;
          audio_retention_policy_override: string | null;
          auto_publish_on_approval_override: boolean | null;
        }>(
          await tx.execute(sql`
            SELECT
              id, name, board_type, elected_or_appointed, member_count, election_method,
              officer_election_method, is_governing_board, meeting_formality_override,
              minutes_style_override, quorum_type, quorum_value, motion_display_format,
              archived_at, created_at, notice_template_blocks, minutes_consent_agenda,
              minutes_requires_second, r4_board_member_default,
              audio_retention_policy_override, auto_publish_on_approval_override
            FROM board WHERE id = ${input.boardId}
          `),
          (message) => new Error(`board.detail: ${message}`),
        ),
      );
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  stats: protectedProcedure
    .input(z.object({ boardId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertBoardExists(tx, input.boardId);
        const rows = toRows<{ active_members: number; meetings: number }>(
          await tx.execute(sql`
            SELECT
              (SELECT count(*)::int FROM board_member
                 WHERE board_id = ${input.boardId} AND status = 'active') AS active_members,
              (SELECT count(*)::int FROM meeting
                 WHERE board_id = ${input.boardId}) AS meetings
          `),
          (message) => new Error(`board.stats: ${message}`),
        );
        // The ::int casts above are load-bearing, not decorative: postgres.js
        // returns count(*) as the STRING "0", not the number 0. Dropping them
        // renders correctly (JS coerces "2" in a template) and passes a loose
        // equality check, which is exactly why board.stats.test.ts asserts
        // `typeof` on both fields, not just their values.
        return rows[0] ?? { active_members: 0, meetings: 0 };
      });
    }),

  /**
   * The query behind the "Meetings" tab (`activeTab === "meetings"`) in
   * `packages/web/src/routes/boards.$boardId.tsx`: excludes
   * `status = 'cancelled'`, ordered by `scheduled_date` descending, capped at
   * 5. `scheduled_time` is not in the SELECT list — the screen never renders
   * it — but it stays in the ORDER BY: `scheduled_date` is a DATE, so two
   * meetings on the same day would otherwise come back in an arbitrary,
   * unstable order. `id` breaks any remaining tie deterministically. Cited by
   * tab, not line number — see conventions item 1.
   */
  recentMeetings: protectedProcedure
    .input(
      z.object({ boardId: z.string().uuid(), limit: z.number().int().min(1).max(50).default(5) }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertBoardExists(tx, input.boardId);
        return toRows<{ id: string; title: string; scheduled_date: string; status: string }>(
          await tx.execute(sql`
            SELECT id, title, scheduled_date, status
            FROM meeting
            WHERE board_id = ${input.boardId} AND status != 'cancelled'
            ORDER BY scheduled_date DESC, scheduled_time DESC NULLS LAST, id
            LIMIT ${input.limit}
          `),
          (message) => new Error(`board.recentMeetings: ${message}`),
        );
      });
    }),

  /**
   * `settings.meeting-notices.tsx`'s read: every board in the caller's town,
   * with just enough to render the "configured / not configured" list and
   * drive the "copy from board" picker. Not `detail`'s columns — that
   * procedure is keyed to a single board (`boardId` input) and this one is
   * keyed to the town, so it gets its own, narrower column list rather than
   * reusing `detail`'s SQL for a town-wide scan.
   *
   * No `archived_at IS NULL` filter: the Supabase query this replaces
   * (`settings.meeting-notices.tsx`'s own `useQuery`, before this task) had
   * none either — see conventions' "the query you are replacing is a
   * specification" rule. An archived board still needs its notice template
   * visible to whoever is deciding what to copy from.
   *
   * `member_count` added in Task 5 of wave 1, for `ProgressChecklist`'s
   * "board members added (N of M seats)" and "notice templates configured"
   * checklist rows — both are town-wide sums/counts over exactly the rows
   * this procedure already scans, so extending the existing SELECT is the
   * one-column change; a second procedure would just re-run the same query.
   * Same no-archived-filter reasoning applies: `ProgressChecklist`'s own
   * Supabase reads before this task summed `member_count` and counted
   * `notice_template_blocks` over EVERY board in the town, archived or not,
   * so this migration is not the place to newly exclude them (that would be
   * a behavior change smuggled into a read migration, not a port of one).
   *
   * `elected_or_appointed`, `archived_at`, `is_governing_board` and
   * `active_member_count` added in wave 2, Task 2, for `routes/boards.tsx` —
   * the `/boards` list page, this procedure's THIRD caller. That screen needs
   * exactly this shape: every board (its own "show archived" toggle is
   * client-side, over rows this same unfiltered scan already returns) with
   * the columns that drive its Type/Status table cells, `is_governing_board`
   * for its own client-side sort (see "Ordering" below), and a per-board
   * count of currently ACTIVE members for the "N / M" Members cell — checked
   * against that route's `boards.map((board) => { ... })` block.
   * `active_member_count` is a correlated subquery, the identical shape
   * `stats.active_members` already runs for one board at a time, run here
   * once per row in the town-wide scan instead of firing N separate
   * `board.stats` calls from the list screen. Every column a given caller
   * does not read is invisible to it — see `test/trpc.ts`'s own "the gap runs
   * one way" note, already quoted above for `member_count`; the same
   * reasoning now covers four extra columns instead of one.
   *
   * Ordering stays `name` only, unchanged from before this task: the two
   * existing callers never asked for a different order, and `boards.tsx`
   * needs `is_governing_board DESC, name ASC` — sorted at the call site
   * (conventions: "sort at the call site rather than adding a second
   * procedure", the same choice `listActive`'s own doc comment makes for
   * `StaffAccountFlow.tsx`) rather than changing this procedure's ORDER BY
   * out from under its other two callers.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.withTenant(async (tx) =>
      toRows<{
        id: string;
        name: string;
        notice_template_blocks: unknown | null;
        member_count: number | null;
        elected_or_appointed: string | null;
        archived_at: string | null;
        is_governing_board: boolean;
        active_member_count: number;
      }>(
        await tx.execute(sql`
          SELECT
            id, name, notice_template_blocks, member_count, elected_or_appointed, archived_at,
            is_governing_board,
            (SELECT count(*)::int FROM board_member
               WHERE board_id = board.id AND status = 'active') AS active_member_count
          FROM board
          ORDER BY name
        `),
        (message) => new Error(`board.list: ${message}`),
      ),
    );
  }),

  /**
   * Every active (non-archived) board in the caller's town, for a picker that
   * must never offer an archived board as a place to schedule a meeting or
   * seat a staff member — the hazard wave 1 named and refused to paper over
   * (see this file's header and `phase-e-conventions.md`'s Known Gaps for
   * `home.tsx` and `StaffAccountFlow.tsx`).
   *
   * Deliberately one procedure serving BOTH markers wave 1 left rather than
   * two near-identical scans:
   *
   *   - `settings.town.tsx`'s "Governing Board" and "Boards & Committees"
   *     sections (marker `board.byTown`) read `id`, `name`, `member_count`,
   *     `is_governing_board`, `election_method`, `officer_election_method` —
   *     checked against that route's `boards.find(...)` /
   *     `boards.map(...)` blocks — and order `is_governing_board DESC, name
   *     ASC` so the governing board sorts first;
   *   - `StaffAccountFlow.tsx`'s board-specific-template picker (marker
   *     `board.listByTown`) reads only `id`/`name`, ordered by name. The four
   *     extra columns are invisible to a consumer that does not read them —
   *     see `test/trpc.ts`'s "the gap runs one way" note, quoted in `list`'s
   *     own comment above — and the governing-board-first order is a strict
   *     RE-ordering only when a town's governing board is not already first
   *     alphabetically; harmless for a board-selection list, and worth a
   *     second procedure only if a future caller needs strict alphabetical
   *     order AND the archived filter AND cannot tolerate the extra columns,
   *     which no current caller does.
   *
   * Not `list` with a parameter: `list` is read by
   * `settings.meeting-notices.tsx` and `ProgressChecklist.tsx`, both of which
   * NEED archived boards visible (see `list`'s own doc comment) — a shared
   * procedure would force one shape or the other to lose columns it needs, or
   * force every caller to pass a flag whose default some caller would
   * inevitably get wrong. Two procedures, two answers, matching the two
   * different questions "every board" and "every board someone could still be
   * assigned to" actually ask.
   */
  listActive: protectedProcedure.query(async ({ ctx }) => {
    return ctx.withTenant(async (tx) =>
      toRows<{
        id: string;
        name: string;
        member_count: number | null;
        is_governing_board: boolean;
        election_method: string | null;
        officer_election_method: string | null;
      }>(
        await tx.execute(sql`
          SELECT id, name, member_count, is_governing_board, election_method,
            officer_election_method
          FROM board
          WHERE archived_at IS NULL
          ORDER BY is_governing_board DESC, name ASC
        `),
        (message) => new Error(`board.listActive: ${message}`),
      ),
    );
  }),

  /**
   * `AddBoardDialog`'s write: create a new board.
   *
   * `board_type`, `district_based`, `staggered_terms` and `is_governing_board`
   * are not in the input schema below and are not set explicitly in the
   * `INSERT` either — the dialog never offers a control for any of them and
   * always sends the column's own DB default (`'other'`, `false`, `false`,
   * `false`), so omitting them and letting the default apply IS sending what
   * the dialog sends, with one fewer literal to keep in sync with the schema.
   * `officer_election_method` is different: it has NO db default (nullable,
   * defaults to `NULL`) but the dialog always sends `'vote_of_board'`, so that
   * one IS set explicitly below — omitting it would silently change the
   * column from always-`'vote_of_board'` to always-`NULL`, a real behavior
   * change. `seat_titles` — a form field the dialog collects but its own
   * `mutationFn` never actually sends (checked directly against
   * `AddBoardDialog.tsx`'s insert payload) — is left out here too, matching
   * what ships today rather than fixing a pre-existing gap this task was not
   * asked to close.
   *
   * `id` is database-generated, not client-supplied. Returns just enough for
   * the dialog to navigate to the new board's detail page.
   */
  insert: protectedProcedure
    .use(requireActor(assertCanInsertBoard))
    .input(
      z.object({
        name: z.string().min(2, "Name must be at least 2 characters").max(100),
        elected_or_appointed: z.enum(["elected", "appointed"]),
        member_count: z.number().int().min(0).max(25),
        election_method: z.enum(["at_large", "role_titled"]),
        meeting_formality_override: z.enum(["informal", "semi_formal", "formal"]).nullable(),
        minutes_style_override: z.enum(["action", "summary", "narrative"]).nullable(),
        quorum_type: z.enum(["simple_majority", "two_thirds", "three_quarters", "fixed_number"]),
        quorum_value: z.number().int().min(1).max(25).nullable(),
        motion_display_format: z.enum(["block_format", "inline_narrative"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const rows = await ctx.withTenant(async (tx) =>
          toRows<{ id: string; name: string }>(
            await tx.execute(sql`
              INSERT INTO board (
                town_id, name, elected_or_appointed, member_count, election_method,
                officer_election_method, meeting_formality_override, minutes_style_override,
                quorum_type, quorum_value, motion_display_format
              )
              VALUES (
                ${ctx.tenant.townId}, ${input.name}, ${input.elected_or_appointed},
                ${input.member_count}, ${input.election_method}, 'vote_of_board',
                ${input.meeting_formality_override}::meeting_formality,
                ${input.minutes_style_override}::minutes_style,
                ${input.quorum_type}, ${input.quorum_value}, ${input.motion_display_format}
              )
              RETURNING id, name
            `),
            (message) => new Error(`board.insert: ${message}`),
          ),
        );
        return rows[0]!;
      } catch (err) {
        if (isBoardNameCollision(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A board named "${input.name}" already exists in your town.`,
            cause: err,
          });
        }
        throw err;
      }
    }),

  /**
   * `EditBoardDialog`'s write: the same fields `insert` accepts, minus the
   * ones that are set once at creation and never re-sent by that dialog
   * (`board_type`, `officer_election_method`, `district_based`,
   * `staggered_terms`, `is_governing_board` — checked against
   * `EditBoardDialog.tsx`'s own update payload, which omits every one of
   * them).
   *
   * NOT_FOUND for a `boardId` naming no row, or a row in another town —
   * `board_tenant_isolation` makes the `UPDATE` affect zero rows for either
   * case identically (conventions item 3), the same pattern `person.update`
   * uses. No separate `assertBoardExists` call: unlike `insert`'s FK-free
   * write, this procedure's only board reference IS the `UPDATE ... WHERE id
   * = ...` itself, and `RETURNING` already answers the existence question —
   * a second check would just repeat the same query.
   */
  update: protectedProcedure
    .use(requireActor(assertCanUpdateBoard))
    .input(
      z.object({
        boardId: z.string().uuid(),
        name: z.string().min(2, "Name must be at least 2 characters").max(100),
        elected_or_appointed: z.enum(["elected", "appointed"]),
        member_count: z.number().int().min(0).max(25),
        election_method: z.enum(["at_large", "role_titled"]),
        meeting_formality_override: z.enum(["informal", "semi_formal", "formal"]).nullable(),
        minutes_style_override: z.enum(["action", "summary", "narrative"]).nullable(),
        quorum_type: z.enum(["simple_majority", "two_thirds", "three_quarters", "fixed_number"]),
        quorum_value: z.number().int().min(1).max(25).nullable(),
        motion_display_format: z.enum(["block_format", "inline_narrative"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const rows = await ctx.withTenant(async (tx) =>
          toRows<{ id: string; name: string }>(
            await tx.execute(sql`
              UPDATE board SET
                name = ${input.name},
                elected_or_appointed = ${input.elected_or_appointed},
                member_count = ${input.member_count},
                election_method = ${input.election_method},
                meeting_formality_override = ${input.meeting_formality_override}::meeting_formality,
                minutes_style_override = ${input.minutes_style_override}::minutes_style,
                quorum_type = ${input.quorum_type},
                quorum_value = ${input.quorum_value},
                motion_display_format = ${input.motion_display_format}
              WHERE id = ${input.boardId}
              RETURNING id, name
            `),
            (message) => new Error(`board.update: ${message}`),
          ),
        );
        const row = rows[0];
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
        return row;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        if (isBoardNameCollision(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A board named "${input.name}" already exists in your town.`,
            cause: err,
          });
        }
        throw err;
      }
    }),

  /**
   * `settings.meeting-notices.tsx`'s "Copy from board" write: replace
   * `targetBoardId`'s notice template with `sourceBoardId`'s, in one
   * statement, entirely server-side.
   *
   * The client-side version this replaces sent the ALREADY-FETCHED source
   * board's `notice_template_blocks` back up as the mutation's payload — a
   * client-trusted copy of server data, and (per conventions item 3) a
   * tenant-scoped read the client had no business re-asserting. Reading the
   * source INSIDE the same `UPDATE ... SET x = (SELECT ...)` statement, under
   * `ctx.withTenant`, means RLS scopes both halves of the copy identically to
   * the caller's own town — there is no window for a client to substitute a
   * different board's blocks than the one RLS would show it, and no round
   * trip carrying a potentially large block array back up to the server.
   *
   * `assertBoardExists` runs for `sourceBoardId` only. A `sourceBoardId`
   * naming no row (or another town's row, invisible under RLS) makes the
   * subquery answer NULL, which would silently blank the target's template
   * instead of failing — exactly the FK-bypasses-RLS-shaped silent failure
   * conventions item 3 warns about, for a subquery rather than a foreign key.
   * `targetBoardId` needs no separate check: the `UPDATE ... WHERE id =
   * ${targetBoardId}` itself returns zero rows for a target that does not
   * exist or belongs to another town (RLS again), and `RETURNING` catches
   * that directly below — a second `assertBoardExists` call would just repeat
   * the same query the `UPDATE` already runs.
   */
  copyNoticeTemplate: protectedProcedure
    .use(requireActor(assertCanUpdateBoard))
    .input(
      z.object({
        sourceBoardId: z.string().uuid(),
        targetBoardId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertBoardExists(tx, input.sourceBoardId);
        const rows = toRows<{ id: string; notice_template_blocks: unknown | null }>(
          await tx.execute(sql`
            UPDATE board
            SET notice_template_blocks = (
              SELECT notice_template_blocks FROM board WHERE id = ${input.sourceBoardId}
            )
            WHERE id = ${input.targetBoardId}
            RETURNING id, notice_template_blocks
          `),
          (message) => new Error(`board.copyNoticeTemplate: ${message}`),
        );
        const row = rows[0];
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
        return row;
      });
    }),
});
