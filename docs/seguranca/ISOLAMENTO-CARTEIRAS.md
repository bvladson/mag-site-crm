# Isolamento de carteiras — regras, onde são conferidas e como é provado

Regra geral: o **perfil** é conferido no servidor (`authorize` / `requireActiveUser`) e o **dono do registro** é
conferido dentro de cada módulo. O navegador nunca decide permissão. Trocar um ID ou o endereço de um arquivo não
abre nada que não seja da carteira de quem pede.

| Perfil | Vê e altera |
| --- | --- |
| Administrador | Tudo (supervisão). No WhatsApp, não responde por padrão. |
| Comercial | A própria carteira, mais a fila livre de solicitações do site (o que ainda não é de ninguém). |
| Gerente | A fila de aprovação de descontos (nunca aprova o próprio). Não acessa CRM nem negociações. |
| DHO | Vagas, candidaturas, entrevistas e currículos. Nada comercial. |

O inventário completo de funções e rotas, com o perfil exigido, está em `INVENTARIO-ACESSO.md`. Ele é gerado do código e
conferido pelo teste `tests/seguranca-inventario.test.mjs`.

## Recursos

| Recurso | Regra | Onde é conferida | Prova |
| --- | --- | --- | --- |
| Contatos e oportunidades do CRM | Só do dono; o administrador vê todos; pedir a carteira de outro (`ownerId`) é negado | `crm.server.ts`: `requireCrmContact`, `requireCrmOpportunity`, lista paginada | `crm-core`, `crm-atendimento-filtros`, `seguranca-carteiras` |
| Conversas e busca (inclusive no texto das mensagens) | Só contatos da carteira | `listCrmMessagesPage`, `listCrmContactsPage` (busca "tudo") | `crm-search`, `seguranca-carteiras` |
| Tarefas, etapas, notas e leitura | Pela oportunidade ou pelo contato | `crm.server.ts` | `crm-core`, `seguranca-carteiras` |
| Anexos (enviar, abrir, reenviar) | Contato da carteira; arquivo ainda em preparação só para quem enviou; ID forjado → "não encontrado"; servido com `no-store` e CSP `sandbox` | `crm-media.server.ts` (`authorizedRow`), rotas `api.interno.crm.anexos*` | `seguranca-carteiras` |
| WhatsApp: contexto, fila, vínculo, envio e histórico do contato | Contato da carteira e linha do dono; linha de outro → negado; configurar, sincronizar tudo, reprocessar eventos e cadastrar linhas → só administrador | `crm-waha.server.ts` (`resolveLine`, `commercial`, `administrator`) | `waha-multiusuario`, `seguranca-carteiras` |
| Negociações, proposta, PDF, e-mail e versões | Dono do orçamento; administrador em todos | `orcamentos.server.ts` (`orcamentoDoUsuario`) e rota do PDF | `proposta`, `seguranca-carteiras` |
| Pedido no Omie (revisão, cliente, pedido, status) | Dono do orçamento; o código da revisão fica preso ao mesmo usuário e orçamento | `omie-conversao.server.ts` | `omie-conversao`, `seguranca-carteiras` |
| Descontos | O dono pede e vê; gerente ou administrador decidem | `discounts.server.ts` | `discounts`, `seguranca-carteiras` |
| **Solicitações do site** (pedidos de orçamento e contatos) — **corrigido** | O que é seu (atribuído, convertido em negociação sua ou trazido para uma oportunidade sua) mais a fila livre. Nunca o que é de outro vendedor | `site-leads.server.ts`: listas, detalhe, status e notas, página Leads, busca geral e resumo do painel | `seguranca-carteiras` (falhava antes da correção) |
| Busca geral do painel | CRM, negociações e solicitações dentro da carteira; candidaturas só para administrador e DHO | `panel.server.ts` | `seguranca-carteiras` |
| Contagens e métricas comerciais | Escopo pessoal para o vendedor | `panelCountsCore`, `links-metrics.server.ts` | `seguranca-carteiras` |
| Currículos | Administrador ou DHO, com auditoria de cada download | rota `api.interno.curriculo.$id` | inventário |
| Saúde do sistema, auditoria, integrações, Omie (configuração), usuários | Só administrador | inventário | `saude`, inventário |

## Lacuna encontrada e corrigida (13/11/2026)

As páginas antigas "Orçamentos do site", "Contatos" e "Leads", a busca geral e o resumo do painel mostravam a qualquer
vendedor **todas** as solicitações do site, inclusive as atribuídas a outro vendedor. Também deixavam abrir e mudar status
e notas pelo ID. O CRM já aplicava a regra certa, só o atribuído a quem pede. Agora as duas telas seguem uma regra
única (`site-leads.server.ts`). A matriz `tests/seguranca-carteiras.test.mjs` falha com o código antigo e passa com o
novo.

## Decisões por desenho (não são falhas)

1. **Fila livre visível a todos os vendedores.** Pedidos sem responsável continuam visíveis para que alguém os assuma
   (o fluxo atual de "converter em negociação"). Se a MAG preferir que só o administrador distribua, a troca é uma
   linha em `siteLeadScope`.
2. **Contatos do site sem dono** ("fale conosco") são fila comum do comercial. Quando entram no CRM, passam a ser do
   dono da oportunidade e saem da vista dos outros.
3. **Pedido no Omie:** `gerarPedido` confere primeiro o código da revisão. Esse código é preso ao usuário e ao orçamento
   e só nasce depois da conferência de carteira. O código está congelado desde a homologação do Omie; a negação está
   provada no teste.
4. **Supervisão do administrador:** vê todas as carteiras, inclusive anexos.

## Como manter

- Função de servidor ou rota nova sem classificação faz `seguranca-inventario` falhar. Rode
  `node docs/seguranca/gerar-inventario.mjs` e justifique a função pública, se for o caso.
- Toda função nova que recebe um ID de registro comercial entra na matriz `seguranca-carteiras`, com vendedora A,
  vendedora B, administrador, DHO e gerente.
