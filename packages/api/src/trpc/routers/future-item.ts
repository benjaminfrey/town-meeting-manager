/**
 * Phase E, wave 6, Task 2 — the future item queue's only read.
 *
 * `routes/meetings.$meetingId.review.tsx` reads `future_item_queue` through
 * the dead Supabase client (`select("*").eq("source_meeting_id", meetingId)`)
 * and no router for this table existed anywhere in `packages/api` before this
 * task — confirmed by `find packages/api/src/trpc/routers -iname
 * "future-item*"` returning nothing. `rules.ts` already has
 * `assertCanInsertFutureItem` (rule 21e, wave 5) for the table's one WRITE
 * path — inside `meeting.performAdjournment` — but nothing had ever read it
 * back through tRPC. This read appears in none of this wave's eight
 * `TODO(phase-e-wave-6)` markers; it is only findable by migrating the screen
 * that uses it, which is why it is named directly in this task's brief rather
 * than left for the completeness sweep.
 *
 * ─── One read, and no write here — the write already has a home ───────────
 *
 * Every `future_item_queue` row is written by adjourning a meeting
 * (`meeting.performAdjournment`'s two INSERT…SELECT statements, wave 5, Task
 * 5) or, when the product eventually offers it, by placing a queued item onto
 * a real agenda (an `agenda_item` INSERT, rule 1's business, not this
 * table's). No screen inserts, updates or deletes a `future_item_queue` row
 * directly, so this file carries no `.mutation(` and needs none — the same
 * shape `agenda-item-transition.ts` documents for its own read-only table,
 * for the analogous reason: a queue row and the adjournment that created it
 * must not be written from two different places under two different rules.
 *
 * ─── `future_item_queue`'s board is its OWN column, not a join ───────────
 *
 * `board_derivation.ts`'s header already states this precisely, for the
 * benefit of whoever reaches for it next: `future_item_queue` carries
 * `board_id uuid NOT NULL` directly (`0000_baseline.sql:1248`), while its
 * `source_meeting_id` is NULLABLE (`:1250`) — verified again here rather than
 * only cited, since this is the file that actually reads the table. Deriving
 * the board through `source_meeting_id → meeting.board_id`, the way six other
 * live-meeting tables do (`board-derivation.ts`'s `MEETING_SCOPED_TABLES`),
 * would produce NULL for any item whose source meeting was later deleted —
 * `future_item_queue_source_meeting_id_fkey` is `ON DELETE SET NULL`
 * (`0000_baseline.sql:3352`), so that is not a hypothetical, it is the
 * column's own designed behaviour. This procedure does not need the board at
 * all — see below — but the fact stands for the day a board-scoped write
 * against this table needs it: read `board_id` directly, never derive it.
 *
 * ─── This read is scoped by MEETING, not by board, and does not need the
 * board column at all ─────────────────────────────────────────────────────
 *
 * `routes/meetings.$meetingId.review.tsx`'s query filters on
 * `source_meeting_id`, matching the one screen this table is read from — the
 * post-meeting review page, which wants "what did THIS meeting defer or
 * table," not "what is queued for this board" (that would be a different,
 * not-yet-built screen, and a different query). So `byMeeting` takes a
 * `meetingId`, exactly the shape `agenda-item-transition.ts`,
 * `meeting-attendance.ts` and `agenda-item.ts`'s `countByMeeting` already
 * establish for a meeting-scoped read with no board involvement.
 *
 * ─── The existence check, and the mutation evidence for it ────────────────
 *
 * `future_item_queue_tenant_isolation` (`0000_baseline.sql`) is a plain
 * `FOR ALL USING (town_id = get_current_town_id())` — tenancy-only, no board
 * or role predicate — and the raw Supabase read this replaces had no
 * application-level check either, so `protectedProcedure` with no permission
 * guard is the same policy carried forward (conventions item 2's "a read
 * whose old policy was tenancy-only gets `protectedProcedure` and no guard").
 * No `assertCanSelectFutureItem` exists in `rules.ts` (checked: `grep -n
 * "^export function assertCanSelect" authorization/rules.ts` finds eight such
 * functions, one each for `minutes_document`, `meeting_document` (a distinct
 * table from `meeting`), `exhibit`, `notification_event`,
 * `notification_delivery`, `subscriber_preference`, `town_notification_config`
 * and `audit_log` — none for `future_item_queue`) and none is needed for the
 * same reason.
 *
 * But a permission guard and an existence check answer different questions.
 * `meetingId` is a foreign id the CALLER supplies, and `WHERE
 * source_meeting_id = $1` is a correlated scan: for a meeting in another
 * town, RLS makes every `future_item_queue` row that meeting could ever have
 * invisible, so the scan returns `[]` — structurally indistinguishable from a
 * real meeting in the caller's own town with nothing queued. Reproduced by
 * mutation rather than assumed: with `assertMeetingExists` removed,
 * `futureItem.byMeeting({ meetingId: <another town's meeting> })` returns
 * `[]` instead of throwing; with the call restored it throws NOT_FOUND, which
 * is what "answers NOT_FOUND for a meeting in another town" below pins.
 * `assertMeetingExists` (`meeting.ts`) is the same check every other
 * meeting-scoped reader in this phase already runs first, for the identical
 * reason.
 *
 * ─── What is preserved from the replaced query, and what is added ────────
 *
 * Columns: `id`, `title`, `description`, `source`, `status` — exactly what
 * `review.tsx`'s own mapping reads off each row (`fi.id`, `fi.title`,
 * `fi.description`, `fi.source`, `fi.status`), not the raw query's
 * `select("*")`, which also carries `board_id`, `town_id`,
 * `source_agenda_item_id`, `dismissed_reason`, `placed_agenda_item_id` and
 * `created_at` that nothing on that screen reads — conventions item 1, "not
 * `SELECT *`, unlike the query this replaces."
 *
 * `ORDER BY created_at, id` is ADDED: the raw query carries no `.order(...)`
 * at all, so its result order is whatever Postgres's planner happens to
 * return for an unordered scan. `created_at` is not itself read by the
 * screen (it filters to `status === "pending"` client-side and renders the
 * array in whatever order it arrives), so this is the same choice
 * `boardMember.listByTown` makes for its own unordered source query: nothing
 * downstream depends on a PARTICULAR order, but a deterministic one — oldest
 * queued first, which is also the order items would need to be worked
 * through — is strictly better than an unspecified one, and costs nothing no
 * existing consumer relies on. The `id` tiebreak is the same defensive
 * addition every ordered read in this phase carries for two rows sharing a
 * timestamp.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import { assertMeetingExists } from "./meeting.js";
import { toRows } from "../../db/rows.js";

export const futureItemRouter = router({
  byMeeting: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertMeetingExists(tx, input.meetingId);
        return toRows<{
          id: string;
          title: string;
          description: string | null;
          source: string;
          status: string;
        }>(
          await tx.execute(sql`
            SELECT id, title, description, source, status
            FROM future_item_queue
            WHERE source_meeting_id = ${input.meetingId}
            ORDER BY created_at ASC, id
          `),
          (message) => new Error(`futureItem.byMeeting: ${message}`),
        );
      });
    }),
});
