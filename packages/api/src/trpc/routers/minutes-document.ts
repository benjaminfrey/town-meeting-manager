/**
 * Phase E, wave 3, Task 3 — the minutes document router's first procedure.
 *
 * Only `byMeeting` exists here today: the single read
 * `routes/meetings.$meetingId.tsx`'s shell needs (the minutes status pill —
 * "Not yet generated" / draft / in review / approved / published). The full
 * minutes surface (generation, review, approval, addenda) is wave 6's own
 * task, per this wave's plan ("Out of scope": `minutes.tsx`/`review.tsx` are
 * wave 6). This router exists now, with one procedure, so wave 6 extends it
 * rather than creating it — conventions item 1.
 *
 * Returns the single document or `null` rather than an array: a meeting has
 * AT MOST one (`minutes_document_meeting_id_key` is a unique constraint on
 * `meeting_id`), unlike the raw `.limit(1)` array read this replaces, which
 * only ever needed its first element (`minutesDocs?.[0]`).
 *
 * No permission guard: `minutes_document_tenant_isolation`
 * (`0000_baseline.sql`) is a plain tenancy policy, matching `board.ts`'s
 * reasoning. `assertMeetingExists` runs first for the same NOT_FOUND-parity
 * reason `agenda-item.ts`'s `countByMeeting` states — conventions item 3.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import { assertMeetingExists } from "./meeting.js";
import { toRows } from "../../db/rows.js";

export const minutesDocumentRouter = router({
  byMeeting: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertMeetingExists(tx, input.meetingId);
        const rows = toRows<{ id: string; status: string }>(
          await tx.execute(sql`
            SELECT id, status FROM minutes_document WHERE meeting_id = ${input.meetingId} LIMIT 1
          `),
          (message) => new Error(`minutesDocument.byMeeting: ${message}`),
        );
        return rows[0] ?? null;
      });
    }),
});
