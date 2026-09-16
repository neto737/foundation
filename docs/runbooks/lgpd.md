# LGPD e privacidade

O foundation fornece defaults de minimizacao e seguranca, mas nao declara uma
aplicacao automaticamente conforme. Finalidade, base legal, retencao e resposta
a titulares pertencem ao produto consumidor.

## Baseline

- colete apenas dados necessarios para uma finalidade documentada;
- classifique consentimento como `essential`, `analytics` ou `marketing`;
- nao ative analytics, replay ou marketing sem a avaliacao de consentimento;
- mantenha logs tecnicos separados de auditoria;
- nao inclua secrets ou credenciais em logs e metadata;
- defina retencao e exclusao por categoria de dado;
- mantenha backups privados e considere a janela de retencao ao excluir dados.

`createAuditEvent` rejeita recursivamente chaves relacionadas a password, token,
cookie e secret. Isso reduz vazamentos acidentais, mas nao substitui revisao da
metadata nem minimizacao de PII.

## Responsabilidades do produto

Antes de operar com dados reais, cada produto deve documentar:

- dados coletados, finalidade e base legal;
- exportacao e portabilidade;
- exclusao e excecoes legais de retencao;
- prazos de retencao para banco, logs, auditoria e backups;
- subprocessadores e transferencias aplicaveis;
- consentimento e revogacao para analytics/marketing;
- procedimento de incidente e atendimento ao titular.

As implementacoes genericas desses fluxos permanecem fora da v0.1 ate existir um
produto com requisitos concretos.
