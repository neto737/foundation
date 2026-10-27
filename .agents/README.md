# Skills locais do Foundation

O OpenCode descobre `.agents/skills/<name>/SKILL.md` no contexto deste worktree.
As Skills e referências são cópias versionadas; um clone do Foundation basta
para disponibilizá-las, sem instalação global, symlinks ou dependência de
diretórios temporários. Reinicie o OpenCode após alterar esses arquivos.

## Uso no projeto

As Skills de terceiros são referências auxiliares. `AGENTS.md`, a Skill
`foundation-workflow`, os ADRs e os runbooks do Foundation prevalecem sobre
recomendações genéricas. Use somente os trechos pertinentes à tarefa e às
versões instaladas; instalar uma Skill não autoriza executar seus exemplos ou
scripts.

- Preserve CI/CD e seus gates, migrations app-owned e forward-only, autenticação
  Better Auth self-hosted, autorização por permissões e isolamento por tenant.
  Siga `docs/project-status.md`, `docs/decisions/` e `docs/runbooks/`.
- Preserve o pnpm fixado no projeto, Turborepo, Vitest e os harnesses reais
  Miniflare/Testcontainers/Playwright. Não substitua testes por mocks nem adote
  outro pool, pipeline, driver, provider ou CLI por recomendação de uma Skill.
- Para Turborepo, resolva o pacote instalado e leia sua documentação embutida,
  conforme `AGENTS.md`. Se ela estiver indisponível, registre a lacuna antes de
  mudanças de configuração; a Skill não substitui a documentação da versão.
- Exemplos Drizzle `push`, seeds dentro de migrations e aplicação de SQL em CI
  não substituem `docs/runbooks/migrations.md`. A referência `postgres-drizzle`
  cobre somente PostgreSQL; não aplique seu SQL ao D1.
- React no Foundation é SPA com React Router. Regras Next.js/RSC,
  `next/dynamic`, SWR e deploy Vercel só se aplicam a projetos que já usam esses
  recursos.
- Cloudflare não implica adoção de `cf`, Hyperdrive, Queues, Workflows, cache de
  respostas privadas ou produtos sem consumidor real. Preserve Wrangler e o
  deploy DEV existente; consulte também `docs/runbooks/cache.md`.
- `playwright-cli` pode usar o Playwright já instalado em `examples/links`:
  `pnpm --filter @t00ls-dev/example-links exec playwright cli --help`. É
  auxiliar de inspeção, sem substituir os testes E2E e seus critérios. Não
  instale a CLI global. MCP/Chrome DevTools/Lighthouse/axe são opcionais;
  registre limitações quando as ferramentas necessárias à medição estiverem
  indisponíveis.
- As Skills TypeScript se complementam: `typescript-advanced-types` é referência
  de sintaxe; `principle-type-system-discipline` e `typescript-best-practices`
  orientam modelagem e validação. A referência abreviada
  `type-system-discipline` corresponde a `principle-type-system-discipline`.
  Referências a outras Skills de princípios são opcionais, não autorização para
  instalar uma coleção. Preserve convenções e APIs públicas; exemplos com `any`,
  casts ou omissão de typecheck não alteram o strict mode nem os gates
  existentes.
- `accessibility` complementa `web-design-guidelines`; use evidência do fluxo
  afetado. A Skill de especificação GitHub Actions documenta workflows
  existentes: adapte o template a pt-BR e aos diretórios documentais do projeto,
  sem inventar ambientes, SLAs, aprovações ou novos gates.

## Proveniência e manutenção

[`skills-sources.json`](skills-sources.json) registra nome, repositório, commit,
diretório original e SHA-256 de cada `SKILL.md` adicionado nesta instalação. As
referências e metadados upstream foram preservados, incluindo
`vercel-react-best-practices/metadata.json`, omitido pelo instalador.
[`licenses/`](licenses/) conserva as licenças das fontes que as fornecem; a
Skill React declara MIT no próprio frontmatter, sem arquivo de licença na fonte.
As duas Skills preexistentes permanecem preservadas.

Atualizações exigem nova revisão do conteúdo e das dependências. Não execute
atualização automática no início de sessões. Revise também licenças e o
inventário antes de incluir arquivos novos. Não traduza ou reformate cópias
upstream; escreva a documentação local em pt-BR. `.prettierignore` já preserva
`.agents/skills`.

A sintaxe local confirmada com `skills@1.7.2` é:

```sh
DISABLE_TELEMETRY=1 npx --yes skills@1.7.2 add <fonte-revisada> \
  --skill <nome-aprovado> --agent opencode --copy --yes
```

Para reproduzir a importação, faça checkout do commit registrado em uma cópia
temporária da origem, revise-o e use o diretório original como
`<fonte-revisada>`. Se o instalador gerar `skills-lock.json` apontando para essa
cópia temporária, não versione esse lock: a proveniência portátil está no
manifesto e o conteúdo distribuído está no próprio Git. Preserve arquivos
complementares omitidos pelo instalador e as licenças aplicáveis.

## Seleções não instaladas

Todas as Skills solicitadas foram localizadas nas fontes examinadas. As
seguintes não foram aprovadas nesta revisão:

| Seleção                               | Justificativa                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hono`                                | A revisão atual orienta Hono v5 e exige adicionar `@hono/cli@next`; o Foundation usa Hono v4 e harnesses próprios.                                                                               |
| `pnpm`                                | A revisão atual descreve pnpm 12/v11+, desconsidera configuração em `package.json` e inclui release/orquestração nativa; o projeto usa pnpm 10.15.1, Turborepo e consumo interno pelo workspace. |
| `neon`                                | Sem integração Neon atual; inclui provisionamento, instalação global de CLI/MCP, atualização por sessão e backend Next.js/Vercel/Neon Functions.                                                 |
| `neon-postgres`                       | Depende de carregar `neon` primeiro e orienta operações específicas desse provider; não há consumidor Neon no Foundation. PostgreSQL genérico é coberto por `postgres-drizzle`.                  |
| `better-auth-best-practices`          | A fonte examinada não fornece licença de redistribuição para versionar a cópia. Além disso, exemplos genéricos `push`/migrate precisam respeitar os históricos por dialeto.                      |
| `better-auth-security-best-practices` | Mesma ausência de licença na fonte; exemplos de cookie cache, proxy headers e auditoria não são configuração canônica do Foundation.                                                             |
| `security-guidance`                   | Impõe todos os requisitos ASVS L1, citações inline obrigatórias e interrupção em lacunas, convertendo orientação auxiliar em política global de implementação.                                   |

Da coleção `cloudflare/skills`, foram aprovadas `cloudflare`,
`workers-best-practices`, `wrangler`, `workers-profiling` e `web-perf`. Não
foram importadas `agents-sdk`, `basin`, `cloudflare-email-service`,
`cloudflare-one`, `cloudflare-one-migrations`, `durable-objects`, `k2`,
`nextjs-on-cloudflare`, `sandbox-migrate-to-next`, `sandbox-next` e
`sandbox-stable`: não há consumidor desses produtos/SDKs no escopo atual.
`cloudflare-email-service` também conflita com o provider Resend e os testes de
e-mail sem envio real. `turnstile-spin` foi bloqueada porque seu wizard exige
executável Wrangler externo, manipula secrets/deploy e substitui a integração
por Siteverify próprio; o Foundation já utiliza o plugin oficial Better Auth.
Referências opcionais a essas Skills no índice Cloudflare não as tornam
dependências obrigatórias nem autorizam instalá-las.
