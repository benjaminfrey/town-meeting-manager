/**
 * Stage 1, Phase E, wave 2, Task 1 — the agenda template router.
 *
 * `agenda_template` rows hold the reusable section structure
 * `boards.$boardId.templates.tsx` (the list), its
 * `boards.$boardId.templates.$templateId.edit.tsx` sibling (the editor), and
 * `boards.$boardId.tsx`'s Overview tab (a bare count) all read or write today
 * through direct Supabase calls. This router replaces all three, and answers
 * the fourth `TODO(phase-e-wave-2)` marker wave 1 left —
 * `agendaTemplate.countForBoard` — the other three named in `board.ts`'s own
 * header.
 *
 * ─── Tenancy ────────────────────────────────────────────────────────────
 *
 * `agenda_template_tenant_isolation` (`0000_baseline.sql`) is a plain
 * `town_id = get_current_town_id()` policy, FOR ALL, no role predicate — the
 * same shape `board`'s own policy has. So the reads below (`list`, `detail`,
 * `countForBoard`) carry no permission guard, for the identical reason
 * `board.ts`'s header gives: tenancy was already the whole policy, and
 * `protectedProcedure` + `ctx.withTenant` IS that policy.
 *
 * ─── The FK this file's writes must not bypass ─────────────────────────────
 *
 * `agenda_template.board_id` is a foreign key into `board`, and Postgres's
 * own documentation is explicit that uniqueness/foreign-key constraint
 * enforcement BYPASSES row security to preserve data integrity — the exact
 * hazard conventions item 3 names, and the exact one a reviewer reproduced
 * live against `person.insertStaffAccount` in wave 1 (see that item for the
 * full account: a cross-tenant write that succeeds silently and then can
 * never be undone by the town it landed on). `insert` below takes `boardId`
 * from client input and references it in an `INSERT`, so it calls
 * `assertBoardExists` — imported from `board.ts` rather than duplicated, so
 * both routers run the exact same query for the exact same question — before
 * writing. `list` and `countForBoard` take the same `boardId` for a READ, not
 * a write with a foreign key to bypass, but call it too anyway: without it, a
 * `boardId` naming another town's board would silently degrade to an empty
 * list / a zero count (RLS filters the `agenda_template` rows, there just are
 * none for a board that was never really in scope) instead of answering
 * NOT_FOUND — precisely the "convincing, empty-but-real" failure conventions
 * item 3 closes for `board.stats`/`board.recentMeetings`, reproduced here for
 * a different table scanning by the same kind of id. `update`, `setDefault`
 * and `delete` need no such check: each names a specific `agenda_template.id`
 * as its own tenant-scoped `WHERE`/`UPDATE`/`DELETE` target — there is no
 * separate foreign id to bypass RLS through — and `RETURNING` already answers
 * "did that row exist in my town" directly, matching `board.update`'s
 * identical reasoning.
 *
 * ─── Authorization ──────────────────────────────────────────────────────
 *
 * The three writes here use `assertCanInsertAgendaTemplate`,
 * `assertCanUpdateAgendaTemplate` and `assertCanDeleteAgendaTemplate` from
 * `authorization/rules.ts` — all admin gates, all Actor-only (`(actor: Actor)
 * => void`), so all three go through `requireActor`, declared before
 * `.input()`, matching `board.ts`/`town.ts`/`person.ts` byte-for-byte in
 * shape. `setDefault` reuses `assertCanUpdateAgendaTemplate` rather than a
 * fourth rule: toggling which template is the default IS an update to an
 * agenda template's configuration, not a distinct action the product's
 * permission model gives its own name.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AgendaTemplateSectionSchema } from "@town-meeting/shared";
import { router, protectedProcedure, requireActor } from "../trpc.js";
import {
  assertCanInsertAgendaTemplate,
  assertCanUpdateAgendaTemplate,
  assertCanDeleteAgendaTemplate,
} from "../authorization/rules.js";
import { toRows } from "../../db/rows.js";
import { assertBoardExists } from "./board.js";

/**
 * Is this the `template_name_unique_per_board` collision, and not some other
 * write error? Checked by constraint name, not just `23505` — see
 * `town.ts`'s `isSubdomainCollision`, whose reasoning and depth-limited
 * `cause`-chain walk this mirrors exactly.
 */
function isTemplateNameCollision(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const e = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
    if (e.code === "23505") {
      const constraint = e.constraint_name ?? e.constraint;
      return constraint === "template_name_unique_per_board" || constraint === undefined;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The same width `insert`/`update` accept — a full section array, validated
 * with the schema `@town-meeting/shared` already defines for exactly this
 * shape (`agenda.schema.ts`), rather than a hand-rolled `z.array(z.unknown())`
 * that would accept anything. Reused wholesale, not narrowed further: this
 * router does not know, and should not guess, whether a future section field
 * is required here.
 */
const SectionsInput = z.array(AgendaTemplateSectionSchema);

export const agendaTemplateRouter = router({
  /**
   * `boards.$boardId.templates.tsx`'s list, and the source for its "Clone"
   * action — checked against that route's `templates.map(...)` block and
   * `handleClone`, which reads `name`/`sections` off the same row (`board_id`
   * and `town_id` are NOT read from this list any more: `handleClone`'s own
   * INSERT read them off the row only because the OLD Supabase write needed
   * them; the tRPC `insert` below takes `boardId` from the route's own params
   * and `town_id` from `ctx.tenant`, so cloning never needs to round-trip
   * either column — see `insert`'s own doc comment).
   *
   * Ordered `is_default DESC, name ASC`, matching the Supabase query this
   * replaces exactly.
   *
   * `sections` stays `unknown`, not the shared `AgendaTemplateSectionSchema`
   * array type: this is a READ off storage nothing here re-validates, the
   * identical trust boundary `board.detail`'s `notice_template_blocks:
   * unknown | null` already accepts for the same kind of column — narrowing
   * the TYPE without a runtime check backing it would just move the false
   * confidence from "trust the cast" to "trust the annotation". The client's
   * own `parseSections` helper (`lib/agenda-template-helpers.ts`) already
   * does the real parsing.
   */
  list: protectedProcedure
    .input(z.object({ boardId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertBoardExists(tx, input.boardId);
        return toRows<{ id: string; name: string; is_default: boolean; sections: unknown }>(
          await tx.execute(sql`
            SELECT id, name, is_default, sections
            FROM agenda_template
            WHERE board_id = ${input.boardId}
            ORDER BY is_default DESC, name ASC
          `),
          (message) => new Error(`agendaTemplate.list: ${message}`),
        );
      });
    }),

  /**
   * `boards.$boardId.templates.$templateId.edit.tsx`'s read: one template's
   * editable fields. NOT_FOUND for a `templateId` naming no row, or a row in
   * another town — `agenda_template_tenant_isolation` makes this `SELECT`
   * answer zero rows for either case identically (conventions item 3).
   */
  detail: protectedProcedure
    .input(z.object({ templateId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.withTenant(async (tx) =>
        toRows<{ id: string; name: string; sections: unknown }>(
          await tx.execute(sql`
            SELECT id, name, sections FROM agenda_template WHERE id = ${input.templateId}
          `),
          (message) => new Error(`agendaTemplate.detail: ${message}`),
        ),
      );
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  /**
   * `boards.$boardId.tsx`'s Overview tab: how many agenda templates this
   * board has, for a bare number the screen already renders as
   * `templateCount ?? 0` — see that route's own `TODO(phase-e-wave-2)`
   * marker, the one this procedure answers.
   */
  countForBoard: protectedProcedure
    .input(z.object({ boardId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertBoardExists(tx, input.boardId);
        const rows = toRows<{ count: number }>(
          await tx.execute(sql`
            SELECT count(*)::int AS count FROM agenda_template WHERE board_id = ${input.boardId}
          `),
          (message) => new Error(`agendaTemplate.countForBoard: ${message}`),
        );
        // The ::int cast is load-bearing — see `board.stats`'s identical note.
        return rows[0]?.count ?? 0;
      });
    }),

  /**
   * `CreateTemplateDialog`'s write (a fixed two-section starting point) and
   * `boards.$boardId.templates.tsx`'s `handleClone` (a full copy of an
   * existing template's sections) both become this one procedure: the only
   * difference between "create blank" and "clone" is which `sections` array
   * the CALLER sends, not a different server-side code path.
   *
   * `isDefault` defaults to `false`, matching both current callers — neither
   * ever creates a template that is immediately the default. The one place
   * that DOES need a fresh, empty board to get an `is_default: true` template
   * (`createDefaultTemplate`'s auto-create, run only when `templates.length
   * === 0`) can still ask for it explicitly; there is no existing default to
   * clear in that case, so `insert` alone is correct there and `setDefault`
   * below is not needed for it.
   *
   * `assertBoardExists` closes the FK-bypasses-RLS gap this file's header
   * describes: without it, a `boardId` naming another town's board would
   * still satisfy `agenda_template_board_id_fkey` and create a cross-tenant
   * template only that FOREIGN town's admin could ever see (RLS would hide
   * it from the caller's own later reads, the same permanent-orphan shape the
   * conventions doc's item 3 records for `person.insertStaffAccount`).
   */
  insert: protectedProcedure
    .use(requireActor(assertCanInsertAgendaTemplate))
    .input(
      z.object({
        boardId: z.string().uuid(),
        name: z.string().min(2, "Name must be at least 2 characters").max(100),
        sections: SectionsInput,
        isDefault: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sectionsJson = JSON.stringify(input.sections);
      try {
        const rows = await ctx.withTenant(async (tx) => {
          await assertBoardExists(tx, input.boardId);
          return toRows<{ id: string; name: string }>(
            await tx.execute(sql`
              INSERT INTO agenda_template (board_id, town_id, name, is_default, sections)
              VALUES (${input.boardId}, ${ctx.tenant.townId}, ${input.name}, ${input.isDefault},
                      ${sectionsJson}::jsonb)
              RETURNING id, name
            `),
            (message) => new Error(`agendaTemplate.insert: ${message}`),
          );
        });
        return rows[0]!;
      } catch (err) {
        if (isTemplateNameCollision(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A template named "${input.name}" already exists on this board.`,
            cause: err,
          });
        }
        throw err;
      }
    }),

  /**
   * `boards.$boardId.templates.$templateId.edit.tsx`'s save: name and
   * sections only — `is_default` is `setDefault`'s job below, not this
   * procedure's, matching the two screens' own separate actions ("Save"
   * versus the list page's "Set as default" star).
   *
   * NOT_FOUND for a `templateId` naming no row, or a row in another town —
   * same `UPDATE ... WHERE id = ... RETURNING` pattern `board.update` and
   * `person.update` already use.
   */
  update: protectedProcedure
    .use(requireActor(assertCanUpdateAgendaTemplate))
    .input(
      z.object({
        templateId: z.string().uuid(),
        name: z.string().min(2, "Name must be at least 2 characters").max(100),
        sections: SectionsInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sectionsJson = JSON.stringify(input.sections);
      try {
        const rows = await ctx.withTenant(async (tx) =>
          toRows<{ id: string; name: string }>(
            await tx.execute(sql`
              UPDATE agenda_template
              SET name = ${input.name}, sections = ${sectionsJson}::jsonb, updated_at = now()
              WHERE id = ${input.templateId}
              RETURNING id, name
            `),
            (message) => new Error(`agendaTemplate.update: ${message}`),
          ),
        );
        const row = rows[0];
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
        return row;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        if (isTemplateNameCollision(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A template named "${input.name}" already exists on this board.`,
            cause: err,
          });
        }
        throw err;
      }
    }),

  /**
   * `boards.$boardId.templates.tsx`'s "Set as default" star.
   *
   * The client-side version this replaces ran two sequential Supabase
   * writes — clear whichever row is currently the default, then set the new
   * one — an unavoidable race against a concurrent change between the two
   * round trips (the same shape `town.updateMinutesWorkflow`'s doc comment
   * and `board.copyNoticeTemplate`'s doc comment both call out for their own
   * two-step predecessors). Done here as ONE statement instead: every row
   * sharing the target's `board_id` gets `is_default` set to whether it IS
   * the target, atomically, so there is no window where a board can end up
   * with zero or two defaults.
   *
   * The `target` CTE re-reads `board_id` under the caller's own tenant
   * context, so a `templateId` naming no row (or another town's row,
   * invisible under RLS) makes `target.board_id` absent — the `UPDATE`'s
   * `WHERE agenda_template.board_id = target.board_id` then matches nothing,
   * zero rows come back, and the NOT_FOUND check below fires. Matching the
   * target's OWN `id` in the `RETURNING` set (rather than just checking the
   * row count) is what lets this tell "the target became the default" apart
   * from "some other row on the same board was returned but the target
   * itself was not touched" — which cannot actually happen given the `WHERE`
   * clause, but asserting on the specific row rather than "at least one row
   * came back" is the same discipline `board.copyNoticeTemplate` uses for its
   * own `RETURNING` check.
   */
  setDefault: protectedProcedure
    .use(requireActor(assertCanUpdateAgendaTemplate))
    .input(z.object({ templateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.withTenant(async (tx) =>
        toRows<{ id: string; is_default: boolean }>(
          await tx.execute(sql`
            WITH target AS (
              SELECT board_id FROM agenda_template WHERE id = ${input.templateId}
            )
            UPDATE agenda_template
            SET is_default = (agenda_template.id = ${input.templateId}), updated_at = now()
            FROM target
            WHERE agenda_template.board_id = target.board_id
            RETURNING agenda_template.id, agenda_template.is_default
          `),
          (message) => new Error(`agendaTemplate.setDefault: ${message}`),
        ),
      );
      const row = rows.find((r) => r.id === input.templateId);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  /**
   * `DeleteTemplateDialog`'s write. No FK from any other table references
   * `agenda_template.id` (checked against `packages/api/src/db/schema.ts`),
   * so this is a plain delete with no cascade to reason about.
   *
   * NOT_FOUND for a `templateId` naming no row, or a row in another town —
   * same `DELETE ... WHERE id = ... RETURNING` pattern as every other
   * single-row write in this file.
   */
  delete: protectedProcedure
    .use(requireActor(assertCanDeleteAgendaTemplate))
    .input(z.object({ templateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.withTenant(async (tx) =>
        toRows<{ id: string }>(
          await tx.execute(sql`
            DELETE FROM agenda_template WHERE id = ${input.templateId} RETURNING id
          `),
          (message) => new Error(`agendaTemplate.delete: ${message}`),
        ),
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      return { id: input.templateId };
    }),
});
