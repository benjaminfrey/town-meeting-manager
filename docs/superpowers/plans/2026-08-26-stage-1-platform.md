# Stage 1 — Platform Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace self-hosted Supabase (PostgREST, GoTrue, Realtime, Storage, Kong) with tRPC on Fastify, Drizzle, Better Auth, SSE over `LISTEN/NOTIFY`, and filesystem storage — on plain PostgreSQL 17, with tenancy enforced by RLS and permissions enforced in tested TypeScript.

**Architecture:** One Fastify 5 process behind nginx at same-origin `/api`. `pg.Pool` for queries, one dedicated `postgres.js` connection for `LISTEN`. Every request runs in a transaction that sets `app.town_id` via `SET LOCAL`; RLS is the tenancy backstop, the 30-action matrix lives in TypeScript.

**Tech Stack:** tRPC 11.18.0 · Drizzle ORM 0.45.2 · drizzle-zod 0.8.3 · Better Auth ≥1.7.1 · `pg` 8.23.0 · `postgres` 3.4.9 · PostgreSQL 17.11 · Fastify 5

**Parent plan:** [2026-08-26-tmm-revival-master-plan.md](2026-08-26-tmm-revival-master-plan.md) — its Global Constraints bind every task here.
**Spec:** [2026-08-26-tmm-revival-design.md](../specs/2026-08-26-tmm-revival-design.md)

---

## Stage 1 Global Constraints

These add to the master plan's Global Constraints, which still apply in full.

- **`tmm_app` must never own a table and must never be superuser.** Table owners bypass RLS. Verified state today: both roles `rolsuper=f`, database owned by `tmm_owner`.
- **`tmm_app`'s grants must live inside the migration corpus.** `scripts/build-db-from-repo.sh` runs `DROP SCHEMA public CASCADE`, so any grant applied out-of-band is destroyed on the next gate run and the gate will pass against a database the app cannot use.
- **`FORCE ROW LEVEL SECURITY` on every RLS-enabled table.** **26 distinct tables** have RLS enabled (30 statements — four notification tables are enabled once in the official corpus and again in the ported one); **zero** have FORCE. Without it, `tmm_owner` silently bypasses every policy. _An earlier draft said 25; that number predated Task 7's consolidation, which added `invitation` to the RLS set. Recount before relying on it._
- **`push_subscription` is the one table of 27 with no RLS at all**, and it has no `town_id` — it reaches a town only through `user_account_id`. Decide in B2 whether it gets a tenancy policy via that FK or is deliberately exempt, and record which. Do not leave it undecided.
- **Every `SECURITY DEFINER` function gets an explicit `SET search_path`.** There are 14 across 7 files and only `20260310000003_onboarding_rpc.sql:41` has one. A `SECURITY DEFINER` function with a mutable search_path is a privilege-escalation vector.
- **The 21 `has_permission()` RLS call sites are removed, not rewritten** — each becomes a tRPC procedure guard with a test. Nothing may be dropped silently.
- **Permission lookup standardizes on action CODES** (`R1`, `M3`), not names (`edit_agenda`). `supabase/seed.sql:92` already seeds by code. The current code/name mismatch is why authorization is inert today.
- **Migrations remain append-only.** Drizzle never re-checks applied hashes.

---

## What Stage 0 handed forward

Established facts. Do not re-derive them; do verify anything you depend on.

| Fact                                       | Detail                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corpus is structurally sound               | With a throwaway `auth`/`storage` shim, **56 of 58 migrations apply → 27 tables**. Reproduced independently three times.                                                                                                                                                                                                   |
| Only two blockers behind the `auth.*` wall | `storage.foldername(text)` (Supabase Storage), and the notification-table collision.                                                                                                                                                                                                                                       |
| The `auth.*` surface                       | 14 `auth.uid` · 12 `auth.jwt` · 12 `auth.users` · 3 `storage.*` references across 18 files. The FK that halts everything is `user_account.auth_user_id REFERENCES auth.users(id)` at `20260308000004:26`, file 4 of 58.                                                                                                    |
| Helper rewrite is 4 function bodies        | Of 7 helpers in `20260308000027`, only these read identity directly: `get_current_town_id` (:19), `get_current_role` (:29), `get_current_person_id` (:39), `get_current_user_account_id` (:49). `is_admin`, `has_permission`, `has_board_permission` build on those. Rewrite four bodies and ~115 call sites keep working. |
| Notification tables exist in three shapes  | Official corpus, ported docker corpus, and a **hybrid that is what the dev database actually contains**. Three live breakages confirmed.                                                                                                                                                                                   |
| Schema drift                               | 26 drift columns: 9 dev-only, **17 corpus-only that the dev DB lacks**. Root cause: `packages/shared/src/types/database.ts` last regenerated 2026-03-13.                                                                                                                                                                   |
| Ported migrations are not idempotent       | 8 bare `CREATE POLICY` statements, no `IF NOT EXISTS` in PostgreSQL.                                                                                                                                                                                                                                                       |
| `migrate.sh` is unrunnable                 | It runs `docker compose exec`; Docker was purged from the VM. Superseded by `scripts/build-db-from-repo.sh`.                                                                                                                                                                                                               |
| VM                                         | Debian 13, PostgreSQL 17.11 + PostGIS 3.5.2, Node 20.19.2, nginx 1.26.3, all loopback-bound. Reach Postgres by SSH tunnel.                                                                                                                                                                                                 |

---

## Task order and why

```
A1 SSE spike ──────────┐                       (transport decision gates F1)
A2 Test harness ───────┼──> B1 pull ──> B2 baseline ──> B3 ISOLATION GATE
A3 Notification decision ┘                                     │
                                                               ▼
                                          C1 Better Auth ──> C2 auth call sites
                                                               │
                                                               ▼
                                       D1 tRPC skeleton ──> D2 VERTICAL SLICE
                                                               │
                                                               ▼
                                                        E1 fan-out (parallel)
                                                               │
                                                   ┌───────────┴───────────┐
                                                   ▼                       ▼
                                            F1 realtime              F2 storage
                                                   └───────────┬───────────┘
                                                               ▼
                                            G1 auth-by-default ──> G2 decommission
```

**A1 is first because it can change the architecture.** tRPC SSE on the Fastify adapter is undocumented and unexemplified in public; the mechanism was verified from adapter source but the integration is unproven. If it fails, WebSockets is the documented fallback and the change is ~10 lines behind `splitLink` — but only if nothing has been built on the assumption yet.

**A2 is here, not in Stage 2.** Stage 1's gate is "a test proves cross-tenant reads return zero rows while connected as the application role." That is unprovable without a real Postgres-backed harness. Every existing web test mocks the Supabase client, so the current suite structurally cannot express this. The harness is a Stage 1 prerequisite, not a Stage 2 nicety.

**B3 is the stage's gate and it sits early on purpose.** Everything after it assumes tenancy isolation works. Proving it before the 244 call sites move means a failure is cheap.

**D2 before E1, always.** The vertical slice establishes the template; the fan-out is mechanical only because the slice already answered the questions. Never start E1 on an unreviewed slice.

---

# Phase A — De-risk and decide

Nothing in Phase A depends on `drizzle-kit pull` output. All three tasks are fully specified and can run now.

---

### Task A1: Spike tRPC SSE on the Fastify adapter

**Files:**

- Create: `packages/api/src/spike/sse-spike.ts` (deleted at the end of this task)
- Create: `docs/advisory-resolutions/5.1-realtime-transport.md`

**Interfaces:**

- Consumes: nothing.
- Produces: a recorded decision — `httpSubscriptionLink` (SSE) or `wsLink` (WebSockets) — that Task F1 implements.

- [ ] **Step 1: Stand up the minimal subscription**

Install `@trpc/server@11.18.0` and `@trpc/client@11.18.0` in `packages/api`. Build the smallest possible tRPC router with one subscription procedure using an async generator (not an observable — observables are the legacy API):

```ts
import { initTRPC, tracked } from "@trpc/server";

const t = initTRPC.create();

export const spikeRouter = t.router({
  ticks: t.procedure.subscription(async function* () {
    for (let i = 0; i < 5; i++) {
      yield tracked(String(i), { n: i });
      await new Promise((r) => setTimeout(r, 500));
    }
  }),
});
```

Mount it on the existing Fastify server with `fastifyTRPCPlugin`.

- [ ] **Step 2: Prove events arrive over SSE, not WebSockets**

Connect a client using `httpSubscriptionLink` — **not** `wsLink`, and **not** `useWSS: true` on the adapter. Confirm all five events arrive in order.

Run: the spike server, then the client.
Expected: five events. If the connection hangs or the response buffers instead of streaming, that is the failure mode this spike exists to find.

- [ ] **Step 3: Prove reconnection resume works**

This is the property that matters most. Kill the connection mid-stream, let the client reconnect, and confirm it resumes from `lastEventId` rather than restarting or silently skipping. A live meeting must never lose a motion or a vote to a three-second network blip.

- [ ] **Step 4: Prove it survives nginx**

Put the spike behind nginx with the config the spec requires:

```nginx
location /api/trpc/ {
    proxy_pass http://api;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400s;
}
```

Confirm events still stream. Then **deliberately remove `proxy_buffering off` and confirm it breaks** — you need to know that failure signature, because it presents as a hang rather than an error.

- [ ] **Step 5: Record the decision**

Write `docs/advisory-resolutions/5.1-realtime-transport.md` with: what you ran, what worked, what did not, the nginx requirement, and the decision. If SSE failed, record the exact failure and switch the decision to WebSockets — that is a legitimate outcome, not a failure of this task.

- [ ] **Step 6: Delete the spike and commit**

Remove `packages/api/src/spike/`. The ADR is the deliverable; the code is not.

```bash
git add docs/advisory-resolutions/5.1-realtime-transport.md packages/api/package.json pnpm-lock.yaml
git commit -m "Decide realtime transport: tRPC SSE vs WebSockets on Fastify

tRPC's Fastify adapter documents WebSockets only; SSE on that adapter has
no public example. The mechanism checks out from adapter source, but
unverified assumptions belong in a spike, not in a foundation."
```

---

### Task A2: Postgres-backed integration test harness

Stage 1's gate is unprovable without this. Every existing web test mocks the Supabase client — `.eq()` is an identity function — so the current suite would pass against a completely wrong query. That is the audit's governing finding, and this task is where it stops being true.

**Files:**

- Create: `packages/api/src/test/db-harness.ts`
- Create: `packages/api/src/test/__tests__/harness.test.ts`
- Modify: `packages/api/vitest.config.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: `scripts/build-db-from-repo.sh`.
- Produces: `withTestDb(fn)` — provisions an isolated database, applies the corpus, runs `fn`, tears down. Task B3's isolation test and every later task's integration tests depend on it.

- [ ] **Step 1: Write the failing test first**

```ts
import { describe, it, expect } from "vitest";
import { withTestDb } from "../db-harness";

describe("db harness", () => {
  it("provisions an isolated database with the schema applied", async () => {
    await withTestDb(async (sql) => {
      const rows =
        await sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`;
      expect(rows[0].n).toBeGreaterThanOrEqual(26);
    });
  });

  it("gives each test a database that cannot see another test's writes", async () => {
    await withTestDb(async (a) => {
      await a`INSERT INTO town (id, name) VALUES (gen_random_uuid(), 'Isolation A')`;
      await withTestDb(async (b) => {
        const rows = await b`SELECT count(*)::int AS n FROM town WHERE name = 'Isolation A'`;
        expect(rows[0].n).toBe(0);
      });
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @town-meeting/api test -- harness`
Expected: FAIL — `withTestDb` is not defined.

- [ ] **Step 3: Decide where the test database lives, and record why**

Two viable options. Pick one and write the reasoning into a comment at the top of `db-harness.ts`:

- **Local Postgres in CI, SSH-tunnelled VM locally.** CI gets `services: postgres:17` (fast, isolated, no shared state); developers tunnel to the VM. Cost: two code paths.
- **The VM for both.** One path, but concurrent test runs contend, and CI needs network access to a private LAN address — which GitHub-hosted runners do not have.

**The first is correct** unless you find a blocking reason: GitHub-hosted runners cannot reach `192.168.1.162`, so the VM cannot serve CI at all. Read the connection string from `DATABASE_URL`, defaulting to the CI service.

- [ ] **Step 4: Implement `withTestDb`**

Each invocation creates a uniquely-named database, applies the corpus, hands a `postgres.js` client to `fn`, and drops the database in a `finally` — so a thrown assertion still tears down. Apply the corpus by invoking the same migration list `scripts/build-db-from-repo.sh` uses, so the harness and the gate can never diverge.

Until Task B2 lands, the corpus still needs the `auth` shim. Have the harness apply `scripts/dev/auth-shim.sql` **and mark that with a `TODO(B2): remove once the baseline drops auth.\*`** — it is temporary scaffolding with a named removal point, not a permanent dependency.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm --filter @town-meeting/api test -- harness`
Expected: PASS, both cases. The isolation case is the one that matters — if it passes trivially because both callbacks got the same database, it proves nothing. Verify the two databases genuinely have different names.

- [ ] **Step 6: Wire CI**

Add a `postgres:17` service to `.github/workflows/ci.yml` and set `DATABASE_URL`. Confirm the job still passes and that the harness tests actually ran — a harness that silently skips in CI is worse than none.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/test/ packages/api/vitest.config.ts .github/workflows/ci.yml
git commit -m "Add Postgres-backed integration test harness

Stage 1's gate — proving cross-tenant reads return zero rows as the
application role — cannot be expressed against mocks. Every existing web
test mocks the Supabase client with an identity-function .eq(), so the
suite would pass against a wrong query. This is where that stops.

Re-staged from Stage 2: the gate needs it now."
```

---

### Task A3: Canonicalize the notification schema

**DECIDED 2026-08-27 - subscribers are `person`.** See "Owner decisions" at the end of this plan for the evidence. Consequences for this task, none of them optional:

- `subscriber_notification_preference` keys on `person_id`, and `notification_delivery.subscriber_id` references `person(id)`. Both match the official corpus and the dev database, so **no data migration is required**.
- **About 8 call sites are on the wrong side of this and must change**: `packages/api/src/routes/invitations.ts:455, 461, 490, 511, 517` and `packages/api/src/routes/notifications.ts:84, 95, 128`, plus the `onConflict: "subscriber_id,event_type,channel"` upserts, which become the `person_id` unique constraint. Zero notification call sites use `person_id` today - the code was written entirely against the ported shape.
- **This also answers `board_member.user_account_id`** (audit finding, previously deferred to Stage 2): board membership links to a **person**, not an account. Fold it into this migration rather than leaving it for Stage 2.

The reasoning, so nobody re-litigates it: `user_account.person_id` is `NOT NULL UNIQUE`, so a person may exist with no account - and the product deliberately supports that. `AddPersonDialog` offers an explicit "Directory-only / Staff-account" choice, and `people.test.tsx` tests a board member holding a seat with no account. Keying notifications to `user_account` would silently drop seated board members from statutory FOAA notices, and those are the people least likely to notice.

**Files:**

- Create: `supabase/migrations/20260827000001_canonicalize_notifications.sql` (bump the date if it lands later; it must sort after `20260826000002`)
- Modify: whichever of `packages/api/src/services/notification-service.ts`, `packages/api/src/routes/notifications.ts`, `packages/web/src/routes/settings.notifications.tsx` the decision requires

**Interfaces:**

- Consumes: the owner's decision.
- Produces: one authoritative shape for `notification_delivery`, `notification_event`, `subscriber_notification_preference`, `town_notification_config`. Task B1's `drizzle-kit pull` reads it.

- [ ] **Step 1: Write down the three shapes side by side**

Before changing anything, produce a table of all four affected tables across official corpus / ported corpus / dev database (from `packages/shared/src/types/database.ts`, noting it was generated 2026-03-13). Put it in the migration's header comment. Someone will need this in six months.

- [ ] **Step 2: Write failing tests for the three known live breakages**

Using the Task A2 harness, assert the behaviour the canonical shape must have:

1. `notification-service.ts` can insert a delivery row successfully (today it omits `town_id` against a `NOT NULL` column).
2. `settings.notifications.tsx`'s preference upsert targets columns that exist (today it uses `subscriber_id` / `onConflict: "subscriber_id,event_type,channel"` against a table with `person_id` and a different unique constraint).
3. The subscriber relationship resolves to the entity the owner chose.

- [ ] **Step 3: Run them and watch them fail.** Record the exact errors.

- [ ] **Step 4: Write the canonicalizing migration**

Additive and forward-only. Do **not** edit the historical migrations — they are an append-only record, and the ported files must stay byte-identical to their `docker/migrations` originals apart from their headers.

Include `DROP POLICY IF EXISTS` guards ahead of the 8 bare `CREATE POLICY` statements (`20260826000001` lines 163, 173, 184, 195, 213; `20260826000002` lines 39, 47, 55), so first application against a database that already has them does not abort with 42710.

- [ ] **Step 5: Update the call sites the decision requires.** Only those. Everything else is out of scope.

- [ ] **Step 6: Run the tests and watch them pass.**

- [ ] **Step 7: Commit** with the three-shape table and the decision in the message body.

---

# Phase B — Baseline and the isolation gate

---

### Task B1: Introspect the schema with Drizzle

**Files:**

- Create: `drizzle.config.ts`, `packages/api/src/db/schema.ts`, `packages/api/src/db/relations.ts`, `packages/api/drizzle/meta/`

**Interfaces:**

- Produces: the TypeScript schema every later task imports, and the `meta/` snapshot that makes future `generate` diffs correct.

- [ ] **Step 1: Build a clean database from the corpus.** Use `scripts/build-db-from-repo.sh` plus the shim. Record the table count — it should be 27.

- [ ] **Step 2: Install Drizzle at the pinned versions**

```bash
pnpm --filter @town-meeting/api add drizzle-orm@0.45.2 pg@8.23.0 postgres@3.4.9
pnpm --filter @town-meeting/api add -D drizzle-kit drizzle-zod@0.8.3 @types/pg
```

**`drizzle-orm@0.45.2` is a security floor** — below it, GHSA-gpj5-g38j-94v9 is a CVSS 7.5 SQL injection. Do not adopt the v1.0.0 RC; the docs site documents an RC-only `drizzle-orm/zod` subpath that does not exist in 0.45.2.

- [ ] **Step 3: Configure `drizzle.config.ts` with a roles exclusion**

Set `entities.roles` to **exclude** `tmm_owner`, `tmm_app`, and the four GoTrue role names. Without this, drizzle-kit will try to drop roles it does not know about.

- [ ] **Step 4: Pull**

Run: `pnpm exec drizzle-kit pull`

- [ ] **Step 5: Hand-review the output against the live database. Non-negotiable.**

`pull` fidelity for RLS policies and CHECK constraints is unverified upstream with known open bugs. Diff the generated schema against the real database and check specifically: enums, generated columns, partial indexes, the `tsvector` search columns and their triggers, and every RLS policy. Anything `pull` missed goes into Task B2's hand-written baseline. Record what was missed — that list is evidence about how much to trust the tool later.

- [ ] **Step 6: Generate Zod schemas from the Drizzle schema**

Use `drizzle-zod` so Zod derives from the single source, structurally ending the SQL↔types↔Zod drift rather than fixing today's instance. Expect Zod 4 type-level friction: `z.coerce` fields infer as `unknown`, and `.omit()`/`.pick()` can produce `Type 'true' is not assignable to type 'never'`. Runtime is unaffected.

- [ ] **Step 7: Commit.**

---

### Task B2: The baseline migration

This is the most important task in Stage 1. Everything about tenancy isolation depends on it.

**Files:**

- Create: `packages/api/drizzle/0000_baseline.sql`
- Modify: `scripts/build-db-from-repo.sh`
- Delete: `scripts/dev/auth-shim.sql`

**Interfaces:**

- Produces: a database that builds with **no** `auth.*` dependency. Task B3 tests it; `scripts/build-db-from-repo.sh` finally exits 0.

- [ ] **Step 1: Rewrite the four identity helpers**

In `20260308000027_create_rls_helper_functions.sql`, four bodies read identity directly. Replace the JWT reads with session settings:

```sql
CREATE OR REPLACE FUNCTION get_current_town_id() RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN nullif(current_setting('app.town_id', true), '')::UUID;
END $$;
```

Same shape for `get_current_role` (`app.role`, TEXT), `get_current_person_id` (`app.person_id`), `get_current_user_account_id` (`app.user_account_id`). `is_admin`, `has_permission` and `has_board_permission` build on these and need no change beyond the `search_path` addition below.

**`current_setting(..., true)` — the second argument `true` means "missing is not an error", returning NULL.** Without it, every query against a session that has not set the variable throws.

- [ ] **Step 2: Add `SET search_path` to all 14 `SECURITY DEFINER` functions**

Only `20260310000003_onboarding_rpc.sql:41` has one today. A `SECURITY DEFINER` function with a mutable search_path can be hijacked by an attacker who creates a shadowing object in an earlier schema. Files to fix: `20260308000027` (8), `20260308000037`, `20260308000038`, `20260308000040`, `20260310000002`, `20260310000003` (1 of 2 done).

- [ ] **Step 3: Remove the `auth.*` surface**

Drop `user_account.auth_user_id`'s FK to `auth.users` (Better Auth owns identity now — Task C1 decides the replacement column). Remove the GoTrue-specific migrations: the custom access token hook, `handle_new_user`, the auth-hook configuration. Replace the `storage.foldername` dependency in `20260311000003` — Task F2 owns filesystem storage, so this becomes a plain table.

- [ ] **Step 4: `FORCE ROW LEVEL SECURITY` on all 26 RLS-enabled tables**

```sql
ALTER TABLE town FORCE ROW LEVEL SECURITY;
-- ... all 26 (derive the list, do not hand-copy it:
--   grep -rhio 'ALTER TABLE [a-z_]* ENABLE ROW LEVEL SECURITY' supabase/migrations/*.sql \
--     | sed 's/ALTER TABLE //I; s/ ENABLE.*//I' | sort -u )
```

**Without this the entire authorization model is decorative.** `tmm_owner` owns the tables and would bypass every policy silently.

- [ ] **Step 5: Grant `tmm_app` DML only — inside the corpus**

```sql
GRANT USAGE ON SCHEMA public TO tmm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tmm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tmm_app;
```

Never `GRANT ALL`, never ownership. This **must** live in the corpus: `build-db-from-repo.sh` drops the public schema, so an out-of-band grant is destroyed on the next gate run and the gate would pass against a database the app cannot use.

- [ ] **Step 6: Remove the 21 `has_permission()` calls from RLS policies**

Files and codes: `20260308000033` (A2, M2, M3), `20260308000034` (R1, R4, A3), `20260308000035` (C2). Each policy keeps its `town_id` tenancy predicate and loses its permission predicate. **Record each removal in a checklist** — Task D1 reimplements every one as a procedure guard, and anything not on the checklist will be silently lost.

- [ ] **Step 7: Delete the shim and prove it is unnecessary**

Remove `scripts/dev/auth-shim.sql` and the harness's `TODO(B2)` reference. Run `scripts/build-db-from-repo.sh` with **no** shim.

Expected: **exit 0**, seed applied, ≥26 tables. This is the criterion moved here from Stage 0.

- [ ] **Step 8: Commit.**

---

### Task B3: The isolation gate

**This is Stage 1's gate.** Without this test there is no evidence RLS works at all.

**Files:**

- Create: `packages/api/src/db/__tests__/tenant-isolation.test.ts`, `packages/api/src/db/with-tenant.ts`

- [ ] **Step 1: Implement `withTenant`**

```ts
export async function withTenant<T>(
  ctx: { townId: string },
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.town_id', ${ctx.townId}, true)`);
    return fn(tx);
  });
}
```

**The third argument `true` is `SET LOCAL` semantics — it reverts at transaction end, and that is the entire safety property.** `false` or a bare `SET` leaks tenant context to whichever request next receives that pooled connection.

- [ ] **Step 2: Write the gate test**

Seed two towns with data in each, across all 26 RLS-enabled tables. Connect **as `tmm_app`** — not `tmm_owner`, which would prove nothing since owners bypass RLS. Then assert, for every one of the 25 RLS-enabled tables, that reading inside Town A's context returns zero rows belonging to Town B. Derive the table list mechanically rather than hand-copying it, so a table added later cannot be silently omitted.

Add three adversarial cases:

1. A query with **no** tenant context set returns zero rows (fails closed, not open).
2. An `UPDATE` targeting Town B's row from Town A's context affects zero rows.
3. Tenant context does not survive the transaction — run two sequential transactions on the same pooled connection and confirm the second does not inherit the first's `app.town_id`.

- [ ] **Step 3: Run and watch it fail** against a database without FORCE RLS, to prove the test can fail. A gate that cannot fail is not a gate.

- [ ] **Step 4: Apply the baseline, run again, watch it pass.**

- [ ] **Step 5: Add a lint rule banning `set_config` with a `false` third argument**, and a test that the rule fires.

- [ ] **Step 6: Commit.**

---

# Phases C–G — specified, detailed at their boundaries

These are deliberately not written as bite-sized steps yet. Phase C's exact work depends on Better Auth's generated schema; D and E depend on the vertical slice's shape; F1 depends on Task A1's transport decision. Writing code blocks against those unknowns now would be fiction — the same reasoning that proved correct for Stage 0, where the tasks that _were_ fully specified ran cleanly and the ones that could not be were correctly deferred.

Each phase's plan is written when its inputs exist.

| Task                   | Scope                                                                                                                                                                                                                                                                                                                                                                                                             | Gate                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **C1 Better Auth**     | Install ≥1.7.1 + `@better-auth/drizzle-adapter`. **Mandatory hardening:** `emailAndPassword.requireEmailVerification: true` and `organization({ requireEmailVerificationOnInvitation: true })` — these negate GHSA-fmh4-wcc4-5jm3. Same-origin `/api` proxy on the `app.` nginx block, which eliminates CORS, cross-subdomain cookies, and the `trustedOrigins` bypass class entirely. CLI is the `auth` package. | A user can register, verify, sign in, and be invited to a town         |
| **C2 Auth call sites** | Migrate 24 `supabase.auth.*` call sites. Replace `useCurrentUser`'s JWT-claims parsing — the claims hook is gone.                                                                                                                                                                                                                                                                                                 | No `supabase.auth` references remain                                   |
| **D1 tRPC skeleton**   | Router on Fastify, `withTenant` context, and the permission middleware implementing all 21 rules from B2's checklist. Codes not names.                                                                                                                                                                                                                                                                            | Every one of the 21 has a named guard and a test                       |
| **D2 Vertical slice**  | Auth + login + boards, end to end. **The template for everything after.**                                                                                                                                                                                                                                                                                                                                         | Boards works with zero `supabase.from` calls                           |
| **E1 Fan-out**         | Remaining 13 tables, 244 call sites. Parallelizable across subagents once D2 is reviewed.                                                                                                                                                                                                                                                                                                                         | No `supabase.from` in `packages/web`                                   |
| **F1 Realtime**        | Per A1's decision. `LISTEN/NOTIFY` → one dedicated `postgres.js` connection → EventEmitter → per-subscriber generators. Payloads are `{table, id, op}` only (8 KB cap); subscribers refetch through the normal query path. Every event through `tracked()`.                                                                                                                                                       | Two browsers see the same live meeting update                          |
| **F2 Storage**         | Filesystem + nginx `X-Accel-Redirect` for private files: Fastify authorizes against live DB state, nginx serves bytes, Node never touches them. Avoid `secure_link` (not compiled by default, MD5 only).                                                                                                                                                                                                          | Exhibits, seal, and PDFs work; private files 403 without authorization |
| **G1 Auth-by-default** | Routes authenticated unless explicitly marked public. **This is how the six unauthenticated endpoints get fixed — structurally, so the class cannot recur** — along with the `admin-alert.hbs:14` raw triple-stash.                                                                                                                                                                                               | A new route with no marking is denied by default, proven by test       |
| **G2 Decommission**    | Delete `packages/web/src/lib/supabase.ts`, `docker/docker-compose.yml`, the superseded RLS policies, and CI's `.env.example` copy step. Retire `migrate.sh`.                                                                                                                                                                                                                                                      | Zero Supabase references; CI green without the env step                |

---

## Stage 1 exit criteria

- [ ] `./scripts/build-db-from-repo.sh` exits 0 with no shim, seed applied, ≥26 tables
- [ ] The isolation test passes **as `tmm_app`**, covering all 26 RLS-enabled tables plus the three adversarial cases
- [ ] All 26 RLS-enabled tables have `FORCE ROW LEVEL SECURITY`, and `push_subscription`'s exemption or policy is recorded
- [ ] All 14 `SECURITY DEFINER` functions have an explicit `SET search_path`
- [ ] Each of the 21 permission rules has a named guard and a test
- [ ] No `supabase` import remains in `packages/web` or `packages/api`
- [ ] No API route is reachable unauthenticated unless explicitly marked public
- [ ] Feature parity on CI

---

## Owner decisions

**A3 is unblocked.** The remaining four can be answered as their tasks approach.

1. ~~Are notification subscribers `person` or `user_account`?~~ **ANSWERED 2026-08-27: `person`.** What decided it: `user_account.person_id` is `NOT NULL UNIQUE` (a person can exist with no account); `AddPersonDialog` offers a "Directory-only / Staff-account" choice; `people.test.tsx` tests a board member with a seat and no account; and all ~8 notification call sites assume `user_account` while none use `person_id`. Keying to `user_account` would silently drop seated board members from FOAA notices. **This also resolves `board_member.user_account_id` - it links to a person.**

2. **Does `town_id` stay on `notification_delivery`?** Denormalized tenant key (simpler RLS, one predicate) versus joining through `notification_event` (normalized, but every policy needs a join).

3. **Do the TCPA `consent_*` columns survive?** Only the official shape carries them. They are a compliance artifact for the Phase 2 SMS work.

4. **Does any dev data need migrating**, or is the dev database disposable? It is currently the only place the hybrid shape exists.

5. **Do `external_id` and `postmark_message_id` merge?** The dev database has both.
