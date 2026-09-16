# t00ls-dev/foundation

Fundacao tecnica compartilhada para apps da organizacao `t00ls-dev`. O projeto e
Cloudflare-first, internal-first e nao contem regras de negocio de produtos.

## Estado

A v0.1 possui um caminho local completo e CI verde. O primeiro deploy remoto
depende da configuração dos recursos e secrets Cloudflare. Consulte
[`docs/project-status.md`](docs/project-status.md) para entregas, validações,
pendências priorizadas e itens deliberadamente adiados.

## Inicio rapido

Requisitos: Node.js 22+, Corepack e Docker para os testes PostgreSQL.

```bash
corepack enable
pnpm install
pnpm check
pnpm dev
```

Veja [`docs/architecture/overview.md`](docs/architecture/overview.md) para a
arquitetura, [`docs/decisions`](docs/decisions) para as decisões vigentes e
[`docs/runbooks/cache.md`](docs/runbooks/cache.md) para a regra obrigatoria de
cache bypass nos dominios Cloudflare.

## Posicionamento

Uso externo e permitido sob a licenca MIT, sem garantia de suporte, estabilidade
perpetua ou alteracao do roadmap para consumidores externos.
