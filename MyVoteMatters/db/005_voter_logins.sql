-- Voter login IDs for administrator-run meetings, and single-administrator
-- approval for creditor votes.
SET ROLE vs_owner;
SET search_path = vs, public;

CREATE OR REPLACE FUNCTION vs.guard_election() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status, NEW.status) IN (
         ('draft', 'pending_approval'), ('pending_approval', 'draft'),
         ('pending_approval', 'approved'), ('approved', 'open'),
         ('open', 'closed'), ('closed', 'tallied'), ('tallied', 'published'))) THEN
    RAISE EXCEPTION 'invalid_transition: % -> %', OLD.status, NEW.status USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status NOT IN ('draft') AND (
       NEW.title, NEW.kind, NEW.starts_at, NEW.ends_at, NEW.record_date, NEW.organization_id)
       IS DISTINCT FROM
       (OLD.title, OLD.kind, OLD.starts_at, OLD.ends_at, OLD.record_date, OLD.organization_id) THEN
    RAISE EXCEPTION 'config_frozen: election configuration is locked' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.tally_public_key IS NOT NULL AND (NEW.tally_public_key, NEW.approved_definition_hash)
       IS DISTINCT FROM (OLD.tally_public_key, OLD.approved_definition_hash) THEN
    RAISE EXCEPTION 'config_frozen: approved key and ballot hash are locked' USING ERRCODE = 'P0001';
  END IF;
  -- Only the counting worker can record that an election has been tallied.
  IF NEW.status = 'tallied' AND OLD.status <> 'tallied' AND current_user <> 'vs_tally' THEN
    RAISE EXCEPTION 'forbidden: only the tally worker can mark an election tallied' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'approved' AND OLD.status = 'pending_approval' THEN
    -- A creditor vote is run by one accountable administrator (e.g. the resolution
    -- professional), so self-approval is allowed there and recorded in the audit log.
    IF NEW.approved_by IS NULL OR (NEW.approved_by = OLD.submitted_by AND NEW.kind <> 'creditor_vote') THEN
      RAISE EXCEPTION 'maker_checker: approver must differ from submitter' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- A login ID names one entitlement in one meeting. The password is never
-- stored: the voting credential is derived from ID + password and only its
-- hash is kept in voting_credentials.
CREATE TABLE voter_logins (
  login_id         text PRIMARY KEY,
  organization_id  uuid NOT NULL,
  election_id      uuid NOT NULL,
  eligibility_id   uuid NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, eligibility_id) REFERENCES voter_eligibility(organization_id, id),
  FOREIGN KEY (organization_id, election_id) REFERENCES elections(organization_id, id)
);
ALTER TABLE voter_logins ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON voter_logins USING (organization_id = vs.current_org())
  WITH CHECK (organization_id = vs.current_org());
CREATE TRIGGER voter_logins_immutable BEFORE UPDATE OR DELETE ON voter_logins
  FOR EACH ROW EXECUTE FUNCTION vs.reject_change();

-- Voter sign-in happens before a tenant is known: resolve only the meeting a login ID belongs to.
CREATE FUNCTION vs.voter_login_lookup(p_login_id text)
RETURNS TABLE (organization_id uuid, election_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vs, public AS $$
  SELECT organization_id, election_id FROM voter_logins WHERE login_id = p_login_id
$$;

REVOKE ALL ON voter_logins FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vs.voter_login_lookup(text) FROM PUBLIC;
GRANT SELECT, INSERT ON voter_logins TO vs_app;
GRANT EXECUTE ON FUNCTION vs.voter_login_lookup(text) TO vs_app;
