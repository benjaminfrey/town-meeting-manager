/**
 * Stage 1, Task D1c — how a background job carries its tenant.
 *
 * ─── The problem ──────────────────────────────────────────────────────────
 *
 * `db/with-tenant.ts` assumes a request: something arrived, it carried a
 * session, the session resolved to a town. Background work has none of those.
 * The notification pipeline runs from a `setInterval` and from `setImmediate`
 * callbacks that outlive the request that queued them; there is no session to
 * resolve and nobody to refuse.
 *
 * Before this task that difference was resolved the easy way — background code
 * took the SERVICE-ROLE Supabase client, which bypasses row level security, so
 * every job read every town and the only thing keeping a job inside one town
 * was whether the developer remembered to write `.eq("town_id", townId)` on
 * each query. `services/notification-service.ts` had eleven such queries and
 * three of them had no town filter at all.
 *
 * ─── The rule ─────────────────────────────────────────────────────────────
 *
 * The tenant is a property of the JOB, not of a caller, so it is a
 * CONSTRUCTOR ARGUMENT and there is no default. A `TenantJob` carries a town
 * and a `run` that opens a transaction with `app.town_id` set — and it carries
 * NOTHING ELSE. There is no raw handle on it, no escape hatch, and no
 * ambient module-level database anywhere in this directory, so "which town is
 * this job for" cannot be left unanswered: it is answered at the point the job
 * is constructed or the job does not exist.
 *
 * ─── Why construction is where it fails ───────────────────────────────────
 *
 * `withTenant` already refuses a malformed town id, but only at the moment a
 * transaction is opened. A job constructed with no tenant that then takes a
 * branch which happens not to query would run to completion reporting success
 * — a job that "forgot its tenant" and looked fine. `tenantJob()` therefore
 * validates eagerly, so the failure lands where the mistake is: at the line
 * that built the job, in the stack of whatever scheduled it, before any work
 * is attributed to a town nobody named.
 *
 * ─── Why there is no `allTowns()` ─────────────────────────────────────────
 *
 * Some work genuinely spans towns — the retry sweep is the example. That is
 * expressed as `listJobTenants()` returning a roster, and the caller looping,
 * one `TenantJob` per town. It is deliberately not a "no tenant" mode: a loop
 * of single-town units is auditable, resumable, and cannot accidentally join
 * two towns' rows in one query. A single unscoped sweep is one forgotten
 * `WHERE` away from being a cross-tenant read, and there would be nothing in
 * the type to notice.
 */

import { sql } from "drizzle-orm";
import { withTenant, type TenantDb, type TenantTx } from "../db/with-tenant.js";
import { toRows } from "../db/rows.js";

/** The database surface a job factory needs. */
export interface JobDb extends TenantDb<TenantTx> {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

/**
 * A unit of background work bound to exactly one town.
 *
 * This is the ONLY thing a job is given. It has no raw database handle,
 * because a job that could obtain one could read across towns, and then the
 * guarantee would be a convention rather than a type.
 */
export interface TenantJob {
  /** The town every query this job makes is scoped to. */
  readonly townId: string;
  /**
   * Run one unit of work in a transaction with `app.town_id` set.
   *
   * Per unit of work, not per job: a job that sends fifty emails must not hold
   * one transaction and one pooled connection open across fifty network calls
   * to Postmark. Same reasoning as the request path — see `auth/fastify.ts`.
   */
  run<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bind a database handle and a town into a job context.
 *
 * @throws if `townId` is missing or is not a UUID. That is the whole point:
 * a background job that cannot say which town it is for must fail loudly
 * rather than run with an unset `app.town_id`, where `get_current_town_id()`
 * is NULL, every policy matches nothing, and every query returns zero rows
 * with no error — indistinguishable from "this town has no work to do".
 */
export function tenantJob(db: JobDb, townId: string | null | undefined): TenantJob {
  if (typeof townId !== "string" || !UUID_RE.test(townId)) {
    throw new Error(
      `tenantJob: a background job must name its town, received ${JSON.stringify(townId)}. ` +
        "The tenant is a property of the job, not of a caller — there is no session " +
        "here to resolve one from and nobody to refuse the request. Running without " +
        "one would set no app.town_id, which makes every policy match nothing and " +
        "every query return zero rows silently.",
    );
  }

  return {
    townId,
    run: <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(db, { townId }, fn),
  };
}

interface TenantRosterRow {
  town_id: string;
}

/**
 * The towns a cross-town sweep should visit, one at a time.
 *
 * Read from `better_auth.user_tenant`, which is the only roster of towns
 * reachable without a tenant context — `public.town` is RLS-forced like
 * everything else, so as `tmm_app` it reads as empty until a town is already
 * known, which is circular. `auth/tenant-context.ts` reads the same table for
 * the same reason.
 *
 * What that means precisely, stated rather than assumed: this is the set of
 * towns that have at least one Better Auth identity mapped to them. Every town
 * acquires one at onboarding (`auth/onboarding.ts` writes `user_tenant` in the
 * same transaction that creates the town), so in practice this is every town.
 * A town whose only identity were removed would stop being swept — its pending
 * notifications would sit unprocessed rather than being sent to the wrong
 * people, which is the right way round for this to fail.
 */
export async function listJobTenants(db: JobDb): Promise<string[]> {
  const rows = toRows<TenantRosterRow>(
    await db.execute(sql`SELECT DISTINCT town_id FROM better_auth.user_tenant`),
    (message) => new Error(`listJobTenants: ${message}`),
  );
  return rows.map((row) => String(row.town_id));
}
