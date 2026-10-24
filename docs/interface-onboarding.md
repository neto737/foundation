# Interface de onboarding

A SPA React permite verificar o e-mail, definir senha, entrar na conta,
provisionar a organização com a primeira igreja, selecionar uma organização
administrada e consultar suas igrejas. O escopo permanece em
[Decisões do MVP](decisoes-mvp.md); a API e a preparação do banco sintético estão em
[Onboarding e provisionamento](onboarding-provisionamento.md).

## Estrutura e execução

Um projeto npm, com TypeScript estrito. `web/src/app.tsx` compõe os estados da
interface; `forms.tsx` contém os formulários; `api.ts` valida as respostas HTTP;
`session.ts` trata retornos de links e a chave de idempotência. O frontend não
importa módulos de servidor, schema, adapters ou credenciais. React e React DOM
são as únicas dependências de execução adicionadas. Vite produz os assets;
Playwright e Axe são ferramentas de teste. Não há biblioteca de UI ou estado global.

Após configurar o ambiente local sintético conforme o guia da API:

```sh
npm ci --ignore-scripts
npm run dev
```

Abra **http://localhost:5173**. O comando inicia Vite e Hono e encerra seus próprios
processos ao sair. Vite encaminha `/api` à API em loopback, preservando `Origin`,
cookies e `Set-Cookie`; não habilita CORS nem reescreve cookies. A origem pública
5173 é configurada no servidor para os links de e-mail e a validação de origem.
Use esse hostname de forma consistente. Para iniciar os processos separadamente:

```sh
LEVI_PUBLIC_ORIGIN=http://localhost:5173 npm run dev:api
# Em outro terminal, com a mesma LEVI_PORT se personalizada:
npm run dev:web
```

`npm run build` compila API e SPA em `dist/`. `npm start` serve ambos pela origem
local 3000. `src/web.ts` entrega HTML apenas nos caminhos conhecidos da SPA:
`/`, `/onboarding`, `/entrar`, `/organizacoes`, `/igrejas` e as rotas de membros
listadas em `src/web-paths.ts`. Rotas desconhecidas da
API continuam retornando JSON, sem fallback HTML. Migrations continuam explícitas
e separadas da inicialização e do build. A publicação Worker DEV usa o
[fluxo automático após CI](deploy-dev.md).

## Fluxo e retomada

1. Informe o e-mail e abra o primeiro link recebido. A tela de confirmação não
   informa se uma conta já existe.
2. O Magic Link nativo verifica o e-mail e estabelece a sessão. A tela solicita
   explicitamente o **segundo e-mail**, para definir a senha.
3. Abra o segundo link no mesmo navegador; defina e confirme a senha. A conta
   pronta pode continuar com a sessão já estabelecida. A tela de login permite
   autenticar sessões posteriores.
4. Informe os nomes da organização e da primeira igreja. Após o provisionamento,
   selecione explicitamente a organização para consultar as igrejas autorizadas.

A primeira leitura e cada retorno/atualização consultam `/api/onboarding`. Refresh
retoma a etapa real do servidor; links inválidos, expirados ou reutilizados
orientam solicitar outra mensagem. Se o link de senha for aberto sem a sessão
verificada, é necessário restabelecer essa sessão e solicitar outro link.

O token de senha é retirado imediatamente da URL, inclusive fragmentos/erros,
antes de renderizar React. Permanece somente na memória da página e é descartado
após aplicação ou erro. Atualizar essa página exige novo e-mail: não se persiste o
segredo para conservar o formulário. Não há analytics, logs de requests,
service worker ou armazenamento de tokens de sessão. Cookies permanecem HttpOnly.

Somente a chave opaca `levi.onboarding.request` pode ficar em `sessionStorage` para
repetir provisionamento. Nomes, e-mail, senha e payload não são persistidos. Falha
de rede não significa falha da transação: a interface exige consultar o resultado
antes de reenviar e conserva a chave. Após refresh, consulta a etapa antes de
mostrar o formulário. O servidor continua responsável pela atomicidade e pelos
conflitos. Botões e submissões concorrentes são bloqueados durante operações.

## Contratos e segurança

O cliente usa somente os endpoints documentados da API: consulta/emissão de
onboarding, senha, login/logout nativos, provisionamento/listagem de organizações,
seleção de tenant, contexto e listagem de igrejas. Todas as chamadas são relativas,
com cookies de mesma origem, sem cache e com limite de espera de 15 segundos.
Respostas são validadas antes de abrir estados protegidos. `401`/`403` removem os
dados exibidos e reconsultam a sessão/vínculos; `409` não concede acesso nem cria
uma nova tentativa automaticamente. Erros de conexão não expõem a exceção original.

Duas adaptações mínimas permitem compor a web sem mudar autenticação:

- O callback de onboarding aceita uma opção estática `/onboarding` na composição
  local. O padrão `/api/onboarding` permanece para consumidores da API. Nenhum
  destino de redirecionamento é aceito do usuário.
- `GET /api/churches` conserva `churches` e acrescenta `organizationId`, obtido do
  mesmo contexto autorizado usado na consulta. Um teste reproduziu a troca de
  tenant entre a leitura do contexto e a leitura das igrejas. Se os IDs diferirem,
  a SPA retorna à seleção, impedindo mostrar igrejas sob o nome de outra organização.

O backend mantém a allowlist de auth, CSRF/origem, validação de prontidão e vínculo
atual. A SPA não concede autoridade por URL ou estado local. Não há UI para criar
outras organizações, igrejas adicionais, convites ou permissões locais. A
[interface de membros](gestao-membros.md) só aparece quando o servidor informa
a capacidade da organização ativa; troca de contexto remove os dados anteriores.

## Validação

```sh
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:integration
npm run test:e2e
```

As duas últimas suítes exigem Docker disponível; cada comando cria e remove seu
próprio PostgreSQL sintético, sem usar uma URL externa. O E2E exige o Chromium da
versão instalada do Playwright (`npx playwright install chromium`, se ausente).
O build deve preceder o E2E. As portas 4317, 4318 e 5173 precisam estar livres;
processos existentes não são reutilizados. É possível filtrar casos, por exemplo
`npm run test:e2e -- --project=desktop --grep 'fluxo real completo'`.

O navegador exercita os dois e-mails capturados localmente, cookies reais,
login/logout, retomada, seleção, revogação e consultas PostgreSQL. Falhas de rede
são induzidas antes e depois do commit; outra conexão confere o resultado. Há
cenários explicitamente interceptados para `401`/`403`/`409`, além dos testes
reais de autorização e conflito no backend. Interceptações não comprovam garantias
do banco. Nenhum e-mail é enviado externamente.

Desktop e emulação móvel Chromium validam teclado, ausência de overflow horizontal
e Axe (WCAG 2 A/AA e 2.1 AA) nas telas de e-mail, provisionamento e igrejas. Labels,
erros associados, foco visível, regiões de status e contraste foram considerados.
Isso constitui acessibilidade básica, não certificação ou teste em aparelho físico.
Firefox e WebKit não fazem parte da suíte atual.

Traces, vídeos, screenshots automáticos de falha e mensagens de erro originais do
runner são desabilitados para evitar cópias de links/credenciais. O reporter
registra títulos e localização da asserção, sem seus valores. Somente screenshots
da tela inicial vazia ficam em `.local/e2e/`, ignorado pelo Git. O logger de proxy
Vite também omite URLs em erros. A caixa sintética temporária é removida no final.

Entrega externa de e-mail e operação pública pertencem à composição Worker DEV,
conforme [Deploy DEV](deploy-dev.md). O E2E permanece sintético e local; não
comprova entrega externa ou operação remota nem autoriza dados reais.
O modo `npm run test:e2e -- --runtime-acls` preserva os mesmos cenários usando
login restrito; é o modo executado na CI.
