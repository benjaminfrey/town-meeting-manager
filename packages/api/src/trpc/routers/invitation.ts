/**
 * Phase E wave 4, Task 0 — `AddPersonDialog.tsx`'s bare `invitation` write.
 *
 * Before this task, `invitation` had no router and no authorization rule at
 * all: `AddPersonDialog`'s staff-account branch wrote directly to
 * `public.invitation` through the raw Supabase client, generating the row's
 * `token` with `crypto.randomUUID()` IN THE BROWSER. That is the identical
 * hazard `board-member.ts`'s own header names as "hazard 3" for the two
 * invitation writes that router already owns
 * (`addBoardMember`/`addStaffMember`, via its private `insertInvitation`
 * helper) — not a new one found here, the same one, on a third call site that
 * helper cannot reach: it is a private function, not a callable procedure,
 * and `AddPersonDialog` never seats anyone on a board the way
 * `addBoardMember`/`addStaffMember` do, so there is no existing procedure to
 * route this write through instead of building one.
 *
 * ─── Read `db/invitation-bootstrap.ts` before touching this file again ────
 *
 * That module is the ACCEPT side of an invitation: a token, presented by a
 * caller with no session yet, resolves to a town via a hashed hint
 * (`better_auth.invitation_tenant`) that is USED but not TRUSTED — the hint
 * only opens a `withTenant` transaction; the real invitation row is read
 * (and the token re-verified) from INSIDE that transaction, so a corrupted
 * hint can deny service but never disclose another town's row. This file is
 * the INSERT side, a different direction entirely, and does not read
 * `better_auth.invitation_tenant` at all. It only ever WRITES a
 * `public.invitation` row; `better_auth.sync_invitation_tenant()` (the
 * trigger `drizzle/0002_invitation_tenant_bootstrap.sql` installs) keeps the
 * hint table in sync automatically, the same way it already does for
 * `board-member.ts`'s two invitation writes — nothing here needs to know
 * that trigger exists, only not to fight it by writing the token from
 * outside the database. Generating `token` with `gen_random_uuid()` here
 * (never from client input) can only make the hint HARDER to guess than the
 * client-generated token this replaces; it does not touch, and cannot
 * weaken, the "used but not trusted" property `invitation-bootstrap.ts`
 * itself is responsible for.
 *
 * ─── The two FKs, and why one check answers both ──────────────────────────
 *
 * `person_id` and `user_account_id` are both client-supplied and both become
 * foreign keys on the new row — the FK-bypasses-RLS hazard conventions item
 * 3 names (Postgres FK enforcement bypasses row security; see `board.ts`'s
 * `assertBoardExists` and `person.ts`'s `assertPersonExists`, the two
 * existing instances of the pattern this file follows). A bare existence
 * check on each id separately would still leave a caller free to pair a
 * real person in their own town with a real user_account in their own town
 * that BELONGS TO SOMEONE ELSE — an invitation that grants access to one
 * person's login under a different person's name. `assertAccountBelongsToPerson`
 * answers both questions with one query: does a `user_account` row with
 * THIS id, owned by THIS person, exist in my tenant.
 *
 * ─── Authorization: reused, not invented ───────────────────────────────────
 *
 * `assertCanInsertUserAccount` — the same rule `person.insertStaffAccount`
 * and `boardMember.addStaffMember` already use — is reused here rather than
 * a new `assertCanInsertInvitation` invented. This write has exactly one
 * caller in the whole app (`AddPersonDialog`'s staff-account branch), and it
 * only ever runs immediately after that same caller's own
 * `person.insertStaffAccount` call, for the identical actor and the
 * identical question: may this caller grant someone a login. Inventing a
 * second rule for the second half of one atomic-in-intent action would only
 * ever answer the same question a second way — exactly the shape
 * `boardMember.addStaffMember`'s own header already declines for its
 * account-plus-invitation pair, and `boardMember.convertToStaff`'s header
 * states as the general reasoning: "one admin check covers both — there is
 * no second, weaker caller who could reach only one half."
 *
 * Deliberately NOT bundled into one procedure with `person.insertStaffAccount`
 * the way `boardMember.addStaffMember` bundles account-plus-invitation into a
 * single transaction: `AddPersonDialog`'s flow is `person.insert` →
 * `person.insertStaffAccount` → this procedure, three separate round trips,
 * not one. Collapsing the last two into one transaction would be a real
 * improvement (closing the window where a staff account exists with no
 * invitation if the browser drops between calls) but is a bigger change than
 * this task's marker asks for — `person.insertStaffAccount` is
 * `person.ts`'s procedure, not this router's, and reaching into another
 * router's transaction is exactly what `board-member.ts`'s own header
 * declines to do for person creation, for the same one-noun-one-router
 * reason (conventions item 1). Recorded rather than fixed here.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireActor } from "../trpc.js";
import { assertCanInsertUserAccount } from "../authorization/rules.js";
import { assertPersonExists } from "./person.js";
import { toRows } from "../../db/rows.js";
import type { TenantTx } from "../../db/with-tenant.js";

/** See this file's header, "The two FKs, and why one check answers both." */
async function assertAccountBelongsToPerson(
  tx: TenantTx,
  userAccountId: string,
  personId: string,
): Promise<void> {
  const rows = toRows<{ id: string }>(
    await tx.execute(sql`
      SELECT id FROM user_account WHERE id = ${userAccountId} AND person_id = ${personId}
    `),
    (message) => new Error(`invitation.assertAccountBelongsToPerson: ${message}`),
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
}

export const invitationRouter = router({
  /**
   * `AddPersonDialog.tsx`'s invitation write, for a person + `user_account`
   * it already created via `person.insert` → `person.insertStaffAccount`.
   * `expires_at` matches the 7-day window `board-member.ts`'s own
   * `insertInvitation` uses and `AddPersonDialog`'s original client code
   * used before this task.
   */
  insert: protectedProcedure
    .use(requireActor(assertCanInsertUserAccount))
    .input(z.object({ personId: z.string().uuid(), userAccountId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertPersonExists(tx, input.personId);
        await assertAccountBelongsToPerson(tx, input.userAccountId, input.personId);

        const rows = toRows<{ id: string }>(
          await tx.execute(sql`
            INSERT INTO invitation (person_id, user_account_id, town_id, token, status, expires_at)
            VALUES (${input.personId}, ${input.userAccountId}, ${ctx.tenant.townId},
                    gen_random_uuid()::text, 'pending', now() + interval '7 days')
            RETURNING id
          `),
          (message) => new Error(`invitation.insert: ${message}`),
        );
        return { id: rows[0]!.id };
      });
    }),
});
