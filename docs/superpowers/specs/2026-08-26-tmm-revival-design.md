# Town Meeting Manager — Revival Design

**Date:** 2026-08-26
**Status:** Approved — supersedes `docs/workflow/`
**Inputs:** [Revival Audit](../../audit/2026-08-25-revival-audit.md) (10 dimensions, adversarially verified) · stack research (2026-08-25) · owner interview (16 decisions)

---

## 1. Context

Town Meeting Manager is a multi-tenant SaaS for small Maine town governments, covering the meeting
lifecycle: onboarding, boards and people, agenda templates and building, live meeting operation,
minutes generation and approval, a public portal on per-town subdomains, and email notification.

The project has been dormant since 2026-06-22. Roughly 68,800 LOC across 381 TypeScript files,
26 domain tables, 58 SQL migrations. Phase 1 of the prior plan was recorded as 37/37 complete.

Two things happened during the dormancy that force a re-plan rather than a resumption:

1. **The development environment is gone.** Docker is no longer installed on the development
   machine. Work now targets a VM on the production server (2 vCPU, 4 GB RAM, ample disk),
   serving as dev/staging.
2. **A full audit found the product is not where the plan says it is.** The staff-facing core is
   real and good. Almost everything around it is broken or unverified.

### What the audit found

| Dimension                  | Score /100 |
| -------------------------- | ---------- |
| Security, auth & RBAC      | 18         |
| API, documents & email     | 20         |
| Testing & CI               | 26         |
| Deployment & observability | 27         |
| Data model & schema drift  | 30         |
| Product completeness       | 31         |
| Architecture & code health | 38         |
| Plan-vs-reality drift      | 38         |
| Frontend & accessibility   | 42         |
| Dependencies & tooling     | 55         |

The governing finding: **415 tests pass with approximately zero route coverage, against Supabase
mocks whose `.eq()` is an identity function.** There is no CI and no linter. The green build is not
evidence of anything. Every structural decision below is shaped by that.

### What is genuinely good and must be preserved

- The **live meeting flow** works end to end: attendance, quorum, agenda navigation, motions,
  roll-call votes, executive session, recusal, adjournment.
- **`packages/shared`** is a real contract layer, not a dumping ground.
- The **Maine notice-rules engine** (`packages/shared/src/notice-rules/`) is honest, pure, and
  tested — the most defensible differentiator in the product.
- The **relational model** is shaped correctly for public records.
- The **UI overhaul** (single `AppShell`, role-aware home, meeting sub-nav, tokenized portal) is
  coherent and recent.

---

## 2. Goal and scope

**Goal:** finish the product as originally envisioned — all of the prior Phase 2 and Phase 3 — on a
foundation that can actually carry it.

**In scope.** All six Phase 2 blocks, no cuts: AI minutes, audio + transcription, warrant articles,
SMS, resident accounts + straw polls, React Native mobile. Then Phase 3: parcels, proximity
matching, postal mail, consortiums, zoning. Ahead of all of it: a platform migration off Supabase,
and repair of what the audit found.

**Out of scope.** Billing, self-serve signup, and commercial tenant provisioning — the goal is
feature completeness, not a commercial launch. Accessibility conformance is deliberately deferred
(§4.11). No pilot town is being courted, so nothing is sequenced around a pilot date.

**Working mode.** Mostly autonomous. Pre-authorized without asking: committing and pushing to
feature branches, adding dependencies, authoring and applying migrations, refactoring code in the
path of the work, and spending on API calls. Merges to `main` come back for review. Review happens
at stage boundaries, not per step.

---

## 3. The architectural pivot: drop Supabase, keep Postgres

Self-hosted Supabase is eight containers — Kong, GoTrue, PostgREST, Realtime, Storage, imgproxy,
postgres-meta, Studio. On a 2 vCPU / 4 GB VM that leaves almost nothing for Postgres _and_
Puppeteer, which wants 300–500 MB per Chromium instance. Postgres plus one Fastify process is the
shape that fits the hardware. The overhead motivation and the hardware agree.

### Target architecture

```
Browser   React 19 SPA · React Router v7 · TanStack Query v5
    │
    │   same-origin /api/*   — nginx proxies on the app. server block,
    ▼                          exactly as the per-town portal block already does
nginx ─┬─ /api/auth/*  →  Better Auth handler
       ├─ /api/trpc/*  →  tRPC router (SSE subscriptions)
       ├─ /api/*       →  Fastify REST (Postmark webhooks, public portal, documents)
       └─ /files/*     →  internal location — reachable ONLY via X-Accel-Redirect
    ▼
Fastify 5
    ├─ tRPC procedures → permission middleware (TypeScript) → withTenant() transaction
    ├─ Drizzle → pg.Pool → PostgreSQL   [FORCE RLS · dedicated non-owner app role]
    ├─ postgres.js .listen() → LISTEN/NOTIFY → EventEmitter → SSE async generators
    ├─ Puppeteer (concurrency 1) → PDF → filesystem
    └─ Postmark → email
```

The web app keeps React 19, React Router v7 in SPA mode, TanStack Query v5, Tailwind v4 and
shadcn/ui. tRPC integrates natively with TanStack Query, so the client-side data-fetching model
does not change shape — only its transport.

### Migration surface, measured

| Surface                                        | Extent                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `supabase.from()` call sites in `packages/web` | **244**, across 93 files, 14 distinct tables                        |
| `supabase.auth.*` call sites                   | 24                                                                  |
| Realtime call sites                            | 6                                                                   |
| PostgREST RPC calls                            | 2                                                                   |
| RLS policies                                   | 83 across 25 tables (26 tables total; `push_subscription` has none) |
| `SECURITY DEFINER` functions                   | 14                                                                  |
| Existing Fastify routes                        | 36                                                                  |
| Storage in use                                 | town seal, exhibit uploads, generated PDFs                          |

For calibration: this is comparable in scale to the PowerSync → TanStack Query migration already
completed in this repo (sessions M.01–M.11, eleven sessions).

---

## 4. Decisions

Each decision below becomes an ADR in `docs/advisory-resolutions/` during Stage 0.

### 4.1 Data layer — tRPC mounted on Fastify

Replaces PostgREST. End-to-end typed with no codegen step; the Zod schemas already in
`packages/shared` become load-bearing validation instead of documentation. The existing Fastify
server stays as the host, keeping Puppeteer, Postmark and webhook routes untouched. Plain REST
remains for webhooks and the public portal, which have non-tRPC consumers.

`@trpc/server` and `@trpc/client` **11.18.0**.

### 4.2 Authorization — split model

**RLS enforces tenancy only.** One mechanical `town_id` policy per table. A bug can then never leak
Town A's records to Town B, which is the unrecoverable failure for a records system.

**The 30-action permission matrix moves into TypeScript**, where it can be read, unit-tested, and
reasoned about. Today it is spread across three partial implementations and does not work.

This replaces 83 subtle policies with roughly 26 trivial ones plus tested application code.

#### 4.2.1 The RLS bypass that must be closed in the baseline

PostgreSQL: _"Table owners normally bypass row security."_ Under Supabase this never surfaced,
because PostgREST connects as `authenticator` and `SET ROLE`s to `authenticated` — a non-owner, so
policies applied. The moment a single Drizzle connection owns the tables (which it will, if it runs
the migrations), **every policy silently becomes a no-op.** No error, no warning, total cross-tenant
exposure.

Repository state confirmed by direct inspection: **83 `CREATE POLICY`, 25 `ENABLE ROW LEVEL
SECURITY`, and zero `FORCE ROW LEVEL SECURITY`.**

Three mandatory, non-negotiable mitigations, all landing in the baseline migration:

1. A dedicated **non-owner** application role holding only `SELECT/INSERT/UPDATE/DELETE` grants.
   Migrations run as the owner; the application never does.
2. `ALTER TABLE … FORCE ROW LEVEL SECURITY` on all 25 RLS-enabled tables.
3. A test asserting that cross-tenant reads return zero rows **while connected as the application
   role**. Without that test there is no evidence RLS works at all.

#### 4.2.2 The rewrite is small, because the policies funnel through helpers

Policies call helper functions rather than inlining `auth.jwt()`. Verified reference counts:

| Helper                    | References |
| ------------------------- | ---------- |
| `get_current_town_id()`   | 69         |
| `is_admin()`              | 29         |
| `has_permission()`        | 24         |
| `get_current_role()`      | 9          |
| `get_current_person_id()` | 8          |

Rewriting roughly five helper bodies to read `current_setting('app.town_id', true)` instead of
`auth.jwt()` keeps all 69 call sites working untouched. Only six migration files contain inline
`auth.*`. This turns the most frightening part of the migration into approximately 100 lines of SQL.

#### 4.2.3 The 21 permission call sites are the middleware specification

`has_permission()` appears 24 times: one definition, one doc comment, and **21 real calls inside RLS
policies**, spread across three files:

- `20260308000033_rls_agenda_motion_vote.sql` — codes A2, M2, M3
- `20260308000034_rls_minutes_exhibit.sql` — codes R1, R4, A3
- `20260308000035_rls_notification.sql` — code C2

Under the split model these are **removed** from RLS, not rewritten. Each underlying rule must
reappear as a tRPC procedure guard. The plan therefore carries a checklist mapping each of the 21 to
its replacement guard and its test. Nothing may be dropped silently.

Note the live defect this replaces: RLS looks permissions up by action **code** (`R1`, `M3`) while
the application writes them by action **name** (`edit_agenda`). `seed.sql:92` seeds by code —
standardize there.

#### 4.2.4 Per-request tenant context

```ts
async function withTenant<T>(ctx, fn: (tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.town_id', ${ctx.townId}, true)`);
    return fn(tx);
  });
}
```

The third argument `true` means `SET LOCAL` — it reverts at transaction end. **That is the entire
safety property.** `set_config(…, false)` or a bare `SET` leaks tenant context to whichever request
next receives that pooled connection. This gets a lint rule, not a comment.

No PgBouncer: on a single VM it adds nothing, and its transaction mode silently breaks
`LISTEN/NOTIFY` and session advisory locks.

### 4.3 Database access — Drizzle ORM

`drizzle-kit pull` introspects the existing database and generates the TypeScript schema, so 26
tables are not hand-written. `drizzle-zod` then derives Zod schemas from that single source, which
**structurally eliminates** the SQL ↔ types ↔ Zod drift the audit found, rather than fixing today's
instance of it. Postgres-native throughout: JSONB, full-text search for the portal, and PostGIS for
Stage 5 parcels.

**Pin `drizzle-orm` at 0.45.2 or above — this is a security floor, not a preference.** Versions
below it carry a CVSS 7.5 SQL injection (GHSA-gpj5-g38j-94v9) via improperly escaped identifiers.

Stay on stable **0.45.2** with **drizzle-zod 0.8.3**. Do not adopt the v1.0.0 release candidate
mid-migration; the documentation site currently documents the RC's `drizzle-orm/zod` subpath, which
does not exist in 0.45.2. Debugging our own migration and a release candidate simultaneously is a
bad trade.

Drizzle's `pgPolicy`, `.link()` and `.enableRLS()` are usable. `crudPolicy` is Neon-only. There is
no generic `.rls()` runtime wrapper, so `withTenant()` is ours to own. All `drizzle-orm/supabase`
imports get deleted.

### 4.4 Authentication — Better Auth

Dropping GoTrue does not mean hand-writing password hashing and session rotation. Auth is the worst
place in any codebase to be original, and the alternatives are worse:

- **Lucia** — dead. Last publish 2024-10-20, npm deprecation flag set.
- **Auth.js / NextAuth** — nearly three years in beta with no stable v5; `@auth/fastify` was never
  published; JWT-only sessions mean no server-side revocation, which is disqualifying for public
  records.
- **OpenAuth** — abandoned; tokens in `localStorage`.
- **oslo / hand-roll** — most `@oslojs/*` packages were deprecated 2026-07-29 and the Copenhagen
  Book is archived. Hashing is the easy 5%; sessions, CSRF, invite-token tenant binding, TOTP
  recovery, lockout and revocation are the other 95%, with no upstream to issue CVEs.
- **Ory Kratos** — multi-tenancy and cross-TLD cookies are Enterprise-gated.
- **Keycloak** — the genuine alternative, but 1.5–2 GB RAM on a 4 GB box, and every login screen is
  a FreeMarker theme, so the designed municipal UI would stop at the auth boundary.
- **SuperTokens** — `MULTI_TENANCY` and `MFA` are both enterprise-gated.

**Better Auth 1.7.1** with **`@better-auth/drizzle-adapter` 1.7.1**. Framework-agnostic in fact
(React/Vue/Svelte/Next are all optional peers), Postgres-native via Drizzle, and it ships
organizations, invitations and 2FA with no license gate. It depends on `zod@^4.3.6`, an exact match
for this repo. The CLI now lives in the **`auth`** package (`npx auth@latest generate`) — the old
`@better-auth/cli` is stale, and older tutorials will mislead.

**Required hardening.** Better Auth carries a real advisory history, all patched at or before 1.7.1.
Two settings are mandatory, taken directly from the invitation advisory's own "am I affected"
criteria:

```ts
emailAndPassword: { enabled: true, requireEmailVerification: true },
organization({ requireEmailVerificationOnInvitation: true })
```

Enable only the plugins actually used, and treat tracking the GHSA feed as a standing operational
requirement.

**Topology: same-origin `/api`.** The per-town portal nginx block already proxies `location /api/` to
the API upstream. Doing the same on the `app.` block yields same-origin auth — no CORS, no
cross-subdomain cookie configuration, and the `trustedOrigins` bypass class of vulnerability cannot
exist. It also avoids a cookie scoped to `.townmeetingmanager.com` being transmitted to every town's
portal subdomain.

### 4.5 Realtime — tRPC SSE over LISTEN/NOTIFY

The live meeting is a broadcast: one clerk writes, everyone else observes. That is precisely SSE's
shape, and tRPC's own guidance recommends SSE unless a WebSocket server is otherwise needed.

`httpSubscriptionLink` is **stable**, de-`unstable_`d in tRPC PR #6617 (2025-03-21).

**Every event goes through `tracked()`.** The client sends `lastEventId` on reconnect and resumes
from it. A three-second network blip during a meeting must not silently swallow a motion or a vote.

**Fan-out is `LISTEN/NOTIFY`** — not Redis, not logical replication. Redis means a second datastore
to deploy, monitor and back up in order to move messages between parts of one process. Logical
replication is the right answer when zero loss is the requirement; here the events are already
durable in Postgres and the notification is a cache-invalidation hint. `LISTEN/NOTIFY` uniquely
provides **transactional delivery**: notifications are not delivered unless the transaction commits,
so a vote is never announced before it is durable.

Design constraints that follow:

- **8 KB payload cap.** Never send the row. Send `{table, id, op}` and let subscribers refetch
  through the normal tRPC query path — which also keeps authorization in exactly one place.
- **Identical payloads collapse** within a transaction; include a discriminator when N distinct
  events are required.
- **`LISTEN` is per-session state**, so it cannot use a pooled connection. Use `postgres.js` 3.4.9
  for the single dedicated listener — it opens a dedicated connection and reconnects with backoff —
  and `pg` 8.23.0 `Pool` for normal queries. Use the `onlisten` callback to re-sync after a
  reconnect, because notifications sent while disconnected are gone permanently. (`pg-listen` was
  last released in 2020; avoid it.)
- One process-wide listener feeds an in-process `EventEmitter`, which feeds per-subscriber async
  generators. Wire it this way from the start: if the deployment ever grows past one Node process,
  `LISTEN/NOTIFY` is what makes it survive.

nginx requires explicit configuration or SSE will appear to hang:

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

Pair with `sse.ping.intervalMs` so intermediaries do not reap idle streams, and confirm HTTP/2 is
enabled — that removes the browser's ~6-connection-per-origin limit.

**Known risk.** tRPC's Fastify adapter documents WebSockets only; SSE on that adapter is undocumented
and has no public example. The mechanism was verified from adapter source — it delegates to the
shared `resolveResponse`, which is adapter-independent, and Fastify 5 streams `ReadableStream`
bodies — but the integration is unproven in public. **This is spiked on day one of Stage 1.**
WebSockets is the documented fallback and, because both sit behind `splitLink`, switching is roughly
a ten-line client change.

### 4.6 File storage — filesystem behind nginx

Chosen for **custody**: every public record stays on hardware the town's operator controls. This was
weighed against Cloudflare R2 (~$0.60/month with free unmetered egress, and it would remove the
single point of failure where one VM holds the app, the database and the only copy of every town's
minutes) and decided in favour of custody, since Maine public-records law may care where the bytes
live.

MinIO is not a candidate: the repository was **archived read-only on 2026-04-25**, its final
community release was itself a CVE fix, and the next vulnerability will never be patched.

Private files are served with **`X-Accel-Redirect`**: Fastify authorizes against live database
state, returns an empty body carrying the header, and nginx serves the bytes from an `internal`
location. Authorization is therefore per-request — instant revocation, no leakable token — and Node
never touches the payload. `nginx secure_link` is explicitly rejected: not compiled in by default,
and MD5 only.

The trade accepted: durability, bandwidth and backup discipline are ours. Stage 2 must therefore
back up the file tree, not only the database.

### 4.7 Migrations — squash to a baseline

The 58 existing migrations will not be replayed. They reference `auth.jwt()`, `auth.uid()` and
GoTrue-owned schemas that will not exist, so replaying them on a fresh database simply fails.

There is also a live defect to resolve first: **two migration corpora exist.**
`supabase/migrations/` holds 56 files and `docker/migrations/` holds two
(`011_notification_system.sql`, `012_invitation_email.sql`), and
[`infrastructure/scripts/migrate.sh:23`](../../../infrastructure/scripts/migrate.sh) iterates
`supabase/migrations/*.sql` **only**. Those two files have never been applied by any deploy script,
which is why the audit believed the `invitation` table and the notification retry columns had no SQL
source at all. They do. The schema is not lost — it is split, and half of it is unreachable by
tooling.

Baseline procedure:

1. `drizzle-kit pull` against a consolidated database → `schema.ts`, `relations.ts`, `meta/`
   snapshot. The snapshot is what makes future `generate` diffs correct.
2. **Hand-review the pulled schema.** Non-negotiable: check enums, generated columns, partial
   indexes, the `tsvector` search columns and triggers, and especially RLS policies. `pull` fidelity
   for policies and CHECK constraints is unverified and has open upstream bugs — diff against the
   live database before trusting it.
3. Fold the auth rewrite into the baseline: helper bodies reading `current_setting('app.*', true)`,
   the six files with inline `auth.*`, `FORCE ROW LEVEL SECURITY` on all 25 tables, and the
   dedicated non-owner application role.
4. Baseline by inserting **one row** into `drizzle.__drizzle_migrations`. Drizzle's migrator reads
   only the newest `created_at` — it is a high-water mark, not a per-migration ledger — so a single
   insert marks the baseline applied without running it.
5. Keep `supabase/migrations/` in git as historical record; stop adding to it.
6. Thereafter: `generate` → review the SQL → commit → `migrate`. Never `push` against a real
   database.

Two consequences of the migrator's design to respect: **all pending migrations run in one
transaction**, so `CREATE INDEX CONCURRENTLY` and other non-transactional DDL cannot live in a
Drizzle migration; and **applied hashes are never re-checked**, so editing an applied file goes
undetected and append-only must be enforced in review.

In production, use the runtime migrator (`drizzle-orm/node-postgres/migrator`) in a short-lived
one-shot container before the API starts, connecting as the owner role. That avoids shipping
`drizzle-kit` and a TypeScript toolchain in the production image, and avoids N replicas racing.
`pg_dump` immediately before migrating; rollback is restore, since Drizzle has no down-migrations.
Retire `migrate.sh`'s `schema_migrations` table once Drizzle owns migrations, or there will be two
sources of truth.

### 4.8 Meeting operation — assigned per meeting

An **operator** and a **recording secretary** are assigned on the meeting record itself.
`board_member.is_default_rec_sec` already anticipates this design and supplies the default. A
fallback rule applies when nobody is assigned.

This replaces the current behaviour, where only `role='admin'` can open the live meeting screen —
which locks the Town Clerk, the one person whose job this is, out of it entirely.

### 4.9 Records immutability

Once a board votes to adopt, minutes content becomes **immutable at the database level**, not merely
disabled in the UI. `minutes_addendum` is the only sanctioned correction path. Votes and attendance
freeze at adjournment. Metadata operations — publishing, exporting — remain permitted.

This is cheap to establish now and expensive once towns have adopted records.

### 4.10 FOAA notice compliance — a supported product claim

The compliance engine stays and the loop gets closed: a real publish-to-portal flow, removal of the
manual Kanban status shortcut that currently bypasses it, collapse of the duplicate timestamp
columns, and completion of the notice PDF with seal, agenda, ADA contact, statutory citation and
posting locations.

### 4.11 Accessibility — deliberate, documented deferral

The DOJ ADA Title II web rule binds towns for their public-facing content, which is the portal
hosted here. The decision is to **carry this exposure knowingly** and record it plainly rather than
block feature work. It is documented in the audit and repeated here so it is never a surprise. If a
town is ever onboarded commercially, this converts to a launch blocker and likely requires a VPAT.

---

## 5. Stages

Each stage ends at a review gate. Stage 1 fans out across parallel subagents once its vertical slice
is proven.

### Stage 0 — Ground

Nothing can be built or verified until an environment exists, and nothing should be migrated before
regressions can be caught.

- Provision the VM: PostgreSQL, Node, nginx. Dev/staging environment, reachable from the development
  machine.
- **Tooling floor: ESLint, Prettier, and CI.** CI runs typecheck, lint, build and test on every
  push. This precedes the migration deliberately — the audit's governing finding is that a green
  build proved nothing, and that must stop being true before 244 call sites move.
- **Consolidate the two migration corpora** into one authoritative schema, resolving the
  `docker/migrations/` orphans and the known drift.
- Fix the `generated_by: "ai"` mislabel at
  [`routes/minutes.ts:221`](../../../packages/api/src/routes/minutes.ts) and `:394` — two lines,
  not one, and not in `minutes-assembler.ts` where prior project notes placed it. Minutes are
  assembled deterministically from database rows through Handlebars; nothing about them is AI.
  Every day the flag stays wrong adds mislabeled public records that a later backfill must correct.

**Gate:** CI is green on a clean clone, and a database can be built from the repository alone.

### Stage 1 — Platform

- Drizzle baseline per §4.7, including the non-owner role, `FORCE ROW LEVEL SECURITY`, and rewritten
  helpers.
- Better Auth with the §4.4 hardening and same-origin `/api`; migrate the 24 auth call sites.
- **Day-one SSE spike** (§4.5) before any dependency on the transport.
- tRPC skeleton and the **vertical slice**: authentication, login, and the boards screen, end to end
  through tRPC, Drizzle, RLS tenancy and the new session layer. This slice proves every assumption
  cheaply and becomes the template.
- **Fan out** the remaining 13 tables and 244 call sites across parallel subagents.
- Realtime: SSE subscriptions and `LISTEN/NOTIFY`; migrate the live meeting.
- Storage: filesystem plus `X-Accel-Redirect`; migrate exhibits, town seal and generated PDFs.
- **Permission middleware** from the 21-rule checklist (§4.2.3), plus per-meeting operator
  assignment (§4.8).
- **Auth-by-default route policy.** Routes are authenticated unless explicitly marked public. This
  is how the six unauthenticated endpoints get fixed — structurally, so the class cannot recur —
  along with the raw triple-stash template injection in `admin-alert.hbs:14`.
- Decommission Supabase: delete the client, the compose file, and the superseded RLS policies.

**Gate:** a test proves cross-tenant reads return zero rows while connected as the application role.
Feature parity with today, on CI.

### Stage 2 — Repair

The blockers the rebuild does not touch. These precede new features.

- **Portal switch-on.** `town.subdomain` is never written by any code path, so the portal can never
  match a town; and `portal.ts` queries seven nonexistent columns and buckets while discarding
  errors, so it would render empty if it could be reached.
- **Notification recipients.** `notification-service.ts:48` selects `board_member.user_account_id`,
  a column that does not exist, and discards the error — board-scoped notifications resolve to zero
  recipients today, silently.
- **Backups.** `backup.sh` runs two `pg_dump`s and never touches the file tree, so no generated PDF
  is backed up at all; `restore.sh` only runs `pg_restore`. Add file backup, add WAL archiving for
  PITR, encrypt, move off-host, and **test the restore** — an untested restore for municipal public
  records is not a backup.
- **Observability.** Nothing can currently page a human; the documented health-check cron redirects
  both streams to a file, suppressing cron's only alerting channel. Add structured logging with
  request IDs, error tracking, an uptime probe, and real alerting.
- **Test floor.** Route tests, replacement of the identity-function Supabase mocks (moot for
  migrated code, but the pattern must not survive), and a revived e2e suite.

**Gate:** portal renders a real town end to end; a restore is demonstrated from backup; an induced
failure produces an alert.

### Stage 3 — Record integrity

- Database-level minutes immutability with the addendum-only correction path (§4.9).
- FOAA publish loop, removal of the Kanban shortcut, timestamp-column collapse, and notice PDF
  completion (§4.10).

**Gate:** an adopted minutes record cannot be altered by any application path, demonstrated by test.

### Stage 4 — Vision

The original Phase 2, built only on the new stack.

- **AI minutes.** Render `operator_notes` first. The clerk's live notes _are_ assembled —
  [`minutes-assembler.ts:565`](../../../packages/api/src/services/minutes-assembler.ts) passes them
  through — but `templates/minutes.hbs` never renders them, so they reach the document pipeline and
  vanish. That is a small fix with immediate value, and it also supplies the only narrative input
  the enrichment stage would otherwise lack: today there is no transcript and no audio. Then add the
  Claude enrichment stage at the existing assembler seam, with a deterministic fallback path.
- Audio recording and transcription.
- Warrant articles.
- SMS with TCPA compliance.
- Resident accounts and straw polls.
- React Native mobile (`packages/mobile` is currently an empty scaffold).

### Stage 5 — Scale

The original Phase 3: parcel data import, parcel display and agenda linking, proximity matching,
postal mail, multi-town consortiums, advanced zoning.

---

## 6. Risks and open items

| Risk                                                                   | Handling                                                                                                                                                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **tRPC SSE on the Fastify adapter is undocumented**                    | Day-one spike in Stage 1. WebSockets is the documented fallback, ~10 lines behind `splitLink`.                                                                                  |
| **`drizzle-kit pull` fidelity for RLS policies and CHECK constraints** | Open upstream bugs. Diff the pulled schema against the live database before trusting it; hand-write anything missed into the baseline.                                          |
| **`drizzle-kit` may drop the new application role**                    | Set `entities.roles` exclude in `drizzle.config.ts`.                                                                                                                            |
| **drizzle-zod + Zod 4 type-level friction**                            | Known: `z.coerce` infers `unknown`; `.omit()`/`.pick()` produce `'true' is not assignable to 'never'`. Runtime is unaffected. Budget time; do not adopt the v1 RC to escape it. |
| **drizzle-orm v1.0.0 timing unknown**                                  | Plan on 0.45.2. Revisit only after the migration is complete.                                                                                                                   |
| **Better Auth advisory volume**                                        | All known advisories patched at ≤1.7.1. Apply the §4.4 hardening, enable only used plugins, track the GHSA feed.                                                                |
| **Migrating 244 call sites risks silent behaviour change**             | The vertical slice establishes the template first; CI exists before the fan-out; the 21-rule checklist prevents dropped authorization.                                          |
| **4 GB RAM ceiling**                                                   | Puppeteer pinned to concurrency 1. Dropping eight Supabase containers is what makes the budget work; do not reintroduce a service without re-measuring.                         |

---

## 7. Success criteria

1. A working database is reproducible from the repository alone, on a clean machine.
2. CI runs typecheck, lint, build and test on every push, and its green is meaningful — route
   coverage exists and mocks cannot pass a wrong query.
3. A cross-tenant read returns zero rows while connected as the application role, proven by test.
4. Every one of the 21 permission rules has a named replacement guard and a test.
5. No API route is reachable unauthenticated unless explicitly and deliberately marked public.
6. A town's portal can be switched on and renders real agendas, notices and adopted minutes.
7. A restore from backup is demonstrated, including generated PDFs.
8. An induced failure pages a human.
9. Adopted minutes cannot be altered by any application path.
10. All six Phase 2 blocks and all of Phase 3 ship on the new stack.

---

## 8. Supersession

This design supersedes `docs/workflow/` (56 session files across three phases), which moves to
`docs/archive/` as historical record. `docs/advisory-resolutions/` is retained, and the decisions in
§4 are added to it as new ADRs during Stage 0. The `README.md` and the spec `.docx` still describe
the application as offline-first, which has not been true since the PowerSync removal; that is
corrected in Stage 0.
