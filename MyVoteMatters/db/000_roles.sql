-- Creates the three database roles and lets the connecting login switch into
-- them (SET ROLE) without inheriting their privileges. Works on a managed
-- Postgres (Neon / Vercel Postgres) where the login has CREATEROLE but is not
-- a superuser.
--
-- On a single-credential deployment anyone holding DATABASE_URL can switch to
-- any of these roles, so the separation guards against application mistakes,
-- not against someone with the database password. Production for legally
-- significant votes should give each role its own login.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vs_owner') THEN CREATE ROLE vs_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vs_app')   THEN CREATE ROLE vs_app   NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vs_tally') THEN CREATE ROLE vs_tally NOLOGIN; END IF;
  EXECUTE format('GRANT vs_owner, vs_app, vs_tally TO %I WITH INHERIT FALSE, SET TRUE', current_user);
  EXECUTE format('GRANT CREATE ON DATABASE %I TO vs_owner', current_database());
END $$;
