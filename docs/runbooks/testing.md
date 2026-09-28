# Testes

O gate oficial é:

```bash
pnpm check
```

Ele verifica a formatação e executa lint, typecheck, testes unitários,
integrações, builds e Playwright. O Docker deve estar disponível para PostgreSQL
por Testcontainers. O Playwright requer Chromium instalado.

## Durante o desenvolvimento

Execute primeiro o pacote alterado:

```bash
pnpm --filter <pacote> lint
pnpm --filter <pacote> typecheck
pnpm --filter <pacote> test
pnpm --filter <pacote> build
```

Antes de enviar uma mudança, execute `pnpm check` e `pnpm format:check`.

## Cobertura esperada

- primitivas públicas: testes unitários de contrato;
- D1/PostgreSQL e isolamento de tenant: testes de integração reais;
- gerador: conteúdo, segurança do destino e build fora do workspace;
- fluxos de usuário e acessibilidade: Playwright desktop e mobile;
- deploy: smoke test em `/health` no DEV publicado, incluindo conectividade D1.

Mocks não substituem os testes de banco existentes. Testes E2E não devem
depender de providers externos para permanecer deterministas.
