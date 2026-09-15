# t00ls-dev/foundation

Fundacao tecnica compartilhada para apps da organizacao `t00ls-dev`. O projeto e
Cloudflare-first, internal-first e nao contem regras de negocio de produtos.

## Estado

A v0.1 esta em desenvolvimento e e validada dentro deste workspace. Os pacotes
nao sao publicados automaticamente; a publicacao ocorre quando existir um
consumidor real.

## Inicio rapido

Requisitos: Node.js 22+, Corepack e Docker para os testes PostgreSQL.

```bash
corepack enable
pnpm install
pnpm check
pnpm dev
```

Veja `docs/architecture/overview.md` para arquitetura, limites e decisoes.

## Posicionamento

Uso externo e permitido sob a licenca MIT, sem garantia de suporte, estabilidade
perpetua ou alteracao do roadmap para consumidores externos.
