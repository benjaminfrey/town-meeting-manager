/**
 * Board reads.
 *
 * No permission guard, deliberately: `board` carried a pure tenancy policy and
 * nothing else, so any authenticated member of a town may read that town's
 * boards. `protectedProcedure` + `ctx.withTenant` is exactly that rule. Writes
 * are admin-gated (`assertCanUpdateBoard`) and are not in this router yet.
 *
 * A board in another town answers NOT_FOUND rather than FORBIDDEN: RLS returns
 * no row, and "you may not see this" would itself disclose that it exists.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import { toRows } from "../../db/rows.js";

export const boardRouter = router({
  detail: protectedProcedure
    .input(z.object({ boardId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.withTenant(async (tx) =>
        toRows<{
          id: string;
          name: string;
          board_type: string;
          quorum_type: string | null;
          archived_at: string | null;
        }>(
          await tx.execute(sql`
            SELECT id, name, board_type, quorum_type, archived_at
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
      const rows = await ctx.withTenant(async (tx) =>
        toRows<{ active_members: number; meetings: number }>(
          await tx.execute(sql`
            SELECT
              (SELECT count(*)::int FROM board_member
                 WHERE board_id = ${input.boardId} AND status = 'active') AS active_members,
              (SELECT count(*)::int FROM meeting
                 WHERE board_id = ${input.boardId}) AS meetings
          `),
          (message) => new Error(`board.stats: ${message}`),
        ),
      );
      return rows[0] ?? { active_members: 0, meetings: 0 };
    }),

  recentMeetings: protectedProcedure
    .input(
      z.object({ boardId: z.string().uuid(), limit: z.number().int().min(1).max(50).default(5) }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) =>
        toRows<{ id: string; title: string; scheduled_date: string; status: string }>(
          await tx.execute(sql`
            SELECT id, title, scheduled_date, status
            FROM meeting WHERE board_id = ${input.boardId}
            ORDER BY scheduled_date DESC LIMIT ${input.limit}
          `),
          (message) => new Error(`board.recentMeetings: ${message}`),
        ),
      );
    }),
});
