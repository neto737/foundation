CREATE TABLE audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  tenant TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  request_id TEXT,
  result TEXT NOT NULL
);
CREATE INDEX audit_events_tenant_timestamp_idx ON audit_events(tenant, timestamp);
CREATE INDEX audit_events_request_id_idx ON audit_events(request_id) WHERE request_id IS NOT NULL;

CREATE FUNCTION reject_audit_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_event_mutation();
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_event_mutation();
