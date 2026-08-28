/**
 * Stage 1, Task B3 — THE ISOLATION GATE.
 *
 * This is the only evidence in the repository that multi-tenancy works. The
 * system holds executive-session minutes, unapproved draft records and
 * residents' personal data for many towns in one database, separated by
 * nothing but row-level security. Task B2 built that model; this file is what
 * says it holds.
 *
 * ─── What makes this a gate rather than decoration ───────────────────────
 *
 * Three properties, each deliberate:
 *
 * 1. **It runs as `tmm_app`, not as the owner.** `withTestDb` hands back the
 *    database owner, and in every supported setup that owner is a superuser,
 *    which bypasses RLS outright — measured here, not assumed: with no tenant
 *    context, the owner connection sees town rows and the `tmm_app`
 *    connection sees none. A tenancy test on the owner connection would pass
 *    with RLS switched off entirely. See `connectAsAppRole` in
 *    `../../test/db-harness.ts`.
 *
 * 2. **The table list is derived from `pg_class`, never hand-copied**, and is
 *    cross-checked against the set this file seeds. A table added later
 *    without seed data fails loudly instead of being silently exempt, and a
 *    table whose RLS is switched off drops out of `relrowsecurity` — which is
 *    why the derivation asserts the RLS-enabled set equals the *whole* table
 *    set rather than trusting it.
 *
 * 3. **Every assertion has a positive control.** "Town A sees zero of town B's
 *    rows" is satisfied by a database that returns nothing to anyone, which is
 *    exactly what a dropped policy produces. So every table is also asserted
 *    to return town A's own row to town A. Both halves, always.
 *
 * ─── FORCE ROW LEVEL SECURITY, and why it needs its own connection ───────
 *
 * `FORCE ROW LEVEL SECURITY` constrains the *table owner*, and `tmm_app` is
 * not the owner — so removing FORCE is invisible to every assertion that runs
 * on the `tmm_app` connection. Measured, not assumed: with `town` set to
 * NO FORCE, `tmm_app` still returned 0 rows with no context and 0 rows in the
 * wrong tenant's context, exactly as with FORCE on.
 *
 * That is a property about a role this file would otherwise never exercise —
 * and it is the role that runs migrations, runs the seed, and is where a
 * mistyped connection string lands. Production's owner is `tmm_owner`, a
 * NON-superuser; the owner here is a superuser, which bypasses RLS regardless
 * of FORCE and so cannot show anything.
 *
 * The last test in this file closes that by *constructing* the production
 * topology: it creates a throwaway `NOSUPERUSER NOLOGIN` role, hands it
 * ownership of all 27 tables, and reads through `SET ROLE`. A superuser's
 * `SET ROLE` to a non-superuser drops the RLS bypass, so the result is a
 * genuine non-superuser table owner. With FORCE on it sees zero rows with no
 * context and only its own tenant's rows with one; with FORCE off it sees
 * everything. Both directions verified by mutation. No login, no password, no
 * pg_hba change, and no CI difference — CI's `postgres` is a superuser too.
 *
 * A catalog assertion is kept alongside it, because the behavioural test can
 * only observe FORCE where a policy also exists: on a table with RLS enabled
 * and no policy, the owner is denied everything with or without FORCE.
 */

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { withTenant, type TenantDb, type TenantTx } from "../with-tenant.js";

// ─────────────────────────────────────────────────────────────────────────
// Seed data
//
// Every table gets exactly one row per town, at a primary key derived from
// the town's prefix and the table's index. That makes every assertion below
// a lookup by id — which works uniformly for all 27 tables including
// `push_subscription`, whose tenancy runs through a foreign key and which has
// no `town_id` column to filter on. Ids are 8-4-4-4-12 hex, so `aaaaaaaa…`
// and `bbbbbbbb…` are legal UUIDs and are readable in failure output.
// ─────────────────────────────────────────────────────────────────────────

const TABLE_INDEX = {
  town: 1,
  person: 2,
  user_account: 3,
  board: 4,
  board_member: 5,
  meeting: 6,
  agenda_item: 7,
  motion: 8,
  vote_record: 9,
  minutes_document: 10,
  minutes_section: 11,
  minutes_addendum: 12,
  agenda_template: 13,
  agenda_item_transition: 14,
  audit_log: 15,
  executive_session: 16,
  exhibit: 17,
  future_item_queue: 18,
  guest_speaker: 19,
  invitation: 20,
  meeting_attendance: 21,
  notification_event: 22,
  notification_delivery: 23,
  permission_template: 24,
  push_subscription: 25,
  subscriber_notification_preference: 26,
  town_notification_config: 27,
} as const;

type SeededTable = keyof typeof TABLE_INDEX;
type RowIds = Record<SeededTable, string>;

const PREFIX_A = "aaaaaaaa";
const PREFIX_B = "bbbbbbbb";

function rowIds(prefix: string): RowIds {
  return Object.fromEntries(
    Object.entries(TABLE_INDEX).map(([table, n]) => [
      table,
      `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`,
    ]),
  ) as RowIds;
}

/**
 * Insert one row into every one of the 27 tables, for one town, from inside
 * that town's own tenant context and as `tmm_app`.
 *
 * Seeding this way is not incidental — it is the gate's positive control for
 * writes. If `WITH CHECK` were wrong in the restrictive direction, or the
 * runtime role lacked a grant, this would fail here rather than leaving the
 * read assertions to pass against an empty database.
 */
async function seedTown(app: postgres.Sql, prefix: string, label: string): Promise<RowIds> {
  const id = rowIds(prefix);
  const lower = label.toLowerCase();

  await app.begin(async (tx) => {
    await tx`SELECT set_config('app.town_id', ${id.town}, true)`;

    await tx`INSERT INTO town (id, name, subdomain)
             VALUES (${id.town}, ${`Town ${label}`}, ${`town-${lower}`})`;

    await tx`INSERT INTO person (id, town_id, name, email)
             VALUES (${id.person}, ${id.town}, ${`Person ${label}`}, ${`person-${lower}@example.gov`})`;

    await tx`INSERT INTO user_account (id, person_id, town_id, role)
             VALUES (${id.user_account}, ${id.person}, ${id.town}, 'admin')`;

    await tx`INSERT INTO board (id, town_id, name)
             VALUES (${id.board}, ${id.town}, ${`Select Board ${label}`})`;

    await tx`INSERT INTO board_member (id, person_id, board_id, town_id, term_start)
             VALUES (${id.board_member}, ${id.person}, ${id.board}, ${id.town}, DATE '2026-01-01')`;

    await tx`INSERT INTO meeting (id, board_id, town_id, title, scheduled_date)
             VALUES (${id.meeting}, ${id.board}, ${id.town}, ${`Regular Meeting ${label}`}, DATE '2026-03-01')`;

    await tx`INSERT INTO agenda_item (id, meeting_id, town_id, section_type, title)
             VALUES (${id.agenda_item}, ${id.meeting}, ${id.town}, 'business', ${`Item ${label}`})`;

    await tx`INSERT INTO motion (id, agenda_item_id, meeting_id, town_id, motion_text)
             VALUES (${id.motion}, ${id.agenda_item}, ${id.meeting}, ${id.town}, ${`Motion ${label}`})`;

    await tx`INSERT INTO vote_record (id, motion_id, meeting_id, town_id, board_member_id, vote)
             VALUES (${id.vote_record}, ${id.motion}, ${id.meeting}, ${id.town}, ${id.board_member}, 'yes')`;

    await tx`INSERT INTO minutes_document (id, meeting_id, town_id, board_id)
             VALUES (${id.minutes_document}, ${id.meeting}, ${id.town}, ${id.board})`;

    await tx`INSERT INTO minutes_section (id, minutes_document_id, town_id, section_type)
             VALUES (${id.minutes_section}, ${id.minutes_document}, ${id.town}, 'body')`;

    await tx`INSERT INTO minutes_addendum
               (id, minutes_document_id, town_id, adopting_meeting_id, content_json, description)
             VALUES (${id.minutes_addendum}, ${id.minutes_document}, ${id.town}, ${id.meeting},
                     ${JSON.stringify({ text: `Addendum ${label}` })}::jsonb, ${`Addendum ${label}`})`;

    await tx`INSERT INTO agenda_template (id, town_id, board_id, name)
             VALUES (${id.agenda_template}, ${id.town}, ${id.board}, ${`Template ${label}`})`;

    await tx`INSERT INTO agenda_item_transition (id, meeting_id, agenda_item_id, town_id)
             VALUES (${id.agenda_item_transition}, ${id.meeting}, ${id.agenda_item}, ${id.town})`;

    await tx`INSERT INTO audit_log (id, town_id, action, entity_type)
             VALUES (${id.audit_log}, ${id.town}, 'update', 'meeting')`;

    // The reason this gate exists at all: Maine's 1 M.R.S.A. §405 executive
    // sessions. A leak here is a leak of a closed-session record.
    await tx`INSERT INTO executive_session (id, meeting_id, town_id, statutory_basis)
             VALUES (${id.executive_session}, ${id.meeting}, ${id.town}, ${`1 M.R.S.A. 405(6)(A) ${label}`})`;

    await tx`INSERT INTO exhibit (id, agenda_item_id, town_id, title, file_storage_path, file_type)
             VALUES (${id.exhibit}, ${id.agenda_item}, ${id.town}, ${`Exhibit ${label}`},
                     ${`/exhibits/${lower}.pdf`}, 'application/pdf')`;

    await tx`INSERT INTO future_item_queue (id, board_id, town_id, title, source)
             VALUES (${id.future_item_queue}, ${id.board}, ${id.town}, ${`Future ${label}`}, 'manual')`;

    await tx`INSERT INTO guest_speaker (id, meeting_id, town_id, name)
             VALUES (${id.guest_speaker}, ${id.meeting}, ${id.town}, ${`Guest ${label}`})`;

    await tx`INSERT INTO invitation (id, person_id, town_id, token)
             VALUES (${id.invitation}, ${id.person}, ${id.town}, ${`invite-token-${lower}`})`;

    await tx`INSERT INTO meeting_attendance (id, meeting_id, town_id, person_id)
             VALUES (${id.meeting_attendance}, ${id.meeting}, ${id.town}, ${id.person})`;

    await tx`INSERT INTO notification_event (id, town_id, event_type)
             VALUES (${id.notification_event}, ${id.town}, 'meeting_noticed')`;

    await tx`INSERT INTO notification_delivery (id, event_id, town_id, subscriber_id, channel)
             VALUES (${id.notification_delivery}, ${id.notification_event}, ${id.town}, ${id.person}, 'email')`;

    await tx`INSERT INTO permission_template (id, town_id, name)
             VALUES (${id.permission_template}, ${id.town}, ${`Clerk ${label}`})`;

    await tx`INSERT INTO push_subscription (id, user_account_id, endpoint, p256dh, auth)
             VALUES (${id.push_subscription}, ${id.user_account}, ${`https://push.example/${lower}`},
                     ${`p256dh-${lower}`}, ${`auth-${lower}`})`;

    await tx`INSERT INTO subscriber_notification_preference (id, person_id, town_id, channel, event_type)
             VALUES (${id.subscriber_notification_preference}, ${id.person}, ${id.town}, 'email', 'meeting_noticed')`;

    await tx`INSERT INTO town_notification_config (id, town_id)
             VALUES (${id.town_notification_config}, ${id.town})`;
  });

  return id;
}

/**
 * Every relation in `public` that RLS can protect, taken from the live
 * catalog: ordinary tables (`r`) AND partitioned tables (`p`).
 *
 * `p` is not hypothetical bookkeeping. A partitioned table filtered out by a
 * `relkind = 'r'` predicate would be exempt from every assertion in this file
 * without anything saying so — and `audit_log` and `notification_delivery` are
 * the two tables in this schema most likely to be partitioned by date later.
 *
 * Two lists are derived, not one: all such relations, and the subset with
 * `relrowsecurity`. They must be equal. Deriving only from `relrowsecurity`
 * would mean an `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` quietly removes
 * that table from the gate instead of failing it — the precise silent
 * exemption this derivation exists to prevent.
 */
async function rlsEnabledTables(owner: postgres.Sql): Promise<string[]> {
  const rows = await owner<{ relname: string; enabled: boolean }[]>`
    SELECT c.relname, c.relrowsecurity AS enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  `;
  const notEnabled = rows.filter((r) => !r.enabled).map((r) => r.relname);
  expect(notEnabled, "tables in public with row-level security disabled").toEqual([]);
  return rows.map((r) => r.relname);
}

/**
 * Refuse to run against a schema containing a relation that can hand a
 * tenant's rows to another tenant without any policy being involved.
 *
 * A view runs its query as the view's OWNER unless it is declared
 * `security_invoker = true`, and the owner is not `tmm_app` — so a plain view
 * over `minutes_document` would return every town's rows to every town, obey
 * no policy, and be invisible to every other assertion in this file because it
 * is not a table. A materialized view is worse: RLS does not apply to it at
 * all and there is no `security_invoker` option to fix that, so its contents
 * are a snapshot of all tenants' data with no tenancy check available.
 *
 * There are zero of either today. This asserts that stays true, or that a view
 * added later is `security_invoker`.
 */
async function assertNoRlsBypassingRelations(owner: postgres.Sql): Promise<void> {
  const rows = await owner<{ relname: string; kind: string; opts: string | null }[]>`
    SELECT c.relname, c.relkind AS kind, array_to_string(c.reloptions, ',') AS opts
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    ORDER BY c.relname
  `;

  expect(
    rows.filter((r) => r.kind === "m").map((r) => r.relname),
    "materialized views in public — RLS does not apply to them at all, so " +
      "their contents are every tenant's data with no tenancy check available",
  ).toEqual([]);

  expect(
    rows.filter((r) => r.kind === "v" && !/security_invoker=(true|on)/i.test(r.opts ?? "")),
    "views in public without security_invoker=true — these run as the view " +
      "owner and return every tenant's rows regardless of policy",
  ).toEqual([]);
}

/**
 * Assert the derived catalog list is exactly the set this file seeds, then
 * hand back the seeded ids as a lookup keyed by table name.
 */
function assertSeedCoversEveryTable(tables: string[]): asserts tables is SeededTable[] {
  expect(
    tables,
    "the tables in the database and the tables this gate seeds have diverged — " +
      "a new table needs a row in seedTown() and an entry in TABLE_INDEX, or it " +
      "would be silently exempt from every assertion in this file",
  ).toEqual(Object.keys(TABLE_INDEX).sort());
}

/** `count(*)` shaped result rows, which is most of what this file reads. */
type CountRow = { n: number };

/**
 * Walk to the innermost `cause` that carries a Postgres SQLSTATE.
 *
 * Drizzle wraps driver errors, so the SQLSTATE that says *why* an INSERT was
 * rejected is one or more levels down. Falls back to the outermost error so a
 * failure is still reported with something readable if the shape ever changes.
 */
function unwrapDriverError(err: unknown): { code?: string; message: string } {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur instanceof Error; depth += 1) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return { code, message: cur.message };
    cur = cur.cause;
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

describe("tenant isolation gate", () => {
  it("returns none of town B's rows to town A, in every table, and still returns town A's own", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const [who] = await app<{ current_user: string }[]>`SELECT current_user`;
        // If this ever reads as the owner, every assertion below is worthless.
        expect(who!.current_user).toBe("tmm_app");

        const a = await seedTown(app, PREFIX_A, "A");
        const b = await seedTown(app, PREFIX_B, "B");

        const tables = await rlsEnabledTables(owner);
        assertSeedCoversEveryTable(tables);

        const db = drizzle(app);
        const results = await withTenant(db, { townId: a.town }, async (tx) => {
          const out: { table: string; foreign: number; own: number }[] = [];
          for (const table of tables) {
            const foreign = (await tx.execute(
              sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE id = ${b[table]}`,
            )) as unknown as CountRow[];
            const own = (await tx.execute(
              sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE id = ${a[table]}`,
            )) as unknown as CountRow[];
            out.push({ table, foreign: foreign[0]!.n, own: own[0]!.n });
          }
          return out;
        });

        // The gate proper.
        expect(
          results.filter((r) => r.foreign !== 0).map((r) => r.table),
          "tables leaking town B's row into town A's context",
        ).toEqual([]);

        // The positive control. Without it, a database that returns nothing to
        // anyone — which is what dropping a policy produces — passes the line
        // above.
        expect(
          results.filter((r) => r.own !== 1).map((r) => r.table),
          "tables NOT returning town A's own row to town A — the gate above is " +
            "meaningless without this",
        ).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("returns zero rows with no tenant context set — fails closed, not open", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const a = await seedTown(app, PREFIX_A, "A");
        const b = await seedTown(app, PREFIX_B, "B");

        const tables = await rlsEnabledTables(owner);
        assertSeedCoversEveryTable(tables);

        // Queried outside any transaction, so `app.town_id` was never set on
        // this connection at all — the state a request that forgot to call
        // withTenant would be in.
        const visible: { table: string; tenantRows: number; allRows: number }[] = [];
        for (const table of tables) {
          const [tenantRows] = await app<CountRow[]>`
            SELECT count(*)::int AS n FROM ${app(table)}
            WHERE id IN (${a[table]}, ${b[table]})`;
          const [allRows] = await app<CountRow[]>`SELECT count(*)::int AS n FROM ${app(table)}`;
          visible.push({ table, tenantRows: tenantRows!.n, allRows: allRows!.n });
        }

        // No tenant's row is visible to a context-less connection, anywhere.
        expect(
          visible.filter((v) => v.tenantRows !== 0).map((v) => v.table),
          "tables exposing tenant rows with no tenant context",
        ).toEqual([]);

        // And nothing else is visible either — with exactly one documented
        // exception. `permission_template` carries a second, SELECT-only
        // policy for the five shared system-default rows the baseline inserts
        // (`is_system_default = true AND town_id IS NULL`). They belong to no
        // town, so they are reference data rather than a leak; naming the
        // exception here is what stops it from becoming cover for a real one.
        expect(
          visible.filter((v) => v.table !== "permission_template" && v.allRows !== 0),
          "tables returning ANY row with no tenant context",
        ).toEqual([]);

        const defaults = visible.find((v) => v.table === "permission_template");
        expect(defaults!.allRows).toBe(5);
        const [shared] = await app<CountRow[]>`
          SELECT count(*)::int AS n FROM permission_template
          WHERE is_system_default = true AND town_id IS NULL`;
        expect(
          shared!.n,
          "every permission_template row visible without a tenant context must be a system default",
        ).toBe(defaults!.allRows);
      } finally {
        await app.end();
      }
    });
  });

  it("affects zero rows on a cross-tenant UPDATE or DELETE, and leaves the target intact", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const a = await seedTown(app, PREFIX_A, "A");
        const b = await seedTown(app, PREFIX_B, "B");

        const tables = await rlsEnabledTables(owner);
        assertSeedCoversEveryTable(tables);

        const db = drizzle(app);

        // A read-only gate would miss a write hole entirely: RLS's USING
        // clause filters what an UPDATE can *see*, and if it did not, town A
        // could rewrite or destroy town B's records without ever reading one.
        //
        // `SET id = id` is a no-op that is legal on all 27 tables regardless
        // of their columns, so the sweep stays mechanical. The thing being
        // measured is the affected-row count, not the new value.
        const writes = await withTenant(db, { townId: a.town }, async (tx) => {
          const out: { table: string; foreignUpd: number; ownUpd: number; foreignDel: number }[] =
            [];
          for (const table of tables) {
            const foreignUpd = await tx.execute(
              sql`UPDATE ${sql.identifier(table)} SET id = id WHERE id = ${b[table]}`,
            );
            const ownUpd = await tx.execute(
              sql`UPDATE ${sql.identifier(table)} SET id = id WHERE id = ${a[table]}`,
            );
            // If RLS were broken this DELETE would really delete, and deleting
            // town B's `town` row cascades to everything else it owns. The
            // "town B's rows all survived" check below is what turns that from
            // a silent success into a loud failure.
            const foreignDel = await tx.execute(
              sql`DELETE FROM ${sql.identifier(table)} WHERE id = ${b[table]}`,
            );
            out.push({
              table,
              foreignUpd: (foreignUpd as unknown as { count: number }).count,
              ownUpd: (ownUpd as unknown as { count: number }).count,
              foreignDel: (foreignDel as unknown as { count: number }).count,
            });
          }
          return out;
        });

        expect(
          writes.filter((w) => w.foreignUpd !== 0).map((w) => w.table),
          "tables where town A's UPDATE reached town B's row",
        ).toEqual([]);
        expect(
          writes.filter((w) => w.foreignDel !== 0).map((w) => w.table),
          "tables where town A's DELETE reached town B's row",
        ).toEqual([]);
        // Positive control: the same statement shape does work within the
        // tenant, so "0 rows affected" above is RLS and not a broken statement.
        expect(
          writes.filter((w) => w.ownUpd !== 1).map((w) => w.table),
          "tables where town A could not update its OWN row — the assertions " +
            "above prove nothing if every UPDATE affects zero rows",
        ).toEqual([]);

        // A concrete, observable change rather than a no-op, to answer the
        // question the affected-row count only implies: did the value move?
        await withTenant(db, { townId: a.town }, async (tx) => {
          await tx.execute(sql`UPDATE board SET name = 'HIJACKED BY TOWN A' WHERE id = ${b.board}`);
        });

        const survivors = await withTenant(db, { townId: b.town }, async (tx) => {
          const [name] = (await tx.execute(
            sql`SELECT name FROM board WHERE id = ${b.board}`,
          )) as unknown as { name: string }[];
          const out: { table: string; present: number }[] = [];
          for (const table of tables) {
            const rows = (await tx.execute(
              sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE id = ${b[table]}`,
            )) as unknown as CountRow[];
            out.push({ table, present: rows[0]!.n });
          }
          return { name: name?.name, rows: out };
        });

        expect(survivors.name).toBe("Select Board B");
        expect(
          survivors.rows.filter((r) => r.present !== 1).map((r) => r.table),
          "town B rows that did not survive town A's cross-tenant writes",
        ).toEqual([]);

        // The five shared `permission_template` system defaults are the one
        // row-set no tenant owns, and the sweep above cannot reach them (it
        // works by id, and those ids belong to neither town). They are
        // readable by everyone through a `FOR SELECT` policy, so nothing grants
        // a write path to them — but "no policy grants it" is a claim worth
        // testing rather than reasoning about, because adding `FOR ALL` to that
        // second policy would hand every town write access to every town's
        // reference data and break no other assertion in this file.
        const shared = await withTenant(db, { townId: a.town }, async (tx) => {
          const upd = await tx.execute(
            sql`UPDATE permission_template SET name = 'SEIZED' WHERE town_id IS NULL`,
          );
          const del = await tx.execute(sql`DELETE FROM permission_template WHERE town_id IS NULL`);
          return {
            updated: (upd as unknown as { count: number }).count,
            deleted: (del as unknown as { count: number }).count,
          };
        });
        expect(shared.updated, "town A rewrote the shared system-default templates").toBe(0);
        expect(shared.deleted, "town A deleted the shared system-default templates").toBe(0);
        const [stillThere] = await app<CountRow[]>`
          SELECT count(*)::int AS n FROM permission_template
          WHERE is_system_default = true AND town_id IS NULL AND name <> 'SEIZED'`;
        expect(stillThere!.n).toBe(5);
      } finally {
        await app.end();
      }
    });
  });

  it("rejects an INSERT that carries another town's id", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const a = await seedTown(app, PREFIX_A, "A");
        const b = await seedTown(app, PREFIX_B, "B");
        const db = drizzle(app);

        // Each attempt gets its own transaction: the policy violation aborts
        // the transaction it happens in, so batching them would only ever
        // exercise the first.
        const attempts: { label: string; run: () => Promise<unknown> }[] = [
          {
            label: "board with town B's town_id",
            run: () =>
              withTenant(db, { townId: a.town }, (tx) =>
                tx.execute(
                  sql`INSERT INTO board (id, town_id, name)
                      VALUES (gen_random_uuid(), ${b.town}, 'Planted by Town A')`,
                ),
              ),
          },
          {
            label: "person with town B's town_id",
            run: () =>
              withTenant(db, { townId: a.town }, (tx) =>
                tx.execute(
                  sql`INSERT INTO person (id, town_id, name, email)
                      VALUES (gen_random_uuid(), ${b.town}, 'Planted', 'planted@example.gov')`,
                ),
              ),
          },
          {
            label: "town row for a town that is not the current tenant",
            run: () =>
              withTenant(db, { townId: a.town }, (tx) =>
                tx.execute(
                  sql`INSERT INTO town (id, name, subdomain)
                      VALUES (gen_random_uuid(), 'Planted', 'planted')`,
                ),
              ),
          },
          {
            // push_subscription is the one table whose tenancy runs through a
            // foreign key rather than a town_id column, so its WITH CHECK is
            // the one most likely to be wrong in a way nothing else catches.
            label: "push_subscription attached to town B's user_account",
            run: () =>
              withTenant(db, { townId: a.town }, (tx) =>
                tx.execute(
                  sql`INSERT INTO push_subscription (id, user_account_id, endpoint, p256dh, auth)
                      VALUES (gen_random_uuid(), ${b.user_account}, 'https://push.example/planted', 'p', 'x')`,
                ),
              ),
          },
        ];

        const outcomes: { label: string; code: string | null; message: string }[] = [];
        for (const attempt of attempts) {
          try {
            await attempt.run();
            outcomes.push({ label: attempt.label, code: null, message: "SUCCEEDED — no error" });
          } catch (err) {
            // Drizzle wraps driver errors in a DrizzleQueryError whose own
            // message is just "Failed query: ..." and which carries no
            // SQLSTATE; the postgres.js error is on `cause`. Unwrapping is not
            // cosmetic — reading `code` off the wrapper yields undefined, and
            // an assertion on undefined would fail for a reason that has
            // nothing to do with RLS.
            const driver = unwrapDriverError(err);
            outcomes.push({
              label: attempt.label,
              code: driver.code ?? null,
              message: driver.message,
            });
          }
        }

        // 42501 insufficient_privilege is what Postgres raises for
        // "new row violates row-level security policy". An INSERT that
        // succeeds, or that fails for some unrelated reason (a constraint, a
        // typo in this test), is equally a failure of this assertion.
        expect(
          outcomes.filter((o) => o.code !== "42501"),
          "cross-tenant INSERTs that were not rejected by an RLS policy",
        ).toEqual([]);
        expect(
          outcomes.filter((o) => !/row-level security policy/.test(o.message)),
          "cross-tenant INSERTs rejected for some reason other than RLS",
        ).toEqual([]);

        // Rejected is not the same as "left no trace": check town B's own
        // context, which is the only place a planted row would be visible.
        // One board + one person + one town + one push_subscription is what
        // seedTown created, so 4 means nothing was added.
        const inB = await withTenant(db, { townId: b.town }, async (tx) => {
          const rows = (await tx.execute(sql`
            SELECT ((SELECT count(*) FROM board) + (SELECT count(*) FROM person)
                  + (SELECT count(*) FROM town) + (SELECT count(*) FROM push_subscription))::int AS n`)) as unknown as CountRow[];
          return rows[0]!.n;
        });
        expect(inB, "town B gained a row from town A's rejected INSERTs").toBe(4);

        // TRUNCATE is the one DML-ish operation RLS cannot restrict at all: it
        // takes no WHERE clause and consults no policy, so a successful
        // TRUNCATE removes every tenant's rows regardless of how correct the
        // tenancy model is. The only thing standing in its way is the absence
        // of the TRUNCATE grant — Task B2 granted `tmm_app` exactly
        // SELECT/INSERT/UPDATE/DELETE for this reason. That absence is asserted
        // from the catalog in schema-invariants.test.ts; asserted here as
        // behaviour, because this gate must not depend on another file's test
        // to mean what it claims to mean.
        let truncate: { code?: string; message: string };
        try {
          await withTenant(db, { townId: a.town }, (tx) => tx.execute(sql`TRUNCATE board`));
          truncate = { message: "SUCCEEDED — every town's boards were removed" };
        } catch (err) {
          truncate = unwrapDriverError(err);
        }
        expect(truncate.code, `TRUNCATE as tmm_app: ${truncate.message}`).toBe("42501");
        expect(truncate.message).toMatch(/permission denied/i);

        // And it really did not happen.
        const boardsInB = await withTenant(db, { townId: b.town }, async (tx) => {
          const rows = (await tx.execute(
            sql`SELECT count(*)::int AS n FROM board`,
          )) as unknown as CountRow[];
          return rows[0]!.n;
        });
        expect(boardsInB, "town B's board did not survive town A's TRUNCATE").toBe(1);
      } finally {
        await app.end();
      }
    });
  });

  it("does not let tenant context survive the transaction that set it", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const a = await seedTown(app, PREFIX_A, "A");
        const db = drizzle(app);

        // This is the property `SET LOCAL` provides and the one most likely to
        // regress silently: with `set_config(..., false)` everything below
        // still passes every OTHER test in this file, and the only symptom in
        // production is that the next request to be handed this pooled
        // connection reads town A's data.
        const first = await withTenant(db, { townId: a.town }, async (tx) => {
          const rows = (await tx.execute(
            sql`SELECT get_current_town_id()::text AS town, pg_backend_pid() AS pid,
                       (SELECT count(*)::int FROM town) AS n`,
          )) as unknown as { town: string | null; pid: number; n: number }[];
          return rows[0]!;
        });
        expect(first.town).toBe(a.town);
        expect(first.n).toBe(1);

        // A second, entirely separate transaction on the same pool. `max: 1`
        // (see connectAsAppRole) means it is the same backend, and the pid is
        // asserted rather than assumed — if the pool handed out a fresh
        // connection this test would pass for the wrong reason.
        const second = await db.transaction(async (tx) => {
          const rows = (await tx.execute(
            sql`SELECT get_current_town_id()::text AS town, pg_backend_pid() AS pid,
                       (SELECT count(*)::int FROM town) AS n`,
          )) as unknown as { town: string | null; pid: number; n: number }[];
          return rows[0]!;
        });

        expect(
          second.pid,
          "the two transactions did not share a connection, so this test proves nothing",
        ).toBe(first.pid);
        expect(second.town, "app.town_id survived the transaction that set it").toBeNull();
        expect(second.n, "town A's data was still visible in a later transaction").toBe(0);

        // And outside a transaction altogether, on the same connection.
        const [outside] = await app<{ town: string | null; pid: number }[]>`
          SELECT get_current_town_id()::text AS town, pg_backend_pid() AS pid`;
        expect(outside!.pid).toBe(first.pid);
        expect(outside!.town).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a townId that would silently disable every policy", async () => {
    // `get_current_town_id()` is `nullif(current_setting('app.town_id', true), '')::uuid`,
    // so an empty string resolves to NULL and `town_id = NULL` is NULL — every
    // policy matches nothing and every query returns zero rows with no error.
    // That is indistinguishable from "this town has no data", so withTenant
    // rejects it before it can happen. No database needed.
    const db: TenantDb<TenantTx> = {
      transaction: async () => {
        throw new Error("withTenant opened a transaction for an invalid townId");
      },
    };
    await expect(withTenant(db, { townId: "" }, async () => undefined)).rejects.toThrow(
      /must be a UUID/,
    );
    await expect(withTenant(db, { townId: "not-a-uuid" }, async () => undefined)).rejects.toThrow(
      /must be a UUID/,
    );
  });

  it("binds a NON-SUPERUSER TABLE OWNER too — FORCE ROW LEVEL SECURITY, behaviourally", async () => {
    await withTestDb(async (owner) => {
      // Production's table owner is `tmm_owner`, a non-superuser. Nothing else
      // in this repository exercises that topology: the harness's owner is a
      // superuser (as is CI's `postgres`), which bypasses RLS regardless of
      // FORCE, and every other test here runs as `tmm_app`, which is not the
      // owner at all and so cannot see FORCE either way.
      //
      // So the topology is constructed. A throwaway NOSUPERUSER NOLOGIN role
      // takes ownership of all 27 tables, and the assertions run through
      // `SET LOCAL ROLE` — a superuser's SET ROLE to a non-superuser drops the
      // RLS bypass, so what reads below is a genuine non-superuser table owner.
      // NOLOGIN because nothing ever connects as it; there is no password and
      // no pg_hba change.
      //
      // Cluster roles outlive the per-test database, and this project has
      // leaked roles three times, so the role is uniquely named (databases are
      // created in parallel), and REASSIGN/DROP OWNED/DROP ROLE run in a
      // `finally`. global-teardown.ts sweeps any that a crash leaves behind.
      const probeRole = `tmm_force_probe_${randomBytes(6).toString("hex")}`;
      const app = await connectAsAppRole(owner);
      const [self] = await owner<{ me: string }[]>`SELECT current_user AS me`;

      try {
        const a = await seedTown(app, PREFIX_A, "A");
        const b = await seedTown(app, PREFIX_B, "B");

        const tables = await rlsEnabledTables(owner);
        assertSeedCoversEveryTable(tables);
        await assertNoRlsBypassingRelations(owner);

        await owner.unsafe(`CREATE ROLE "${probeRole}" NOSUPERUSER NOLOGIN`);
        try {
          // The baseline REVOKEs schema privileges from PUBLIC, so a table
          // owner still needs USAGE on the schema to reach its own tables.
          await owner.unsafe(`GRANT USAGE ON SCHEMA public TO "${probeRole}"`);
          for (const table of tables) {
            await owner.unsafe(`ALTER TABLE public."${table}" OWNER TO "${probeRole}"`);
          }

          const [transferred] = await owner<CountRow[]>`
            SELECT count(*)::int AS n
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
              AND c.relowner = ${probeRole}::regrole`;
          expect(
            transferred!.n,
            "ownership transfer did not cover every table, so the tables it " +
              "missed are still owned by a superuser and prove nothing",
          ).toBe(tables.length);

          const observed = await owner.begin(async (tx) => {
            await tx.unsafe(`SET LOCAL ROLE "${probeRole}"`);

            const [who] = await tx<{ me: string; su: boolean }[]>`
              SELECT current_user AS me, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su`;

            // Phase 1 — no tenant context. This is what a migration script or
            // a mistyped connection string looks like. With FORCE it sees
            // nothing; without FORCE it sees every town.
            const noContext: { table: string; rows: number }[] = [];
            for (const table of tables) {
              const [n] = await tx<CountRow[]>`
                SELECT count(*)::int AS n FROM ${tx(table)}
                WHERE id IN (${a[table]}, ${b[table]})`;
              noContext.push({ table, rows: n!.n });
            }

            // Phase 2 — town A's context. Same connection, same role.
            await tx`SELECT set_config('app.town_id', ${a.town}, true)`;
            const inTownA: { table: string; own: number; foreign: number }[] = [];
            for (const table of tables) {
              const [own] = await tx<CountRow[]>`
                SELECT count(*)::int AS n FROM ${tx(table)} WHERE id = ${a[table]}`;
              const [foreign] = await tx<CountRow[]>`
                SELECT count(*)::int AS n FROM ${tx(table)} WHERE id = ${b[table]}`;
              inTownA.push({ table, own: own!.n, foreign: foreign!.n });
            }

            return { who: who!, noContext, inTownA };
          });

          // If either of these is wrong the rest is a test of superuser-ness.
          expect(observed.who.me).toBe(probeRole);
          expect(observed.who.su, "the probe role is a superuser and bypasses RLS").toBe(false);

          expect(
            observed.noContext.filter((r) => r.rows !== 0).map((r) => r.table),
            "tables the NON-SUPERUSER OWNER could read with no tenant context — " +
              "FORCE ROW LEVEL SECURITY is not binding the owner on these",
          ).toEqual([]);

          expect(
            observed.inTownA.filter((r) => r.foreign !== 0).map((r) => r.table),
            "tables leaking town B's row to a non-superuser owner in town A's context",
          ).toEqual([]);

          // Positive control, and the half that distinguishes "FORCE works"
          // from "this role cannot read anything at all".
          expect(
            observed.inTownA.filter((r) => r.own !== 1).map((r) => r.table),
            "tables the non-superuser owner could NOT read in its own tenant's " +
              "context — the assertions above prove nothing if every read is empty",
          ).toEqual([]);
        } finally {
          // Ownership first: DROP ROLE refuses while the role owns anything,
          // and DROP OWNED BY would drop the tables themselves rather than the
          // role's grants if ownership were still in place.
          await owner.unsafe(`REASSIGN OWNED BY "${probeRole}" TO "${self!.me}"`);
          await owner.unsafe(`DROP OWNED BY "${probeRole}"`);
          await owner.unsafe(`DROP ROLE IF EXISTS "${probeRole}"`);
        }
      } finally {
        await app.end();
      }
    });
  });

  it("keeps FORCE ROW LEVEL SECURITY set on every table, per the catalog", async () => {
    await withTestDb(async (owner) => {
      // Kept alongside the behavioural test above rather than replaced by it,
      // because the two see different things. The behavioural test can only
      // observe FORCE where a policy also exists: on a table with RLS enabled
      // and no policy, the owner is denied everything with or without FORCE,
      // so a missing FORCE line would hide behind a missing policy. This reads
      // the flag directly and does not care.
      const rows = await owner<{ relname: string; enabled: boolean; forced: boolean }[]>`
        SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        ORDER BY c.relname
      `;

      expect(rows.map((r) => r.relname)).toEqual(Object.keys(TABLE_INDEX).sort());
      expect(
        rows.filter((r) => !r.enabled).map((r) => r.relname),
        "tables without ROW LEVEL SECURITY enabled",
      ).toEqual([]);
      expect(
        rows.filter((r) => !r.forced).map((r) => r.relname),
        "tables without FORCE ROW LEVEL SECURITY — the table owner bypasses " +
          "every policy on these",
      ).toEqual([]);

      await assertNoRlsBypassingRelations(owner);
    });
  });
});
