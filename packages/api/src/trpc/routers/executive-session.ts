/**
 * Phase E, wave 5, Task 3 — the executive session router.
 *
 * One read and five writes, replacing every `executive_session` write in the
 * product: `live.tsx`'s `handleExecMotionFiled` (insert), its two reactive
 * `useEffect` branches (stamp `entered_at` when the entry motion passes;
 * delete the pending record when it fails), its post-session tracking effect,
 * and `ExitExecutiveSessionDialog.tsx`'s `exited_at` stamp.
 *
 * **Every one of those writes goes through the Supabase client today with no
 * authorization check of any kind**, under
 * `executive_session_tenant_isolation` — `FOR ALL USING (town_id =
 * get_current_town_id())`, no board predicate, no role predicate. Any
 * signed-in member of the town can currently put any board into executive
 * session, or bring it out of one. Wave 5, Task 2 wrote the rule that was
 * missing (21b: M6, `trigger_executive_session`, for INSERT, UPDATE and
 * DELETE alike); this file is where it is applied.
 *
 * M6 is a single code, so every guard here is
 * `requireBoardPermission("M6", boardIdFrom(), {action})` — conventions item
 * 2's "reach for it FIRST", and the same `assertPermission` call
 * `assertCan{Insert,Update,Delete}ExecutiveSession` makes. Rule 21b's own
 * comment is the argument for why the DELETE is M6 too and not something
 * narrower: it is the undoing of a session that never began, and a board that
 * could enter executive session but not unwind a failed entry motion would be
 * stuck.
 *
 * ─── Four writes, not one `update` ────────────────────────────────────────
 *
 * `markEntered`, `markExited`, `appendPostSessionActionMotions` and `discard`
 * are separate procedures rather than one `update({entered_at?, exited_at?,
 * …})`. The reason is the same one `motion.ts` gives for not exposing a
 * `setStatus`: these columns are a one-way sequence (`entered_at` then
 * `exited_at`), and a procedure that accepted either as a value would let a
 * caller unstamp a session the board actually held. Each procedure writes one
 * column to `now()` — the DATABASE's clock, not the browser's, which the raw
 * writes used.
 *
 * ─── `appendPostSessionActionMotions` is an APPEND, and that is a change ───
 *
 * `live.tsx`'s effect reads `post_session_action_motion_ids`, computes
 * `[...existingIds, ...newIds]` in the browser, and writes the whole array
 * back. That is a read-modify-write across a round trip, so two clerks with
 * the screen open — which is the normal case, and the race wave 5's plan
 * calls its "scariest finding" — silently drop one another's motions. This
 * procedure takes only the ids to ADD, locks the row with `FOR UPDATE` inside
 * its own transaction, and unions. Concurrent callers serialize instead of
 * overwriting.
 *
 * Stated as a behaviour change per conventions item 1: nothing in the product
 * REMOVES an id from that array (the effect only ever appends), so an
 * append-only procedure can express everything the screen does. A future
 * feature that needs removal needs a different procedure, not a wider one.
 *
 * ─── Foreign keys from client input ───────────────────────────────────────
 *
 * `agendaItemId` and `entryMotionId` on `insert` are both foreign keys taken
 * from the request, and FK enforcement bypasses row security — so both are
 * checked against THIS MEETING, not merely for existence (a real motion on
 * another meeting satisfies `executive_session_entry_motion_id_fkey` while
 * linking the session to a motion the screen will never show). The ids passed
 * to `appendPostSessionActionMotions` are checked the same way even though
 * `post_session_action_motion_ids` is `jsonb` and enforces nothing: that
 * column is read by the minutes assembler, and an id that names no motion of
 * this meeting is a hole in the record rather than a constraint violation.
 * That check is ADDED — the raw write had none.
 */

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, requireBoardPermission, boardIdFrom } from "../trpc.js";
import {
  assertMeetingOnAuthorizedBoard,
  assertLiveRowOnAuthorizedBoard,
  assertAgendaItemsOnMeeting,
  assertMotionsOnMeeting,
} from "../board-derivation.js";
import { publishRealtimeEvent } from "../../realtime/events.js";
import { assertMeetingExists } from "./meeting.js";
import { toRows } from "../../db/rows.js";

export const executiveSessionRouter = router({
  /**
   * `routes/meetings.$meetingId.live.tsx`'s executive-session query — every
   * session record on one meeting. The screen picks the ACTIVE one
   * (`entered_at && !exited_at`) and the PENDING one
   * (`entry_motion_id && !entered_at && !exited_at`) out of the list itself,
   * so the filter stays client-side exactly as it is today.
   *
   * No permission guard: tenancy-only RLS, and the query this replaces had no
   * application-level check. No ORDER BY, matching that query.
   */
  byMeeting: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertMeetingExists(tx, input.meetingId);
        return toRows<{
          id: string;
          agenda_item_id: string | null;
          statutory_basis: string;
          entered_at: string | null;
          exited_at: string | null;
          entry_motion_id: string | null;
          post_session_action_motion_ids: unknown;
          created_at: string;
        }>(
          await tx.execute(sql`
            SELECT id, agenda_item_id, statutory_basis, entered_at, exited_at, entry_motion_id,
                   post_session_action_motion_ids, created_at
            FROM executive_session
            WHERE meeting_id = ${input.meetingId}
          `),
          (message) => new Error(`executiveSession.byMeeting: ${message}`),
        );
      });
    }),

  /**
   * `live.tsx`'s `handleExecMotionFiled` — the PENDING record, filed the
   * moment the entry motion is recorded and before the board has voted on it.
   * `entered_at` and `exited_at` are left null deliberately: that null pair
   * plus a non-null `entry_motion_id` is exactly how the screen recognises a
   * pending session.
   *
   * `post_session_action_motion_ids` is left to the column's own `'[]'::jsonb`
   * default rather than written explicitly, and `created_at` to `now()`
   * instead of the browser's clock — which matters here, because `live.tsx`
   * compares motion timestamps against `exited_at` to decide what counts as a
   * post-session action.
   */
  insert: protectedProcedure
    .use(
      requireBoardPermission("M6", boardIdFrom(), {
        action: "to move this meeting into executive session",
      }),
    )
    .input(
      z.object({
        boardId: z.string().uuid(),
        meetingId: z.string().uuid(),
        agendaItemId: z.string().uuid(),
        entryMotionId: z.string().uuid(),
        statutoryBasis: z.string().trim().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertMeetingOnAuthorizedBoard(ctx, tx, input.meetingId);
        await assertAgendaItemsOnMeeting(tx, input.meetingId, [input.agendaItemId]);
        await assertMotionsOnMeeting(tx, input.meetingId, [input.entryMotionId]);

        const rows = toRows<{ id: string }>(
          await tx.execute(sql`
            INSERT INTO executive_session (
              meeting_id, agenda_item_id, town_id, statutory_basis, entry_motion_id
            )
            VALUES (
              ${input.meetingId}, ${input.agendaItemId}, ${ctx.tenant.townId},
              ${input.statutoryBasis}, ${input.entryMotionId}
            )
            RETURNING id
          `),
          (message) => new Error(`executiveSession.insert: ${message}`),
        );
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId: input.meetingId,
          topic: "executive_session",
        });
        return { id: rows[0]!.id };
      });
    }),

  /**
   * The entry motion passed — the board is now in closed session. `live.tsx`
   * does this from a `useEffect` that fires on the motion row arriving over
   * the subscription; wave 5, Task 5 owns deciding who triggers it and how it
   * is deduplicated across devices.
   */
  markEntered: protectedProcedure
    .use(
      requireBoardPermission("M6", boardIdFrom(), {
        action: "to record that this board entered executive session",
      }),
    )
    .input(z.object({ boardId: z.string().uuid(), executiveSessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const { meetingId } = await assertLiveRowOnAuthorizedBoard(
          ctx,
          tx,
          "executive_session",
          input.executiveSessionId,
        );
        await tx.execute(sql`
          UPDATE executive_session SET entered_at = now() WHERE id = ${input.executiveSessionId}
        `);
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId,
          topic: "executive_session",
        });
        return { id: input.executiveSessionId };
      });
    }),

  /**
   * `ExitExecutiveSessionDialog.tsx`'s write — the board has returned to open
   * session.
   */
  markExited: protectedProcedure
    .use(
      requireBoardPermission("M6", boardIdFrom(), {
        action: "to return this board to open session",
      }),
    )
    .input(z.object({ boardId: z.string().uuid(), executiveSessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const { meetingId } = await assertLiveRowOnAuthorizedBoard(
          ctx,
          tx,
          "executive_session",
          input.executiveSessionId,
        );
        await tx.execute(sql`
          UPDATE executive_session SET exited_at = now() WHERE id = ${input.executiveSessionId}
        `);
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId,
          topic: "executive_session",
        });
        return { id: input.executiveSessionId };
      });
    }),

  /**
   * The entry motion FAILED — discard the pending record. `live.tsx`'s
   * reactive `motionStatus === "failed"` branch.
   *
   * Named `discard` rather than `delete` because of what it refuses to do:
   * it removes only a session that never began. A record with `entered_at`
   * set is the minute of a closed session the board actually held, and rule
   * 21b's authority to unwind a failed motion is not authority to erase one
   * of those. That precondition is ADDED — the raw `.delete().eq("id", …)`
   * had none, and was merely never reached with a started session because the
   * client checked first. CONFLICT rather than FORBIDDEN: nothing about this
   * caller is wrong.
   */
  discard: protectedProcedure
    .use(
      requireBoardPermission("M6", boardIdFrom(), {
        action: "to discard a pending executive session",
      }),
    )
    .input(z.object({ boardId: z.string().uuid(), executiveSessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const { meetingId } = await assertLiveRowOnAuthorizedBoard(
          ctx,
          tx,
          "executive_session",
          input.executiveSessionId,
        );
        const rows = toRows<{ entered_at: string | null }>(
          await tx.execute(sql`
            SELECT entered_at FROM executive_session WHERE id = ${input.executiveSessionId}
          `),
          (message) => new Error(`executiveSession.discard: ${message}`),
        );
        if (rows[0]?.entered_at !== null) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This executive session has already begun and cannot be discarded. Only a " +
              "session whose entry motion failed may be removed.",
          });
        }
        await tx.execute(sql`
          DELETE FROM executive_session WHERE id = ${input.executiveSessionId}
        `);
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId,
          topic: "executive_session",
        });
        return { id: input.executiveSessionId };
      });
    }),

  /**
   * Link motions recorded after the board returned from executive session to
   * the session that produced them — `live.tsx`'s post-session tracking
   * effect, as an APPEND rather than a whole-array overwrite. See this file's
   * header for why that is a change and what it fixes.
   */
  appendPostSessionActionMotions: protectedProcedure
    .use(
      requireBoardPermission("M6", boardIdFrom(), {
        action: "to record a post-executive-session action",
      }),
    )
    .input(
      z.object({
        boardId: z.string().uuid(),
        executiveSessionId: z.string().uuid(),
        motionIds: z.array(z.string().uuid()).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const { meetingId } = await assertLiveRowOnAuthorizedBoard(
          ctx,
          tx,
          "executive_session",
          input.executiveSessionId,
        );
        await assertMotionsOnMeeting(tx, meetingId, input.motionIds);

        // `FOR UPDATE` is the whole point of doing the union here rather than
        // in the browser: it holds the row for the life of this transaction,
        // so a second clerk's append waits instead of overwriting.
        const rows = toRows<{ post_session_action_motion_ids: unknown }>(
          await tx.execute(sql`
            SELECT post_session_action_motion_ids FROM executive_session
            WHERE id = ${input.executiveSessionId}
            FOR UPDATE
          `),
          (message) => new Error(`executiveSession.appendPostSessionActionMotions: ${message}`),
        );
        const stored = rows[0]?.post_session_action_motion_ids;
        // A column that is nullable and `jsonb`, so "an array of strings" is
        // what it holds in practice rather than what it guarantees. Anything
        // else is treated as empty rather than thrown on — the same leniency
        // `agenda-item.ts`'s `loadTemplateSections` applies to `sections`.
        const existing = Array.isArray(stored) ? stored.filter((v) => typeof v === "string") : [];
        const merged = [...new Set([...existing, ...input.motionIds])];

        await tx.execute(sql`
          UPDATE executive_session
          SET post_session_action_motion_ids = ${JSON.stringify(merged)}::jsonb
          WHERE id = ${input.executiveSessionId}
        `);
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId,
          topic: "executive_session",
        });
        return { id: input.executiveSessionId, motionIds: merged };
      });
    }),
});
