# Links

Links é a aplicação de referência do Foundation: uma biblioteca **privada** de
bookmarks com React SPA, Hono, Better Auth, Drizzle e Cloudflare D1 no mesmo
Worker. O exemplo está em `examples/links`, com package
`@t00ls-dev/example-links`. O preset autônomo `basic-d1` permanece independente.

## Fundação visual compartilhada

`packages/ui/src/styles.css` define tokens semânticos de cor, espaçamento,
tipografia e foco. `src/client/styles.css` compõe Links: fundo claro, identidade
verde profunda, superfícies discretas e biblioteca de coluna única. O shell usa
o workspace UI privado; protocolos de autenticação permanecem intactos.

- Layout: `.container`, `.container--narrow`, `.stack` e `.cluster`; filhos de
  flex/grid podem encolher e conteúdo longo quebra linhas sem corte.
- Botões usam Button/PendingButton Foundation e `disabled` nativo. Google
  preserva marca do provider e alvo mínimo de toque de 44px.
- Superfícies são intencionais: formulários/artigos não viram cards
  automaticamente.
- InlineFeedback trata erros contextuais e resultados indeterminados, com erros
  associados aos campos. Mutations confirmadas usam Sonner por escopo;
  resultados de links de e-mail persistem. Loading mantém busy e anúncios
  acessíveis sem narração visual duplicada.
- Controles usam texto de 16px no tamanho padrão, bordas inválidas visíveis e
  anel de foco compartilhado. Alto contraste preserva bordas/foco; não se exige
  animação para comunicar estado.

A fundação é mobile-first. Reflow cobre 320px até desktop, viewport CSS reduzido
para zoom, escala/texto CSS de 200% e conteúdo longo. Esses checks não emulam a
interface de zoom da barra do navegador.

## Espaçamento de formulários e ações entre páginas

Home/Auth/Account/Reset reutilizam espaçamento e grupos de ações. Labels, dicas
e erros ficam separados do submit; retornos de Verification/reset inválido usam
alvos de 44px. Espaços de introdução/ação são explícitos; stack de Account
controla seu título e Verification usa a variante de sucesso. Profile edita
Name, com Email readonly selecionável e Save changes estável, desabilitado até
mudança efetiva. Password bloqueia fechar Dialog durante mutation/reconciliação;
Authenticator fecha só após confirmação final. Rascunhos e segurança mantêm
ciclos.

## Bookmarks e navegação compacta

Links é o link da Home. Desktop/tablet mostra Bookmarks, Account e Sign out
global discreto, sem indicadores de tabs. Mobile usa menu acessível e divisor
antes de Sign out; nome do usuário fica em Profile. Controles preservam alvos de
44px, foco de teclado e semântica da rota ativa.

**Add bookmark** se alinha ao título: apenas ícone em telas estreitas,
preservando nome acessível. Search é explícito; Tag pode ser expandida e Clear
aparece quando pertinente. Linhas mostram URLs/descrições compactas, tags
discretas e Edit/Delete. Texto integral permanece no DOM/árvore acessível e
editor; delete identifica URL completa. Paginação só aparece com página
anterior/seguinte. Editores colocam URL antes de Title em uma coluna, expandem
detalhes opcionais e oferecem um Back to bookmarks. CRUD, validação, filtros,
isolamento e resposta perdida permanecem intactos.

## Desenvolvimento local

Requer Node.js >=22.22.0 e pnpm do workspace.

1. Na raiz, execute `pnpm install --frozen-lockfile` e `pnpm build` para
   compilar também as dependências Foundation.
2. Neste diretório, copie `.dev.vars.example` para `.dev.vars`; use um secret
   aleatório de pelo menos 32 caracteres e credenciais Resend de
   desenvolvimento.
3. Execute `pnpm db:migrate:local` e `pnpm dev`.
4. Abra a origem informada pelo servidor. `BASE_URL` deve corresponder
   exatamente à origem usada, incluindo host e porta. Não misture `localhost` e
   `127.0.0.1`.
5. Cadastre-se, abra o link de verificação recebido por e-mail e faça login.

O script `dev` compila a aplicação e inicia Wrangler. Para desenvolvimento com
HMR, `pnpm exec vite --host localhost --port 5173` usa o plugin Cloudflare;
configure `BASE_URL=http://localhost:5173` e aplique migrations primeiro.

Verificação de e-mail é obrigatória. Magic link e recuperação/redefinição
existentes continuam disponíveis como opções secundárias. Sessões são cookies
Better Auth `HttpOnly`, `SameSite=Lax`, seguros em HTTPS, persistidos em D1;
nenhum token é armazenado em `localStorage`. Os defaults atuais são sete dias de
validade e renovação após um dia. O servidor encaminha todos os `Set-Cookie` de
`@t00ls-dev/auth.resolveSession`, inclusive limpeza de sessão expirada.

Logout só é confirmado após verificar a revogação em D1, sem renovar a sessão.
Falha ou confirmação indisponível retorna `503` e preserva o cookie para retry.
Logs auth contêm apenas eventos estáticos sanitizados. No cliente, cada operação
privada pertence a uma geração de sessão; respostas de gerações anteriores não
podem expirar a nova identidade nem disparar navegação ou atualização de estado.

## Funcionalidades e API

### Home e navegação

`/` é a Home pública para visitantes autenticados ou não; não carrega bookmarks
e permanece disponível com sessão pendente/indisponível. **Open Links** leva à
biblioteca privada `/bookmarks`. Links retorna à Home; header oferece Sign in/
Create account a visitantes e Bookmarks/Account/Sign out ao usuário, em menu
mobile.

`/bookmarks`, `/bookmarks/new`, `/bookmarks/:id/edit` e `/account` são
protegidos. Login usa `/bookmarks`; deep links preservam `next` validado em
senha, cadastro/ verificação, Magic Link e callback Google. Somente rotas
privadas locais conhecidas são aceitas; destinos externos/não suportados
retornam a `/bookmarks`. Salvar/ cancelar editor e voltar de Security também
levam a `/bookmarks`.

Expiração remove conteúdo privado e encaminha ao login com explicação genérica.
Logout em página privada leva ao login; em pública mantém a página. Rotas
desconhecidas levam visitantes à Home e autenticados a Bookmarks. A semântica de
sessão no gerenciamento de senha permanece intacta.

- criação, leitura, edição e exclusão de bookmarks;
- título, URL HTTP/HTTPS, descrição opcional e tags;
- busca por título/URL/descrição e filtro exato por tag, combinados por `AND`;
- paginação `limit`/`offset`, ordenação estável por criação e ID descendentes;
- estados de sessão/listagem/envio, vazio, erro e retry;
- UI responsiva com labels, erros associados e foco de campo inválido.

### Google opcional

Sign in e Create account mostram **Continue with Google** somente quando
`GET /api/config` retorna `googleEnabled: true`. O contrato público também
contém o estado/site key públicos de Turnstile, usa `private, no-store` e não
consulta D1. Não existe flag Vite nem configuração Google no browser.

Um único resolver server-side decide a configuração do Better Auth e a
capability:

- ambas as credenciais ausentes/vazias/whitespace: Google desabilitado, `false`;
- `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` presentes: Google habilitado,
  `true`;
- apenas uma presente: configuração inválida, auth/config retornam `503` com
  `AUTH_CONFIGURATION_INVALID` e mensagem fixa, sem revelar a credencial.

`/health` continua diagnosticando Worker/D1 independentemente de Google. O botão
usa `authClient.signIn.social`, redirects e state do Better Auth 1.7.7, sem GIS
SDK. O logo local e o estilo claro vêm do
[configurador oficial Google](https://developers.google.com/identity/branding-guidelines);
usa fallback Arial/Roboto local, sem download de fonte. O Client Secret
permanece no servidor; o Client ID aparece apenas na URL pública de autorização
Google.

Registre no Google Console o callback exato
`${BASE_URL}/api/auth/callback/google`; em DEV:
`https://foundation.t00ls.dev/api/auth/callback/google`. Sucesso retorna para
`/bookmarks` (ou o deep link privado validado) e a sessão normal do Links.
Cancelamento com state válido retorna para `/login?oauth=failed`; a UI mostra
mensagens fixas e ignora `error_description`. State ausente/inválido preserva a
página de erro padrão do Better Auth em `/api/auth/error`, sem interceptação
própria. Clique duplo é bloqueado; erro permite retry e Back/bfcache libera
pending e recarrega a capability.

`OAuthButton` recebe apresentação do provider (label, ícone, marca) separada do
início/capability. Google é o único provider. No início do login o botão
desabilita, troca ícone decorativo por spinner do mesmo tamanho e mantém
**Continue with Google**. Não há mensagem de sucesso/status de redirect abaixo.
Falha antes da navegação restaura ícone/estado e mostra erro sanitizado. Expõe
`aria-busy`; reduced-motion desabilita rotação.

Os testes locais verificam configuração, D1, início/cancelamento e UI simulada;
não equivalem a OAuth Google real. Após eventual merge/deploy automático,
validar em DEV: botão em login/signup, consentimento Google e callback real,
identidade e biblioteca, reload, cookies HTTPS e logout/revogação; repetir com
conta Google existente e nova, cancelar e tentar novamente. Revalidar os fluxos
email/password, verificação, Magic Link e reset já existentes. Nenhum smoke
remoto é disparado pelos testes da UI.

### Configurações da conta

Account oferece autenticador para senha: senha → QR/key local → confirmação de
seis dígitos, com desativação por senha. Login com `twoFactorRedirect` leva a
`/two-factor` antes da navegação concluída. Magic Link e Google são alternativas
sem desafio TOTP do Links; não é MFA para toda a conta. Veja
[TOTP e recuperação](../../docs/runbooks/links-totp.md).

`/account` é canônica. `/account/security` redireciona preservando
query/fragment e retorno da autenticação. Profile oferece **Edit name** e **Save
name** explícito; Email é informativo, nunca input desabilitado. Security mostra
Password e Authenticator independentes, uma tarefa aberta por vez. Autenticador
normal oferece Off → Set up / On → Turn off; desconhecido nunca vira Off. Um
Dialog responsivo trata senha, QR/código e confirmação autoritativa. Key fica
fora do DOM textual até abrir **Can't scan? Use setup key**. Copy escreve secret
original e confirma localmente só após sucesso da Clipboard API; falha permite
seleção manual. Recuperação aparece após exceção observada, não apenas estado
On. Nomes passam por trim, são obrigatórios, limitados a 200 caracteres e sem
caracteres de controle; nomes internacionais/pontuação são aceitos. Validação
compartilhada protege `/api/auth/update-user` antes de delegar ao Better Auth.

Nome usa `authClient.updateUser({ name })` do Better Auth 1.7.7, que atualiza
usuário/cookie sem rotacionar/revogar sessões e notifica listeners. UI confirma
usuário/nome/e-mail por `getSession` sem cookie cache e refaz a sessão exibida.
Falha inesperada é indeterminada, sem retry automático. Requests abortam em
logout/unmount; feedback obsoleto não afeta outra conta.

### UX de recuperação de senha

Antes dos campos, ResetPassword consulta GET público Better Auth
`/api/auth/reset-password/:token` com callback `/reset-password` fixo. Fetch
segue redirects em same-origin/no-store com AbortSignal; exige 200 redirecionado
nesta origem/path exatos, só token correspondente ou `error=INVALID_TOKEN`.
Respostas inesperadas/falha de rede oferecem retry de verificação, sem afirmar
token inválido.

O harness Worker/Assets verifica que esse fetch não navega/executa SPA nem
consome token. POST `resetPassword` continua autoritativo. INVALID_TOKEN tardio
remove campos e oferece novo link. Erro indeterminado limpa campos, sem retry
automático ou mensagens brutas upstream. Tokens não são logados ou armazenados
fora de URL/ memória; requests abortam em unmount/troca de token.

A navegação usa sessão central: autenticados recebem **Back to Account** e
visitantes confirmados, **Back to sign in**; sessão indefinida/com erro mantém
loading/retry. Reset preserva a política de sessões. Account encaminha primeira
senha ao Forgot público, com preenchimento opcional do e-mail da sessão e submit
explícito. Forgot preserva proteção contra enumeração.

### Security — senha da conta

O link **Account** do header autenticado abre `/account`, com a seção Security
abaixo de Profile. `GET /api/account/security` exige sessão e retorna somente
`{ "hasPassword": boolean }`, com `private, no-store`. Não aceita parâmetros de
query ou identidade do cliente. A consulta usa o usuário da sessão e a chave
credential (`userId`, `providerId=credential`, `accountId=user.id`); verifica
senha não vazia no banco sem carregar/retornar hash ou metadata de accounts.
Erro de consulta é erro/retry, nunca `false`.

Com senha, a tela pede senha atual, nova e confirmação e usa exclusivamente
`authClient.changePassword` com `revokeOtherSessions: true`. Better Auth revoga
as sessões antigas, inclusive a atual, e entrega uma substituta por cookie. O
Links invalida a geração de requests privados, resolve a nova sessão e permanece
autenticado. Campos sensíveis são limpos em sucesso. Senha atual incorreta tem
mensagem fixa recuperável.

Falha inesperada pode ocorrer depois de a senha já mudar e antes/depois da
revogação. A UI não faz retry automático nem afirma que nada mudou: informa que
a conclusão não pôde ser confirmada e orienta novo login/reset. Campos sensíveis
são limpos nesse estado indeterminado.

Sem senha (por exemplo, identidade Magic Link/Google), a tela encaminha ao
formulário público de reset, protegido por Turnstile quando configurado; o link
recebido estabelece a primeira senha. Não há `setPassword` ou endpoint
customizado de escrita. A resposta de envio continua genérica. **Reset/primeira
senha não revoga sessões existentes na política atual**; este incremento não
altera essa configuração global.

Signup, reset e troca exigem confirmação apenas no frontend: senha nova entre 8
e 128 caracteres, confirmação exatamente igual, sem trim/normalização. Senha
atual é somente obrigatória na validação local. `confirmPassword` nunca integra
payload Better Auth; login/Magic Link/forgot não exigem confirmação. Name
continua obrigatório no signup. Nenhuma senha/token é armazenado em browser
storage ou log.

### Bookmarks

| Método | Rota                                       | Resultado                    |
| ------ | ------------------------------------------ | ---------------------------- |
| GET    | `/api/bookmarks?q=&tag=&limit=20&offset=0` | `{ items, hasMore }`         |
| POST   | `/api/bookmarks`                           | Bookmark criado, `201`       |
| GET    | `/api/bookmarks/:id`                       | Bookmark ou `404`            |
| PATCH  | `/api/bookmarks/:id`                       | Bookmark atualizado ou `404` |
| DELETE | `/api/bookmarks/:id`                       | `204` ou `404`               |

Payload de criação:

```json
{
  "title": "Foundation",
  "url": "https://example.com",
  "description": null,
  "tags": ["docs", "work"]
}
```

Descrição e tags podem ser omitidas na criação, com defaults `null` e `[]`.
PATCH aceita qualquer subconjunto não vazio e preserva os campos omitidos.
Limites: título 200, URL 2.048, descrição 2.000 caracteres; até 10 tags de 40
caracteres. Tags são normalizadas com trim/minúsculas e deduplicadas. Vírgulas
em cada tag são rejeitadas porque a UI usa vírgula como separador. Não há
catálogo global de tags: são um array JSON do bookmark. URLs duplicadas são
permitidas.

Busca trata `%`, `_` e barra invertida como texto literal. É busca simples do
SQLite, sem FTS nem promessa de normalização linguística de acentos/case
Unicode. `limit` varia de 1 a 100; `offset` de 0 a 1.000.000. A UI usa páginas
de 20. Edições concorrentes seguem a política de última escrita vence.

### Isolamento e limites dos packages

Toda query, filtro e mutação usa o `user.id` da sessão validada no servidor. Não
há propriedade editável no payload. Acesso a bookmark de outro usuário retorna o
mesmo `404` de um ID inexistente; ausência de sessão retorna `401`. Mutações por
cookie exigem `Origin` compatível com `BASE_URL` pelo helper CSRF do Foundation.
As rotas auth preservam as proteções próprias do Better Auth.

`src/server` compõe auth, sessão, handlers e repository;
`src/shared/bookmarks.ts` contém contratos Zod seguros para consumo no
navegador. A aplicação consome `@t00ls-dev/auth`, `@t00ls-dev/db/d1`,
`@t00ls-dev/email` e `@t00ls-dev/security`; somente o domínio de bookmarks
pertence ao exemplo.

Não inclui tenancy/RBAC, TOTP/2FA, recovery codes, preferências/unsubscribe,
novos templates ou analytics. Identidade/e-mail permanecem separados dos
bookmarks para futuras evoluções. O template autônomo `create-app basic-d1`
permanece um starter técnico mínimo, sem copiar o domínio Links.

## Migrations

`src/schema.ts` é a fonte de `pnpm db:generate`. Revise SQL, snapshot e journal
antes de aplicar. O histórico inclui `0001_better_auth.sql` e a migration
aditiva `0002_links.sql`, que cria somente `bookmark`, FK em cascata, índice por
usuário e constraint de array JSON. O histórico auth e o snapshot anterior são
preservados. Os índices de snapshots/journal são independentes do prefixo
histórico dos SQL; Drizzle pode gerar um próximo prefixo que precise ser
ajustado antes da primeira aplicação, sem renomear migrations já aplicadas.

`db:migrate` e `db:status` usam D1 local; somente `db:status:dev` consulta DEV.
Escrita remota usa fases independentes de Migration DEV coordenadas com deploy;
deploy não aplica SQL. Metadata, dirty/recuperação e o fluxo
`expand → deploy → [backfill] → contract` estão no
[runbook de migrations](../../docs/runbooks/migrations.md). `db:seed` executa
apenas `seeds/local.sql`, atualmente sem dados de contas, e nunca faz parte do
deploy. Migrations aplicadas são imutáveis e recebem correções forward-only. A
adição permite rollback do código anterior sem remover tabelas.

## Testes determinísticos

Depois de compilar os packages Foundation:

```bash
pnpm test
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

- Unitários: validação, protocolos de URL, normalização, limites e respostas de
  gerações de sessão obsoletas.
- Integração: Miniflare/D1 real local, migrations reais, auth, CRUD, dois
  usuários, filtros/paginação, CSRF, expiração/revogação, cookies e headers
  privados, falhas de revogação/confirmação e sanitização de logs de execução.
- E2E: nove cenários em Chromium desktop e mobile, totalizando 18 execuções;
  cadastro/verificação/login/logout, CRUD, reload, isolamento, erros/loading,
  sessão expirada e respostas privadas atrasadas após troca de usuário,
  incluindo um `401` de mutação de A liberado somente depois do login de B pela
  SPA.

Nenhum teste envia e-mails reais. Integração injeta um provider capturador. E2E
usa `e2e/worker.ts` com caixa de e-mail no D1 **temporário**, configuração
própria e porta 5174. O harness aplica o histórico duas vezes para validar o
journal Wrangler, inicia Vite e remove o estado ao encerrar. Não reutiliza o
banco local, não usa segredos DEV e não habilita remote bindings. O endpoint
`/__test/mail` existe somente no entrypoint de teste, nunca no Worker de
`src/worker.ts`.

Na raiz, o gate completo é `pnpm check`, incluindo distribuição e release.

## DEV e validação operacional

O DEV remoto mantém `foundation.t00ls.dev` e o D1 `basic-d1-dev`. Segredos são
configurados com `wrangler secret put --env dev`; `BASE_URL`/`EMAIL_FROM` estão
em `env.dev.vars`. CI validada coordena fases próprias de migration e deploy,
com smoke obrigatório de SHA/D1. Ativação exige tokens segregados de
[Ambientes](../../docs/runbooks/environments.md); CI e inicialização não aplicam
migrations remotas.

`GET /health` verifica Worker/D1, retorna `503` sanitizado em falha e
`no-store`. Auth e APIs privadas enviam `private, no-store` e
`Vary: Cookie, Authorization`. Configure o bypass de cache para `/api` e demais
caminhos documentados em `docs/runbooks/cache.md`; nenhuma resposta privada deve
apresentar cache `HIT`.

Após publicar, validar manualmente com duas contas:

1. cadastro, entrega/verificação de e-mail e login;
2. CRUD, busca/tag e persistência após reload;
3. segunda conta sem acesso à biblioteca/IDs da primeira;
4. logout e acesso privado bloqueado;
5. health e headers/cache no domínio real.

Esse smoke funcional remoto depende de publicação após merge; `/health` sozinho
não comprova os fluxos de usuário. Google OAuth continua opcional mediante os
dois secrets existentes.

## Base UI e shell

O Links consome `@t00ls-dev/ui` como workspace privado, com Tailwind v4 e scan
explícito das fontes. Base/shell (PR 1), Bookmarks (PR 2) e Account/Auth/TOTP
(PR 3) usam os padrões compartilhados. Veja os
[padrões de UI](../../packages/ui/README.md) e o
[ADR-008](../../docs/decisions/008-foundation-ui-v1.md).

### Bookmarks

A primeira leitura reserva cards/form por Skeleton; refresh mantém os resultados
da mesma identidade, com indicação local e erros persistentes inline. Erro na
primeira leitura nunca vira “No bookmarks yet”. Requests superados/navegação são
abortados, mantendo as fronteiras de usuário/sessão e gerações existentes.

Os filtros aplicados `q`, `tag` e `offset` ficam na URL da biblioteca. Links de
add/edit usam `returnTo` somente quando necessário; a allowlist aceita apenas
`/bookmarks` e filtros validados. Save/Cancel retornam à página filtrada; rotas
sem filtros preservam seus paths originais. Drafts do editor sobrevivem a erros
de save e refetch da mesma sessão, sem storage persistente.

Delete usa AlertDialog que identifica título/URL, começa com foco em Cancel,
trava o foco e aceita Escape. Após sucesso, foco volta ao trigger ou ao heading
se o card foi removido. Cancel durante um delete fecha o diálogo, mas o request
continua: não promete rollback. Resposta perdida mantém o resultado
indeterminado inline e permite refresh explícito; não anuncia sucesso presumido
ou undo.

PendingButton bloqueia submits duplicados em save/delete. Sucesso confirmado
após navegação/fechamento usa uma mensagem fixa Sonner; erro de campo fica
associado ao input e erros recuperáveis ficam inline. Delete preserva filtros e
página, retornando à anterior somente quando remove o último item da última
página. Uma página vazia por stale/deep link recupera a primeira página sem
confundir isso com biblioteca vazia. Backend/contratos CRUD permanecem os
mesmos.
