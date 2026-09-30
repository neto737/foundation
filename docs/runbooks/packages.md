# Pacotes privados do Foundation

Os nove pacotes reutilizáveis `@t00ls-dev/*` usam versões SemVer independentes,
Changesets e GitHub Packages (`https://npm.pkg.github.com`). A raiz, examples,
tests e tooling, incluindo create-app/doctor, permanecem privados e não são
publicados. Os pacotes usam `UNLICENSED`. O deploy do Foundation continua
DEV-only.

## Histórico do bootstrap

A primeira publicação privada dos nove pacotes em `0.1.0` foi concluída pelo
bootstrap especial no SHA `33c4963b4c2c7f4cb34d5045eec7cc3162ca6857`, execução
[36615440630](https://github.com/t00ls-dev/foundation/actions/runs/36615440630).
Não foram criadas tags Git ou GitHub Releases. A infraestrutura específica foi
substituída pelo fluxo permanente; sua implementação permanece no histórico Git.
O antigo PR #23 com bumps `0.2.0` foi descartado sem merge. Rejeição de metadata
sensível em audit e redação dos logs em observability (`12f1f8d`, antigo
safe-audit-logs) já integram a base inicial `0.1.0`.

## Desenvolvimento e Version Packages

1. Crie um changeset com `pnpm exec changeset` para cada mudança publicável,
   selecionando os pacotes e patch/minor/major apropriados. Não edite versões
   manualmente; dependências internas podem produzir bumps derivados pelo
   Changesets.
2. Após o merge do PR de desenvolvimento, o workflow Release na `master` instala
   com lockfile congelado, executa `pnpm check` e cria/atualiza Version
   Packages. Não há `publish-script`: **pushes nunca publicam pacotes**.
3. O Version Packages inclui `.changeset/release-plan.json`, registro
   determinístico de packages/versões anteriores e novas, bumps, changesets
   consumidos e seus hashes, dependências que justificam bumps derivados, versão
   do CLI e SHA base do planejamento. Revise-o com manifests e changelogs.
4. PRs gerados pelo `GITHUB_TOKEN` não disparam automaticamente a CI de PR.
   Antes de mesclar, provoque uma validação humana do head (por exemplo, reabrir
   o PR com identidade humana) e confira o SHA validado. Não use PAT de
   publicação.
5. Após a revisão e merge do Version Packages, espere a CI verde do merge. A
   publicação requer autorização separada. Na primeira versão deste sistema,
   `expected_sha` precisa ser exatamente o merge commit desse PR e a ponta atual
   da `master`: não mescle outros commits antes de audit/publish/resume.

## Audit manual (nenhuma publicação)

Execute Release em `master` por `workflow_dispatch` com:

- `mode=audit` (padrão);
- `release_pr`: número do Version Packages **mesclado**;
- `expected_sha`: SHA completo atual da master e do merge desse PR.

O job audit tem somente leitura de packages. Verifica repositório privado,
evento/ref/SHA, estado/base/head/autor do PR gerado, commit do bot, registro
revisado, changesets consumidos e hashes no SHA base. Confere o checkout,
instalação congelada, `pnpm check`, ausência de changesets ativos, allowlist dos
nove nomes, demais workspaces privados, UNLICENSED e registry. O registry é
consultado autenticadamente; erros não são interpretados como versões ausentes.
Versões inesperadas, downgrade, pacote inacessível ou alvo já publicado falham.

O inventário consulta diretamente os packuments completos dos nove nomes em
`npm.pkg.github.com` com `GITHUB_TOKEN` (`NODE_AUTH_TOKEN`), sem enumerar
packages pela REST API de usuário. Exige HTTP 200, identidade exata, versões,
`latest`, identidade de cada versão, `dist.integrity` SHA-512 e URLs de tarball
do registry com nome/versão coerentes. A versão anterior aprovada deve existir.
A ausência do alvo só é aceita dentro desse documento válido. HTTP 401/403/404,
falha de rede/timeout, 5xx, JSON inválido ou campos obrigatórios ausentes
interrompem o fluxo. Um 404 do package significa ausente ou inacessível e
**nunca** autoriza onboarding implícito. A consulta usa o documento do package,
não um endpoint `/package/versão` nem um `E404` isolado de `npm view`.

A identidade de autor Git sozinha não comprova geração automática. O único
commit precisa ser o `head.sha` do PR, ter exatamente um parent igual ao SHA
base e possuir assinatura verificada (`verified: true`, `reason: valid`), autor
`github-actions[bot]` e committer `web-flow`, compatíveis com o caminho API da
Changesets Action utilizado aqui. Não use commits manuais ou o modo de push via
Git CLI para esse PR de versionamento.

Após instalar as dependências congeladas, os gates recuperam pela API os
manifests, configuração de workspaces/Changesets e changesets do SHA base. Em
diretório temporário isolado, as bibliotecas do CLI instalado recalculam o
release plan sem executar versionamento ou publicação. O record inteiro deve
corresponder ao resultado, incluindo packages, versões, bumps, hashes e bumps
derivados de dependências internas. Falhas de consulta, árvore truncada ou
inputs obrigatórios ausentes interrompem o fluxo.

O plano calculado por Changesets precisa corresponder exatamente ao registro
aprovado ainda ausente no registry. Só esses packages são empacotados pelo CLI;
metadata, exports e arquivos são inspecionados. O resultado inclui hashes
SHA-256/SHA-512 e um `plan_digest` SHA-256 do envelope canônico contendo PR,
SHA, registro e artifacts. Anote também o ID `audit_run`.

Audit e preflight compartilham a validação do caminho exato do tarball derivado
de nome e versão, como `packages/t00ls-dev-access-0.1.1.tgz`; nomes arbitrários,
traversal, subdiretórios e artifacts fora do plano são rejeitados.

Revise o summary e o artifact `foundation-release-<plan_digest>` da execução
bem-sucedida. O digest cobre os **bytes** dos tarballs, não apenas os números de
versão. Guarde esse resultado: audit não autoriza automaticamente um publish.

## Publish manual explicitamente autorizado

Em uma execução separada, Release em `master` exige:

- `mode=publish`;
- mesmos `release_pr` e `expected_sha`;
- `confirmation=PUBLISH_PRIVATE_FOUNDATION_PACKAGES`;
- `plan_digest` exato revisado;
- `audit_run`: ID do audit bem-sucedido que possui os artifacts.

Um preflight só-leitura reexecuta os checks e revalida master/PR/registro,
proveniência da execução audit, digest, tarballs e registry. Não reempacota os
artifacts autorizados. Um job separado com `packages: write` repete os gates
imediatamente antes da tentativa. Autenticação usa exclusivamente
`GITHUB_TOKEN`.

A publicação utiliza os artifacts preservados e o plano restante validado:

```sh
pnpm exec changeset publish --from-pack-dir <diretório-validado> --no-git-tag
```

Não há GitHub Releases nem tags Git automáticas. O plano preserva os grupos de
dependências calculados pelo Changesets. As operações têm concurrency global e
não cancelam uma publicação em andamento. Não existe retry automático.

## Reconciliação e resume

Após qualquer tentativa, inclusive falha parcial, consulte/revise
`private-release-result`, `reconciliation.json` e o summary. Cada alvo é
classificado como publicado, ausente ou divergente. Um alvo publicado só é
aceito se a integridade e `latest` correspondem ao artifact autorizado e sua
identidade corresponde ao nome autorizado. Erro de consulta pós-publicação
produz estado não verificado/divergente, nunca sucesso silencioso.

Não refaça a publicação cegamente e não crie uma versão artificial para
recuperar uma release parcial. Após análise e nova autorização, use
`mode=resume` com os mesmos PR/SHA/digest/audit_run e a mesma confirmação. O
restante é o plano original menos as versões confirmadas no registry; nenhuma
delas é sobrescrita. Se tudo já chegou, resume apenas reconcilia. Divergência de
SHA, versões, integridade, identidade, provenance ou `latest` impede qualquer
nova tentativa.

Artifacts expiram em 30 dias. Se expirarem após uma falha parcial, não
reempacote e não relaxe o digest: pare para planejar recuperação explícita.
Novos packages, prereleases/snapshots e upgrade de formato do Changesets
requerem mudanças revisadas: este fluxo normal admite os nove nomes já
existentes e SemVer estável.

## Permissões e limitações

- Versionamento: contents/pull-requests write, sem packages write.
- Audit: contents/pull-requests/packages read.
- Preflight: adiciona actions read para recuperar o artifact do audit.
- Publish/resume: contents/pull-requests/actions read e packages write; sem PAT,
  contents write, aprovação automática de PR, OIDC npmjs ou criação de Releases.

### Invariantes administrativas de onboarding

Para os nove packages existentes, devem permanecer estabelecidos no onboarding:

- **visibility private** no GitHub Packages;
- associação administrativa a **`t00ls-dev/foundation`**;
- **Manage Actions access** ou herança aplicável concedendo ao Foundation acesso
  de leitura e, para o publisher, escrita.

Essas propriedades são verificadas e mantidas pelos administradores do package.
Mudança de visibilidade, associação, acesso, exclusão ou recriação exige nova
revisão administrativa antes de continuar releases. Novos packages continuam
exigindo onboarding separado e revisado.

O runtime não comprova essas propriedades pelo registry: `repository` no
packument é metadata publicada; acesso autenticado e `access: restricted` não
provam visibility private nem associação administrativa. A REST API de metadata
de packages do usuário não suporta o token de instalação usado pelo workflow;
essa dependência causou a falha do primeiro audit
[36693989133](https://github.com/t00ls-dev/foundation/actions/runs/36693989133).
Não se introduz PAT nem se fabricam campos de visibilidade/associação no
inventário. **Risco residual:** deriva administrativa externa não é detectada
necessariamente pelo workflow de release. Os gates de runtime continuam
verificando identidade/namespace, versões, tags e integridade, com reconsulta
antes da publicação e reconciliação posterior.

Atualmente a conta pessoal Free/repositório privado não possui aprovação efetiva
de Environment; `master` está sem branch protection. Não se apresenta um
Environment sem regras como proteção. Quem pode alterar workflows ainda pode
alterar gates: revisão humana, controle dos acessos e verificação do SHA são
essenciais. Consultar SHA e registry não é uma transação atômica; alterações
externas concorrentes podem causar falha parcial, que deve ser reconciliada.

## Consumo privado

Configure no consumidor `.npmrc`:

```ini
@t00ls-dev:registry=https://npm.pkg.github.com
```

Em desenvolvimento local, use token de ambiente com `read:packages` em um
`.npmrc` pessoal fora do repo. Em Actions, conceda acesso de leitura ao
repositório consumidor em Manage Actions access e use `GITHUB_TOKEN` com
`packages: read`, `actions/setup-node` e `NODE_AUTH_TOKEN` via ambiente. Acesso
depende das permissões GitHub Packages; nunca grave tokens no Git.

Veja [validação da distribuição](package-distribution.md) para os perfis D1,
limitações de declarações externas e testes isolados de artifacts.
