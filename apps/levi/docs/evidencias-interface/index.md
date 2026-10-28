# Evidências da interface

Capturas explícitas da execução sintética de 2026-10-24, sem dados reais,
credenciais ou tokens. Desktop usa Chromium (1280 × 720); iPhone 13 Mini é
emulado em WebKit 27.2 (375 × 629 CSS px, escala 3). São capturas do navegador
em Linux, sem validação em Safari real ou aparelho físico. Os formulários também
foram exercitados em 320, 375 e 390 px, texto a 150% e área útil de 375 × 360.

As capturas temporárias dessa execução foram retiradas do versionamento.
Os harnesses continuam gerando imagens locais em `apps/levi/.local/e2e/`,
ignorado pelo Git, para depuração e revisão. Elas não são baselines de testes visuais.

Para revisar localmente, usar somente os bancos descartáveis dos harnesses,
conforme [interface](../interface-onboarding.md) e [gestão de membros](../gestao-membros.md).
Conferir navegação por teclado, Enter nos inputs e no botão, filtros móveis,
recuperação de resultado incerto, edição, conflito e negação após revogação.
A execução histórica cobriu 67 cenários E2E, incluindo Axe; não é uma
certificação de acessibilidade. A [aplicação operacional de migration e ACLs](../cloudflare-workers.md#incremento-de-interface-e-edição-pendente-de-operação)
permanece separada e não foi executada.
