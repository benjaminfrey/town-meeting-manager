/**
 * Phase E, wave 5, Task 3 — the agenda item transition router.
 *
 * **One read, and no writes — which is the point of the file.** A transition
 * row is a CLOCK: the table's own comment is "Tracks time spent on each agenda
 * item during live meetings." It is opened when the meeting moves to an item
 * and closed when it moves off, and nothing in the product ever acts on one
 * directly. Every write to it happens inside `meeting.callToOrder`,
 * `meeting.navigateToAgendaItem` or `meeting.adjourn`, in the same transaction
 * as the `meeting.current_agenda_item_id` change that causes it — which is
 * exactly the reasoning `rules.ts`'s rule 21d gives for the table taking M1,
 * the code of the causing action, rather than one of its own.
 *
 * So there is no `agendaItemTransition.insert` and no `.update`, and that
 * absence is a decision rather than an omission: a procedure that opened or
 * closed a transition on its own would let the clock and the meeting's current
 * item disagree, which is the one thing the row exists to prevent.
 *
 * **This file's shape and the publish inventory.** `trpc/__tests__/
 * router-wiring.test.ts`'s per-file guard requires every file in `routers/`
 * that WRITES a live-meeting table to have at least one mutation attributed to
 * its router prefix. This file writes nothing, so the guard skips it — checked
 * rather than assumed, by running the suite. It still carries a conventional
 * `export const agendaItemTransitionRouter = router({` declaration and
 * two-space procedure keys, so it would be scannable the day it grows a write.
 *
 * **This router is not in wave 5's Task 3 brief's file list.** The brief names
 * `motion.ts`, `vote-record.ts`, `executive-session.ts`, `guest-speaker.ts`,
 * `meeting-attendance.ts`, `meeting.ts` and `agenda-item.ts` — and
 * `live.tsx`'s transitions read has no home among them. Creating a router for
 * the noun is the conventions' own answer (item 1, "one noun, one router") and
 * it costs nothing; the alternative, hanging a `transitions` read off
 * `meeting.ts`, would put a second table's read in a router named for another.
 *
 * No permission guard: `agenda_item_transition_tenant_isolation` is a plain
 * `FOR ALL USING (town_id = get_current_town_id())` with no board or role
 * predicate, and the Supabase query this replaces had no application-level
 * check either — conventions item 2's "a read whose old policy was
 * tenancy-only gets `protectedProcedure` and no guard."
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import { assertMeetingExists } from "./meeting.js";
import { toRows } from "../../db/rows.js";

export const agendaItemTransitionRouter = router({
  /**
   * `routes/meetings.$meetingId.live.tsx`'s transitions query — every
   * transition on one meeting, oldest first.
   *
   * The screen reads it for one thing: the per-item timer, which needs the
   * OPEN transition on the current item (`t.agenda_item_id === currentItemId
   * && !t.ended_at`, taking the last). That filter stays client-side, because
   * narrowing the query to it would change what the screen holds — and
   * `AttendancePanel` renders `currentItemStartedAt` from the same array.
   *
   * `ORDER BY started_at, id` — the `id` tiebreak is ADDED, for the reason
   * `motion.byMeeting` gives. It matters slightly more here: the screen takes
   * the LAST matching row, so ties decided differently on two devices would
   * show two different item timers.
   */
  byMeeting: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertMeetingExists(tx, input.meetingId);
        return toRows<{
          id: string;
          agenda_item_id: string;
          started_at: string;
          ended_at: string | null;
        }>(
          await tx.execute(sql`
            SELECT id, agenda_item_id, started_at, ended_at
            FROM agenda_item_transition
            WHERE meeting_id = ${input.meetingId}
            ORDER BY started_at ASC, id
          `),
          (message) => new Error(`agendaItemTransition.byMeeting: ${message}`),
        );
      });
    }),
});
