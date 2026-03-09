-- Set passwords for Supabase service roles.
-- The supabase/postgres image creates these roles during initialization;
-- this script ensures their passwords match POSTGRES_PASSWORD so that
-- GoTrue, PostgREST, Storage, and other services can connect.
--
-- Uses psql variable substitution: \set pgpass reads from PGPASSWORD env var.

\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_admin WITH PASSWORD :'pgpass';
