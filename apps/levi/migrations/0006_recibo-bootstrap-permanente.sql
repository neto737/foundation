-- O recibo não pode ser alterado, excluído ou truncado por operações normais.
-- Sem FK/cascade para user; restauração de banco exige decisão operacional própria.
CREATE FUNCTION public.reject_admin_bootstrap_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Recibo administrativo permanente';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER admin_bootstrap_permanent
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.admin_bootstrap
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_admin_bootstrap_mutation();
