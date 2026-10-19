-- On an open ballot a voter may look up their own recorded choices again,
-- after proving who they are with their voter ID and password.
SET ROLE vs_owner;
SET search_path = vs, public;

CREATE FUNCTION vs.own_open_vote(p_credential_hash text)
RETURNS TABLE (eligibility_ref text, choices jsonb, cast_at timestamptz, election_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vs, public AS $$
  SELECT e.eligibility_ref, v.choices, v.cast_at, v.election_id
    FROM voting_credentials c
    JOIN voter_eligibility e ON e.id = c.eligibility_id
    JOIN open_votes v ON v.eligibility_id = e.id AND v.election_id = c.election_id
   WHERE c.credential_hash = p_credential_hash AND c.revoked_at IS NULL AND c.organization_id = vs.current_org()
$$;

REVOKE EXECUTE ON FUNCTION vs.own_open_vote(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vs.own_open_vote(text) TO vs_app;
