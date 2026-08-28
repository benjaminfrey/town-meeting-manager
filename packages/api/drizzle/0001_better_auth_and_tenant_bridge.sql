--
-- ============================================================================
-- Better Auth, and the bridge from a session to app.town_id
-- ============================================================================
-- Stage 1, Task C1. Forward migration on top of 0000_baseline.sql, which is
-- never edited in place.
--
-- Phase B put all 27 tables under FORCE ROW LEVEL SECURITY with a single
-- tenancy predicate, `town_id = get_current_town_id()`, reading the
-- `app.town_id` session setting. Nothing set that setting. This migration adds
-- the identity layer that produces it.
--
-- ─── Contents ──────────────────────────────────────────────────────────────
--   Section 1  The `better_auth` schema, and why it is a separate schema
--   Section 2  Better Auth's four tables, verbatim from its own generator
--   Section 3  better_auth.user_tenant — the identity → town mapping
--   Section 4  public.user_account.auth_user_id — retyped, and a real FK
--   Section 5  Grants: tmm_app, DML only, same shape as the baseline's
--   Section 6  complete_onboarding() — repaired to work under FORCE RLS
--
-- ============================================================================
-- SECTION 1 — WHY A SEPARATE SCHEMA, AND THE RLS DECISION
-- ============================================================================
--
-- THE DECISION: Better Auth's tables get NO row level security. They live in
-- their own schema, `better_auth`, so that this is a visible structural fact
-- rather than an entry on an exemption list.
--
-- WHY NO RLS. RLS here enforces tenancy, and these tables have no tenant.
-- More than that, they *cannot* have one, for a reason that is circular by
-- construction:
--
--   To scope a query by town, `app.town_id` must already be set.
--   To know which town, the session must be resolved.
--   To resolve the session, `better_auth.session` must be read.
--
-- A tenancy policy on `better_auth.session` would make that read return zero
-- rows before any tenant context exists, so no session could ever be resolved
-- and no one could ever log in. The only policy that would "work" is
-- `USING (true)`, which is decoration: it makes the table look protected in
-- `pg_policies` while protecting nothing. Phase B's whole argument against
-- keeping the permission matrix in RLS was that a policy which cannot fail for
-- the right reason is worse than no policy, because it launders the absence of
-- a check into the appearance of one. The same argument applies here, so the
-- honest answer is written down instead of dressed up.
--
-- WHY THAT IS SAFE GIVEN tmm_app CAN READ THEM. It is safe because there is
-- nothing tenant-scoped in them to leak. What they hold is:
--   - `user`:         name, email, emailVerified — an identity, not a town's data
--   - `account`:      the Argon2id password hash and OAuth tokens
--   - `session`:      session tokens
--   - `verification`: email-verification and password-reset tokens
--
-- `tmm_app` must be able to read all four to authenticate anybody at all —
-- that is the same access GoTrue's `service_role` had before, except now it is
-- one Postgres role with DML and no DDL rather than a key that bypassed RLS
-- across the entire database. The exposure that matters (password hashes,
-- live session tokens) is not reduced one bit by a tenancy policy, because
-- tenancy is not the axis those need protecting along. They are protected by
-- being hashed (`account.password`), by being high-entropy and expiring
-- (`session.token`, `verification.value`), and by no role other than tmm_app
-- and the owner being granted anything in this schema at all — asserted in
-- `packages/api/src/auth/__tests__/auth-schema-invariants.test.ts`.
--
-- WHAT THIS DOES NOT DO. It does not weaken Phase B. `public` still has 27
-- tables, all with RLS ENABLED and FORCED, all with exactly one
-- `<table>_tenant_isolation` policy. `schema-invariants.test.ts` scopes every
-- one of its queries to `nspname = 'public'`, so it passes UNCHANGED and its
-- exact 27-table list is still exact. That is the concrete reason for a
-- separate schema over an exemption list: an exemption list is a mechanism
-- that the next table can quietly join, and this way there is no list.
--
-- CONSEQUENCE FOR THE BUILD SCRIPT. `scripts/build-db-from-repo.sh` reset only
-- `public`, so a second run would have hit "schema better_auth already
-- exists". It now resets both. See that file.

CREATE SCHEMA better_auth;

COMMENT ON SCHEMA better_auth IS
  'Better Auth''s own tables plus the identity-to-town mapping. Deliberately NOT under row level security: an identity exists before any town is known, and the session read that discovers the town has to happen before app.town_id can be set. See packages/api/drizzle/0001_better_auth_and_tenant_bridge.sql section 1.';

--
-- ============================================================================
-- SECTION 2 — BETTER AUTH'S TABLES
-- ============================================================================
-- Reproduced from Better Auth 1.7.2's own migration generator, not typed from
-- documentation:
--
--   getMigrations({ database: pool, emailAndPassword: { enabled: true,
--                   requireEmailVerification: true } }).compileMigrations()
--
-- The only edits are `better_auth.` qualification and formatting. Nothing was
-- added, removed or retyped — `packages/api/src/auth/__tests__/
-- auth-schema-invariants.test.ts` re-runs that generator against a database
-- built from this file and asserts it plans no further changes, so this
-- section cannot drift from what Better Auth expects without a test failing.
--
-- Note the id type: `text`, not `uuid`. Better Auth generates ids in
-- application code (a random alphanumeric string) and inserts them; there is
-- no database-side default. That fact drives section 4.
--
-- Better Auth would create these itself on first run. It is not allowed to:
-- the repository is the single reproducible source that
-- scripts/build-db-from-repo.sh rebuilds from, and a table that only exists
-- because a process happened to start once is not reproducible.

CREATE TABLE better_auth."user" (
  "id" text NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  "image" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE better_auth."session" (
  "id" text NOT NULL PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES better_auth."user" ("id") ON DELETE CASCADE
);

CREATE TABLE better_auth."account" (
  "id" text NOT NULL PRIMARY KEY,
  "issuer" text NOT NULL,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES better_auth."user" ("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL
);

CREATE TABLE better_auth."verification" (
  "id" text NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX "session_userId_idx" ON better_auth."session" ("userId");
CREATE INDEX "account_userId_idx" ON better_auth."account" ("userId");
CREATE INDEX "verification_identifier_idx" ON better_auth."verification" ("identifier");
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON better_auth."account" ("issuer", "accountId");

--
-- ============================================================================
-- SECTION 3 — THE IDENTITY → TOWN MAPPING
-- ============================================================================
-- This one table is the door-opener. It is the only thing in the system that
-- can be read with no tenant context and that names a town, and it exists
-- because of the circularity described in section 1: something outside RLS has
-- to say which town to open before anything inside RLS can be read.
--
-- WHAT IT IS NOT: it is not the authority on which town a user belongs to.
-- `public.user_account.town_id` is, and it stays that way. This row is a HINT
-- that gets verified: `resolveTenant` reads the town id here, opens a
-- transaction scoped to it, and then re-reads `user_account` *through* RLS to
-- confirm the account really is in that town, is not archived, and still
-- exists. If the hint is stale, wrong, or points at a town whose
-- `user_account` has since been deleted, the RLS-scoped read returns no rows
-- and resolution throws. So the denormalised copy cannot silently win an
-- argument with the real one — it can only fail loudly.
--   See packages/api/src/auth/tenant-context.ts and its tests.
--
-- WHY `auth_user_id` IS THE PRIMARY KEY: it makes "a session resolves to
-- exactly one town" a schema property rather than a query that happens to
-- return one row. A second row for the same identity is a unique violation,
-- not an ambiguity resolved by whichever row the planner returned first.
--
-- WHY NOT AN ADDITIONAL FIELD ON better_auth."user": Better Auth's
-- `user.additionalFields` are, by default, settable by the client at sign-up.
-- Getting `input: false` wrong once would let a registering user name their
-- own town. A separate table Better Auth does not manage removes that class of
-- mistake instead of configuring around it.

CREATE TABLE better_auth.user_tenant (
  auth_user_id text NOT NULL PRIMARY KEY
    REFERENCES better_auth."user" ("id") ON DELETE CASCADE,
  -- Cross-schema FK into an RLS-forced table. Referential integrity checks
  -- always bypass row security (PostgreSQL, "Row Security Policies"), so this
  -- is enforced regardless of the acting role's tenant context.
  town_id uuid NOT NULL
    REFERENCES public.town (id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE better_auth.user_tenant IS
  'Identity -> town hint, readable without tenant context. NOT authoritative: user_account.town_id is. resolveTenant() verifies this value against user_account through RLS and throws if they disagree. One row per identity, by primary key, so a session can never resolve to two towns.';

CREATE INDEX user_tenant_town_id_idx ON better_auth.user_tenant (town_id);

--
-- ============================================================================
-- SECTION 4 — public.user_account.auth_user_id
-- ============================================================================
-- THE DECISION (Task C1, step 1): retype from `uuid` to `text` and make it a
-- real foreign key to better_auth."user"(id), ON DELETE SET NULL. The existing
-- UNIQUE constraint and index are kept.
--
-- WHY IT HAD TO CHANGE AT ALL: Better Auth 1.7.2's user id is `text` — a
-- random alphanumeric string generated in application code, not a UUID (read
-- out of the installed package's own migration generator, not assumed). A
-- `uuid` column cannot hold one. This is a type mismatch, not a preference.
--
-- WHY NOT KEY user_account TO BETTER AUTH'S ID DIRECTLY: `user_account.id` is
-- a uuid referenced by foreign keys from audit_log, push_subscription,
-- meeting.created_by, invitation and minutes_document, and by 32 TypeScript
-- files across three packages. Retyping a primary key that ten tables point at
-- is a data migration plus a repo-wide refactor, to remove one column. It also
-- welds the domain model's identity to the auth vendor's — the exact coupling
-- Phase B spent a task undoing when it removed GoTrue.
--
-- WHY NOT LEAVE IT AND ADD A NEW COLUMN: that ships a permanently dead `uuid`
-- column beside the live one, and nothing in the schema would tell the next
-- reader which is which. This column already exists for precisely this
-- purpose, has never been written to (Phase B dropped the auth.users FK and
-- left it unconstrained and unused), and has zero rows — so retyping is free
-- today and gets more expensive every week it is deferred.
--
-- WHY `ON DELETE SET NULL` AND NOT `CASCADE`: deleting a login must not delete
-- the account. `person.archived_at` is documented as "login credentials are
-- deleted but public record data (name, title, votes) is retained
-- indefinitely" — a board member's recorded votes and attendance have to
-- outlive their ability to log in. SET NULL leaves an account that can no
-- longer authenticate with every historical reference to it intact. CASCADE
-- would silently delete audit history.

ALTER TABLE public.user_account
  ALTER COLUMN auth_user_id TYPE text USING auth_user_id::text;

ALTER TABLE public.user_account
  ADD CONSTRAINT user_account_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES better_auth."user" ("id") ON DELETE SET NULL;

COMMENT ON COLUMN public.user_account.auth_user_id IS
  'Better Auth user id (text, not uuid — Better Auth generates ids in application code). Real foreign key to better_auth."user"(id) ON DELETE SET NULL: deleting a login must not delete the account, because recorded votes and attendance outlive it. UNIQUE, which is half of "a session resolves to exactly one town" — the other half is better_auth.user_tenant''s primary key. Set by onboarding and by invitation acceptance; read by resolveTenant().';

--
-- ============================================================================
-- SECTION 5 — GRANTS
-- ============================================================================
-- Same shape and the same reasoning as the baseline's section 4: tmm_app owns
-- nothing, is never superuser, has no BYPASSRLS, and gets DML only. No
-- TRUNCATE (it bypasses DELETE policies outright), no REFERENCES, no TRIGGER,
-- no DDL, never GRANT ALL.
--
-- These live in the migration, not in a runbook, for the reason the baseline
-- gives: `scripts/build-db-from-repo.sh` drops and recreates these schemas
-- before every build, which destroys any grant applied out of band — and the
-- build would then report success against a database the application cannot
-- use at all.
--
-- REVOKE-from-PUBLIC is stated explicitly even though CREATE SCHEMA grants
-- PUBLIC nothing by default, so that "no role reaches this schema unless it
-- was granted by name" is a line in the file a reviewer can find rather than a
-- default a reviewer has to know.

REVOKE ALL ON SCHEMA better_auth FROM PUBLIC;

GRANT USAGE ON SCHEMA better_auth TO tmm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA better_auth TO tmm_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA better_auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tmm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA better_auth
  GRANT EXECUTE ON FUNCTIONS TO tmm_app;

--
-- ============================================================================
-- SECTION 6 — complete_onboarding(), REPAIRED
-- ============================================================================
-- The baseline's version does not work, and its own comment said so: it
-- inserts into `town` before any `app.town_id` exists, and `town`'s policy is
-- `WITH CHECK (id = get_current_town_id())`, so under FORCE RLS the insert is
-- denied. It appeared to work in local development only because the developer
-- role is a superuser and SECURITY DEFINER inherited that bypass — which is
-- exactly what hid the breakage. `__tests__/onboarding.test.ts` runs it as
-- `tmm_app`, where no such bypass exists.
--
-- THE WORKING PATH, and why it is the only one that does not open a hole:
-- application code generates the town id, sets `app.town_id` to it with
-- `set_config(..., true)` (transaction-local), and only then calls this
-- function. `town`'s WITH CHECK is then satisfied for exactly one id — the one
-- the caller committed to before the insert. The alternative, an unconditional
-- INSERT policy on `town`, would let any authenticated session create towns at
-- will. See `completeOnboarding()` in packages/api/src/auth/onboarding.ts,
-- which is the only supported caller.
--
-- THREE CHANGES beyond the id plumbing:
--
--  1. NOT `SECURITY DEFINER` any more. Under FORCE RLS a definer function
--     gains nothing — FORCE binds the owner too — so all the old marking did
--     was carry a privilege-escalation footgun for a benefit that no longer
--     exists. It runs as the caller, and RLS is what makes it safe.
--
--  2. Identity is a parameter, not `current_setting('app.user_account_id')`.
--     One fewer ambient session variable to establish correctly, and the
--     function's contract becomes readable from its signature.
--
--  3. It asserts `get_current_town_id() = p_town_id` up front. Without that,
--     a caller who forgot the `set_config` gets a bare "new row violates
--     row-level security policy for table town", which names neither the
--     cause nor the fix.
--
-- The "user already belongs to a town" guard is kept but is deliberately no
-- longer the real defence: under RLS it can only see the current town. The
-- global guarantee is better_auth.user_tenant's primary key and
-- user_account.auth_user_id's UNIQUE constraint, both of which fail closed
-- regardless of tenant context.

DROP FUNCTION public.complete_onboarding(text, text, text, text, text, text, text, text, jsonb, text, integer, text, text, jsonb, boolean, boolean, jsonb, text, text);

CREATE FUNCTION public.complete_onboarding(
  p_town_id uuid,
  p_person_id uuid,
  p_user_account_id uuid,
  p_town_name text,
  p_state text DEFAULT 'ME'::text,
  p_municipality_type text DEFAULT 'town'::text,
  p_population_range text DEFAULT NULL::text,
  p_meeting_formality text DEFAULT 'semi_formal'::text,
  p_minutes_style text DEFAULT 'action'::text,
  p_presiding_officer text DEFAULT NULL::text,
  p_minutes_recorder text DEFAULT NULL::text,
  p_staff_roles_present jsonb DEFAULT '[]'::jsonb,
  p_board_name text DEFAULT 'Select Board'::text,
  p_member_count integer DEFAULT NULL::integer,
  p_election_method text DEFAULT NULL::text,
  p_officer_election_method text DEFAULT NULL::text,
  p_seat_titles jsonb DEFAULT '[]'::jsonb,
  p_district_based boolean DEFAULT false,
  p_staggered_terms boolean DEFAULT false,
  p_additional_boards jsonb DEFAULT '[]'::jsonb,
  p_contact_name text DEFAULT NULL::text,
  p_contact_email text DEFAULT NULL::text
) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_board JSONB;
BEGIN
  IF p_town_id IS NULL OR p_person_id IS NULL OR p_user_account_id IS NULL THEN
    RAISE EXCEPTION 'complete_onboarding: town, person and user_account ids are all required';
  END IF;

  -- The check that turns an opaque RLS denial into an instruction.
  IF get_current_town_id() IS DISTINCT FROM p_town_id THEN
    RAISE EXCEPTION
      'complete_onboarding: app.town_id is % but p_town_id is %. Call set_config(''app.town_id'', <the new town id>, true) in this transaction first — town''s RLS policy only admits a row whose id equals the current tenant.',
      coalesce(get_current_town_id()::text, '(unset)'), p_town_id;
  END IF;

  IF EXISTS (SELECT 1 FROM user_account WHERE id = p_user_account_id) THEN
    RAISE EXCEPTION 'complete_onboarding: user_account % already exists', p_user_account_id;
  END IF;

  INSERT INTO town (
    id, name, state, municipality_type, population_range,
    meeting_formality, minutes_style,
    presiding_officer_default, minutes_recorder_default,
    staff_roles_present
  ) VALUES (
    p_town_id, p_town_name, p_state, p_municipality_type::municipality_type, p_population_range,
    p_meeting_formality::meeting_formality, p_minutes_style::minutes_style,
    p_presiding_officer, p_minutes_recorder,
    p_staff_roles_present
  );

  INSERT INTO board (
    town_id, name, member_count, election_method,
    officer_election_method, is_governing_board,
    seat_titles, district_based, staggered_terms
  ) VALUES (
    p_town_id, p_board_name, p_member_count, p_election_method,
    p_officer_election_method, true,
    p_seat_titles, p_district_based, p_staggered_terms
  );

  FOR v_board IN SELECT * FROM jsonb_array_elements(p_additional_boards) LOOP
    INSERT INTO board (
      town_id, name, member_count, elected_or_appointed, is_governing_board
    ) VALUES (
      p_town_id,
      v_board->>'name',
      (v_board->>'memberCount')::INTEGER,
      COALESCE(v_board->>'electedOrAppointed', 'elected'),
      false
    );
  END LOOP;

  INSERT INTO person (id, town_id, name, email)
  VALUES (p_person_id, p_town_id, COALESCE(p_contact_name, 'Admin'), p_contact_email)
  ON CONFLICT (id) DO UPDATE SET
    town_id = EXCLUDED.town_id,
    name = EXCLUDED.name,
    email = EXCLUDED.email;

  INSERT INTO user_account (id, person_id, town_id, role)
  VALUES (p_user_account_id, p_person_id, p_town_id, 'admin');

  RETURN p_town_id;
END;
$$;

-- Explicit rather than leaning on PostgreSQL's EXECUTE-to-PUBLIC default, for
-- the same reason the baseline grants get_current_town_id() explicitly: if
-- someone later revokes that default as a hardening step, onboarding should
-- keep working rather than start failing for a reason nobody connects to it.
GRANT EXECUTE ON FUNCTION public.complete_onboarding(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text, integer, text, text, jsonb, boolean, boolean, jsonb, text, text) TO tmm_app;

COMMENT ON FUNCTION public.complete_onboarding(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text, integer, text, text, jsonb, boolean, boolean, jsonb, text, text) IS
  'Onboarding wizard completion: creates town, boards, person and user_account in one transaction. SECURITY INVOKER — it runs as the caller under FORCE RLS, which is what makes it safe. The caller MUST generate p_town_id and set app.town_id to it (transaction-local) before calling; the function refuses loudly otherwise. Linking the new user_account to a Better Auth identity is the caller''s next step — see completeOnboarding() in packages/api/src/auth/onboarding.ts.';
