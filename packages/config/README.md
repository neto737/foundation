# `@t00ls-dev/config`

Schema Zod e helper para validar a configuração comum de aplicações Foundation.

## Quando usar

Use na inicialização para falhar cedo diante de configuração inválida. Não use
para carregar arquivos, ler variáveis de ambiente ou armazenar segredos.

## Instalação

Destino oficial: npmjs.com público no scope do usuário `t00ls-dev`. A primeira
publicação ainda depende de autorização; no Foundation use `workspace:*`. Após
publicação confirmada, consumidores usam uma versão disponível no npm.

```sh
pnpm --filter <app> add '@t00ls-dev/config@workspace:*'
```

## API

- `defineConfig(config)`: valida e retorna a configuração com defaults.
- `foundationConfigSchema`: schema Zod para composição ou validação direta.
- `FoundationConfigInput` e `FoundationConfig`: tipos de entrada e saída.

## Exemplo

```ts
import { defineConfig } from "@t00ls-dev/config";

export const config = defineConfig({
  app: { name: "billing", environment: "prod" },
  auth: { emailPassword: true, magicLink: true },
  database: { dialect: "postgres", connection: process.env.DATABASE_URL! },
});
```

## Limitações e segurança

Aceita apenas ambientes `local`, `dev` e `prod`, OAuth Google e bancos D1 ou
Postgres. A validação não verifica conectividade nem protege valores sensíveis;
não registre o objeto completo. Mudanças no schema podem exigir migração da
configuração dos consumidores.
