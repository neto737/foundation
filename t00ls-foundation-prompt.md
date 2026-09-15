# Prompt mestre — `t00ls-dev/foundation`

Crie a versão inicial do projeto `t00ls-dev/foundation`.

O objetivo é construir uma fundação técnica compartilhada para futuros apps,
sistemas internos e SaaS da organização `t00ls-dev`.

> **IMPORTANTE:** os produtos finais **não** ficarão neste repositório. Cada
> produto terá seu próprio repositório privado e consumirá os pacotes,
> convenções e ferramentas do `foundation`.

O `foundation` será público principalmente por conveniência de distribuição e
reutilização interna. Uso externo é permitido, mas o projeto é
**internal-first**: não existe compromisso de suporte, roadmap para terceiros,
implementação de feature requests ou compatibilidade eterna com consumidores
externos.

Não inclua nenhuma regra de negócio específica de produtos existentes ou
futuros.

---

## 1. Princípios do projeto

A arquitetura deve seguir estes princípios:

- Cloudflare-first.
- Local-ready, mas inicialmente remote/cloud-first.
- Modular.
- Multi-tenant ready.
- Secure by default.
- LGPD by design.
- Providers substituíveis.
- Decisões importantes reversíveis.
- Sem abstrações desnecessárias.
- Evitar vendor lock-in quando isso não trouxer benefício concreto.
- Não construir antecipadamente funcionalidades sem consumidor real.
- Arquitetura ampla, implementação inicial enxuta.
- Documentação é parte do produto.
- Nenhuma regra específica de negócio deve entrar no foundation.
- Apps consumidores devem poder evoluir e atualizar os pacotes
  independentemente.

---

## 2. Repositório

Repositório:

```text
t00ls-dev/foundation
```

Estrutura em monorepo, preferencialmente utilizando Turborepo.

Usar:

- pnpm
- TypeScript
- Turborepo
- GitHub Actions

Estrutura conceitual:

```text
foundation/
├── packages/
│   ├── core/
│   ├── services/
│   ├── observability/
│   └── ui/
│
├── tooling/
│   ├── create-app/
│   ├── doctor/
│   ├── eslint-config/
│   └── typescript-config/
│
├── docs/
├── examples/ ou apps/ quando houver necessidade real
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

Não transforme automaticamente cada diretório em um pacote npm. Um módulo só
deve virar pacote separado quando houver motivo técnico e reutilização
suficiente.

---

## 3. Stack principal

### Backend/API

- Hono
- TypeScript
- Zod

### Frontend

- React
- React Router
- React Hook Form
- Zod
- Tailwind CSS

### Banco

- Drizzle ORM

### Testes

- Vitest
- Playwright

### CI/CD

- GitHub Actions

### Dependências

- Dependabot

### Versionamento

- Semantic Versioning
- Changesets
- GitHub Releases

---

## 4. Cloudflare

Toda a foundation deve assumir Cloudflare como plataforma principal.

Suportar, quando aplicável:

- Cloudflare Workers
- D1
- Hyperdrive
- R2
- Cloudflare Images
- KV
- Queues
- Workflows
- Cron Triggers
- Turnstile
- Workers Rate Limiting
- Cache API / HTTP caching

Não usar um recurso apenas porque existe. Cada integração deve ter propósito
documentado.

---

## 5. Banco de dados

O foundation **não** deve obrigar todos os apps a usarem o mesmo banco.

Cada novo projeto deve fazer uma decisão no ponto zero entre:

### D1

Indicado para:

- apps pequenos;
- ferramentas internas;
- baixo volume;
- CRUD simples;
- poucos usuários;
- baixa concorrência;
- aplicações em que simplicidade operacional seja prioritária.

### PostgreSQL

Usar PostgreSQL externo/self-hosted com Cloudflare Hyperdrive quando apropriado.

Indicado para:

- SaaS;
- multi-tenancy;
- maior crescimento;
- relatórios e agregações;
- alto volume;
- queries mais sofisticadas;
- operações com maior intensidade de escrita;
- aplicações com necessidade previsível de recursos avançados.

PostgreSQL pode ser considerado o padrão quando não houver motivo claro para D1.

Entretanto:

- D1 deve continuar sendo uma opção de primeira classe.
- A decisão inicial pode estar errada.
- A arquitetura deve permitir futura migração D1 → PostgreSQL sem exigir
  reescrita completa da aplicação.
- Não prometer compatibilidade perfeita entre SQLite e PostgreSQL.
- Usar portabilidade onde for sensato e recursos específicos do banco quando
  trouxerem valor real.

Evitar chamadas diretas ao D1 espalhadas pela aplicação.

Preferir repositories ou uma camada clara de acesso a dados.

Usar Drizzle para schema e migrations.

---

## 6. Migrations

Criar uma estratégia oficial para migrations.

Deve suportar:

- D1;
- PostgreSQL;
- desenvolvimento;
- produção;
- migrations incrementais;
- execução via CI quando apropriado;
- forward-fix como estratégia preferencial de correção.

Migrations e seeds devem ser conceitos separados.

Exemplo:

```text
db:migrate
db:seed
db:status
```

---

## 7. Multi-tenancy

Multi-tenancy é requisito estrutural da foundation.

Criar um módulo/pacote dedicado, conceitualmente:

```text
@t00ls-dev/tenant
```

Ele deve lidar com:

- contexto do tenant atual;
- memberships;
- vínculo usuário ↔ tenant;
- troca de tenant ativo;
- validação de pertencimento;
- isolamento de dados;
- helpers para queries tenant-aware;
- prevenção de vazamento entre tenants;
- possível resolução por subdomínio;
- integração com roles e permissões.

Modelo conceitual:

```text
users
tenants
tenant_memberships
```

A role deve pertencer ao membership, não necessariamente ao usuário global.

Exemplo:

```text
João
├── Tenant A → owner
├── Tenant B → manager
└── Tenant C → viewer
```

---

## 8. Autorização, roles e permissões

Autenticação e autorização devem ser separadas.

Criar módulo conceitual:

```text
@t00ls-dev/access
```

Better Auth responde:

> Quem é este usuário?

Access responde:

> O que este usuário pode fazer neste tenant?

Evitar espalhar comparações como:

```ts
user.role === "admin";
```

Preferir permissões:

```ts
can(user, "members.write");
```

Roles são conjuntos de permissões.

Exemplo:

```text
owner
admin
manager
member
viewer
```

Mas não tornar essas roles universalmente obrigatórias. Cada produto poderá
configurar suas próprias roles e permissões.

---

## 9. Autenticação

Usar Better Auth OSS/self-hosted como implementação padrão.

**Não** depender do Better Auth Infrastructure pago.

Os dados de:

- usuários;
- sessões;
- contas;
- memberships quando aplicável;

devem permanecer sob controle da aplicação.

Better Auth deve funcionar tanto com D1 quanto PostgreSQL quando os recursos
utilizados forem compatíveis.

O módulo:

```text
@t00ls-dev/auth
```

não deve tentar substituir ou esconder completamente Better Auth.

Sua responsabilidade é:

- configuração padrão;
- integração com a stack;
- integração com Resend;
- boas práticas;
- plugins aprovados;
- helpers comuns;
- configuração D1/Postgres;
- segurança.

Para apps internos muito simples, permitir Cloudflare Access como alternativa à
autenticação da própria aplicação.

---

## 10. E-mail

Criar uma camada de e-mail desacoplada.

Provider padrão:

- Resend

Preparar arquitetura para outros providers no futuro.

Não espalhar chamadas diretas do SDK do Resend pelo código.

Interface conceitual:

```ts
email.send(...)
```

Templates devem pertencer à aplicação/foundation, não ao provider.

Avaliar React Email para templates.

Templates básicos que podem existir:

- verificação de e-mail;
- recuperação de senha;
- magic link;
- convite para tenant;
- boas-vindas;
- alteração de e-mail;
- alerta de segurança;
- pagamento aprovado;
- pagamento recusado;
- assinatura cancelada.

---

## 11. Billing

Billing deve ser provider-agnostic e suportar múltiplos gateways
simultaneamente.

Providers planejados:

### Brasil

**AbacatePay**

- padrão para SaaS brasileiro comum.

**Woovi**

- opção para produtos Pix-first.

**Pagar.me**

- operações brasileiras mais complexas;
- marketplace;
- split;
- operações financeiras mais sofisticadas.

### Internacional

**Stripe**

- padrão para produtos com intenção real de operar internacionalmente;
- múltiplas moedas;
- SaaS global.

Criar um Billing Router.

O frontend deve preferencialmente escolher:

- método;
- moeda;
- país;
- recorrência;

e o backend decide qual provider utilizar.

Exemplo conceitual:

```text
PIX + BRL
→ AbacatePay

Boleto + BRL
→ AbacatePay

Cartão + BRL
→ AbacatePay ou regra do app

USD/EUR/outras moedas
→ Stripe

Produto internacional
→ Stripe
```

Uma cobrança deve pertencer a um único provider.

Assinaturas devem permanecer vinculadas ao provider em que foram criadas.

Nunca criar redundância ingênua gerando a mesma cobrança simultaneamente em
múltiplos gateways.

Guardar no banco:

- payment id interno;
- provider;
- provider payment id;
- method;
- amount;
- currency;
- status;
- timestamps;
- dados de settlement quando necessário.

Não assumir BRL implicitamente.

Sempre trabalhar com:

```ts
{
  amount: 2990,
  currency: "BRL"
}
```

---

## 12. Webhooks e idempotência

Criar uma estratégia comum para webhooks.

Possível módulo:

```text
@t00ls-dev/webhooks
```

Deve considerar:

- validação de assinatura;
- idempotência;
- persistência do evento recebido;
- retries;
- logs;
- observabilidade;
- prevenção de processamento duplicado.

Idempotência também deve ser considerada para:

- pagamentos;
- criação de tenant;
- jobs;
- workflows;
- operações críticas.

---

## 13. Imagens

Usar Cloudflare Images como solução padrão para imagens quando o produto
precisar de:

- upload;
- resize;
- crop;
- compressão;
- transformação;
- otimização;
- variantes;
- CDN;
- WebP/AVIF quando aplicável.

Preferir upload direto quando possível, após autorização pelo backend.

O banco deve armazenar metadados e IDs, não blobs de imagens.

Criar uma camada conceitual:

```ts
images.createUpload();
images.getUrl();
images.getVariant();
images.delete();
```

---

## 14. Storage

Usar R2 para arquivos genéricos:

- PDFs;
- CSV;
- XLSX;
- documentos;
- exports;
- backups;
- arquivos gerais;
- mídia que não exige o pipeline de Cloudflare Images.

Criar política comum para:

- MIME types;
- limites de tamanho;
- ownership;
- tenant;
- nomes aleatórios;
- autorização;
- signed URLs quando necessário;
- exclusão;
- metadata.

Não confiar apenas na extensão do arquivo enviada pelo usuário.

---

## 15. Backups

R2 será o destino padrão dos backups.

Importante:

> R2 é destino, não mecanismo de geração do backup.

### D1

Usar:

- Time Travel como primeira camada;
- exportações periódicas para R2 para retenção adicional.

### PostgreSQL

Inicialmente:

```text
PostgreSQL
→ pg_dump
→ compressão
→ R2 privado
```

Política inicial sugerida:

```text
7 backups diários
4 backups semanais
6 backups mensais
```

Usar lifecycle do R2 para retenção.

Preparar arquitetura para estratégias mais avançadas posteriormente, como
PITR/WAL, quando houver produto que justifique.

Backup só é considerado confiável quando existe evidência de restore testado.

---

## 16. Doctor

Criar ferramenta:

```text
@t00ls-dev/doctor
```

Objetivo:

diagnosticar se um projeto está corretamente configurado.

Pode verificar:

- Cloudflare bindings;
- env/config;
- secrets ausentes;
- conexão D1/Postgres;
- Hyperdrive;
- R2;
- Cloudflare Images;
- Resend;
- billing providers;
- Sentry;
- PostHog;
- GA4;
- migrations;
- backups;
- última execução de backup;
- última validação de restore;
- versões incompatíveis;
- configuração do tenant;
- health endpoints.

Exemplo:

```text
Foundation Doctor

✓ Cloudflare configuration
✓ PostgreSQL connection
✓ Hyperdrive
✓ Resend
✓ Sentry
✓ PostHog
⚠ Stripe webhook secret missing
✓ R2

Backup
✓ Last backup: 2h ago
✓ Retention policy detected
⚠ Last restore test: 42 days ago
```

---

## 17. Create App

Criar CLI:

```text
@t00ls-dev/create-app
```

Objetivo:

gerar novos projetos independentes que consumirão a foundation.

Exemplo:

```bash
pnpm dlx @t00ls-dev/create-app
```

ou forma equivalente apropriada.

Perguntas possíveis:

```text
Nome do projeto?

Tipo:
- Internal
- SaaS
- Public App

Database:
- D1
- PostgreSQL

Auth:
- Better Auth
- Cloudflare Access
- None

Multi-tenant?
- Yes
- No

Images?
- Cloudflare Images
- None

Storage?
- R2
- None

Email?
- Resend
- None

Billing?
- AbacatePay
- Stripe
- Woovi
- Pagar.me
- Multiple
- None

Telemetry?
- Sentry
- PostHog
- GA4
- Hitmetrica
```

O gerador deve produzir um projeto:

- limpo;
- documentado;
- funcional;
- testável;
- preparado para deploy;
- sem dependências desnecessárias.

---

## 18. Configuração de capabilities

Criar uma convenção como:

```text
t00ls.config.ts
```

Exemplo conceitual:

```ts
export default {
  database: "postgres",

  auth: {
    provider: "better-auth",
  },

  tenancy: true,

  images: true,
  storage: "r2",

  email: "resend",

  billing: {
    providers: ["abacatepay", "stripe"],
  },

  telemetry: {
    sentry: true,
    posthog: true,
    ga4: false,
  },

  audit: true,
};
```

Não necessariamente usar este arquivo como controle absoluto de runtime.

Ele deve servir principalmente para:

- documentar capacidades;
- alimentar tooling;
- doctor;
- create-app;
- CI;
- documentação.

---

## 19. Telemetria e observabilidade

Suportar:

### Sentry

Uso principal:

- exceptions;
- erros;
- traces;
- performance;
- problemas operacionais.

### PostHog

Uso principal:

- product analytics;
- eventos;
- funnels;
- session replay quando permitido;
- feature flags;
- experimentos.

### Google Analytics

Uso principal:

- marketing;
- aquisição;
- campanhas;
- tráfego público.

### Hitmetrica

Manter como integração opcional.

Não ativar todas as ferramentas obrigatoriamente em todos os apps.

Criar taxonomia única de eventos.

Evitar:

```text
PostHog: user_signed_up
GA4: signup
Outro: account_created
```

para representar o mesmo evento.

---

## 20. Logging

Implementar logs estruturados.

Preferir JSON estruturado.

Associar, quando disponível:

- request_id;
- user_id;
- tenant_id;
- rota;
- duração;
- status;
- contexto relevante.

Nunca registrar:

- senha;
- token;
- cartão;
- secrets;
- dados sensíveis desnecessários.

Sentry complementa logs, não substitui uma estratégia de logging.

---

## 21. Auditoria

Auditoria completa é requisito.

Criar uma convenção comum para:

- actor;
- action;
- target;
- tenant;
- timestamp;
- metadata;
- request id;
- IP quando juridicamente e tecnicamente apropriado;
- resultado.

Preferir audit log append-only.

Evitar UPDATE/DELETE comum nos registros de auditoria.

Auditoria não é a mesma coisa que logging técnico.

---

## 22. LGPD e privacidade

LGPD deve ser considerada desde a fundação.

Preparar padrões para:

- exportação de dados;
- exclusão de dados;
- retenção;
- consentimento;
- finalidade;
- minimização de coleta;
- PII scrubbing;
- controle de analytics;
- session replay;
- logs;
- backups;
- auditoria.

Criar categorias conceituais de consentimento:

```text
essential
analytics
marketing
```

Não presumir automaticamente que qualquer integração de telemetria está
dispensada de consentimento.

---

## 23. Segurança

Criar módulo:

```text
@t00ls-dev/security
```

Responsabilidades possíveis:

- Turnstile;
- rate limiting;
- security headers;
- CSP;
- CORS;
- CSRF;
- request validation;
- helpers de segurança.

Turnstile deve ser aplicável a:

- signup;
- recuperação de senha;
- formulários públicos;
- fluxos suspeitos;
- proteção adicional de login quando necessário.

Rate limiting deve poder variar conforme:

- usuário;
- tenant;
- IP;
- rota;
- recurso;
- plano.

---

## 24. Cache

Estratégia padrão:

### HTTP / Workers Cache

Usar como principal camada de cache.

Conteúdo público pode receber cache apropriado.

Conteúdo privado/autenticado deve ser conservador.

Exemplo:

```text
public
→ cache control apropriado

authenticated / tenant-specific
→ private ou no-store por padrão
```

### Cache API

Usar quando houver necessidade de controle programático.

### KV

**Não** usar como cache universal nem como fonte da verdade para dados que
precisam de consistência imediata.

KV pode ser usado para:

- configuração distribuída;
- dados muito lidos e pouco alterados;
- cache específico em que consistência eventual seja aceitável.

Nunca depender de KV para decisões instantâneas críticas como:

- sessão;
- autorização;
- saldo;
- pagamento;
- assinatura;
- permissão recém-alterada.

---

## 25. Feature flags

Usar PostHog como implementação preferencial de feature flags.

Evitar construir um sistema próprio na v0.

Permitir abstração mínima quando realmente necessário.

---

## 26. Async e jobs

Usar:

### Queues

Para tarefas assíncronas simples.

### Workflows

Para processos:

- duráveis;
- multi-step;
- com retries;
- com espera;
- que podem durar mais tempo.

### Cron Triggers

Para jobs agendados.

Criar convenções e documentação comum para os três.

---

## 27. Health

Criar convenção de healthcheck.

Exemplos:

```text
/health
/ready
```

Não expor detalhes sensíveis publicamente.

O doctor pode realizar diagnósticos mais profundos.

---

## 28. Ambientes

Suportar desde o início:

```text
local
dev
prod
```

### Local

- deve estar completamente preparado;
- será utilizado futuramente;
- não será o fluxo principal inicialmente porque o responsável pelo projeto está
  temporariamente sem computador.

### DEV

- ambiente remoto Cloudflare;
- recursos próprios;
- secrets próprios.

### PROD

- produção;
- recursos próprios;
- secrets próprios.

Não compartilhar secrets de produção com dev.

Staging **não** é necessário inicialmente.

Só introduzir staging quando existir uma necessidade real.

---

## 29. Remote-first e local-ready

Este ponto é importante.

No momento, o desenvolvimento precisa ser possível de forma cloud-first/remota.

Entretanto, **não** sacrifique desenvolvimento local.

O foundation deve nascer pronto para que futuramente seja possível:

```bash
git clone ...
pnpm install
pnpm dev
```

com mínimo atrito.

Quando o desenvolvimento local passar a ser usado, não deve ser necessário
reestruturar a arquitetura.

---

## 30. Secrets

Nunca versionar secrets reais.

Usar:

- Cloudflare Secrets;
- GitHub Actions Secrets;
- `.env.example`;
- validação de config.

Separar completamente secrets de dev e prod.

Criar validação tipada das configurações obrigatórias.

---

## 31. UI e acessibilidade

React é o frontend padrão.

Usar:

- React Router;
- React Hook Form;
- Zod;
- Tailwind CSS.

Não criar um design system enorme na v0.

Criar apenas componentes base realmente reutilizáveis.

Acessibilidade é requisito desde o início:

- labels;
- navegação por teclado;
- foco;
- semântica;
- contraste;
- estados de erro;
- componentes acessíveis.

---

## 32. Datas e timezone

Persistir datas preferencialmente em UTC.

Conversão de timezone deve acontecer na camada apropriada de apresentação.

Tenant ou usuário poderá futuramente definir timezone.

Evitar datas locais ambíguas no banco.

---

## 33. API

Não é necessário implementar uma plataforma OpenAPI completa na v0.

Entretanto:

- requests;
- responses;
- validação;
- contratos;

devem ser organizados de maneira que futura adoção de OpenAPI não exija
reescrever a aplicação.

Não implementar GraphQL agora.

---

## 34. Documentação

Documentação é uma das maiores prioridades deste projeto.

Criar documentação extensa e clara.

Estrutura sugerida:

```text
docs/
├── architecture/
├── decisions/
├── database/
├── authentication/
├── authorization/
├── multi-tenancy/
├── billing/
├── email/
├── storage/
├── images/
├── telemetry/
├── security/
├── caching/
├── backups/
├── deployment/
├── environments/
├── testing/
├── migrations/
├── lgpd/
└── creating-an-app/
```

Cada package deve documentar:

- propósito;
- quando usar;
- quando não usar;
- instalação;
- configuração;
- API;
- exemplos;
- limitações;
- segurança;
- migrations quando houver;
- breaking changes relevantes.

Criar ADRs para decisões arquiteturais importantes.

A documentação deve explicar o motivo das decisões, não apenas como executar
comandos.

---

## 35. Deploy

Cada produto terá seu próprio deploy independente.

O foundation não deve exigir que vários apps sejam deployados juntos.

Usar GitHub Actions para automatizar deploy quando apropriado.

Fluxo conceitual:

```text
commit/merge
→ lint
→ typecheck
→ tests
→ build
→ migrations quando seguro/apropriado
→ deploy Cloudflare
→ smoke/health check
```

Separar DEV e PROD.

Documentar claramente:

- quando ocorre deploy;
- quem pode disparar;
- como rollback/forward-fix funciona;
- como migrations entram no fluxo;
- como secrets são tratados.

---

## 36. Package publishing

Namespace pretendido:

```text
@t00ls-dev/*
```

Exemplos:

```text
@t00ls-dev/auth
@t00ls-dev/db
@t00ls-dev/tenant
@t00ls-dev/access
@t00ls-dev/security
@t00ls-dev/email
@t00ls-dev/billing
@t00ls-dev/images
@t00ls-dev/storage
@t00ls-dev/telemetry
@t00ls-dev/create-app
@t00ls-dev/doctor
```

Confirmar disponibilidade do scope `@t00ls-dev` no npm antes de depender dele.

O fato de `t00ls-dev` ser o username do GitHub não garante automaticamente o
scope no npm.

Packages deverão ser públicos quando publicados.

---

## 37. Licença e posicionamento público

Usar licença permissiva, preferencialmente MIT.

O projeto é público e pode ser utilizado por terceiros.

Entretanto, documentar explicitamente:

- projeto desenvolvido prioritariamente para os produtos `t00ls-dev`;
- uso externo é permitido;
- não existe garantia de suporte;
- não existe promessa de atender feature requests;
- não existe compromisso de adaptar roadmap para consumidores externos;
- APIs podem evoluir conforme necessidades dos projetos `t00ls-dev`, respeitando
  versionamento semântico.

Não incluir nenhuma credencial, estratégia comercial, dados internos ou lógica
de negócio dos produtos.

---

## 38. Domínios

Durante protótipos e desenvolvimento, usar a estrutura:

```text
t00ls.dev
```

Exemplos possíveis:

```text
app.t00ls.dev
dev-app.t00ls.dev
```

Não amarrar a arquitetura a esse domínio permanentemente.

Suportar custom domains no futuro.

---

## 39. SMS e push

### SMS

**Não implementar.**

Não há intenção de adotar SMS.

### Push web

**Não implementar agora.**

Push notifications poderão ser consideradas futuramente caso exista app nativo.

Não construir infraestrutura antecipada para isso.

---

## 40. O que não fazer na v0

Não implementar sem necessidade concreta:

- microservices;
- Kubernetes;
- GraphQL;
- event bus complexo;
- SMS;
- Web Push;
- custom auth framework;
- custom feature flag platform;
- billing próprio;
- abstrações gigantes;
- dezenas de providers que nenhum app usa;
- design system completo;
- staging;
- internacionalização completa;
- marketplace financeiro avançado;
- OpenAPI obrigatório;
- infraestrutura enterprise sem consumidor real.

---

## 41. Boundaries dos pacotes

Definir direção clara de dependências.

Exemplo conceitual:

```text
config
  ↑
db
  ↑
auth
  ↑
tenant/access

config
  ↑
email

config
  ↑
billing
  ↑
webhooks
```

Evitar:

- dependências circulares;
- package A dependendo de B enquanto B depende de A;
- pacote core importando módulo de alto nível.

Documentar boundaries.

Se possível, adicionar validações automatizadas dessas regras.

---

## 42. Qualidade

Todos os pacotes relevantes devem ter:

- TypeScript strict;
- lint;
- format;
- unit tests;
- typecheck;
- documentação;
- examples quando apropriado.

Integrações críticas devem ter testes de integração quando viável.

Fluxos de usuário relevantes devem poder ter Playwright.

---

## 43. Release

Usar:

- Changesets;
- Semantic Versioning;
- GitHub Actions;
- GitHub Releases.

Exemplo:

```text
@t00ls-dev/db@1.4.0
@t00ls-dev/auth@2.0.0
@t00ls-dev/telemetry@1.3.2
```

Apps consumidores não devem ser obrigados a atualizar automaticamente para uma
breaking change.

---

## 44. Filosofia de implementação

Não tente implementar toda esta arquitetura na primeira entrega.

Primeiro:

1. crie a estrutura correta;
2. documente as decisões;
3. implemente os primitives realmente necessários;
4. deixe contratos claros para evolução;
5. mantenha o projeto utilizável a cada etapa.

A v0.1 deve ser pequena, coerente e funcional.

Prioridade inicial sugerida:

```text
config
db
auth
tenant
access
security
logging
telemetry
email
create-app básico
doctor básico
testing/tooling
documentação
```

Depois, conforme houver consumidor real:

```text
billing
webhooks
images
storage
backups automatizados
workflows mais sofisticados
```

A presença de algo na arquitetura não significa que ele precisa ser implementado
imediatamente.

---

## 45. Primeira entrega

Antes de escrever muito código:

1. analise esta especificação;
2. identifique conflitos ou decisões tecnicamente problemáticas;
3. proponha apenas alterações que tenham justificativa concreta;
4. escreva `docs/architecture/overview.md`;
5. escreva ADRs para as decisões principais;
6. proponha a árvore inicial do monorepo;
7. defina boundaries entre módulos;
8. defina a v0.1 implementável;
9. configure tooling, CI e documentação;
10. somente então comece os módulos fundamentais.

Não faça alterações silenciosas nas decisões arquiteturais.

Se encontrar uma decisão que possa gerar problema sério, documente:

- decisão atual;
- problema;
- alternativa;
- recomendação;
- impacto da mudança.

---

## 46. Resultado esperado

O `t00ls-dev/foundation` deve se tornar uma fundação capaz de criar projetos
como:

### Pequeno app interno

```text
Hono
React
D1
Better Auth ou Cloudflare Access
Sentry
Cloudflare Images quando necessário
```

### SaaS brasileiro

```text
Hono
React
PostgreSQL
Hyperdrive
Better Auth
multi-tenancy
roles/permissões
Resend
AbacatePay
R2
Cloudflare Images
Sentry
PostHog
auditoria
LGPD
```

### SaaS internacional

```text
Hono
React
PostgreSQL
Hyperdrive
Better Auth
multi-tenancy
Resend
Stripe
multicurrency
R2
Cloudflare Images
Sentry
PostHog
GA4
auditoria
LGPD
```

Todos devem compartilhar a mesma fundação sem que os produtos precisem morar no
mesmo repositório.

---

# Regra final

O foundation fornece os tijolos.

Os produtos constroem as casas.

Se algo pertence à regra de negócio de apenas um produto, não pertence ao
foundation.

Se algo pode ser resolvido por uma tecnologia madura e confiável, não recrie do
zero sem uma razão concreta.

Se uma abstração ainda não possui dois consumidores ou uma necessidade
arquitetural clara, prefira esperar.

Construa uma base que seja simples para um app pequeno, mas que não se torne uma
prisão quando o produto crescer.
