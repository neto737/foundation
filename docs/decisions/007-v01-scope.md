# ADR-007: Escopo da v0.1

- Status: aceito
- Escopo: v0.1

## Contexto

O desenho futuro é amplo, mas implementar antecipadamente todas as capabilities
criaria abstrações sem consumidores e atrasaria uma fundação utilizável.

## Decisão

A v0.1 valida o caminho completo de um app: monorepo e qualidade, configuração,
SPA/API no Worker, D1 e PostgreSQL, Better Auth, tenancy/access opcionais,
segurança e observabilidade básicas, e-mail necessário aos fluxos, exemplo D1,
testes, documentação e entrega DEV/PROD. `create-app` e `doctor` começam apenas
no nível necessário para validar configuração e consumo dos pacotes.

Ficam fora: SSR, microservices, Kubernetes, GraphQL, OpenAPI obrigatório,
staging, SMS, Web Push, design system completo, auth ou feature flags próprios,
billing próprio, event bus complexo, marketplace avançado e providers sem uso
real. Billing, webhooks, images, storage, backups automatizados e workflows
sofisticados aguardam consumidor concreto.

## Consequências

- A arquitetura reserva limites de evolução sem prometer implementação imediata.
- Toda nova capability precisa de necessidade real e ADR quando alterar decisões
  importantes.
- Nenhuma regra de negócio de produto entra na fundação.
- A v0.1 permanece pequena, coerente e implantável.
