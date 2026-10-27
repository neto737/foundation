# `@t00ls-dev/email`

Adaptador mínimo para enviar e-mail de texto pela API HTTP da Resend.

## Quando usar

Use quando a aplicação precisa apenas de envio transacional simples e compatível
com `EmailProvider`. Não use para HTML, anexos, múltiplos destinatários,
templates, filas ou recursos avançados da Resend.

## Instalação

Consumo interno no monorepo com `workspace:*`. Compile os pacotes locais com
`pnpm build` antes de usar seus exports.

```sh
pnpm --filter <app> add '@t00ls-dev/email@workspace:*'
```

## API

- `createResendEmail({ apiKey, defaultFrom })`: cria um `EmailProvider`.
- `EmailProvider.send(input)`: envia `to`, `subject`, `text` e `from` opcional.
- `EmailDeliveryError`: erro com status HTTP quando a Resend rejeita a chamada.

## Exemplo

```ts
import { createResendEmail } from "@t00ls-dev/email";

const email = createResendEmail({
  apiKey: process.env.RESEND_API_KEY!,
  defaultFrom: "App <noreply@example.com>",
});

await email.send({
  to: "user@example.com",
  subject: "Olá",
  text: "Bem-vindo!",
});
```

## Limitações e segurança

Depende de `fetch` global e não implementa timeout, retry, idempotência ou
parsing da resposta. Não exponha a chave no cliente nem registre conteúdo
sensível. Valide destinatários e remetentes; use fila e política de retry quando
duplicação ou perda forem relevantes.
