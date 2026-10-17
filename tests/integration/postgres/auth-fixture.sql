-- Synthetic fixture, applied only to the Testcontainers database.
CREATE TABLE "user" (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL, image text,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE session (
  id text PRIMARY KEY, expires_at timestamptz NOT NULL, token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  ip_address text, user_agent text,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE TABLE account (
  id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token text, refresh_token text, id_token text,
  access_token_expires_at timestamptz, refresh_token_expires_at timestamptz,
  scope text, password text,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz, updated_at timestamptz
);
