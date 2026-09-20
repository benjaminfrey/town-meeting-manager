/**
 * Phase E, wave 3, Task 3 — the minutes document router's first procedure.
 * Phase E, wave 5, Task 5 — one exported helper and still one procedure.
 * Phase E, wave 6, Task 1 — the minutes surface's server half.
 *
 * ─── What wave 6 added, and the hole it closed on the way in ──────────────
 *
 * Two reads (`detail` for `routes/meetings.$meetingId.minutes.tsx`,
 * `pendingByTown` for `routes/home.tsx`'s needs-action list) and the six
 * writes that screen makes — `saveDraft`, `submitForReview`, `approve`,
 * `publish`, `returnForAmendments`, `unpublish`. Five of the six were raw
 * Supabase `minutes_document` UPDATEs with **no authorization check of any
 * kind**, under `minutes_document_tenant_isolation` — `FOR ALL USING (town_id
 * = get_current_town_id())`, no board term, no role term. So any signed-in
 * member of any town could, until this commit, publish that town's minutes to
 * the public portal, unpublish them again, or return an adopted record to
 * draft. The sixth (`approve`) is the one that was already guarded, by
 * `routes/minutes.ts`'s `requireAdmin`.
 *
 * The hole that had to be closed BEFORE any of that could be wired is
 * `rules.ts` rule 13a: **R5 (`publish_approved_minutes`) was enforced
 * nowhere**, so the nearest existing minutes-write rule —
 * `assertCanUpdateMinutesDocument`, R1 — was the one a migration would
 * naturally reach for, and `TEMPLATE_RECORDING_SECRETARY` holds R1 WITHOUT
 * R5 by design. Publishing behind R1 would have compiled, passed, refused
 * nobody, and handed a recording secretary the public portal. See rule 13a
 * for the whole argument, including why R6 (`export_minutes`) deliberately
 * gets no rule.
 *
 * ─── Which guard each write carries, and why they are not all the same ────
 *
 *   saveDraft            R1  edit_draft_minutes      board-scoped
 *   submitForReview      R3  submit_minutes_review   board-scoped
 *   publish              R5  publish_approved_minutes board-scoped
 *   unpublish            R5  publish_approved_minutes board-scoped
 *   approve              administrator (rule 13b)    NO board
 *   returnForAmendments  administrator (rule 13b)    NO board
 *
 * The four board-scoped writes take a `boardId` the WRITE does not need — it
 * exists so a guard declared before `.input()` has something to authorize
 * (conventions item 2's stated cost) — and pay for it with
 * `assertMinutesDocumentOnAuthorizedBoard`, which re-derives the document's
 * REAL board inside the write's own transaction and refuses a mismatch.
 * `approve` and `returnForAmendments` take no `boardId` at all, because an
 * administrator's authority is town-wide: there is no claimed board to
 * mismatch, so they call `resolveMinutesDocumentScope` (the same existence
 * check and derivation, without the comparison) instead. See
 * `trpc/board-derivation.ts` for both, and for why neither reads
 * `minutes_document.board_id`.
 *
 * ─── Status preconditions: three of the six are ADDED ─────────────────────
 *
 * `submitForReview` (draft) and `approve` (review) reproduce the checks
 * `routes/minutes.ts` already makes, as `CONFLICT` rather than 400 —
 * `executiveSession.discard`'s reasoning: nothing about the caller is wrong.
 *
 * `saveDraft` (draft), `publish` (approved) and `unpublish` (published) are
 * ADDED. The raw writes had none; they were merely never reached from another
 * status because the button that issues them is rendered only in one. Stated
 * as behaviour changes per conventions item 1, and the first is the one that
 * matters: without it an R1 holder could rewrite the content of ADOPTED
 * minutes through the API — the legal record — which is exactly the lock the
 * product's own minutes workflow promises ("fully read-only after the vote
 * passes; post-adoption amendments are a separate addendum record").
 * `returnForAmendments` (review) is added for the same reason.
 *
 * ─── What a transition does to who can READ the document ──────────────────
 *
 * `rules.ts`'s rule 9 decides that from `status`, so three of these change it:
 *
 *   approve     review → approved   WIDENS: from "R4 on this board" to every
 *                                   signed-in member of the town.
 *   publish     approved → published WIDENS to the ANONYMOUS PUBLIC —
 *                                   `portalCanSelectMinutesDocument` is
 *                                   `published` only, and `routes/portal.ts`
 *                                   serves it with no session at all.
 *   unpublish   published → approved NARROWS: removes that public access and
 *                                   leaves the town-wide read.
 *
 * `submitForReview` (draft → review) and `returnForAmendments` (review →
 * draft) change nothing: both statuses are on rule 9's R4 side. `saveDraft`
 * does not touch `status`.
 *
 * ─── No realtime publish, deliberately ────────────────────────────────────
 *
 * `minutes_document` is not one of `realtime/events.ts`'s eight
 * `LIVE_MEETING_TOPICS` and no live screen reads it, so nothing here calls
 * `publishRealtimeEvent` and `router-wiring.test.ts`'s inventory does not see
 * these mutations at all. That is correct rather than an omission: the
 * inventory's ledger is for writes to the eight live tables.
 *
 * ─── Notifications are queued in the transaction, not after it ────────────
 *
 * `submitForReview`, `approve` and `publish` each queue one
 * `notification_event`, the way `approveMinutesForPassedMotion` below already
 * does. A tRPC resolver cannot build a `TenantJob` (that needs
 * `fastify.tenantDb`), so `NotificationService.createNotificationEvent`'s
 * immediate scheduling is not available and the row waits for the next
 * 60-second sweep in `server.ts`. The payloads come from
 * `services/notification-triggers.ts` so the two paths cannot drift — see
 * `minutesReviewPayload`/`minutesApprovedPayload` there, and note that
 * `payload.board_id` is not cosmetic: `getSubscribersForEvent` returns NO
 * subscribers without it.
 *
 * ─── Returns the single document or `null` (wave 3's note, unchanged) ─────
 *
 * A meeting has AT MOST one (`minutes_document_meeting_id_key` is a unique
 * constraint on `meeting_id`), unlike the raw `.limit(1)` array read
 * `byMeeting` replaces, which only ever needed its first element.
 *
 * `byMeeting` carries no permission guard: tenancy-only RLS, matching
 * `board.ts`'s reasoning, and it returns only `id` and `status` — the pill.
 * `detail` and `pendingByTown` return the document's CONTENT and therefore do
 * apply rule 9; see each one.
 */

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  router,
  protectedProcedure,
  requireActor,
  requireBoardPermission,
  boardIdFrom,
} from "../trpc.js";
import {
  assertCanApproveMinutes,
  assertCanReturnMinutesForAmendments,
  assertCanSelectMinutesDocument,
  canSelectMinutesDocument,
  visibleMinutesDocuments,
  type MinutesStatus,
} from "../authorization/rules.js";
import {
  assertMinutesDocumentOnAuthorizedBoard,
  resolveMinutesDocumentScope,
} from "../board-derivation.js";
import {
  minutesApprovedPayload,
  minutesReviewPayload,
} from "../../services/notification-triggers.js";
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
 * **The PDF re-render is NOT here — fixed in backlog 11, defect B.**
 * `live.tsx` (now `VotePanel.tsx`) used to follow the two writes with
 * `POST /api/meetings/${meetingId}/minutes/render` using the id of the LIVE
 * meeting — but the document being approved belongs to an EARLIER meeting
 * (it is reached through `agenda_item.source_minutes_document_id`). The
 * un-watermarked re-render was always requested for the wrong meeting, and
 * the live meeting usually has no minutes document at all, so the call
 * 404d into the `.catch(() => {})` that swallowed it. That render still
 * cannot happen inside THIS transaction — the render endpoint is a Fastify
 * multipart/Puppeteer route — so the fix is still a second, client-driven
 * request; it just posts the right id now. `VotePanel.tsx` posts the
 * `minutesApproved` id THIS function returns (below) to
 * `POST /api/minutes/:documentId/render` (`routes/minutes.ts`), which
 * derives its authorization from the DOCUMENT's own meeting's board — not
 * the live meeting's — via the same `assertCanUpdateMinutesDocument` (R1)
 * the meeting-keyed route uses, so the two cannot drift on who may
 * re-render. A failure is surfaced with a toast rather than swallowed.
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

  // The payload comes from `minutesApprovedPayload`, the same helper
  // `submitForReview`/`approve`/`publish` use, and not from a hand-built object
  // — because a hand-built one is how this path shipped without `board_id`, and
  // `getSubscribersForEvent` returns NO subscribers without it: the "minutes
  // approved" email a board vote queued here reached nobody (backlog 12, fixed
  // 2026-09-20). The helper also carries the town, board and date the email
  // template renders. `approved_by_motion_id` is added on top: it is this
  // path's own fact, and nothing else queues it.
  //
  // A null payload means the meeting vanished between the UPDATE above and
  // here, inside one transaction — impossible without a concurrent delete that
  // RLS would have to allow. Queuing an event nobody can be found for is the
  // bug this fixes, so it throws rather than writing one.
  const payload = await minutesApprovedPayload(tx, args.meetingId, documentId);
  if (!payload) {
    throw new Error(
      `minutesDocument.approveMinutesForPassedMotion: meeting ${args.meetingId} has no ` +
        "notification context, so the minutes_approved event would reach nobody",
    );
  }
  await tx.execute(sql`
    INSERT INTO notification_event (town_id, event_type, payload, status)
    VALUES (
      ${args.townId}, 'minutes_approved',
      ${JSON.stringify({ ...payload, approved_by_motion_id: args.motionId })}::jsonb,
      'pending'::notification_status
    )
  `);

  return documentId;
}

/**
 * An entry in `minutes_document.amendments_history`.
 *
 * The shape is `minutes.tsx`'s `AmendmentEntry`, carried over unchanged — the
 * column is `jsonb` with a `'[]'` default and enforces nothing, so this
 * describes what the product writes rather than what the database guarantees.
 */
interface AmendmentEntry {
  round: number;
  returned_at: string;
  reason: string;
  returned_by: string;
  resubmitted_at: string | null;
}

/**
 * Read `amendments_history` as a list, treating anything else as empty.
 *
 * The same leniency `executiveSession.appendPostSessionActionMotions` applies
 * to `post_session_action_motion_ids`, and for the same reason: the column is
 * nullable `jsonb`, so "an array of objects" is what it holds in practice and
 * not what it promises. `minutes.tsx` does the identical thing in the browser
 * (`Array.isArray(raw) ? raw : JSON.parse(raw) ?? []`).
 */
function amendmentsOf(stored: unknown): AmendmentEntry[] {
  return Array.isArray(stored) ? (stored as AmendmentEntry[]) : [];
}

/**
 * Refuse a transition attempted from the wrong status.
 *
 * `CONFLICT`, not `FORBIDDEN` or `BAD_REQUEST`: nothing about this caller or
 * this request is wrong — the document simply moved on, usually because
 * another clerk acted first. `executiveSession.discard` makes the same choice
 * for the same reason. `routes/minutes.ts` answers 400 for the two cases it
 * checks; that difference is deliberate and is stated in this file's header.
 */
function assertStatusIs(actual: MinutesStatus, required: MinutesStatus, what: string): void {
  if (actual === required) return;
  throw new TRPCError({
    code: "CONFLICT",
    message: `These minutes are ${actual}, not ${required}, so they cannot be ${what}.`,
  });
}

/** Queue one notification event inside the caller's own transaction. */
async function queueNotification(
  tx: TenantTx,
  townId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO notification_event (town_id, event_type, payload, status)
    VALUES (${townId}, ${eventType}, ${JSON.stringify(payload)}::jsonb, 'pending'::notification_status)
  `);
}

export const minutesDocumentRouter = router({
  byMeeting: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const actor = await ctx.actor();
      return ctx.withTenant(async (tx) => {
        await assertMeetingExists(tx, input.meetingId);
        // `m.board_id` is read for rule 9 and never returned — the board is the
        // meeting's, and a caller wanting one asks `meeting.detail`. Same join
        // and same reason as `detail` below.
        const rows = toRows<{
          id: string;
          // Written out rather than `MinutesStatus` for the reason `detail`
          // records below: a named type from `authorization/rules.js` in a
          // procedure's OUTPUT makes `packages/web`'s inferred `trpc` client
          // unnameable (TS2742).
          status: "draft" | "review" | "approved" | "published";
          board_id: string;
        }>(
          await tx.execute(sql`
            SELECT md.id, md.status::text AS status, m.board_id
              FROM minutes_document md
              JOIN meeting m ON m.id = md.meeting_id
             WHERE md.meeting_id = ${input.meetingId}
             LIMIT 1
          `),
          (message) => new Error(`minutesDocument.byMeeting: ${message}`),
        );
        const row = rows[0];
        if (!row) return null;
        // Rule 9 (`minutes_document_select`) gated EVERY column of an unadopted
        // row behind R4, including the id and the status this returns: the
        // existence and workflow state of a draft — an executive session's
        // included — is not public to the town. `detail` and `pendingByTown`
        // applied it; this read did not (backlog 17).
        //
        // NULL, not a throw, and that is a deliberate difference from `detail`:
        // this procedure answers "is there a minutes document for this meeting"
        // for `meetings.$meetingId.tsx` and `review.tsx`, both of which treat
        // null as "nothing to show". A refusal would turn an ordinary screen
        // into an error for a caller who merely may not see a draft yet. The
        // caller that wants the document itself gets the refusal, from
        // `detail`.
        if (!canSelectMinutesDocument(actor, { status: row.status, boardId: row.board_id })) {
          return null;
        }
        return { id: row.id, status: row.status };
      });
    }),

  /**
   * The whole document `routes/meetings.$meetingId.minutes.tsx` renders.
   *
   * Replaces that screen's `supabase.from("minutes_document").select("*")
   * .eq("meeting_id", meetingId).limit(1)`. Two differences from that query,
   * both deliberate (conventions item 1):
   *
   * **Columns are explicit, so five stop being returned.** `town_id` and
   * `board_id` are tenancy/denormalisation bookkeeping the screen never reads
   * (and `board_id` is the column nothing may authorize on — see
   * `board-derivation.ts`); `created_by` and `search_vector` are unread;
   * `pdf_storage_path` is a path on the API's own disk and becomes the boolean
   * `has_pdf`, which is the only thing a caller can act on — the bytes are at
   * `GET /api/files/minutes/:id`, which applies rule 9 itself on every fetch.
   *
   * **Rule 9 is APPLIED, and it was not before.** `select("*")` under a
   * tenancy-only policy handed any signed-in member of the town the full text
   * of a DRAFT — unadopted minutes of an executive session are the single most
   * sensitive document this product holds. `assertCanSelectMinutesDocument`
   * (R4 for this board, or the document is approved/published) now decides,
   * against the board derived through the meeting. That is a narrowing, and
   * the screen's own client-side `canView` gate already expressed the same
   * rule — it simply had nothing behind it.
   *
   * A meeting with no document yet is `null`, not `NOT_FOUND`: the screen
   * renders an empty state for it, exactly as `byMeeting` does for the pill.
   *
   * **`generated_at` does not exist on this table** and never has, so
   * `minutes.tsx`'s "Generated" timeline step reads `undefined` and renders
   * without a timestamp. `created_at` is the column that actually records it
   * and is returned here; wiring the step to it is Task 3's, not a silent
   * rename made here.
   */
  detail: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const actor = await ctx.actor();
      return ctx.withTenant(async (tx) => {
        await assertMeetingExists(tx, input.meetingId);
        const rows = toRows<{
          id: string;
          meeting_id: string;
          board_id: string;
          // The union is written out rather than imported as `MinutesStatus`:
          // this shape is the procedure's OUTPUT, and a named type from
          // `authorization/rules.js` in it makes `packages/web`'s inferred
          // `trpc`/`trpcClient` unnameable (TS2742) — the client only
          // references the routers' own declaration files.
          status: "draft" | "review" | "approved" | "published";
          content_json: unknown;
          original_content_json: unknown;
          amendments_history: unknown;
          html_rendered: string | null;
          minutes_style: string;
          generated_by: string;
          approved_as_amended: boolean;
          approved_at: string | null;
          approved_by_motion_id: string | null;
          submitted_for_review_at: string | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
          has_pdf: boolean;
        }>(
          await tx.execute(sql`
            SELECT md.id,
                   md.meeting_id,
                   m.board_id,
                   md.status::text AS status,
                   md.content_json,
                   md.original_content_json,
                   md.amendments_history,
                   md.html_rendered,
                   md.minutes_style,
                   md.generated_by::text AS generated_by,
                   md.approved_as_amended,
                   md.approved_at,
                   md.approved_by_motion_id,
                   md.submitted_for_review_at,
                   md.published_at,
                   md.created_at,
                   md.updated_at,
                   (md.pdf_storage_path IS NOT NULL) AS has_pdf
            FROM minutes_document md
            JOIN meeting m ON m.id = md.meeting_id
            WHERE md.meeting_id = ${input.meetingId}
          `),
          (message) => new Error(`minutesDocument.detail: ${message}`),
        );
        const row = rows[0];
        if (!row) return null;
        assertCanSelectMinutesDocument(actor, { status: row.status, boardId: row.board_id });
        // `board_id` is read for the rule and not returned: it is the meeting's
        // column, and a caller that wants a board should ask `meeting.detail`
        // rather than learn one from a shape that also carries a denormalised
        // `minutes_document.board_id` nobody may trust.
        const { board_id: _boardId, ...document } = row;
        return document;
      });
    }),

  /**
   * Every unadopted minutes document in the town — `routes/home.tsx`'s
   * needs-action list, and the procedure its `TODO(phase-e-wave-6)` marker
   * names.
   *
   * Replaces `supabase.from("minutes_document").select("meeting_id, status")
   * .eq("town_id", townId).in("status", ["draft", "review"])`. Three
   * differences:
   *
   * **The `town_id` filter is gone**, because `ctx.withTenant` IS that filter
   * — `minutes_document_tenant_isolation` restricts every row this query can
   * see to `get_current_town_id()`. Not a widening: it is the same predicate,
   * moved from a value the browser supplied to one the session establishes.
   *
   * **Rule 9 is applied per row**, through `visibleMinutesDocuments` rather
   * than `assertCanSelectMinutesDocument` — a list endpoint that threw on the
   * first invisible row would be unusable (rules.ts header, point 3). Every
   * row here is `draft` or `review` by construction, so every row needs R4 on
   * ITS OWN board: this is the case the per-row form exists for, since the
   * list spans boards and one `scope` argument would answer for the first
   * board and apply it to all of them. That is a narrowing — today's query
   * checks nothing, so an account with no R4 anywhere sees a count of every
   * unadopted document in the town.
   *
   * **The board arrives by join**, for the reason `board-derivation.ts`
   * states at length: `minutes_document.board_id` is nullable and
   * denormalised, and a NULL there would have to be resolved globally, which
   * answers "no" to every `designated_boards` account.
   *
   * No `ORDER BY`, matching the query it replaces (the screen keys the rows
   * into a map by `meeting_id`).
   *
   * No `assertMeetingExists`-style parity check: there is no id in the input
   * to be wrong about.
   */
  pendingByTown: protectedProcedure.query(async ({ ctx }) => {
    const actor = await ctx.actor();
    return ctx.withTenant(async (tx) => {
      const rows = toRows<{
        meeting_id: string;
        // Written out rather than imported, for the TS2742 reason `detail`
        // above records.
        status: "draft" | "review" | "approved" | "published";
        boardId: string;
      }>(
        await tx.execute(sql`
          SELECT md.meeting_id, md.status::text AS status, m.board_id AS "boardId"
          FROM minutes_document md
          JOIN meeting m ON m.id = md.meeting_id
          WHERE md.status IN ('draft'::minutes_document_status, 'review'::minutes_document_status)
        `),
        (message) => new Error(`minutesDocument.pendingByTown: ${message}`),
      );
      return visibleMinutesDocuments(actor, rows).map(({ meeting_id, status }) => ({
        meeting_id,
        status,
      }));
    });
  }),

  /**
   * `minutes.tsx`'s `saveDraftMutation` — the clerk's edits to the minutes
   * text.
   *
   * R1 (`edit_draft_minutes`), board-scoped, through `requireBoardPermission`
   * — the same `assertPermission` call `assertCanUpdateMinutesDocument` makes
   * (conventions item 2's "reach for it FIRST" for a single-code rule).
   *
   * The `draft`-only precondition is ADDED; see this file's header. The raw
   * write had none, which meant an R1 holder could rewrite the content of
   * ADOPTED minutes — the legal record the whole review workflow exists to
   * fix in place.
   *
   * The PDF re-render (`POST /api/meetings/:id/minutes/render`) is NOT folded
   * in and stays a separate, best-effort call from the screen: it is a
   * Puppeteer route that cannot join this transaction, and the content is
   * already saved when it runs. Same reasoning `approveMinutesForPassedMotion`
   * above gives for leaving its own re-render out.
   */
  saveDraft: protectedProcedure
    .use(requireBoardPermission("R1", boardIdFrom(), { action: "to edit minutes" }))
    .input(
      z.object({
        boardId: z.string().uuid(),
        minutesDocumentId: z.string().uuid(),
        contentJson: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const scope = await assertMinutesDocumentOnAuthorizedBoard(
          ctx,
          tx,
          input.minutesDocumentId,
        );
        assertStatusIs(scope.status, "draft", "edited");
        await tx.execute(sql`
          UPDATE minutes_document
             SET content_json = ${JSON.stringify(input.contentJson)}::jsonb,
                 updated_at = now()
           WHERE id = ${input.minutesDocumentId}
        `);
        return { id: input.minutesDocumentId };
      });
    }),

  /**
   * `minutes.tsx`'s `submitForReviewMutation`, and `POST
   * /api/meetings/:id/minutes/submit`, as ONE transaction.
   *
   * The screen used to do both: a raw Supabase UPDATE to `review`, then an
   * `apiFetch` to a route that sets `status = 'review'` AGAIN and queues the
   * notification, with the second call's failure swallowed. Two writes of the
   * same column across two round trips, with the amendment bookkeeping in the
   * browser between them.
   *
   * R3 (`submit_minutes_review`), board-scoped — the same code the Fastify
   * route resolves through `assertCanSubmitMinutesForReview`, so the
   * authorization is reconciled rather than re-invented (conventions item 2's
   * "reconcile the authorization, not the transport").
   *
   * **The amendment resubmission stamp moves into the transaction**, which
   * fixes a read-modify-write the browser was doing across a round trip: it
   * read `amendments_history`, edited the last entry and wrote the whole array
   * back, so two clerks acting at once silently dropped one another's round.
   * `FOR UPDATE` here makes the second wait instead — the same fix
   * `executiveSession.appendPostSessionActionMotions` makes for the same
   * shape.
   */
  submitForReview: protectedProcedure
    .use(requireBoardPermission("R3", boardIdFrom(), { action: "to submit minutes for review" }))
    .input(z.object({ boardId: z.string().uuid(), minutesDocumentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const scope = await assertMinutesDocumentOnAuthorizedBoard(
          ctx,
          tx,
          input.minutesDocumentId,
        );
        assertStatusIs(scope.status, "draft", "submitted for review");

        const locked = toRows<{ amendments_history: unknown }>(
          await tx.execute(sql`
            SELECT amendments_history FROM minutes_document
             WHERE id = ${input.minutesDocumentId}
             FOR UPDATE
          `),
          (message) => new Error(`minutesDocument.submitForReview: ${message}`),
        );
        const history = amendmentsOf(locked[0]?.amendments_history);
        const latest = history[history.length - 1];
        const resubmitted =
          latest && latest.resubmitted_at === null
            ? [...history.slice(0, -1), { ...latest, resubmitted_at: new Date().toISOString() }]
            : history;

        await tx.execute(sql`
          UPDATE minutes_document
             SET status = 'review'::minutes_document_status,
                 submitted_for_review_at = now(),
                 amendments_history = ${JSON.stringify(resubmitted)}::jsonb,
                 updated_at = now()
           WHERE id = ${input.minutesDocumentId}
        `);

        const payload = await minutesReviewPayload(tx, scope.meetingId, input.minutesDocumentId);
        if (payload) {
          await queueNotification(tx, ctx.tenant.townId, "minutes_review", payload);
        }
        return { id: input.minutesDocumentId, status: "review" as const };
      });
    }),

  /**
   * The board adopts the minutes — `minutes.tsx`'s `approveMutation`, which
   * today is `POST /api/meetings/:id/minutes/approve`.
   *
   * **Administrator only, and no board id at all** (rule 13b). That
   * reproduces the Fastify route's `requireAdmin` exactly; making adoption
   * delegable is a product decision that route's own comment has had open
   * since Task G1, and a migration is not where it gets made. Consequences
   * worth stating because they look like omissions:
   *
   *   - There is no `boardId` input, so there is no claimed board and no
   *     mismatch to defend against — `resolveMinutesDocumentScope` is called
   *     rather than `assertMinutesDocumentOnAuthorizedBoard`, and calling the
   *     latter would throw `assertMatchesAuthorizedBoard`'s wiring `Error`
   *     because `requireActor` sets no `ctx.authorizedBoardId`.
   *   - The cross-tenant defence is therefore the existence check ALONE,
   *     with no mismatch defence behind it. That does not mean a missing
   *     check would write another town's row — RLS covers an UPDATE on
   *     `minutes_document` (probed; see `resolveMinutesDocumentScope`) — it
   *     means this procedure would report SUCCESS for an adoption that
   *     changed nothing, which is the answer a caller cannot act on.
   *
   * This is NOT the only way minutes get approved. `approveMinutesForPassedMotion`
   * above is the other — a board voting a minutes-approval motion through in a
   * live meeting — and the two differ deliberately: that one is idempotent
   * under concurrent callers (`AND status <> 'approved'`) because every
   * connected client used to race it, records the carrying motion, and accepts
   * any prior status. This one is a deliberate administrative act from the
   * review screen and refuses anything but `review`, exactly as the route it
   * replaces does.
   */
  approve: protectedProcedure
    .use(requireActor(assertCanApproveMinutes))
    .input(z.object({ minutesDocumentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const scope = await resolveMinutesDocumentScope(tx, input.minutesDocumentId);
        assertStatusIs(scope.status, "review", "approved");

        await tx.execute(sql`
          UPDATE minutes_document
             SET status = 'approved'::minutes_document_status,
                 approved_at = now(),
                 updated_at = now()
           WHERE id = ${input.minutesDocumentId}
        `);

        const payload = await minutesApprovedPayload(tx, scope.meetingId, input.minutesDocumentId);
        if (payload) {
          await queueNotification(tx, ctx.tenant.townId, "minutes_approved", payload);
        }
        return { id: input.minutesDocumentId, status: "approved" as const };
      });
    }),

  /**
   * Put adopted minutes on the public portal — `minutes.tsx`'s
   * `publishMutation`.
   *
   * **This is the write rule 13a exists for.** Before this commit it was a
   * raw Supabase UPDATE gated only by a button the browser chose to render,
   * and R5 (`publish_approved_minutes`) was enforced nowhere in
   * `packages/api`. The guard is `requireBoardPermission("R5", …)`, which is
   * `assertCanPublishMinutes`'s own `assertPermission` call; the actor this
   * rule exists to refuse is the R1-without-R5 shape both
   * `TEMPLATE_RECORDING_SECRETARY` and `TEMPLATE_DEPUTY_CLERK` create, and
   * `minutes-document.test.ts` pins exactly that actor so the widening cannot
   * come back unnoticed.
   *
   * `approved`-only is ADDED (this file's header). Publishing a DRAFT would
   * put an unadopted record — including the minutes of an executive session —
   * in front of the anonymous public, which is precisely what `status`
   * controls: `portalCanSelectMinutesDocument` is `published` only, and this
   * transition is the one that satisfies it.
   *
   * The notification payload is the three keys `minutes.tsx` posts to
   * `/api/notifications/events` today, unchanged — deliberately NOT enriched
   * the way `minutes_approved`'s is. `minutes_published` renders the
   * `minutes-approved` template, so today's published email already shows an
   * empty board name and date; that is a pre-existing defect to fix with the
   * template's owner, not to fix silently inside a migration. What the three
   * keys DO include is `board_id`, which is not cosmetic —
   * `getSubscribersForEvent` returns no subscribers at all without it.
   */
  publish: protectedProcedure
    .use(
      requireBoardPermission("R5", boardIdFrom(), {
        action: "to publish approved minutes to the public portal",
      }),
    )
    .input(z.object({ boardId: z.string().uuid(), minutesDocumentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const scope = await assertMinutesDocumentOnAuthorizedBoard(
          ctx,
          tx,
          input.minutesDocumentId,
        );
        assertStatusIs(scope.status, "approved", "published");

        await tx.execute(sql`
          UPDATE minutes_document
             SET status = 'published'::minutes_document_status,
                 published_at = now(),
                 updated_at = now()
           WHERE id = ${input.minutesDocumentId}
        `);

        await queueNotification(tx, ctx.tenant.townId, "minutes_published", {
          meeting_id: scope.meetingId,
          board_id: scope.boardId,
          minutes_document_id: input.minutesDocumentId,
        });
        return { id: input.minutesDocumentId, status: "published" as const };
      });
    }),

  /**
   * The board declines to adopt — `minutes.tsx`'s
   * `returnForAmendmentsMutation`. Administrator only (rule 13b), the same
   * gate as `approve`: these are the two outcomes of one decision, and the
   * screen already shows them as a pair in the `review` state.
   *
   * Appends a round to `amendments_history`, clears
   * `submitted_for_review_at`, and returns the document to `draft` so the
   * clerk can edit it again. The append happens under `FOR UPDATE` inside this
   * transaction rather than as a browser-side read-modify-write, for the
   * reason `submitForReview` gives.
   *
   * `returned_by` is `ctx.tenant.userAccountId` — a `user_account.id`, which
   * is what `minutes.tsx` wrote (`user?.id`, and `CurrentUser.id` is
   * documented as "`user_account.id` — NOT the auth provider's user id"). The
   * semantic is preserved rather than quietly upgraded to a `person.id`; what
   * is dropped is the `?? ""` fallback, which cannot arise here because a
   * `protectedProcedure` has a resolved tenant by definition.
   */
  returnForAmendments: protectedProcedure
    .use(requireActor(assertCanReturnMinutesForAmendments))
    .input(
      z.object({
        minutesDocumentId: z.string().uuid(),
        reason: z.string().trim().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const scope = await resolveMinutesDocumentScope(tx, input.minutesDocumentId);
        assertStatusIs(scope.status, "review", "returned for amendments");

        const locked = toRows<{ amendments_history: unknown }>(
          await tx.execute(sql`
            SELECT amendments_history FROM minutes_document
             WHERE id = ${input.minutesDocumentId}
             FOR UPDATE
          `),
          (message) => new Error(`minutesDocument.returnForAmendments: ${message}`),
        );
        const history = amendmentsOf(locked[0]?.amendments_history);
        const appended: AmendmentEntry[] = [
          ...history,
          {
            round: history.length + 1,
            returned_at: new Date().toISOString(),
            reason: input.reason,
            returned_by: ctx.tenant.userAccountId,
            resubmitted_at: null,
          },
        ];

        await tx.execute(sql`
          UPDATE minutes_document
             SET status = 'draft'::minutes_document_status,
                 submitted_for_review_at = NULL,
                 amendments_history = ${JSON.stringify(appended)}::jsonb,
                 updated_at = now()
           WHERE id = ${input.minutesDocumentId}
        `);
        return { id: input.minutesDocumentId, status: "draft" as const };
      });
    }),

  /**
   * Take published minutes back off the public portal — `minutes.tsx`'s
   * `unpublishMutation`.
   *
   * **R5, the same code as `publish`**, not the administrator gate the button
   * currently carries. Rule 13a records the argument and the exact delta:
   * undoing the act a code governs is that code's (rule 21b makes the
   * identical call for `executive_session`'s DELETE being M6), and an
   * authority that can publish but cannot retract cannot correct its own
   * mistake — `TEMPLATE_TOWN_CLERK` grants R5 to a `staff` account, so "ask an
   * administrator" is a real cost. Against the SERVER this is an enormous
   * narrowing (from nothing to R5); against the BUTTON it widens from
   * administrators to administrators-plus-R5-holders, and that half is the
   * decision to overturn if the owner disagrees — but it is TWO lines, not
   * one. Swapping only the `.use()` below to `requireActor(assertAdmin, ...)`
   * is not enough and is worse than doing nothing: `ctx.authorizedBoardId` is
   * then never set, and `assertMinutesDocumentOnAuthorizedBoard` below still
   * calls `assertMatchesAuthorizedBoard`, which throws its wiring `Error` —
   * reproduced directly, an admin caller gets a 500, not a working
   * admin-only unpublish. The second line is trading
   * `assertMinutesDocumentOnAuthorizedBoard` for `resolveMinutesDocumentScope`
   * a few lines below, dropping the board comparison entirely — after which
   * `input.boardId` is dead, and this procedure authorizes no board at all,
   * the same shape rule 13b already uses for `approve`/`returnForAmendments`.
   *
   * `published`-only is ADDED, and it is what stops this from being a general
   * "set status to approved" primitive: `approved_at` and the adoption itself
   * are untouched, so this removes public access and nothing else.
   */
  unpublish: protectedProcedure
    .use(
      requireBoardPermission("R5", boardIdFrom(), {
        action: "to take published minutes off the public portal",
      }),
    )
    .input(z.object({ boardId: z.string().uuid(), minutesDocumentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const scope = await assertMinutesDocumentOnAuthorizedBoard(
          ctx,
          tx,
          input.minutesDocumentId,
        );
        assertStatusIs(scope.status, "published", "unpublished");

        await tx.execute(sql`
          UPDATE minutes_document
             SET status = 'approved'::minutes_document_status,
                 published_at = NULL,
                 updated_at = now()
           WHERE id = ${input.minutesDocumentId}
        `);
        return { id: input.minutesDocumentId, status: "approved" as const };
      });
    }),
});
