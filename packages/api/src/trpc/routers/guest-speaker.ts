/**
 * Phase E, wave 5, Task 3 — the guest speaker router.
 *
 * One read and two writes, replacing `GuestSpeakerEntry.tsx`'s
 * `addSpeakerMutation` and `removeSpeakerMutation` — the public-comment queue
 * a clerk types names into during a meeting.
 *
 * **Both writes go through the Supabase client today with no authorization
 * check of any kind**, under `guest_speaker_tenant_isolation` (`FOR ALL USING
 * (town_id = get_current_town_id())`, no board predicate, no role predicate).
 * Wave 5, Task 2 wrote rule 21c — M7, `manage_speaker_queue`, INSERT and
 * DELETE — and this is where it is applied, through
 * `requireBoardPermission("M7", boardIdFrom())`, which IS the
 * `assertPermission` call `assertCan{Insert,Delete}GuestSpeaker` makes.
 *
 * There is no UPDATE, matching the product: `GuestSpeakerEntry` offers add and
 * remove, and an edit is a remove plus a re-add. Rule 21c has no update rule
 * for the same reason, so inventing a procedure here would be inventing the
 * rule too.
 *
 * ─── A guest is not an account, so there is no self-scoping branch ────────
 *
 * `guest_speaker` is deliberately NOT linked to a `person` row — the table's
 * own comment in `0000_baseline.sql` says so, citing advisory 1.2. So unlike
 * `vote_record` (rule 5's self-vote branch), there is no "may this caller act
 * on their own row" question to ask: a guest has no account and cannot reach
 * this router at all. Everything here is a clerk acting on the queue.
 *
 * ─── Board derivation and the FK ──────────────────────────────────────────
 *
 * `guest_speaker` carries `meeting_id uuid NOT NULL` and no `board_id`
 * (`0000_baseline.sql:1266`), so the board is one join out —
 * `assertMeetingOnAuthorizedBoard` for the insert, which names its meeting,
 * and `assertLiveRowOnAuthorizedBoard` for the delete, which names a speaker
 * id whose board is two columns away.
 *
 * `agendaItemId` is a foreign key from client input and is checked against
 * THIS MEETING. Existence alone would not do: a real agenda item on another
 * meeting satisfies `guest_speaker_agenda_item_id_fkey` while queueing the
 * speaker under an item that renders on no screen this clerk can see. The
 * column is nullable and this procedure requires it, matching the only caller
 * — `GuestSpeakerEntry` is rendered from `AgendaItemDetailPanel` and always
 * has an item.
 *
 * ─── Field bounds are ADDED ───────────────────────────────────────────────
 *
 * `name`, `address` and `topic` are `text` with no constraint, and the form
 * imposes only "name is non-empty" (`if (!name.trim()) return`). The bounds
 * below (200 / 300 / 500) are new, and stated here rather than left in the
 * diff per conventions item 1 — a public-comment queue is reachable by
 * whoever runs the meeting and had no ceiling at all.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure, requireBoardPermission, boardIdFrom } from "../trpc.js";
import {
  assertMeetingOnAuthorizedBoard,
  assertLiveRowOnAuthorizedBoard,
  assertAgendaItemsOnMeeting,
} from "../board-derivation.js";
import { publishRealtimeEvent } from "../../realtime/events.js";
import { assertMeetingExists } from "./meeting.js";
import { toRows } from "../../db/rows.js";

export const guestSpeakerRouter = router({
  /**
   * `routes/meetings.$meetingId.live.tsx`'s speakers query — every speaker on
   * one meeting, oldest first, which is the queue order the panel renders.
   * The screen groups by agenda item itself (`speakersByItem`).
   *
   * No permission guard: tenancy-only RLS, and the query this replaces had no
   * application-level check either. `ORDER BY created_at, id` — the `id`
   * tiebreak is added, for the reason `motion.byMeeting` gives: two speakers
   * added in the same millisecond otherwise sit in whatever order the
   * database returned.
   */
  byMeeting: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertMeetingExists(tx, input.meetingId);
        return toRows<{
          id: string;
          agenda_item_id: string | null;
          name: string;
          address: string | null;
          topic: string | null;
          created_at: string;
        }>(
          await tx.execute(sql`
            SELECT id, agenda_item_id, name, address, topic, created_at
            FROM guest_speaker
            WHERE meeting_id = ${input.meetingId}
            ORDER BY created_at ASC, id
          `),
          (message) => new Error(`guestSpeaker.byMeeting: ${message}`),
        );
      });
    }),

  /**
   * `GuestSpeakerEntry.tsx`'s "Add Speaker". `townId` comes from `ctx.tenant`
   * rather than client state, `id` from the column's `gen_random_uuid()`
   * default, and `created_at` from `now()` rather than the browser's clock —
   * the last of which is load-bearing here, because `created_at` IS the queue
   * order and two devices with skewed clocks would interleave the list.
   *
   * `address` and `topic` are trimmed-then-nulled exactly as the form does
   * (`address.trim() || null`), so an entry of whitespace stores NULL rather
   * than a blank string, and the two are not silently distinguished in the
   * minutes.
   */
  insert: protectedProcedure
    .use(
      requireBoardPermission("M7", boardIdFrom(), {
        action: "to add a speaker to the queue",
      }),
    )
    .input(
      z.object({
        boardId: z.string().uuid(),
        meetingId: z.string().uuid(),
        agendaItemId: z.string().uuid(),
        name: z.string().trim().min(1).max(200),
        address: z
          .string()
          .max(300)
          .nullable()
          .transform((v) => {
            const trimmed = (v ?? "").trim();
            return trimmed.length > 0 ? trimmed : null;
          }),
        topic: z
          .string()
          .max(500)
          .nullable()
          .transform((v) => {
            const trimmed = (v ?? "").trim();
            return trimmed.length > 0 ? trimmed : null;
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertMeetingOnAuthorizedBoard(ctx, tx, input.meetingId);
        await assertAgendaItemsOnMeeting(tx, input.meetingId, [input.agendaItemId]);

        const rows = toRows<{ id: string }>(
          await tx.execute(sql`
            INSERT INTO guest_speaker (meeting_id, agenda_item_id, town_id, name, address, topic)
            VALUES (
              ${input.meetingId}, ${input.agendaItemId}, ${ctx.tenant.townId},
              ${input.name}, ${input.address}, ${input.topic}
            )
            RETURNING id
          `),
          (message) => new Error(`guestSpeaker.insert: ${message}`),
        );
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId: input.meetingId,
          topic: "guest_speaker",
        });
        return { id: rows[0]!.id };
      });
    }),

  /**
   * `GuestSpeakerEntry.tsx`'s remove — one row, named by its own id, whose
   * board is derived through the meeting before anything is deleted.
   */
  delete: protectedProcedure
    .use(
      requireBoardPermission("M7", boardIdFrom(), {
        action: "to remove a speaker from the queue",
      }),
    )
    .input(z.object({ boardId: z.string().uuid(), speakerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const { meetingId } = await assertLiveRowOnAuthorizedBoard(
          ctx,
          tx,
          "guest_speaker",
          input.speakerId,
        );
        await tx.execute(sql`DELETE FROM guest_speaker WHERE id = ${input.speakerId}`);
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId,
          topic: "guest_speaker",
        });
        return { id: input.speakerId };
      });
    }),
});
