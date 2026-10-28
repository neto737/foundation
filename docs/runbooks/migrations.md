# Migrations

Cada aplicação é dona do schema e histórico. Pacotes exportam schemas e não
aplicam SQL nos consumidores. Migrations persistentes exigem operação
independente e autorizada; não devem executar automaticamente em CI, deploy ou
startup. Replays em bancos sintéticos descartáveis são permitidos nos testes.

## Contrato de evolução

```text
CI push/master → dispatch autorizado → EXPAND → DEPLOY/health
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

Tempo não autoriza contract. A elegibilidade depende das evidências de
compatibilidade.
