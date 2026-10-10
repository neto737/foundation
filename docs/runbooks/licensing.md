# Licenças e distribuição

A licença MIT foi aprovada pelo mantenedor para o código próprio do Foundation.
O texto está em [`LICENSE`](../../LICENSE); os nove pacotes reutilizáveis e a
raiz declaram `MIT`. Os tarballs devem conter o mesmo texto da licença raiz.

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
embora seu código próprio esteja no escopo da licença raiz. Os nove nomes
distribuídos continuam no GitHub Packages com `access: restricted`; não há
publicação npmjs nem acesso anônimo ao registry prometidos.

Versões antigas publicadas como `UNLICENSED` não são reempacotadas ou alteradas
retroativamente. A transição deve gerar novas versões via Changesets, após
revisão, CI e autorização explícita. A mudança da licença e dos gates exige nova
base de Release, novo audit e novo digest: não reaproveite o PR de
versionamento, artifacts ou autorizações anteriores para esses bytes.

Consulte [Pacotes e Release](packages.md) para identidade, integridade,
provenance, preflight e autorização do publisher em repositório público ou
privado.
