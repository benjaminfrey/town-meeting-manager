/**
 * Stage 1, Task C2 — invitation acceptance, end to end against a real database.
 *
 * ─── What this replaces ───────────────────────────────────────────────────
 *
 * Task C1's version of this file proved that the route FAILED LOUDLY. It had
 * to: C1 made `user_account.auth_user_id` a real foreign key to
 * `better_auth."user"(id)`, and the route wrote a GoTrue uuid into it, so the
 * write was rejected with SQLSTATE 23503 every single time. Worse, the
 * rejection had been discarded — the invitation was marked accepted anyway,
 * the account was never linked, no `better_auth.user_tenant` row was written,
 * and nothing errored anywhere. C1 made that stop lying; making it WORK was
 * left to this task.
 *
 * So the assertions here are the inverse of C1's. They are also driven end to
 * end against a real Postgres, a real Better Auth instance and the real route,
 * because every historical defect in this path was in the wiring between those
 * three and a mocked version of any one of them would have passed throughout.
 *
 * ─── The four writes, and why the last two are the point ─────────────────
 *
 * Acceptance must leave FOUR facts true, in one transaction:
 *
 *   1. a Better Auth identity exists, with the address verified — the
 *      invitation token was delivered to it, which proves possession more
 *      directly than a verification click does;
 *   2. `user_account.auth_user_id` points at that identity;
 *   3. `better_auth.user_tenant` maps that identity to the town;
 *   4. the invitation is closed.
 *
 * (3) is the one that had never been written by ANY code path except
 * onboarding. Without it `resolveTenant` cannot start, so an invited user
 * would sign in successfully and then be refused by the tenant bridge on every
 * request, with their one-time invitation already consumed. The last test
 * below therefore does not stop at "the row exists" — it signs the invited
 * user in and resolves the resulting session, which is the actual thing the
 * user needs to work.
 *
 * ─── Email delivery ───────────────────────────────────────────────────────
 *
 * `sendAuthEmail` is injected (Task C1 made it a required constructor
 * parameter for exactly this reason) and stubbed here. That is the seam, not a
 * bypass: `requireEmailVerification` stays on, and the product's real sender
 * still throws when Postmark is unconfigured. In a deployment without Postmark
 * this route answers 500 — the same state ordinary sign-up is in — and that is
 * reported rather than switched off.
 */

import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { createAuth } from "../../auth/auth.js";
import { resolveTenant } from "../../auth/tenant-context.js";
import { invitationRoutes } from "../invitations.js";

const PASSWORD = "correct-horse-battery-staple";
const INVITEE_EMAIL = "invitee@example.gov";

interface Fixture {
  townId: string;
  personId: string;
  userAccountId: string;
  invitationId: string;
  token: string;
}

/** A town with a pending invitation for one board member. */
async function seed(app: postgres.Sql, overrides: { userAccountTownId?: string } = {}) {
  const fixture: Fixture = {
    townId: randomUUID(),
    personId: randomUUID(),
    userAccountId: randomUUID(),
    invitationId: randomUUID(),
    token: `tok-${randomUUID()}`,
  };

  // `user_account` normally lives in the same town as the invitation. The
  // override exists for the test that proves a mismatch is refused rather than
  // silently producing an unlinked account.
  const accountTownId = overrides.userAccountTownId ?? fixture.townId;

  // Order matters: `invitation.user_account_id` is a foreign key, so the
  // account has to exist before the invitation that names it.
  await app.begin(async (tx) => {
    await tx`SELECT set_config('app.town_id', ${fixture.townId}, true)`;
    await tx`INSERT INTO town (id, name, subdomain) VALUES (${fixture.townId}, 'Newcastle', 'newcastle')`;
    await tx`INSERT INTO person (id, town_id, name, email)
             VALUES (${fixture.personId}, ${fixture.townId}, 'Invitee', ${INVITEE_EMAIL})`;
  });

  if (accountTownId === fixture.townId) {
    await app.begin(async (tx) => {
      await tx`SELECT set_config('app.town_id', ${accountTownId}, true)`;
      await tx`INSERT INTO user_account (id, person_id, town_id, role)
               VALUES (${fixture.userAccountId}, ${fixture.personId}, ${accountTownId}, 'board_member')`;
    });
  } else {
    // The account the invitation names lives somewhere else entirely. The
    // foreign key permits that; row level security is what will not.
    const otherPersonId = randomUUID();
    await app.begin(async (tx) => {
      await tx`SELECT set_config('app.town_id', ${accountTownId}, true)`;
      await tx`INSERT INTO town (id, name, subdomain) VALUES (${accountTownId}, 'Bristol', 'bristol')`;
      await tx`INSERT INTO person (id, town_id, name, email)
               VALUES (${otherPersonId}, ${accountTownId}, 'Elsewhere', 'elsewhere@example.gov')`;
      await tx`INSERT INTO user_account (id, person_id, town_id, role)
               VALUES (${fixture.userAccountId}, ${otherPersonId}, ${accountTownId}, 'board_member')`;
    });
  }

  await app.begin(async (tx) => {
    await tx`SELECT set_config('app.town_id', ${fixture.townId}, true)`;
    await tx`INSERT INTO invitation (id, town_id, person_id, user_account_id, token, status, expires_at, role, email)
             VALUES (${fixture.invitationId}, ${fixture.townId}, ${fixture.personId},
                     ${fixture.userAccountId}, ${fixture.token}, 'pending',
                     now() + interval '7 days', 'board_member', ${INVITEE_EMAIL})`;
  });

  return fixture;
}

/**
 * The real route, with a real Better Auth instance and a real tenant db.
 *
 * `app.supabase` is still the service-role client in production — the token
 * lookup has to happen before any town is known, and under FORCE RLS there is
 * no tenant-scoped way to do that. It is faked here rather than mocked away:
 * the fake reads the SAME database the route then writes to, so a divergence
 * between what the lookup saw and what the transaction does is still
 * observable.
 *
 * It reads on the OWNER connection, because that is what "bypasses RLS" means
 * here — the same property the service-role key has in production. Reading on
 * the `tmm_app` connection would return zero rows for every lookup (no
 * `app.town_id` is set yet, which is the entire reason this lookup cannot be
 * tenant-scoped), and the tests would pass or fail for a reason unrelated to
 * the route. Task D1 removes the client and this fake with it.
 */
async function buildApp(client: postgres.Sql, lookup: postgres.Sql, sent: string[]) {
  const db = drizzle(client);
  const auth = createAuth({
    db,
    secret: "0123456789abcdef0123456789abcdef",
    baseURL: "http://localhost:5173",
    sendAuthEmail: async ({ to, kind }) => {
      sent.push(`${kind}:${to}`);
    },
  });

  const supabaseLike = {
    from(table: string) {
      const filters: Array<[string, string]> = [];
      const self = {
        select: () => self,
        eq: (column: string, value: string) => {
          filters.push([column, value]);
          return self;
        },
        single: () => self,
        then: (
          resolve: (value: { data: unknown; error: unknown }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => read().then(resolve, reject),
      };

      async function read(): Promise<{ data: unknown; error: unknown }> {
        // Every read this route performs is by a single equality filter, and
        // all of them run before a town is known.
        const [[column, value]] = filters as [[string, string]];
        const rows = await lookup.unsafe(
          `SELECT * FROM ${table} WHERE ${column} = $1 LIMIT 1`,
          [value],
          { prepare: false },
        );
        return { data: rows[0] ?? null, error: null };
      }

      return self;
    },
  };

  const server = Fastify({ logger: false });
  await server.register(sensible);
  server.decorate("supabase", supabaseLike as never);
  server.decorate("verifyAuth", async () => {});
  server.decorate("auth", auth);
  server.decorate("tenantDb", db);
  await server.register(invitationRoutes, { prefix: "/api" });
  return { server, auth, db };
}

describe("POST /api/invitations/accept", () => {
  it("creates the login, links it, maps it to the town, and closes the invitation", async () => {
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const fixture = await seed(client);
        const sent: string[] = [];
        const { server } = await buildApp(client, owner, sent);

        try {
          const res = await server.inject({
            method: "POST",
            url: "/api/invitations/accept",
            payload: { token: fixture.token, password: PASSWORD },
          });

          expect(res.statusCode).toBe(200);
          expect(res.json()).toMatchObject({ ok: true, email: INVITEE_EMAIL });

          // 1 — the identity, with the address recorded as verified. The
          // invitation token was mailed to it; that is the proof.
          const [user] = await owner<{ id: string; emailVerified: boolean }[]>`
            SELECT id, "emailVerified" FROM better_auth."user" WHERE email = ${INVITEE_EMAIL}`;
          expect(user).toBeDefined();
          expect(user!.emailVerified).toBe(true);

          // 2 — the foreign key Task C1 added, now actually satisfied.
          const [account] = await owner<{ auth_user_id: string | null }[]>`
            SELECT auth_user_id FROM user_account WHERE id = ${fixture.userAccountId}`;
          expect(account!.auth_user_id).toBe(user!.id);

          // 3 — the row that had exactly ONE writer before this task.
          const [mapping] = await owner<{ town_id: string }[]>`
            SELECT town_id FROM better_auth.user_tenant WHERE auth_user_id = ${user!.id}`;
          expect(mapping!.town_id).toBe(fixture.townId);

          // 4 — closed, so the token cannot be replayed.
          const [invitation] = await owner<{ status: string; accepted_at: Date | null }[]>`
            SELECT status, accepted_at FROM invitation WHERE id = ${fixture.invitationId}`;
          expect(invitation!.status).toBe("accepted");
          expect(invitation!.accepted_at).not.toBeNull();
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("leaves the invited user able to sign in AND resolve to their town", async () => {
    // The assertion the previous three rows only imply. An invited user who
    // can authenticate but whose session resolves to no town gets a 403 on
    // every request with their invitation already spent — the exact state C1
    // found and could not fix. This drives the real thing.
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const fixture = await seed(client);
        const { server, auth, db } = await buildApp(client, owner, []);

        try {
          const accept = await server.inject({
            method: "POST",
            url: "/api/invitations/accept",
            payload: { token: fixture.token, password: PASSWORD },
          });
          expect(accept.statusCode).toBe(200);

          // Sign-in works with no verification click, because acceptance
          // recorded the address as verified. `requireEmailVerification` is
          // still on — this would fail if the route had skipped that write.
          const session = await auth.api.signInEmail({
            body: { email: INVITEE_EMAIL, password: PASSWORD },
          });
          expect(session.user.id).toBeTruthy();

          const tenant = await resolveTenant(db, {
            user: { id: session.user.id },
          });
          expect(tenant.townId).toBe(fixture.townId);
          expect(tenant.userAccountId).toBe(fixture.userAccountId);
          expect(tenant.personId).toBe(fixture.personId);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("refuses a second acceptance of the same token", async () => {
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const fixture = await seed(client);
        const { server } = await buildApp(client, owner, []);

        try {
          const first = await server.inject({
            method: "POST",
            url: "/api/invitations/accept",
            payload: { token: fixture.token, password: PASSWORD },
          });
          expect(first.statusCode).toBe(200);

          const second = await server.inject({
            method: "POST",
            url: "/api/invitations/accept",
            payload: { token: fixture.token, password: PASSWORD },
          });
          expect(second.statusCode).toBe(400);

          // Exactly one identity, not two.
          const identities = await owner<{ id: string }[]>`
            SELECT id FROM better_auth."user" WHERE email = ${INVITEE_EMAIL}`;
          expect(identities.length).toBe(1);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("rolls everything back — and deletes the orphaned identity — when the link cannot be made", async () => {
    // The failure is real, not injected: the invitation names a `user_account`
    // that lives in a DIFFERENT town. Under row level security that row is
    // invisible from the invitation's town, so the UPDATE matches nothing.
    //
    // Note what this would have done WITHOUT the `RETURNING id` row count: the
    // UPDATE would have succeeded while changing nothing, `user_tenant` would
    // still have been written, and the caller would have got 200 for an
    // account that was never linked. That is C1's silent failure reappearing
    // one layer down, which is why the count is checked rather than assumed.
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const otherTownId = randomUUID();
        const fixture = await seed(client, { userAccountTownId: otherTownId });
        const { server } = await buildApp(client, owner, []);

        try {
          const res = await server.inject({
            method: "POST",
            url: "/api/invitations/accept",
            payload: { token: fixture.token, password: PASSWORD },
          });

          expect(res.statusCode).toBe(500);

          // The invitation is still usable — the whole point of failing here
          // rather than after marking it accepted.
          const [invitation] = await owner<{ status: string }[]>`
            SELECT status FROM invitation WHERE id = ${fixture.invitationId}`;
          expect(invitation!.status).toBe("pending");

          // No mapping was left behind…
          const mappings = await owner`
            SELECT 1 FROM better_auth.user_tenant`;
          expect(mappings.length).toBe(0);

          // …and no orphaned identity either. Without the compensating delete
          // the address would be permanently registered to an account nothing
          // points at, and every retry would report "already exists".
          const users = await owner`
            SELECT 1 FROM better_auth."user" WHERE email = ${INVITEE_EMAIL}`;
          expect(users.length).toBe(0);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("refuses an expired invitation without creating anything", async () => {
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const fixture = await seed(client);
        await owner`UPDATE invitation SET expires_at = now() - interval '1 day'
                     WHERE id = ${fixture.invitationId}`;

        const { server } = await buildApp(client, owner, []);
        try {
          const res = await server.inject({
            method: "POST",
            url: "/api/invitations/accept",
            payload: { token: fixture.token, password: PASSWORD },
          });
          expect(res.statusCode).toBe(400);

          const users = await owner`
            SELECT 1 FROM better_auth."user" WHERE email = ${INVITEE_EMAIL}`;
          expect(users.length).toBe(0);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });
});
