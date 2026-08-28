/**
 * Stage 1, Task B3 — the one place tenant context is established.
 *
 * Every table in `public` is under FORCE ROW LEVEL SECURITY with a single
 * `FOR ALL` policy keyed on `get_current_town_id()`, which reads the
 * `app.town_id` session setting (see `packages/api/drizzle/0000_baseline.sql`
 * § 3). Nothing in the database is readable or writable until that setting is
 * set, so this function is the sole gateway between an authenticated request
 * and its town's data.
 *
 * ─── Why the third argument to set_config MUST be `true` ──────────────────
 *
 *     set_config('app.town_id', $1, true)
 *                                  ^^^^
 *
 * `true` means `is_local` — `SET LOCAL` semantics. The value reverts when the
 * transaction ends, and **that is the entire safety property of this file**.
 *
 * With `false` (or a bare `SET`) the setting is session-scoped. Connections
 * come from a pool and are handed to the next request that asks for one, so a
 * session-scoped `app.town_id` leaks one town's identity into whatever request
 * receives that connection next. In a system holding executive-session
 * minutes, draft records and residents' personal data, that is a cross-tenant
 * disclosure with no error, no log line, and nothing in the code that looks
 * wrong. It fails silently and it fails open.
 *
 * That invariant is enforced three ways rather than trusted:
 *   1. this file, which is the only place the setting is written;
 *   2. `eslint-rules/no-session-scoped-set-config.js`, which makes the
 *      `false` form a lint error anywhere in the repository;
 *   3. `__tests__/tenant-isolation.test.ts`, which runs two sequential
 *      transactions on one pooled connection and asserts the second does not
 *      inherit the first's town.
 *
 * The one legitimate session-scoped use is `supabase/seed.sql`, which runs a
 * whole file as one tenant outside any request. It is SQL, not TypeScript, so
 * the lint rule does not reach it; it carries a comment saying why.
 *
 * ─── Why `db` is a parameter instead of a module-level singleton ──────────
 *
 * Task B3's brief writes `withTenant(ctx, fn)` closing over a module-scope
 * `db`. There is no connection module yet — Task D1 owns creating it, and its
 * shape depends on decisions (pool sizing, the `tmm_app` credential source)
 * that have not been made. Inventing one here would mean D1 either adopting a
 * guess or replacing it. Taking `db` as an argument also lets the gate test
 * drive this exact function against a real database rather than a
 * near-copy of it, which is the difference between testing the shipped code
 * and testing a paraphrase of it. `bindTenantDb` below recovers the brief's
 * two-argument signature in one line once that module exists.
 */

import { sql } from "drizzle-orm";

export interface TenantContext {
  /** The town whose rows this unit of work may touch. */
  readonly townId: string;
}

/** The subset of a Drizzle transaction this module needs. */
export interface TenantTx {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

/** The subset of a Drizzle database this module needs. */
export interface TenantDb<TTx extends TenantTx> {
  transaction<T>(fn: (tx: TTx) => Promise<T>): Promise<T>;
}

// Canonical 8-4-4-4-12 hex form. Deliberately shape-only: this is not
// validating that the town exists (the policy does that by returning nothing),
// it is rejecting the values that would make the policy *silently* match
// nothing at all — see below.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` in a transaction scoped to one town.
 *
 * The tenant setting is established before `fn` runs and reverts when the
 * transaction ends, whether it commits or rolls back.
 */
export async function withTenant<TTx extends TenantTx, T>(
  db: TenantDb<TTx>,
  ctx: TenantContext,
  fn: (tx: TTx) => Promise<T>,
): Promise<T> {
  // `get_current_town_id()` is `nullif(current_setting('app.town_id', true), '')::uuid`.
  // An empty string therefore yields NULL, and `town_id = NULL` is NULL, not
  // false — so every policy matches nothing and every query returns zero rows
  // with no error anywhere. That is indistinguishable from "this town has no
  // data", which is the most confusing failure this code can produce. A
  // non-UUID string fails loudly at the first query instead, but it fails deep
  // inside Postgres with a message that names neither this function nor the
  // caller. Both are cheaper to diagnose here.
  if (!UUID_RE.test(ctx.townId)) {
    throw new Error(
      `withTenant: townId must be a UUID, received ${JSON.stringify(ctx.townId)}. ` +
        "An empty or malformed value would set app.town_id to something " +
        "get_current_town_id() resolves to NULL, silently making every query " +
        "return zero rows.",
    );
  }

  return db.transaction(async (tx) => {
    // The `true` is load-bearing. See this file's header before changing it.
    await tx.execute(sql`select set_config('app.town_id', ${ctx.townId}, true)`);
    return fn(tx);
  });
}

/**
 * Partially apply `withTenant` to a database handle, recovering the
 * `(ctx, fn)` signature Task D1's request context will want.
 */
export function bindTenantDb<TTx extends TenantTx>(db: TenantDb<TTx>) {
  return <T>(ctx: TenantContext, fn: (tx: TTx) => Promise<T>): Promise<T> =>
    withTenant(db, ctx, fn);
}
