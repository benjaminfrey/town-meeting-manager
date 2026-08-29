/**
 * Board reads.
 *
 * No permission guard, deliberately: `board` carried a pure tenancy policy and
 * nothing else, so any authenticated member of a town may read that town's
 * boards. `protectedProcedure` + `ctx.withTenant` is exactly that rule. Writes
 * are admin-gated (`assertCanUpdateBoard`) and are not in this router yet.
 *
 * A board that does not exist, or belongs to another town, answers NOT_FOUND
 * from all three procedures here — `detail`, `stats`, and `recentMeetings`
 * alike. That is a deliberate, and enforced, convention: `detail`'s query
 * already had to answer this question (a missing row), but `stats`'s
 * correlated subqueries and `recentMeetings`'s filtered scan do not — they
 * degrade to `{0,0}` and `[]` for an id that never existed just as readily as
 * for a real board with no members or meetings yet. A caller of `stats` alone
 * (no `detail` in the same screen) would render a convincing, empty-but-real
 * looking board for an id that is not there. `assertBoardExists` below closes
 * that gap for the two counting procedures explicitly, rather than leaving it
 * to be noticed the first time a screen calls one without the other.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
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
});
