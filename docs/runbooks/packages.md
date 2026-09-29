# Pacotes privados do Foundation

Somente os nove pacotes de `packages/*` são preparados para publicação no GitHub
Packages (`@t00ls-dev`, `https://npm.pkg.github.com`). Cada pacote tem sua
própria versão SemVer; a raiz, exemplos, testes de integração e tooling
(inclusive `create-app` e `doctor`) permanecem privados.

## Base inicial 0.1.0

Os nove pacotes ainda não foram publicados. A primeira publicação privada deve
usar exatamente as versões `0.1.0` já declaradas em seus manifests, sem
changeset de incremento nem Release PR de versionamento inicial. O PR #23, que
propunha `0.2.0`, foi fechado sem merge.

O changeset histórico `safe-audit-logs` descrevia a rejeição recursiva de
metadados sensíveis em `@t00ls-dev/audit` e a redação de campos sensíveis no
contexto dos logs de `@t00ls-dev/observability` (implementação em `12f1f8d`).
Ambos os comportamentos integram a base inicial `0.1.0`; não representam uma
mudança posterior que exija `0.2.0`.

## Versionamento e Release PR

Ao modificar uma API ou comportamento publicável após a base inicial, crie um
changeset com `pnpm exec changeset` e selecione os pacotes afetados e o tipo de
mudança (`patch`, `minor` ou `major`). Inclua o arquivo `.changeset/*.md` no PR.
Dependências internas publicáveis são atualizadas pelo Changesets quando
necessário; pacotes não compartilham uma versão fixa.

Quando alterações chegam à `master`, o workflow Release instala com lockfile
congelado, roda `pnpm check` e, se houver changesets pendentes, abre ou atualiza
um Release PR com versões e changelogs. O merge desse PR atualiza as versões na
`master`. PRs criados pelo `GITHUB_TOKEN` não disparam automaticamente o
workflow CI de `pull_request`; se o branch protection exigir esse check, será
preciso acionar uma execução por alteração humana no PR antes do merge.

O bootstrap é somente por `workflow_dispatch` na `master`. Informe
`confirmation=PUBLISH_NINE_PRIVATE_PACKAGES_0.1.0` e o SHA completo atual da
`master` em `expected_sha`. O job `bootstrap-audit` falha se o SHA mudou, se há
changesets, se a lista fechada de nove pacotes não corresponde aos manifests, se
outro workspace é publicável ou se qualquer pacote já existe no GitHub Packages.
Ele instala com lockfile congelado, roda `pnpm check`, consulta o registry
autenticado com `GITHUB_TOKEN`, confere o publish plan do Changesets e
empacota/valida os nove tarballs. **O job `publish` permanece bloqueado por
`if: ${{ false }}`** mesmo após um audit bem-sucedido. Uma tarefa posterior terá
de revisar o resultado e alterar explicitamente esse bloqueio; pushes comuns à
`master` não poderão publicá-los. Quando habilitado, o comando preparado será
`pnpm exec changeset publish --no-git-tag`, usando `GITHUB_TOKEN` e
`packages: write`, sem PAT, tags Git ou GitHub Releases.

O `access: "restricted"` do Changesets é a opção conservadora para publicação
restrita; **não define a visibilidade no GitHub Packages**. Na primeira
publicação, confira a visibilidade privada e as permissões de cada pacote no
GitHub. O campo `repository` associa os pacotes ao Foundation; as permissões
podem ser herdadas do repositório, conforme as configurações da conta.

## Consumo por outro repositório privado

No repositório consumidor, configure o escopo em `.npmrc`:

```ini
@t00ls-dev:registry=https://npm.pkg.github.com
```

Instale a versão desejada com `pnpm add @t00ls-dev/config@<versão>`, por
exemplo. O acesso é restrito pelas permissões do GitHub Packages. Para
instalação local, configure no `.npmrc` **pessoal** (fora do repositório)
`//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}` e forneça a variável
de ambiente com um PAT classic de `read:packages`. Para GitHub Actions, conceda
ao repositório consumidor acesso de leitura a cada pacote em **Manage Actions
access** e use `GITHUB_TOKEN` com `packages: read` via `actions/setup-node`
(`registry-url: https://npm.pkg.github.com`, `scope: '@t00ls-dev'` e
`NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`). Se o repositório não receber
esse acesso, será necessário um PAT classic com `read:packages` fornecido pelo
ambiente. Nunca registre tokens nos arquivos versionados.

Os subpaths `/d1` expõem tipos do Cloudflare Workers: consumidores TypeScript
dessas APIs precisam incluir `@cloudflare/workers-types` no seu ambiente de
tipos. Desenvolvimento dentro deste monorepo continua usando `workspace:`.
