-- ============================================================
-- Town Meeting Manager — Database Initialization
-- ============================================================
-- This script runs on first database initialization only
-- (when the data directory is empty).
--
-- The supabase/postgres image already creates core roles
-- (anon, authenticated, service_role, supabase_admin, etc.)
-- and enables common extensions. This script adds
-- project-specific extensions.
-- ============================================================

-- Enable PostGIS for Phase 3 parcel/geospatial features
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Enable UUID generation (may already be enabled by supabase/postgres)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable JWT functions (may already be enabled by supabase/postgres)
CREATE EXTENSION IF NOT EXISTS "pgjwt";

-- Enable cryptographic functions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enable query statistics for performance monitoring
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- ============================================================
-- PowerSync logical replication publication
-- ============================================================
-- PowerSync uses PostgreSQL logical replication to stream changes.
-- Creating the publication at init time (FOR ALL TABLES) means
-- any tables created later (session 01.05+) are automatically included.
-- Requires wal_level=logical (set in docker-compose db command).
CREATE PUBLICATION powersync FOR ALL TABLES;

-- ============================================================
-- Verify extensions are installed
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '=== Town Meeting Manager: Extension verification ===';
END
$$;

SELECT extname, extversion FROM pg_extension ORDER BY extname;
