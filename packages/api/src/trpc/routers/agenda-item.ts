/**
 * Phase E, wave 4, Task 1 — the agenda item router.
 *
 * Wave 3, Task 3 created this file with one procedure (`countByMeeting`, the
 * "N items" badge on `routes/meetings.$meetingId.tsx`'s shell) precisely so
 * this task would extend a router rather than create one. It now carries the
 * agenda builder's read and every `agenda_item` write the product performs.
 *
 * ─── The board is behind a JOIN, and that is this task's whole point ───────
 *
 * `agenda_item` has **no `board_id` column** (`db/schema.ts`). Its board is
 * its meeting's:
 *
 *     SELECT m.board_id FROM agenda_item ai
 *     JOIN meeting m ON m.id = ai.meeting_id WHERE ai.id = $1
 *
 * Wave 3's mismatch defence (`trpc.ts`'s `assertMatchesAuthorizedBoard`,
 * conventions item 2) still applies unchanged — every write here authorizes
 * a CLIENT-CLAIMED `boardId` in middleware, then re-derives the real board
 * inside the same `ctx.withTenant` transaction as the write and compares.
 * What changed is where the second value comes from: a query, not a column
 * on the row being written. The helper needed no signature change; its doc
 * comment did, and got one in this task's first commit — the requirement is
 * about PROVENANCE (read from the database inside the write's own
 * transaction, never from client input), not about the value being a column.
 *
 * `agenda_item_tenant_isolation` (`0000_baseline.sql`) is a plain
 * `FOR ALL USING (town_id = get_current_town_id())` — no board predicate and
 * no role predicate, re-verified for this task. So RLS will NOT catch a board
 * mismatch: any signed-in member of the town can already read any of this
 * town's agenda items and learn which board they belong to. The defence
 * below is the only thing between a clerk holding A2 on their own board and
 * a write to another board's agenda.
 *
 * **Two procedures write MANY rows** (`reorder`, `instantiateFromTemplate` —
 * and `delete`, through the database's own cascade). A single
 * re-authorization is not enough for `reorder`, whose ids can span meetings
 * and therefore boards: `assertItemsOnAuthorizedBoard` derives the DISTINCT
 * board set and calls `assertMatchesAuthorizedBoard` once per distinct
 * board, so a list mixing the authorized board with any other is refused
 * even though one of the two would pass a single check.
 * `instantiateFromTemplate` names ONE meeting, so its board set is a
 * singleton by construction — stated rather than left to be assumed, since
 * the two are described together in this wave's plan.
 *
 * `assertItemsOnAuthorizedBoard` / `assertMeetingOnAuthorizedBoard` are this
 * router's greppable form of "did this procedure re-check the row's true
 * board" — `grep -n "OnAuthorizedBoard(" packages/api/src/trpc/routers/agenda-item.ts`
 * answers it for all seven writes; `assertMatchesAuthorizedBoard(` itself
 * appears ONCE now, inside `assertItemsOnAuthorizedBoard`.
 *
 * **`assertMeetingOnAuthorizedBoard` moved OUT of this file in wave 5, Task 3**
 * — to `trpc/board-derivation.ts`, unchanged in body, because six more tables
 * (`motion`, `vote_record`, `meeting_attendance`, `executive_session`,
 * `guest_speaker`, `agenda_item_transition`) derive their board the identical
 * way and wave 5's plan says to reuse it rather than reinvent it. The only
 * visible difference here is the import and the error prefix inside the
 * helper. `assertItemsOnAuthorizedBoard` stayed: it additionally returns the
 * distinct meeting ids `reorder` needs, and two ways to ask one question is
 * one too many.
 *
 * ─── Every write here publishes, as of wave 5, Task 3 ─────────────────────
 *
 * `agenda_item` is one of the eight `LIVE_MEETING_TOPICS`
 * (`realtime/events.ts`), and all seven writes below sat on
 * `router-wiring.test.ts`'s `AWAITING_PUBLISH` ledger from the moment wave 5
 * Task 1 created it — seven of its eleven entries. They now call
 * `publishRealtimeEvent(tx, …)` as the last statement inside the write's own
 * transaction, so a second device watching this meeting refetches when the
 * write COMMITS and not before. The meeting id comes from
 * `input.meetingId` where the procedure takes one and from
 * `assertItemsOnAuthorizedBoard`'s returned `meetingIds` where it does not —
 * never from a second query, and never from client input the guard did not
 * check.
 *
 * ─── Authorization: A2 for every write, including the delete ──────────────
 *
 * `rules.ts`'s agenda_item section is "A2, BOARD-SCOPED" —
 * `assertCanInsertAgendaItem` and `assertCanUpdateAgendaItem` are each
 * exactly `assertPermission(actor, "A2", {boardId, action})`. Every CONTENT
 * write here therefore uses
 * `requireBoardPermission("A2", boardIdFrom(), {action})`,
 * which IS that call (see `meeting.ts`'s header for the same reasoning about
 * `assertCanInsertMeeting`: going through the code form is the same check,
 * not a shortcut around the rule), and which conventions item 2 tells authors
 * to reach for FIRST for a single-code rule. The count moved in wave 5,
 * Task 2 — quote the grep, not the number:
 *
 *     $ grep -cE '^\s+requireBoardPermission\("A2"' packages/api/src/trpc/routers/agenda-item.ts
 *     7   # at fb3a5cd, wave 5 Task 0's carry-over check
 *     5   # after wave 5 Task 2 moved setOperatorNotes and markComplete to
 *         # requireBoardActor(assertCanUpdateAgendaItemProgress)
 *
 * Anchored to leading whitespace so it counts GUARDS, not the mentions of one
 * in this comment. Unanchored the same command answers 9 at both commits, and
 * `phase-e-conventions.md`'s wave 5 Task 0 carry-over bullet quoted it in that
 * form against a hand-trimmed 7-line listing — the markers-versus-mentions
 * confusion item 11 records for `TODO(phase-e-wave-`, in a second place.
 *
 * **The delete rule, decided rather than left implicit.** There is no
 * `assertCanDeleteAgendaItem` in `rules.ts` and no delete-specific
 * `PermissionCode` — A2 (`edit_agenda`) is the governing action for the
 * agenda's contents. This task's plan offered two answers: add a delete rule
 * delegating to A2, or reuse A2 directly and say why. **Reused, deliberately.**
 * A third function whose body is a third copy of
 * `assertPermission(actor, "A2", …)` would be a name, not a check — and it
 * would be a name with NO caller, because the call site would still be
 * `requireBoardPermission("A2", …)` (item 2's "reach for it first" applies to
 * a single-code rule, and inventing a rule in order to justify the wider
 * guard is backwards). The greppability the plan wanted is met by the guard
 * line itself plus the refusal's own wording ("to remove an agenda item"),
 * and `rules.ts`'s agenda_item section now says in so many words that DELETE
 * is A2 too, so a reader auditing that file alone does not read the absence
 * as an oversight. What is NOT acceptable — a delete authorized by nothing —
 * is what the raw Supabase cascade in `InlineItemForm.tsx` did until wave 4,
 * Task 3 wired that component to `delete` below and removed it.
 *
 * ─── The FK hazard, closed the way conventions item 3 requires ────────────
 *
 * Postgres FK enforcement bypasses row security, so an FK taken from client
 * input needs a tenant-scoped existence check. Three such fields exist here:
 *
 *   - `meetingId` (`insert`, `instantiateFromTemplate`) —
 *     `assertMeetingOnAuthorizedBoard` reads `meeting.board_id` inside the
 *     transaction and answers NOT_FOUND when there is no row. That is
 *     `meeting.ts`'s exported `assertMeetingExists` — the same query, the
 *     same NOT_FOUND — plus the board the mismatch defence needs; running
 *     both would be two round trips for one question, so the helper says so
 *     in its own comment rather than importing a check it duplicates.
 *   - `parentItemId` (`insert`) — checked for existence AND for belonging to
 *     the SAME meeting. Existence alone would not be enough: a real parent in
 *     another town would satisfy `agenda_item_parent_item_id_fkey` while
 *     hanging this town's item under a row its own town can never see.
 *   - `templateId` (`instantiateFromTemplate`) — NOT_FOUND when the template
 *     is not in the caller's town.
 *
 * ─── `delete` is ONE statement, because the database already cascades ─────
 *
 * `InlineItemForm.tsx` USED to delete exhibits, then child items, then the
 * item — three round trips, no transaction, a partial delete on any failure
 * (wired to this procedure in wave 4, Task 3, and pinned there by a test that
 * asserts the call count is 1). Both FKs are already `ON DELETE CASCADE` (`agenda_item_parent_item_id_fkey`,
 * `exhibit_agenda_item_id_fkey`, verified in `0000_baseline.sql`), so the
 * single `DELETE FROM agenda_item WHERE id = $1` below removes exactly the
 * same rows, atomically. Pinned by a test that deletes a section with a child
 * and an exhibit and asserts all three are gone.
 *
 * ─── Two procedures shipped UNWIRED, for wave 5 ──────────────────────────
 *
 * `setOperatorNotes` and `markComplete` back
 * `components/meeting/AgendaItemDetailPanel.tsx`'s two raw writes. That
 * component is imported only by `routes/meetings.$meetingId.live.tsx`, which
 * is **wave 5**'s file — so the procedures land here (this wave's plan: "so
 * wave 5 extends this router rather than creating one") and **nothing calls
 * them yet**; wave 5, Task 4 owns the client change.
 *
 * ~~One question wave 5 owns and this task did not decide for it: both use A2,
 * matching every other `agenda_item` write, but a live-meeting operator may
 * hold M1/M2 and no A2 — if the product wants a presiding officer with no
 * agenda-editing rights to mark items complete, that is a rules change (a
 * second code, hence `requireBoardActor`), not a wiring change, and it should
 * be made deliberately rather than discovered when a clerk is refused
 * mid-meeting.~~ — **decided in wave 5, Task 2, and the prediction held
 * exactly: it is a second code and it is `requireBoardActor`.** Both
 * procedures are now `.use(requireBoardActor(assertCanUpdateAgendaItemProgress))`
 * — A2 OR M1 for the board, `rules.ts`'s rule 2a. They are the only two
 * writes in this file NOT guarded by `requireBoardPermission("A2", …)`, and
 * the line that separates them from the other seven is CONTENT versus
 * LIVE-RUN state: `status` and `operator_notes` are what the meeting did to
 * the agenda, not what the agenda says. Widening, not narrowing — every
 * caller who could reach these under A2 still can.
 *
 * ─── No resolver-side `ctx.actor()` call anywhere in this file ────────────
 *
 * Every guard above resolves the actor in middleware, and the resolver-side
 * defence is a string comparison that needs no actor — so the reentrancy
 * hazard `context.ts`'s header describes (an UNSETTLED `ctx.actor()` called
 * from inside `ctx.withTenant`) is not reachable from here at all.
 */

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { AgendaTemplateSectionSchema } from "@town-meeting/shared";
import type { AgendaTemplateSection } from "@town-meeting/shared/types";
import {
  router,
  protectedProcedure,
  requireBoardPermission,
  requireBoardActor,
  assertMatchesAuthorizedBoard,
  boardIdFrom,
} from "../trpc.js";
import { assertCanUpdateAgendaItemProgress } from "../authorization/rules.js";
import {
  assertMeetingOnAuthorizedBoard,
  type BoardAuthorizedContext,
} from "../board-derivation.js";
import { publishRealtimeEvent } from "../../realtime/events.js";
import { assertMeetingExists } from "./meeting.js";
import { toRows } from "../../db/rows.js";
import type { TenantTx } from "../../db/with-tenant.js";

/**
 * The many-row form: derive the DISTINCT set of boards a list of agenda item
 * ids belongs to, and refuse unless that set is exactly the one authorized
 * board.
 *
 * An INNER JOIN, deliberately: `agenda_item.meeting_id` is NOT NULL with an
 * FK, so a missing join partner cannot happen for a row this town can see —
 * but a LEFT JOIN would answer `null` for one if it ever did, and a `null`
 * board compared against the authorized one is a comparison this defence
 * must never be asked to make. Any id that does not come back (nonexistent,
 * another town's, or a duplicate the caller sent twice — duplicates are
 * refused at the input schema) is NOT_FOUND, for conventions item 3's
 * reason: a foreign row and a nonexistent one must be indistinguishable.
 *
 * Returns the distinct meeting ids, which `reorder` uses for its own
 * single-meeting check — a data-integrity question, not an authorization
 * one, and answered separately below.
 */
async function assertItemsOnAuthorizedBoard(
  ctx: BoardAuthorizedContext,
  tx: TenantTx,
  itemIds: readonly string[],
): Promise<{ meetingIds: string[] }> {
  const idList = sql.join(
    itemIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = toRows<{ id: string; meeting_id: string; board_id: string }>(
    await tx.execute(sql`
      SELECT ai.id, ai.meeting_id, m.board_id
      FROM agenda_item ai
      JOIN meeting m ON m.id = ai.meeting_id
      WHERE ai.id IN (${idList})
    `),
    (message) => new Error(`agendaItem.assertItemsOnAuthorizedBoard: ${message}`),
  );
  if (rows.length !== itemIds.length) throw new TRPCError({ code: "NOT_FOUND" });

  // Once per DISTINCT board, not once for "the" board: a list spanning two
  // boards must be refused even when one of the two is the authorized one.
  for (const boardId of new Set(rows.map((r) => r.board_id))) {
    assertMatchesAuthorizedBoard(ctx, boardId);
  }
  return { meetingIds: [...new Set(rows.map((r) => r.meeting_id))] };
}

/**
 * The field bounds `components/meetings/InlineItemForm.tsx`'s own
 * `ItemFormSchema` enforces today, carried over exactly — that form is the
 * specification these writes replace (conventions item 1).
 *
 * They differ from `@town-meeting/shared`'s `AgendaItemSchema` in three
 * places (`description` is `max(5000)` here and `max(2000)` there, `title` is
 * `max(200)` here and `max(300)` there, `estimated_duration` allows `0` here
 * and `min(1)` there). The form is what a clerk has actually been typing
 * into for the life of this product, so it wins; reconciling the two schemas
 * is a real question and not a migration's to settle.
 */
const itemFields = {
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(5000).nullable(),
  presenter: z.string().max(100).nullable(),
  estimatedDuration: z.number().int().min(0).max(480).nullable(),
  staffResource: z.string().max(200).nullable(),
  background: z.string().max(5000).nullable(),
  recommendation: z.string().max(2000).nullable(),
  suggestedMotion: z.string().max(1000).nullable(),
};

/**
 * `section_type` is a plain `text` column with no CHECK constraint. The
 * eleven documented values live in the column's own COMMENT and in
 * `@town-meeting/shared`'s `AgendaItemSectionType`, and validating against
 * that enum here was considered and **declined**: only ONE of the two call
 * sites picks a value from a fixed list (the builder's "add section" select,
 * whose options are `SECTION_TYPE_LABELS` — the same eleven). The other,
 * `InlineItemForm`, forwards the PARENT ROW's stored `section_type`, so an
 * existing row carrying an undocumented value — this router's own test
 * fixture has been writing `'new_business'` since wave 3 — would stop being
 * able to take child items. `section_type` selects a label and a renderer;
 * it is not an authorization input and no integrity constraint depends on
 * it, so refusing a stored value buys nothing and breaks a real path. The
 * length bound is the column's only real limit made explicit; every
 * documented value is under twenty characters.
 */
const SectionTypeInput = z.string().min(1).max(50);

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

  /**
   * The agenda builder's read (`routes/meetings.$meetingId.agenda.tsx`) —
   * every agenda item for one meeting, FLAT and ordered, exactly as the
   * `select("*").eq("meeting_id", …).order("sort_order")` query it replaces
   * returned them. That screen groups parents and children itself (its
   * `sections` `useMemo`), and returning a nested shape would be a design
   * change smuggled into a migration; the children are all here, identified
   * by `parent_item_id`.
   *
   * No permission guard: `agenda_item_tenant_isolation` is tenancy-only and
   * the query this replaces had no application-level check either —
   * conventions item 2's "a read whose old policy was tenancy-only gets
   * `protectedProcedure` and no guard."
   *
   * Columns checked against `AgendaSection.tsx`, `AgendaItemRow.tsx`,
   * `InlineItemForm.tsx`'s `initial` block, `AgendaPreviewDialog.tsx` and
   * `PublishAgendaDialog.tsx` — the five files that read an item. NOT
   * selected, each deliberately: `town_id` (RLS scopes this; conventions item
   * 2's "no redundant WHERE town_id"), `meeting_id` (every row is this
   * meeting's — it is the argument), `created_at`/`updated_at` and
   * `search_vector`.
   *
   * **`source_minutes_document_id` was on that not-selected list and is now
   * selected — wave 5, Task 4.** Same rule as the two columns below, one task
   * later: `routes/meetings.$meetingId.live.tsx`'s minutes-approval effect
   * reads it to decide which agenda items are "approve the minutes of <date>"
   * items, and which `minutes_document` a passed motion on one of them
   * approves. That effect is the only reader in the repo
   * (`grep -rn "source_minutes_document_id" packages/web/src`), and it was on
   * raw Supabase until Task 4 moved this screen's reads here. Conventions item
   * 1's "add it back the day something does" — the agenda builder still
   * ignores it.
   *
   * **`status` and `operator_notes` were on that not-selected list and are
   * now selected — wave 5, Task 3.** The entry above used to read "nothing on
   * the builder reads them; wave 5's live screen does read `status`, and adds
   * it the day it needs it." This is that day: `AgendaNavigationPanel` renders
   * a per-item status and `AgendaItemDetailPanel` renders and edits
   * `operator_notes`, both of them `routes/meetings.$meetingId.live.tsx`'s
   * children, and both of them wave 5, Task 4's wiring. Conventions item 1's
   * "add it back the day something does", not a widening — the builder still
   * ignores both, and `source_minutes_document_id` is still absent because
   * nothing reads it through this procedure yet.
   *
   * **`exhibit_count` was here and is GONE — removed in wave 4, Task 3, and
   * the removal is the point rather than a tidy-up.** Task 1 added it as a
   * raw correlated `count(*)` so the builder could render an "N exhibits"
   * badge without reading every exhibit row in the town. Task 2 then shipped
   * `exhibit.byMeeting`, which applies rule 14 per row — so the two disagreed
   * for any caller the rule excludes rows from: the badge counted an
   * `admin_only` staff memo the list beneath it refused to show. Worse than
   * a cosmetic mismatch, an unfiltered count DISCLOSES THE CARDINALITY of
   * exactly the attachments rule 14 hides, which is why the column is
   * removed from the API surface rather than merely left unrendered. The
   * screen counts the rows `exhibit.byMeeting` actually handed it
   * (`routes/meetings.$meetingId.agenda.tsx`'s `exhibitsByItem`), which is
   * both filtered and free.
   *
   * `ORDER BY sort_order, id` — the tiebreak on `id` is added. The Supabase
   * query ordered on `sort_order` alone, which is not unique (every section's
   * children restart at 0, and a section and a child can share a value), so
   * its row order for ties was whatever Postgres returned that day. A stable
   * order is not a behaviour change any screen can observe as a loss.
   */
  byMeeting: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertMeetingExists(tx, input.meetingId);
        return toRows<{
          id: string;
          section_type: string;
          sort_order: number;
          title: string;
          description: string | null;
          presenter: string | null;
          estimated_duration: number | null;
          parent_item_id: string | null;
          staff_resource: string | null;
          background: string | null;
          recommendation: string | null;
          suggested_motion: string | null;
          status: string;
          operator_notes: string | null;
          source_minutes_document_id: string | null;
        }>(
          await tx.execute(sql`
            SELECT ai.id, ai.section_type, ai.sort_order, ai.title, ai.description,
                   ai.presenter, ai.estimated_duration, ai.parent_item_id,
                   ai.staff_resource, ai.background, ai.recommendation, ai.suggested_motion,
                   ai.status, ai.operator_notes, ai.source_minutes_document_id
            FROM agenda_item ai
            WHERE ai.meeting_id = ${input.meetingId}
            ORDER BY ai.sort_order ASC, ai.id
          `),
          (message) => new Error(`agendaItem.byMeeting: ${message}`),
        );
      });
    }),

  /**
   * Both raw inserts this replaces: the builder's "add section"
   * (`parentItemId: null`) and `InlineItemForm`'s "add item" under a section.
   *
   * `townId` comes from `ctx.tenant`, never from input — both raw inserts
   * sent it from client state. `status` is hardcoded `'pending'`, matching
   * both (and matching `meeting.insert`'s reasoning for its own hardcoded
   * `'draft'`: a new row is always freshly created, and accepting the field
   * would let a caller mint an item that is already `completed`). `id` is the
   * column's own `gen_random_uuid()` default rather than a browser-minted
   * `crypto.randomUUID()`.
   *
   * `sortOrder` IS accepted from input: both call sites compute it (max + 1
   * for a section, the section's child count for an item), and deriving it
   * server-side would change where new rows land — a behaviour change this
   * migration is not entitled to make.
   */
  insert: protectedProcedure
    .use(
      requireBoardPermission("A2", boardIdFrom(), {
        action: "to add an agenda item",
      }),
    )
    .input(
      z.object({
        boardId: z.string().uuid(),
        meetingId: z.string().uuid(),
        parentItemId: z.string().uuid().nullable(),
        sectionType: SectionTypeInput,
        sortOrder: z.number().int().min(0),
        ...itemFields,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertMeetingOnAuthorizedBoard(ctx, tx, input.meetingId);

        if (input.parentItemId !== null) {
          // Existence AND same-meeting: a real parent in another meeting
          // satisfies `agenda_item_parent_item_id_fkey` (FK checks bypass
          // RLS) while hanging this item under a row that renders nowhere.
          const parents = toRows<{ id: string }>(
            await tx.execute(sql`
              SELECT id FROM agenda_item
              WHERE id = ${input.parentItemId} AND meeting_id = ${input.meetingId}
            `),
            (message) => new Error(`agendaItem.insert: ${message}`),
          );
          if (!parents[0]) throw new TRPCError({ code: "NOT_FOUND" });
        }

        const rows = toRows<{ id: string }>(
          await tx.execute(sql`
            INSERT INTO agenda_item (
              meeting_id, town_id, section_type, sort_order, title, description, presenter,
              estimated_duration, parent_item_id, status, staff_resource, background,
              recommendation, suggested_motion
            )
            VALUES (
              ${input.meetingId}, ${ctx.tenant.townId}, ${input.sectionType}, ${input.sortOrder},
              ${input.title}, ${input.description}, ${input.presenter},
              ${input.estimatedDuration}, ${input.parentItemId},
              'pending'::agenda_item_status, ${input.staffResource}, ${input.background},
              ${input.recommendation}, ${input.suggestedMotion}
            )
            RETURNING id
          `),
          (message) => new Error(`agendaItem.insert: ${message}`),
        );
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId: input.meetingId,
          topic: "agenda_item",
        });
        return { id: rows[0]!.id };
      });
    }),

  /**
   * `InlineItemForm`'s edit branch. The eight editable fields and no others —
   * `section_type`, `sort_order` and `parent_item_id` are structural and have
   * their own procedures (`reorder`, and a delete-plus-insert for a move);
   * the raw update this replaces did not touch them either.
   */
  update: protectedProcedure
    .use(
      requireBoardPermission("A2", boardIdFrom(), {
        action: "to edit an agenda item",
      }),
    )
    .input(
      z.object({
        boardId: z.string().uuid(),
        itemId: z.string().uuid(),
        ...itemFields,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const { meetingIds } = await assertItemsOnAuthorizedBoard(ctx, tx, [input.itemId]);
        await tx.execute(sql`
          UPDATE agenda_item SET
            title = ${input.title},
            description = ${input.description},
            presenter = ${input.presenter},
            estimated_duration = ${input.estimatedDuration},
            staff_resource = ${input.staffResource},
            background = ${input.background},
            recommendation = ${input.recommendation},
            suggested_motion = ${input.suggestedMotion},
            updated_at = now()
          WHERE id = ${input.itemId}
        `);
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId: meetingIds[0]!,
          topic: "agenda_item",
        });
        return { id: input.itemId };
      });
    }),

  /**
   * Both drag-and-drop handlers: the builder's section reorder and
   * `AgendaSection`'s child reorder. `sort_order` becomes the id's position
   * in `itemIds`, which is what both handlers compute today (they skip rows
   * whose value already matches; writing all of them reaches the identical
   * end state in one round trip instead of N).
   *
   * Two separate refusals, in this order and for different reasons:
   *
   *   1. **Any board other than the authorized one → FORBIDDEN**, from the
   *      DISTINCT board set (see `assertItemsOnAuthorizedBoard`). This is the
   *      authorization check, and it runs first so that a list mixing two
   *      boards is answered as a refusal rather than as a malformed request.
   *   2. **More than one meeting → BAD_REQUEST.** `sort_order` is meaningful
   *      only within a meeting, so a list spanning two of them would silently
   *      interleave two agendas. Not an authorization question (two meetings
   *      of the SAME board pass check 1 honestly), and not something either
   *      call site can produce — both build their list from one meeting's own
   *      items — so this refuses nothing the product does.
   */
  reorder: protectedProcedure
    .use(
      requireBoardPermission("A2", boardIdFrom(), {
        action: "to reorder the agenda",
      }),
    )
    .input(
      z.object({
        boardId: z.string().uuid(),
        itemIds: z
          .array(z.string().uuid())
          .min(1)
          .refine((ids) => new Set(ids).size === ids.length, {
            message: "itemIds must not contain duplicates",
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const { meetingIds } = await assertItemsOnAuthorizedBoard(ctx, tx, input.itemIds);
        if (meetingIds.length > 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Every item in a reorder must belong to the same meeting — sort_order is " +
              "scoped to one meeting's agenda.",
          });
        }
        for (const [index, itemId] of input.itemIds.entries()) {
          await tx.execute(sql`
            UPDATE agenda_item SET sort_order = ${index}, updated_at = now()
            WHERE id = ${itemId}
          `);
        }
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId: meetingIds[0]!,
          topic: "agenda_item",
        });
        return { count: input.itemIds.length };
      });
    }),

  /**
   * The cascading delete — `InlineItemForm`'s three unguarded round trips and
   * `AgendaSection`'s per-child loop, both replaced by one statement inside
   * one transaction. The database cascades child items and exhibits itself
   * (see this file's header); there is nothing left to delete by hand.
   */
  delete: protectedProcedure
    .use(
      requireBoardPermission("A2", boardIdFrom(), {
        action: "to remove an agenda item",
      }),
    )
    .input(z.object({ boardId: z.string().uuid(), itemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const { meetingIds } = await assertItemsOnAuthorizedBoard(ctx, tx, [input.itemId]);
        await tx.execute(sql`DELETE FROM agenda_item WHERE id = ${input.itemId}`);
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId: meetingIds[0]!,
          topic: "agenda_item",
        });
        return { id: input.itemId };
      });
    }),

  /**
   * `lib/meeting-helpers.ts`'s `instantiateAgendaFromTemplate`, moved server
   * side — Task 4's job to wire, but the procedure is this task's.
   *
   * **Takes a `templateId`, not the sections themselves.** The client helper
   * reads the selected template's `sections` in the browser and posts them;
   * this reads the same column off the same row inside the caller's own
   * tenant transaction. Same data, with the content no longer travelling
   * through the client, and one behaviour difference worth naming: a template
   * deleted between page load and submit now answers NOT_FOUND instead of
   * being instantiated from a stale copy.
   *
   * Sections are parsed the way the client's own `parseSections` parses them
   * — per item, dropping any that fail `AgendaTemplateSectionSchema`, and
   * unwrapping a double-encoded JSON string — because that is the behaviour
   * the rows in the database were written against. A stricter all-or-nothing
   * parse would turn one bad section into a meeting with no agenda at all.
   *
   * The template is NOT required to belong to the meeting's own board, only
   * to the caller's town. That is deliberate: today the client sends the
   * sections themselves, so ANY template's content — any board's, or none's
   * (`agenda_template.board_id` is nullable) — can already reach this write,
   * and refusing a cross-board template here would be a new restriction, not
   * a preserved one. Authorization is unaffected either way: it is the
   * MEETING's board that is authorized, and the template contributes text,
   * not scope.
   *
   * The `minutes_approval` branch is carried over in full: for a section of
   * that type, children are the board's meetings awaiting minutes approval
   * rather than the template's `default_items`, each with a suggested motion
   * naming the board and the meeting's date. Without it, moving this helper
   * to the server would quietly drop a feature — the reason it is one query
   * here instead of the client's four is only round trips, not scope.
   */
  instantiateFromTemplate: protectedProcedure
    .use(
      requireBoardPermission("A2", boardIdFrom(), {
        action: "to create this meeting's agenda from a template",
      }),
    )
    .input(
      z.object({
        boardId: z.string().uuid(),
        meetingId: z.string().uuid(),
        templateId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const boardId = await assertMeetingOnAuthorizedBoard(ctx, tx, input.meetingId);
        const sections = await loadTemplateSections(tx, input.templateId);

        let created = 0;
        for (const [index, section] of sections.entries()) {
          const sectionRows = toRows<{ id: string }>(
            await tx.execute(sql`
              INSERT INTO agenda_item (
                meeting_id, town_id, section_type, sort_order, title, description, status
              )
              VALUES (
                ${input.meetingId}, ${ctx.tenant.townId}, ${section.section_type}, ${index},
                ${section.title}, ${section.description ?? null}, 'pending'::agenda_item_status
              )
              RETURNING id
            `),
            (message) => new Error(`agendaItem.instantiateFromTemplate: ${message}`),
          );
          const sectionId = sectionRows[0]!.id;
          created += 1;

          if (section.section_type === "minutes_approval") {
            created += await insertMinutesApprovalItems(tx, {
              townId: ctx.tenant.townId,
              meetingId: input.meetingId,
              boardId,
              sectionId,
            });
            continue;
          }

          for (const [childIndex, title] of (section.default_items ?? []).entries()) {
            await tx.execute(sql`
              INSERT INTO agenda_item (
                meeting_id, town_id, section_type, sort_order, title, parent_item_id, status
              )
              VALUES (
                ${input.meetingId}, ${ctx.tenant.townId}, ${section.section_type}, ${childIndex},
                ${title}, ${sectionId}, 'pending'::agenda_item_status
              )
            `);
            created += 1;
          }
        }
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId: input.meetingId,
          topic: "agenda_item",
        });
        return { count: created };
      });
    }),

  /**
   * UNWIRED — wave 5, Task 4 owns the caller. `AgendaItemDetailPanel.tsx`'s
   * `saveNotesMutation`, which today writes `operator_notes` through the dead
   * Supabase client with no authorization check of any kind. See this file's
   * header for why it lands here.
   *
   * **A2 OR M1, settled in wave 5, Task 2** — the question this file's header
   * left open. `operator_notes` is a live-run column, not agenda content, so
   * the guard is `requireBoardActor(assertCanUpdateAgendaItemProgress)` rather
   * than the `requireBoardPermission("A2", …)` every content write here uses.
   * The full reasoning is in `rules.ts`'s rule 2a; the short form is that a
   * presiding officer seated to run a board's meetings holds M1 and need not
   * hold A2, and finding that out mid-meeting is the failure this closes.
   */
  setOperatorNotes: protectedProcedure
    .use(requireBoardActor(assertCanUpdateAgendaItemProgress))
    .input(
      z.object({
        boardId: z.string().uuid(),
        itemId: z.string().uuid(),
        operatorNotes: z.string().max(5000).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const { meetingIds } = await assertItemsOnAuthorizedBoard(ctx, tx, [input.itemId]);
        await tx.execute(sql`
          UPDATE agenda_item SET operator_notes = ${input.operatorNotes}, updated_at = now()
          WHERE id = ${input.itemId}
        `);
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId: meetingIds[0]!,
          topic: "agenda_item",
        });
        return { id: input.itemId };
      });
    }),

  /**
   * UNWIRED — wave 5, Task 4 owns the caller. `AgendaItemDetailPanel.tsx`'s
   * `markCompleteMutation`. Sets `status` and nothing else, matching that
   * write exactly; it does NOT record an `agenda_item_transition` row.
   *
   * **A2 OR M1, settled in wave 5, Task 2** — see `setOperatorNotes` above and
   * `rules.ts`'s rule 2a. `status` is the meeting's progress through the
   * agenda, not the agenda's contents.
   *
   * **Corrected here too:** this comment used to say `agenda_item_transition`
   * "exists and nothing in the product writes it today." That does not
   * reproduce — `routes/meetings.$meetingId.live.tsx` (`navigateToItem`,
   * `handleMeetingEnd`) and `components/meeting/MeetingStartFlow.tsx` all
   * write it, raw, with no authorization check; wave 5, Task 2 gave it rules
   * 21d (M1) and Task 3 owns the procedures. What remains true is the narrow
   * claim this procedure needs: `markComplete` itself does not write one, and
   * making it do so would be a feature rather than a migration.
   */
  markComplete: protectedProcedure
    .use(requireBoardActor(assertCanUpdateAgendaItemProgress))
    .input(z.object({ boardId: z.string().uuid(), itemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const { meetingIds } = await assertItemsOnAuthorizedBoard(ctx, tx, [input.itemId]);
        await tx.execute(sql`
          UPDATE agenda_item SET status = 'completed'::agenda_item_status, updated_at = now()
          WHERE id = ${input.itemId}
        `);
        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId: meetingIds[0]!,
          topic: "agenda_item",
        });
        return { id: input.itemId };
      });
    }),
});

/**
 * Read one template's sections, tenant-scoped, with the client's own
 * per-item leniency — see `instantiateFromTemplate`'s doc comment.
 *
 * NOT_FOUND for a template in another town or one that does not exist: it is
 * a foreign key from client input, and conventions item 3's rule applies
 * whether the id is used for a write or, as here, to decide what to write.
 */
async function loadTemplateSections(
  tx: TenantTx,
  templateId: string,
): Promise<AgendaTemplateSection[]> {
  const rows = toRows<{ sections: unknown }>(
    await tx.execute(sql`SELECT sections FROM agenda_template WHERE id = ${templateId}`),
    (message) => new Error(`agendaItem.loadTemplateSections: ${message}`),
  );
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });

  let raw: unknown = row.sections;
  // The double-encoding `lib/agenda-template-helpers.ts`'s `parseSections`
  // already handles: a JSONB column written as a STRING rather than an array.
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];

  const parsed: AgendaTemplateSection[] = [];
  for (const item of raw) {
    const result = AgendaTemplateSectionSchema.safeParse(item);
    if (result.success) parsed.push(result.data as AgendaTemplateSection);
  }
  return parsed;
}

/**
 * The `minutes_approval` auto-population, carried over from
 * `lib/meeting-helpers.ts`'s `autoPopulateMinutesApproval`.
 *
 * The client made four round trips (minutes documents, meetings, a merge
 * query for reviewed meetings not already listed, and the board's name);
 * this is one query plus the board's name, answering the same question: every
 * meeting of this board, other than the one being built, that either sits in
 * `adjourned`/`minutes_draft` OR already has a `review`-status minutes
 * document — ordered by date.
 *
 * `md.board_id` is the filter the client used, and it is kept rather than
 * "corrected" to a join through `meeting`: that column is denormalised and
 * nullable (`rules.ts`'s `BoardScopedRow` warns against trusting it for
 * AUTHORIZATION, which this is not), and a row where it is NULL does not
 * match today. Changing which rows appear on a clerk's agenda is not this
 * migration's call.
 *
 * One filter is NOT preserved character-for-character, and is stated here
 * rather than left for a diff to find: the client's `autoPopulateMinutesApproval`
 * (`lib/meeting-helpers.ts`, deleted in wave 4 Task 4, `cd10b54`) applied
 * `.eq("board_id", boardId)` only to its FIRST query (the `adjourned`/
 * `minutes_draft` meetings query); its SECOND query — the merge step that
 * re-fetches reviewed meetings by id (`.in("id", reviewedMeetingIds)`) —
 * carried no board filter at all. The single query above applies
 * `WHERE m.board_id = ${args.boardId}` to BOTH halves of what the client did
 * as two separate queries, because here they are one `WHERE` clause covering
 * one `LEFT JOIN`. This only diverges under denormalisation drift — a
 * `minutes_document.board_id` that no longer matches its `meeting.board_id`
 * — in which case the client would list that meeting here and the server
 * would not. Deliberately NOT changed to match the client: the server's
 * board-scoped behaviour is the more defensible of the two, and this
 * migration's job is to state behaviour differences, not to reproduce a
 * looser one.
 *
 * `scheduled_date::text` is harmless and, on this code path, NOT load-bearing
 * — corrected in wave 4, Task 3 after the claim was probed rather than
 * repeated. This comment used to say the cast was "load-bearing, not
 * decorative: postgres.js parses a `date` column into a JS `Date`." True of a
 * BARE `postgres()` client, false of `tx.execute(sql…)`:
 * `drizzle-orm/postgres-js` installs identity parsers, so a `date` (and a
 * `timestamptz`) comes back as raw text either way. Measured against the
 * local database, not reasoned about:
 *
 *     postgres()           SELECT '2026-03-15'::date  ->  Date
 *     drizzle(postgres())  SELECT '2026-03-15'::date  ->  "2026-03-15"
 *
 * The cast STAYS — it makes the declared `string | null` explicit at the
 * query rather than dependent on a driver detail, and the date formatting
 * below really does need `YYYY-MM-DD` — but do not copy it into a new
 * procedure believing it fixes an Invalid Date, and do not go adding it to
 * the three uncast `scheduled_date` reads in `meeting.ts`/`board.ts` on this
 * comment's old authority. `meeting.ts`'s header carries the same probe and
 * the tests that pin the property. The `::int` casts in this file ARE
 * load-bearing, and the same probe is what shows it: `count(*)` really does
 * come back as the string `"1"`.
 */
async function insertMinutesApprovalItems(
  tx: TenantTx,
  args: { townId: string; meetingId: string; boardId: string; sectionId: string },
): Promise<number> {
  const boardRows = toRows<{ name: string }>(
    await tx.execute(sql`SELECT name FROM board WHERE id = ${args.boardId}`),
    (message) => new Error(`agendaItem.insertMinutesApprovalItems: ${message}`),
  );
  const boardName = boardRows[0]?.name ?? "";

  const candidates = toRows<{
    id: string;
    scheduled_date: string | null;
    minutes_document_id: string | null;
    has_amendments: boolean;
  }>(
    await tx.execute(sql`
      SELECT m.id,
             m.scheduled_date::text AS scheduled_date,
             md.id AS minutes_document_id,
             CASE
               WHEN md.amendments_history IS NULL THEN false
               WHEN jsonb_typeof(md.amendments_history) <> 'array' THEN false
               ELSE jsonb_array_length(md.amendments_history) > 0
             END AS has_amendments
      FROM meeting m
      LEFT JOIN minutes_document md
        ON md.meeting_id = m.id AND md.board_id = ${args.boardId} AND md.status = 'review'
      WHERE m.board_id = ${args.boardId}
        AND m.id <> ${args.meetingId}
        AND (m.status IN ('adjourned', 'minutes_draft') OR md.id IS NOT NULL)
      ORDER BY m.scheduled_date ASC, m.id
    `),
    (message) => new Error(`agendaItem.insertMinutesApprovalItems: ${message}`),
  );

  let sortOrder = 0;
  for (const row of candidates) {
    const date = row.scheduled_date ?? "";
    const formattedDate = date
      ? new Date(date + "T00:00:00").toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : "Unknown Date";
    const suffix = row.has_amendments ? "as amended" : "as presented";
    const suggestedMotion = boardName
      ? `to approve the minutes of the ${boardName} meeting of ${formattedDate} ${suffix}`
      : `to approve the minutes of the meeting of ${formattedDate} ${suffix}`;

    await tx.execute(sql`
      INSERT INTO agenda_item (
        meeting_id, town_id, section_type, sort_order, title, parent_item_id, status,
        suggested_motion, source_minutes_document_id
      )
      VALUES (
        ${args.meetingId}, ${args.townId}, 'minutes_approval', ${sortOrder},
        ${`Approval of Minutes — ${formattedDate}`}, ${args.sectionId},
        'pending'::agenda_item_status, ${suggestedMotion}, ${row.minutes_document_id}
      )
    `);
    sortOrder += 1;
  }
  return candidates.length;
}
