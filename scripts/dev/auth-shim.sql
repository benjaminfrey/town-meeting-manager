-- ============================================================
-- THROWAWAY DIAGNOSTIC AID — DO NOT APPLY TO A REAL DATABASE.
-- ============================================================
-- Not part of the migration corpus, not run by migrate.sh or
-- build-db-from-repo.sh, and not a fix for the auth.* problem.
--
-- supabase/migrations/*.sql was written against Supabase's GoTrue,
-- which owns an `auth` schema (auth.users, auth.uid(), auth.jwt())
-- and a Storage extension (`storage` schema, storage.buckets,
-- storage.objects). Plain Postgres has neither. This script stubs
-- just enough of both — a bare auth.users table, auth.uid()/auth.jwt()
-- returning NULL/empty, a bare storage.buckets/storage.objects, and
-- the four roles GoTrue/Supabase create (anon, authenticated,
-- service_role, supabase_auth_admin) — so the migration corpus can be
-- applied end-to-end against a scratch database to answer one
-- question: is the corpus itself structurally sound behind the
-- auth.* wall, independent of that wall?
--
-- It deliberately does NOT implement storage.foldername() or any
-- other Storage helper function beyond the two tables — a stub that
-- silently made every storage-dependent migration pass would misrepresent
-- how much of the corpus is proven, which defeats the point of running
-- this at all.
--
-- DANGER, not just inconvenience: auth.uid()/auth.jwt() below use
-- CREATE OR REPLACE with signatures matching GoTrue's real functions.
-- Run this against a live Supabase database — where the connecting
-- role is commonly superuser `postgres` — and it does not error. It
-- SUCCEEDS, silently replacing the real auth.uid()/auth.jwt() with
-- NULL-returning stubs, which makes every RLS policy that depends on
-- them evaluate false. The guard block immediately below is the only
-- thing standing between this file and that outcome — it is not
-- optional and must run first, before any other statement.
--
-- Usage: apply this ONCE against a scratch/throwaway database, before
-- looping supabase/migrations/*.sql, then discard the database AND
-- the four roles it creates (roles are cluster-scoped, not
-- database-scoped — dropping the scratch database does NOT remove
-- them, and leaving them on a shared cluster masks any migration
-- statement that grants to them, e.g. the corpus's
-- `GRANT ... TO authenticated` / `TO supabase_auth_admin` lines, which
-- would otherwise fail on a clean box):
--   createdb scratch_db
--   psql "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -f scripts/dev/auth-shim.sql
--   ... apply supabase/migrations/*.sql ...
--   dropdb scratch_db
--   dropuser anon authenticated service_role supabase_auth_admin
--
-- Run as a superuser (needs CREATE ROLE), never as tmm_owner or
-- tmm_app, and never against town_meeting_manager itself.
-- ============================================================

-- ─── Fail-closed guards — must run first ──────────────────────
-- Refuse to run anywhere auth.uid() already exists (a real Supabase
-- database) or anywhere public already has tables (not an empty
-- scratch database). Either condition aborts the whole script.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'auth' AND p.proname = 'uid') THEN
    RAISE EXCEPTION 'auth.uid() already exists — refusing to run the shim against a real Supabase database';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public') THEN
    RAISE EXCEPTION 'public schema is not empty — scratch databases only';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
  LANGUAGE sql STABLE AS $$ SELECT NULL::UUID $$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB
  LANGUAGE sql STABLE AS $$ SELECT '{}'::JSONB $$;

CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  public BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT,
  name      TEXT
);

DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE supabase_auth_admin; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
