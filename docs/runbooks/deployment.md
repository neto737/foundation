# Deploy

Cada produto possui deploy independente. O foundation valida o fluxo usando
`examples/basic-d1`.

## DEV automático

Um push em `master` executa a CI completa. O workflow `Deploy DEV` recebe o SHA
validado, aplica migrations D1, publica o Worker e consulta `/ready`. O deploy
não repete os testes.

Uma falha de migration, deploy ou readiness encerra o workflow com erro. Não
ignore o smoke test ao promover a mesma revisão para PROD.

## PROD deliberado

O workflow `Deploy PROD` exige:

- `git_ref`: branch, tag ou commit selecionado pelo operador;
- `deployment_target`: `prod`;
- `confirmation`: texto exato `DEPLOY PROD`;
- aprovação do GitHub Environment `production`, quando configurada no GitHub.

O workflow resolve o ref uma vez, registra o commit SHA e usa exatamente esse
SHA nos checks e no deploy. Depois executa migration, deploy e `/ready`.

## Migrations e rollback

Siga [Migrations](migrations.md). O fluxo normal é forward-fix: uma migration já
aplicada não deve ser editada nem revertida destrutivamente. O rollback de
código só é seguro quando a versão anterior continua compatível com o schema
atual.

Em uma falha:

1. interrompa novas promoções;
2. preserve logs, SHA e resultado da migration;
3. corrija o schema com uma nova migration ou publique código compatível;
4. execute novamente o gate e o smoke;
5. registre a decisão quando houver impacto arquitetural.

## Secrets

Workflows recebem apenas nomes de secrets documentados. Valores nunca devem ser
impressos, gravados em summaries ou passados como inputs comuns de workflow.
