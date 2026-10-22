# Gestão de membros — primeira fatia local

Implementa cadastro, listagem paginada, filtros e ficha individual. O escopo
pessoal e as invariantes continuam em [Decisões do MVP](decisoes-mvp.md).
Não implementa edição, exclusão, alteração posterior de situação, transferência,
aniversariantes, indicadores, convites ou associação automática a contas.

## Habilitação e limites

A composição `createApp` recebe `membersEnabled`, desabilitado por padrão.
O executável Node local habilita a fatia apenas com `LEVI_LOCAL_DATABASE=1`,
conservando suas guardas de origem/banco local e servidor em loopback. Os harnesses
sintéticos a habilitam explicitamente. **O Worker não a habilita**, não há binding
ou configuração remota nova: as APIs de membros retornam `404` e a navegação não
oferece membros nesse ambiente. `/api/context` informa `membersEnabled` ao cliente.
A presença das rotas da SPA no bundle não concede acesso às APIs.

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
