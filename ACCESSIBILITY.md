# Acessibilidade no Foundation

O Foundation busca permitir que pessoas com deficiência usem suas aplicações,
leiam a documentação e contribuam para o projeto. Relatos de pessoas que usam
tecnologias assistivas orientam a identificação e a correção de barreiras.

## Objetivos e alcance

Nosso objetivo é atender às [WCAG 2.2 nível AA](https://www.w3.org/TR/WCAG22/)
nas interfaces web, com navegação por teclado, foco visível, estrutura
semântica, contraste legível, formulários identificados e mensagens de erro e
carregamento compreensíveis. A declaração abrange o monorepo, incluindo Levi
(`apps/levi`), Links (`examples/links`), componentes compartilhados e
documentação. Não foi realizada uma avaliação completa que permita declarar
conformidade formal.

## Ambientes e avaliações existentes

As interfaces disponíveis são aplicações web React; não há nesta declaração uma
matriz de navegadores ou sistemas operacionais homologados. Os harnesses
Playwright avaliam Chromium em desktop e emulação móvel: Pixel 7 no Links e
iPhone 13 Mini no Levi. O Levi também oferece execução opcional em WebKit com
emulação de iPhone, e testes pelo proxy de desenvolvimento. Emulação não
comprova funcionamento em dispositivos físicos nem em Safari real.

Os [testes do Levi](apps/levi/e2e/) incluem verificações automatizadas com
axe-core em cenários de onboarding, membros e administração. Os
[testes do Links](examples/links/e2e/) exercitam teclado, foco, formulários,
diálogos e preferência por movimento reduzido. Veja o
[runbook de testes](docs/runbooks/testing.md) e os
[padrões de componentes](packages/ui/README.md). Esses testes cobrem cenários
específicos; sua existência não significa que cada execução ou todas as telas
tenham sido avaliadas.

## Limitações da avaliação

Não há evidência suficiente de uma avaliação sistemática com leitores de tela
como NVDA, VoiceOver, JAWS ou TalkBack, controle por voz, dispositivos de
acionamento alternativo ou aparelhos físicos. São métodos relevantes para
avaliações futuras, assim como zoom, alto contraste e combinações de navegador e
tecnologia assistiva. Os resultados automatizados não substituem essas
avaliações. Não há nesta declaração um inventário completo de barreiras
conhecidas; a cobertura parcial impede afirmar ausência de problemas.

## Comunicar uma barreira

Abra um
[relato de bug no GitHub Issues](https://github.com/t00ls-dev/foundation/issues/new?template=bug_report.md)
e indique que se trata de acessibilidade. Use o formulário existente; não é
necessário anexar uma captura para relatar o problema. Quando possível, informe:

- Aplicação, tela ou documento, versão ou SHA e endereço sem tokens.
- Passos para reproduzir, resultado esperado e barreira observada.
- Navegador, sistema, tecnologia assistiva e respectivas versões.
- Método de interação, zoom e outras configurações relevantes.
- Impacto na tarefa e eventual alternativa que permita continuar.

Não inclua senhas, links de autenticação, dados pessoais ou informações de
organizações. Questões de segurança devem seguir [SECURITY.md](SECURITY.md). Os
mantenedores avaliam os relatos considerando impacto e possibilidade de
reprodução; não há prazo garantido de resposta ou correção.

## Contribuições e manutenção

Mudanças de interface devem preservar nomes acessíveis, associação de labels e
erros, ordem de foco e operação por teclado. Verifique o fluxo alterado com os
testes existentes e uma passagem por teclado; use axe quando pertinente. Em
alterações relevantes, procure avaliar com leitor de tela e registre quais
ambientes foram realmente usados, resultados e limitações. Priorize correções
pequenas, acompanhadas de regressão quando houver benefício prático.

Os mantenedores do Foundation são responsáveis por revisar esta declaração
quando aplicações, cobertura de testes ou limitações conhecidas mudarem.
Contribuições seguem [CONTRIBUTING.md](CONTRIBUTING.md).

Esta declaração foi orientada pelo
[guia de boas práticas de acessibilidade para projetos](https://opensource.guide/accessibility-best-practices-for-your-project/)
e pelo
[exemplo do Accessibility Toolkit](https://github.com/open-source-accessibility/accessibility-toolkit/blob/main/ACCESSIBILITY.md),
com afirmações limitadas às evidências do repositório.
