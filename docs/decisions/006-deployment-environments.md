# ADR-006: Deploy DEV automático e PROD manual

- Status: aceito
- Escopo: v0.1

## Contexto

O fluxo é inicialmente remoto, mas produção exige uma barreira explícita contra
promoção acidental. DEV e PROD não podem compartilhar recursos ou secrets.

## Decisão

Após os gates de lint, typecheck, testes e build, merges na branch principal
fazem deploy automático no ambiente Cloudflare DEV. PROD é implantado somente
por workflow manual, que exige um ref de código explícito (preferencialmente
commit SHA ou tag imutável), seleção de `prod`, permissões de ambiente e
confirmação inequívoca. O workflow resolve e registra o ref e implanta
exatamente essa revisão. Não há promoção implícita baseada apenas em branch, tag
ou conclusão do deploy DEV.

Cada ambiente usa bindings, banco e secrets próprios. Migrations rodam apenas
para o alvo escolhido e quando forem seguras; falhas de schema preferem
forward-fix. Todo deploy termina com smoke/readiness check das dependências
essenciais. Staging não faz parte da v0.1.

## Consequências

- DEV oferece feedback contínuo remoto.
- PROD mantém trilha de auditoria e intenção humana explícita.
- Rollback de código não deve presumir rollback destrutivo de migration.
- O mesmo desenho preserva um fluxo local futuro sem compartilhar credenciais
  remotas.
