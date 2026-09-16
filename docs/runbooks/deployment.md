# Deploy

Cada produto possui deploy independente. O foundation valida o fluxo usando
`examples/basic-d1`.

## DEV automatico

Um push em `master` executa a CI completa. O workflow `Deploy DEV` recebe o SHA
validado, aplica migrations D1, publica o Worker e consulta `/ready`. O deploy
nao repete os testes.

Uma falha de migration, deploy ou readiness encerra o workflow com erro. Nao
ignore o smoke para promover a mesma revisao a PROD.

## PROD deliberado

O workflow `Deploy PROD` exige:

- `git_ref`: branch, tag ou commit selecionado pelo operador;
- `deployment_target`: `prod`;
- `confirmation`: texto exato `DEPLOY PROD`;
- aprovacao do GitHub Environment `production`, quando configurada no GitHub.

O workflow resolve o ref uma vez, registra o commit SHA e usa exatamente esse
SHA nos checks e no deploy. Depois executa migration, deploy e `/ready`.

## Migrations e rollback

Siga [Migrations](migrations.md). O fluxo normal e forward-fix: uma migration ja
aplicada nao deve ser editada nem revertida destrutivamente. Rollback de codigo
so e seguro quando a versao anterior continua compativel com o schema atual.

Em uma falha:

1. interrompa novas promocoes;
2. preserve logs, SHA e resultado da migration;
3. corrija o schema com nova migration ou publique codigo compativel;
4. execute novamente o gate e o smoke;
5. registre a decisao quando houver impacto arquitetural.

## Secrets

Workflows recebem apenas nomes de secrets documentados. Valores nunca devem ser
impressos, gravados em summaries ou passados como inputs comuns de workflow.
