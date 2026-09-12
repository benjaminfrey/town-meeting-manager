/**
 * Phase E, wave 5, Task 3 — the motion router.
 *
 * One read and three writes, replacing `MotionCaptureDialog.tsx`'s insert and
 * `MotionPanel.tsx`'s two status updates. The fourth `motion` write in the
 * product — the status + `vote_summary` stamp a completed vote applies — is
 * NOT here: it is one statement inside `voteRecord.recordForMotion`, because
 * the outcome of a motion is computed from the votes and splitting the two
 * across two transactions would let a tally commit without the motion moving.
 *
 * ─── The board is one join out, exactly as for `agenda_item` ──────────────
 *
 * `motion` carries `meeting_id uuid NOT NULL` and no `board_id` column
 * (`0000_baseline.sql:1618`), so its board is `meeting.board_id` —
 * `board-derivation.ts`'s `assertMeetingOnAuthorizedBoard` (by meeting, for
 * `insert`) and `assertLiveRowOnAuthorizedBoard` (by row id, for the two
 * updates). `motion_tenant_isolation` is `FOR ALL USING (town_id =
 * get_current_town_id())` with no board predicate and no role predicate
 * (quoted in `phase-e-conventions.md` item 2, wave 5 Task 2's grep), so RLS
 * will not catch a cross-board write here. The guard is entirely application
 * code, and it is two halves: `requireBoardPermission("M3", boardIdFrom())`
 * authorizes the CLIENT-CLAIMED board before `.input()` parses, and the
 * resolver re-derives the row's real board inside the write's own transaction
 * and calls `assertMatchesAuthorizedBoard`.
 *
 * ─── M3 for all three, through the code form ──────────────────────────────
 *
 * `rules.ts` rules 3 and 4 are `assertCanInsertMotion`/`assertCanUpdateMotion`,
 * each exactly `assertPermission(actor, "M3", {boardId, action})`.
 * `requireBoardPermission("M3", …)` IS that call — conventions item 2's "reach
 * for `requireBoardPermission` FIRST for a single-code rule", and the same
 * argument `meeting.ts` makes for `assertCanInsertMeeting`. M3
 * (`capture_motions_votes`) is in BOTH `designated_boards` templates: a
 * recording secretary appointed to one board is its canonical holder, and
 * holds it per board with global all-false, which is why the check must be
 * board-scoped rather than global.
 *
 * `callVote` and `withdraw` are separate procedures rather than one
 * `setStatus(status)`, deliberately. `motion_status` has seven values, and a
 * caller who could name any of them could stamp a motion `passed` with no
 * votes behind it — the outcome statuses are reachable ONLY through
 * `voteRecord.recordForMotion`, which derives them from the tally. This is
 * `meeting.publishAgenda`'s reasoning ("nor does it accept a target value")
 * applied to a table where the value is the legal record.
 *
 * ─── A write this migration DROPS, and the reason is that it never worked ──
 *
 * `MotionPanel.tsx`'s two updates both send `updated_at: new Date().toISOString()`
 * alongside `status`. **`motion` has no `updated_at` column.** Verified twice
 * — `0000_baseline.sql`'s `CREATE TABLE public.motion` lists twelve columns
 * and that is not one of them, and `db/schema.ts`'s `motion` table agrees —
 * and there is no later `ALTER TABLE ... ADD COLUMN` (`grep -n "motion"
 * drizzle/0000_baseline.sql | grep -i "add column"` is empty). PostgREST
 * rejects an unknown column rather than ignoring it, so "Call Vote" and
 * "Withdraw" have been failing in the browser, not silently succeeding. The
 * procedures below write `status` alone. That is a behaviour change and it is
 * stated here rather than left in a diff, per conventions item 1 — but the
 * behaviour it changes is an error, and Task 5 should expect those two buttons
 * to start working rather than to keep behaving as they do today.
 * `VotePanel.tsx`'s motion update carries the same phantom column; see
 * `vote-record.ts`.
 *
 * ─── Every write publishes ────────────────────────────────────────────────
 *
 * `motion` is one of the eight `LIVE_MEETING_TOPICS`. Each mutation calls
 * `publishRealtimeEvent(tx, …)` last, inside the write's own transaction, so
 * the announcement commits with the write — see `realtime/events.ts` for why
 * that ordering is the whole point, and `trpc/__tests__/router-wiring.test.ts`
 * for the check that a future write here cannot quietly skip it.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure, requireBoardPermission, boardIdFrom } from "../trpc.js";
import {
  assertMeetingOnAuthorizedBoard,
  assertLiveRowOnAuthorizedBoard,
  assertAgendaItemsOnMeeting,
  assertMotionsOnMeeting,
  assertBoardMembersOnBoard,
} from "../board-derivation.js";
import { publishRealtimeEvent } from "../../realtime/events.js";
import { assertMeetingExists } from "./meeting.js";
import { toRows } from "../../db/rows.js";

/** The full `motion_type` enum (`0000_baseline.sql:213`). */
const MOTION_TYPES = [
  "main",
  "amendment",
  "substitute",
  "table",
  "untable",
  "postpone",
  "reconsider",
  "adjourn",
] as const;

export const motionRouter = router({
  /**
   * `routes/meetings.$meetingId.live.tsx`'s motions query — every motion on
   * one meeting, oldest first, which is what the screen groups into parents
   * and amendments itself (`motionsByItem`, `parentMotions`).
   *
   * No permission guard: `motion_tenant_isolation` is tenancy-only and the
   * Supabase query this replaces had no application-level check either —
   * conventions item 2's "a read whose old policy was tenancy-only gets
   * `protectedProcedure` and no guard."
   *
   * `ORDER BY created_at, id` — the tiebreak on `id` is ADDED. The query this
   * replaces ordered on `created_at` alone, and two motions filed in the same
   * millisecond (an amendment and its parent, recorded from one dialog) had
   * whatever order Postgres returned that day. A stable order is not a
   * behaviour change any screen can observe as a loss.
   *
   * `town_id` and `meeting_id` are not selected: RLS scopes the first and the
   * second is the argument.
   */
  byMeeting: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertMeetingExists(tx, input.meetingId);
        return toRows<{
          id: string;
          agenda_item_id: string;
          motion_text: string;
          motion_type: string;
          moved_by: string | null;
          seconded_by: string | null;
          status: string;
          parent_motion_id: string | null;
          vote_summary: unknown;
          created_at: string;
        }>(
          await tx.execute(sql`
            SELECT id, agenda_item_id, motion_text, motion_type, moved_by, seconded_by,
                   status, parent_motion_id, vote_summary, created_at
            FROM motion
            WHERE meeting_id = ${input.meetingId}
            ORDER BY created_at ASC, id
          `),
          (message) => new Error(`motion.byMeeting: ${message}`),
        );
      });
    }),

  /**
   * `MotionCaptureDialog.tsx`'s insert — the only place the product files a
   * motion, reached for a plain motion, an amendment, a table/untable, the
   * executive-session entry motion and the adjournment motion.
   *
   * `townId` comes from `ctx.tenant`, never from input (the raw insert sent it
   * from client state); `id` is the column's `gen_random_uuid()` default
   * rather than a browser-minted `crypto.randomUUID()`; `created_at` is the
   * column's `now()` default rather than the browser's clock — which matters
   * more here than usual, because `live.tsx` compares `motion.created_at`
   * against `executive_session.exited_at` to decide which motions are
   * post-session actions, and a skewed client clock silently mis-sorts that.
   *
   * `status` is hardcoded `'seconded'`, matching the raw insert exactly —
   * including for a procedural motion with no seconder, which the dialog files
   * as `seconded` too. Not "corrected" here: which status a filed motion takes
   * is a product rule, and this is a migration.
   *
   * **Three foreign keys arrive from client input and all three are checked**
   * (conventions item 3; FK enforcement bypasses row security, so none of them
   * is checked by the database in a way that helps):
   *
   *   - `agendaItemId` — must be an item OF THIS MEETING, not merely an item
   *     that exists. A real item on another meeting satisfies
   *     `motion_agenda_item_id_fkey` while filing the motion where no screen
   *     will render it.
   *   - `parentMotionId` — same, against `motion`.
   *   - `movedBy` / `secondedBy` — must be seats on THIS MEETING'S BOARD.
   *     Today neither is checked at all, so a `board_member.id` from another
   *     town satisfies `motion_moved_by_fkey` and the motion records a mover
   *     who has never sat on that board.
   *
   * `motionText` gains a `max(5000)` bound the column does not have and the
   * dialog does not impose (its only rule is `text.trim().length >= 5`).
   * Stated as an ADDED clause per conventions item 1: `motion_text` is `text`,
   * so nothing rejects a megabyte today. 5000 is the same ceiling
   * `agenda-item.ts` uses for its long free-text fields.
   */
  insert: protectedProcedure
    .use(
      requireBoardPermission("M3", boardIdFrom(), {
        action: "to record a motion",
      }),
    )
    .input(
      z.object({
        boardId: z.string().uuid(),
        meetingId: z.string().uuid(),
        agendaItemId: z.string().uuid(),
        motionText: z.string().trim().min(5).max(5000),
        motionType: z.enum(MOTION_TYPES),
        movedBy: z.string().uuid(),
        secondedBy: z.string().uuid().nullable(),
        parentMotionId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const boardId = await assertMeetingOnAuthorizedBoard(ctx, tx, input.meetingId);
        await assertAgendaItemsOnMeeting(tx, input.meetingId, [input.agendaItemId]);
        if (input.parentMotionId !== null) {
          await assertMotionsOnMeeting(tx, input.meetingId, [input.parentMotionId]);
        }
        await assertBoardMembersOnBoard(tx, boardId, [
          input.movedBy,
          ...(input.secondedBy === null ? [] : [input.secondedBy]),
        ]);

        const rows = toRows<{ id: string }>(
          await tx.execute(sql`
            INSERT INTO motion (
              agenda_item_id, meeting_id, town_id, motion_text, motion_type,
              moved_by, seconded_by, status, parent_motion_id
            )
            VALUES (
              ${input.agendaItemId}, ${input.meetingId}, ${ctx.tenant.townId},
              ${input.motionText}, ${input.motionType}::motion_type,
              ${input.movedBy}, ${input.secondedBy}, 'seconded'::motion_status,
              ${input.parentMotionId}
            )
            RETURNING id
          `),
          (message) => new Error(`motion.insert: ${message}`),
        );
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId: input.meetingId,
          topic: "motion",
        });
        return { id: rows[0]!.id };
      });
    }),

  /**
   * `MotionPanel.tsx`'s "Call Vote" — `status = 'in_vote'` and nothing else.
   * See this file's header for the `updated_at` column that does not exist and
   * what dropping it means.
   */
  callVote: protectedProcedure
    .use(
      requireBoardPermission("M3", boardIdFrom(), {
        action: "to call a vote on a motion",
      }),
    )
    .input(z.object({ boardId: z.string().uuid(), motionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const { meetingId } = await assertLiveRowOnAuthorizedBoard(
          ctx,
          tx,
          "motion",
          input.motionId,
        );
        await tx.execute(sql`
          UPDATE motion SET status = 'in_vote'::motion_status WHERE id = ${input.motionId}
        `);
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId,
          topic: "motion",
        });
        return { id: input.motionId };
      });
    }),

  /**
   * `MotionPanel.tsx`'s "Withdraw" — `status = 'withdrawn'`, behind that
   * component's own confirmation step.
   */
  withdraw: protectedProcedure
    .use(
      requireBoardPermission("M3", boardIdFrom(), {
        action: "to withdraw a motion",
      }),
    )
    .input(z.object({ boardId: z.string().uuid(), motionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const { meetingId } = await assertLiveRowOnAuthorizedBoard(
          ctx,
          tx,
          "motion",
          input.motionId,
        );
        await tx.execute(sql`
          UPDATE motion SET status = 'withdrawn'::motion_status WHERE id = ${input.motionId}
        `);
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId,
          topic: "motion",
        });
        return { id: input.motionId };
      });
    }),
});
