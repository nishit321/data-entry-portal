-- The audit trail keeps the actor's identity even after the account is gone.
--
-- Found by the append-only triggers, which is what an instrument is for. `audit_logs.actor_id`
-- carries `ON DELETE SET NULL`, so hard-deleting a user issued an UPDATE across their audit rows
-- and left every one of them saying nobody did it. That is precisely the erasure an audit trail
-- exists to prevent: remove the account, and the record no longer names who acted.
--
-- In production users are soft-deleted, so this had almost certainly never happened. "Almost
-- certainly had not" is not a control.
--
-- The fix is to stop the identity depending on another row at all: the email and the name are
-- copied onto the record when it is written. That also fixes a quieter problem — a joined name
-- shows who that person *is now*, and an audit trail should show who they were at the time.

-- The guards come off for the backfill and go back on below, because the backfill is itself an
-- UPDATE and the existing trigger refuses it. That refusal is the guard working, not a nuisance:
-- the only way to edit this table is a migration that says out loud that it is doing so.
DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_email TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_name TEXT;

-- Existing rows, from the accounts that still exist. Rows whose actor is already gone stay null:
-- that history cannot be recovered, and inventing it would be worse than admitting it.
UPDATE audit_logs a
SET actor_email = u.email,
    actor_name  = NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '')
FROM users u
WHERE a.actor_id = u.id
  AND a.actor_email IS NULL;

-- The guard is narrowed rather than relaxed.
--
-- Exactly one UPDATE is now allowed: `actor_id` going to NULL when the account is removed, with
-- every other column untouched. It is safe only because of the two columns above — the row still
-- names the person. Any other edit, and any delete or truncate, is still refused.
CREATE OR REPLACE FUNCTION audit_logs_are_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.actor_id IS NOT NULL
     AND NEW.actor_id IS NULL
     AND NEW.action IS NOT DISTINCT FROM OLD.action
     AND NEW.entity_type IS NOT DISTINCT FROM OLD.entity_type
     AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
     AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
     AND NEW.ip_address IS NOT DISTINCT FROM OLD.ip_address
     AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
     AND NEW.request_id IS NOT DISTINCT FROM OLD.request_id
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND NEW.actor_email IS NOT DISTINCT FROM OLD.actor_email
     AND NEW.actor_name IS NOT DISTINCT FROM OLD.actor_name
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'audit_logs is append-only: % is not allowed on this table', TG_OP
    USING HINT = 'Correct a wrong entry by recording a new one. The trail is evidence, and an '
                 'entry that can be edited afterwards proves nothing.',
          ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_are_append_only();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_are_append_only();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_are_append_only();
