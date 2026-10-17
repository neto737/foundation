# Levi

Aplicação de gestão de igrejas da t00ls-dev, baseada nos recursos compartilhados
do [Foundation](https://github.com/t00ls-dev/foundation).

## Estado atual

O projeto está em **preparação documental**. Ainda não há aplicação, dependências,
schema, migrations ou testes do Levi neste repositório, nem ambiente operacional
comprovado. As funcionalidades do MVP estão aprovadas como escopo, mas **nenhuma
está implementada**. A implementação depende de autorização específica.

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
privadas do workspace não são pacotes públicos disponíveis ao consumidor. Runtime,
conectividade e integração completa de autenticação ainda precisam de validação.

## Documentação e contribuição

- [Decisões do MVP](docs/decisoes-mvp.md): escopo e precedência documental.
- [Instruções do repositório](AGENTS.md): responsabilidades, convenções e validação.

Documentação e interface usam português brasileiro. Nesta fase, a validação é
documental: revisar diffs, links e consistência das decisões. Comandos de
instalação, execução e testes serão documentados quando a aplicação existir.

O legado permanece em [t00ls-dev/Levi.old](https://github.com/t00ls-dev/Levi.old),
separado deste repositório. Configurações locais e segredos ficam fora do
versionamento, conforme o [.gitignore](.gitignore).
