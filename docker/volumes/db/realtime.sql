-- Create the _realtime schema and grant permissions.
-- Required for the Supabase Realtime service to run its migrations.

CREATE SCHEMA IF NOT EXISTS _realtime;
ALTER SCHEMA _realtime OWNER TO supabase_admin;
