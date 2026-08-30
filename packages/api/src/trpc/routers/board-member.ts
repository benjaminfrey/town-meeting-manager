/**
 * Phase E, wave 2, Task 3 — board membership: seats, the staff/board-member
 * accounts that come with them, and the invitations both paths issue.
 *
 * This is the largest single migration in the wave: `AddMemberDialog.tsx`
 * alone made 14 raw Supabase calls (5 reads, 9 writes — counted directly
 * against that file before this task), all replaced below.
 *
 * ─── `memberCount`, relocated ──────────────────────────────────────────────
 *
 * Wave 2 Task 1 shipped this procedure as `board.memberCount` because no
 * `boardMember` router existed yet (see `board.ts`'s own header, "Task 1,
 * wave 2"). Its subject is `board_member` rows keyed to the town, which is
 * this router's noun by conventions item 1, not `board`'s. Moved verbatim —
 * same query, same doc reasoning, same test coverage (moved from
 * `board.test.ts` to this file's own test file) — now that a home for it
 * exists. `ProgressChecklist.tsx` is its only caller; updated in this same
 * commit.
 *
 * ─── Three hazards, and how each is closed ─────────────────────────────────
 *
 * 1. FK-BYPASSES-RLS, twice over. `addBoardMember` and `addStaffMember` both
 *    take a client-supplied `personId` that becomes the `person_id` foreign
 *    key on a new `user_account` row; `addBoardMember` ALSO takes a
 *    client-supplied `boardId` that becomes the `board_id` foreign key on a
 *    new `board_member` row. Postgres's own docs say FK enforcement bypasses
 *    row security, so neither reference is safe without an explicit,
 *    tenant-scoped existence check first — `assertPersonExists` (exported
 *    from `person.ts`, the same instance that router already uses for its
 *    own `insertStaffAccount`) and `assertBoardExists` (exported from
 *    `board.ts`) close both, run inside the same `withTenant` transaction as
 *    the writes they guard.
 *
 * 2. THE PERMISSIONS MATRIX. `addStaffMember` persists `permissions` EXACTLY
 *    as the client sends it — no `normalisePermissionsMatrix`, no reshaping.
 *    `PermissionsMatrixInput` is imported from `person.ts` rather than
 *    redeclared here, so the "any string key, both spellings accepted on
 *    write" contract lives in exactly one place. See that file's own comment
 *    for why a narrower schema would silently break `StaffAccountFlow.tsx`
 *    the same way two of five permission templates were already broken for
 *    five months.
 *
 * 3. INVITATIONS. Every invitation this router writes gets its `token` from
 *    `gen_random_uuid()`, generated IN THE DATABASE — never from client
 *    input. The code this replaces (`AddMemberDialog.tsx`'s two `mutationFn`s)
 *    generated the token with `crypto.randomUUID()` IN THE BROWSER and sent
 *    it up as part of the insert payload: a client that controlled its own
 *    invitation token, for a token whose entire security property (per
 *    `db/invitation-bootstrap.ts`'s own header) is that it is unguessable.
 *    Not a disclosure by itself — `invitation_token_key` is unique, so a
 *    predictable value only ever collides — but generating it server-side
 *    removes the client from that trust boundary entirely, which is the
 *    stronger property the brief asks for ("do not weaken it"). Everything
 *    else about an invitation — the person, the account, the town, the
 *    expiry — is still read back afterward through `withTenant`, same as
 *    before; this router never reads `better_auth.invitation_tenant` itself,
 *    only ever writes rows that its trigger keeps in sync.
 *
 * ─── Why person creation is NOT inlined here ───────────────────────────────
 *
 * `AddMemberDialog.tsx`'s original `mutationFn`s created a brand-new person
 * as their first step when needed. This router does not offer that: a caller
 * creating a NEW person calls `person.insert` first (already admin-gated,
 * already handles the email-collision CONFLICT) and passes the resulting id
 * to `addBoardMember`/`addStaffMember` as an ordinary existing `personId` —
 * the identical two-step shape `AddPersonDialog` already uses for
 * `person.insert` → `person.insertStaffAccount`, per that router's own header.
 * Duplicating person-creation-with-collision-handling a third time here would
 * be the same logic in three places instead of one; conventions item 1 keeps
 * one noun in one router.
 *
 * ─── Mutual exclusivity, enforced here rather than trusted from the client ─
 *
 * Staff and board_member are mutually exclusive (Maine 30-A M.R.S.A. §2605).
 * `checkRoleMutualExclusivity` (`@town-meeting/shared`) is already called
 * client-side by `AddMemberDialog`/`MemberTransitionDialog` to warn an admin
 * and route them through `RoleConflictDialog`. `addBoardMember` calls it
 * AGAIN here, against whatever `user_account` row actually exists for
 * `personId` right now (not what the client believes exists), and refuses
 * with CONFLICT if the role conflicts. This is not redundant: `RoleConflictDialog`
 * only ARCHIVES the conflicting account (`archived_at`), it does not delete
 * the row, and `user_account_person_id_key` is unique on `person_id` alone —
 * not filtered by `archived_at`. A person whose staff account was just
 * archived to resolve a conflict still has a row with `role = 'staff'`, so
 * this check still refuses them for a NEW board seat today. That is a
 * pre-existing product gap (the current, unmigrated code hits the identical
 * unique-constraint collision as a raw, uncaught 500 in this exact scenario —
 * traced, not guessed, against `AddMemberDialog.tsx`'s original two
 * `mutationFn`s), not one of this task's three named hazards. Named in full,
 * with the fix shape, in `phase-e-conventions.md`'s Known-gaps entry "Both
 * doors from staff to board_member dead-end at `RoleConflictDialog`" — do not
 * redesign it here; that entry is the record of what the fix should be and
 * why it was deferred. `addStaffMember` needs no equivalent check:
 * `user_account_person_id_key` refuses ANY second account for the same
 * person regardless of role, so the collision handler already shared with
 * `person.insertStaffAccount` (`isAccountAlreadyExistsCollision`) covers it
 * structurally.
 *
 * A DIFFERENT case — no role conflict, but the existing account is
 * archived — is NOT a gap: `addBoardMember`'s reuse branch reactivates it
 * (`archived_at = NULL`) rather than seating the person against a still-dead
 * account. See that branch's own comment; a review round caught this as a
 * live defect (silent broken success, not a refusal) before it shipped.
 */

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { checkRoleMutualExclusivity } from "@town-meeting/shared";
import type { UserRole } from "@town-meeting/shared";
import { router, protectedProcedure, requireActor } from "../trpc.js";
import { assertCanInsertBoardMember, assertCanInsertUserAccount } from "../authorization/rules.js";
import { assertBoardExists } from "./board.js";
import { assertPersonExists, PermissionsMatrixInput } from "./person.js";
import { toRows } from "../../db/rows.js";
import type { TenantTx } from "../../db/with-tenant.js";

/** Same shape as `person.ts`'s identical helper, for `user_account_person_id_key`. */
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
 * `board_member_unique_active` — a person cannot hold two ACTIVE seats on the
 * same board. `searchCandidates` already excludes a person with an active
 * seat on `boardId` from its results, so this fires only when a caller
 * bypasses that (a stale search result, a direct call), not on the normal
 * path — defense, not the primary guard.
 */
function isBoardMemberSeatCollision(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const e = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
    if (e.code === "23505") {
      const constraint = e.constraint_name ?? e.constraint;
      return constraint === "board_member_unique_active" || constraint === undefined;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** `person.name`, for the toast the client shows after a successful add. */
async function getPersonName(tx: TenantTx, personId: string): Promise<string> {
  const rows = toRows<{ name: string }>(
    await tx.execute(sql`SELECT name FROM person WHERE id = ${personId}`),
    (message) => new Error(`boardMember.getPersonName: ${message}`),
  );
  return rows[0]?.name ?? "";
}

/**
 * Every invitation this router issues, in one place. `token` is
 * `gen_random_uuid()` — generated IN THE DATABASE, never from client input;
 * see this file's header, hazard 3. `id`/`status` are database defaults
 * except `expires_at`, which has none (nullable, no default) and is set
 * explicitly to 7 days out — the same window `AddMemberDialog.tsx`'s
 * original code used.
 *
 * Returns the new `id` so the caller can fire the "send invitation email"
 * request (`POST /api/invitations/:id/send`) — the original client code did
 * this itself, best-effort, right after the raw Supabase insert; both
 * `addBoardMember` and `addStaffMember` hand it back for the same reason.
 */
async function insertInvitation(
  tx: TenantTx,
  params: { personId: string; userAccountId: string; townId: string },
): Promise<string> {
  const rows = toRows<{ id: string }>(
    await tx.execute(sql`
      INSERT INTO invitation (person_id, user_account_id, town_id, token, status, expires_at)
      VALUES (${params.personId}, ${params.userAccountId}, ${params.townId},
              gen_random_uuid()::text, 'pending', now() + interval '7 days')
      RETURNING id
    `),
    (message) => new Error(`boardMember.insertInvitation: ${message}`),
  );
  return rows[0]!.id;
}

/** A permissions matrix with every action set to `false` — a fresh board-member seat's starting grant. */
const EMPTY_PERMISSIONS_JSON = JSON.stringify({ global: {}, board_overrides: [] });

export const boardMemberRouter = router({
  /**
   * `ProgressChecklist.tsx`'s "Board members added (N of M seats)" row.
   * Relocated from `board.ts` (wave 2, Task 1) — see this file's header.
   * Unchanged: counts EVERY `board_member` row in the town, active or
   * archived, no `status = 'active'` filter — see the original procedure's
   * history for why (`board.test.ts`'s moved-over test still pins it).
   */
  memberCount: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.withTenant(async (tx) =>
      toRows<{ count: number }>(
        await tx.execute(sql`
          SELECT count(*)::int AS count FROM board_member
        `),
        (message) => new Error(`boardMember.memberCount: ${message}`),
      ),
    );
    // The ::int cast is load-bearing — postgres.js returns count(*) as the
    // string "0", not the number 0. See `board.stats`'s identical note.
    return rows[0]?.count ?? 0;
  }),

  /**
   * `MemberRoster.tsx`'s read: every `board_member` row on one board, joined
   * with the person's name/email, their (at most one, per
   * `user_account_person_id_key`) account, and their MOST RECENT invitation —
   * replacing that component's three separate reads (`board_member`+embedded
   * `person`, `user_account` by town, `invitation` by town, merged in JS).
   *
   * Not filtered to `ua.archived_at IS NULL`, unlike `person.list`'s join:
   * `MemberRoster` deliberately shows an archived account (`user_account_archived`
   * feeds `MemberArchiveDialog`/`MemberTransitionDialog`'s "has an account"
   * checks) — see `person.list`'s own comment for the contrasting case where
   * the directory page wants only a LIVE account.
   *
   * The invitation is a `LEFT JOIN LATERAL` scoped to `bm.person_id`, ordered
   * by `created_at DESC`, `LIMIT 1` — the same "most recent wins" rule the
   * original client-side `invMap` built (an invitation list sorted DESC by
   * `created_at`, first-seen-per-person kept). Scoped by board via the outer
   * `WHERE bm.board_id = ...`, not by town: this is a per-board roster, and
   * an invitation is looked up per PERSON on that roster, matching the
   * original component exactly (it merged a town-wide invitation list onto a
   * board-scoped member list; narrowing the invitation lookup to the people
   * actually on this board's roster is the same answer with no town-wide
   * scan).
   */
  roster: protectedProcedure
    .input(z.object({ boardId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertBoardExists(tx, input.boardId);
        return toRows<{
          id: string;
          person_id: string;
          board_id: string;
          seat_title: string | null;
          term_start: string | null;
          term_end: string | null;
          status: string;
          is_default_rec_sec: boolean;
          name: string;
          email: string | null;
          user_account_id: string | null;
          role: UserRole | null;
          gov_title: string | null;
          user_account_archived_at: string | null;
          invitation_id: string | null;
          invitation_token: string | null;
          invitation_status: string | null;
          invitation_sent_at: string | null;
          invitation_expires_at: string | null;
        }>(
          await tx.execute(sql`
            SELECT
              bm.id, bm.person_id, bm.board_id, bm.seat_title, bm.term_start, bm.term_end,
              bm.status, bm.is_default_rec_sec,
              p.name, p.email,
              ua.id AS user_account_id, ua.role, ua.gov_title,
              ua.archived_at AS user_account_archived_at,
              inv.id AS invitation_id, inv.token AS invitation_token,
              inv.status AS invitation_status, inv.sent_at AS invitation_sent_at,
              inv.expires_at AS invitation_expires_at
            FROM board_member bm
            JOIN person p ON p.id = bm.person_id
            LEFT JOIN user_account ua ON ua.person_id = p.id
            LEFT JOIN LATERAL (
              SELECT id, token, status, sent_at, expires_at
              FROM invitation
              WHERE person_id = bm.person_id
              ORDER BY created_at DESC
              LIMIT 1
            ) inv ON true
            WHERE bm.board_id = ${input.boardId}
            ORDER BY p.name
          `),
          (message) => new Error(`boardMember.roster: ${message}`),
        );
      });
    }),

  /**
   * `AddMemberDialog.tsx` step 1's search: people matching `query` by
   * name/email, excluding anyone already an ACTIVE member of `boardId` —
   * replacing that component's four separate reads (`person` search,
   * `user_account` by town, `board_member` active-counts by town,
   * `board_member` active-on-this-board by town), merged and filtered in JS.
   *
   * `query.min(2)` mirrors the client's own gate (`searchQuery.trim().length
   * >= 2`) — enforced here too so a caller cannot force a town-wide scan with
   * a one-character or empty pattern.
   *
   * `active_board_count` is a correlated subquery — the same shape
   * `board.stats.active_members` and `board.list.active_member_count` already
   * use, summed per PERSON instead of per board here.
   *
   * `ua.archived_at IS NULL` — NOT `roster`'s shape. The Supabase read this
   * replaces (`AddMemberDialog.tsx`'s original `uaRows` query) filtered
   * `.is("archived_at", null)`, so a person whose only account is archived
   * came back with `role: null` — the UI treats them as account-less and
   * lets `handleSelectPerson` route them into the "create a fresh account"
   * branch. Dropping the filter here (as a first version of this procedure
   * did) surfaces the archived account's role/id to the client, which is the
   * same "reuse an archived account without reviving it" shape the review
   * caught in `addBoardMember` below — this filter is this read's half of
   * that fix, not a stylistic choice. Contrast with `roster`, which
   * deliberately keeps an archived account visible (that screen NEEDS to
   * show archived state) — two different questions, two different answers.
   */
  searchCandidates: protectedProcedure
    .input(z.object({ boardId: z.string().uuid(), query: z.string().min(2).max(200) }))
    .query(async ({ ctx, input }) => {
      const pattern = `%${input.query.trim()}%`;
      return ctx.withTenant(async (tx) => {
        await assertBoardExists(tx, input.boardId);
        return toRows<{
          id: string;
          name: string;
          email: string | null;
          role: UserRole | null;
          user_account_id: string | null;
          active_board_count: number;
        }>(
          await tx.execute(sql`
            SELECT
              p.id, p.name, p.email, ua.role, ua.id AS user_account_id,
              (SELECT count(*)::int FROM board_member
                 WHERE person_id = p.id AND status = 'active') AS active_board_count
            FROM person p
            LEFT JOIN user_account ua ON ua.person_id = p.id AND ua.archived_at IS NULL
            WHERE p.archived_at IS NULL
              AND (p.name ILIKE ${pattern} OR p.email ILIKE ${pattern})
              AND NOT EXISTS (
                SELECT 1 FROM board_member
                WHERE person_id = p.id AND board_id = ${input.boardId} AND status = 'active'
              )
            ORDER BY p.name
          `),
          (message) => new Error(`boardMember.searchCandidates: ${message}`),
        );
      });
    }),

  /**
   * `AddMemberDialog.tsx`'s live "a person with this email already exists"
   * check, run while the admin is still typing a new person's email —
   * replacing that component's fifth read (`person` filtered by exact
   * email). Returns a bare boolean, matching the client's own `emailExists =
   * emailCheckRows.length > 0`.
   */
  personEmailExists: protectedProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ ctx, input }) => {
      const email = input.email.toLowerCase().trim();
      const rows = await ctx.withTenant(async (tx) =>
        toRows<{ id: string }>(
          await tx.execute(sql`SELECT id FROM person WHERE email = ${email} LIMIT 1`),
          (message) => new Error(`boardMember.personEmailExists: ${message}`),
        ),
      );
      return rows.length > 0;
    }),

  /**
   * `AddMemberDialog.tsx`'s board-member write: seat an EXISTING person on a
   * board, creating a `board_member`-role `user_account` for them if they
   * have none, and an invitation. See this file's header for the FK checks,
   * the mutual-exclusivity check, and why person creation is a separate
   * `person.insert` call the client makes first.
   *
   * `isDefaultRecSec: true` unsets any other default recording secretary on
   * this board FIRST — same order as the original `mutationFn`, so the new
   * seat is never briefly co-default with the old one.
   */
  addBoardMember: protectedProcedure
    .use(requireActor(assertCanInsertBoardMember))
    .input(
      z.object({
        personId: z.string().uuid(),
        boardId: z.string().uuid(),
        seatTitle: z.string().max(100).nullable(),
        // `board_member.term_start` is NOT NULL with no default (see
        // `db/schema.ts`); `term_end` is nullable. The client's own date
        // input can be cleared to empty, which the original Supabase insert
        // let through as `null` and Postgres rejected with a raw, uncaught
        // 23502 — required (non-empty) here so that mistake answers
        // BAD_REQUEST at the boundary instead.
        termStart: z.string().min(1, "Term start is required"),
        termEnd: z.string().nullable(),
        govTitle: z.string().max(100).nullable(),
        isDefaultRecSec: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertPersonExists(tx, input.personId);
        await assertBoardExists(tx, input.boardId);
        const name = await getPersonName(tx, input.personId);
        const govTitle = input.govTitle?.trim() || null;

        // NOT filtered to `archived_at IS NULL` — this lookup has to see an
        // archived row too, both to run the mutual-exclusivity check against
        // its real role and to REACTIVATE it below rather than silently
        // reuse it still-archived (see that branch's own comment).
        const existingRows = toRows<{ id: string; role: UserRole; archived_at: string | null }>(
          await tx.execute(sql`
            SELECT id, role, archived_at FROM user_account WHERE person_id = ${input.personId}
          `),
          (message) => new Error(`boardMember.addBoardMember: ${message}`),
        );
        const existing = existingRows[0];

        let userAccountId: string;
        if (existing) {
          const conflict = checkRoleMutualExclusivity(existing.role, "board_member");
          if (conflict.conflict) {
            throw new TRPCError({
              code: "CONFLICT",
              message: conflict.message ?? "This person's existing account role conflicts.",
            });
          }
          userAccountId = existing.id;
          // Reviewer-caught defect, fixed here: this branch used to leave an
          // archived account archived while seating the person and issuing
          // an invitation anyway — `tenant-context.ts` refuses a session for
          // any `archived_at IS NOT NULL` account, so that person could
          // accept the invitation and never get a session, with no error
          // anywhere. `archived_at = NULL` unconditionally (a no-op if it
          // was already null) mirrors `MemberTransitionDialog.tsx`'s
          // `convertToStaff`, which updates an existing account IN PLACE
          // with `archived_at: null` rather than archive-then-insert — the
          // fix shape already lived in this codebase, just not here yet.
          if (govTitle) {
            await tx.execute(sql`
              UPDATE user_account SET archived_at = NULL, gov_title = ${govTitle}
              WHERE id = ${userAccountId}
            `);
          } else {
            await tx.execute(sql`
              UPDATE user_account SET archived_at = NULL WHERE id = ${userAccountId}
            `);
          }
        } else {
          try {
            const created = toRows<{ id: string }>(
              await tx.execute(sql`
                INSERT INTO user_account (person_id, town_id, role, gov_title, permissions)
                VALUES (${input.personId}, ${ctx.tenant.townId}, 'board_member'::user_role,
                        ${govTitle}, ${EMPTY_PERMISSIONS_JSON}::jsonb)
                RETURNING id
              `),
              (message) => new Error(`boardMember.addBoardMember: ${message}`),
            );
            userAccountId = created[0]!.id;
          } catch (err) {
            if (isAccountAlreadyExistsCollision(err)) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "This person already has a login account.",
                cause: err,
              });
            }
            throw err;
          }
        }

        if (input.isDefaultRecSec) {
          await tx.execute(sql`
            UPDATE board_member SET is_default_rec_sec = false
            WHERE board_id = ${input.boardId} AND is_default_rec_sec = true
          `);
        }

        try {
          await tx.execute(sql`
            INSERT INTO board_member (
              person_id, board_id, town_id, seat_title, term_start, term_end,
              status, is_default_rec_sec
            )
            VALUES (
              ${input.personId}, ${input.boardId}, ${ctx.tenant.townId},
              ${input.seatTitle?.trim() || null}, ${input.termStart},
              ${input.termEnd || null}, 'active'::board_member_status, ${input.isDefaultRecSec}
            )
          `);
        } catch (err) {
          if (isBoardMemberSeatCollision(err)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "This person already has an active seat on this board.",
              cause: err,
            });
          }
          throw err;
        }

        const invitationId = await insertInvitation(tx, {
          personId: input.personId,
          userAccountId,
          townId: ctx.tenant.townId,
        });

        return { name, invitationId };
      });
    }),

  /**
   * `AddMemberDialog.tsx`'s staff write (also `StaffAccountFlow`'s
   * destination when reached through this dialog): create a `staff`-role
   * `user_account` for an EXISTING person, plus an invitation. Sibling to
   * `person.insertStaffAccount`, which does the identical account insert
   * WITHOUT an invitation — that procedure serves `AddPersonDialog`, which
   * issues no invitation at all today. Kept as two procedures rather than
   * folding an optional "and invite" flag into `person.insertStaffAccount`:
   * this router owns the invitation write (hazard 3), and `person.ts`'s own
   * header already explains why it does not reach into `board_member`
   * territory.
   *
   * `permissions` is written EXACTLY as sent — see `PermissionsMatrixInput`'s
   * own comment (imported from `person.ts`) and this file's header, hazard 2.
   */
  addStaffMember: protectedProcedure
    .use(requireActor(assertCanInsertUserAccount))
    .input(
      z.object({
        personId: z.string().uuid(),
        govTitle: z.string().max(100).nullable(),
        permissions: PermissionsMatrixInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertPersonExists(tx, input.personId);
        const name = await getPersonName(tx, input.personId);
        const govTitle = input.govTitle?.trim() || null;
        const permissionsJson = JSON.stringify(input.permissions);

        let userAccountId: string;
        try {
          const created = toRows<{ id: string }>(
            await tx.execute(sql`
              INSERT INTO user_account (person_id, town_id, role, gov_title, permissions)
              VALUES (${input.personId}, ${ctx.tenant.townId}, 'staff'::user_role,
                      ${govTitle}, ${permissionsJson}::jsonb)
              RETURNING id
            `),
            (message) => new Error(`boardMember.addStaffMember: ${message}`),
          );
          userAccountId = created[0]!.id;
        } catch (err) {
          if (isAccountAlreadyExistsCollision(err)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "This person already has a login account.",
              cause: err,
            });
          }
          throw err;
        }

        const invitationId = await insertInvitation(tx, {
          personId: input.personId,
          userAccountId,
          townId: ctx.tenant.townId,
        });

        return { name, invitationId };
      });
    }),
});
