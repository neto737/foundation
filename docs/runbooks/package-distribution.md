# Validação da distribuição

Execute `pnpm test:distribution` para compilar e empacotar os nove pacotes pelo
mesmo `pnpm pack` usado na distribuição. O teste inspeciona os manifests finais,
exports, arquivos, protocolos locais e links; instala os tarballs em dois
consumidores novos em `/tmp`, sem resolução pelo workspace, e testa typecheck,
emissão JavaScript, todos os 18 entrypoints públicos e runtime D1 mínimo. O gate
`pnpm check` inclui esse teste. Os artifacts e diagnósticos ficam no diretório
temporário informado ao final para inspeção.

## Decisões de empacotamento

- Os builds publicáveis desabilitam `declarationMap`: mantemos `.d.ts`, sem maps
  para fontes ausentes. O build já limpa `dist` antes da compilação.
- Os `tsconfig.json` dos pacotes continuam compartilhados por caminhos relativos
  para `tooling/typescript-config`. Esses configs não são publicados, e o
  tooling permanece privado. Não existe dependência desse pacote nos manifests
  finais.
- `audit/d1`, `db/d1` e `tenant/d1` importam `D1Database` dos tipos oficiais.
  `@cloudflare/workers-types` é uma dependência de **declarações** desses
  pacotes: será instalada automaticamente, mas nenhum import JavaScript é
  emitido. Uma peer obrigatória exigiria instalação/configuração adicional
  também de quem usa apenas as entradas não-D1. As entradas principal/PostgreSQL
  de audit e tenant não carregam globais Cloudflare.
- Drizzle ainda usa tipos D1 globais em suas próprias declarações. Somente
  `db/d1` preserva uma referência explícita aos tipos Cloudflare para
  resolvê-los, sem exigir configuração implícita do Foundation. Aplicações
  Worker devem usar tipos/lib adequados ao seu ambiente, sem combinar
  indiscriminadamente os globais completos de DOM, Node e Workers.

## TypeScript estrito e dependências externas

Todos os testes usam `skipLibCheck: false`, nunca uma exceção para silenciar
declarações. O teste de entradas sem tipos transitivos Drizzle/Better Auth,
incluindo `audit/d1` e `tenant/d1`, exige **zero diagnósticos**.

O teste completo também compila imports diretos de Drizzle e Better Auth como
controle, sem Foundation. Cada diagnóstico do consumidor completo deve ocorrer
nesse controle no mesmo arquivo externo, posição e código TypeScript. Qualquer
erro numa declaração Foundation, configuração, fixture ou global D1 ausente
falha o teste. Essa comparação não altera nem corrige dependências externas.

Com TypeScript 6.0.3, Drizzle 0.45.2, Better Auth 1.7.6 e Workers Types
5.20260922.1, o controle completo ainda encontra erros de declarações externas:
peers opcionais ausentes em Drizzle, inconsistências internas de query builders
e conflitos de globais entre Workers Types/Node/DOM. Portanto o teste completo
**não significa que todo o grafo externo passe num `tsc` estrito sem erros**.
Ele prova que as declarações Foundation não acrescentam erros e que os
requisitos D1 estão resolvidos; o JSON de diagnósticos registra os problemas
externos. Build/execução são verificados com os artifacts reais, sem editar
essas declarações, e repetidos numa segunda instalação limpa.
