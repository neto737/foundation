-- UPDATE em uma coluna permite FOR SHARE, mas não deve permitir mutação pela runtime DEV.
-- Sem GRANTs: a concessão mínima e a aplicação persistente são operações separadas.
CREATE FUNCTION public.reject_dev_runtime_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF current_user = 'levi_dev_runtime' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'A runtime DEV não pode atualizar estes registros';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER churches_reject_dev_runtime_update
BEFORE UPDATE ON public.churches
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_dev_runtime_update();
--> statement-breakpoint
CREATE TRIGGER tenant_memberships_reject_dev_runtime_update
BEFORE UPDATE ON public.tenant_memberships
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_dev_runtime_update();
