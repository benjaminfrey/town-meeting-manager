/**
 * `drizzle/0004_hash_invitation_tokens.sql`, run against invitations that
 * exist BEFORE it — the case every other test misses, because the harness
 * normally builds an empty database from the whole corpus and there is
 * nothing for the backfill to do.
 *
 * Seeded the way a live database looks at 0003: plaintext tokens in
 * `invitation.token`, and the hint rows 0002's trigger wrote for them.
 *
 *   SENT, pending   — someone holds this link. It must keep working: the
 *                     digest must equal the one its hint is keyed on.
 *   NEVER SENT      — nobody legitimately holds this token; it could only
 *                     have been read out of the database (as
 *                     `boardMember.roster` allowed before PR #16). It must
 *                     come out with NO credential and NO hint.
 *   ACCEPTED        — sent, used. Keeps its digest like any sent row.
 *
 * Runs on the owner connection, which is a superuser here (see
 * `db-harness.ts`) — so this proves the SQL's outcome, not the FORCE-RLS
 * dance a non-superuser owner needs. That dance is guarded inside the
 * migration itself, by a `row_security_active` check BEFORE the backfill: a
 * count taken afterwards is blind in the same way the backfill would be, so
 * it cannot catch a backfill that saw no rows. (Measured by applying 0004 as a
 * NOSUPERUSER NOBYPASSRLS owner, with and without its NO FORCE line.)
 */

import { describe, it, expect } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { withTestDb, applyMigrationFile } from "../../test/db-harness.js";

const MIGRATION = "0004_hash_invitation_tokens.sql";

const sha256Hex = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

describe(MIGRATION, () => {
  it("keeps every sent link working, strips never-sent tokens, and leaves no plaintext", async () => {
    await withTestDb(
      async (owner) => {
        const townId = randomUUID();
        const personId = randomUUID();
        const accountId = randomUUID();
        const tokens = {
          sent: `sent-${randomUUID()}`,
          unsent: `unsent-${randomUUID()}`,
          accepted: `accepted-${randomUUID()}`,
        };
        const ids = { sent: randomUUID(), unsent: randomUUID(), accepted: randomUUID() };

        await owner`INSERT INTO town (id, name, subdomain) VALUES (${townId}, 'Alpha', 'alpha')`;
        await owner`INSERT INTO person (id, town_id, name, email)
                    VALUES (${personId}, ${townId}, 'Pat', 'pat@alpha.gov')`;
        await owner`INSERT INTO user_account (id, person_id, town_id, role)
                    VALUES (${accountId}, ${personId}, ${townId}, 'board_member')`;
        for (const [key, sentAt, status] of [
          ["sent", "now()", "pending"],
          ["unsent", null, "pending"],
          ["accepted", "now()", "accepted"],
        ] as const) {
          await owner`
            INSERT INTO invitation (id, person_id, user_account_id, town_id, token, status,
                                    expires_at, sent_at)
            VALUES (${ids[key]}, ${personId}, ${accountId}, ${townId}, ${tokens[key]},
                    ${status}, now() + interval '7 days',
                    ${sentAt === null ? null : owner`now()`})`;
        }
        // 0002's trigger wrote a hint for all three, the never-sent one included.
        expect(await owner`SELECT 1 FROM better_auth.invitation_tenant`).toHaveLength(3);

        await applyMigrationFile(owner, MIGRATION);

        const rows = await owner<{ id: string; digest: string | null; row: string }[]>`
          SELECT id, encode(token_sha256, 'hex') AS digest, row_to_json(i)::text AS row
            FROM invitation i`;
        const byId = new Map(rows.map((r) => [r.id, r]));

        // Sent and accepted: the digest is exactly the one 0002 keyed the hint
        // on, computed independently here.
        expect(byId.get(ids.sent)!.digest).toBe(sha256Hex(tokens.sent));
        expect(byId.get(ids.accepted)!.digest).toBe(sha256Hex(tokens.accepted));
        // Never sent: no credential at all.
        expect(byId.get(ids.unsent)!.digest).toBeNull();

        // The plaintext column is gone, and no token survives anywhere in any row.
        const columns = await owner<{ column_name: string }[]>`
          SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'invitation'`;
        expect(columns.map((c) => c.column_name)).not.toContain("token");
        for (const r of rows) {
          for (const t of Object.values(tokens)) expect(r.row).not.toContain(t);
        }

        // Hints: the two sent rows still resolve, via the SAME lookup the
        // bootstrap performs on a presented token. The never-sent one is gone.
        const resolve = async (token: string) =>
          (
            await owner<{ town_id: string }[]>`
              SELECT town_id FROM better_auth.invitation_tenant
               WHERE token_sha256 = sha256(convert_to(${token}, 'UTF8'))`
          )[0]?.town_id ?? null;
        expect(await resolve(tokens.sent)).toBe(townId);
        expect(await resolve(tokens.accepted)).toBe(townId);
        expect(await resolve(tokens.unsent)).toBeNull();
        expect(await owner`SELECT 1 FROM better_auth.invitation_tenant`).toHaveLength(2);

        // FORCE is back on — the migration restored what it lifted.
        const [force] = await owner<{ relforcerowsecurity: boolean }[]>`
          SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.invitation'::regclass`;
        expect(force!.relforcerowsecurity).toBe(true);

        // A plaintext token can no longer be stored by mistake: wrong type, and
        // a bytea of the wrong length fails the CHECK.
        await expect(
          owner`UPDATE invitation SET token_sha256 = convert_to('not-a-digest', 'UTF8')
                 WHERE id = ${ids.sent}`,
        ).rejects.toThrow(/invitation_token_sha256_is_a_digest/);
      },
      { before: MIGRATION },
    );
  });
});
