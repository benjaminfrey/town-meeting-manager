/**
 * Phase E, wave 3, Task 3 — the agenda item router's first procedure.
 *
 * Only `countByMeeting` exists here today: the single agenda-item read
 * `routes/meetings.$meetingId.tsx`'s shell needs (the "N items" badge next
 * to the agenda's status pill). The full agenda surface — `list`, `detail`,
 * insert/update/reorder/publish — is wave 4's own task, per this wave's plan
 * ("Out of scope, and verify before assuming": the agenda surface is wave
 * 4). This router exists now, with one procedure, so wave 4 extends it
 * rather than creating it — conventions item 1's "one router per domain
 * noun" names `agenda_item` as its own noun, distinct from `meeting`'s.
 *
 * No permission guard: `agenda_item_tenant_isolation`
 * (`0000_baseline.sql`) is a plain `town_id = get_current_town_id()` policy,
 * FOR ALL, no role predicate — the same shape `board.ts`/`person.ts` already
 * document this reasoning for. The raw Supabase read this replaces
 * (`.from("agenda_item").select("id").eq("meeting_id", meetingId)`) had no
 * application-level check either.
 *
 * `assertMeetingExists` (exported from `meeting.ts`) runs first, matching
 * `board.stats`'s own reasoning: a `count(*)` over a foreign or nonexistent
 * `meetingId` degrades to `0` exactly as readily as a real meeting with no
 * agenda yet, so a caller of this procedure alone (not `meeting.detail` in
 * the same screen) would otherwise render a convincing but nonexistent
 * meeting's "0 items" — conventions item 3.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import { assertMeetingExists } from "./meeting.js";
import { toRows } from "../../db/rows.js";

export const agendaItemRouter = router({
  countByMeeting: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertMeetingExists(tx, input.meetingId);
        const rows = toRows<{ count: number }>(
          await tx.execute(sql`
            SELECT count(*)::int AS count FROM agenda_item WHERE meeting_id = ${input.meetingId}
          `),
          (message) => new Error(`agendaItem.countByMeeting: ${message}`),
        );
        // The ::int cast is load-bearing, not decorative — see
        // `board.stats`'s identical comment: postgres.js returns count(*) as
        // the STRING "0", not the number 0.
        return rows[0]?.count ?? 0;
      });
    }),
});
