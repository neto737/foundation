CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  tenant TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  metadata TEXT NOT NULL CHECK (json_valid(metadata) AND json_type(metadata) = 'object'),
  request_id TEXT,
  result TEXT NOT NULL
);
CREATE INDEX audit_events_tenant_timestamp_idx ON audit_events(tenant, timestamp);
CREATE INDEX audit_events_request_id_idx ON audit_events(request_id) WHERE request_id IS NOT NULL;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
