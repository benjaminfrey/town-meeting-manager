--
-- ============================================================================
-- Invitation tokens are stored as a digest, never as the token
-- ============================================================================
-- Forward migration on top of 0003; earlier files are never edited in place.
--
-- ─── The problem this closes ──────────────────────────────────────────────
--
-- `public.invitation.token` held the token itself, and the token is the whole
-- credential for `POST /api/invitations/accept`: a public route that asks for
-- nothing but `{token, password}` and sets that password on the invited
-- account, at the invitation's role, admin included. So any read of that
-- column was an account takeover. One such read shipped — `boardMember.roster`
-- returned it to every signed-in user until PR #16 — and a database dump, a
-- backup, a debugging `SELECT *` or the next careless procedure would each be
-- another.
--
-- After this migration the table holds `sha256(token)` and nothing that can be
-- presented to anything. The token exists in exactly two places: the email
-- that carries it, and the request that presents it back.
--
-- ─── Why sha256, unsalted ─────────────────────────────────────────────────
--
-- A password needs a slow, salted hash because people choose guessable ones.
-- These are 256 random bits (`crypto.randomBytes(32)` in
-- `routes/invitations.ts`), or 122 for the UUID tokens issued before this
-- migration; there is nothing to guess and nothing for a salt to defend
-- against. A fast hash also lets acceptance look the row up by equality.
--
-- ─── Why existing links keep working ──────────────────────────────────────
--
-- `better_auth.invitation_tenant` (0002) is ALREADY keyed on
-- `sha256(convert_to(token, 'UTF8'))`. The backfill below computes the same
-- expression, so every hint row stays valid and every link already sitting in
-- an inbox resolves exactly as before. The digest convention is unchanged —
-- only its home moves: the trigger no longer hashes anything, it copies the
-- digest the row already carries.
--
-- ─── Why the column changes name and type ─────────────────────────────────
--
-- `token text` → `token_sha256 bytea`, 32 bytes, checked. Code that still
-- writes a plaintext token into `token` now fails (no such column), and code
-- that writes one into `token_sha256` fails too (text is not bytea; a bytea
-- of the wrong length fails the CHECK). Keeping the old name would have left
-- the one mistake this migration exists to prevent a silent success.
--
-- ─── Why the column becomes nullable ──────────────────────────────────────
--
-- A stored digest cannot be turned back into a token to email, so the token
-- is now minted at the moment it is SENT — `/send` and `/resend` both issue a
-- fresh one — rather than when the invitation row is created. An invitation
-- that has never been sent has no token at all: NULL, which matches nothing,
-- writes no hint row, and cannot be accepted. That is strictly better than
-- before, when an unsent invitation carried a live credential nobody had.
--

-- ─── 1. The new column ────────────────────────────────────────────────────

ALTER TABLE public.invitation ADD COLUMN token_sha256 bytea;

-- ─── 2. The trigger copies the digest instead of computing it ─────────────
--
-- Replaced BEFORE the backfill and before the old column is dropped. Before
-- the drop, because the previous body reads `NEW.token` and plpgsql resolves
-- that at run time, so dropping first would leave a trigger that fails on the
-- next write to `invitation`. Before the backfill, because the old body would
-- re-upsert a hint for every row the backfill touches — including the unsent
-- invitations § 3 deliberately leaves with no credential.
--
-- NULL handling is new. An invitation with no digest (created, never sent)
-- writes no hint row; one whose digest is cleared or rotated loses its old
-- hint, exactly as a reissue did before.

CREATE OR REPLACE FUNCTION better_auth.sync_invitation_tenant() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'better_auth', 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.token_sha256 IS NOT NULL THEN
      DELETE FROM better_auth.invitation_tenant
       WHERE token_sha256 = OLD.token_sha256;
    END IF;
    RETURN OLD;
  END IF;

  -- A reissued token must not leave the OLD digest resolving to a town. See
  -- 0002 for why a stale row is worth removing even though it is harmless.
  IF TG_OP = 'UPDATE'
     AND OLD.token_sha256 IS NOT NULL
     AND OLD.token_sha256 IS DISTINCT FROM NEW.token_sha256 THEN
    DELETE FROM better_auth.invitation_tenant
     WHERE token_sha256 = OLD.token_sha256;
  END IF;

  IF NEW.token_sha256 IS NOT NULL THEN
    INSERT INTO better_auth.invitation_tenant (token_sha256, town_id)
    VALUES (NEW.token_sha256, NEW.town_id)
    ON CONFLICT (token_sha256) DO UPDATE SET town_id = EXCLUDED.town_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ─── 3. Backfill ──────────────────────────────────────────────────────────
--
-- Same FORCE dance as 0002's backfill, for the same reason: this runs as the
-- table owner, and under FORCE ROW LEVEL SECURITY the owner is bound by the
-- tenancy policy like anyone else, so a plain UPDATE here would match zero
-- rows and succeed — every existing invitation would lose its only
-- credential, silently. See 0002 § Backfill for why `row_security = off` is
-- not the answer and why a non-owner fails loudly at the ALTER.
--
-- A SENT invitation keeps its token: someone is holding that link, and the
-- digest computed here is the one its hint row is already keyed on, so it
-- keeps working unchanged.
--
-- A NEVER-SENT invitation (`sent_at IS NULL`) gets NULL. Nobody legitimately
-- holds its token — it was never delivered — so the only people who could
-- present it are people who read it out of the database: exactly the
-- population `boardMember.roster` handed it to before PR #16. `/send` mints a
-- fresh one when an administrator sends it, so nothing is lost.
--
-- Hint rows are then pruned to the digests that survive. With the new
-- trigger in place the backfill writes no hint for a NULL digest, but it
-- cannot remove the hint 0002 already wrote for the old token; this does, and
-- takes any other stale row with it.
--
-- The first check is the one that matters, and it runs BEFORE anything is
-- written: `row_security_active` answers whether RLS still filters this
-- table for the current role. If it does — FORCE was not lifted, or this is
-- not the owner — the UPDATE below would match nothing, the prune would
-- delete every hint, and the column drop would finish the job: every sent
-- link dead, and a green migration. A count taken afterwards cannot catch
-- that, because it is blind in exactly the same way; that was measured, by
-- deleting the NO FORCE line and watching the later checks pass. This one
-- aborts instead.
--
-- The later checks run inside the window too, while the owner can still see
-- the rows; after FORCE is restored they would see none and prove nothing.

ALTER TABLE public.invitation NO FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF row_security_active('public.invitation') THEN
    RAISE EXCEPTION
      '0004: row level security still applies to public.invitation for role %, so the '
      'backfill would see no rows and silently strip every invitation''s credential. '
      'Run this migration as the table owner.', current_user;
  END IF;
END
$$;

UPDATE public.invitation
   SET token_sha256 = CASE
         WHEN sent_at IS NULL THEN NULL
         ELSE sha256(convert_to(token, 'UTF8'))
       END;

DELETE FROM better_auth.invitation_tenant h
 WHERE NOT EXISTS (
   SELECT 1 FROM public.invitation i WHERE i.token_sha256 = h.token_sha256
 );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.invitation WHERE sent_at IS NOT NULL AND token_sha256 IS NULL
  ) THEN
    RAISE EXCEPTION '0004: a sent invitation was left without a token digest';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.invitation i
     WHERE i.token_sha256 IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM better_auth.invitation_tenant h
                        WHERE h.token_sha256 = i.token_sha256 AND h.town_id = i.town_id)
  ) THEN
    RAISE EXCEPTION '0004: a sent invitation has no matching hint row, so its link would stop working';
  END IF;
END
$$;

ALTER TABLE public.invitation FORCE ROW LEVEL SECURITY;

-- ─── 4. The plaintext goes ────────────────────────────────────────────────
--
-- Dropping the column drops `invitation_token_key` and `idx_invitation_token`
-- with it. The unique constraint below replaces both: it is the uniqueness the
-- first enforced, and its index serves the equality lookup the second did.

ALTER TABLE public.invitation DROP COLUMN token;

ALTER TABLE public.invitation
  ADD CONSTRAINT invitation_token_sha256_key UNIQUE (token_sha256),
  ADD CONSTRAINT invitation_token_sha256_is_a_digest
    CHECK (token_sha256 IS NULL OR octet_length(token_sha256) = 32);

COMMENT ON COLUMN public.invitation.token_sha256 IS
  'sha256 of the invitation token. The token itself is never stored: it is minted when the invitation is sent, emailed, and presented back to POST /api/invitations/accept, which hashes it to find this row. NULL until the invitation is first sent.';
