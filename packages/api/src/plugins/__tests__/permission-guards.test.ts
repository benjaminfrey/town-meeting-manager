/**
 * Stage 1, Task D1c — what the LEGACY route guards actually decide.
 *
 * `plugins/auth.ts` is the authorization the surviving Fastify route files run
 * on. Until this file existed it had no permission-behaviour tests at all, and
 * Task D1's report recorded two live divergences between what those routes say
 * their policy is and what it is:
 *
 *   1. `requirePermission` short-circuited `admin || sys_admin` to ALLOW, and
 *      `requireAdmin` admitted `sys_admin` too. The removed `has_permission()`
 *      denied `sys_admin` on purpose ("sys_admin has no meeting management
 *      permissions"), `is_admin()` was strictly `role = 'admin'`, and the new
 *      `resolvePermission` denies it as its own explicit branch. So a platform
 *      operator held every permission on these routes — including
 *      `requireAdmin("approving minutes")`, i.e. adopting a town's minutes.
 *
 *   2. `requirePermission` takes an action NAME (`edit_agenda`) but the matrix
 *      it read was passed through verbatim, and half the accounts in this
 *      product store action CODES (`A2`) — `supabase/seed.sql:116` writes
 *      codes, `StaffAccountFlow.tsx` writes names. A code-keyed account
 *      therefore resolved to `false` for every action. That failed closed, so
 *      it was never a disclosure; it was a silent, total outage of one half of
 *      the data, and it meant these routes were in practice reachable ONLY by
 *      the two roles the short-circuit let through.
 *
 * The routes mounted below carry the SAME six guards, spelled the same way. A
 * guard whose decision changes here is a guard whose decision changes wherever
 * that code is resolved — see `LEGACY_GUARDS` below for which of them are
 * still `requirePermission` preHandlers after Task D1f and which moved into
 * their handlers to acquire a board.
 *
 * These drive a real Fastify instance over a real session against a real
 * database, for the reason `route-access.test.ts` gives: every historical
 * failure in this area was in the wiring, and a unit test of the predicate
 * would have passed through all of them. The role and the matrix are written
 * to `user_account` and read back by `verifyAuth`, so the stored JSONB is the
 * input to every assertion here — never a hand-built object a test author can
 * shape until it passes.
 */

import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { withTenant } from "../../db/with-tenant.js";
import { createAuth } from "../../auth/auth.js";
import { completeOnboarding } from "../../auth/onboarding.js";
import { betterAuthPlugin } from "../../auth/fastify.js";
import { authPlugin, requirePermission, requireAdmin } from "../auth.js";
import { PERMISSIONS, type PermissionAction } from "@town-meeting/shared";

const PASSWORD = "correct-horse-battery-staple";

/**
 * The codes this guard resolves, and where each one lives now.
 *
 * ─── Task D1f moved four of these out of `requirePermission` ─────────────
 *
 * When this file was written all five were `requirePermission` preHandlers on
 * the legacy routes. A6, R1, R2 and R3 are BOARD-SCOPED, and a preHandler has
 * no meeting to resolve a board from — the defect D1c recorded in
 * `plugins/auth.ts` and D1f fixed by moving those four decisions into the
 * handlers, where `rules.ts` is asked about `meeting.board_id`. C2 is the one
 * that remains, and correctly: it is town-level, so a global check is the
 * right check.
 *
 * The four board-scoped entries stay HERE anyway, and it is worth being clear
 * about what they now pin. Not the routes — `routes/__tests__/board-scoped-legacy-routes.test.ts`
 * does that, on two boards, in both directions. These pin the RESOLUTION
 * ALGORITHM this guard shares with the rules layer: that `sys_admin` is denied,
 * that both spellings of the stored matrix are honoured, that disagreeing
 * spellings deny, and that a board member gets nothing from a stray staff
 * grant. Those answers must not differ between the two paths, and testing them
 * through five codes rather than one is the cheap way to notice if they do.
 */
const LEGACY_GUARDS: ReadonlyArray<{
  path: string;
  code: string;
  action: PermissionAction;
  where: string;
}> = [
  { path: "/api/guard/a6", code: "A6", action: PERMISSIONS.A6, where: "board-scoped since D1f" },
  { path: "/api/guard/r2", code: "R2", action: PERMISSIONS.R2, where: "board-scoped since D1f" },
  { path: "/api/guard/r1", code: "R1", action: PERMISSIONS.R1, where: "board-scoped since D1f" },
  { path: "/api/guard/r3", code: "R3", action: PERMISSIONS.R3, where: "board-scoped since D1f" },
  { path: "/api/guard/c2", code: "C2", action: PERMISSIONS.C2, where: "notifications.ts:110" },
];

/** `minutes.ts` — `requireAdmin("approving minutes")`, still a preHandler. */
const ADMIN_ONLY_PATH = "/api/guard/approve-minutes";

interface AccountSpec {
  role: "sys_admin" | "admin" | "staff" | "board_member";
  /** Written into `user_account.permissions` VERBATIM — bytes, not a shape. */
  permissions?: unknown;
}

interface GuardContext {
  server: FastifyInstance;
  cookie: string;
  /** GET `path` as the signed-in account; returns the status code. */
  status: (path: string) => Promise<number>;
}

/**
 * Onboard one account, force it into `spec`'s role and matrix, sign in, and
 * hand back a caller.
 *
 * The role/matrix write goes through `withTenant` on the app role — the same
 * connection and the same RLS the request path uses — rather than through the
 * owner connection, so the fixture does not quietly depend on the test
 * database's owner being a superuser.
 */
async function withAccount(
  spec: AccountSpec,
  fn: (ctx: GuardContext) => Promise<void>,
): Promise<void> {
  await withTestDb(async (owner) => {
    const app: postgres.Sql = await connectAsAppRole(owner);
    try {
      const db = drizzle(app);
      const auth = createAuth({
        db,
        secret: "0123456789abcdef0123456789abcdef",
        baseURL: "http://localhost:3000",
        sendAuthEmail: async () => {},
      });

      const server = Fastify({ logger: false });
      await server.register(sensible);
      await server.register(betterAuthPlugin, {
        auth,
        db,
        allowedOrigins: ["http://localhost:3000"],
      });
      await server.register(authPlugin);

      for (const guard of LEGACY_GUARDS) {
        server.get(
          guard.path,
          { preHandler: [server.verifyAuth, requirePermission(guard.action)] },
          async () => ({ ok: true }),
        );
      }
      server.get(
        ADMIN_ONLY_PATH,
        { preHandler: [server.verifyAuth, requireAdmin("approving minutes")] },
        async () => ({ ok: true }),
      );

      try {
        const email = "clerk@example.gov";
        await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "Clerk" } });
        const [row] = await app<{ id: string }[]>`
          SELECT id FROM better_auth."user" WHERE email = ${email}
        `;
        await app`UPDATE better_auth."user" SET "emailVerified" = true WHERE id = ${row!.id}`;

        const onboarded = await completeOnboarding(db, {
          authUserId: row!.id,
          townName: "Newcastle",
        });

        const permissions = JSON.stringify(spec.permissions ?? { global: {}, board_overrides: [] });
        await withTenant(db, { townId: onboarded.townId }, async (tx) => {
          await tx.execute(sql`
            UPDATE user_account
               SET role = ${spec.role}::user_role,
                   permissions = ${permissions}::jsonb
             WHERE id = ${onboarded.userAccountId}
          `);
        });

        const signIn = await auth.api.signInEmail({
          body: { email, password: PASSWORD },
          asResponse: true,
        });
        const cookie = signIn.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; ");

        await fn({
          server,
          cookie,
          status: async (path) =>
            (await server.inject({ method: "GET", url: path, headers: { cookie } })).statusCode,
        });
      } finally {
        await server.close();
      }
    } finally {
      await app.end();
    }
  });
}

/** `{"global": {"A6": true}}` — the spelling `supabase/seed.sql` writes. */
function codeKeyed(...codes: string[]): unknown {
  return { global: Object.fromEntries(codes.map((c) => [c, true])), board_overrides: [] };
}

/** `{"global": {"generate_agenda_packet": true}}` — the spelling the app writes. */
function nameKeyed(...actions: PermissionAction[]): unknown {
  return { global: Object.fromEntries(actions.map((a) => [a, true])), board_overrides: [] };
}

describe("requirePermission on the legacy routes — sys_admin", () => {
  it("REFUSES a sys_admin every permission the legacy routes guard", async () => {
    // The divergence. `has_permission()` denied sys_admin on purpose and
    // `resolvePermission` denies it as its own branch; this path allowed it.
    // Fails if the `role === "sys_admin"` denial is removed from
    // `requirePermission`, or if it is folded back into an admin short-circuit.
    await withAccount({ role: "sys_admin" }, async ({ status }) => {
      for (const guard of LEGACY_GUARDS) {
        expect(`${guard.code} (${guard.where}) → ${await status(guard.path)}`).toBe(
          `${guard.code} (${guard.where}) → 403`,
        );
      }
    });
  });

  it("REFUSES a sys_admin even when their own matrix grants the code", async () => {
    // A platform operator is not a clerk of any town, and no row in that town
    // can make them one. Fails if the sys_admin branch is moved BELOW the
    // matrix lookup instead of above it.
    await withAccount(
      { role: "sys_admin", permissions: codeKeyed("A6", "R1", "R2", "R3", "C2") },
      async ({ status }) => {
        for (const guard of LEGACY_GUARDS) {
          expect(`${guard.code} → ${await status(guard.path)}`).toBe(`${guard.code} → 403`);
        }
      },
    );
  });

  it("REFUSES a sys_admin the admin-only gate that adopts a town's minutes", async () => {
    // `requireAdmin` mirrors the removed `is_admin()`, which was strictly
    // `role = 'admin'`. Fails if `sys_admin` is re-admitted to requireAdmin.
    await withAccount({ role: "sys_admin" }, async ({ status }) => {
      expect(await status(ADMIN_ONLY_PATH)).toBe(403);
    });
  });
});

describe("requirePermission on the legacy routes — staff, and the two spellings", () => {
  it("ALLOWS staff whose matrix is keyed by action CODE", async () => {
    // The second divergence: `requirePermission` is name-keyed and the column
    // is, for every seeded account, code-keyed. Every one of these answered
    // 403 before the reader was converged. Fails if `requirePermission` stops
    // normalising the stored matrix.
    await withAccount(
      { role: "staff", permissions: codeKeyed("A6", "R1", "R2", "R3", "C2") },
      async ({ status }) => {
        for (const guard of LEGACY_GUARDS) {
          expect(`${guard.code} → ${await status(guard.path)}`).toBe(`${guard.code} → 200`);
        }
      },
    );
  });

  it("ALLOWS staff whose matrix is keyed by action NAME", async () => {
    // The half that already worked, pinned so converging the reader does not
    // break it. Fails if normalisation drops the name spelling.
    await withAccount(
      {
        role: "staff",
        permissions: nameKeyed(
          PERMISSIONS.A6,
          PERMISSIONS.R1,
          PERMISSIONS.R2,
          PERMISSIONS.R3,
          PERMISSIONS.C2,
        ),
      },
      async ({ status }) => {
        for (const guard of LEGACY_GUARDS) {
          expect(`${guard.code} → ${await status(guard.path)}`).toBe(`${guard.code} → 200`);
        }
      },
    );
  });

  it("REFUSES staff holding no grant at all", async () => {
    await withAccount({ role: "staff" }, async ({ status }) => {
      for (const guard of LEGACY_GUARDS) {
        expect(`${guard.code} → ${await status(guard.path)}`).toBe(`${guard.code} → 403`);
      }
    });
  });

  it("REFUSES staff holding a DIFFERENT code from the one the route requires", async () => {
    // Proves the check reads the action it was given rather than answering
    // "this account holds something".
    await withAccount({ role: "staff", permissions: codeKeyed("A6") }, async ({ status }) => {
      expect(await status("/api/guard/a6")).toBe(200);
      expect(await status("/api/guard/r1")).toBe(403);
      expect(await status("/api/guard/c2")).toBe(403);
    });
  });

  it("REFUSES when the two spellings of one action disagree", async () => {
    // `{"A6": false, "generate_agenda_packet": true}`. Taking the last key
    // makes an authorization answer depend on JSON key order; every spelling
    // present has to agree to grant. Fails if normalisation becomes an
    // assignment rather than an AND.
    await withAccount(
      {
        role: "staff",
        permissions: {
          global: { A6: false, [PERMISSIONS.A6]: true },
          board_overrides: [],
        },
      },
      async ({ status }) => {
        expect(await status("/api/guard/a6")).toBe(403);
      },
    );
  });

  it("REFUSES staff the admin-only gate", async () => {
    await withAccount(
      { role: "staff", permissions: codeKeyed("A6", "R1", "R2", "R3", "C2") },
      async ({ status }) => {
        expect(await status(ADMIN_ONLY_PATH)).toBe(403);
      },
    );
  });
});

describe("requirePermission on the legacy routes — board_member and admin", () => {
  it("REFUSES a board member a staff code even with a stray grant in their JSONB", async () => {
    // A board member holds A4, A7 and M8 by the seat and nothing by
    // configuration. None of the five legacy guards is one of those three.
    await withAccount(
      { role: "board_member", permissions: codeKeyed("A6", "R1", "R2", "R3", "C2") },
      async ({ status }) => {
        for (const guard of LEGACY_GUARDS) {
          expect(`${guard.code} → ${await status(guard.path)}`).toBe(`${guard.code} → 403`);
        }
        expect(await status(ADMIN_ONLY_PATH)).toBe(403);
      },
    );
  });

  it("ALLOWS an admin every legacy guard, including the admin-only gate", async () => {
    // The regression this whole change must not cause: closing sys_admin must
    // not close the role the towns actually run on.
    await withAccount({ role: "admin" }, async ({ status }) => {
      for (const guard of LEGACY_GUARDS) {
        expect(`${guard.code} → ${await status(guard.path)}`).toBe(`${guard.code} → 200`);
      }
      expect(await status(ADMIN_ONLY_PATH)).toBe(200);
    });
  });
});
