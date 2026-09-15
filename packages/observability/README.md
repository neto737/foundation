# `@t00ls-dev/observability`

Logger estruturado com níveis, timestamp, contexto padrão e sink substituível.

## Quando usar

Use para uniformizar logs JSON enviados a console, testes ou um coletor. Não use
como SDK de métricas, tracing, buffering ou transporte remoto.

## Instalação

Pacote privado do workspace; não é publicado em registry.

```sh
pnpm --filter <app> add '@t00ls-dev/observability@workspace:*'
```

## API

- `createLogger(sink, defaults?)`: retorna `debug`, `info`, `warn` e `error`.
- `LogSink`: contrato síncrono `write(entry)`.
- `LogContext` e `LogLevel`: tipos para contexto e níveis suportados.

## Exemplo

```ts
import { createLogger } from "@t00ls-dev/observability";

const logger = createLogger(
  { write: (entry) => console.log(entry) },
  { route: "/health" },
);
logger.info("request completed", { status: 200, durationMs: 12 });
```

## Limitações e segurança

O sink é síncrono e falhas dele se propagam; não há filtragem por nível nem
serialização de `Error`. O contexto aceita campos arbitrários e pode
sobrescrever defaults e campos básicos. Não registre tokens, cookies, senhas,
dados pessoais ou outros segredos; aplique redação no chamador ou no sink.
