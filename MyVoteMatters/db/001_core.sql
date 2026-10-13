-- VoteSphere voting core: schema, tenant isolation, ballot secrecy boundary,
-- immutability rules and the atomic cast-ballot path.
--
-- Roles (created by db/000_roles.sql):
--   vs_owner  owns every object; never used by the running application.
--   vs_app    the API process: admin + identity path. Cannot read ballots.
--   vs_tally  the counting worker: can read ballots only after close.
--
-- Every tenant table carries organization_id and has row-level security keyed
-- on the session setting app.org_id, which the API sets per request from the
-- authenticated membership (never from a client-supplied value).

SET ROLE vs_owner;

CREATE SCHEMA vs AUTHORIZATION vs_owner;
SET search_path = vs, public;

CREATE FUNCTION vs.current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- A. Organisations and access
-- ---------------------------------------------------------------------------

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized  text NOT NULL UNIQUE,
  status            text NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  user_id          uuid NOT NULL REFERENCES users(id),
  role             text NOT NULL CHECK (role IN ('owner', 'election_admin', 'approver', 'scrutinizer', 'viewer')),
  status           text NOT NULL DEFAULT 'active',
  UNIQUE (organization_id, user_id)
);

-- ---------------------------------------------------------------------------
-- B. Elections and eligibility
-- ---------------------------------------------------------------------------

CREATE TABLE elections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  title            text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('agm_resolutions', 'board_election', 'internal_poll')),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN
                     ('draft', 'pending_approval', 'approved', 'open', 'closed', 'tallied', 'published')),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  timezone         text NOT NULL DEFAULT 'Asia/Kolkata',
  record_date      date,
  created_by       uuid NOT NULL REFERENCES users(id),
  submitted_by     uuid REFERENCES users(id),
  approved_by      uuid REFERENCES users(id),
  approved_definition_hash text,
  -- Public half of the tally key. The private half never enters the database.
  tally_public_key text,
  CHECK (ends_at > starts_at),
  UNIQUE (organization_id, id)
);

-- Frozen ballot content. Exactly one published version per election.
CREATE TABLE ballot_definitions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  election_id      uuid NOT NULL,
  version          int  NOT NULL,
  definition       jsonb NOT NULL,
  definition_hash  text NOT NULL,
  published_at     timestamptz,
  FOREIGN KEY (organization_id, election_id) REFERENCES elections(organization_id, id),
  UNIQUE (election_id, version)
);
CREATE UNIQUE INDEX one_published_definition ON ballot_definitions(election_id) WHERE published_at IS NOT NULL;

-- One row per voting entitlement (not per person: a shareholder can hold
-- several entitlements, e.g. separate folios or share classes).
CREATE TABLE voter_eligibility (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  election_id      uuid NOT NULL,
  eligibility_ref  text NOT NULL,              -- folio / client id / member no.
  voting_units     numeric(20, 0) NOT NULL CHECK (voting_units > 0),
  status           text NOT NULL DEFAULT 'eligible' CHECK (status IN ('eligible', 'withdrawn')),
  FOREIGN KEY (organization_id, election_id) REFERENCES elections(organization_id, id),
  UNIQUE (election_id, eligibility_ref),
  UNIQUE (organization_id, id)
);

-- Only a hash of the voter's credential is stored; the secret goes to the voter.
CREATE TABLE voting_credentials (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  election_id      uuid NOT NULL,
  eligibility_id   uuid NOT NULL,
  credential_hash  text NOT NULL UNIQUE,
  revoked_at       timestamptz,
  FOREIGN KEY (organization_id, eligibility_id) REFERENCES voter_eligibility(organization_id, id),
  FOREIGN KEY (organization_id, election_id) REFERENCES elections(organization_id, id)
);
CREATE UNIQUE INDEX one_live_credential ON voting_credentials(eligibility_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- C. Voting. The identity side (consumptions) and the ballot side
-- (ballot_submissions, vote_receipts) share no key, no reference and no
-- per-row timestamp, so they cannot be joined to reveal a voter's choice.
-- ---------------------------------------------------------------------------

-- Identity side: "this entitlement has voted". The UNIQUE constraint is the
-- one-vote guarantee. retry_tag = HMAC(credential secret, payload hash): it
-- lets a retry with the same ballot be recognised, but without the voter's
-- secret nobody can link it to a ballot row.
CREATE TABLE eligibility_consumptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  election_id      uuid NOT NULL,
  eligibility_id   uuid NOT NULL,
  retry_tag        text NOT NULL,
  consumed_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, eligibility_id) REFERENCES voter_eligibility(organization_id, id),
  UNIQUE (election_id, eligibility_id)
);

-- Ballot side: encrypted payload only. Rows have random ids and no timestamp.
CREATE TABLE ballot_submissions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL,
  election_id        uuid NOT NULL,
  definition_version int  NOT NULL,
  encrypted_payload  bytea NOT NULL CHECK (octet_length(encrypted_payload) <= 65536),
  payload_hash       text NOT NULL UNIQUE,
  FOREIGN KEY (organization_id, election_id) REFERENCES elections(organization_id, id)
);

-- Receipt commitments, unlinked to both voter and ballot.
CREATE TABLE vote_receipts (
  receipt_commitment text PRIMARY KEY,
  organization_id    uuid NOT NULL,
  election_id        uuid NOT NULL,
  FOREIGN KEY (organization_id, election_id) REFERENCES elections(organization_id, id)
);

CREATE TABLE tally_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  election_id          uuid NOT NULL,
  definition_hash      text NOT NULL,
  input_manifest_hash  text NOT NULL,
  ballot_count         int  NOT NULL,
  result               jsonb NOT NULL,
  result_hash          text NOT NULL,
  completed_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, election_id) REFERENCES elections(organization_id, id)
);

-- ---------------------------------------------------------------------------
-- D. Tamper-evident audit log (hash chain per organisation)
-- ---------------------------------------------------------------------------

CREATE TABLE audit_events (
  seq              bigserial PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  actor_ref        text NOT NULL,
  action           text NOT NULL,
  resource_ref     text NOT NULL,
  detail           jsonb NOT NULL DEFAULT '{}',
  event_time       timestamptz NOT NULL DEFAULT now(),
  prev_hash        text NOT NULL,
  hash             text NOT NULL
);

CREATE FUNCTION vs.audit_event_hash(e audit_events) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(
    e.prev_hash || '|' || e.organization_id || '|' || e.actor_ref || '|' || e.action || '|' ||
    e.resource_ref || '|' || e.detail::text || '|' || to_char(e.event_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
  'UTF8')), 'hex')
$$;

CREATE FUNCTION vs.audit_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vs, public AS $$
BEGIN
  -- Serialise appends per organisation so the chain stays linear.
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || NEW.organization_id));
  SELECT coalesce((SELECT hash FROM vs.audit_events WHERE organization_id = NEW.organization_id
                   ORDER BY seq DESC LIMIT 1), 'genesis')
    INTO NEW.prev_hash;
  NEW.event_time := now();
  NEW.hash := vs.audit_event_hash(NEW);
  RETURN NEW;
END $$;
CREATE TRIGGER audit_chain BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION vs.audit_chain();

-- Returns the first broken seq, or NULL if the chain is intact.
CREATE FUNCTION vs.verify_audit_chain(org uuid) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = vs, public AS $$
DECLARE e audit_events; expected_prev text := 'genesis';
BEGIN
  FOR e IN SELECT * FROM audit_events WHERE organization_id = org ORDER BY seq LOOP
    IF e.prev_hash <> expected_prev OR e.hash <> vs.audit_event_hash(e) THEN
      RETURN e.seq;
    END IF;
    expected_prev := e.hash;
  END LOOP;
  RETURN NULL;
END $$;

CREATE FUNCTION vs.audit(org uuid, actor text, act text, res text, det jsonb DEFAULT '{}') RETURNS void
LANGUAGE sql AS $$
  INSERT INTO vs.audit_events (organization_id, actor_ref, action, resource_ref, detail, prev_hash, hash)
  VALUES (org, actor, act, res, det, '', '')
$$;

-- ---------------------------------------------------------------------------
-- Immutability and lifecycle rules
-- ---------------------------------------------------------------------------

CREATE FUNCTION vs.reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable_record: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER ballots_immutable BEFORE UPDATE OR DELETE ON ballot_submissions
  FOR EACH ROW EXECUTE FUNCTION vs.reject_change();
CREATE TRIGGER receipts_immutable BEFORE UPDATE OR DELETE ON vote_receipts
  FOR EACH ROW EXECUTE FUNCTION vs.reject_change();
CREATE TRIGGER consumptions_immutable BEFORE UPDATE OR DELETE ON eligibility_consumptions
  FOR EACH ROW EXECUTE FUNCTION vs.reject_change();
CREATE TRIGGER tally_immutable BEFORE UPDATE OR DELETE ON tally_runs
  FOR EACH ROW EXECUTE FUNCTION vs.reject_change();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION vs.reject_change();

CREATE FUNCTION vs.guard_definition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'immutable_record: published ballot definition cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER definition_guard BEFORE UPDATE OR DELETE ON ballot_definitions
  FOR EACH ROW EXECUTE FUNCTION vs.guard_definition();

-- The voter roll is frozen once an election leaves draft.
CREATE FUNCTION vs.guard_roll() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vs, public AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM vs.elections WHERE id = coalesce(NEW.election_id, OLD.election_id);
  IF st <> 'draft' THEN
    RAISE EXCEPTION 'roll_frozen: voter roll cannot change while election is %', st USING ERRCODE = 'P0001';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER roll_guard BEFORE INSERT OR UPDATE OR DELETE ON voter_eligibility
  FOR EACH ROW EXECUTE FUNCTION vs.guard_roll();
CREATE TRIGGER definition_roll_guard BEFORE INSERT ON ballot_definitions
  FOR EACH ROW EXECUTE FUNCTION vs.guard_roll();

-- Election state machine, plus: configuration fields freeze after draft.
CREATE FUNCTION vs.guard_election() RETURNS trigger
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
    IF NEW.approved_by IS NULL OR NEW.approved_by = OLD.submitted_by THEN
      RAISE EXCEPTION 'maker_checker: approver must differ from submitter' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER election_guard BEFORE UPDATE ON elections
  FOR EACH ROW EXECUTE FUNCTION vs.guard_election();
CREATE TRIGGER election_no_delete BEFORE DELETE ON elections
  FOR EACH ROW WHEN (OLD.status <> 'draft') EXECUTE FUNCTION vs.reject_change();

-- ---------------------------------------------------------------------------
-- The atomic cast path. vs_app can call this but cannot touch the ballot
-- tables directly. Consumption, ballot and receipt commit in one transaction,
-- so a failure can never consume an entitlement without storing the vote.
--
-- The caller passes only hashes derived from the voter's credential secret;
-- the secret itself never reaches the database.
-- ---------------------------------------------------------------------------

CREATE TYPE cast_result AS (outcome text, replayed boolean);

CREATE FUNCTION vs.cast_ballot(
  p_election_id        uuid,
  p_credential_hash    text,
  p_retry_tag          text,
  p_receipt_commitment text,
  p_definition_version int,
  p_payload            bytea
) RETURNS cast_result
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vs, public AS $$
DECLARE
  org  uuid := vs.current_org();
  cred voting_credentials;
  elig voter_eligibility;
  el   elections;
  prior eligibility_consumptions;
  pub_version int;
BEGIN
  IF org IS NULL THEN RAISE EXCEPTION 'no_tenant' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO el FROM elections WHERE id = p_election_id AND organization_id = org FOR SHARE;
  IF NOT FOUND THEN RETURN ROW('not_found', false)::cast_result; END IF;

  SELECT * INTO cred FROM voting_credentials
   WHERE credential_hash = p_credential_hash AND election_id = el.id AND organization_id = org;
  IF NOT FOUND OR cred.revoked_at IS NOT NULL THEN RETURN ROW('invalid_credential', false)::cast_result; END IF;

  -- Lock the entitlement so concurrent submissions serialise here.
  SELECT * INTO elig FROM voter_eligibility WHERE id = cred.eligibility_id FOR UPDATE;
  IF elig.status <> 'eligible' THEN RETURN ROW('not_eligible', false)::cast_result; END IF;

  SELECT * INTO prior FROM eligibility_consumptions
   WHERE election_id = el.id AND eligibility_id = elig.id;
  IF FOUND THEN
    -- A retry of the same ballot (e.g. response lost after commit) succeeds
    -- again without creating anything; a different ballot is refused.
    IF prior.retry_tag = p_retry_tag THEN RETURN ROW('accepted', true)::cast_result; END IF;
    RETURN ROW('already_voted', false)::cast_result;
  END IF;

  IF el.status <> 'open' OR now() < el.starts_at OR now() >= el.ends_at THEN
    RETURN ROW('voting_closed', false)::cast_result;
  END IF;

  SELECT version INTO pub_version FROM ballot_definitions
   WHERE election_id = el.id AND published_at IS NOT NULL;
  IF pub_version IS DISTINCT FROM p_definition_version THEN
    RETURN ROW('stale_ballot', false)::cast_result;
  END IF;

  INSERT INTO eligibility_consumptions (organization_id, election_id, eligibility_id, retry_tag)
  VALUES (org, el.id, elig.id, p_retry_tag);

  INSERT INTO ballot_submissions (organization_id, election_id, definition_version, encrypted_payload, payload_hash)
  VALUES (org, el.id, p_definition_version, p_payload, encode(sha256(p_payload), 'hex'));

  INSERT INTO vote_receipts (receipt_commitment, organization_id, election_id)
  VALUES (p_receipt_commitment, org, el.id);

  RETURN ROW('accepted', false)::cast_result;
END $$;

-- Lets the API learn what a credential entitles before it builds the ballot.
CREATE FUNCTION vs.credential_context(p_credential_hash text)
RETURNS TABLE (election_id uuid, voting_units numeric, already_voted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vs, public AS $$
  SELECT c.election_id, e.voting_units,
         EXISTS (SELECT 1 FROM eligibility_consumptions x WHERE x.eligibility_id = e.id)
    FROM voting_credentials c JOIN voter_eligibility e ON e.id = c.eligibility_id
   WHERE c.credential_hash = p_credential_hash AND c.revoked_at IS NULL
     AND c.organization_id = vs.current_org() AND e.status = 'eligible'
$$;

CREATE FUNCTION vs.verify_receipt(p_election_id uuid, p_commitment text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vs, public AS $$
  SELECT EXISTS (SELECT 1 FROM vote_receipts
                  WHERE election_id = p_election_id AND receipt_commitment = p_commitment
                    AND organization_id = vs.current_org())
$$;

-- Turnout is identity-side and safe to show while voting is open.
CREATE FUNCTION vs.turnout(p_election_id uuid)
RETURNS TABLE (eligible bigint, voted bigint, units_eligible numeric, units_voted numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vs, public AS $$
  SELECT count(*), count(c.id), coalesce(sum(e.voting_units), 0),
         coalesce(sum(e.voting_units) FILTER (WHERE c.id IS NOT NULL), 0)
    FROM voter_eligibility e
    LEFT JOIN eligibility_consumptions c ON c.eligibility_id = e.id
   WHERE e.election_id = p_election_id AND e.status = 'eligible'
     AND e.organization_id = vs.current_org()
$$;

-- Ballots leave the ballot box only after close, in hash order (never
-- insertion order), to the tally worker.
CREATE FUNCTION vs.tally_input(p_election_id uuid)
RETURNS TABLE (payload_hash text, encrypted_payload bytea, definition_version int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = vs, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM elections WHERE id = p_election_id
                   AND organization_id = vs.current_org() AND status = 'closed') THEN
    RAISE EXCEPTION 'results_suppressed: election is not closed' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY SELECT b.payload_hash, b.encrypted_payload, b.definition_version
                 FROM ballot_submissions b WHERE b.election_id = p_election_id
                ORDER BY b.payload_hash;
END $$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['memberships', 'elections', 'ballot_definitions', 'voter_eligibility',
                           'voting_credentials', 'eligibility_consumptions', 'ballot_submissions',
                           'vote_receipts', 'tally_runs', 'audit_events'] LOOP
    EXECUTE format('ALTER TABLE vs.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON vs.%I USING (organization_id = vs.current_org())
                    WITH CHECK (organization_id = vs.current_org())', t);
  END LOOP;
END $$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON organizations USING (id = vs.current_org());

-- ---------------------------------------------------------------------------
-- Grants. Note what vs_app does NOT get: any access to ballot_submissions,
-- vote_receipts or eligibility_consumptions, and no UPDATE/DELETE on records
-- that must stay immutable.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA vs TO vs_app, vs_tally;
REVOKE ALL ON ALL TABLES IN SCHEMA vs FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA vs FROM PUBLIC;

GRANT SELECT, INSERT ON organizations, users TO vs_app;
GRANT SELECT, INSERT, UPDATE ON memberships TO vs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON elections, ballot_definitions, voter_eligibility TO vs_app;
GRANT SELECT, INSERT, UPDATE ON voting_credentials TO vs_app;
GRANT SELECT ON tally_runs TO vs_app;
GRANT SELECT, INSERT ON audit_events TO vs_app;
GRANT USAGE ON SEQUENCE audit_events_seq_seq TO vs_app, vs_tally;

GRANT EXECUTE ON FUNCTION vs.current_org(), vs.audit(uuid, text, text, text, jsonb),
  vs.audit_event_hash(audit_events), vs.verify_audit_chain(uuid),
  vs.cast_ballot(uuid, text, text, text, int, bytea), vs.credential_context(text),
  vs.verify_receipt(uuid, text), vs.turnout(uuid) TO vs_app;

GRANT SELECT ON elections, ballot_definitions TO vs_tally;
GRANT UPDATE (status) ON elections TO vs_tally;
GRANT SELECT, INSERT ON tally_runs TO vs_tally;
GRANT INSERT ON audit_events TO vs_tally;
GRANT EXECUTE ON FUNCTION vs.current_org(), vs.audit(uuid, text, text, text, jsonb),
  vs.audit_event_hash(audit_events), vs.tally_input(uuid), vs.turnout(uuid) TO vs_tally;

RESET ROLE;
