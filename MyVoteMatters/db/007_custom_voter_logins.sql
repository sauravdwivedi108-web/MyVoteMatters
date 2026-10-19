-- Lets the administrator choose a voter's login ID and password when adding
-- them. The password is never stored: only the hash of the credential derived
-- from ID + password is kept until the meeting is locked and IDs are issued.
SET ROLE vs_owner;
SET search_path = vs, public;

CREATE TABLE voter_login_choices (
  eligibility_id   uuid PRIMARY KEY,
  organization_id  uuid NOT NULL,
  election_id      uuid NOT NULL,
  login_id         text NOT NULL UNIQUE,
  credential_hash  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, eligibility_id) REFERENCES voter_eligibility(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, election_id) REFERENCES elections(organization_id, id) ON DELETE CASCADE
);
ALTER TABLE voter_login_choices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON voter_login_choices USING (organization_id = vs.current_org())
  WITH CHECK (organization_id = vs.current_org());

-- Login IDs are unique across every organisation, chosen or generated.
CREATE FUNCTION vs.login_id_taken(p_login_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vs, public AS $$
  SELECT EXISTS (SELECT 1 FROM voter_logins WHERE login_id = p_login_id)
      OR EXISTS (SELECT 1 FROM voter_login_choices WHERE login_id = p_login_id)
$$;

REVOKE ALL ON voter_login_choices FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vs.login_id_taken(text) FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON voter_login_choices TO vs_app;
GRANT EXECUTE ON FUNCTION vs.login_id_taken(text) TO vs_app;
