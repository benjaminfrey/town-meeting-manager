# Stage 1 Phase C — Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Numbering note.** Headings carry both forms — `Task 1 (C1)` — because `scripts/task-brief` matches numeric ids only, while the phase letters carry the dependency meaning. Pass the **number** to the scripts.

**Goal:** Replace Supabase GoTrue with Better Auth, on the same PostgreSQL database, and bridge its session to the `app.town_id` tenant context that Phase B's RLS depends on.

**Architecture:** Better Auth mounted on the existing Fastify server at `/api/auth/*`, using `@better-auth/drizzle-adapter` against the same `pg.Pool`. nginx proxies `/api` on the `app.` host so auth is **same-origin** — no CORS, no cross-subdomain cookies, and the `trustedOrigins` bypass class cannot exist. Every authenticated request resolves session → `person` → `town_id`, and `withTenant()` sets it with `SET LOCAL`.

**Tech Stack:** Better Auth ≥1.7.1 · `@better-auth/drizzle-adapter` 1.7.1 · Fastify 5 · Drizzle 0.45.2 · PostgreSQL 17.11

**Parent plan:** [2026-08-26-stage-1-platform.md](2026-08-26-stage-1-platform.md) — its Global Constraints bind every task here.

---

## Phase C Global Constraints

- **Better Auth ≥ 1.7.1**, with **both** of these set. They are not optional — they negate GHSA-fmh4-wcc4-5jm3 (unauthorized invitation acceptance via unverified email match):
  ```ts
  emailAndPassword: { enabled: true, requireEmailVerification: true },
  organization({ requireEmailVerificationOnInvitation: true })
  ```
- **The CLI is the `auth` package** (`npx auth@latest generate`). The old `@better-auth/cli` is stale at 1.4.21; older tutorials will mislead.
- **Enable only the plugins actually used.** Better Auth's advisory history is concentrated in the OIDC/OAuth _provider_ plugins — which this project does not need. Every known advisory is patched at ≤1.7.1.
- **Same-origin `/api`.** The per-town portal nginx block already proxies `location /api/`; do the same on the `app.` block. This eliminates CORS, cross-subdomain cookie configuration, and the risk of a cookie scoped to `.townmeetingmanager.com` reaching every town's portal subdomain.
- **Tenant context still uses `set_config('app.town_id', <id>, true)`.** The `true` is `SET LOCAL` and is the entire safety property. There is now both a runtime guard (`withTenant`'s UUID check) and an ESLint rule (`eslint-rules/no-session-scoped-set-config.js`) — do not weaken either.
- **Do not weaken any Phase B artifact to make auth work.** If the security model blocks something, that is a finding about the design, not licence to loosen it. Phase B's gate must still pass unchanged.

---

## What Phase B handed forward

| Fact                                  | Detail                                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate passes                           | `./scripts/build-db-from-repo.sh` exits 0 — 27 tables, 27 RLS-enabled, **27 FORCED**                                                                                                                                            |
| Tenancy is proven                     | Isolation tested behaviourally as `tmm_app` across all 27 tables, plus FORCE tested on a non-superuser owner                                                                                                                    |
| `tmm_app` privileges                  | `SELECT, INSERT, UPDATE, DELETE` only — verified no `TRUNCATE`, not superuser, owns nothing                                                                                                                                     |
| Authorization is **absent**           | Phase B removed all 21 action-code rules, ~25 admin gates and 5 self-scoping rules. The DB enforces tenancy and nothing else until D1.                                                                                          |
| `auth_user_id`                        | Column and UNIQUE retained, FK to `auth.users` dropped. Its `COMMENT` names C1 as the decider: retype to Better Auth's id, re-point as a real FK, or drop for a new column.                                                     |
| **`complete_onboarding()` is broken** | It inserts into `town` before any `app.town_id` exists, so it fails under FORCE RLS for a non-superuser owner. **No town can be created through the app.** A working path exists: generate the id → `SET app.town_id` → insert. |
| Call sites                            | **27** `supabase.auth.*`, of which **14 are `getSession()`** — mostly fetching a token to hand to the API                                                                                                                       |

---

## Task order

```
Task 1 (C1) Better Auth + the tenant bridge ──> Task 2 (C2) migrate the 27 call sites
                     │
                     └──> also fixes onboarding, which is currently broken
```

C1 is deliberately large: installing Better Auth without the session→`town_id` bridge would leave the app authenticated but unable to read anything, since every policy needs `app.town_id`. The bridge is what makes auth useful, so it ships together.

**C2 is expected to be much smaller than 27 rewrites.** Under same-origin cookie auth the browser sends credentials automatically, so most `getSession()` calls — which exist only to obtain a token to forward — delete rather than convert. Verify that before assuming it.

---

### Task 1 (C1): Better Auth and the tenant bridge

**Files:**

- Create: `packages/api/src/auth/auth.ts`, `packages/api/src/auth/schema.ts`, `packages/api/src/auth/tenant-context.ts`
- Create: `packages/api/src/auth/__tests__/auth.test.ts`, `packages/api/src/auth/__tests__/tenant-context.test.ts`
- Create: a forward migration under `packages/api/drizzle/`
- Modify: `packages/api/src/server.ts`, `infrastructure/nginx/nginx.conf`

**Interfaces:**

- Produces: `auth` (the Better Auth instance), `resolveTenant(session): Promise<{ townId, personId, userAccountId }>`, and a Fastify preHandler that runs every authenticated request inside `withTenant`. Task 2 and all of Phase D consume these.

- [ ] **Step 1: Decide `auth_user_id`'s fate, and write the decision down first**

Before any code. Read Better Auth's user id type (it generates ids itself; check whether they are UUID or text at 1.7.1 — do not assume). Then choose:

- retype `auth_user_id` to match and make it a real FK to Better Auth's user table, or
- leave it, and add a new column, or
- drop it and key `user_account` to Better Auth's id directly.

~40 TypeScript call sites reference `user_account`. Record the choice and the reasoning in the migration's header comment, and update the `COMMENT ON COLUMN` so it no longer says "C1 owns this."

- [ ] **Step 2: Write the failing test for the tenant bridge**

This is the task's centre of gravity — write it before the auth wiring, because it defines what the wiring must produce. Use the real-Postgres harness:

```ts
import { withTestDb } from "../../test/db-harness.js";

it("resolves a session to exactly one town, and sets it for the transaction", async () => {
  await withTestDb(async (sql) => {
    // seed two towns, each with a person and a linked user_account
    // resolve a session belonging to town A
    // assert the resolved townId is A's, never B's
    // assert that inside withTenant, a query sees A's rows and none of B's
  });
});

it("refuses a session that resolves to no town, rather than defaulting to one", async () => {
  // a user_account with no person, or a person with no town, must throw —
  // never silently fall through to an empty context, which reads as
  // "every policy matches nothing" and looks identical to an empty town
});

it("refuses a session that resolves to more than one town", async () => {
  // must be impossible by schema; assert it, so a future schema change is loud
});
```

The second case is the one that matters most. Phase B established that an empty `app.town_id` makes every policy match nothing **silently** — indistinguishable from a town with no data. The bridge must fail loudly instead.

- [ ] **Step 3: Run them and watch them fail.** Record the errors.

- [ ] **Step 4: Install and configure Better Auth**

```bash
pnpm --filter @town-meeting/api add better-auth @better-auth/drizzle-adapter
```

Configure with the two mandatory hardening settings above. Generate its schema with `npx auth@latest generate` and commit the result as a forward migration — do **not** let Better Auth create tables at runtime, because the corpus must stay the single source of truth that `build-db-from-repo.sh` reproduces.

**Better Auth's tables need RLS decisions too.** They are not tenant-scoped in the same way — a session belongs to a user, not a town. Decide explicitly whether they get RLS, and if not, why that is safe given `tmm_app` can read them. Record it. Then confirm Phase B's `schema-invariants.test.ts` — which asserts every table has RLS and FORCE — either covers them or is deliberately updated with a documented exemption. **Do not simply widen that test to make it pass.**

- [ ] **Step 5: Implement the bridge**

`resolveTenant` maps a Better Auth session to `{ townId, personId, userAccountId }` by joining its user to `user_account` to `person`. Then a Fastify preHandler wraps the request in `withTenant`.

Failure modes to get right: no session (public routes must still work — the portal is unauthenticated), a session resolving to no town (throw), and a session whose `user_account` was deleted mid-session (throw, not silently empty).

- [ ] **Step 6: Run the tests and watch them pass.**

- [ ] **Step 7: Mount on Fastify and make auth same-origin**

Mount Better Auth's handler at `/api/auth/*`. Add the `location /api/` proxy to the `app.` server block in `infrastructure/nginx/nginx.conf`, mirroring the portal block. Register `@fastify/cors` **before** the auth handler if any cross-origin path remains — but the point of same-origin is that it should not.

- [ ] **Step 8: Fix onboarding**

`complete_onboarding()` currently fails under FORCE RLS because it inserts into `town` before any `app.town_id` exists. Implement the working path: generate the town id in application code, `set_config('app.town_id', <id>, true)`, then insert. Prove it with a test that creates a town **as `tmm_app`**, not as a superuser — the superuser path is exactly what hid this breakage.

- [ ] **Step 9: Verify Phase B's gate still passes, unchanged.**

Run the tenant-isolation gate and `schema-invariants`. If either needed modification, that is a finding to report, not a step to quietly complete.

- [ ] **Step 10: Commit.**

---

### Task 2 (C2): Migrate the 27 `supabase.auth.*` call sites

**Files:**

- Modify: `packages/web/src/providers/AuthProvider.tsx` and its tests, `packages/web/src/routes/{login,setup,invite.accept}.tsx`, `packages/web/src/hooks/useCurrentUser.ts`, plus the `getSession()` sites
- Delete: whatever becomes dead

**Interfaces:**

- Consumes: C1's Better Auth instance and same-origin cookie session.
- Produces: zero `supabase.auth.*` references. `useCurrentUser` backed by Better Auth.

- [ ] **Step 1: Categorise all 27 before changing any**

By method: 14 `getSession`, 3 `signInWithPassword`, 2 `signOut`, 2 `getUser`, 2 `auth.admin`, and one each of `signUp`, `resetPasswordForEmail`, `refreshSession`, `onAuthStateChange`.

For each `getSession()` site, determine whether it exists **only** to obtain a token to forward to the API. Those delete outright under same-origin cookies. Record the count that converts versus deletes — if most convert rather than delete, something about the same-origin setup is wrong and worth investigating before proceeding.

- [ ] **Step 2: Rewrite `useCurrentUser`**

It currently parses JWT custom claims that GoTrue's access-token hook produced. That hook is gone. Back it with Better Auth's session instead. **Note the historical bug so it is not reintroduced:** Supabase set `payload.role = "authenticated"`, so the hook filtered against a `VALID_ROLES` set before falling through to `app_metadata.role`. Better Auth has no such collision, but confirm rather than assume.

- [ ] **Step 3: Migrate `AuthProvider`** — `signUp`, `signInWithPassword`, `signOut`, `resetPasswordForEmail`, `onAuthStateChange`.

- [ ] **Step 4: Migrate the remaining sites**, deleting the `getSession()` calls that are now redundant.

- [ ] **Step 5: Handle `auth.admin`** (2 sites). These used the service-role key to act on other users. Under Better Auth this needs an explicit privileged path — do not reach for a bypass. Record what you chose.

- [ ] **Step 6: Prove it.** `grep -rn "supabase\.auth\." packages/web/src packages/api/src` returns nothing. A user can register, verify, sign in, sign out, and reset a password against a real database.

- [ ] **Step 7: Commit.**

---

## Phase C exit criteria

- [ ] Zero `supabase.auth.*` references remain
- [ ] A user can register, verify their email, sign in, sign out, and reset a password
- [ ] Every authenticated request runs inside `withTenant` with the correct `app.town_id`
- [ ] A session resolving to no town **throws**, and never falls through to an empty context
- [ ] A town can be created through the application, as `tmm_app`, under FORCE RLS
- [ ] Better Auth's tables have a recorded RLS decision, and `schema-invariants` reflects it deliberately
- [ ] Phase B's isolation gate passes **unchanged**
- [ ] `./scripts/build-db-from-repo.sh` still exits 0
- [ ] All gates exit 0; CI green on PostgreSQL 17.11

---

## Open questions for the owner

Neither blocks starting C1; both should be answered before C2 finishes.

1. **Email verification is now mandatory** (it is what negates the invitation advisory). Postmark is code-complete but has **three manual setup steps outstanding** — domain DNS with SPF/DKIM/DMARC, the broadcast stream, and the webhook URL. Until those are done, no verification email can actually be delivered, so no new account can complete registration. Do we finish the Postmark setup now, or add a development-only bypass with a loud guard that cannot ship?

2. **Do existing dev accounts matter?** The old GoTrue `auth.users` rows are gone with the Supabase stack. Better Auth will start empty, so every dev login must be recreated. Fine, or do you want a seeded set?
