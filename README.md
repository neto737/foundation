# Levi

Aplicação de gestão de igrejas da t00ls-dev, baseada nos recursos compartilhados
do [Foundation](https://github.com/t00ls-dev/foundation).

## Estado atual

O projeto possui uma primeira fatia **web executável localmente**: onboarding por
e-mail verificado e senha posterior, provisionamento atômico de organização com
primeira igreja, vínculo administrativo e auditoria, além de contexto
organizacional e consulta de igrejas. Há migrations próprias e testes em
PostgreSQL descartável. A SPA React permite concluir esse fluxo, selecionar uma
organização e consultar suas igrejas. Membros e ambiente de produção ainda não
foram implementados.

Consulte [Onboarding e provisionamento](docs/onboarding-provisionamento.md) para
execução local, endpoints, decisões técnicas e limites desta entrega.
[Interface de onboarding](docs/interface-onboarding.md) descreve a SPA e seus testes.

## MVP aprovado

- Organização é o tenant e pode conter várias igrejas.
- Somente administradores organizacionais, com acesso aos recursos disponíveis de
  todas as igrejas da própria organização.
- Membro pertence à organização e tem exatamente uma igreja atual, independente
  das contas de usuários autenticados.
- Cadastro com nome obrigatório; nascimento, telefone, e-mail, ingresso conhecido,
  endereço, data de batismo e função na igreja são opcionais.
- Situações **Ativo** e **Inativo**, com histórico de alterações e transferências
  internas à organização, preservando a identidade do membro.
- Busca, listagem, aniversariantes e indicadores simples, com detalhes de consulta
  ainda a definir.
- Onboarding: **e-mail verificado → definição de senha → criação da organização
  com a primeira igreja**.
- PostgreSQL compartilhado, UUIDs gerados no servidor, operações relacionadas
  atômicas e separação entre histórico pessoal e auditoria técnica mínima.

A fonte de decisões vigentes é [Decisões do MVP](docs/decisoes-mvp.md), que detalha
as invariantes, exclusões, recomendações técnicas e pendências reais. Financeiro,
comercialização, migração do legado e permissões locais por igreja ficam fora da
implementação inicial.

## Relação com o Foundation

O Foundation fornece a base tecnológica; o Levi concentra as regras de gestão de
igrejas e sua composição. Os pacotes oficiais `@t00ls-dev/*` são publicados no
npmjs.com. A integração deve reutilizar seus contratos públicos conforme a
necessidade, sem copiar o monorepo ou tratar o exemplo Links como aplicação pronta
para o Levi.

Consulte a [arquitetura do Foundation](https://github.com/t00ls-dev/foundation/blob/master/docs/architecture/overview.md)
e o [guia de consumo de pacotes](https://github.com/t00ls-dev/foundation/blob/master/docs/runbooks/packages.md).
O preset `basic-d1` não corresponde ao PostgreSQL aprovado; UI e ferramentas
privadas do workspace não são pacotes públicos disponíveis ao consumidor. Esta
fatia usa um único projeto TypeScript, Hono, Better Auth e Drizzle com PostgreSQL
via `pg`, consumindo versões publicadas. O servidor Node é uma superfície local;
runtime e conectividade de produção continuam sem definição.

## Documentação e contribuição

- [Decisões do MVP](docs/decisoes-mvp.md): escopo e precedência documental.
- [Instruções do repositório](AGENTS.md): responsabilidades, convenções e validação.
- [Onboarding e provisionamento](docs/onboarding-provisionamento.md): contratos,
  execução e validação da primeira fatia.
- [Interface de onboarding](docs/interface-onboarding.md): React, desenvolvimento
  com Vite, navegação e testes de navegador.

Documentação e mensagens próprias usam português brasileiro. Com Node
`>=22.22.0`, instale com `npm ci --ignore-scripts`, execute `npm run typecheck`,
`npm test` e `npm run build`. `npm run test:integration` exige Docker: cria seu
próprio PostgreSQL, aplica explicitamente o histórico apenas nesse banco sintético,
executa os testes e remove o container. Não usa um banco externo configurado. `npm run test:e2e` exercita a interface em
Chromium contra outra instância descartável, após `npm run build`.

Com o banco sintético e o segredo local configurados conforme o guia de onboarding,
`npm run dev` inicia Vite em `http://localhost:5173` e a API em loopback na porta 3000. `npm start` serve o build e a API juntos em `http://localhost:3000`.

O legado permanece em [t00ls-dev/Levi.old](https://github.com/t00ls-dev/Levi.old),
separado deste repositório. Configurações locais e segredos ficam fora do
versionamento, conforme o [.gitignore](.gitignore).
