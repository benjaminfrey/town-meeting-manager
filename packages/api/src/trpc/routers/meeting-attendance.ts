/**
 * Phase E, wave 3, Task 3 — the meeting attendance router's first procedure.
 * Phase E, wave 5, Task 3 — the rest of it.
 *
 * Wave 3 left one read here (`countByMeeting`, the "N members recorded"
 * summary row on `routes/meetings.$meetingId.tsx`'s shell) precisely so this
 * wave would extend a router rather than create one — conventions item 1.
 * Named `meetingAttendance`, matching the table (`meeting_attendance`), not
 * `attendance` alone; the queryKeys namespace (`queryKeys.attendance`)
 * predates this router and is not renamed here.
 *
 * `countByMeeting` and `byMeeting` carry no permission guard:
 * `meeting_attendance_tenant_isolation` (`0000_baseline.sql`) is a plain
 * tenancy policy with no board predicate and no role predicate, matching
 * `board.ts`'s reasoning, and neither Supabase query they replace had an
 * application-level check. `assertMeetingExists` runs first for the
 * NOT_FOUND-parity reason `agenda-item.ts`'s `countByMeeting` states —
 * conventions item 3.
 *
 * ─── The two writes are two acts, not one with a flag ─────────────────────
 *
 * Both screens do the same thing structurally — "set this member's status,
 * creating the row if it does not exist" — and they do it with DIFFERENT
 * effects, which is why this file has two procedures rather than one taking a
 * boolean:
 *
 *   `setRollCall`  — `MeetingStartFlow.tsx`'s present/absent toggle, before
 *                    the meeting is called to order. Its update writes
 *                    `{status}` and NOTHING else.
 *   `setStatus`    — `AttendancePanel.tsx`'s status cycle, during the meeting.
 *                    Its update ALSO stamps `arrived_at` when the new status
 *                    is `late_arrival` and `departed_at` when it is
 *                    `early_departure`, and clears `departed_at` otherwise.
 *
 * Collapsing them would mean a roll-call toggle clearing a `departed_at` the
 * pre-meeting screen has never touched — small, real, and exactly the kind of
 * behaviour change conventions item 1 says a migration is not entitled to
 * make. The CYCLE itself (`CYCLE_ORDER`) stays in `AttendancePanel`: the
 * client decides which status comes next and sends it, as it does today.
 *
 * ─── Both are upserts now, and that closes a real race ────────────────────
 *
 * Today each screen reads its own `attendance` array, decides between UPDATE
 * and INSERT in the browser, and issues one or the other. Two clerks doing
 * roll call at once both see "no record" and both INSERT — and
 * `attendance_unique_per_meeting UNIQUE (meeting_id, person_id)`
 * (`0000_baseline.sql:2203`) makes the loser fail with a driver error that
 * `MeetingStartFlow`'s mutation surfaces as a red toast in the middle of roll
 * call. Both procedures below are a single `INSERT … ON CONFLICT (meeting_id,
 * person_id) DO UPDATE`, so the second caller updates instead of colliding.
 * The rows that result are identical to what the browser's branch produced.
 *
 * ─── `person_id` is derived, never accepted ───────────────────────────────
 *
 * Both call sites send `person_id` from client state alongside
 * `board_member_id`, and both are foreign keys FK enforcement checks with row
 * security bypassed. `assertBoardMembersOnBoard` returns each seat's real
 * `person_id`, so the procedure writes the one the database holds — the same
 * value for every honest caller, and not a value a caller can choose. That
 * removes one client-supplied foreign key entirely rather than checking it.
 *
 * ─── M2, board-scoped ─────────────────────────────────────────────────────
 *
 * `rules.ts` rules 7 and 8 (`assertCanInsertMeetingAttendance`,
 * `assertCanUpdateMeetingAttendance`) are both exactly
 * `assertPermission(actor, "M2", {boardId, action})`. Each procedure here can
 * insert OR update depending on what is already there, and since both rules
 * resolve to the same code that is not an ambiguity to resolve —
 * `requireBoardPermission("M2", boardIdFrom(), {action})` is the correct guard
 * either way, and IS that `assertPermission` call.
 *
 * `meeting_attendance` is one of the eight `LIVE_MEETING_TOPICS`, so both
 * writes publish inside their own transaction.
 *
 * **One `meeting_attendance` write is NOT here**: the recording-secretary flag
 * `MeetingStartFlow` sets as part of calling the meeting to order. It lives in
 * `meeting.callToOrder`, with the three other tables that act writes, because
 * it is one act — see that procedure's own doc comment for the authorization
 * consequence, which is the one real cost in this task.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure, requireBoardPermission, boardIdFrom } from "../trpc.js";
import { assertMeetingOnAuthorizedBoard, assertBoardMembersOnBoard } from "../board-derivation.js";
import { publishRealtimeEvent } from "../../realtime/events.js";
import { assertMeetingExists } from "./meeting.js";
import { toRows } from "../../db/rows.js";

/** The full `attendance_status` enum (`0000_baseline.sql:82`). */
const ATTENDANCE_STATUSES = [
  "present",
  "absent",
  "remote",
  "excused",
  "late_arrival",
  "early_departure",
] as const;

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

  /**
   * The attendance rows `routes/meetings.$meetingId.live.tsx`,
   * `MeetingStartFlow`, `AttendancePanel`, `VotePanel` and `useQuorumCheck`
   * all read — one meeting's whole roll.
   *
   * The query this replaces is `select("*").eq("meeting_id", …)` with no
   * ORDER BY, and none is added: every consumer builds a `Map` keyed by
   * `board_member_id` or filters by status, so row order is read nowhere.
   *
   * `town_id` and `meeting_id` are not selected (RLS scopes the first, the
   * second is the argument). Everything else is, because something reads it:
   * `id` (`AttendancePanel`'s update target and `VotePanel`'s key),
   * `board_member_id` and `person_id` (both join keys — `MeetingStartFlow`
   * matches the recording secretary on `person_id`), `status`,
   * `is_recording_secretary`, `arrived_at` and `departed_at`.
   */
  byMeeting: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertMeetingExists(tx, input.meetingId);
        return toRows<{
          id: string;
          board_member_id: string | null;
          person_id: string;
          status: string;
          is_recording_secretary: boolean;
          arrived_at: string | null;
          departed_at: string | null;
        }>(
          await tx.execute(sql`
            SELECT id, board_member_id, person_id, status, is_recording_secretary,
                   arrived_at, departed_at
            FROM meeting_attendance
            WHERE meeting_id = ${input.meetingId}
          `),
          (message) => new Error(`meetingAttendance.byMeeting: ${message}`),
        );
      });
    }),

  /**
   * `MeetingStartFlow.tsx`'s roll-call toggle — see this file's header for why
   * this is a separate procedure from `setStatus`.
   *
   * The client computes the next status (`present` ⇄ `absent` there) and sends
   * it, exactly as it does today. `is_recording_secretary`, `arrived_at` and
   * `departed_at` are written only by the INSERT branch, to the same
   * `false`/`null`/`null` the raw insert used; the UPDATE branch touches
   * `status` alone.
   */
  setRollCall: protectedProcedure
    .use(
      requireBoardPermission("M2", boardIdFrom(), {
        action: "to record attendance",
      }),
    )
    .input(
      z.object({
        boardId: z.string().uuid(),
        meetingId: z.string().uuid(),
        boardMemberId: z.string().uuid(),
        status: z.enum(ATTENDANCE_STATUSES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const boardId = await assertMeetingOnAuthorizedBoard(ctx, tx, input.meetingId);
        const personIds = await assertBoardMembersOnBoard(tx, boardId, [input.boardMemberId]);
        const personId = personIds.get(input.boardMemberId)!;

        const rows = toRows<{ id: string }>(
          await tx.execute(sql`
            INSERT INTO meeting_attendance (
              meeting_id, town_id, board_member_id, person_id, status,
              is_recording_secretary, arrived_at, departed_at
            )
            VALUES (
              ${input.meetingId}, ${ctx.tenant.townId}, ${input.boardMemberId}, ${personId},
              ${input.status}::attendance_status, false, NULL, NULL
            )
            ON CONFLICT (meeting_id, person_id) DO UPDATE
              SET status = EXCLUDED.status
            RETURNING id
          `),
          (message) => new Error(`meetingAttendance.setRollCall: ${message}`),
        );
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId: input.meetingId,
          topic: "meeting_attendance",
        });
        return { id: rows[0]!.id };
      });
    }),

  /**
   * `AttendancePanel.tsx`'s status cycle, during the meeting.
   *
   * The two timestamp rules are carried over exactly, including the asymmetry
   * between them, which is the specification and not a bug to tidy:
   *
   *   `arrived_at`  — set to the clock ONLY when the new status is
   *                   `late_arrival`; otherwise LEFT AS IT WAS (the raw update
   *                   wrote `record.arrived_at` back unchanged).
   *   `departed_at` — set to the clock when the new status is
   *                   `early_departure`, and CLEARED on every other status.
   *
   * `now()` rather than the browser's `new Date().toISOString()` — the
   * database's clock, so two devices recording arrivals cannot disagree about
   * who was there first.
   *
   * `is_recording_secretary` is untouched on update. The raw update wrote
   * `record.is_recording_secretary` back to itself, which is the same thing
   * with a round trip's worth of staleness in it.
   */
  setStatus: protectedProcedure
    .use(
      requireBoardPermission("M2", boardIdFrom(), {
        action: "to change recorded attendance",
      }),
    )
    .input(
      z.object({
        boardId: z.string().uuid(),
        meetingId: z.string().uuid(),
        boardMemberId: z.string().uuid(),
        status: z.enum(ATTENDANCE_STATUSES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const boardId = await assertMeetingOnAuthorizedBoard(ctx, tx, input.meetingId);
        const personIds = await assertBoardMembersOnBoard(tx, boardId, [input.boardMemberId]);
        const personId = personIds.get(input.boardMemberId)!;

        const rows = toRows<{ id: string }>(
          await tx.execute(sql`
            INSERT INTO meeting_attendance (
              meeting_id, town_id, board_member_id, person_id, status,
              is_recording_secretary, arrived_at, departed_at
            )
            VALUES (
              ${input.meetingId}, ${ctx.tenant.townId}, ${input.boardMemberId}, ${personId},
              ${input.status}::attendance_status, false,
              CASE WHEN ${input.status} = 'late_arrival' THEN now() ELSE NULL END,
              NULL
            )
            ON CONFLICT (meeting_id, person_id) DO UPDATE
              SET status = EXCLUDED.status,
                  arrived_at = CASE
                    WHEN EXCLUDED.status = 'late_arrival'::attendance_status THEN now()
                    ELSE meeting_attendance.arrived_at
                  END,
                  departed_at = CASE
                    WHEN EXCLUDED.status = 'early_departure'::attendance_status THEN now()
                    ELSE NULL
                  END
            RETURNING id
          `),
          (message) => new Error(`meetingAttendance.setStatus: ${message}`),
        );
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId: input.meetingId,
          topic: "meeting_attendance",
        });
        return { id: rows[0]!.id };
      });
    }),
});
