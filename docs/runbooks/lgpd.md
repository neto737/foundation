# LGPD e privacidade

O foundation fornece padrões de minimização e segurança, mas não torna uma
aplicação automaticamente adequada à LGPD. Finalidade, base legal, retenção e
resposta a titulares pertencem ao produto consumidor.

## Baseline

- colete apenas dados necessários para uma finalidade documentada;
- classifique consentimento como `essential`, `analytics` ou `marketing`;
- não ative analytics, replay ou marketing sem a avaliação de consentimento;
- mantenha logs técnicos separados de auditoria;
- não inclua secrets ou credenciais em logs e metadados;
- defina retenção e exclusão por categoria de dado;
- mantenha backups privados e considere a janela de retenção ao excluir dados.

`createAuditEvent` rejeita recursivamente chaves relacionadas a password, token,
cookie e secret. Isso reduz vazamentos acidentais, mas não substitui a revisão
dos metadados nem a minimização de PII.

## Responsabilidades do produto

Antes de operar com dados reais, cada produto deve documentar:

- dados coletados, finalidade e base legal;
- exportação e portabilidade;
- exclusão e exceções legais de retenção;
- prazos de retenção para banco, logs, auditoria e backups;
- subprocessadores e transferências aplicáveis;
- consentimento e revogação para analytics/marketing;
- procedimento de incidente e atendimento ao titular.

As implementações genéricas desses fluxos permanecem fora da v0.1 até existir um
produto com requisitos concretos.
