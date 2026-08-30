/**
 * Stage 1, Task D1 — the root router.
 *
 * Task 2 adds `boards` here, and Phase E fans out from it. What lives here now
 * is the smallest thing that proves the stack end to end: a procedure that
 * reads the caller's own identity through `withTenant`, and one that reports
 * the caller's resolved permissions.
 *
 * `permissions` exists for a reason beyond diagnostics. Phase D's open
 * question 2 asks what a permission denial should look like to a clerk; every
 * answer except "hide the control" needs the client to know what the caller
 * holds, and the client must learn it from the same resolver the API enforces
 * with, or the UI and the API disagree about what is allowed.
 */

import { sql } from "drizzle-orm";
import { router, protectedProcedure } from "./trpc.js";
import { toRows } from "../db/rows.js";
import { PERMISSION_CODES, resolvePermission } from "./authorization/permission.js";
import { townRouter } from "./routers/town.js";
import { boardRouter } from "./routers/board.js";
import { personRouter } from "./routers/person.js";
import { notificationPreferenceRouter } from "./routers/notification-preference.js";

export const appRouter = router({
  /**
   * The town's own settings. Task D1b added the one procedure the public
   * portal cannot function without — see `routers/town.ts`.
   */
  town: townRouter,

  /**
   * Board reads. No permission guard — see `routers/board.ts` for why.
   */
  board: boardRouter,

  /**
   * The people directory and its writes. No permission guard on `list` —
   * see `routers/person.ts` for why. The four writes are all admin gates.
   */
  person: personRouter,

  /**
   * A person's own notification preferences. No permission guard — see
   * `routers/notification-preference.ts` for why (self-scoped by
   * construction, not by an `assertCan*` rule).
   */
  notificationPreference: notificationPreferenceRouter,

  /**
   * Who the caller is, read back through the tenant context rather than echoed
   * from the session — so a green answer here means RLS, the tenant bridge and
   * the actor loader all agree.
   */
  whoami: protectedProcedure.query(async ({ ctx }) => {
    const actor = await ctx.actor();
    const rows = await ctx.withTenant(async (tx) =>
      toRows<{ name: string; town_name: string }>(
        await tx.execute(sql`
          SELECT p.name, t.name AS town_name
          FROM person p
          JOIN town t ON t.id = p.town_id
          WHERE p.id = ${ctx.tenant.personId}
        `),
        (message) => new Error(`whoami: ${message}`),
      ),
    );
    const row = rows[0];
    return {
      townId: ctx.tenant.townId,
      personId: ctx.tenant.personId,
      userAccountId: ctx.tenant.userAccountId,
      role: actor.role,
      name: row?.name ?? null,
      townName: row?.town_name ?? null,
    };
  }),

  /**
   * The caller's effective global permissions, by action CODE.
   *
   * Codes, not names, because that is what the database stores and what the
   * permissions UI writes. Board-scoped answers are deliberately not included:
   * they depend on a board, and returning a matrix "for every board" would be
   * a snapshot the client would then be tempted to cache and act on.
   */
  permissions: protectedProcedure.query(async ({ ctx }) => {
    const actor = await ctx.actor();
    const granted: Record<string, boolean> = {};
    for (const code of PERMISSION_CODES) {
      granted[code] = resolvePermission(actor, code);
    }
    return { role: actor.role, global: granted };
  }),
});

export type AppRouter = typeof appRouter;
