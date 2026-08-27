#!/usr/bin/env bash
# Build a complete database from the repository alone.
# This is the Stage 0 gate: if this fails, the repo is not the source of truth.
#
# Honesty contract: this script does not swallow errors to reach a green
# exit. `set -euo pipefail` plus `-v ON_ERROR_STOP=1` on every psql call
# means the first migration or seed statement that fails aborts the whole
# script with a non-zero exit and the real psql error on stderr — it never
# limps past a broken statement and reports success on a partial build.
#
# Known limitation as of 2026-08-26 (Stage 0, Task 7): the migration corpus
# still references Supabase GoTrue's `auth` schema (auth.uid(), auth.jwt(),
# a FK to auth.users) and GoTrue-created roles (`authenticated`,
# `supabase_auth_admin`), none of which exist on plain Postgres. Running
# this script today against a clean `town_meeting_manager` database WILL
# fail partway through supabase/migrations/ for that reason — see
# supabase/migrations/20260308000004_create_user_account.sql, the first
# migration that hits it, plus the full inventory in
# .superpowers/sdd/2026-08-26-tmm-revival-master-plan/task-7-report.md.
# That is expected and is NOT this script's bug: Stage 1's Drizzle baseline
# replaces those helpers with current_setting('app.town_id', true), and
# this exact script is what Stage 1 runs afterward to prove the fix.
set -euo pipefail

cd "$(dirname "$0")/.."

DB_URL="${1:?usage: build-db-from-repo.sh <postgres-url>}"

echo "==> Resetting public schema"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "==> Applying migrations in order"
for file in supabase/migrations/*.sql; do
  echo "    $(basename "$file")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$file"
done

echo "==> Applying seed"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql

echo "==> Table count"
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"
