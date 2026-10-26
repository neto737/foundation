-- Aplicação explícita e independente, após as migrations administrativas.
-- Não concede escrita no recibo ou alterações de identidade/memberships.
GRANT SELECT (user_id, granted_at, granted_by, revoked_at, version),
  INSERT (user_id, granted_at, granted_by, revoked_at, version),
  UPDATE (granted_at, granted_by, revoked_at, version)
  ON TABLE public.global_administrators TO levi_dev_runtime;
GRANT SELECT (id, key, policy, version, updated_at, updated_by),
  INSERT (id, key, policy, version, updated_at, updated_by),
  UPDATE (policy, version, updated_at, updated_by)
  ON TABLE public.feature_flags TO levi_dev_runtime;
GRANT SELECT (feature_flag_id, organization_id),
  INSERT (feature_flag_id, organization_id)
  ON TABLE public.feature_flag_organizations TO levi_dev_runtime;
-- DELETE é necessário apenas para substituir o conjunto selecionado.
GRANT DELETE ON TABLE public.feature_flag_organizations TO levi_dev_runtime;
