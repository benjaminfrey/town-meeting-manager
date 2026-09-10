/**
 * Phase E, wave 4, Task 2 — the exhibit router.
 *
 * ─── There are two ways to create an exhibit, and only one of them is here ─
 *
 * An exhibit is either an uploaded FILE or a linked URL. Both are rows in the
 * same table with the same columns; they differ in what `file_storage_path`
 * holds and in whether any bytes exist.
 *
 * The FILE path already lives at the D1e endpoint —
 * `POST /api/files/exhibits` → `storage/documents.ts`'s
 * `createExhibitFromUpload` — and **stays there**. It resolves the agenda
 * item's board with the same two-join query below, applies the same rule 15,
 * sniffs the file's actual bytes, enforces the 5 MB limit server-side, and
 * inserts the row inside the same tenant transaction as the write to disk. A
 * tRPC copy could reproduce none of that (a JSON procedure has no multipart
 * body and no `withWrittenFile` around the insert), so duplicating it would
 * mean two paths with two different amounts of checking — the opposite of
 * what this task is for.
 *
 * The LINK path had no home at all. `ExhibitUploader.tsx`'s `handleAddUrl`
 * raw-inserts an `exhibit` row through the dead Supabase client with **no
 * rule, no existence check on `agenda_item_id`, and a client-supplied
 * `town_id`** — under `exhibit_tenant_isolation`, which is a plain
 * `FOR ALL USING (town_id = get_current_town_id())` (verified in
 * `0000_baseline.sql` for this task; no board predicate, no role predicate).
 * `link` below is that path's home.
 *
 * ─── One authorization story, in the sense that matters ───────────────────
 *
 * The two transports differ. The AUTHORIZATION does not, and that is the
 * property to hold onto:
 *
 *   - the same RULE — `assertCanInsertExhibit` (rule 15: A3 for the board, OR
 *     the `board_member` role, so a member may upload their own material);
 *   - the same BOARD, derived the same way — `exhibit → agenda_item →
 *     meeting.board_id`, read inside the caller's own tenant transaction,
 *     never taken from the request;
 *   - the same VISIBILITY vocabulary — all three tiers, so a `board_only`
 *     link is expressible here exactly as it is at the upload endpoint.
 *
 * One thing the tRPC path needs that the D1e path does not, and it is a cost
 * rather than a feature: a client-supplied `boardId`. The D1e endpoint runs
 * its check resolver-side, after deriving the board, so it never trusts a
 * claimed board and has no mismatch hazard at all. A tRPC guard is declared
 * before `.input()` (conventions item 2) and therefore has to authorize
 * SOMETHING before any query runs, so `link` takes a `boardId` whose only job
 * is feeding the guard — and then pays for it with the mismatch defence
 * below. This is exactly the cost conventions item 2 names in the abstract;
 * it is recorded concretely here because the two paths sitting side by side
 * make it visible for the first time.
 *
 * ─── The board is TWO joins away ──────────────────────────────────────────
 *
 * `agenda_item` has no `board_id` (wave 4, Task 1). `exhibit` has none
 * either, and reaches a board one join further out:
 *
 *     SELECT m.board_id FROM exhibit e
 *     JOIN agenda_item ai ON ai.id = e.agenda_item_id
 *     JOIN meeting m ON m.id = ai.meeting_id WHERE e.id = $1
 *
 * `link` never needs that three-table form: it is an INSERT, so the row does
 * not exist yet and the board comes from the agenda item it is about to hang
 * off — which is Task 1's `assertMeetingOnAuthorizedBoard` with one more join
 * on the front. That helper generalised in shape but not by reuse: it takes a
 * `meetingId` and this takes an `agendaItemId`, so
 * `assertAgendaItemOnAuthorizedBoard` below is its sibling, written the same
 * way for the same reasons (INNER JOIN so a missing partner is NOT_FOUND
 * rather than a `null` board; NOT_FOUND before the mismatch check, never
 * after). The three-table form lives in `storage/documents.ts`'s
 * `loadExhibit`, which is where the procedures that target an EXISTING
 * exhibit row live — see below.
 *
 * ─── There is no `delete` here, and that is the decision, not an omission ──
 *
 * This task's brief asked for the link path AND the delete. The delete turned
 * out to be already done, correctly, at the D1e endpoint:
 * `DELETE /api/files/exhibits/:exhibitId` → `documents.ts`'s `deleteExhibit`,
 * which `ExhibitRow.tsx` already calls for BOTH kinds of exhibit (it returns
 * `removedPath: null` for a `file_type = 'url'` row, so a linked exhibit
 * deletes cleanly through it). Adding `exhibit.delete` here would create the
 * second path this file's opening section exists to avoid, and a worse one: a
 * tRPC procedure cannot run `removeExhibitFile`, which is a filesystem
 * operation deliberately performed AFTER the transaction commits, so every
 * file exhibit deleted through tRPC would orphan its bytes forever — the
 * exact defect D1e was built to fix.
 *
 * **So the "is there an `assertCanDeleteExhibit`?" question has a different
 * answer from Task 1's, and Task 1's reasoning does not carry.** Task 1
 * declined `assertCanDeleteAgendaItem` because it would have been a third
 * body identical to two existing A2 rules, with no caller. Here the rule
 * question was already ANSWERED and SHIPPED: `deleteExhibit` guards with
 * `assertCanUpdateExhibit` — rule 16, **A3 only**, deliberately NOT rule 15's
 * wider "A3 or a board seat", because a member may upload their own material
 * and must not be able to remove the clerk's. Insert and delete genuinely
 * have different rules here, which is why Task 1's "reuse the code through
 * `requireBoardPermission`" answer could not be copied — there is no single
 * code that spans both. A new `assertCanDeleteExhibit` would be a third name
 * for a decision two functions already make, in a file that would then
 * contain two rules and one alias for one of them.
 *
 * ─── `board_only` exhibits and the portal ─────────────────────────────────
 *
 * `exhibit.visibility` DEFAULTS to `'public'` (`0000_baseline.sql`), so an
 * insert that ignores the field publishes by default. The raw insert this
 * replaces hardcoded `visibility: "public"` with no way to say otherwise, so
 * the LINK path could only ever create public exhibits while the FILE path
 * could create any of the three — an asymmetry between the two paths, not a
 * policy. `link` takes the same three-valued input the upload endpoint takes,
 * defaulting to `'public'` so the existing client's behaviour is unchanged.
 *
 * The owner decision "`board_only` exhibits stay out of the portal" holds
 * through this, and it holds where it always did rather than here:
 * `routes/portal.ts` filters with `portalVisibleExhibits` (rule 14's portal
 * half — `visibility = 'public'` and nothing else), and this procedure cannot
 * write a row that bypasses that filter, because the only thing that filter
 * reads is the column this procedure writes. `byMeeting` below applies the
 * SIGNED-IN half of the same rule, `visibleExhibits`.
 *
 * ─── The read, and what it tightens ───────────────────────────────────────
 *
 * `byMeeting` replaces `routes/meetings.$meetingId.agenda.tsx`'s and
 * `routes/meetings.$meetingId.review.tsx`'s identical raw queries, which each
 * read EVERY exhibit row in the town (`.eq("town_id", townId)`) and filter to
 * the meeting's items in the browser. Two stated behaviour changes, both
 * narrowings:
 *
 *   1. **Scoped to the meeting in SQL.** The client already discarded
 *      everything else, so nothing it rendered changes — but the rows no
 *      longer travel.
 *   2. **Filtered by rule 14, and the visible half of the change is BIGGER
 *      than "admin_only" alone.** A clerk holding A2 but not A3, who is not
 *      a board member, currently sees the titles of BOTH an `admin_only`
 *      staff memo AND a `board_only` exhibit on the agenda builder, and will
 *      see NEITHER after this — measured against the built rules, not
 *      assumed: `canSelectExhibit(actor, {visibility: "board_only", ...})`
 *      is `isAdmin(actor) || resolvePermission(actor, "A3", boardId) ||
 *      isBoardMember(actor)`, and none of the three holds for an A2-only
 *      clerk. `board_only` is the tier a board PACKET lands in, so this is
 *      the materially larger half of the tightening once Task 3 wires this
 *      read into the agenda builder — not a footnote to the `admin_only`
 *      case. That is rule 14 doing exactly what it says (neither tier is
 *      granted by A2 alone), and it was already true of the FILE —
 *      `resolveExhibitForDownload` has applied `assertCanSelectExhibit`
 *      since D1e — so this closes a metadata leak the bytes never had.
 *      Conventions item 2's "a read whose old policy was tenancy-only gets
 *      no guard" does not reach this table: `exhibit`'s SELECT policy is
 *      rule 14, three tiers, restored in `rules.ts`; only the RLS half of it
 *      is tenancy-only. Both tiers are pinned: `exhibit.test.ts` hides an
 *      `admin_only` AND a `board_only` row from the same A2-only clerk in
 *      one test, so a procedure that dropped only one of the two tiers
 *      would still fail it.
 *
 * **Rule 14's `board_only` branch has the identical hole rule 15's insert
 * side has** (see `link`'s own doc comment below, and this task's report):
 * `isBoardMember(actor)` is `actor.role === "board_member"` — a TOWN-level
 * fact, not a board — so it is inert as a scope check no matter which rule
 * consults it. `byMeeting` is the first tRPC consumer of this branch, and it
 * inherits the property unchanged: ANY board member of the town reads ANY
 * board's `board_only` exhibit titles, not just their own board's. This is
 * not new and not a regression — `resolveExhibitForDownload` has answered
 * identically for the BYTES since D1e, and the raw query this replaces
 * filtered nothing at all — but it is now reachable through a procedure, so
 * it is pinned as a PASSING cross-board test in `exhibit.test.ts`
 * ("does NOT scope byMeeting's board_only tier to the member's own board"),
 * mirroring `link`'s identical pin, so that narrowing either one later is a
 * deliberate, visible change and not a silent one. Whether a board member
 * seeing every OTHER board's `board_only` material is product intent or a
 * latent defect is a question for the owner, not something this migration
 * decides — see the report's own judgement call on it.
 *
 * **A consequence Task 3 inherits and should not discover on screen:**
 * `agendaItem.byMeeting`'s `exhibit_count` (Task 1) is a raw
 * `count(*)` and is NOT visibility-filtered, so for a caller the filter
 * excludes rows from, the "N exhibits" badge and the list below it can
 * disagree. Left alone deliberately rather than "fixed" in passing — making
 * the count actor-dependent is a change to a procedure this task does not own
 * and did not test, and the honest fix is for the screen to count the rows it
 * actually received.
 */

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  router,
  protectedProcedure,
  requireBoardActor,
  assertMatchesAuthorizedBoard,
} from "../trpc.js";
import { assertCanInsertExhibit, visibleExhibits } from "../authorization/rules.js";
import { assertMeetingExists } from "./meeting.js";
import { toRows } from "../../db/rows.js";
import type { TenantTx } from "../../db/with-tenant.js";

/** See `agenda-item.ts`'s identical type — the board the guard authorized. */
interface BoardAuthorizedContext {
  authorizedBoardId?: string;
}

/**
 * Resolve an agenda item's real board inside the caller's own tenant
 * transaction and refuse unless it is the board the guard authorized.
 *
 * `agenda-item.ts`'s `assertMeetingOnAuthorizedBoard` with one more join on
 * the front, and the two properties that helper's comment calls load-bearing
 * are load-bearing here for the same reasons:
 *
 *   - **INNER JOIN.** `agenda_item.meeting_id` is NOT NULL with an FK, so a
 *     missing partner cannot happen for a row this town can see — but a LEFT
 *     JOIN would answer `null` if it ever did, and a `null` board compared
 *     against the authorized one is a comparison this defence must never be
 *     asked to make.
 *   - **NOT_FOUND before the mismatch check.** `agendaItemId` is a foreign
 *     key taken from client input, and FK enforcement bypasses row security
 *     (conventions item 3), so this IS that item's required existence check
 *     as well as the board derivation — one query for one question. A foreign
 *     or nonexistent id answers NOT_FOUND, indistinguishably.
 */
async function assertAgendaItemOnAuthorizedBoard(
  ctx: BoardAuthorizedContext,
  tx: TenantTx,
  agendaItemId: string,
): Promise<void> {
  const rows = toRows<{ board_id: string }>(
    await tx.execute(sql`
      SELECT m.board_id
      FROM agenda_item ai
      JOIN meeting m ON m.id = ai.meeting_id
      WHERE ai.id = ${agendaItemId}
    `),
    (message) => new Error(`exhibit.assertAgendaItemOnAuthorizedBoard: ${message}`),
  );
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  assertMatchesAuthorizedBoard(ctx, row.board_id);
}

/**
 * The three tiers, as the column's own enum spells them. Matched against
 * `routes/files.ts`'s own `VISIBILITIES` list rather than re-derived, so the
 * two creation paths accept exactly the same vocabulary.
 */
const VISIBILITIES = ["public", "board_only", "admin_only"] as const;

export const exhibitRouter = router({
  /**
   * Every exhibit on one meeting's agenda items, ordered, filtered to what
   * this caller may see — see this file's header for the two behaviour
   * changes against the raw queries it replaces.
   *
   * Columns checked against the four components that read an exhibit:
   * `ExhibitRow.tsx` (`id`, `title`, `file_type`, `exhibit_type`,
   * `file_storage_path`, `agenda_item_id`), `ExhibitUploader.tsx` (the list
   * length, and `sort_order` for the next row's position),
   * `AgendaSection.tsx` (`agenda_item_id`, to group by item) and
   * `review.tsx`'s `buildStructuredMeetingRecord` mapping (`file_name`).
   * `visibility` is selected because rule 14 is applied to it below.
   * NOT selected: `town_id` (RLS scopes this — conventions item 2's "no
   * redundant WHERE town_id"), `uploaded_by`, `created_at`, and `file_size`
   * (only the PORTAL renders a size, and the portal has its own route and its
   * own query — `routes/portal.ts`).
   *
   * `ORDER BY sort_order, id` — the tiebreak on `id` is added, for
   * `agendaItem.byMeeting`'s reason: `sort_order` restarts at 0 per agenda
   * item, so it is not unique across a meeting and the raw query's order for
   * ties was whatever Postgres returned that day.
   *
   * `assertMeetingExists` first, for conventions item 3's reason: this scan
   * degrades to `[]` for a foreign or nonexistent meeting exactly as readily
   * as for a real meeting with no attachments yet.
   */
  byMeeting: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Resolved BEFORE `ctx.withTenant` opens: `ctx.actor()` runs its own
      // transaction on the first call, and a first call from inside another
      // one is refused by `context.ts`'s reentrancy guard (conventions item
      // 2). This is a read with no middleware guard to warm the memo, so it
      // is the procedure's own job.
      const actor = await ctx.actor();
      const rows = await ctx.withTenant(async (tx) => {
        await assertMeetingExists(tx, input.meetingId);
        return toRows<{
          id: string;
          agenda_item_id: string;
          title: string;
          file_storage_path: string;
          file_type: string;
          file_name: string | null;
          exhibit_type: string | null;
          // Spelled out rather than imported as `rules.ts`'s
          // `ExhibitVisibility`: this type is part of the ROUTER'S PUBLIC
          // OUTPUT, and a named alias from `authorization/rules.js` makes
          // `AppRouter` unnameable from the web package —
          // `TS2742: The inferred type of 'trpc' cannot be named without a
          // reference to '.../dist/trpc/authorization/rules'`, which
          // `npx turbo run typecheck --force` reported the moment this was
          // written the other way. The union is the alias's own definition.
          visibility: "public" | "board_only" | "admin_only";
          sort_order: number;
          board_id: string;
        }>(
          await tx.execute(sql`
            SELECT e.id, e.agenda_item_id, e.title, e.file_storage_path, e.file_type,
                   e.file_name, e.exhibit_type, e.visibility::text AS visibility,
                   e.sort_order, m.board_id
            FROM exhibit e
            JOIN agenda_item ai ON ai.id = e.agenda_item_id
            JOIN meeting m ON m.id = ai.meeting_id
            WHERE ai.meeting_id = ${input.meetingId}
            ORDER BY e.sort_order ASC, e.id
          `),
          (message) => new Error(`exhibit.byMeeting: ${message}`),
        );
      });

      // Rule 14, the `visibleX` form: per ROW, and a filter rather than a
      // throw, because this is a list — `rules.ts`'s header, point 3. The
      // board each row carries is the rule's required scope and is dropped
      // from the answer: it is the meeting's board, which the screen already
      // knows, and returning it invites a client to authorize on it.
      const scoped = rows.map(({ board_id, ...rest }) => ({ ...rest, boardId: board_id }));
      return visibleExhibits(actor, scoped).map(({ boardId, ...rest }) => rest);
    }),

  /**
   * `ExhibitUploader.tsx`'s "Add Link" write — see this file's header for why
   * this is the only creation path in this router and what it shares with the
   * upload endpoint.
   *
   * `requireBoardActor`, not `requireBoardPermission`: rule 15 is
   * `A3@board OR isBoardMember(actor)` — two branches, one of them a ROLE
   * rather than a second code — so it does not reduce to a single
   * `PermissionCode` and `requireBoardPermission` cannot express it
   * (conventions item 2's fourth guard shape). This is that shape's second
   * real call site, after `meeting.cancel`/`updateStatus`.
   *
   * **What it gets right, and what it cannot:** the guard runs before
   * `.input()`, so a refused caller gets FORBIDDEN even when the rest of the
   * body fails to parse; the arity and return-type checks accept this rule
   * and would reject an actor-only one; and `ctx.authorizedBoardId` is set,
   * so the mismatch defence works. What it cannot fix is that the rule's
   * SECOND branch does not consult the board at all — `isBoardMember(actor)`
   * is `actor.role === "board_member"`, a town-level fact — so any board
   * member of the town may attach a link to ANY board's agenda item. The
   * `BoardScope` this guard so carefully derives and re-checks is inert for
   * that branch. That is a property of rule 15, identical at the D1e upload
   * endpoint (`createExhibitFromUpload` reaches the same rule with the same
   * derived board), and NOT something to quietly narrow inside a migration —
   * see this task's report.
   *
   * Server-derived, never accepted from input, each for the reason
   * `meeting.insert` and `agendaItem.insert` give for their own:
   *
   *   - `town_id` from `ctx.tenant` (the raw insert sent it from client
   *     state, which is what made a cross-tenant row expressible at all);
   *   - `uploaded_by` from `ctx.tenant.userAccountId` (the raw insert set it
   *     to NULL, losing the attribution the column exists for);
   *   - `id` from the column's own `gen_random_uuid()` rather than a
   *     browser-minted `crypto.randomUUID()`;
   *   - `sort_order` computed as `MAX + 1` over the item's existing exhibits,
   *     the same expression `createExhibitFromUpload` uses. The raw insert
   *     sent `exhibits.length` from a client-side array that had been
   *     filtered to this item — the same answer whenever the client's list is
   *     current, and a duplicate whenever it is not.
   *
   * `file_type` is the literal string `'url'` — that is the sentinel every
   * reader of this table already switches on (`ExhibitRow.tsx`'s `isUrl`,
   * `resolveExhibitForDownload`'s refusal to proxy a link, `deleteExhibit`'s
   * decision not to look for bytes) — and `file_size` is left NULL rather
   * than the raw insert's `0`, because a link has no size and `0` is a claim.
   *
   * The URL itself is stored, not fetched. It is bounded and required to be
   * `http`/`https` — `z.string().url()` alone accepts `javascript:` and
   * `data:`, and `ExhibitRow.tsx` renders this value straight into an
   * `href`. Nothing on the server ever requests it:
   * `resolveExhibitForDownload` refuses to proxy a link precisely because
   * doing so would be server-side request forgery.
   */
  link: protectedProcedure
    .use(requireBoardActor(assertCanInsertExhibit))
    .input(
      z.object({
        boardId: z.string().uuid(),
        agendaItemId: z.string().uuid(),
        title: z.string().trim().min(1, "Title is required").max(200),
        url: z
          .string()
          .trim()
          .min(1)
          .max(2000)
          .refine((value) => /^https?:\/\//i.test(value), "Must be an http:// or https:// address"),
        exhibitType: z.string().min(1).max(50),
        visibility: z.enum(VISIBILITIES).default("public"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertAgendaItemOnAuthorizedBoard(ctx, tx, input.agendaItemId);

        const rows = toRows<{ id: string }>(
          await tx.execute(sql`
            INSERT INTO exhibit (
              agenda_item_id, town_id, title, file_storage_path, file_type, file_size,
              file_name, exhibit_type, visibility, sort_order, uploaded_by
            )
            VALUES (
              ${input.agendaItemId}, ${ctx.tenant.townId}, ${input.title}, ${input.url},
              'url', NULL, NULL, ${input.exhibitType},
              ${input.visibility}::exhibit_visibility,
              (SELECT COALESCE(MAX(e.sort_order) + 1, 0)
                 FROM exhibit e WHERE e.agenda_item_id = ${input.agendaItemId}),
              ${ctx.tenant.userAccountId}
            )
            RETURNING id
          `),
          (message) => new Error(`exhibit.link: ${message}`),
        );
        return { id: rows[0]!.id };
      });
    }),
});
