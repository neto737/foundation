# Evidências da interface

Capturas explícitas da execução sintética de 2026-10-24, sem dados reais,
credenciais ou tokens. Desktop usa Chromium (1280 × 720); iPhone 13 Mini é
emulado em WebKit 27.2 (375 × 629 CSS px, escala 3). São capturas do navegador
em Linux, sem validação em Safari real ou aparelho físico. Os formulários também
foram exercitados em 320, 375 e 390 px, texto a 150% e área útil de 375 × 360.

| Tela                                                   | Evidência                                     |
| ------------------------------------------------------ | --------------------------------------------- |
| Painel desktop                                         | [Painel](desktop-painel.png)                  |
| Membros desktop                                        | [Listagem](desktop-membros.png)               |
| Painel móvel                                           | [Painel no iPhone emulado](iphone-painel.png) |
| Lista móvel com filtros recolhidos                     | [Membros](iphone-membros.png)                 |
| Início do formulário                                   | [Cadastro](iphone-cadastro.png)               |
| Ação explícita ao final, com foco visível              | [Confirmação](iphone-confirmacao.png)         |
| Configuração inicial com contatos opcionais recolhidos | [Onboarding](iphone-onboarding.png)           |
| Conflito de edição sem perda do rascunho               | [Edição](iphone-edicao.png)                   |

Para revisar localmente, usar somente os bancos descartáveis dos harnesses,
conforme [interface](../interface-onboarding.md) e [gestão de membros](../gestao-membros.md).
Conferir navegação por teclado, Enter nos inputs e no botão, filtros móveis,
recuperação de resultado incerto, edição, conflito e negação após revogação.
As capturas complementam os 67 cenários E2E aprovados, incluindo Axe; não são uma
certificação de acessibilidade. A [aplicação operacional de migration e ACLs](../cloudflare-workers.md#incremento-de-interface-e-edição-pendente-de-operação)
permanece separada e não foi executada.
