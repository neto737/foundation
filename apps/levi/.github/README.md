# Referência histórica de GitHub Actions

Estes arquivos foram preservados com o código incorporado no SHA
`b2c892e27e3a8988f0be554692ffea43d35fcd61`. Não são workflows ativos do Foundation.
A instalação npm descrita na action de setup pertence ao repositório original;
não constitui uma segunda autoridade de instalação desta cópia.

A validação desta aplicação está na [CI raiz](../../../.github/workflows/ci.yml),
com pnpm e lockfile únicos. O [publicador raiz preparado](../../../.github/workflows/deploy-levi-dev.yml)
aceita somente execução manual, bloqueada por `DEPLOY_READY=false` no Environment
`levi-dev`. Não copiar o deploy automático histórico nem acionar o novo
publicador sem autorização. Transferir o controlador, credenciais ou Environments
exige tarefa própria; consultar [Deploy DEV](../docs/deploy-dev.md). O workflow histórico de deploy está desabilitado explicitamente.
