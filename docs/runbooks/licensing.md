# Licenças e distribuição

A licença MIT foi aprovada pelo mantenedor para o código próprio do Foundation.
O texto está em [`LICENSE`](../../LICENSE); os nove pacotes reutilizáveis e a
raiz declaram `MIT`. Os tarballs devem conter o mesmo texto da licença raiz.

O mantenedor também aprovou MIT para o Levi quando ele for incorporado ao
Foundation em `apps/levi`. A incorporação deverá preservar os avisos de
copyright e atribuição aplicáveis. Esta preparação não incorpora código nem
altera a licença ou os arquivos do repositório Levi. A licença MIT atual do
Foundation permanece integralmente preservada.

## Copyright

O mantenedor confirmou o aviso `Copyright (c) 2026 t00ls-dev` para o código
próprio do Foundation. Esse aviso consta no `LICENSE` raiz e nas nove cópias dos
pacotes distribuídos, idênticas entre si. O texto oficial de permissão, condição
e garantia MIT é preservado integralmente. A identificação decorre da decisão
explícita do mantenedor, não de inferência sobre a conta GitHub ou autoria Git.

## Terceiros

Dependências e trechos de terceiros mantêm suas licenças e notices próprios. O
aviso
[`packages/ui/THIRD_PARTY_NOTICES.md`](../../packages/ui/THIRD_PARTY_NOTICES.md)
identifica conteúdo shadcn sob MIT; não identifica o titular do Foundation.
Distribuir dependências ou binários exige respeitar seus avisos e obrigações,
incluindo componentes MPL e LGPL presentes nas ferramentas. A licença raiz não
relicencia esses componentes.

## Publicação e versões

Licença do código, visibilidade do repositório e publicação de pacotes são
decisões distintas. Workspaces com `private: true` continuam sem publicação npm,
embora seu código próprio esteja no escopo da licença raiz. O destino oficial
dos nove nomes é npmjs.com público no scope do usuário `t00ls-dev`. Preparação
local não significa publicação: o histórico privado GitHub permanece intacto.

Versões antigas publicadas como `UNLICENSED` não são reempacotadas ou alteradas
retroativamente. Os alvos MIT planejados no #30 permanecem preservados para
bootstrap, sujeito a audit e nova aprovação integral do snapshot/destino/bytes.
O record histórico conserva sua proveniência; artifacts e autorizações antigas
GitHub não autorizam npm. Mudanças seguintes usam Changesets após revisão/CI.

Consulte [Pacotes e Release](packages.md) para identidade, integridade,
provenance, preflight e autorização do publisher em repositório público ou
privado.
