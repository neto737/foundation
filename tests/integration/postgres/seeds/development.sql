INSERT INTO tenants (id, name, created_at)
VALUES ('example-tenant', 'Example tenant', NOW())
ON CONFLICT (id) DO NOTHING;
