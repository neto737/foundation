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
  resolvê-los, sem exigir configuração implícita do Foundation. Seu contrato é
  **Cloudflare Workers/D1**, com libs ES e sem os globais Node/DOM. Veja o
  [perfil mínimo do pacote db](../../packages/db/README.md#perfil-typescript-de-d1).
  Não há um entrypoint oficial restrito que forneça os quatro globais D1 ao
  Drizzle; imports de tipos oficiais resolvem os nomes locais, mas não os nomes
  globais nas declarações da dependência. Não copiamos nem inventamos tipos D1.

## TypeScript estrito e dependências externas

O teste usa o compilador instalado no consumidor, sempre com
`skipLibCheck: false`. Todos os arquivos carregados precisam estar dentro desse
consumidor, inclusive as libs do compilador. A lista dos **18 entrypoints** é
fixa: remover um export não reduz silenciosamente a cobertura.

Há controles separados para provar a origem de cada categoria:

1. **Terceiros puros, Node/DOM:** imports diretos de Drizzle/Better Auth, sem
   Foundation e sem referência/injeção Workers. Esse controle preserva
   `process.env: ProcessEnv` e registra falhas intrínsecas e nomes D1 globais
   não fornecidos por um consumidor Node.
2. **Foundation não-D1, Node/DOM:** as 15 entradas não-D1 são comparadas a
   imports diretos equivalentes. Não podem carregar o arquivo global Workers nem
   degradar `process.env`; qualquer diagnóstico adicional falha.
3. **audit/d1 e tenant/d1, Node/DOM:** chamadas com tipos oficiais importáveis,
   incluindo testes negativos de bindings inválidos; exigem zero diagnósticos e
   preservação de `process.env: ProcessEnv`.
4. **db/d1, Workers:** o consumidor usa `lib: ["ES2023"]`, `types: []`, sem
   Node/DOM. O controle separado de Drizzle usa a configuração **nativa
   Workers** com tipos oficiais globais, pois esse é o ambiente legítimo desse
   adapter. Não é o controle puro e não é usado para justificar conflitos
   mistos. Erros adicionais, erros Foundation ou nomes D1 ausentes falham o
   teste.
5. **Perfil misto não suportado:** importar `db/d1` junto às entradas Node/DOM
   carrega os globais Workers. O teste registra separadamente o delta de
   conflitos e a degradação de `process.env` para `any`. Essas falhas são
   **induzidas pelo carregamento do ambiente pela integração Foundation**; nunca
   são aceitas como upstream-only nos perfis suportados.

A comparação nos perfis suportados inclui arquivo real, posição, comprimento,
código e multiplicidade dos diagnósticos contra o controle correspondente. Não
se usa um controle misto com referência global artificial para alegar
independência causal. Todos os reports são preservados em `diagnostics.json`.

Com TypeScript 6.0.3, Drizzle 0.45.2, Better Auth 1.7.6 e Workers Types
5.20260922.1, os resultados são: controle puro com 81 diagnósticos Drizzle e 1
Better Auth (`bun:sqlite`); não-D1 com 71 Drizzle e 1 Better Auth; audit/tenant
D1 com zero erros; Workers D1 com 85 diagnósticos **somente Drizzle**, iguais ao
controle nativo Workers; perfil misto com 115 conflitos de globais adicionais
(77 Workers Types, 7 Node e 31 libs TypeScript), além dos diagnósticos Drizzle e
Better Auth. Esses números são observações, não uma lista ampla de exceções.

Portanto o gate não promete que dependências com declarações intrinsecamente
inválidas tenham um `tsc` totalmente verde. Ele exige zero regressões Foundation
no perfil suportado, separa incompatibilidades de integração e não altera
declarações de terceiros. Build emit e runtime dos 18 imports são verificados
separadamente; emissão não transforma erros de typecheck em sucesso. As duas
instalações são limpas; seus `node_modules` são removidos após a validação,
mantendo manifests, artifacts e reports para inspeção.
