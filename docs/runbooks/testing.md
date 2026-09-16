# Testes

O gate oficial e:

```bash
pnpm check
```

Ele verifica formatacao e executa lint, typecheck, testes unitarios,
integracoes, builds e Playwright. Docker deve estar disponivel para PostgreSQL
por Testcontainers. O Playwright requer Chromium instalado.

## Durante o desenvolvimento

Execute primeiro o pacote alterado:

```bash
pnpm --filter <pacote> lint
pnpm --filter <pacote> typecheck
pnpm --filter <pacote> test
pnpm --filter <pacote> build
```

Antes de enviar uma mudanca, execute `pnpm check` e `pnpm format:check`.

## Cobertura esperada

- primitives publicos: testes unitarios de contrato;
- D1/PostgreSQL e isolamento de tenant: testes de integracao reais;
- gerador: conteudo, seguranca do destino e build fora do workspace;
- fluxos de usuario e acessibilidade: Playwright desktop e mobile;
- deploy: smoke em `/ready` no ambiente publicado.

Mocks nao substituem os testes de banco existentes. Testes E2E nao devem
depender de providers externos para permanecer deterministas.
