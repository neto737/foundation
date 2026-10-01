# Links — basic-d1

Links é a aplicação de referência do Foundation: uma biblioteca **privada** de
bookmarks com React SPA, Hono, Better Auth, Drizzle e Cloudflare D1 no mesmo
Worker. `basic-d1` permanece como nome técnico do diretório/package/preset;
Links é o nome apresentado ao usuário.

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

## Funcionalidades e API

- criação, leitura, edição e exclusão de bookmarks;
- título, URL HTTP/HTTPS, descrição opcional e tags;
- busca por título/URL/descrição e filtro exato por tag, combinados por `AND`;
- paginação `limit`/`offset`, ordenação estável por criação e ID descendentes;
- estados de sessão/listagem/envio, vazio, erro e retry;
- UI responsiva com labels, erros associados e foco de campo inválido.

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
caracteres. Tags são normalizadas com trim/minúsculas e deduplicadas. Não há
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

`db:migrate` e `db:status` usam D1 local; variantes `:dev` operam remotamente.
`db:seed` executa apenas `seeds/local.sql`, atualmente sem dados de contas, e
nunca faz parte do deploy. Migrations aplicadas são imutáveis e recebem
correções forward-only. A adição permite rollback do código anterior sem remover
tabelas.

## Testes determinísticos

Depois de compilar os packages Foundation:

```bash
pnpm test
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

- Unitários: validação, protocolos de URL, normalização e limites.
- Integração: Miniflare/D1 real local, migrations reais, auth, CRUD, dois
  usuários, filtros/paginação, CSRF, expiração/revogação, cookies e headers
  privados.
- E2E: oito cenários em Chromium desktop e mobile, totalizando 16 execuções;
  cadastro/verificação/login/logout, CRUD, reload, isolamento, erros/loading,
  sessão expirada e respostas privadas atrasadas após troca de usuário.

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
em `env.dev.vars`. A CI validada em `master` precede migration, deploy e smoke
health.

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
