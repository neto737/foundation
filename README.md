# t00ls-dev/foundation

Fundação técnica compartilhada para aplicações da organização `t00ls-dev`. O
projeto é Cloudflare-first, internal-first e não contém regras de negócio dos
produtos.

## Estado

A v0.1 possui um caminho local completo, CI e deploy automático do exemplo em
DEV. O Foundation não possui ambiente PROD; aplicações consumidoras são donas
dos seus ambientes. Consulte [`docs/project-status.md`](docs/project-status.md)
para entregas, validações, pendências priorizadas e itens deliberadamente
adiados.

## Início rápido

Requisitos: Node.js 22+, Corepack e Docker para os testes PostgreSQL.

```bash
corepack enable
pnpm install
pnpm check
pnpm dev
```

Veja [`docs/architecture/overview.md`](docs/architecture/overview.md) para a
arquitetura, [`docs/decisions`](docs/decisions) para as decisões vigentes e
[`docs/runbooks/cache.md`](docs/runbooks/cache.md) para a regra obrigatória de
bypass de cache nos domínios Cloudflare.

O [runbook de pacotes privados](docs/runbooks/packages.md) descreve Changesets,
Release PRs e instalação via GitHub Packages.

Runbooks operacionais adicionais cobrem
[ambientes](docs/runbooks/environments.md),
[deploy](docs/runbooks/deployment.md), [segurança](docs/runbooks/security.md),
[testes](docs/runbooks/testing.md), [LGPD](docs/runbooks/lgpd.md) e
[criação de aplicações](docs/runbooks/creating-an-app.md).

## Posicionamento

O acesso aos pacotes depende das permissões do GitHub Packages.
