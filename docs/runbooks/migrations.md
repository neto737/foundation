# Migrations

**Migrations são desacopladas de CI, deploy e inicialização.** Cada aplicação é
dona do schema composto e histórico. Pacotes exportam schemas, não aplicam SQL
no banco de consumidores. CI valida em bancos descartáveis; deploy publica
código compatível, sem executar migrations. Coordenação não funde essas
operações.

## Contrato de evolução

```text
merge/master → CI → EXPAND (workflow próprio) → DEPLOY/health
                                               ↓
                                     BACKFILL opcional/validação
                                               ↓
                                  revalidação → CONTRACT elegível
```

- **expand:** adicione estrutura compatível com a aplicação anterior. Nova
  coluna obrigatória precisa de default compatível; não retire estrutura ou
  torne escritas antigas inválidas.
- **deploy:** publique código preparado para o schema intermediário, com
  dual-read/write quando necessário. Rollback de código não reverte schema.
- **backfill:** transforme dados históricos depois do deploy, com identidade e
  postcondição. Não inclua grandes transformações no deploy.
- **contract:** retire compatibilidade antiga depois de comprovar estrutura,
  dados, versão ativa e saúde. O código publicado deve deixar de usar a
  estrutura retirada antes da remoção. Após contract, rollback antigo pode ser
  incompatível.

Tempo não autoriza contract. `policy.json#environments.dev.contractDelaySeconds`
é proteção adicional; começa em **0**, sem espera artificial. Uma janela maior
adia a operação como inelegível, sem sleep ou erro; nova execução reavalia.

## Comandos locais

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:status
```

No Links, migrate/status são locais; `db:status:dev` consulta DEV remotamente. O
antigo `db:migrate:dev` foi removido: escrita persistente pertence ao workflow
autorizado, não a script genérico com token remoto. Seeds são separados do
histórico de schema e nunca fazem parte do deploy.

### D1

Drizzle Kit gera SQL/snapshots/journal; Wrangler executa e registra no
`d1_migrations`:

```bash
drizzle-kit generate --config drizzle.config.ts
wrangler d1 migrations apply DB --local
wrangler d1 migrations list DB --local
wrangler d1 execute DB --local --file seeds/local.sql
```

Use o binding/configuração explícitos. O apply local pode aplicar todo o
histórico, inclusive fases pós-deploy; nunca acrescente `--remote` a esse
atalho. Bancos descartáveis não são o caminho privilegiado do DEV persistente.

### PostgreSQL

O adapter/histórico/testes existentes continuam suportados. `DATABASE_URL` é
obrigatória para migrate, seed e status:

```bash
drizzle-kit generate --config drizzle.postgres.config.ts
drizzle-kit migrate --config drizzle.postgres.config.ts
node --experimental-strip-types postgres/status.ts
node --experimental-strip-types postgres/seed.ts
```

`tests/integration` contém schema composto, migration, seed idempotente e testes
contra PostgreSQL 17 descartável. Não há PostgreSQL persistente em DEV; o driver
coordenado entregue é D1. Outro driver precisa de testes próprios de
atomicidade, journal, guard e recuperação. Não o apresentar como operação PROD
já habilitada.

## Metadata versionada

`examples/links/migrations/policy.json` associa cada SQL do journal Drizzle a
`file`, `phase`, `transition`, `dependsOn` e `verify`. A probe `verify` é SELECT
read-only e deve retornar exatamente uma linha `{ remaining: 0 }` quando a
postcondição está satisfeita. Os resultados dos dados não são logados.

Dependências precedem a operação. Backfill depende dos expands da transição;
contract depende dos expands e backfills da transição. Sem backfill, basta
expand. Exemplo ilustrativo:

```json
{
  "file": "0005_copy_titles.sql",
  "phase": "backfill",
  "transition": "bookmark-title-v2",
  "dependsOn": ["0004_title_v2.sql"],
  "verify": "SELECT COUNT(*) AS remaining FROM bookmark WHERE title_v2 IS NULL"
}
```

Se contract retirar estrutura usada pela probe anterior, declare `supersededBy`
na operação antiga, apontando ao contract dependente. A probe só é substituída
quando o journal comprovar esse contract; então sua postcondição é verificada.
Isso não pode esconder falha de expand/backfill antes do contract.

As três migrations atuais são expand; seus SQL/snapshots não foram reescritos.
Bancos já migrados são reconhecidos pelo journal, sem reaplicar. Hashes das
tentativas novas ficam no banco; testes comparam SQL com sua primeira inclusão
no histórico Git. SQL versionado/aplicado é imutável: correção é migration nova.

### Validação conservadora

`pnpm test:migrations` valida metadata, histórico e invariantes arquiteturais. O
lexer SQLite é limitado, não parser universal:

- expand admite CREATE TABLE, índices não únicos e ALTER TABLE ADD;
- índice único em expand só sobre tabela criada no mesmo SQL;
- ADD rejeita PRIMARY/UNIQUE/REFERENCES/CHECK/GENERATED e NOT NULL sem default
  constante não nulo;
- DROP, RENAME, DML e CREATE AS SELECT não são expand;
- PRAGMA, triggers, transações explícitas e sintaxe desconhecida falham fechado;
- backfill suporta UPDATE/INSERT pequeno, sem DDL;
- contract suporta DROP/ALTER explícitos, com provas pós-deploy;
- probes são SELECT único que inspeciona o banco (`FROM` obrigatório).

O validador não prova compatibilidade de negócio. Revisão humana, testes de
compatibilidade e probes significativas continuam necessários. Sintaxe fora do
subconjunto exige extensão revisada; não existe escape para "expand seguro".

## DEV automático e independente

`Deploy DEV` recebe CI push/master aprovada e coordena jobs independentes.
`expand`, `backfill` e `contract` chamam o workflow reutilizável
`Migration DEV`. O job `deploy` verifica schema read-only, publica e faz smoke,
sem aplicar SQL.

1. Validador confiável verifica CI, origem, workflow, SHA e tentativa exatos.
2. Exige master ainda no SHA validado; execução obsoleta falha fechado.
3. Expand consulta estado e aplica só pendências dessa fase.
4. Deploy exige expand comprovado e ausência de dirty; contract pendente não o
   bloqueia. Publica com tag/header do SHA.
5. Backfill requerido exige deploy saudável, aplica e prova conclusão.
6. Contract verifica journal, dependências/probes, CI/master atuais, job deploy
   aprovado na mesma execução/tentativa, deployment Cloudflare criado nesse job,
   versão única com 100% de tráfego/tag do SHA e `/health` do mesmo SHA com D1
   saudável. Revalida imediatamente antes/depois de cada mutation. Sem prova,
   não executa; marca `ineligible` e encerra sem erro.

Sem pendências, as fases são no-op e deploy segue. Falha de expand bloqueia
deploy, preservando Worker atual. Dirty/falha de backfill bloqueia
contract/avanços, sem derrubar a aplicação atual ou executar rollback
destrutivo.

Todo o ciclo e Recovery DEV usam concurrency `foundation-dev-d1`,
`cancel-in-progress: false`. O workflow chamado não readquire o grupo (evita
deadlock). Execuções novas aguardam ou podem substituir tentativas ainda
pendentes pelo GitHub; não cancelam mutation iniciada. Novo SHA revalida tudo.
Um índice único D1 também impede duas intenções modificadoras ativas.

Recovery mantém essa intenção dirty enquanto adquire posse por compare-and-set
no histórico JSON da mesma linha. Só o detentor pode registrar
progresso/concluir; duas recuperações não podem modificar simultaneamente o
mesmo estado, mesmo sem depender exclusivamente da fila de Actions. Não há
tabela/journal paralelo nem espera temporal para liberar posse. Auditoria de
conclusão e estado final são gravados no mesmo UPDATE atômico.

## Autoridade, evidências e dirty

- **Git:** definição, fases, dependências, probes e histórico.
- **`d1_migrations`:** journal nativo, autoridade sobre SQL efetivamente
  aplicado.
- **`foundation_migration_operations`:** somente tentativas/hashes, dirty,
  evidência de autorização de contract e resolução; o journal não os representa.
- **Actions:** SHA, ator, run/tentativa, início/término e resultado; summary e
  artifact sanitizado por fase, retido 30 dias. Sucesso de Actions sozinho não
  comprova schema nem backfill.

Wrangler recebe diretório temporário com **um único SQL autorizado** e binding
DEV resolvido da configuração versionada. Um apply de expand não descobre
contract. Preserva executor/journal oficiais. D1/Wrangler oferece rollback da
migration com erro; resposta perdida não prova ausência de efeitos. Antes de
SQL, persiste intenção `running`; falha/estado incerto deixa `dirty` ou
`running` abandonado, tratado como dirty. Não há retry automático de mutation.

Dirty sobrevive à perda do runner/expiração de artifacts. Journal presente com
postcondição falhando bloqueia avanço. Uma operação comprovadamente aplicada
nunca é reaplicada. Não se presume atomicidade universal de futuros adapters.

## Recuperação explícita

Preserve summary/artifact/ID, diagnostique journal/schema/dados e abra issue/PR
do incidente, sem dados privados. Em mudança revisada, adicione
`examples/links/migration-recovery/<identificador>.json`:

```json
{
  "format": 1,
  "operationId": "<run>-<attempt>-0004_title_v2.sql",
  "resolution": "unapplied",
  "incident": "https://github.com/t00ls-dev/foundation/issues/123",
  "proof": "SELECT COUNT(*) AS remaining FROM pragma_table_info('bookmark') WHERE name='title_v2'"
}
```

A probe ilustrativa só prova ausência dessa coluna. Diagnóstico/revisão devem
cobrir **todos** os efeitos possíveis do SQL real; não use SELECT trivial para
limpar dirty. Após merge/CI do diagnóstico, mantenedor executa:

```bash
gh workflow run migration-recovery-dev.yml --ref master \
  -f execution_sha=<SHA-completo-atual> -f recovery=<identificador> \
  -f confirmation=RECONCILE_DEV_D1
```

- `unapplied`: prova diagnóstica passa e journal não contém a migration; libera
  nova tentativa após confirmação de nenhum efeito.
- `applied`: journal, probe original e prova diagnóstica passam; reconcilia sem
  reaplicar.
- `corrected`: inclui `correction` com **novo** SQL compatível da mesma
  transição na policy/journal Drizzle. Aplica apenas se pendente; valida
  correção, seu registro no journal nativo, prova diagnóstica e probe original.
  Só então reconcilia o nome original no journal, registrando como o estado
  final foi atingido. Falha mantém dirty ativo.

Repetir uma recuperação concluída é read-only e retorna `already-reconciled` em
`recoveryResult` no resultado da CLI (o resultado global da fase é `succeeded`)
somente se a definição semântica do diagnóstico corresponder à evidência
registrada, não existir outra operação dirty e journal/postcondições/prova
continuarem válidos. Não reexecuta SQL nem reescreve auditoria. Diagnóstico
alterado, journal incompleto ou estado que avançou depois da recuperação falham
fechado. Nomes aplicados também precisam das dependências no journal.

Se o runner desaparecer durante **recovery**, a posse permanece no histórico com
`recoveryId` e outcome `running`; falha capturada registra `failed` e mantém
dirty. Para retomar uma posse abandonada, inclua no diagnóstico versionado
`supersedesRecovery` com o `recoveryId` anterior. O executor exige evidência
atual da API Actions: run original do workflow Recovery DEV,
repository/origem/master, SHA e tentativa compatíveis, com execução concluída.
Essa prova fica na auditoria. Execução ativa, API indisponível ou identidade
divergente impedem a retomada. Não basta declarar abandono nem aguardar um
prazo; não existe `force-unlock`.

Os únicos campos aceitos no diagnóstico são `format`, `operationId`,
`resolution`, `incident`, `proof`, `correction` (somente em `corrected`) e
`supersedesRecovery`. Inputs de ambiente/banco e campos desconhecidos são
rejeitados: o alvo continua sendo DEV na configuração do SHA autorizado.

O histórico original em array JSON permanece compatível. Os registros novos
acrescentam posse/outcome, sem alterar SQL/snapshots/journal de aplicação. Os
checkpoints disponíveis hoje são migrations finitas concluídas e tentativas
duráveis; não são checkpoints por lote de um backfill grande.

Depois, reexecute o ciclo somente para master atual:

```bash
gh workflow run deploy-dev.yml --ref master -f execution_sha=<SHA-completo-atual>
```

Não há force-clean, edição de SQL aplicado ou rollback destrutivo. Credencial
administrativa externa pode contornar qualquer workflow; restrinja seu acesso.
Não rode Wrangler remoto por fora para destravar.

## Fluxo de desenvolvimento

1. Altere schema Drizzle, gere SQL e revise snapshot/journal.
2. Classifique fase/transição/dependências e escreva postcondição na policy.
3. Execute `pnpm test:migrations` na raiz e valide em banco descartável/local.
4. Aplique `db:migrate` explicitamente em local; confira `db:status`.
5. Merge/CI coordena DEV; confira summary/artifacts/journal antes de prosseguir.
6. Seeds são operação separada, somente quando necessários no ambiente correto.

## Limites e PROD futuro

Backfill entregue é SQL pequeno/finito, com journal e probe. Grande backfill
exige executor por lotes/checkpoint durável e retomada por transição,
preservando guard e prova de conclusão. O core separa driver/aplicação/prova
para essa extensão; não empurre milhões de linhas para o apply atual.

Guard não bloqueia edição externa na Cloudflare. Consultas de master/deployment/
health não são transação atômica com SQL; operadores externos devem respeitar
serialização. 100% de tráfego/health não prova ausência universal de requests
antigos em voo ou compatibilidade de negócio. Se uma transição precisar dessas
provas, estenda evidências antes de habilitar contract; tempo não as substitui.

PROD continua desabilitado, sem workflow fictício. Gates/aprovações, rollout,
rollback, drain de versões, observabilidade, janela e política de contract serão
definidos por consumidor/ambiente, preservando o mesmo modelo de fases.
