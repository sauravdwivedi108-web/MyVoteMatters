-- Open (named) ballots for insolvency voting, e.g. a committee of creditors.
-- Here the administrator must see who voted for what, so each vote is also
-- recorded against the voter's entitlement. Secret-ballot election kinds are
-- unchanged: nothing is written here for them.
SET ROLE vs_owner;
SET search_path = vs, public;

ALTER TABLE elections DROP CONSTRAINT elections_kind_check;
ALTER TABLE elections ADD CONSTRAINT elections_kind_check
  CHECK (kind IN ('agm_resolutions', 'board_election', 'internal_poll', 'creditor_vote'));

CREATE TABLE open_votes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  election_id      uuid NOT NULL,
  eligibility_id   uuid NOT NULL,
  choices          jsonb NOT NULL,
  cast_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, eligibility_id) REFERENCES voter_eligibility(organization_id, id),
  FOREIGN KEY (organization_id, election_id) REFERENCES elections(organization_id, id),
  UNIQUE (election_id, eligibility_id)
);
ALTER TABLE open_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON open_votes USING (organization_id = vs.current_org())
  WITH CHECK (organization_id = vs.current_org());
CREATE TRIGGER open_votes_immutable BEFORE UPDATE OR DELETE ON open_votes
  FOR EACH ROW EXECUTE FUNCTION vs.reject_change();

-- A named vote can only be cast through cast_open_vote: at commit, every
-- entitlement used in a creditor vote must have its named record.
CREATE FUNCTION vs.require_open_vote() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vs, public AS $$
BEGIN
  IF (SELECT kind FROM elections WHERE id = NEW.election_id) = 'creditor_vote'
     AND NOT EXISTS (SELECT 1 FROM open_votes WHERE election_id = NEW.election_id AND eligibility_id = NEW.eligibility_id) THEN
    RAISE EXCEPTION 'open_vote_missing: a creditor vote must be recorded by name' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER consumption_needs_open_vote AFTER INSERT ON eligibility_consumptions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vs.require_open_vote();

CREATE FUNCTION vs.cast_open_vote(
  p_election_id uuid, p_credential_hash text, p_retry_tag text, p_receipt_commitment text,
  p_definition_version int, p_payload bytea, p_choices jsonb
) RETURNS cast_result
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vs, public AS $$
DECLARE
  r cast_result;
  elig uuid;
BEGIN
  IF (SELECT kind FROM elections WHERE id = p_election_id AND organization_id = vs.current_org()) IS DISTINCT FROM 'creditor_vote' THEN
    RETURN ROW('not_found', false)::cast_result;
  END IF;
  SELECT * INTO r FROM vs.cast_ballot(p_election_id, p_credential_hash, p_retry_tag, p_receipt_commitment, p_definition_version, p_payload);
  IF r.outcome = 'accepted' AND NOT r.replayed THEN
    SELECT eligibility_id INTO elig FROM voting_credentials WHERE credential_hash = p_credential_hash;
    INSERT INTO open_votes (organization_id, election_id, eligibility_id, choices)
    VALUES (vs.current_org(), p_election_id, elig, p_choices);
  END IF;
  RETURN r;
END $$;

-- Who has voted is visible while voting is open; what they chose only once it has closed.
CREATE FUNCTION vs.open_vote_report(p_election_id uuid)
RETURNS TABLE (eligibility_ref text, voting_units numeric, voted boolean, cast_at timestamptz, choices jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vs, public AS $$
  SELECT e.eligibility_ref, e.voting_units, c.id IS NOT NULL,
         CASE WHEN el.status IN ('closed', 'tallied', 'published') THEN v.cast_at END,
         CASE WHEN el.status IN ('closed', 'tallied', 'published') THEN v.choices END
    FROM voter_eligibility e
    JOIN elections el ON el.id = e.election_id AND el.kind = 'creditor_vote'
    LEFT JOIN eligibility_consumptions c ON c.eligibility_id = e.id AND c.election_id = e.election_id
    LEFT JOIN open_votes v ON v.eligibility_id = e.id AND v.election_id = e.election_id
   WHERE e.election_id = p_election_id AND e.status = 'eligible' AND e.organization_id = vs.current_org()
   ORDER BY e.voting_units DESC, e.eligibility_ref
$$;

-- On an open ballot the voter is shown who they are voting as, and their share of the roll.
CREATE FUNCTION vs.open_voter_context(p_credential_hash text)
RETURNS TABLE (eligibility_ref text, units_total numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vs, public AS $$
  SELECT e.eligibility_ref,
         (SELECT sum(x.voting_units) FROM voter_eligibility x WHERE x.election_id = e.election_id AND x.status = 'eligible')
    FROM voting_credentials c JOIN voter_eligibility e ON e.id = c.eligibility_id
    JOIN elections el ON el.id = c.election_id AND el.kind = 'creditor_vote'
   WHERE c.credential_hash = p_credential_hash AND c.revoked_at IS NULL AND c.organization_id = vs.current_org()
$$;

REVOKE ALL ON open_votes FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vs.cast_open_vote(uuid, text, text, text, int, bytea, jsonb), vs.open_vote_report(uuid),
  vs.require_open_vote(), vs.open_voter_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vs.cast_open_vote(uuid, text, text, text, int, bytea, jsonb), vs.open_vote_report(uuid),
  vs.open_voter_context(text) TO vs_app;
