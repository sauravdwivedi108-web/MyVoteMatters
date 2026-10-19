-- Creditor votes can open by themselves at a chosen time and close by
-- themselves at the closing time. The record date is the opening date.
SET ROLE vs_owner;
SET search_path = vs, public;

ALTER TABLE elections ADD COLUMN auto_start boolean NOT NULL DEFAULT false;

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
       NEW.title, NEW.kind, NEW.record_date, NEW.organization_id, NEW.auto_start)
       IS DISTINCT FROM
       (OLD.title, OLD.kind, OLD.record_date, OLD.organization_id, OLD.auto_start) THEN
    RAISE EXCEPTION 'config_frozen: election configuration is locked' USING ERRCODE = 'P0001';
  END IF;
  -- The opening time is frozen too, except that a creditor vote started early
  -- by the administrator records the moment it actually opened.
  IF OLD.status NOT IN ('draft') AND NEW.starts_at IS DISTINCT FROM OLD.starts_at AND NOT (
       NEW.kind = 'creditor_vote' AND OLD.status = 'approved' AND NEW.status = 'open'
       AND NEW.starts_at < OLD.starts_at AND NEW.starts_at <= now()) THEN
    RAISE EXCEPTION 'config_frozen: election configuration is locked' USING ERRCODE = 'P0001';
  END IF;
  -- The closing time may only move later, only for a creditor vote that has not
  -- closed yet (an extension of the voting window). Every change is audited.
  IF OLD.status NOT IN ('draft') AND NEW.ends_at IS DISTINCT FROM OLD.ends_at AND NOT (
       NEW.kind = 'creditor_vote' AND OLD.status IN ('approved', 'open') AND NEW.status = OLD.status
       AND NEW.ends_at > OLD.ends_at AND NEW.ends_at > now()) THEN
    RAISE EXCEPTION 'config_frozen: the closing time can only be extended, before voting ends' USING ERRCODE = 'P0001';
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

-- Opens a locked meeting whose start time has come, or closes an open one
-- whose closing time has passed. Called whenever the meeting is looked at,
-- so no scheduler is needed. Each change is audited as the schedule.
CREATE FUNCTION vs.apply_schedule(p_election uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vs, public AS $$
DECLARE el elections;
BEGIN
  SELECT * INTO el FROM elections WHERE id = p_election AND kind = 'creditor_vote' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF el.status = 'approved' AND el.auto_start AND el.starts_at <= now() AND el.ends_at > now() THEN
    UPDATE elections SET status = 'open' WHERE id = el.id;
    PERFORM vs.audit(el.organization_id, 'system:schedule', 'election.open', 'election:' || el.id);
    RETURN 'open';
  END IF;
  IF el.status = 'open' AND el.ends_at <= now() THEN
    UPDATE elections SET status = 'closed' WHERE id = el.id;
    PERFORM vs.audit(el.organization_id, 'system:schedule', 'election.closed', 'election:' || el.id);
    RETURN 'closed';
  END IF;
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION vs.apply_schedule(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vs.apply_schedule(uuid) TO vs_app;
