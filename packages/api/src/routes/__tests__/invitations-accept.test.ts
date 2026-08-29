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
 * ─── Task D1c: the service-role fake is gone ─────────────────────────────
 *
 * This function used to decorate the server with a hand-written Supabase
 * stand-in that read on the OWNER connection — because "bypasses RLS" was what
 * the service-role key meant in production, and the route's token lookup had
 * no other way to find a town before one was known. That fake is deleted along
 * with the thing it imitated.
 *
 * Everything now runs on `client`, the `tmm_app` connection, which is a
 * non-owner and does NOT bypass row level security. That matters more than it
 * sounds: with the old fake, a route that read the wrong town's row still
 * passed, because the fake could see every row. Here the database refuses, so
 * the tests below are testing tenancy rather than assuming it.
 *
 * The token lookup that still has to happen before any town is known goes
 * through `db/invitation-bootstrap.ts`, on this same unprivileged connection.
 * `routes/__tests__/invitation-bootstrap.test.ts` pins its boundary.
 */
async function buildApp(client: postgres.Sql, sent: string[]) {
  const db = drizzle(client);
  const auth = createAuth({
    db,
    secret: "0123456789abcdef0123456789abcdef",
    baseURL: "http://localhost:5173",
    sendAuthEmail: async ({ to, kind }) => {
      sent.push(`${kind}:${to}`);
    },
  });

  const server = Fastify({ logger: false });
  await server.register(sensible);
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
        const { server } = await buildApp(client, sent);

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
        const { server, auth, db } = await buildApp(client, []);

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
        const { server } = await buildApp(client, []);

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
        const { server } = await buildApp(client, []);

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

  it("REFUSES a second invitation for an account that already has a login", async () => {
    // Two pending invitations for one `user_account` — a re-issue, or two
    // administrators inviting the same person. Without `auth_user_id IS NULL`
    // the second acceptance repoints the account at a NEW identity while the
    // first stays live and signable, with a stale `user_tenant` row still
    // mapping it to the town. That identity authenticates and is then refused
    // by the tenant bridge on every request forever — the exact state this
    // whole rewrite exists to end.
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const fixture = await seed(client);
        const secondToken = `tok-${randomUUID()}`;
        await owner`INSERT INTO invitation (id, town_id, person_id, user_account_id, token, status, expires_at, role, email)
                    VALUES (${randomUUID()}, ${fixture.townId}, ${fixture.personId},
                            ${fixture.userAccountId}, ${secondToken}, 'pending',
                            now() + interval '7 days', 'board_member', ${INVITEE_EMAIL})`;

        const { server } = await buildApp(client, []);
        try {
          const first = await server.inject({
            method: "POST",
            url: "/api/invitations/accept",
            payload: { token: fixture.token, password: PASSWORD },
          });
          expect(first.statusCode).toBe(200);

          const [linkedTo] = await owner<{ auth_user_id: string }[]>`
            SELECT auth_user_id FROM user_account WHERE id = ${fixture.userAccountId}`;

          // A different address, so sign-up cannot fail for the unrelated
          // reason that the email is taken — the guard under test has to be
          // the thing that refuses.
          await owner`UPDATE person SET email = 'second@example.gov' WHERE id = ${fixture.personId}`;

          const second = await server.inject({
            method: "POST",
            url: "/api/invitations/accept",
            payload: { token: secondToken, password: PASSWORD },
          });
          expect(second.statusCode).toBe(500);

          // The account still points at the FIRST identity…
          const [after] = await owner<{ auth_user_id: string }[]>`
            SELECT auth_user_id FROM user_account WHERE id = ${fixture.userAccountId}`;
          expect(after!.auth_user_id).toBe(linkedTo!.auth_user_id);

          // …exactly one mapping exists, not two…
          const mappings = await owner<{ auth_user_id: string }[]>`
            SELECT auth_user_id FROM better_auth.user_tenant`;
          expect(mappings.map((m) => m.auth_user_id)).toEqual([linkedTo!.auth_user_id]);

          // …and the second identity was rolled back rather than left live.
          const orphans = await owner`
            SELECT 1 FROM better_auth."user" WHERE email = 'second@example.gov'`;
          expect(orphans.length).toBe(0);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("answers a too-short password with 400 naming the rule, not 500", async () => {
    // Better Auth's `minPasswordLength` is the first server-side password
    // policy this route has ever had. A 500 with an error-level log would tell
    // the person nothing about what to change, and would file a routine
    // validation failure alongside the things an operator is paged for.
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const fixture = await seed(client);
        const { server } = await buildApp(client, []);
        try {
          const res = await server.inject({
            method: "POST",
            url: "/api/invitations/accept",
            payload: { token: fixture.token, password: "short" },
          });

          expect(res.statusCode).toBe(400);
          expect(res.json().message).toMatch(/at least 8 characters/i);

          // And nothing was consumed or created on the way to refusing.
          const [invitation] = await owner<{ status: string }[]>`
            SELECT status FROM invitation WHERE id = ${fixture.invitationId}`;
          expect(invitation!.status).toBe("pending");
          expect(await owner`SELECT 1 FROM better_auth."user"`).toHaveLength(0);
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

        const { server } = await buildApp(client, []);
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

describe("invitation acceptance and the town next door (Task D1c)", () => {
  /**
   * The requirement, stated directly: acceptance must not be able to read or
   * write any row of a town other than the invitation's own.
   *
   * Before this task that was a hope. The route read the invitation, the
   * person, the town and the inviter through the service-role client, with row
   * level security bypassed, filtered only by whatever `.eq()` the code
   * happened to write — and the ONE cross-tenant check it did make
   * (`inv.town_id !== user.townId`) was decided in TypeScript against a value
   * from an unverified JWT claim (see `plugins/auth.ts`'s header).
   *
   * Now the whole route runs on a `tmm_app` connection inside
   * `withTenant(town-from-the-token)`. Two towns, two live invitations; one is
   * accepted, and the other must be untouched — not merely unchanged by
   * intent, but invisible while the first was being processed.
   */
  it("closes its own invitation and leaves the neighbouring town entirely alone", async () => {
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const alpha = await seed(client);

        // A second town, with its own pending invitation for its own person.
        const beta = {
          townId: randomUUID(),
          personId: randomUUID(),
          userAccountId: randomUUID(),
          invitationId: randomUUID(),
          token: `tok-${randomUUID()}`,
        };
        await client.begin(async (tx) => {
          await tx`SELECT set_config('app.town_id', ${beta.townId}, true)`;
          await tx`INSERT INTO town (id, name, subdomain) VALUES (${beta.townId}, 'Bristol', 'bristol')`;
          await tx`INSERT INTO person (id, town_id, name, email)
                   VALUES (${beta.personId}, ${beta.townId}, 'Neighbour', 'neighbour@example.gov')`;
          await tx`INSERT INTO user_account (id, person_id, town_id, role)
                   VALUES (${beta.userAccountId}, ${beta.personId}, ${beta.townId}, 'board_member')`;
          await tx`INSERT INTO invitation (id, town_id, person_id, user_account_id, token, status, expires_at, role, email)
                   VALUES (${beta.invitationId}, ${beta.townId}, ${beta.personId}, ${beta.userAccountId},
                           ${beta.token}, 'pending', now() + interval '7 days', 'board_member',
                           'neighbour@example.gov')`;
        });

        const { server } = await buildApp(client, []);
        try {
          const res = await server.inject({
            method: "POST",
            url: "/api/invitations/accept",
            payload: { token: alpha.token, password: PASSWORD },
          });
          expect(res.statusCode).toBe(200);
          expect(res.json().town_id).toBe(alpha.townId);

          // Newcastle's invitation closed…
          const [accepted] = await owner<{ status: string }[]>`
            SELECT status FROM invitation WHERE id = ${alpha.invitationId}`;
          expect(accepted!.status).toBe("accepted");

          // …and Bristol's is exactly as it was. Nothing consumed it, nothing
          // renamed it, nothing linked its account.
          const [neighbour] = await owner<{ status: string; accepted_at: Date | null }[]>`
            SELECT status, accepted_at FROM invitation WHERE id = ${beta.invitationId}`;
          expect(neighbour!.status).toBe("pending");
          expect(neighbour!.accepted_at).toBeNull();

          const [neighbourAccount] = await owner<
            { auth_user_id: string | null; email: string | null; display_name: string | null }[]
          >`
            SELECT auth_user_id, email, display_name FROM user_account WHERE id = ${beta.userAccountId}`;
          expect(neighbourAccount!.auth_user_id).toBeNull();
          expect(neighbourAccount!.email).toBeNull();
          expect(neighbourAccount!.display_name).toBeNull();

          // Exactly one identity→town mapping exists, and it is Newcastle's.
          const mappings = await owner<{ town_id: string }[]>`
            SELECT town_id FROM better_auth.user_tenant`;
          expect(mappings.map((m) => m.town_id)).toEqual([alpha.townId]);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("answers a token whose town is not the one it names with 404, disclosing nothing", async () => {
    // The hint says Newcastle; the invitation is Bristol's. That is what a
    // corrupted or stale `better_auth.invitation_tenant` row looks like from
    // the route's side — and the answer is the same 404 an unknown token gets,
    // rather than an error that would confirm the token exists somewhere.
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const alpha = await seed(client);
        const strangerToken = `tok-${randomUUID()}`;
        const otherTownId = randomUUID();

        await client.begin(async (tx) => {
          await tx`SELECT set_config('app.town_id', ${otherTownId}, true)`;
          await tx`INSERT INTO town (id, name, subdomain) VALUES (${otherTownId}, 'Bristol', 'bristol')`;
          const [person] = await tx<{ id: string }[]>`
            INSERT INTO person (id, town_id, name, email)
            VALUES (${randomUUID()}, ${otherTownId}, 'Neighbour', 'neighbour@example.gov')
            RETURNING id`;
          const [account] = await tx<{ id: string }[]>`
            INSERT INTO user_account (id, person_id, town_id, role)
            VALUES (${randomUUID()}, ${person!.id}, ${otherTownId}, 'board_member')
            RETURNING id`;
          await tx`INSERT INTO invitation (id, town_id, person_id, user_account_id, token, status, expires_at, role, email)
                   VALUES (${randomUUID()}, ${otherTownId}, ${person!.id}, ${account!.id},
                           ${strangerToken}, 'pending', now() + interval '7 days', 'board_member',
                           'neighbour@example.gov')`;
        });

        // Point the hint at the wrong town — the only thing here that can be
        // corrupted, and the thing that must not matter.
        await client`
          UPDATE better_auth.invitation_tenant SET town_id = ${alpha.townId}
           WHERE token_sha256 = sha256(convert_to(${strangerToken}, 'UTF8'))`;

        const { server } = await buildApp(client, []);
        try {
          const res = await server.inject({
            method: "POST",
            url: "/api/invitations/accept",
            payload: { token: strangerToken, password: PASSWORD },
          });
          expect(res.statusCode).toBe(404);

          const validate = await server.inject({
            method: "GET",
            url: `/api/invitations/validate?token=${strangerToken}`,
          });
          expect(validate.statusCode).toBe(404);

          // Nothing was created on the way to refusing.
          expect(await owner`SELECT 1 FROM better_auth."user"`).toHaveLength(0);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });
});
