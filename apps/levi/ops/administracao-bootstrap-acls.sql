-- Aplicação explícita pela migradora. O login levi_dev_bootstrap é provisionado
-- separadamente, sem ownership, memberships privilegiadas ou grant option.
-- CONNECT no banco-alvo é concedido separadamente após conferir sua identidade.
GRANT USAGE ON SCHEMA public, drizzle TO levi_dev_bootstrap;
GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO levi_dev_bootstrap;
GRANT SELECT (id, email, email_verified), UPDATE (updated_at)
  ON TABLE public."user" TO levi_dev_bootstrap;
GRANT SELECT (id, user_id, provider_id, account_id, password), UPDATE (updated_at)
  ON TABLE public.account TO levi_dev_bootstrap;
GRANT SELECT (id, user_id, created_at, expires_at), UPDATE (updated_at)
  ON TABLE public.session TO levi_dev_bootstrap;
-- UPDATE técnico acima permite locks FOR SHARE; não altera estado de identidade.
GRANT SELECT (user_id), INSERT (user_id, granted_at, granted_by, revoked_at, version)
  ON TABLE public.global_administrators TO levi_dev_bootstrap;
GRANT SELECT (id, bootstrapped_user_id, completed_at, operation_id),
  INSERT (id, bootstrapped_user_id, completed_at, operation_id)
  ON TABLE public.admin_bootstrap TO levi_dev_bootstrap;
GRANT INSERT (id, actor, action, target, tenant, timestamp, metadata, request_id, result)
  ON TABLE public.audit_events TO levi_dev_bootstrap;
