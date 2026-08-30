/**
 * Phase E, wave 1, Task 3 — the person router: the town-wide people
 * directory (`routes/people.tsx`) and the writes its dialogs make.
 *
 * ─── The join question the brief asked me to answer ───────────────────────
 *
 * `people.tsx` reads three tables today — `person`, `user_account`,
 * `board_member` — and joins them in JS. `list` below moves TWO of those
 * three into one SQL query: `person` LEFT JOIN `user_account`. It
 * deliberately does NOT fold in `board_member`.
 *
 * Reasoning, not a shortcut: `person` and `user_account` are both written
 * ONLY by procedures in this file (`insert`, `update`, `insertStaffAccount`,
 * `updateGovTitle`), so this router owns every writer of the cache key `list`
 * would need invalidated for those two tables — conventions item 7's "a read
 * owns its cache key" is satisfiable in full. `board_member` is not: it is
 * written by `AddMemberDialog`, `MemberArchiveDialog` and
 * `MemberTransitionDialog` — all Board → Members roster screens, none of
 * them in this task's file list, none of them touched here, and none of
 * them converted to tRPC yet. Folding `board_member` into `list`'s query
 * would make `trpc.person.pathFilter()` a key those three dialogs owe an
 * invalidation call to, in files this task does not touch and a reviewer
 * would have no reason to open — exactly the "found the hard way in Task 4"
 * failure item 7 warns about, except introduced instead of caught.
 *
 * So `people.tsx` keeps its board-membership read on Supabase, unchanged,
 * marked with a `TODO(phase-e-wave-2)` token per item 11. That read was
 * ALREADY not invalidated by name anywhere in the app before this task (grep
 * confirms no writer targets the ad hoc `[...queryKeys.members.all,
 * "byTown", townId]` key it uses) — so leaving it as is is not a regression,
 * it is the status quo, and it becomes this file's problem the day a
 * `boardMember` router exists to migrate it onto.
 *
 * `queryKeys.persons.byTown`/`queryKeys.userAccounts.byTown`, by contrast,
 * ARE read directly by other unmigrated screens (`AddMemberDialog`,
 * `meetings.$meetingId.review.tsx`) and written by others still
 * (`AddMemberDialog`, `MemberArchiveDialog`, `MemberTransitionDialog`) — see
 * those three dialogs' own diffs in this commit for the added
 * `trpc.person.pathFilter()` calls, per item 7.
 *
 * ─── Authorization ──────────────────────────────────────────────────────
 *
 * `list` carries no guard, for the same reason `board.ts`/`town.detail` do
 * not: `person_tenant_isolation`/`user_account_tenant_isolation` (Postgres
 * migration `0000_baseline.sql`) are both plain `town_id = get_current_town_id()`
 * policies — FOR ALL, no role predicate — so the OLD policy was tenancy-only,
 * and any authenticated member of a town could already read its directory.
 *
 * The four writes use `assertCanInsertPerson`, `assertCanUpdatePerson`,
 * `assertCanInsertUserAccount`, `assertCanUpdateUserAccount` from
 * `authorization/rules.ts` — all admin gates, all Actor-only in the sense
 * that matters for conventions item 2: none of them needs a board. Three of
 * the four (`assertCanInsertPerson`, `assertCanUpdatePerson`,
 * `assertCanInsertUserAccount`) take ONLY an `Actor`, which is exactly
 * `requireActor`'s shape, so `insert`/`update`/`insertStaffAccount` use it,
 * declared before `.input()`, matching `town.ts`'s four converted mutations
 * byte-for-byte in structure.
 *
 * `assertCanUpdateUserAccount` does not fit `requireActor` — it takes a
 * second argument, `subject: { userAccountId, columns }`, because its
 * self-branch authorizes the ROW, not the COLUMNS (see its own doc comment
 * in `rules.ts`). `requireActor`'s signature is `(actor: Actor) => R`; there
 * is no second parameter to carry a subject. Two ways to place this
 * procedure's guard were considered:
 *
 *   (a) call `assertCanUpdateUserAccount` in the resolver, after `.input()`;
 *   (b) a small dedicated middleware, declared before `.input()`, that reads
 *       `userAccountId` off the UNVALIDATED body via `getRawInput()` — the
 *       exact mechanism `requireBoardPermission`/`boardIdFrom` already use
 *       for a board id — with `columns` supplied as a compile-time constant
 *       per procedure (never client input, so nothing to extract).
 *
 * (a) is the shape conventions item 2 spent two fix rounds condemning: a
 * refused caller whose input also fails to parse would get BAD_REQUEST from
 * the parser instead of FORBIDDEN from the guard, because `.input()` runs
 * first and the resolver — where the assert would live — never gets a
 * chance to run. `updateGovTitle` below is (b): `requireOwnAccountColumns`,
 * a one-off local middleware, not a new export on `trpc.ts` — nothing else
 * in the app needs this exact shape today, and conventions item 2's own
 * header warns that primitives file is "wrong 70 times over" if it is wrong
 * once, which is reason enough to keep a single-use shape local until a
 * second caller actually needs it.
 *
 * `userAccountId` is client-supplied and, unlike `board_member`, referenced
 * by a foreign key (`user_account.person_id -> person.id`) that a NEW write
 * in this file (`insertStaffAccount`) must not be allowed to point at
 * another town's person row. Postgres's own docs are explicit that
 * uniqueness/foreign-key constraint enforcement BYPASSES row security to
 * preserve data integrity, so `person_tenant_isolation` alone does not stop
 * `insertStaffAccount` from linking a foreign `personId` to a same-town
 * `user_account` if the input is not checked first — `assertPersonExists`
 * below closes that the same way `board.ts`'s `assertBoardExists` closes
 * the analogous gap for `board_member`'s FK.
 */

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { UserRole } from "@town-meeting/shared";
import { router, protectedProcedure, requireActor, middleware } from "../trpc.js";
import {
  assertCanInsertPerson,
  assertCanUpdatePerson,
  assertCanInsertUserAccount,
  assertCanUpdateUserAccount,
} from "../authorization/rules.js";
import { toRows } from "../../db/rows.js";
import type { TenantTx } from "../../db/with-tenant.js";

/**
 * Is this the `person_email_unique_per_town` collision, and not some other
 * write error? Checked by constraint name, not just `23505` — see
 * `town.ts`'s `isSubdomainCollision`, whose reasoning and depth-limited
 * `cause`-chain walk this mirrors exactly (Drizzle wraps a driver failure in
 * `DrizzleQueryError` and keeps the original on `cause`).
 */
function isPersonEmailCollision(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const e = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
    if (e.code === "23505") {
      const constraint = e.constraint_name ?? e.constraint;
      return constraint === "person_email_unique_per_town" || constraint === undefined;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Same shape, for `user_account_person_id_key` (a person already has an account). */
function isAccountAlreadyExistsCollision(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const e = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
    if (e.code === "23505") {
      const constraint = e.constraint_name ?? e.constraint;
      return constraint === "user_account_person_id_key" || constraint === undefined;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Confirm the person exists in the caller's own town before letting a write
 * reference it by id — see this file's header for why `insertStaffAccount`
 * needs this and `update`/`updateGovTitle` do not (their own UPDATE is
 * itself RLS-scoped; there is no FK to bypass).
 *
 * Exported (Phase E, wave 2, Task 3) so `board-member.ts` can run the
 * identical check for its own FK-bearing writes (`addBoardMember`,
 * `addStaffMember`) rather than duplicating the query — the same reuse
 * `board.ts` already set up for `assertBoardExists`.
 */
export async function assertPersonExists(tx: TenantTx, personId: string): Promise<void> {
  const rows = toRows<{ id: string }>(
    await tx.execute(sql`SELECT id FROM person WHERE id = ${personId}`),
    (message) => new Error(`person.assertPersonExists: ${message}`),
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
}

/**
 * A permissions matrix, validated loosely on purpose.
 *
 * `packages/shared/src/utils/permissions.ts`'s own header is the reason:
 * the same thirty actions have two accepted spellings (action CODE and
 * action NAME) and BOTH are live in the database today, written by
 * different parts of the product. Narrowing this schema's keys to one
 * spelling — or to the closed set of thirty action codes/names — would
 * REJECT input `StaffAccountFlow` legitimately sends (it writes NAMES) the
 * moment anyone "tidied" this schema without reading that file first, which
 * is the exact mistake the task brief calls out by name. So: any string key,
 * boolean value, on both `global` and each board override's `permissions` —
 * the same width `normalisePermissionsMatrix` accepts on read. This
 * procedure does not call `normalisePermissionsMatrix` either; it persists
 * exactly the object the client sent, the same as `AddPersonDialog`'s
 * current direct Supabase insert does.
 *
 * Exported (Phase E, wave 2, Task 3) so `board-member.ts`'s `addStaffMember`
 * — `AddMemberDialog`'s staff path — can reuse this exact contract rather
 * than redeclaring it with a chance to narrow it by accident.
 */
export const PermissionsMatrixInput = z.object({
  global: z.record(z.string(), z.boolean()).default({}),
  board_overrides: z
    .array(
      z.object({
        board_id: z.string().uuid(),
        permissions: z.record(z.string(), z.boolean()),
      }),
    )
    .default([]),
});

/**
 * `assertCanUpdateUserAccount`'s middleware form — see this file's header
 * for why it is not `requireActor`. `columns` is a compile-time constant per
 * call site (never derived from input), and `userAccountId` is read off the
 * UNVALIDATED body via `getRawInput()`, exactly as `requireBoardPermission`
 * reads a board id: declared before `.input()`, so a refused caller whose
 * input ALSO fails to parse still gets FORBIDDEN, not BAD_REQUEST — the
 * defect conventions item 2 spent two fix rounds closing for the board-scoped
 * and actor-only forms, reproduced here for this third shape instead of
 * being reintroduced by omission.
 */
function requireOwnAccountColumns(columns: readonly string[]) {
  return middleware(async (opts) => {
    const ctx = opts.ctx;
    if (!ctx.actor) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "A permission check ran on a procedure with no tenant context. Permission " +
          "checks are only meaningful for a signed-in member of a town; build the " +
          "procedure on protectedProcedure.",
      });
    }
    const raw = await opts.getRawInput();
    const userAccountId =
      raw &&
      typeof raw === "object" &&
      typeof (raw as { userAccountId?: unknown }).userAccountId === "string"
        ? (raw as { userAccountId: string }).userAccountId
        : undefined;
    if (!userAccountId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This procedure requires a userAccountId to authorize against.",
      });
    }
    assertCanUpdateUserAccount(await ctx.actor(), { userAccountId, columns });
    return opts.next();
  });
}

export const personRouter = router({
  /**
   * The town-wide people directory: every person plus their (at most one,
   * unarchived) login account. See this file's header for why `board_member`
   * is not joined in here.
   *
   * Column list checked against `routes/people.tsx`'s `rows` mapping: `id`,
   * `name`, `email` build the row identity; `role`/`gov_title` build the
   * label. Not `SELECT *`, for the same reason as every other procedure in
   * this phase — conventions item 1.
   *
   * `user_account_id` was here once, justified as "what `EditGovTitleDialog`
   * needs to call `updateGovTitle`" — wrong, caught in review: that dialog is
   * mounted only from `MemberRoster.tsx`, fed by its own Supabase query, not
   * from this procedure. `people.tsx` never read the column either. Dropped
   * rather than re-justified; add it back, with a real caller named, the day
   * something reads it.
   *
   * No `WHERE p.town_id = ...` — deliberately, matching `board.ts`'s reads:
   * `person_tenant_isolation` is `FORCE ROW LEVEL SECURITY`, so a session
   * scoped to this tenant already cannot see another town's `person` rows.
   * Adding the comparison back would be the "second town-id comparison in
   * TypeScript" item 2 warns against — a weaker duplicate of RLS that people
   * eventually trust instead of RLS itself. The `user_account` half of the
   * `LEFT JOIN` was already RLS-only (no `ua.town_id` check); this makes both
   * halves consistent rather than picking one style per column.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.withTenant(async (tx) =>
      toRows<{
        id: string;
        name: string;
        email: string | null;
        role: UserRole | null;
        gov_title: string | null;
      }>(
        await tx.execute(sql`
          SELECT
            p.id, p.name, p.email,
            ua.role, ua.gov_title
          FROM person p
          LEFT JOIN user_account ua
            ON ua.person_id = p.id AND ua.archived_at IS NULL
          WHERE p.archived_at IS NULL
          ORDER BY p.name
        `),
        (message) => new Error(`person.list: ${message}`),
      ),
    );
    return rows;
  }),

  /**
   * `AddPersonDialog`'s step 1: create the person, decoupled from any
   * board or account. `id` is database-generated (`person.id`'s own
   * `defaultRandom()`), not client-supplied — one less thing a caller
   * controls.
   */
  insert: protectedProcedure
    .use(requireActor(assertCanInsertPerson))
    .input(
      z.object({
        name: z.string().min(2, "Name must be at least 2 characters").max(100),
        email: z.string().email("Must be a valid email"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const name = input.name.trim();
      const email = input.email.toLowerCase().trim();
      let rows: { id: string; name: string; email: string | null }[];
      try {
        rows = await ctx.withTenant(async (tx) =>
          toRows<{ id: string; name: string; email: string | null }>(
            await tx.execute(sql`
              INSERT INTO person (town_id, name, email)
              VALUES (${ctx.tenant.townId}, ${name}, ${email})
              RETURNING id, name, email
            `),
            (message) => new Error(`person.insert: ${message}`),
          ),
        );
      } catch (err) {
        if (isPersonEmailCollision(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A person with the email "${email}" already exists in your town.`,
            cause: err,
          });
        }
        throw err;
      }
      return rows[0]!;
    }),

  /**
   * `EditPersonDialog`'s write: a person's name and email.
   *
   * NOT_FOUND for a `personId` naming no row, or a row in another town —
   * `person_tenant_isolation` makes the UPDATE affect zero rows for either
   * case identically (conventions item 3).
   */
  update: protectedProcedure
    .use(requireActor(assertCanUpdatePerson))
    .input(
      z.object({
        personId: z.string().uuid(),
        name: z.string().min(2, "Name must be at least 2 characters").max(100),
        email: z.string().email("Must be a valid email"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const name = input.name.trim();
      const email = input.email.toLowerCase().trim();
      let rows: { id: string; name: string; email: string | null }[];
      try {
        rows = await ctx.withTenant(async (tx) =>
          toRows<{ id: string; name: string; email: string | null }>(
            await tx.execute(sql`
              UPDATE person SET name = ${name}, email = ${email}
              WHERE id = ${input.personId}
              RETURNING id, name, email
            `),
            (message) => new Error(`person.update: ${message}`),
          ),
        );
      } catch (err) {
        if (isPersonEmailCollision(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Another person already uses the email "${email}".`,
            cause: err,
          });
        }
        throw err;
      }
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  /**
   * `AddPersonDialog`'s step 2 "Staff account" path, and `StaffAccountFlow`'s
   * write: a `user_account` for an EXISTING person, always `role: 'staff'`.
   *
   * `role` is not a client-controlled field — it is hardcoded below — for
   * the same reason this procedure exists at all rather than a generic
   * "insert a user_account" endpoint: nothing about a permission MATRIX can
   * make an `admin`/`sys_admin` account safe to self-serve, and the product
   * has never offered that door. `assertCanInsertUserAccount` is an admin
   * gate regardless, but a narrower input schema is a second, independent
   * reason this can never mint an administrator.
   *
   * `permissions` is written EXACTLY as sent — see `PermissionsMatrixInput`'s
   * own comment and the task brief: do not normalise, canonicalise, or
   * "tidy" a spelling here. That is what silently broke both
   * `designated_boards` permission templates for five months.
   *
   * `assertPersonExists` closes the FK-bypasses-RLS gap this file's header
   * describes — without it, a `personId` naming another town's person would
   * still pass `user_account_person_id_fkey` and create a cross-tenant
   * account.
   */
  insertStaffAccount: protectedProcedure
    .use(requireActor(assertCanInsertUserAccount))
    .input(
      z.object({
        personId: z.string().uuid(),
        govTitle: z.string().max(100).nullable().default(null),
        permissions: PermissionsMatrixInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const govTitle = input.govTitle?.trim() || null;
      const permissionsJson = JSON.stringify(input.permissions);
      try {
        const rows = await ctx.withTenant(async (tx) => {
          await assertPersonExists(tx, input.personId);
          return toRows<{ id: string }>(
            await tx.execute(sql`
              INSERT INTO user_account (person_id, town_id, role, gov_title, permissions)
              VALUES (${input.personId}, ${ctx.tenant.townId}, 'staff'::user_role,
                      ${govTitle}, ${permissionsJson}::jsonb)
              RETURNING id
            `),
            (message) => new Error(`person.insertStaffAccount: ${message}`),
          );
        });
        return { id: rows[0]!.id, person_id: input.personId, gov_title: govTitle };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        if (isAccountAlreadyExistsCollision(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This person already has a login account.",
            cause: err,
          });
        }
        throw err;
      }
    }),

  /**
   * `EditGovTitleDialog`'s write: `user_account.gov_title` only.
   *
   * `gov_title` is one of `ADMIN_ONLY_USER_ACCOUNT_COLUMNS`
   * (`rules.ts`), so `assertCanUpdateUserAccount`'s self-branch — "you may
   * change your own account" — does NOT cover it: only an administrator can
   * ever satisfy this guard, by design (see the brief and `rules.ts`'s own
   * comment on why: "there is no self-service profile editor today, so
   * denying it costs nothing").
   *
   * NOT_FOUND parity: `user_account_tenant_isolation` scopes the UPDATE the
   * same way `person_tenant_isolation` scopes `update` above.
   */
  updateGovTitle: protectedProcedure
    .use(requireOwnAccountColumns(["gov_title"]))
    .input(
      z.object({
        userAccountId: z.string().uuid(),
        govTitle: z.string().max(100).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const govTitle = input.govTitle?.trim() || null;
      const rows = await ctx.withTenant(async (tx) =>
        toRows<{ id: string }>(
          await tx.execute(sql`
            UPDATE user_account SET gov_title = ${govTitle}
            WHERE id = ${input.userAccountId}
            RETURNING id
          `),
          (message) => new Error(`person.updateGovTitle: ${message}`),
        ),
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      return { user_account_id: input.userAccountId, gov_title: govTitle };
    }),

  /**
   * `RoleConflictDialog.tsx`'s write (Phase E, wave 2, Task 4): archive a
   * `user_account` to resolve a staff/board_member mutual-exclusivity
   * conflict before seating a person as the other role.
   *
   * Same guard shape as `updateGovTitle` immediately above, for the same
   * reason: `archived_at` is also one of `ADMIN_ONLY_USER_ACCOUNT_COLUMNS`,
   * so `requireOwnAccountColumns(["archived_at"])` refuses EVERY non-admin
   * caller — including one archiving their own account — which is the
   * correct answer here too: this dialog is only ever reached from an
   * admin's Board → Members roster screen, never a self-service flow.
   *
   * NOT_FOUND parity: `user_account_tenant_isolation` scopes the UPDATE the
   * same way it does for `updateGovTitle`.
   *
   * Does not itself resolve the "archived account still blocks a new seat"
   * gap `phase-e-conventions.md`'s Known-gaps entry names — that is
   * `addBoardMember`'s reactivation branch reading an already-archived row,
   * which this procedure's own write makes possible; nothing here needs to
   * change for that fix, only the seating path.
   */
  archiveUserAccount: protectedProcedure
    .use(requireOwnAccountColumns(["archived_at"]))
    .input(z.object({ userAccountId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.withTenant(async (tx) =>
        toRows<{ id: string }>(
          await tx.execute(sql`
            UPDATE user_account SET archived_at = now()
            WHERE id = ${input.userAccountId}
            RETURNING id
          `),
          (message) => new Error(`person.archiveUserAccount: ${message}`),
        ),
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      return { user_account_id: input.userAccountId };
    }),
});
