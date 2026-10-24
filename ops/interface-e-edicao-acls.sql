-- Aplicação administrativa separada, somente após a migration 0004.
-- Não executar em inicialização, CI contra banco persistente ou deploy.
-- Necessário para consultar a versão e editar somente o perfil cadastral.
-- Drizzle inclui DEFAULT de version na instrução INSERT existente.
GRANT INSERT (version) ON TABLE public.members TO levi_dev_runtime;
GRANT SELECT (version) ON TABLE public.members TO levi_dev_runtime;
GRANT UPDATE (name, birth_date, phone, email, joined_on, address, baptism_date,
  church_role, version) ON TABLE public.members TO levi_dev_runtime;
-- Histórico pessoal: runtime insere, sem poder consultar, alterar ou excluir.
GRANT INSERT (id, tenant_id, member_id, actor_id, version, previous_profile, created_at)
  ON TABLE public.member_profile_history TO levi_dev_runtime;
