-- Migration: Trigger Functions
-- set_updated_at, record_status_change, notify_new_build_failure, notify_new_activity

-- ============================================================
-- set_updated_at()
-- Automatically sets updated_at = now() on every UPDATE.
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_builds_updated_at
  BEFORE UPDATE ON builds
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- record_status_change()
-- On ticket status change:
--   1. Inserts a ticket_updated activity with old/new status in metadata.
--   2. Sets resolved_at when status moves to 'resolved'.
--   3. Sets verified_at when status moves to 'verified'.
--   4. Clears resolved_at/verified_at if status regresses.
-- ============================================================

CREATE OR REPLACE FUNCTION record_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Record the status transition as an activity
    INSERT INTO activities (activity_type, title, description, ticket_id, actor, metadata)
    VALUES (
      'ticket_updated',
      format('Ticket #%s status changed to %s', NEW.ticket_number, NEW.status),
      format('Status changed from %s to %s', OLD.status, NEW.status),
      NEW.id,
      NEW.assignee,                       -- best-effort actor attribution
      jsonb_build_object(
        'old_status', OLD.status::text,
        'new_status', NEW.status::text
      )
    );

    -- Set resolved_at when entering 'resolved'
    IF NEW.status = 'resolved' AND OLD.status <> 'resolved' THEN
      NEW.resolved_at = now();
    END IF;

    -- Clear resolved_at if regressing from resolved/verified
    IF NEW.status NOT IN ('resolved', 'verified')
       AND OLD.status IN ('resolved', 'verified') THEN
      NEW.resolved_at = NULL;
    END IF;

    -- Set verified_at when entering 'verified'
    IF NEW.status = 'verified' AND OLD.status <> 'verified' THEN
      NEW.verified_at = now();
    END IF;

    -- Clear verified_at if regressing from verified
    IF NEW.status <> 'verified' AND OLD.status = 'verified' THEN
      NEW.verified_at = NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ticket_status_change
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION record_status_change();

-- ============================================================
-- notify_new_build_failure()
-- Fires after a build with status = 'failure' is inserted.
-- Uses pg_notify to signal the triage Edge Function.
-- ============================================================

CREATE OR REPLACE FUNCTION notify_new_build_failure()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'failure' THEN
    PERFORM pg_notify(
      'build_failure',
      json_build_object(
        'build_id', NEW.id,
        'job_name', NEW.job_name,
        'source',   NEW.source
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_build_failure_notify
  AFTER INSERT ON builds
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_build_failure();

-- ============================================================
-- notify_new_activity()
-- Fires after an activity is inserted.
-- Signals the notify Edge Function via pg_notify.
-- ============================================================

CREATE OR REPLACE FUNCTION notify_new_activity()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'new_activity',
    json_build_object(
      'activity_id',   NEW.id,
      'activity_type', NEW.activity_type,
      'ticket_id',     NEW.ticket_id,
      'build_id',      NEW.build_id
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_activity_notify
  AFTER INSERT ON activities
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_activity();

-- ============================================================
-- dedup_triage_check(p_error_signature)
-- Called by the triage Edge Function to atomically check for
-- existing open tickets with the same error_signature while
-- holding an advisory lock to prevent duplicate ticket creation.
-- ============================================================

CREATE OR REPLACE FUNCTION dedup_triage_check(p_error_signature TEXT)
RETURNS TABLE (id UUID, ticket_number INT) AS $$
BEGIN
  -- Acquire an advisory lock based on the error signature hash
  -- to serialize concurrent triage invocations for the same failure
  PERFORM pg_advisory_xact_lock(hashtext(p_error_signature));

  RETURN QUERY
    SELECT st.id, st.ticket_number
    FROM support_tickets st
    WHERE st.error_signature = p_error_signature
      AND st.status NOT IN ('resolved', 'verified')
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
