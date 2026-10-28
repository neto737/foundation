# Deploy

O deploy do Levi é manual pelo workflow `deploy-levi-dev.yml`, sujeito aos gates
de CI do SHA exato, Environment e autorizações existentes. Consulte o
[guia do Levi](../../apps/levi/README.md) para seus recursos e procedimentos.

Os workflows de publicação, migrations e recuperação D1 do exemplo foram
removidos. Nenhuma exclusão de infraestrutura remota foi executada. Recursos
persistentes antigos exigem inventário e autorização operacional separados.

Criar um PR não autoriza merge, deploy, publicação ou migrations persistentes.
