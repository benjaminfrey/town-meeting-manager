/**
 * Phase E, wave 3, Task 3 — the minutes document router's first procedure.
 * Phase E, wave 5, Task 5 — one exported helper and still one procedure.
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
import type { TenantTx } from "../../db/with-tenant.js";

/**
 * The two phrases `live.tsx` treated as "approved AS AMENDED", carried over
 * verbatim from its own `motionText.includes(...)` test — lower-cased before
 * the comparison, exactly as that code did.
 */
const AS_AMENDED_PHRASES = ["as amended", "with corrections"] as const;

/**
 * Approve the minutes a passed motion was about, and queue the notification —
 * Phase E, wave 5, Task 5, and NOT a procedure.
 *
 * ─── Why it is a helper and not a mutation ────────────────────────────────
 *
 * This was `live.tsx`'s minutes-approval `useEffect`: every connected client
 * watched every motion on the meeting, and when one attached to a
 * minutes-approval agenda item flipped to `passed`, EVERY one of them wrote
 * `minutes_document` and inserted a `notification_event`. The only thing
 * stopping two clerks from queuing two "minutes approved" emails was an
 * in-memory `useRef<Set>` per browser tab. There was no authorization check of
 * any kind on either write.
 *
 * The fix is not a procedure the clients race to call more politely — it is
 * for the write to happen once, in the transaction that made the motion pass.
 * `voteRecord.recordForMotion` is the only thing in this product that can move
 * a motion to `passed` (see `routers/motion.ts`'s header), so that is where
 * this is called from, and this is the body it calls.
 *
 * ─── Idempotent under two concurrent callers ──────────────────────────────
 *
 * `WHERE ... AND status <> 'approved'` is the whole guard, and it works
 * because of what READ COMMITTED does to a blocked UPDATE: the second
 * transaction waits on the first's row lock and then re-evaluates its own
 * WHERE clause against the COMMITTED row, which by then says `approved`. It
 * matches nothing, `RETURNING id` is empty, and the `notification_event`
 * INSERT below never runs. No advisory lock, no `FOR UPDATE`, no application
 * check-then-write window.
 *
 * ─── What is preserved, and the one defect that is not fixed here ─────────
 *
 * The five written columns, the `as amended` / `with corrections` phrase test,
 * and the notification's `event_type` and three payload keys are the browser's,
 * unchanged. `approved_by_motion_id` is the motion that carried; `updated_at`
 * is written explicitly because this column has no trigger behind it.
 *
 * **The PDF re-render is NOT here, and its target is wrong today.**
 * `live.tsx` followed the two writes with
 * `POST /api/meetings/${meetingId}/minutes/render` using the id of the LIVE
 * meeting — but the document being approved belongs to an EARLIER meeting
 * (it is reached through `agenda_item.source_minutes_document_id`). So the
 * un-watermarked re-render has always been requested for the wrong meeting,
 * and the live meeting usually has no minutes document at all, so the call
 * 404s into the `.catch(() => {})` that swallows it. That is a live defect;
 * it is reproduced rather than repaired, because the render endpoint is a
 * Fastify multipart/Puppeteer route that cannot join this transaction and
 * because which document should be re-rendered is a minutes-surface question,
 * which is wave 6's. See `VotePanel.tsx`, which still issues exactly the call
 * the browser issued before, against exactly the same meeting id.
 */
export async function approveMinutesForPassedMotion(
  tx: TenantTx,
  args: { townId: string; meetingId: string; motionId: string; motionText: string },
): Promise<string | null> {
  const items = toRows<{ source_minutes_document_id: string | null }>(
    await tx.execute(sql`
      SELECT ai.source_minutes_document_id
      FROM agenda_item ai
      JOIN motion m ON m.agenda_item_id = ai.id
      WHERE m.id = ${args.motionId}
    `),
    (message) => new Error(`minutesDocument.approveMinutesForPassedMotion: ${message}`),
  );
  const documentId = items[0]?.source_minutes_document_id ?? null;
  if (documentId === null) return null;

  const lowered = args.motionText.toLowerCase();
  const asAmended = AS_AMENDED_PHRASES.some((phrase) => lowered.includes(phrase));

  const approved = toRows<{ id: string }>(
    await tx.execute(sql`
      UPDATE minutes_document SET
        status = 'approved'::minutes_document_status,
        approved_at = now(),
        approved_by_motion_id = ${args.motionId},
        approved_as_amended = ${asAmended},
        updated_at = now()
      WHERE id = ${documentId} AND status <> 'approved'::minutes_document_status
      RETURNING id
    `),
    (message) => new Error(`minutesDocument.approveMinutesForPassedMotion: ${message}`),
  );
  if (!approved[0]) return null;

  await tx.execute(sql`
    INSERT INTO notification_event (town_id, event_type, payload, status)
    VALUES (
      ${args.townId}, 'minutes_approved',
      jsonb_build_object(
        'minutes_document_id', ${documentId}::text,
        'meeting_id', ${args.meetingId}::text,
        'approved_by_motion_id', ${args.motionId}::text
      ),
      'pending'::notification_status
    )
  `);

  return documentId;
}

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
