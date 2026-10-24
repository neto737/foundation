# Gestão de membros — primeira fatia

Implementa cadastro, listagem paginada, filtros e ficha individual. O escopo
pessoal e as invariantes continuam em [Decisões do MVP](decisoes-mvp.md).
Não implementa edição, exclusão, alteração posterior de situação, transferência,
aniversariantes, indicadores, convites ou associação automática a contas.

## Habilitação e limites

A composição `createApp` recebe `membersEnabled`, desabilitado por padrão.
O executável Node local habilita a fatia apenas com `LEVI_LOCAL_DATABASE=1`,
conservando suas guardas de origem/banco local e servidor em loopback. Os harnesses
sintéticos a habilitam explicitamente. O Worker nunca recebe esse booleano.

No Worker, `LEVI_MEMBERS_DEV_ORGANIZATIONS` é uma configuração **não secreta** do
environment `dev`, com UUIDs de organizações sintéticas separados por vírgula.
Espaços nas extremidades e letras maiúsculas são normalizados; duplicatas são
removidas. Ausente, vazia, acima de 4096 caracteres ou com qualquer item inválido
(inclusive item vazio, separador final, JSON ou curinga) desabilita o conjunto
inteiro. Aceita UUIDs canônicos com versão 1–8 e variante RFC, compatíveis com os
UUIDs gerados pelo servidor. Não colocar UUIDs de ambientes no repositório.

A lista só tem efeito quando tanto a origem configurada quanto a origem da URL da
requisição são exatamente `https://levi.t00ls.dev`. Outras origens permanecem
bloqueadas. Headers, query e corpo não fornecem essa configuração. O Worker deriva
a configuração dos bindings; ela não vem do cliente. Produção não recebe uma
habilitação global.

`/api/context` informa `membersEnabled` somente após sessão pronta, organização
ativa e membership administrativo atual. A mesma decisão é aplicada a todas as
APIs de membros, inclusive recibos. O middleware recusa antes de validar entrada;
cada operação revalida o recorte no contexto que usará na persistência, evitando
que uma troca concorrente de tenant aproveite uma decisão anterior. Sem recorte,
as APIs retornam `404` sem consultar tabelas de membros, mantendo compatibilidade
com o schema anterior. Com recorte válido, anônimo recebe `401`, vínculo revogado
ou role desconhecida `403`, e administrador fora do recorte `404`. A SPA oculta a
navegação quando a capacidade é falsa e limpa dados ao revalidar contexto/acesso;
sem canal de push, mudanças externas são conhecidas na próxima revalidação.

A lista não concede membership, não prova que uma organização contém apenas dados
sintéticos e não substitui a autorização Foundation. A seleção e verificação das
fixtures são responsabilidade operacional. Antes de qualquer habilitação, aplicar
a migration pendente em operação separada e explicitamente autorizada; permitir
uma organização com schema anterior causará falha de operação, não migration
automática.

O workflow DEV propaga a variable para a configuração temporária gerada pelo
deploy. Ausência/erro escreve valor vazio explicitamente, sem herdar recorte antigo
do arquivo base. A configuração Wrangler raiz permanece sem UUIDs e desabilitada.
Mudar a variable GitHub não modifica o Worker já publicado: habilitação **e
retirada do recorte** exigem novo deploy autorizado. `LEVI_DEV_DEPLOY_ENABLED` e os
gatilhos existentes não foram alterados. A presença das rotas da SPA no bundle não
concede acesso às APIs. Ver [Deploy DEV](deploy-dev.md) para as guardas operacionais.

Esta entrega não autoriza dados reais, migrations persistentes ou deploy. Usar
somente dados sintéticos em bancos isolados. Retenção, eliminação, direitos dos
titulares e recuperação precisam ser resolvidos antes de liberar uso real.

## Contratos e decisões mínimas

- Campos técnicos da API usam identificadores em inglês, como os contratos
  existentes; interface e mensagens usam português brasileiro.
- `name`, `churchId` e `status` são obrigatórios. `status` aceita somente `Ativo`
  ou `Inativo`; a seleção inicial visível é `Ativo`, sem impedir `Inativo`.
- Datas civis (`birthDate`, `joinedOn`, `baptismDate`) são strings `AAAA-MM-DD`
  válidas no calendário gregoriano, anos de 0001 a 9999, ou ausência. Persistem
  como `DATE`, com leitura string, sem conversão por `Date` ou deslocamento UTC.
  Não foram inventadas restrições de datas futuras ou relações entre essas datas.
- Telefone é texto de até 40 caracteres; e-mail de contato tem até 254 e validação
  sintática simples; função na igreja tem até 160. Nome tem de 1 a 160 caracteres
  após trim. **Endereço é um único texto opcional de até 500 caracteres**, sem
  campos pessoais adicionais, geocodificação ou catálogo. Não é campo de notas.
- Opcionais omitidos, `null`, vazios ou somente espaços normalizam para `null`.
  Tipos diferentes de string/null e campos extras são rejeitados. Contatos e nomes
  podem se repetir; função não concede permissão. Metadados não são aceitos do
  cliente. Cadastro não cria login, membership ou convite.

| Método/caminho                   | Contrato                                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/members`              | JSON com os campos acima e header `Idempotency-Key` de 16 a 128 caracteres alfanuméricos, `_` ou `-`. Responde `201` com `{ organizationId, memberId }`, inclusive no replay idêntico.                          |
| `GET /api/members`               | Filtros opcionais `name`, `churchId`, `status`, `page`, `pageSize`. Responde `{ organizationId, members, page, pageSize, hasNext }`. Lista somente ID, nome, igreja e situação, sem contatos ou ficha completa. |
| `GET /api/members/:id`           | Ficha, com `{ organizationId, member }`. Outra organização e UUID inexistente recebem o mesmo `404`.                                                                                                            |
| `GET /api/members/requests/:key` | Recupera `{ organizationId, memberId }` da tentativa do próprio ator na organização atual. Sem recibo, outra organização ou outro ator recebem `404`. Não recebe nem devolve perfil pessoal.                    |

Todas exigem sessão pronta e vínculo administrativo atual. Permissões estáticas
`members:read` e `members:create` usam `@t00ls-dev/access`; contexto usa o contrato
Foundation existente. Falhas preservam o padrão `{ erro, mensagem }`, headers
privados, CSRF e limites de corpo existentes. Nenhuma resposta é cacheável.

Busca de nome é por trecho literal sem distinção de caixa (`ILIKE`), preservando
acentos; `%`, `_` e barra invertida não viram curingas do usuário. Igreja e situação
combinam-se com nome por AND. Filtros nunca atravessam a organização; igreja
inexistente ou externa produz lista vazia, sem exposição de existência.

Paginação: página padrão 1, tamanho padrão 20, máximo 100 e página máxima 10000.
Valores inteiros positivos, parâmetros desconhecidos e repetidos são validados.
Ordenação por nome e UUID, conforme collation do PostgreSQL; UUID desempata
homônimos. Busca usa `LIMIT tamanho+1` para `hasNext`, sem contagem global.
Paginação por offset não promete snapshot entre requisições quando há cadastros
concorrentes. Volume/índices de busca por trecho devem ser medidos antes de uso
em escala; não há dependência de extensão ou serviço de busca.

## Integridade, histórico e reenvio

A migration `0002_membros.sql` cria `members`, `member_history` e
`member_creation_requests`. A FK composta `(tenant_id, church_id)` exige igreja
da mesma organização. O histórico inicial contém somente fato de criação,
ator, instante, nome institucional da igreja e situação inicial, sem copiar a
ficha em JSON ou propor um histórico genérico. Seu nome de igreja é um snapshot
para sobreviver à evolução institucional. Novos tipos de histórico exigirão
outra decisão/migration na etapa correspondente.

Membro, histórico, evento técnico `member.created` com metadata `{}` e recibo
confirmam na mesma transação e no mesmo Client PostgreSQL. Falha em qualquer
um desfaz todos. Histórico e recibo têm FK composta com `ON DELETE CASCADE` para a
ficha; isso prepara futura eliminação, sem oferecer API de exclusão agora.
Auditoria técnica permanece separada, mínima e append-only, com identificadores
sujeitos à política de retenção ainda pendente.

Idempotência é escopada por organização, ator e chave aleatória. Um advisory lock
transacional por tentativa serializa reenvios; sessão, tenant ativo e membership
são revalidados depois da espera, com locks compartilhados durante a criação.
Recibo guarda hash SHA-256 da entrada normalizada e ID resultante, dentro da área
eliminável; não é chave de identidade nem metadado de auditoria. Chave igual com
entrada divergente retorna `409`; chave nova permite cadastrar homônimo legítimo.
Nenhum adapter Foundation foi alterado.

A interface impede submissões simultâneas e conserva somente chave opaca por
organização em `sessionStorage`, nunca nome, contato, ficha ou token. Após resultado
incerto, oferece consulta do recibo e repetição explícita da mesma tentativa. Após
refresh do formulário, tenta recuperar o resultado pela chave antes de permitir
nova submissão. Se ainda não há recibo, conserva a chave para evitar duplicação
quando a tentativa anterior concluir. Dados do formulário são mantidos somente
na memória da página. Sem storage, a proteção permanece durante a mesma montagem;
refresh nesse caso perde a chave e exige consultar os cadastros antes de uma nova
tentativa. Recibos permanecem enquanto a ficha existir; não há rotina de expiração
que permita reutilização silenciosa de chaves antigas nesta entrega.

Ao navegar/trocar organização, a aplicação remove os dados anteriores antes de
reconsultar. Ao recuperar foco/página, revalida sessão/contexto. Respostas carregam
organização e são comparadas ao contexto exibido; respostas atrasadas de uma
montagem anterior não repovoam a tela. Uma revogação externa só pode ser conhecida
na próxima consulta/revalidação; não há canal de push ou promessa de atualização
instantânea enquanto a página permanece sem interação.

### Proteção do UPDATE necessário ao lock no DEV

A migration `0003_protecao-update-runtime.sql` acrescenta uma função de trigger
`SECURITY INVOKER` e triggers `BEFORE UPDATE FOR EACH STATEMENT` em `churches` e
`tenant_memberships`. Rejeita com SQLSTATE `42501` toda instrução UPDATE cujo
`current_user` seja `levi_dev_runtime`, inclusive sem linhas correspondentes.
Não dispara no SELECT FOR SHARE e não impede UPDATE de outras roles autorizadas.
O retorno NULL da função é ignorado por ser um trigger por instrução; não oculta
atualizações de outras roles nem descarta linhas silenciosamente.

PostgreSQL exige UPDATE em ao menos uma coluna para FOR SHARE. Uma futura
concessão somente em `created_at` satisfaz o lock, enquanto o trigger rejeita a
mutação efetiva pela runtime DEV. **Esta migration não concede privilégios** e
não habilita o módulo. Sua aplicação persistente, os grants mínimos e qualquer
deploy exigem operações separadas autorizadas.

A função usa `search_path = pg_catalog`, sem leitura de dados ou elevação de
privilégios. A role que aplica a migration deve ser a proprietária das tabelas;
função e triggers permanecem sob seu controle. A runtime deve continuar sem
ownership, CREATE no schema, TRIGGER, capacidade de assumir outra role ou alterar
`session_replication_role`. Owners e administradores podem modificar a proteção;
o nome exato da role DEV é parte da política e renomeá-la exige revisão. Uma
futura função SECURITY DEFINER que execute UPDATE com outra identidade também
exigirá revisão, pois o bloqueio usa o usuário efetivo. Não é uma proteção RLS
nem substitui a autorização por organização na aplicação.

O teste `test/runtime-update.integration.test.ts`, executado pelo harness de
integração, cria outro banco no mesmo container descartável, com migradora owner
sem SUPERUSER e logins runtime/operador independentes. Aplica primeiro 0000–0002,
preserva fixtures sintéticas e aplica 0003 pelo migrator Drizzle. Exercita locks,
bloqueio de UPDATE, tentativas de alterar/desativar a proteção e operações
legítimas de outras roles. Não utiliza conexão ou credencial de ambiente remoto.

## Validação isolada

Com dependências e ferramentas locais existentes:

```sh
npm run format:check
npm run typecheck
npm test
npm run build
npm run worker:build
npm run test:integration
npm run test:worker
npm run test:e2e
```

Integração e E2E usam exclusivamente os containers descartáveis dos harnesses,
com imagem PostgreSQL fixada e porta aleatória em loopback. Aplicam o histórico
duas vezes nesse banco sintético e o removem em `finally`. Não executar
`db:migrate:dev` ou `deploy:dev` para validar esta entrega. Geração da migration
usa `npm run db:generate -- --name=membros`, sem conexão a banco.
