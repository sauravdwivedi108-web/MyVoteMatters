-- Web application support: admin sign-in and sessions.
SET ROLE vs_owner;
SET search_path = vs, public;

ALTER TABLE users ADD COLUMN password_hash text, ADD COLUMN display_name text;

-- Only a hash of the session token is stored.
CREATE TABLE sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash       text NOT NULL UNIQUE,
  user_id          uuid NOT NULL REFERENCES users(id),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz
);

-- Sign-in happens before a tenant is known, so membership lookup for one
-- user goes through this narrow function rather than opening the table.
CREATE FUNCTION vs.user_memberships(p_user_id uuid)
RETURNS TABLE (organization_id uuid, organization_name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vs, public AS $$
  SELECT m.organization_id, o.name, m.role FROM memberships m JOIN organizations o ON o.id = m.organization_id
   WHERE m.user_id = p_user_id AND m.status = 'active' AND o.status = 'active'
   ORDER BY o.name
$$;

GRANT SELECT, INSERT, UPDATE ON sessions TO vs_app;
GRANT UPDATE (password_hash, display_name) ON users TO vs_app;
GRANT EXECUTE ON FUNCTION vs.user_memberships(uuid) TO vs_app;
GRANT SELECT ON users TO vs_tally;

RESET ROLE;
