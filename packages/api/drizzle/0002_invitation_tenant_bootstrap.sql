--
-- ============================================================================
-- Stage 1, Task D1c — the invitation-token bootstrap
-- ============================================================================
--
-- ─── The problem this exists to solve ─────────────────────────────────────
--
-- Invitation acceptance runs for someone who has no `person` row, no
-- `user_account`, no session and therefore no town. The town is determined BY
-- THE INVITATION BEING ACCEPTED, not by the caller's identity — so the town
-- has to come out of the token, and the token has to be looked up before any
-- `app.town_id` exists.
--
-- Under FORCE ROW LEVEL SECURITY there is no tenant-scoped way to do that.
-- `public.invitation`'s policy is keyed on `get_current_town_id()`, which is
-- NULL before a tenant is set, so `SELECT ... FROM invitation WHERE token = $1`
-- returns zero rows as `tmm_app` and every row as a superuser. That gap is
-- exactly how this used to be papered over: `routes/invitations.ts` did the
-- lookup through the SERVICE-ROLE Supabase client, which bypasses RLS
-- outright — a general cross-tenant read of every column of every invitation,
-- reachable from a public route.
--
-- ─── Why a SECURITY DEFINER function was NOT the answer ───────────────────
--
-- The obvious fix — a definer function that reads `invitation` and returns
-- only the town — does not work here, for the reason migration 0001 already
-- recorded when it removed the `SECURITY DEFINER` marking from
-- `complete_onboarding`: under FORCE RLS a definer function gains nothing,
-- because FORCE binds the table owner too. Making it work would mean either a
-- BYPASSRLS role or a new permissive policy on `invitation` — and the latter
-- is refused by `db/__tests__/schema-invariants.test.ts`, which allows exactly
-- one non-tenancy policy in `public` and names it.
--
-- ─── What this does instead ───────────────────────────────────────────────
--
-- The same shape Phase C already uses for the one other pre-tenant lookup in
-- this system. `auth/tenant-context.ts` cannot read `user_account` before it
-- knows a town either, so it reads `better_auth.user_tenant` — a hint table in
-- a schema that deliberately has no RLS (see 0001 § 5) — and then VERIFIES the
-- hint inside `withTenant`, where RLS is what actually decides.
--
-- `better_auth.invitation_tenant` is that table for invitation tokens:
--
--     sha256(token) → town_id
--
-- and nothing else. Kept in step with `public.invitation` by a trigger, so it
-- is correct no matter who writes the invitation — including the web client,
-- which still inserts invitations directly and is not migrated until Phase E.
--
-- ─── Four properties, stated so they can be checked ───────────────────────
--
--  1. IT RETURNS A TOWN ID AND NOTHING ELSE. Not the invitation, not the
--     person, not the email, not the status. Everything a route needs beyond
--     the town is read inside `withTenant`, under RLS.
--
--  2. IT CANNOT BE ENUMERATED. The key is a one-way hash of the token, so
--     reading the whole table yields no usable token, and there is no
--     prefix, range or pattern lookup that could turn "which town owns THIS
--     token" into "list the tokens". `SELECT * FROM better_auth.invitation_tenant`
--     is a legal query for `tmm_app` and is worth nothing.
--
--  3. IT CANNOT GRANT ACCESS. It is a hint, exactly like `user_tenant` is a
--     hint. The invitation itself is read as
--     `withTenant(townId) → SELECT ... FROM invitation WHERE token = $1`, so a
--     hint naming the WRONG town produces zero rows and a 404. Corrupting
--     this table cannot disclose another town's invitation; it can only deny
--     service to the token whose row was corrupted.
--
--  4. IT IS FAIL-CLOSED ON ABSENCE. A token with no row resolves to no town,
--     and the route answers 404 without touching the database again.
--
-- Property 3 is the load-bearing one. It is why this table does not need to be
-- protected as though it were a credential store: it holds no credential, and
-- believing it does not widen anything.
--

--
-- ─── The hint table ───────────────────────────────────────────────────────
--
-- `bytea` primary key rather than a text hex digest: equality on 32 raw bytes,
-- with no encoding convention for a caller to get wrong.
--
-- No foreign key to `public.invitation`. The trigger below is what keeps the
-- two in step, and a FK would additionally mean a cross-schema dependency from
-- the auth schema into an RLS-forced table for no benefit — the row this
-- points at is one the reader is not allowed to see yet, which is the whole
-- point.
--

CREATE TABLE better_auth.invitation_tenant (
  token_sha256 bytea PRIMARY KEY,
  town_id uuid NOT NULL
);

COMMENT ON TABLE better_auth.invitation_tenant IS
  'sha256(invitation.token) -> town_id. The pre-tenant hint that lets invitation acceptance open a withTenant transaction for someone who has no town yet. Maintained by a trigger on public.invitation. Holds no credential: the hash is one-way, and a wrong hint yields zero rows under RLS rather than access.';

GRANT SELECT, INSERT, UPDATE, DELETE ON better_auth.invitation_tenant TO tmm_app;

--
-- ─── Keeping it in step ───────────────────────────────────────────────────
--
-- The function lives in `better_auth`, not `public`, for one concrete reason:
-- `db/__tests__/schema-invariants.test.ts` pins `search_path` on every
-- function in `public` and must stay byte-identical. It sets `search_path`
-- anyway — an unqualified name resolved through a caller-controlled
-- `search_path` is how a trigger function gets pointed at someone else's
-- table.
--
-- NOT `SECURITY DEFINER`, for the same reason 0001 § 6 gave: it runs as the
-- caller, `better_auth` has no RLS, and `tmm_app` already holds DML there.
-- Marking it definer would buy nothing and carry an escalation footgun.
--
-- `token` is UNIQUE on `invitation`, so `sha256(token)` is unique too and the
-- ON CONFLICT below can only ever fire on a hash whose invitation was deleted
-- and whose token was then reissued verbatim.
--

CREATE FUNCTION better_auth.sync_invitation_tenant() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'better_auth', 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM better_auth.invitation_tenant
     WHERE token_sha256 = sha256(convert_to(OLD.token, 'UTF8'));
    RETURN OLD;
  END IF;

  -- A reissued token (POST /api/invitations/:id/resend) must not leave the
  -- OLD hash resolving to a town. It would still be harmless — the invitation
  -- read inside withTenant matches on the token itself, and the old token is
  -- gone — but a stale row that can never be reached again is a row that will
  -- eventually be mistaken for a live one by someone reading this table.
  IF TG_OP = 'UPDATE' AND OLD.token IS DISTINCT FROM NEW.token THEN
    DELETE FROM better_auth.invitation_tenant
     WHERE token_sha256 = sha256(convert_to(OLD.token, 'UTF8'));
  END IF;

  INSERT INTO better_auth.invitation_tenant (token_sha256, town_id)
  VALUES (sha256(convert_to(NEW.token, 'UTF8')), NEW.town_id)
  ON CONFLICT (token_sha256) DO UPDATE SET town_id = EXCLUDED.town_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER invitation_tenant_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.invitation
  FOR EACH ROW EXECUTE FUNCTION better_auth.sync_invitation_tenant();

--
-- ─── Backfill ─────────────────────────────────────────────────────────────
--
-- Invitations issued before this migration would otherwise be unacceptable
-- forever: their tokens are in already-delivered emails and cannot be
-- reissued without the recipient asking for a resend they have no reason to
-- know they need.
--
-- This SELECT runs as the migration role, which is the schema owner. Under
-- FORCE RLS the owner is subject to `invitation`'s policy like anyone else, so
-- a plain SELECT here would read zero rows and the backfill would be a silent
-- no-op — the wrong answer, with nothing to notice.
--
-- The first version of this migration reached for `SET row_security = off`,
-- which does not work and cannot be made to. `row_security = off` is not a
-- bypass: it is an ASSERTION that no policy applies, and PostgreSQL raises
-- `query would be affected by row-level security policy for table
-- "invitation"` for any session that is not `BYPASSRLS`. The production
-- migration role is `tmm_owner` — a non-superuser without `BYPASSRLS`, by
-- design (docs/superpowers/plans/2026-08-26-stage-1-platform.md § roles) — so
-- that statement aborted the migration on exactly the databases it was
-- written for, and `scripts/build-db-from-repo.sh` (`ON_ERROR_STOP=1` under
-- `set -euo pipefail`) stopped here and applied nothing after it. CI never saw
-- it because CI's DATABASE_URL is a superuser.
--
-- What actually works for the owner is what PostgreSQL's own HINT on that
-- error says: drop FORCE for the length of the backfill and put it back.
-- Without FORCE the table owner bypasses its own policies, which is precisely
-- the privilege FORCE exists to take away and precisely what a one-shot
-- backfill of pre-existing rows needs.
--
-- This keeps the loudness the original was reaching for, and does not depend
-- on `BYPASSRLS` to get it:
--
--   * A role that is not the table owner cannot run `ALTER TABLE`. It gets
--     `must be owner of table invitation` and the migration aborts — the
--     silent zero-row backfill is still impossible.
--   * The window in which FORCE is off is three statements on the migration's
--     own connection, before the application is serving against this schema.
--   * FORCE is restored unconditionally on the next line, and
--     `db/__tests__/schema-invariants.test.ts` fails the build if any table in
--     `public` ends the corpus without both RLS and FORCE — so a future edit
--     that drops the restore cannot land quietly.
--
ALTER TABLE public.invitation NO FORCE ROW LEVEL SECURITY;

INSERT INTO better_auth.invitation_tenant (token_sha256, town_id)
SELECT sha256(convert_to(token, 'UTF8')), town_id
  FROM public.invitation
ON CONFLICT (token_sha256) DO UPDATE SET town_id = EXCLUDED.town_id;

ALTER TABLE public.invitation FORCE ROW LEVEL SECURITY;
