/**
 * Phase E, wave 3, Task 3 — the meeting attendance router's first procedure.
 *
 * Only `countByMeeting` exists here today: the single read
 * `routes/meetings.$meetingId.tsx`'s shell needs (the "N members recorded"
 * summary row, shown only once attendance exists). The full attendance
 * surface (roll call, `AttendancePanel`, `useQuorumCheck`) belongs to
 * `live.tsx`'s own migration — wave 5, per this wave's plan ("Out of
 * scope": `live.tsx` and the SSE transport are wave 5). This router exists
 * now, with one procedure, so wave 5 extends it rather than creating it —
 * conventions item 1. Named `meetingAttendance`, matching the table
 * (`meeting_attendance`), not `attendance` alone — the queryKeys namespace
 * (`queryKeys.attendance`) predates this router and is not renamed here.
 *
 * No permission guard: `meeting_attendance_tenant_isolation`
 * (`0000_baseline.sql`) is a plain tenancy policy, matching `board.ts`'s
 * reasoning. `assertMeetingExists` runs first for the same NOT_FOUND-parity
 * reason `agenda-item.ts`'s `countByMeeting` states — conventions item 3.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import { assertMeetingExists } from "./meeting.js";
import { toRows } from "../../db/rows.js";

export const meetingAttendanceRouter = router({
  countByMeeting: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertMeetingExists(tx, input.meetingId);
        const rows = toRows<{ count: number }>(
          await tx.execute(sql`
            SELECT count(*)::int AS count FROM meeting_attendance
            WHERE meeting_id = ${input.meetingId}
          `),
          (message) => new Error(`meetingAttendance.countByMeeting: ${message}`),
        );
        return rows[0]?.count ?? 0;
      });
    }),
});
