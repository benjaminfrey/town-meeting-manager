--
-- ============================================================================
-- The public portal's tenant path
-- ============================================================================
-- Stage 1, Task D1b. Forward migration on top of 0001; 0000_baseline.sql and
-- 0001 are never edited in place.
--
-- ─── The problem this closes ──────────────────────────────────────────────
--
-- Phase B put every table in `public` under FORCE ROW LEVEL SECURITY with the
-- predicate `town_id = get_current_town_id()`. Phase C made an authenticated
-- session produce that setting. The public portal has no session and therefore
-- never got one, so every portal route ran on the SERVICE-ROLE Supabase client
-- (`plugins/supabase.ts`), which bypasses RLS outright — the portal, the one
-- surface where a mistake publishes a town's unpublished business, was the one
-- surface with no tenancy enforcement underneath it at all.
--
-- Giving the portal a tenant context needs one thing the rest of the system
-- gets from a session: a way to turn `<subdomain>.townmeetingmanager.com` into
-- a town id BEFORE any tenant context exists. That is a circularity of exactly
-- the shape `better_auth.user_tenant` solves for identities (see 0001 § 1) —
-- something has to be readable first.
--
-- ─── Contents ──────────────────────────────────────────────────────────────
--   Section 1  town_portal_subdomain_lookup — the door-opener, in RLS
--   Section 2  portal_search() — the draft/cancelled meeting exclusion
--
-- ============================================================================
-- SECTION 1 — THE DOOR-OPENER
-- ============================================================================
--
-- THE DECISION: a second, SELECT-only permissive policy on `public.town`,
-- keyed on a session setting the portal resolver sets and nothing else does.
--
-- WHAT WAS REJECTED, AND WHY
--
--   (a) A subdomain -> town_id table outside RLS, mirroring
--       `better_auth.user_tenant`. That works, but it makes `town.subdomain`
--       stop being the single source of truth: two rows must agree, a trigger
--       or an application transaction must keep them agreeing, and the failure
--       when they stop is that a portal serves the wrong town. `user_tenant`
--       is tolerable only because `resolveTenant()` treats it as a HINT and
--       re-verifies it through RLS (0001 § 3); there is nothing to re-verify
--       against here, because the copy WOULD be the lookup.
--
--   (b) A SECURITY DEFINER function. Under FORCE ROW LEVEL SECURITY a definer
--       function does not bypass anything unless its owner holds BYPASSRLS,
--       so this is not a smaller hammer than it looks — it is a request for a
--       role attribute that would then exist, permanently, for anything else
--       that wanted it. 0001 § 6 removed the last SECURITY DEFINER in this
--       schema for the same reason.
--
--   (c) Nothing at all: let the portal keep naming a town by the `:townId` in
--       its URL and bind the tenant to that. `/resolve?subdomain=` still needs
--       the reverse lookup, so this only moves the problem.
--
-- WHAT THIS POLICY EXPOSES, PRECISELY
--
-- Postgres ORs permissive policies, so for SELECT a row on `public.town` is
-- now visible when EITHER `id = get_current_town_id()` (the existing tenancy
-- policy, unchanged) OR its `subdomain` equals `app.portal_subdomain`. That
-- second branch reaches exactly one row — `town_subdomain_key` is unique — and
-- only in a transaction that set the setting. It cannot reach a town whose
-- `subdomain` is NULL, because `NULL = anything` is NULL, and it cannot reach
-- anything at all when the setting is unset, because
-- `nullif(current_setting(...), '')` is then NULL for the same reason. It fails
-- closed in both directions.
--
-- No other table gains anything. The resolver reads the id and the transaction
-- ends; the portal's actual work then runs in a normal `withTenant()`
-- transaction where `app.portal_subdomain` is NOT set and this policy is inert.
--
-- FOR SELECT, not FOR ALL, deliberately: the portal reads and never writes,
-- and a policy that let an unauthenticated caller UPDATE the town row it can
-- name would be a considerably larger thing than the one being asked for.
--
-- The `true` third argument to set_config is not optional here either — see
-- `packages/api/src/db/with-tenant.ts` for what a session-scoped setting does
-- to a pooled connection. `eslint-rules/no-session-scoped-set-config.js` makes
-- the other form a lint error on the TypeScript side.

CREATE POLICY town_portal_subdomain_lookup ON public.town
  FOR SELECT
  USING (
    subdomain IS NOT NULL
    AND subdomain = nullif(current_setting('app.portal_subdomain', true), '')
  );

COMMENT ON POLICY town_portal_subdomain_lookup ON public.town IS
  'Task D1b. Lets a SESSIONLESS public-portal request turn the subdomain nginx forwarded as X-Town-Subdomain into a town id, without any RLS bypass. Reaches exactly one row (town_subdomain_key is unique) and only inside a transaction that set app.portal_subdomain with SET LOCAL. Set by packages/api/src/auth/portal-tenant.ts and by nothing else. NOTE: this makes the town row readable to an unauthenticated caller who can name the subdomain, which is public by construction — it is the address of the town''s public website. Everything BEHIND the tenant context it produces is filtered to published rows by the portalCanSelect* predicates in src/trpc/authorization/rules.ts; do not reuse this path for anything those predicates do not gate.';

-- ============================================================================
-- SECTION 2 — portal_search() AND THE MEETINGS IT COULD SEE
-- ============================================================================
--
-- The baseline's `portal_search` filters minutes on `status = 'published'` and
-- agenda items on `m.agenda_status = 'published'`, but it never excludes the
-- meeting statuses every other portal route excludes (`draft`, `cancelled`).
--
-- For the minutes branch that is harmless: publishing minutes is its own
-- decision. For the agenda branch it is not. A meeting still in `draft` whose
-- agenda was published is hidden from `/portal/:townId/meetings`, hidden from
-- the calendar, and — from D1b — refused by `/agenda`, but full-text search
-- returned its title, its board, its date and a highlighted extract of its
-- agenda items. That is the town's unannounced business, served to the public,
-- through the one route nobody re-read because it is a function call rather
-- than a query.
--
-- The exclusion is a PARAMETER rather than a literal so the list stays owned
-- by `PORTAL_HIDDEN_MEETING_STATUSES` in
-- `src/trpc/authorization/rules.ts` — the same constant
-- `portalCanSelectMeeting()` is built from. Adding a status there changes
-- search too, instead of leaving a copy in SQL that is right until the day it
-- is not. The DEFAULT exists so a psql caller cannot get the unfiltered
-- behaviour back by omitting an argument.
--
-- DROP then CREATE, not CREATE OR REPLACE: the signature changes, and
-- `CREATE OR REPLACE` with a different argument list creates a SECOND
-- overload rather than replacing the first — which would leave the unfiltered
-- version callable and, worse, callable by accident.

DROP FUNCTION IF EXISTS public.portal_search(uuid, text, text, uuid, date, date, integer, integer);

CREATE FUNCTION public.portal_search(
  p_town_id uuid,
  p_query text,
  p_type text DEFAULT 'all'::text,
  p_board_id uuid DEFAULT NULL::uuid,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_hidden_meeting_statuses text[] DEFAULT ARRAY['draft', 'cancelled']
)
RETURNS TABLE(result_type text, meeting_id uuid, meeting_date date, board_name text, title text, snippet text, rank real, total_count bigint)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  tsq tsquery := plainto_tsquery('english', p_query);
BEGIN
  RETURN QUERY
  WITH results AS (
    -- Minutes results
    SELECT
      'minutes'::TEXT AS result_type,
      md.meeting_id,
      m.scheduled_date::DATE AS meeting_date,
      b.name AS board_name,
      m.title,
      ts_headline('english', extract_minutes_text(md.content_json), tsq,
        'MaxWords=40, MinWords=20, StartSel=<mark>, StopSel=</mark>') AS snippet,
      ts_rank(md.search_vector, tsq) AS rank
    FROM minutes_document md
    JOIN meeting m ON md.meeting_id = m.id
    JOIN board b ON m.board_id = b.id
    WHERE md.town_id = p_town_id
      AND md.status = 'published'
      AND md.search_vector @@ tsq
      AND NOT (m.status::text = ANY (p_hidden_meeting_statuses))
      AND (p_type = 'all' OR p_type = 'minutes')
      AND (p_board_id IS NULL OR m.board_id = p_board_id)
      AND (p_date_from IS NULL OR m.scheduled_date >= p_date_from)
      AND (p_date_to IS NULL OR m.scheduled_date <= p_date_to)

    UNION ALL

    -- Agenda results
    SELECT
      'agenda'::TEXT AS result_type,
      ai.meeting_id,
      m.scheduled_date::DATE AS meeting_date,
      b.name AS board_name,
      ai.title,
      ts_headline('english',
        coalesce(ai.title, '') || ' ' || coalesce(ai.background, '') || ' ' || coalesce(ai.description, ''),
        tsq,
        'MaxWords=40, MinWords=20, StartSel=<mark>, StopSel=</mark>') AS snippet,
      ts_rank(ai.search_vector, tsq) AS rank
    FROM agenda_item ai
    JOIN meeting m ON ai.meeting_id = m.id
    JOIN board b ON m.board_id = b.id
    WHERE ai.town_id = p_town_id
      AND m.agenda_status = 'published'
      AND ai.search_vector @@ tsq
      AND ai.parent_item_id IS NOT NULL  -- Only search actual items, not section headers
      AND NOT (m.status::text = ANY (p_hidden_meeting_statuses))
      AND (p_type = 'all' OR p_type = 'agenda')
      AND (p_board_id IS NULL OR m.board_id = p_board_id)
      AND (p_date_from IS NULL OR m.scheduled_date >= p_date_from)
      AND (p_date_to IS NULL OR m.scheduled_date <= p_date_to)
  )
  SELECT
    r.result_type,
    r.meeting_id,
    r.meeting_date,
    r.board_name,
    r.title,
    r.snippet,
    r.rank,
    count(*) OVER () AS total_count
  FROM results r
  ORDER BY r.rank DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.portal_search(uuid, text, text, uuid, date, date, integer, integer, text[]) IS
  'Full-text search over a town''s PUBLISHED minutes and PUBLISHED agendas, for the public portal. Task D1b added p_hidden_meeting_statuses (default draft, cancelled): the baseline version returned agenda hits for meetings the rest of the portal hides, which disclosed the title, date, board and agenda text of a meeting the town had not announced. Not SECURITY DEFINER — it runs as the caller, so RLS applies and app.town_id must already be set. The caller passes PORTAL_HIDDEN_MEETING_STATUSES from src/trpc/authorization/rules.ts so the rule has one owner.';

-- The baseline's ALTER DEFAULT PRIVILEGES already covers a function created
-- here by the same owner. Stated explicitly anyway: a grant that is implied by
-- a setting somewhere else is a grant nobody can find when it is missing.
GRANT EXECUTE ON FUNCTION public.portal_search(uuid, text, text, uuid, date, date, integer, integer, text[]) TO tmm_app;
