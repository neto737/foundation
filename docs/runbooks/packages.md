# Pacotes e Release do Foundation

O destino oficial dos nove packages é **npmjs.com público**, no scope do
**usuário npm `t00ls-dev`**, sem organização npm e sem publicação dupla. O
registry é `https://registry.npmjs.org`; os manifests e Changesets usam
`public`. Cada package mantém sua versão independente. Raiz, UI, examples, tests
e tooling, incluindo create-app/doctor, continuam privados para publicação.

**Estado operacional:** os nove targets do bootstrap #30 estão públicos no npm,
com integridade e `latest` confirmados. A tentativa foi encerrada por decisão
excepcional do mantenedor, conforme o registro abaixo; o workflow permanece em
failure e OIDC remoto não está comprovado por essa publicação. Os nove pacotes
privados duplicados do GitHub Packages, que continham as versões históricas
`0.1.0`/`0.1.1`, foram excluídos em **15/10/2026**. Os nove pacotes oficiais
permanecem publicados no npmjs.com. A exclusão não alterou os workflows nem o
fluxo de publicação; não republique as versões históricas como preparação.
MIT/notices seguem [Licenças](licensing.md). O deploy continua DEV-only e o
gerador `basic-d1` não é alterado por esta correção.

## Desenvolvimento e Version Packages

Mudanças publicáveis usam Changesets, nunca edição manual de versões. Após
merge, a CI push/master executa o gate completo; `version` depende de `checks`,
confirma que o SHA continua sendo master e cria/atualiza Version Packages pelo
bot. Não há publish-script, tags ou GitHub Releases automáticos. A serialização
compartilhada com Release não cancela publicação em andamento.

O record format 1 contém baseSha, CLI `3.0.3`, packages/versões/bumps, hashes
dos changesets consumidos e dependências derivadas. Ele é recalculado
independentemente pelas bibliotecas instaladas do Changesets a partir da base
imutável. O PR deve possuir um único commit bot assinado via API, parent igual à
base, head exato, arquivos relacionados, changelogs e changesets consumidos. Não
desenvolva na branch `changeset-release/master` nem faça commits manuais no PR
do bot.

PRs gerados com GITHUB_TOKEN não iniciam CI automaticamente. Valide o head pela
intervenção humana documentada, revise o plano e espere a CI do merge. O
checkout do job version preserva temporariamente a credencial para aprofundar o
histórico Changesets; Release mantém `persist-credentials: false`.

## Primeira distribuição: bootstrap do #30

O bootstrap admite **somente** PR #30, merge
`90a100377fa8c1e0e1b30174d4e611c545ed0ac4`, seus nove nomes e os alvos:

- auth/security `0.2.0`;
- access/audit/config/db/email/observability/tenant `0.1.2`.

`oldVersion: 0.1.1` no record permanece como história do GitHub Packages, não
como uma versão fictícia existente no npm. Não edite o record, não publique
versões intermediárias e não crie bumps artificiais para recuperar esse estado.

O audit bootstrap propõe um **snapshot novo**, mantendo a proveniência original.
As mudanças posteriores, inclusive manifests, dependências, lockfile, docs e
executor, são listadas em `reviewed-changes.json` por path/mode/type/blob OID.
`changes_digest` vincula a lista completa e os SHAs histórico/novo, incluindo as
seis exceções de infraestrutura. O owner deve revisar esses deltas e os bytes
dos tarballs antes de emitir a aprovação separada.

Ausência pública observada por 404/`Not found` é apenas um fato do inventário.
Ela não autoriza criação. Bootstrap publicável exige o plano exato, snapshot,
CI, aprovação do owner e artifacts. Package já existente com outras versões é
divergência, não onboarding automático. Após o bootstrap, releases normais
exigem predecessor e `latest` realmente existentes no npm.

## Contexto, conteúdo e CI

Release continua exclusivamente `workflow_dispatch` em master. Os inputs são:

- `mode`: `audit`, `approve`, `publish` ou `resume`;
- `release_pr` e `release_sha`: PR Version Packages e seu merge imutável;
- `execution_sha`: snapshot/executor exato, igual ao workflow, checkout e
  master;
- `distribution`: `release` por padrão ou `bootstrap` explícito;
- `audit_run`, `plan_digest`, `changes_digest`: obrigatórios fora do audit;
- `approval_run`: obrigatório em publish/resume;
- `confirmation`: confirmação específica de aprovação ou publicação.

`expected_sha` antigo não é aceito. A API precisa comprovar ancestralidade e
identidades completas de commits/trees, sem truncamento, symlinks/gitlinks,
paths duplicados ou entradas incompletas.

`validateProtectedInputs` permanece integral: path/mode/type/blob OID de todo o
repositório, com **somente** as seis exceções nominais existentes:

- `.github/workflows/release.yml`;
- `.github/scripts/release-core.mjs`;
- `.github/scripts/release.mjs`;
- `.github/scripts/release-planning.mjs`;
- `.github/scripts/release.test.mjs`;
- `docs/runbooks/packages.md`.

Em release normal, conteúdo histórico e executor devem corresponder nessa
projeção. No bootstrap #30, o novo snapshot auditado é uma proposta até a
aprovação do owner. Depois dela, **o SHA inteiro** de
audit/approve/publish/resume deve permanecer igual; não se aceita trocar
executor nem mesmo alterando somente uma exceção. O head bot continua sendo
comparado ao merge histórico.

A CI aprovada precisa pertencer ao Foundation, workflow/path exatos, evento
push/master, SHA exato, run mais recente concluído com success e um único job
checks aprovado na mesma tentativa. Erros de API, reexecução pendente/falha,
skip/cancelamento e evidência incompleta bloqueiam; não há fallback para CI
antiga. Release não repete o gate nem baixa artifacts/caches de PR como código
confiável.

## Audit: não autoriza publicação

Execute somente mediante autorização operacional com `mode=audit`, os inputs
históricos/executor e a distribuição desejada. Audit compila e empacota no
runner autorizado; inspeciona nove manifests, allowlist, exports, dependências,
arquivos, LICENSE MIT e hashes SHA-256/SHA-512. Tarballs não admitem links,
protocolos locais, tooling privado ou overrides de publicação adicionais. Paths
derivam exatamente de nome/versão, sem traversal.

O inventário npm é público/anônimo: não envie GITHUB_TOKEN ao npm. Packuments
precisam ter nomes/versões/latest/integridade e URLs HTTPS npm coerentes.
Somente bootstrap admite ausência inicial observada; 401/403/5xx, falhas de
rede, JSON inválido, destino errado ou metadata incompleta falham fechados.

O inventário reconhece separadamente **somente os nove placeholders
`0.0.0-stage` inspecionados em 15/10/2026**, com identidade, estrutura e hashes
de distribuição fixados no leitor. Registros alterados, novos formatos ou outras
prereleases bloqueiam e exigem revisão explícita. Os placeholders permanecem em
`placeholders` no inventário e na reconciliação, fora das versões estáveis e das
integridades dos targets. Não são versão aprovada/publicável, não podem ser
`latest` e não servem de predecessor. A identificação do formato não comprova a
causa interna de sua criação no npm.

Na investigação de **16/10/2026**, o conteúdo mínimo, `stub: true` e o README
padronizado confirmaram a natureza desses nove registros como placeholders de
[staging do npm](https://docs.npmjs.com/staged-publishing), sem código,
dependências ou scripts do Foundation. Não representam um ambiente de staging da
aplicação. A coincidência temporal com o bootstrap não identifica
definitivamente a operação que os criou; o README estático também não comprova
uma aprovação de staging ainda pendente.

A decisão é **manter os nove placeholders como estão**, pois não há impacto
operacional demonstrado no consumo normal ou no inventário atual. `latest`
aponta para as versões operacionais; um pin explícito em `0.0.0-stage` seleciona
um stub sem a API Foundation. Não há necessidade de excluir, depreciar, alterar
dist-tags ou criar uma release corretiva. Depreciar acrescentaria `deprecated` e
bloquearia o leitor estrito atual; remover seria irreversível, sem benefício
funcional demonstrado. Reavaliar somente diante de evidência nova, como um
consumidor afetado ou bloqueio de uma release legítima. Essa decisão não aprova
retroativamente os registros fora do plano histórico.

O envelope `authorization.json` **format 4** vincula registry/public,
`user:t00ls-dev`, distribuição e método de autenticação, #30/record quando
aplicável, snapshot/executor, protectedInputsDigest, changesDigest, audit_run e
os artifacts exatos. Envelopes GitHub antigos e envelopes npm format 3 são
rejeitados. Adicionar um campo solto a um envelope antigo não concede autoridade
nova.

Revise o artifact `foundation-release-<plan_digest>`, seu summary e a lista de
mudanças. Registre audit_run, plan_digest e changes_digest. O digest autoriza os
bytes, não apenas números de versão. Audit nunca chama publisher.

## Aprovação separada e autoridade verificável

O aprovador é **t00ls-dev, usuário GitHub ID 14156701**, com permissão admin
**atual** no Foundation, revalidada pela API. Não inferimos titularidade npm
desse ID; isso é um pré-requisito administrativo separado.

Após revisar a proposta, o owner faz um dispatch separado `mode=approve`, com os
mesmos SHAs/distribuição/audit_run e os dois digests exatos, usando
`confirmation=APPROVE_PUBLIC_FOUNDATION_SNAPSHOT`. O workflow verifica:

- actor e triggering_actor reais do run por API, login/ID imutável, tipo User;
- permissão admin atual e identidade do workflow/repo/origem/SHA;
- tentativa 1, CI/master atuais e todos os bytes/inputs do audit;
- correspondência do changes_digest revisado com a árvore histórica/novo
  snapshot.

Gera `approval.json`, artifact `foundation-approval-<plan_digest>`, vinculando
identidade, approval_run, destino, autenticação, snapshot, proveniência, plano e
digest de artifacts. Não é input booleano, label ou texto autodeclarado. A API
deve comprovar que o job approve dessa execução concluiu com success. O
certificado é revalidado no preflight e no publisher, inclusive após obter
jobs/permissões. Re-runs não autorizam operação: use um dispatch novo. Não há
exigência de um segundo aprovador; o controle é a autorização explícita do owner
existente.

Esse mecanismo comprova **quem autorizou os hashes exatos**. A revisão humana
efetiva dos deltas/bytes permanece responsabilidade do owner; código não prova
que uma pessoa leu um diff. Quem pode aprovar/alterar executor continua parte da
base de confiança. Não tratar CI ou correspondência com HEAD como aprovação.

## Publicação, bootstrap temporário e OIDC

Publicação requer autorização operacional separada. Use `mode=publish`, os
mesmos inputs e `approval_run` bem-sucedido, com
`confirmation=PUBLISH_PUBLIC_FOUNDATION_PACKAGES`. Preflight recupera artifacts
originais e certificado; publisher repete gates imediatamente antes da
tentativa. Não recompila/reempacota os bytes autorizados, nem faz retry
automático.

Somente publisher possui `id-token: write`; não há `packages: write`, token npm
persistente como padrão ou envio de GITHUB_TOKEN ao registry. npm **11.5.1**,
pin/integridade no lockfile, é tooling privado necessário ao OIDC. pnpm
**10.15.1** e Changesets **3.0.3** são preservados. O caminho é:

```text
Changesets --from-pack-dir → pnpm → consumidor protegido → libnpmpublish do npm 11.5.1
```

`npm_config_npm_path` aponta para `release-consumer.mjs`, único consumidor final
do mesmo fluxo. Ele revalida envelope/certificado, owner/executor, master/CI e
identidade da aprovação; não oferece um workflow/publisher paralelo. Lê cada
tarball uma vez em buffer privado, confere os três hashes aprovados e extrai o
manifest desse mesmo buffer. A biblioteca oficial do npm recebe exatamente os
bytes conferidos, sem reabrir o path nem reempacotar. Mutação antes da captura
bloqueia; mudança do arquivo durante autenticação/provenance não altera o
buffer. Reconciliação pós-envio permanece necessária, não substitui essa
verificação.

Os métodos são derivados da distribuição e entram no envelope e no certificado:

- **bootstrap-token:** somente #30 e seus nove targets. O secret temporário
  `NPM_BOOTSTRAP_TOKEN` é referenciado somente no step publisher quando a
  distribuição é bootstrap. Ausência bloqueia antes da tentativa. O consumidor
  consulta whoami com essa credencial e exige usuário npm `t00ls-dev`. Audit,
  approve, preflight, PRs e releases normais não recebem a credencial.
- **oidc:** release ordinária. Token bootstrap, tokens tradicionais/injetados e
  credenciais de config são rejeitados. O consumidor solicita identidade GitHub
  para npm, confere repo/ref/snapshot, exige exchange npm bem-sucedido, tipo
  OIDC e validade. Falha não ativa o fallback opcional da CLI npm.

Configuração npm efetiva é carregada pela biblioteca instalada, incluindo
project/user/global/env/cli/builtin. O guard examina apenas nomes de chaves,
inclusive fontes shadowed, sem acessar/logar valores de autenticação; auth,
password, username, cert/key e tokenHelper não são aceitos. A configuração não é
flattened para as opções de upload. Somente a credencial explicitamente
estabelecida vai para a biblioteca npm. Erros do consumidor são sanitizados, sem
serializar erros/config/response bodies. Não escrever credenciais em artifacts.

Testes usam buffers/transportes e identidades sintéticas, além de parsing real
de tarball e biblioteca npm com transporte sem rede. **Não comprovam
autenticação remota nem primeira publicação.**

Antes de operar, confirmar a conta npm `t00ls-dev`, controle dos nomes e trusted
publisher de cada package para `t00ls-dev/foundation`, `release.yml` e operação
publish para releases posteriores. Primeiro registro de nomes inexistentes usa o
bootstrap-token expressamente autorizado: o mantenedor cria um GAT temporário
com o menor scope/write necessário, bypass2FA quando exigido para automação e a
menor validade disponível; provisionamento do secret e publicação requerem
autorizações separadas. Revogar/remover a credencial após reconciliação
completa. Isso não foi feito na preparação. Não criar organização, placeholders
ou tokens sem autorização administrativa. `npm stage publish` registra
placeholder em nome novo e não é um teste inofensivo. Configurar trusted
publishers somente quando os packages existirem e uma release legítima estiver
pronta para validar a configuração na janela oficial. Não fabricar bumps para
testar OIDC.

**Pendência atual:** a configuração externa do Trusted Publishing nos nove
pacotes e a validação remota de OIDC permanecem reservadas para a próxima
release legítima, na janela oficial. A publicação do bootstrap usou
`bootstrap-token`; sua proveniência não comprova autenticação de upload por
OIDC. Não configurar nem testar Trusted Publishing antecipadamente, nem criar
versões apenas para essa validação.

## Reconciliação e resume

Após tentativa, revisar `npm-release-result`, reconciliation.json e summary.
Published requer integridade e latest dos artifacts aprovados; absent é restante
observado; divergência de identidade/versões/bytes/latest impede nova tentativa.
Bootstrap parcial mantém o mesmo plano, mesmo que packages restantes ainda
retornem 404. Release normal nunca transforma um package ausente em bootstrap. O
placeholder conhecido adicional não substitui o target: bootstrap continua
rejeitando qualquer outra versão estável existente; release normal continua
exigindo o predecessor real. Integridade/latest divergentes e versões superiores
permanecem bloqueantes.

Após uploads aceitos (subprocesso exit 0 e plano restante não vazio), o
publisher observa novamente o inventário **sem reenviar packages** quando algum
target continua ausente. Limites: **12 observações, intervalo de 30 segundos e
duração total máxima de 6 minutos**, incluindo leituras; cada GET mantém o
timeout de 30 segundos, limitado também pelo prazo global. As releituras são
anônimas, solicitam revalidação de cache e não usam corpo nem credenciais. Isso
não garante que o registry elimine caches intermediários. Divergência concreta,
erro HTTP, falha de rede, timeout, JSON ou metadata inválidos interrompem a
espera. Somente o 404/`Not found` bootstrap continua sendo ausência observável.

Ausência persistente não vira sucesso: `reconciliation.json` registra estados,
tentativas, duração e esgotamento, e o gate final continua exigindo exit 0 e
todos os targets `published`, após revalidar contexto/autoridade. Upload com
falha e resume sem restante mantêm uma única observação final. Não há retry de
upload. Esse comportamento vale para execuções futuras autorizadas, não
reinterpreta o run `38674028260`, que terminou em failure.

Resume exige autorização separada, `mode=resume` e os mesmos
PR/release_sha/execution_sha/distribuição/digests/audit_run/approval_run.
Publica somente o restante; se tudo chegou, só reconcilia. Não sobrescreve
versões, reempacota artifacts ou fabrica bumps.

Master fica congelada desde audit até publicação/resume completos. Avanço depois
do audit requer novo audit e nova aprovação antes da primeira tentativa. Após
falha parcial, avanço/exclusão/expiração de artifacts exige recuperação
explícita dos mesmos bytes, não regeneração. Retenção é 30 dias. Consultas de
master e registry não são transação atômica; avanço durante tentativa pode
resultar em publicação parcial e falha de verificação, nunca sucesso silencioso.

### Encerramento excepcional do bootstrap #30 — 15/10/2026

Por autorização expressa do mantenedor em 15/10/2026, a primeira tentativa de
publicação npm está **operacionalmente encerrada**, com fundamento na
confirmação externa dos nove targets acima, seus bytes aprovados e `latest`
corretos. Não há target pendente: nenhum upload restante é necessário ou
autorizado para essa tentativa.

O registro refere-se exclusivamente ao snapshot
`a538235fb03acce48b721d31621c39da02d94db5`, ao
[audit 38598859943](https://github.com/t00ls-dev/foundation/actions/runs/38598859943),
à
[aprovação 38608503662](https://github.com/t00ls-dev/foundation/actions/runs/38608503662)
e ao
[publish 38674028260](https://github.com/t00ls-dev/foundation/actions/runs/38674028260).
O resultado histórico deste último permanece **failure**. Os nove registros
adicionais `0.0.0-stage` permanecem divergências fora do plano, sem aprovação
retroativa; a causa interna exata de sua criação não foi determinada.

Essa decisão excepcional encerra o freeze dessa tentativa **somente para
desenvolvimento e integração de código**, sujeitos à revisão e aos gates
normais. Não autoriza publish, resume, rerun, novo bootstrap ou alteração dos
packages publicados. Artifacts, digests, certificados e records históricos
permanecem preservados, sem regeneração; nenhuma autorização antiga pode ser
reutilizada para outro snapshot ou executor.

Futuras releases exigem o fluxo normal de proveniência, CI, audit, aprovação e
autorização operacional próprios. Este registro é específico ao incidente e não
cria dispensa geral da regra de freeze ou dos requisitos de recuperação para
outras tentativas.

## Consumo

Após a primeira publicação efetivamente confirmada, os nove nomes são
instaláveis anonimamente no npm. Consumidores usam versões e lockfile próprios,
com atualizações revisadas/testadas; não recebem alterações de arquivos copiados
do template automaticamente. Remover mapping antigo de scope GitHub é decisão do
consumidor, sem alterar packages históricos.

Workspace/tarballs continuam disponíveis para desenvolvimento/testes. Veja
[Distribuição](package-distribution.md) para os 18 exports/perfis TypeScript e
[Criação de apps](creating-an-app.md) para o gerador existente.
