/**
 * Stage 1, Task C1 — invitation acceptance must fail LOUDLY.
 *
 * ─── What this is guarding ────────────────────────────────────────────────
 *
 * `POST /api/invitations/accept` links the newly created login to a
 * `user_account` by writing `auth_user_id`, then marks the invitation
 * accepted. Task C1 made `auth_user_id` a real foreign key to
 * `better_auth."user"(id)`, and the id this route writes comes from GoTrue —
 * so by construction there is no row to point at and the write is rejected.
 *
 * The route never destructured that result. The rejection was discarded and
 * execution fell straight through to marking the invitation accepted:
 *
 *   - the one-time invitation was consumed,
 *   - the account was never linked,
 *   - no `better_auth.user_tenant` row was written,
 *   - and NOTHING errored anywhere.
 *
 * The invited user then authenticated successfully and hit the tenant
 * bridge's 403 on every request, with their invitation already burnt.
 *
 * That is exactly the failure this whole task opposes: a request that returns
 * 200 while accomplishing nothing. The route is not fixed here — Task C2
 * rewrites it onto `auth.api.signUpEmail` plus the two-sided link in
 * `auth/onboarding.ts`. It is made to stop lying.
 *
 * ─── Why the test has two halves ──────────────────────────────────────────
 *
 * The first half measures the real database rejection, so the fake PostgREST
 * client in the second half is reproducing something that actually happens
 * rather than a plausible-looking invention. The second half drives the real
 * route and asserts the control flow: 500, and the invitation NOT consumed.
 */

import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { randomUUID } from "node:crypto";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { invitationRoutes } from "../invitations.js";

describe("POST /api/invitations/accept", () => {
  it("really is rejected by the database when handed a GoTrue-style uuid", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const townId = randomUUID();
        const personId = randomUUID();
        const userAccountId = randomUUID();

        await app.begin(async (tx) => {
          await tx`SELECT set_config('app.town_id', ${townId}, true)`;
          await tx`INSERT INTO town (id, name, subdomain) VALUES (${townId}, 'Newcastle', 'newcastle')`;
          await tx`INSERT INTO person (id, town_id, name, email)
                   VALUES (${personId}, ${townId}, 'Invitee', 'invitee@example.gov')`;
          await tx`INSERT INTO user_account (id, person_id, town_id, role)
                   VALUES (${userAccountId}, ${personId}, ${townId}, 'board_member')`;
        });

        // Exactly what the route writes today: a uuid minted by GoTrue, which
        // has no row in better_auth."user".
        const gotrueUserId = randomUUID();
        let caught: { code?: string; constraint_name?: string } | undefined;
        try {
          await app.begin(async (tx) => {
            await tx`SELECT set_config('app.town_id', ${townId}, true)`;
            await tx`UPDATE user_account SET auth_user_id = ${gotrueUserId}
                     WHERE id = ${userAccountId}`;
          });
        } catch (err) {
          caught = (err as { cause?: unknown }).cause as typeof caught;
          caught ??= err as typeof caught;
        }

        expect(caught?.code).toBe("23503");
        expect(caught?.constraint_name).toBe("user_account_auth_user_id_fkey");
      } finally {
        await app.end();
      }
    });
  });

  it("returns 500 and leaves the invitation UNUSED when the link fails", async () => {
    const calls: string[] = [];

    // The narrow slice of PostgREST's builder the accept path touches.
    //
    // The builder is THENABLE, not a promise factory: `.update()` returns the
    // builder so `.eq()` can follow, and awaiting the builder resolves to
    // `{ data, error }`. Getting that wrong matters — an earlier version of
    // this fake returned a promise from `.update()`, so `.eq()` threw a
    // TypeError and the route 500'd for a reason that had nothing to do with
    // the bug. It passed with the guard removed. Verified by mutation: with
    // `if (linkError)` disabled, the second assertion below fails.
    function fakeSupabase() {
      const invitation = {
        id: "inv-1",
        person_id: "person-1",
        user_account_id: "ua-1",
        town_id: "town-1",
        status: "pending",
        // Far future, so this test cannot pass for the unrelated reason that
        // the invitation had expired.
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        role: "board_member",
      };

      const RESULTS: Record<string, { data: unknown; error: unknown }> = {
        "select:invitation": { data: invitation, error: null },
        "select:person": { data: { name: "Invitee", email: "invitee@example.gov" }, error: null },
        "select:town": { data: { name: "Newcastle" }, error: null },
        // The rejection measured against the real database in the test above.
        "update:user_account": {
          data: null,
          error: {
            code: "23503",
            message:
              'insert or update on table "user_account" violates foreign key constraint "user_account_auth_user_id_fkey"',
          },
        },
        "update:invitation": { data: null, error: null },
      };

      function builder(table: string) {
        let key = `select:${table}`;
        const self = {
          select: () => self,
          eq: () => self,
          update: () => {
            key = `update:${table}`;
            calls.push(key);
            return self;
          },
          single: () => self,
          then: (
            resolve: (value: { data: unknown; error: unknown }) => unknown,
            reject?: (reason: unknown) => unknown,
          ) => Promise.resolve(RESULTS[key] ?? { data: null, error: null }).then(resolve, reject),
        };
        return self;
      }

      return {
        from: (table: string) => builder(table),
        auth: {
          admin: {
            createUser: async () => ({ data: { user: { id: randomUUID() } }, error: null }),
          },
        },
      };
    }

    const server = Fastify({ logger: false });
    await server.register(sensible);
    server.decorate("supabase", fakeSupabase() as never);
    server.decorate("verifyAuth", async () => {});
    await server.register(invitationRoutes, { prefix: "/api" });

    try {
      const res = await server.inject({
        method: "POST",
        url: "/api/invitations/accept",
        payload: { token: "tok", password: "correct-horse-battery-staple" },
      });

      // Loud, not 200.
      expect(res.statusCode).toBe(500);

      // The half that matters most: the invitation was NOT consumed. Before
      // this fix the route fell through and marked it accepted, so the user
      // lost their one chance to accept and gained nothing.
      expect(calls).toContain("update:user_account");
      expect(calls).not.toContain("update:invitation");
    } finally {
      await server.close();
    }
  });
});
