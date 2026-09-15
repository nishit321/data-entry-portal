-- The audit trail becomes append-only, in the database rather than by convention.
--
-- `docs/OPERATIONS.md` states that `audit_logs` "is append-only and is never edited or pruned by
-- the application". That was true when written and nothing enforced it: a single
-- `auditLog.updateMany(...)` added in a hurry would have compiled, passed every test, and left no
-- trace of what it changed. For a regulator the trail is evidence, and evidence that can be
-- rewritten by the system that produced it is not worth much.
--
-- What this does NOT claim: a superuser can still disable a trigger or set
-- `session_replication_role`. That is why `npm run preflight` fails the deployment while the
-- application connects as the superuser — this control and that one are the same control, and it
-- is only finished when the application has a database role of its own.

CREATE OR REPLACE FUNCTION audit_logs_are_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only: % is not allowed on this table', TG_OP
    USING HINT = 'Correct a wrong entry by recording a new one. The trail is evidence, and an '
                 'entry that can be edited afterwards proves nothing.',
          ERRCODE = 'restrict_violation';
END;
$$;

-- Row-level, for UPDATE and DELETE.
DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_are_append_only();

DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_are_append_only();

-- Statement-level, for TRUNCATE — which fires no row triggers at all and would otherwise empty the
-- table in one statement while both triggers above sat there looking effective.
DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_are_append_only();
