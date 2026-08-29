/**
 * Stage 1, Task D1c — the pre-tenant bootstrap, and its boundary.
 *
 * `resolveInvitationTown` is the ONE query in the invitation path that runs
 * outside a tenant context. Everything else about invitation acceptance is
 * ordinary RLS-scoped work; this is the part that has to be argued for. So
 * this file does not merely check that it returns the right town — it pins the
 * boundary, which is the thing a future change could quietly widen:
 *
 *   - it returns a town id and NOTHING else;
 *   - the only pre-tenant lookup it can perform is equality on a full digest,
 *     and the digest is of the token, not the token itself;
 *   - the invitation table remains completely unreadable without a tenant, so
 *     nothing was traded away to get the town;
 *   - a hint pointing at the wrong town yields no rows rather than another
 *     town's rows — which is why the hint being merely a hint is safe;
 *   - the hint stays in step with `invitation` through issue, reissue and
 *     delete, without any application code remembering to maintain it.
 *
 * Everything runs on `connectAsAppRole` — the non-owner `tmm_app` connection —
 * because on the owner connection (a superuser in every supported setup) RLS
 * is bypassed and every assertion below would pass with the security model
 * switched off entirely. See `test/db-harness.ts`.
 */

import { describe, it, expect } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { resolveInvitationTown } from "../../db/invitation-bootstrap.js";
import { withTenant } from "../../db/with-tenant.js";

interface Town {
  townId: string;
  personId: string;
  userAccountId: string;
  invitationId: string;
  token: string;
}

/** A town with one pending invitation. */
async function seedTown(app: postgres.Sql, name: string): Promise<Town> {
  const town: Town = {
    townId: randomUUID(),
    personId: randomUUID(),
    userAccountId: randomUUID(),
    invitationId: randomUUID(),
    token: `tok-${randomUUID()}`,
  };

  await app.begin(async (tx) => {
    await tx`SELECT set_config('app.town_id', ${town.townId}, true)`;
    await tx`INSERT INTO town (id, name, subdomain) VALUES (${town.townId}, ${name}, ${name.toLowerCase()})`;
    await tx`INSERT INTO person (id, town_id, name, email)
             VALUES (${town.personId}, ${town.townId}, ${`${name} Invitee`}, ${`invitee@${name.toLowerCase()}.gov`})`;
    await tx`INSERT INTO user_account (id, person_id, town_id, role)
             VALUES (${town.userAccountId}, ${town.personId}, ${town.townId}, 'board_member')`;
    await tx`INSERT INTO invitation (id, town_id, person_id, user_account_id, token, status, expires_at, role, email)
             VALUES (${town.invitationId}, ${town.townId}, ${town.personId}, ${town.userAccountId},
                     ${town.token}, 'pending', now() + interval '7 days', 'board_member',
                     ${`invitee@${name.toLowerCase()}.gov`})`;
  });

  return town;
}

describe("resolveInvitationTown", () => {
  it("turns a presented token into its town", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const alpha = await seedTown(app, "Alpha");
        const beta = await seedTown(app, "Beta");
        const db = drizzle(app);

        expect(await resolveInvitationTown(db, alpha.token)).toBe(alpha.townId);
        expect(await resolveInvitationTown(db, beta.token)).toBe(beta.townId);
      } finally {
        await app.end();
      }
    });
  });

  it("resolves nothing for a token it was not given", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const alpha = await seedTown(app, "Alpha");
        const db = drizzle(app);

        // Unknown, empty, and one character off. The last matters: the lookup
        // is equality on a digest, so a near-miss is as good as a miss —
        // there is no prefix or similarity form of this query to exploit.
        expect(await resolveInvitationTown(db, `tok-${randomUUID()}`)).toBeNull();
        expect(await resolveInvitationTown(db, "")).toBeNull();
        expect(await resolveInvitationTown(db, alpha.token.slice(0, -1))).toBeNull();
        expect(await resolveInvitationTown(db, `${alpha.token}x`)).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("returns a town id and nothing else — the hint table holds no invitation data", async () => {
    await withTestDb(async (owner) => {
      const columns = await owner<{ column_name: string; data_type: string }[]>`
        SELECT column_name, data_type
          FROM information_schema.columns
         WHERE table_schema = 'better_auth' AND table_name = 'invitation_tenant'
         ORDER BY ordinal_position
      `;

      // Two columns. Adding a third — the person, the email, the role, the
      // invitation id — would make this table worth reading for its own sake,
      // which is the property being defended.
      expect(columns.map((c) => c.column_name)).toEqual(["token_sha256", "town_id"]);
      expect(columns.map((c) => c.data_type)).toEqual(["bytea", "uuid"]);
    });
  });

  it("stores a one-way digest, so possessing the whole table yields no token", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const alpha = await seedTown(app, "Alpha");

        const stored = await owner<{ token_sha256: Buffer; town_id: string }[]>`
          SELECT token_sha256, town_id FROM better_auth.invitation_tenant
        `;
        expect(stored).toHaveLength(1);

        // It is the sha256 of the token, computed independently here rather
        // than read back from the same expression that wrote it.
        expect(stored[0]!.token_sha256.toString("hex")).toBe(
          createHash("sha256").update(alpha.token, "utf8").digest("hex"),
        );

        // And the token itself appears nowhere in the row. Dumping this table
        // hands an attacker 32 bytes they cannot present to anything.
        const asText = `${stored[0]!.token_sha256.toString("hex")} ${stored[0]!.town_id}`;
        expect(asText).not.toContain(alpha.token);
      } finally {
        await app.end();
      }
    });
  });

  it("buys the town without opening the invitation — public.invitation stays unreadable pre-tenant", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const alpha = await seedTown(app, "Alpha");
        await seedTown(app, "Beta");

        // The bootstrap succeeds…
        expect(await resolveInvitationTown(drizzle(app), alpha.token)).toBe(alpha.townId);

        // …and yet, on that same connection with no tenant set, the table it
        // is about is still completely invisible. Not narrowed — invisible.
        // This is what "the bootstrap cannot be widened into a general query"
        // means concretely: there is no general query to widen it into.
        expect(await app`SELECT id FROM invitation`).toHaveLength(0);
        expect(await app`SELECT id FROM invitation WHERE token = ${alpha.token}`).toHaveLength(0);
        expect(await app`SELECT id FROM person`).toHaveLength(0);
        expect(await app`SELECT id FROM town`).toHaveLength(0);

        // The rows are really there — this is RLS, not an empty database.
        expect(await owner`SELECT id FROM invitation`).toHaveLength(2);
      } finally {
        await app.end();
      }
    });
  });

  it("cannot hand over another town's invitation, even with the hint corrupted", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const alpha = await seedTown(app, "Alpha");
        const beta = await seedTown(app, "Beta");
        const db = drizzle(app);

        // Repoint Beta's token at Alpha's town — the worst a compromised or
        // buggy hint table can do. `tmm_app` holds DML on better_auth, so this
        // is a write the application itself could make by mistake.
        await app`
          UPDATE better_auth.invitation_tenant
             SET town_id = ${alpha.townId}
           WHERE token_sha256 = sha256(convert_to(${beta.token}, 'UTF8'))
        `;

        const proposed = await resolveInvitationTown(db, beta.token);
        expect(proposed).toBe(alpha.townId);

        // And the read the routes actually perform finds nothing, because
        // Beta's invitation is not in Alpha's town. The hint proposes; RLS
        // decides. A corrupted hint denies service to one token — it does not
        // disclose a row.
        const found = await withTenant(
          db,
          { townId: proposed! },
          async (tx) =>
            (await tx.execute(
              sql`SELECT id, person_id, email FROM invitation WHERE token = ${beta.token}`,
            )) as unknown[],
        );
        expect(found).toHaveLength(0);
      } finally {
        await app.end();
      }
    });
  });
});

describe("the hint table's trigger", () => {
  it("keeps step with an invitation through issue, reissue and delete", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const alpha = await seedTown(app, "Alpha");
        const db = drizzle(app);

        // Issued — written by the trigger, not by any application code. This
        // is what makes the bootstrap correct for invitations created by the
        // web client, which still inserts them directly and is not migrated
        // until Phase E.
        expect(await resolveInvitationTown(db, alpha.token)).toBe(alpha.townId);

        // Reissued (POST /api/invitations/:id/resend).
        const newToken = `tok-${randomUUID()}`;
        await app.begin(async (tx) => {
          await tx`SELECT set_config('app.town_id', ${alpha.townId}, true)`;
          await tx`UPDATE invitation SET token = ${newToken} WHERE id = ${alpha.invitationId}`;
        });
        expect(await resolveInvitationTown(db, newToken)).toBe(alpha.townId);
        // The superseded token resolves to nothing rather than lingering.
        expect(await resolveInvitationTown(db, alpha.token)).toBeNull();

        // Deleted.
        await app.begin(async (tx) => {
          await tx`SELECT set_config('app.town_id', ${alpha.townId}, true)`;
          await tx`DELETE FROM invitation WHERE id = ${alpha.invitationId}`;
        });
        expect(await resolveInvitationTown(db, newToken)).toBeNull();
        expect(await owner`SELECT 1 FROM better_auth.invitation_tenant`).toHaveLength(0);
      } finally {
        await app.end();
      }
    });
  });
});
