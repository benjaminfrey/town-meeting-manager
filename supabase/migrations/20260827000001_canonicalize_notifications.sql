-- ============================================================
-- Town Meeting Manager — Canonicalize the notification schema
-- ============================================================
-- Task 3 (A3) of the Stage 1 platform migration. Additive and
-- forward-only — does NOT edit 20260308000018-000021 (official) or
-- 20260826000001/20260826000002 (ported); those stay untouched so the
-- ported files remain byte-identical to their docker/migrations
-- originals apart from their headers.
--
-- DECISION (owner, 2026-08-27): notification subscribers are PERSON,
-- not USER_ACCOUNT. user_account.person_id is NOT NULL UNIQUE, so a
-- person can exist with no account (AddPersonDialog's "Directory-only"
-- choice; people.test.tsx covers a board member with no account).
-- Keying notifications to user_account would silently drop seated
-- board members with no login from statutory Maine FOAA notices — the
-- people least likely to notice they were dropped. This also answers
-- board_member.user_account_id (audit finding): board membership
-- links to a person, not an account.
--
-- ─── The three shapes, side by side (verified before writing this) ──
--
-- notification_event
--   official (20260308000018): town_id, event_type TEXT, payload, status
--     notification_status (shared enum with notification_delivery),
--     created_at, processed_at. This is what a fresh corpus build has —
--     it is what "canonical" already is for this table.
--   ported (20260826000001): CREATE TABLE IF NOT EXISTS — no-ops on a
--     fresh build (official table exists first). event_type/status use
--     its own enums (notification_event_type / notification_event_status)
--     that are never actually applied to any column, because the
--     CREATE TABLE no-ops. Its indexes on this table apply harmlessly
--     (columns match) — whether they PERSIST past the file's abort (see
--     notification_delivery below) depends on which tool applies the
--     corpus; see "Builder divergence" below.
--   dev db (database.ts, 2026-03-13): matches official exactly.
--   → Canonical: official, unchanged. No migration needed for this table.
--
-- notification_delivery
--   official (20260308000019): id, event_id, town_id NOT NULL,
--     subscriber_id → person(id) NOT NULL, channel, status
--     notification_status, external_id, error_message, created_at,
--     delivered_at.
--   ported (20260826000001): CREATE TABLE IF NOT EXISTS — no-ops (table
--     already exists). subscriber_id → user_account(id), NO town_id,
--     status notification_delivery_status (pending/sent/delivered/
--     bounced/failed/complained), postmark_message_id, sent_at,
--     opened_at, retry_count, next_retry_at. Its own CREATE INDEX
--     idx_notification_delivery_postmark references postmark_message_id,
--     which does not exist on the official table the no-op left in
--     place — this statement fails with 42703 (undefined_column), which
--     aborts the file. The tail after that point (the
--     subscriber_notification_preference block, the four
--     user_account.email_bounced* columns, and all 8 RLS policies in
--     this file) never runs, on EITHER builder — see the tolerated
--     failure entry in packages/api/src/test/db-harness.ts. Whether the
--     statements BEFORE the abort persist is builder-dependent — see
--     "Builder divergence" below; it does not matter for this table
--     (none of its pre-abort statements are ones this migration needs
--     to guard against — no CREATE POLICY runs before the abort).
--   dev db (database.ts, 2026-03-13): a HYBRID — the official base
--     (town_id NOT NULL, external_id, notification_status enum,
--     subscriber_id → person) PLUS the ported tracking columns bolted
--     on by hand outside any migration (postmark_message_id, sent_at,
--     opened_at, retry_count, next_retry_at). This is what
--     notification-service.ts's actual field usage requires (it reads
--     and writes all of these columns) and is what this migration
--     reproduces below.
--   → Canonical: official base + the five ported tracking columns.
--     town_id is KEPT (see "kept, not dropped" below). Both external_id
--     and postmark_message_id are kept (see below).
--
-- subscriber_notification_preference
--   official (20260308000020): person_id → person(id) NOT NULL, town_id,
--     channel, event_type, enabled, TCPA consent_timestamp/
--     consent_method/consent_record. UNIQUE (person_id, channel,
--     event_type).
--   ported (20260826000001): CREATE TABLE IF NOT EXISTS — no-ops.
--     subscriber_id → user_account(id), UNIQUE (subscriber_id,
--     event_type, channel). Never applied to a fresh build.
--   dev db (database.ts, 2026-03-13): matches official exactly
--     (person_id, TCPA columns, official unique constraint).
--   → Canonical: official, unchanged. No migration needed for this
--     table. The bug is entirely in application code, which was written
--     against the ported shape and never updated (see call sites below)
--     — zero notification call sites used person_id before this commit.
--
-- town_notification_config
--   official (20260308000021): town_id UNIQUE, postmark_server_token_
--     encrypted, postmark_sender_email/name, Twilio + SMS quiet-hours
--     columns (Phase 2).
--   ported (20260826000001): CREATE TABLE IF NOT EXISTS — no-ops.
--     postmark_server_token (unencrypted column name), sender columns
--     NOT NULL. Never applied to a fresh build.
--   dev db (database.ts, 2026-03-13): matches official exactly.
--   → Canonical: official, unchanged. No migration needed for this table.
--
-- ─── Builder divergence — CORRECTED after code review ────────────────
--
-- An earlier draft of this comment claimed 20260826000001's statements
-- "run as one implicit multi-statement transaction and roll back
-- together" on abort. That is true ONLY of packages/api/src/test/
-- db-harness.ts's builder (postgres.js's sql.file() sends a whole file
-- as one simple-query message, which Postgres wraps in an implicit
-- transaction). It is FALSE of scripts/build-db-from-repo.sh, the
-- Stage 0 gate, which runs `psql -f <file>` with no explicit
-- transaction wrapper — psql executes each top-level statement in its
-- own autocommitted transaction. Under that builder, everything BEFORE
-- the postmark_message_id failure in 20260826000001 commits and
-- persists: three orphan enum types with no column ever using them
-- (notification_event_type, notification_event_status,
-- notification_delivery_status — notification_channel is a fourth type
-- the file also declares, but that name collides with the official
-- enum and is caught by the file's own `EXCEPTION WHEN duplicate_object`
-- guard, so it is not orphaned), plus two indexes duplicating official
-- ones under different names (idx_notification_delivery_event,
-- idx_notification_event_town_created, etc.) — harmless redundancy, not
-- addressed here. The three orphan enum TYPES are addressed below,
-- because unlike redundant indexes they would make `drizzle-kit pull`
-- (Task 4) generate different output depending on which builder most
-- recently touched the database it pulls from — a real corpus-shape
-- divergence, not a cosmetic one. Which database Task 4 actually pulls
-- from is Task 4's decision; this migration just makes the two builders
-- converge on the same enum inventory regardless.
--
-- ─── Decisions carried forward from the task brief ───────────────────
--
-- town_id KEPT on notification_delivery (denormalized tenant key): this
-- repo's RLS model enforces tenancy per table on town_id, and every
-- policy on this table would otherwise need to join through
-- notification_event just to filter by tenant.
--
-- TCPA consent_* columns KEPT on subscriber_notification_preference:
-- compliance artifact for the Phase 2 SMS work; only the official shape
-- carries them, and dropping them would be irreversible in a way
-- keeping them is not.
--
-- external_id AND postmark_message_id BOTH KEPT on notification_delivery:
-- no forcing function today to merge them; carrying both is cheap and
-- reversible, merging is not.
--
-- ─── Additional discrepancies found while auditing this exact code ───
--
-- notification_status (the enum shared by notification_event.status and
-- notification_delivery.status) is missing two values the application
-- code already writes: 'completed' (notification-service.ts sets this
-- on notification_event once all deliveries are dispatched) and
-- 'complained' (notifications.ts's Postmark SpamComplaint webhook sets
-- this on notification_delivery). Both call sites predate this task and
-- are not being changed here — only the enum is extended so those
-- existing writes stop failing with 22P02 (invalid_text_representation).
--
-- All three subscriber_notification_preference upsert call sites
-- (invitations.ts's /unsubscribe and preferences routes,
-- settings.notifications.tsx) also set an `updated_at` field on every
-- write. The official table has no created_at/updated_at columns (only
-- the ported, never-applied shape did) — that write would fail with
-- 42703 the moment the column-name fix below made it as far as hitting
-- a real column. Fixed in the same commit as the column-name change by
-- dropping the field, not by adding the column: the dev db (the
-- verified source of truth for this table) doesn't have it either, so
-- there was never a real column to reconcile toward, unlike
-- notification_delivery's tracking columns above.
--
-- user_account.email_bounced / email_bounced_at / email_complained /
-- email_complained_at (added by 20260826000001's own DO block, lines
-- 146-153) are ALSO part of the never-reached tail — on every builder,
-- these four columns never get created, because the DO block sits after
-- the postmark_message_id abort. But notification-service.ts's
-- subscriber-resolution path (getSubscribersForPersonIds,
-- getAdminSubscribers, retryDelivery, both Postmark webhook handlers,
-- and the /admin/notifications/bounces endpoints) all read or write
-- these four columns via an embedded `user_account(email_bounced,
-- email_complained)` select. Against a database missing them, PostgREST
-- returns 42703, supabase-js surfaces it as `{data: null, error}`, and
-- the current code's `?? []` fallbacks silently swallow it — the exact
-- same failure shape as board_member.user_account_id, one join further
-- out. user_account is not one of this task's four target tables, but
-- this migration now depends on these four columns existing, so they
-- are bolted on below alongside notification_delivery's tracking
-- columns, matching the dev db's verified hybrid shape exactly.
-- Relocating these flags onto person (so an account-less person can be
-- bounce-tracked too, not just defaulted to never-bounced) is the
-- better long-term answer and is deliberately deferred — out of scope
-- for this task, which only needs the columns to exist before Task 4
-- pulls the schema.
-- ============================================================

-- ─── Guard the ported files' bare CREATE POLICY statements against
--     re-application to a database that already has them (PostgreSQL
--     has no CREATE POLICY IF NOT EXISTS, so a second application —
--     e.g. a database that once had docker/migrations/011 and 012
--     applied by hand per their own file headers — aborts with 42710,
--     duplicate_object) ────────────────────────────────────────────
--
-- CORRECTED after code review: an earlier draft of this migration also
-- dropped town_notification_config_select, town_notification_config_update,
-- notification_event_select, and notification_delivery_select — believing
-- all 5 names in 20260826000001's RLS block belonged only to that file.
-- FOUR of those five names are ALSO used by the OFFICIAL, person-based RLS
-- in 20260308000035_rls_notification.sql (lines 92, 106, 19, 37
-- respectively). DROP POLICY matches by name, not by origin file — on
-- every builder, 20260826000001 aborts (see "Builder divergence" above)
-- before it ever reaches its own copies of these 4 names, so the ONLY
-- policies ever bearing them are the official ones, and the earlier draft
-- deleted the official, person-based RLS that implements this task's own
-- decision (notification_delivery_select's predicate is literally
-- `subscriber_id = get_current_person_id()`) while claiming to enforce it.
-- Only subscriber_pref_all is a name unique to the ported file — nothing
-- official uses that name (official's three subscriber_notification_
-- preference policies are subscriber_pref_select/_insert/_update) — so
-- only that one is dropped, and it is not recreated (it never gets
-- created by 20260826000001 on any builder either, per "Builder
-- divergence" above, so there is nothing to restore).
DROP POLICY IF EXISTS subscriber_pref_all ON subscriber_notification_preference;

-- The invitation table's 3 policies (20260826000002 lines 39, 47, 55) DO
-- succeed on every builder (that file has no equivalent abort) and are
-- correct as written — the invitation table is untouched by the
-- person/user_account decision, and none of their 3 names collide with
-- anything official. These are dropped and recreated identically, purely
-- so this migration (and hence the whole corpus) is idempotent if ever
-- re-applied to a database that already ran 20260826000002.
DROP POLICY IF EXISTS "town_members_see_invitations" ON invitation;
DROP POLICY IF EXISTS "town_members_insert_invitations" ON invitation;
DROP POLICY IF EXISTS "town_members_update_invitations" ON invitation;

CREATE POLICY "town_members_see_invitations" ON invitation
  FOR SELECT USING (
    town_id IN (
      SELECT town_id FROM user_account WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "town_members_insert_invitations" ON invitation
  FOR INSERT WITH CHECK (
    town_id IN (
      SELECT town_id FROM user_account WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "town_members_update_invitations" ON invitation
  FOR UPDATE USING (
    town_id IN (
      SELECT town_id FROM user_account WHERE auth_user_id = auth.uid()
    )
  );

-- ─── notification_delivery: bolt on the ported tracking columns that
--     never actually made it in (see "HYBRID" above) ─────────────────

ALTER TABLE notification_delivery
  ADD COLUMN IF NOT EXISTS postmark_message_id TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

COMMENT ON COLUMN notification_delivery.postmark_message_id IS 'MessageID returned by Postmark at send time. Distinct from external_id, which is set from provider webhooks generally (Postmark or, in Phase 2, Twilio) — kept separately rather than merged (see header).';
COMMENT ON COLUMN notification_delivery.retry_count IS 'Number of delivery attempts made so far. Retry backoff schedule lives in notification-service.ts.';
COMMENT ON COLUMN notification_delivery.next_retry_at IS 'When the retry processor should next attempt this delivery. Null when no retry is scheduled.';

CREATE INDEX IF NOT EXISTS idx_notification_delivery_postmark
  ON notification_delivery (postmark_message_id)
  WHERE postmark_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_delivery_retry
  ON notification_delivery (next_retry_at)
  WHERE status IN ('sent', 'failed') AND retry_count < 3 AND next_retry_at IS NOT NULL;

-- ─── user_account: bolt on the bounce/complaint tracking columns that
--     never actually made it in — see "Additional discrepancies" above.
--     Not one of this task's four target tables, but notification-
--     service.ts's canonical (person-based) subscriber path now depends
--     on these existing. ──────────────────────────────────────────────

ALTER TABLE user_account
  ADD COLUMN IF NOT EXISTS email_bounced BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_bounced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_complained BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_complained_at TIMESTAMPTZ;

COMMENT ON COLUMN user_account.email_bounced IS 'Set true on a hard Postmark bounce — skip future sends to this account. Deliberately still account-scoped, not person-scoped: an account-less person has nothing that can bounce yet (see header).';
COMMENT ON COLUMN user_account.email_complained IS 'Set true on a Postmark spam complaint — skip future sends to this account.';

-- ─── notification_status: add the two values existing (unchanged) call
--     sites already write — see "Additional discrepancies" above ─────

ALTER TYPE notification_status ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE notification_status ADD VALUE IF NOT EXISTS 'complained';

-- ─── Defensive cleanup: the 3 enum types 20260826000001 creates and
--     never uses (see "Builder divergence" above). No-op under
--     db-harness.ts (postgres.js rolls the whole file back, so they
--     never exist there); real cleanup under scripts/build-db-from-
--     repo.sh's psql/autocommit builder, where they persist as orphans.
--     Safe to drop unconditionally — nothing in the corpus or the
--     application code references these three type names; only
--     notification_channel (a real, shared, official type) survives
--     the ported file's own EXCEPTION WHEN duplicate_object guard, and
--     that one is untouched here. ──────────────────────────────────

DROP TYPE IF EXISTS notification_event_type;
DROP TYPE IF EXISTS notification_event_status;
DROP TYPE IF EXISTS notification_delivery_status;
