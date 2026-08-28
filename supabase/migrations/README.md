# `supabase/migrations/` is a historical record. Nothing applies it.

**The schema is `packages/api/drizzle/0000_baseline.sql`.** These 59 files are
kept for provenance — to answer "why is the schema shaped like this?" — and are
read by nothing executable.

## Why they were retired

They were written against Supabase, and they depend on things plain PostgreSQL
does not have: GoTrue's `auth` schema (`auth.users`, `auth.uid()`, `auth.jwt()`)
and Storage's `storage` schema. Applied to a plain Postgres database they abort
at file 4 of 59, on
`user_account.auth_user_id REFERENCES auth.users(id)`
(`20260308000004_create_user_account.sql:26`), and 41 of the 59 files fail.

That is not something a new migration could have fixed. A file appended at
position 60 cannot rescue a build that never reached position 5, and the only
file that could rescue it from position 3 would be one creating a fake `auth`
schema — which is the throwaway diagnostic shim Stage 1 deleted.

So Stage 1 (Task B2) squashed them into a single baseline with no `auth.*` or
`storage.*` dependency, with tenancy enforced by `FORCE ROW LEVEL SECURITY`.

## Do not

- **Do not apply these files.** `scripts/build-db-from-repo.sh` and
  `packages/api/src/test/db-harness.ts` both read `packages/api/drizzle/`
  exclusively, and both refuse to run if that directory disagrees with
  `packages/api/drizzle/meta/_journal.json`.
- **Do not edit these files.** They are an append-only record of what happened.
  In particular `20260826000001_merge_notification_system.sql` and
  `20260826000002_merge_invitation_email.sql` are ports whose SHA-256 must stay
  identical to their `docker/migrations` originals.
- **Do not add to these files.** A new migration goes in
  `packages/api/drizzle/`, beside `0000_baseline.sql`, and gets an entry in
  `meta/_journal.json`.

## Where to look instead

| Question | File |
|---|---|
| What is the schema? | `packages/api/drizzle/0000_baseline.sql` |
| What changed between this corpus and the baseline? | `scripts/dev/baseline-transform.sql` (provenance; not runnable) |
| Why is RLS not in `schema.ts`? | the banner at the top of `packages/api/src/db/schema.ts` |
| How do I build a database? | `scripts/build-db-from-repo.sh <postgres-url>` |
