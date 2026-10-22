# Pacotes e Release do Foundation

O destino oficial dos nove packages é **npmjs.com público**, no scope do
**usuário npm `t00ls-dev`**, sem organização npm e sem publicação dupla. O
registry é `https://registry.npmjs.org`; os manifests e Changesets usam
`public`. Cada package mantém sua versão independente. Raiz, UI, examples, tests
e tooling, incluindo create-app/doctor, continuam privados para publicação.

**Estado operacional em 22/10/2026:** os nove pacotes estão públicos no npm. A
recuperação parcial do PR #136 foi concluída com OIDC, bytes, assinaturas e
proveniência verificados; seu freeze foi encerrado por autorização do
mantenedor. Veja o
[registro histórico](#encerramento-da-recuperação-136--22102026). Esse
encerramento não autoriza outra publicação nem reutilização de certificados.
MIT/notices seguem [Licenças](licensing.md); o deploy continua DEV-only.

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

## Roteiro operacional para próximas releases

Este é o **fluxo normal**, com `distribution=release`. Bootstrap e os modos
`recovery-*` abaixo são exceções com origens fixadas no código; não são o padrão
para novas versões. Cada operação exige autorização específica do mantenedor.

1. Prepare os Changesets dos pacotes públicos afetados, com bump adequado aos
   contratos, e integre as alterações pela revisão/CI normais. Aguarde o bot
   Version Packages, confira versões, changelogs e
   `.changeset/release-plan.json`. Se a CI do PR bot exigir intervenção humana,
   revise sua origem antes de autorizar o workflow; aprovação de CI não é
   aprovação npm. Integre somente o PR de versões validado e aguarde CI/master e
   DEV do merge.
2. Registre `release_pr` e seu merge imutável `release_sha`; obtenha o SHA atual
   de master como `execution_sha`. Confira owner/admin, CI exata, ausência de
   operação concorrente e o registry dos nove pacotes. Confirme no npm a conta,
   controle dos nomes e Trusted Publishers por pacote: owner `t00ls-dev`, repo
   `foundation`, workflow `release.yml`, environment compatível e permissão de
   publish. Mantenha o pin npm e o runner oficial; não injete tokens de
   fallback.
3. Coordene o freeze da master e execute **audit**. Aguarde o run terminal e
   confira jobs, ZIP/digest, envelope, plano, deltas e cada candidato
   selecionado no record, com seus manifests e hashes. Registre o `audit_run`,
   `plan_digest` e `changes_digest` dessa auditoria; não reutilize exemplos
   antigos.
4. Após revisão humana dos bytes/deltas e autorização separada, execute
   **approve** no mesmo executor. Aguarde success e confira o novo
   `approval.json`, identidade, `approval_run` e vínculo com
   audit/plano/candidatos. Não troque seu SHA ou digest.
5. Somente com autorização de envio, execute **publish** pelo workflow oficial.
   Preflight e publisher revalidam os gates; o consumidor envia os buffers
   aprovados. Aguarde também a reconciliação terminal, não apenas o dispatch.
6. Baixe os tarballs publicamente e compare bytes, SHA-256, SHA-512/SRI e
   metadata com os candidatos. Confira `latest`, assinaturas npm e attestations
   Sigstore/SLSA: subject/digest, repo/workflow/ref, commit e run/tentativa. Os
   pacotes fora do plano devem permanecer inalterados. Metadata isolada ou
   workflow verde não basta. Preserve as evidências e encerre o freeze somente
   após reconciliação completa e autorização; em falha, siga a seção de resume.

### Inputs e confirmações

Todos os dispatches usam `.github/workflows/release.yml`, ref **master**. Base
**B** = `mode`, `release_pr`, `release_sha`, `execution_sha`, `distribution`.
**A** = `audit_run`, `plan_digest`, `changes_digest` obtidos da auditoria
concluída com success. **P** = `approval_run` concluído com success para esse
mesmo plano. São strings no payload; nas etapas de release/recuperação, os
validadores exigem SHAs completos, IDs positivos e os digests exatos. Não envie
`approval_run` ao aprovar.

| Modalidade           | Inputs                                                        | `confirmation`                              |
| -------------------- | ------------------------------------------------------------- | ------------------------------------------- |
| `audit`              | B                                                             | Não exigida; não autoriza envio             |
| `approve`            | B + A                                                         | `APPROVE_PUBLIC_FOUNDATION_SNAPSHOT`        |
| `publish` / `resume` | B + A + P                                                     | `PUBLISH_PUBLIC_FOUNDATION_PACKAGES`        |
| `recovery-audit`     | B, origem excepcional suportada                               | Não exigida                                 |
| `recovery-approve`   | B + novo A, mesmo executor                                    | `APPROVE_PUBLIC_FOUNDATION_SNAPSHOT`        |
| `recovery-resume`    | B + novo A + novo P                                           | `PUBLISH_PUBLIC_FOUNDATION_PACKAGES`        |
| `diagnose-exchange`  | B; `release_pr`/`release_sha` são apenas campos do formulário | `DIAGNOSE_NPM_EXCHANGE_WITHOUT_PUBLICATION` |

O formulário também exige `release_pr`/`release_sha` no diagnóstico, mas eles
não autorizam publicação nesse modo; o pacote é fixo no script. Não há
`recovery-publish`, `expected_sha` ou confirmação intercambiável. Tentativa 1 é
obrigatória nos modos de autorização; um rerun não renova autoridade.

### Exemplos ilustrativos, sem autoridade de publicação

Preencha os valores a partir da release **atual**, não de um incidente anterior.
Os placeholders abaixo são deliberadamente inválidos até a revisão. O exemplo é
somente um audit normal; os outros modos acrescentam os inputs da tabela.

```json
{
  "ref": "master",
  "inputs": {
    "mode": "audit",
    "release_pr": "NUMERO_DO_PR_REVISADO",
    "release_sha": "SHA_COMPLETO_DO_MERGE_DE_VERSOES",
    "execution_sha": "SHA_COMPLETO_ATUAL_DA_MASTER",
    "distribution": "release"
  }
}
```

Salve como `release-dispatch.json` fora do projeto. **O primeiro comando abaixo
é uma operação autorizável, não uma verificação de leitura**: execute-o somente
após os gates e a autorização específica da etapa. Os demais consultam
evidências. Não repita o POST se a resposta for ambígua; procure o run criado
antes de decidir.

```sh
gh api --method POST repos/t00ls-dev/foundation/actions/workflows/release.yml/dispatches --input release-dispatch.json
gh run list --repo t00ls-dev/foundation --workflow release.yml
gh run watch "$RUN_ID" --repo t00ls-dev/foundation --exit-status
gh api "repos/t00ls-dev/foundation/actions/artifacts/$ARTIFACT_ID" --jq '{id,name,digest,expired,expires_at,workflow_run}'
pnpm exec npm view "$PACOTE@$VERSAO" version dist-tags dist --json --registry=https://registry.npmjs.org
```

Para conferir o ZIP, baixe o ID oficial com `gh api` no endpoint
`actions/artifacts/<id>/zip` e compare SHA-256 com `digest` da API antes de ler
entradas nomeadas. Não execute conteúdo nem extraia paths arbitrários. Para o
tarball, use a URL HTTPS do registry validada no metadata, sem Authorization, e
compare `cmp`/SHA-256/SRI com o arquivo aprovado. Assinaturas/proveniência
exigem verificação criptográfica, além da leitura do JSON: nesta recuperação foi
usada `pacote.manifest` do npm instalado, com `verifySignatures: true`,
`verifyAttestations: true`, `fetchRetries: 0` e as chaves públicas de
`https://registry.npmjs.org/-/npm/v1/keys`, fornecidas em
`//registry.npmjs.org/:_keys` com o `pemkey` PEM correspondente; depois foram
conferidos subject, workflow, commit e invocationId SLSA. Não instale
ferramentas ou use tokens alternativos para contornar uma verificação
indisponível.

**Antes:** autorização da etapa, master/CI/admin, concorrência/freeze, registry,
Trusted Publisher e artifacts/certificado/bytes corretos. **Depois:** run
terminal, plano realmente enviado, reconciliação,
download/bytes/latest/assinaturas/proveniência e preservação dos demais pacotes.
Sucesso exige todos esses fatos; inconclusão, divergência ou falha implica
parada, preservação das evidências e decisão humana.

As referências de implementação são
[workflow](../../.github/workflows/release.yml),
[orquestrador](../../.github/scripts/release.mjs),
[contratos](../../.github/scripts/release-core.mjs),
[binding Git](../../.github/scripts/release-planning.mjs),
[CI](../../.github/scripts/ci-evidence.mjs),
[consumidor](../../.github/scripts/release-consumer.mjs) e
[credencial/diagnóstico](../../.github/scripts/release-credential.mjs).

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

- `mode`: `audit`, `approve`, `publish`, `resume` ou o diagnóstico isolado
  `diagnose-exchange`; recuperação explícita usa `recovery-audit`,
  `recovery-approve` e `recovery-resume`, conforme a seção específica;
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

Somente publisher e diagnóstico isolado possuem `id-token: write`; não há
`packages: write`, token npm persistente como padrão ou envio de GITHUB_TOKEN ao
registry. npm **11.5.1**, pin/integridade no lockfile, é tooling privado
necessário ao OIDC. pnpm **10.15.1** e Changesets **3.0.3** são preservados. O
caminho é:

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
  OIDC e credencial não vazia. O metadata numérico positivo/inteiro seguro de
  `expires`, observado no registry, é opaco: não se infere unidade nem se
  converte em data. A credencial recém-emitida pelo exchange por pacote é usada
  somente na operação aprovada, sem cache ou persistência; sua validade é
  aplicada pelo npm no transporte oficial, como no cliente OIDC do npm. Metadata
  textual continua exigindo date-time válido e futuro; ausência e outros
  tipos/formas inválidos bloqueiam. Falha do exchange ou rejeição da credencial
  no registry encerra a operação sem fallback opcional da CLI ou retry de
  upload.

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

A publicação histórica do bootstrap usou `bootstrap-token`, portanto sua
proveniência não comprova autenticação de upload por OIDC. A release #136 e sua
recuperação posterior comprovaram OIDC para seus cinco alvos; isso não substitui
a conferência administrativa dos Trusted Publishers de cada pacote nas próximas
releases, nem autoriza versões artificiais para testar a configuração.

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

O **freeze é coordenação operacional do mantenedor**, registrada nas evidências:
manter master no executor auditado e suspender integrações/novos dispatches
incompatíveis. Não existe flag, comando de unfreeze ou bloqueio de branch criado
por Release. A concurrency `foundation-private-release` apenas serializa jobs
Release/version e não substitui essa coordenação. Não altere proteções para
iniciar ou encerrar o freeze. Após todos os alvos comprovados, ausência de
Release concorrente e autorização explícita, registre seu encerramento e libere
somente a coordenação daquela operação; preserve artifacts/certificados e gates
futuros.

Avanço depois do audit requer nova auditoria/aprovação antes do primeiro envio,
respeitando protected inputs. Após falha parcial, mantenha executor e originais:
`resume` normal usa o mesmo snapshot/IDs/digests e não reempacota. Se o executor
mudar ou a origem estiver indisponível/expirada, pare: não existe recuperação
genérica por troca de SHA. Os modos excepcionais abaixo aceitam somente a origem
fixada no código; outras releases exigem avaliação e mecanismo explicitamente
suportado, não adaptação de certificados. Retenção de artifacts é 30 dias.
Master e registry não são transação atômica: revalide em cada operação.

### Recuperação restrita da release #136 após o #140

**Caso histórico encerrado em 22/10/2026, não executar novamente.** A origem
`93fb7de21ce3b57db025a1c8605d65ad75b25798` publicou audit/auth/db/tenant; config
`0.1.3` foi concluído depois. O #140 e correções posteriores alteraram o
executor protegido; certificados antigos **não autorizavam** os novos commits. O
contrato abaixo permanece restrito a essa origem, não é um procedimento genérico
para a próxima release. Veja o registro de encerramento a seguir.

Somente essa recuperação é suportada. Os anchors imutáveis em `recoverySource`
fixam o PR #136, os runs audit `39516571800` e approve `39517695207`, artifacts
`12306989280` e `12309375138`, hashes dos ZIPs, envelope, certificado, record e
cinco candidatos originais. O restante precisa ser exclusivamente
`@t00ls-dev/config@0.1.3`, com SHA-256
`d8831160f65313d662e12e02555b841930ffb3346b66b666887773862cc52f0a`. Não existe
input para trocar a origem ou escolher outro pacote.

O workflow e os inputs históricos permanecem os mesmos. A modalidade é explícita
e exige três dispatches **separadamente autorizados**:

1. Após revisão e integração autorizada da implementação, aguarde a CI
   push/master e DEV do executor final **E**. Congele master em E. Revise
   integralmente o delta entre o snapshot original e E.
2. `mode=recovery-audit`, `release_pr=136`, `release_sha` original,
   `execution_sha=E`, `distribution=release`: importa os ZIPs oficiais por IDs,
   confere metadata/origem, hashes, identidade/jobs/tentativa/autoridade,
   certificado e plano históricos. Não instala dependências, executa build,
   pack, scripts dos artifacts ou exchange OIDC. Usa Node e unzip do runner;
   copia os cinco .tgz sem alterar bytes e verifica os quatro tarballs públicos.
3. Revise o artifact `foundation-release-<novo plan_digest>`, summary,
   `reviewed-changes.json`, `recovery-inventory.json`, os cinco hashes e a
   cadeia de origem. Registre o **novo audit_run**, plan_digest e
   changes_digest.
4. `mode=recovery-approve`, mesmos SHAs/distribuição e **novos** audit_run e
   digests, `confirmation=APPROVE_PUBLIC_FOUNDATION_SNAPSHOT`: o owner/admin
   atual emite nova aprovação. Não executa publicação. Revise o certificado e
   registre o **novo approval_run** concluído com success.
5. Somente após autorização adicional: `mode=recovery-resume`, os mesmos inputs
   novos, novo approval_run e `confirmation=PUBLISH_PUBLIC_FOUNDATION_PACKAGES`.
   Preflight, publisher e consumidor validam a cadeia completa novamente. O
   transporte existente recebe somente config `0.1.3`; os outros quatro são
   bloqueados também no consumidor, antes da credencial. Não há modo
   recovery-publish.

O envelope de recuperação é **format 5**, com `recovery.format=1`. Seu digest
inclui o objeto inteiro: origem fixada, lista completa de deltas, executor,
protected inputs atuais, novo audit e os cinco candidatos. `snapshotSha` é o
executor atual; o snapshot original de construção permanece explícito em
`recovery.source.executionSha`. O certificado novo é **format 3**, domínio
`foundation-npm-recovery-approval`, e vincula esse envelope integral. Os ZIPs,
envelope e certificado originais permanecem intactos em `source/` como prova
histórica; não são reutilizados como autoridade de upload no novo executor.

A projeção ordinária e suas seis exceções não mudam. Só a recuperação aceita um
delta em uma lista fechada de arquivos do executor, testes/fixtures e este
runbook; todos os outros inputs, inclusive packages, manifests, lockfile e
record, permanecem idênticos à origem. Paths/modos/tipos/OIDs de **todo** delta
entram no changes_digest revisado e na nova aprovação. Avançar E depois da nova
auditoria volta a invalidar a autoridade. Não substitua um SHA ou digest antigo
pelo novo em um certificado existente.

A importação mantém a disponibilidade/proveniência dos artifacts originais como
gate, inclusive expiração. As cópias ZIP em fixtures são apenas evidências
públicas imutáveis para testes offline, não fallback operacional. Não se aceita
recuperar de fixtures, cache ou cópia local quando a origem oficial estiver
indisponível. Requer decisão separada antes de qualquer outro mecanismo.

Antes de cada operação, reconcilie os nove pacotes e confirme os quatro
concluídos/latest/bytes e config ausente/latest `0.1.2`. Se config já existir,
**pare para reconciliação humana**, mesmo com bytes iguais. Divergência,
artifact expirado/ausente, falta de autoridade, outro restante, CI inválida ou
mudança de master bloqueia. Uma falha de recuperação não autoriza novo dispatch:
não há retry, fallback ou rerun automático.

O publisher continua em GitHub-hosted runner com OIDC por pacote,
provenance=true, registry oficial/public/latest e o consumidor buffer-only. A
configuração externa de Trusted Publishing deve ser conferida pelo mantenedor;
não há alteração administrativa nem ensaio de autenticação neste mecanismo. A
proveniência nova referenciará E e o novo run; o subject deve conferir com o
tarball original, e a evidência de recuperação preserva a ligação com o audit de
construção histórico. Não altere as variáveis GitHub para simular o run antigo
nem as attestations dos quatro pacotes publicados.

Após eventual envio, aguarde o workflow integral e reconciliação. Baixe config
publicamente, compare os bytes originais, SHA-256/SHA-512, latest, assinaturas e
proveniência. Reconfirme os outros quatro e os quatro pacotes fora da release.
Metadados isolados não comprovam sucesso. Falha de OIDC/transporte conserva o
freeze e o diagnóstico sanitizado do #140; exige decisão nova, sem retries ou
token tradicional. Encerre o freeze somente com autorização operacional e
comprovação integral dos cinco alvos.

### Encerramento da recuperação #136 — 22/10/2026

Por autorização expressa do mantenedor, após reconciliação pública integral, **a
recuperação e seu freeze operacional estão encerrados**. Os cinco alvos são
audit `1.0.1`, auth `0.3.1`, config `0.1.3`, db `1.0.1` e tenant `1.0.1`;
`latest`, bytes originais, SHA-256/SHA-512, assinaturas npm e proveniência foram
verificados. Os outros quatro pacotes e as attestations dos alvos anteriores
permanecem inalterados. Não há upload restante autorizado.

Evidências históricas: executor `54601cbdc8fc05bcfcd1d36706afa297e69b0601`,
[audit 39727767628](https://github.com/t00ls-dev/foundation/actions/runs/39727767628),
[approve 39728618759](https://github.com/t00ls-dev/foundation/actions/runs/39728618759)
e
[resume 39779715207](https://github.com/t00ls-dev/foundation/actions/runs/39779715207),
todos success/tentativa 1. Apenas config foi enviado pelo último run; seu
SHA-256 é `d8831160f65313d662e12e02555b841930ffb3346b66b666887773862cc52f0a`. Os
IDs, hashes, certificados e artifacts permanecem como evidência, **nunca como
inputs de uma nova release**. Este encerramento libera
desenvolvimento/integrações normais, não publica pacotes e não dispensa novos
gates/autorizações no futuro.

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

## Diagnóstico isolado do exchange npm

Mediante autorização operacional específica, `mode=diagnose-exchange` executa
uma única obtenção de JWT GitHub e um único exchange para `@t00ls-dev/audit`,
sem transporte de pacotes. Usa o próprio `release.yml`, master, distribuição
`release`, `execution_sha` igual ao SHA atual e a confirmação
`DIAGNOSE_NPM_EXCHANGE_WITHOUT_PUBLICATION`. Os inputs históricos `release_pr` e
`release_sha` continuam exigidos pelo formulário, mas não autorizam nem vinculam
uma publicação nesse modo.

O entrypoint exige owner/admin atual pela API, identidade exata do workflow,
checkout/master/SHA, tentativa 1 e CI aprovada do SHA. Usa o mesmo lock do
release. Não execute novamente sem nova autorização. Um erro bloqueia a
execução, sem retry de exchange. Não há fallback de credencial.

O módulo compartilhado `release-credential.mjs` contém a obtenção e validação da
credencial; o grafo de imports do diagnóstico não contém consumidor de artefatos
nem biblioteca de publicação. A máquina de requests permite somente GET no
broker e POST no endpoint do pacote fixo. Nenhum tarball, certificado ou
artefato de release é baixado. A credencial retornada é descartada, e a saída
contém `stage`, `category`, `http_status`, `reason`, `expiration_check` e a
classificação fechada `expiration_type`. Para números, acrescenta somente
`expiration_number_kind`, sem valor, magnitude, datas ou inferência de unidade.
Objetos e arrays não têm chaves/conteúdo inspecionados ou registrados.
`reason=VALID` significa somente credencial validada, sem comprovar transporte
ou publicação. Uma rejeição produz os motivos sanitizados existentes e exit code
de falha.

Esse diagnóstico não inicia audit/approve/publish/resume e não cria autorização
para publicar. Mudanças em código de credencial continuam sendo protected inputs
e invalidam a reutilização de snapshots/certificados incompatíveis.

## Diagnóstico de incidentes conhecidos

Primeiro consulte run/job/step, `npm-release-result`, reconciliation.json e o
registry por leitura. `FOUNDATION_PUBLISH_BLOCKED` é uma decisão do consumidor,
não prova de rejeição npm. Preserve os artifacts e a fase/reason sanitizados;
não registre mensagens/objetos arbitrários, JWTs, tokens, headers ou corpos
HTTP.

| Evidência                                                  | Interpretação e próximo passo seguro                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusted Publisher ausente/divergente                       | Mantenedor confere autenticado no npm provider, owner/repo/workflow, environment, permissão publish e validade. Um 401 administrativo anônimo não valida nem invalida essa associação. Pending validation não é expiração por si só; confira a janela exibida. Não altere configuração ou credencial sem autorização.                                                                                                                                                                               |
| `npm-exchange` com HTTP_REJECTED, 404 ou resposta inválida | Identifique status/reason e compare a associação declarada; 404 sozinho não comprova qual campo está errado. Token ausente/tipo/expiração inválidos são causas distintas. A incompatibilidade histórica de `expires` foi corrigida no #120; não inferir unidade do número nem revogar credenciais por hipótese.                                                                                                                                                                                     |
| `provenance-transport`                                     | Abrange carregar libnpmpublish, validação local, identidade Sigstore, certificado Fulcio, log Rekor e transporte/rejeição npm. Use `LOCAL_LOAD`, `LOCAL_VALIDATION`, `SIGSTORE_IDENTITY`, `SIGSTORE_IDENTITY_FORMAT`, `SIGSTORE_CERTIFICATE`, `SIGSTORE_LOG`, `NPM_HTTP_REJECTED`, `TRANSPORT_UNATTRIBUTED` ou `UNKNOWN` conforme o enum real. Só NPM_HTTP_REJECTED identifica rejeição HTTP npm reconhecida; rede não identifica o serviço que falhou. Não atribua causa a Sigstore sem evidência. |
| `authority` / `authorization`                              | Gate amplo: identidade/admin, CI, SHA, certificado, origem, protected inputs, registry e IO local. Não prova falha de Trusted Publishing. Compare contrato e artifacts, reproduza com fixtures sintéticas/cwd equivalente e pare se a causa continuar inconclusiva.                                                                                                                                                                                                                                 |
| ENOENT do manifest em packages/config                      | Defeito histórico corrigido no #142: recoveryRegistry usava cwd, enquanto Changesets/pnpm chama o consumidor no pacote. A leitura agora é relativa ao módulo/checkout; testes cobrem raiz e packages/config, sem suprimir manifest ausente ou divergente. Não generalize esse diagnóstico para outro erro authority.                                                                                                                                                                                |
| Incorrect public release confirmation                      | Confira a tabela de inputs antes do dispatch: approve usa APPROVE_PUBLIC_FOUNDATION_SNAPSHOT; publish/resume usam PUBLISH_PUBLIC_FOUNDATION_PACKAGES. Não troque campos de certificado ou guards para aceitar outro valor.                                                                                                                                                                                                                                                                          |

Na recuperação #136, o erro de provenance-transport anterior não preservava a
exceção original: não se comprovou retrospectivamente sua causa interna. O #140
adicionou categorias fechadas; o sucesso posterior não demonstra uma correção
especulativa em Sigstore/npm. Um FileNotFoundError em helper externo de
relatório também não significa artifact oficial ausente: confira primeiro qual
arquivo e qual produtor falhou, sem fabricar substitutos. O guard oficial
continuou intacto.

Falha de upload/exchange, metadata/bytes divergentes, config já existente na
recuperação restrita, origem expirada, executor/CI/autoridade inválidos ou
observação inconclusiva exigem **parada**, preservação do freeze e nova decisão.
Uma falha não autoriza retry, rerun, outro dispatch, token alternativo, nova
versão ou regeneração. Se o subprocesso aceitou o envio, aguarde somente as
observações de leitura limitadas já implementadas; ausência persistente não vira
sucesso.
