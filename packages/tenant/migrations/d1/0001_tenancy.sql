CREATE TABLE tenants (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE tenant_memberships (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX tenant_memberships_tenant_user_unique ON tenant_memberships(tenant_id, user_id);
CREATE INDEX tenant_memberships_user_idx ON tenant_memberships(user_id);
CREATE TABLE tenant_invitations (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, email TEXT NOT NULL, role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, accepted_at INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX tenant_invitations_email_idx ON tenant_invitations(email);
CREATE TABLE tenant_sessions (session_id TEXT PRIMARY KEY NOT NULL, active_tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL, updated_at INTEGER NOT NULL);
