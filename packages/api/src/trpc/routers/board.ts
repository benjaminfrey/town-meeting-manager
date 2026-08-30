/**
 * Board reads, and — as of Task 4, wave 1 — the first two board writes.
 *
 * No permission guard on the three original reads (`detail`, `stats`,
 * `recentMeetings`) or on `list` below, deliberately: `board` carried a pure
 * tenancy policy and nothing else, so any authenticated member of a town may
 * read that town's boards. `protectedProcedure` + `ctx.withTenant` is exactly
 * that rule. `copyNoticeTemplate` is the exception — it is a write, and gets
 * the matching admin gate, `assertCanUpdateBoard`, `.use(requireActor(...))`
 * before `.input()` per conventions item 2.
 *
 * A board that does not exist, or belongs to another town, answers NOT_FOUND
 * from every procedure here that names a specific board — `detail`, `stats`,
 * `recentMeetings`, and `copyNoticeTemplate`'s two board ids. That is a
 * deliberate, and enforced, convention: `detail`'s query already had to
 * answer this question (a missing row), but `stats`'s correlated subqueries
 * and `recentMeetings`'s filtered scan do not — they degrade to `{0,0}` and
 * `[]` for an id that never existed just as readily as for a real board with
 * no members or meetings yet. A caller of `stats` alone (no `detail` in the
 * same screen) would render a convincing, empty-but-real looking board for an
 * id that is not there. `assertBoardExists` below closes that gap for the two
 * counting procedures explicitly, and `copyNoticeTemplate` reuses it for its
 * source board — see that procedure's own doc comment for why its target
 * board needs no separate call to it.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireActor } from "../trpc.js";
import { assertCanUpdateBoard } from "../authorization/rules.js";
import { toRows } from "../../db/rows.js";
import type { TenantTx } from "../../db/with-tenant.js";

/**
 * Confirm the board exists in the caller's own town before answering a
 * question ABOUT it. Relies on RLS the same way `detail` does: the row is
 * invisible, not merely filtered, if it belongs to another town.
 */
async function assertBoardExists(tx: TenantTx, boardId: string): Promise<void> {
  const rows = toRows<{ id: string }>(
    await tx.execute(sql`SELECT id FROM board WHERE id = ${boardId}`),
    (message) => new Error(`board.assertBoardExists: ${message}`),
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
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
   * `board_type` is deliberately excluded: it is a real column, but nothing
   * in that screen reads it today. Add it back the day something does.
   */
  detail: protectedProcedure
    .input(z.object({ boardId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.withTenant(async (tx) =>
        toRows<{
          id: string;
          name: string;
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
              id, name, elected_or_appointed, member_count, election_method,
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
   * drive the "copy from board" picker. Not `detail`'s 20 columns — that
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
   * `settings.meeting-notices.tsx`, the other caller, ignores the extra
   * column — an extra field a handler returns is invisible to a typed
   * consumer that does not read it (see `test/trpc.ts`'s own "the gap runs
   * one way" note).
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.withTenant(async (tx) =>
      toRows<{
        id: string;
        name: string;
        notice_template_blocks: unknown | null;
        member_count: number | null;
      }>(
        await tx.execute(sql`
          SELECT id, name, notice_template_blocks, member_count
          FROM board
          ORDER BY name
        `),
        (message) => new Error(`board.list: ${message}`),
      ),
    );
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
