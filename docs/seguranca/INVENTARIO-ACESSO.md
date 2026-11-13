# Inventário de acesso do servidor

Gerado por `node docs/seguranca/gerar-inventario.mjs` a partir do código. Não editar à mão: rode o gerador.
O teste `tests/seguranca-inventario.test.mjs` falha se surgir função pública sem justificativa ou perfil não resolvido.

- Funções de servidor: **171**; públicas por desenho: **16**; rotas de API: **12**.
- O perfil é conferido no servidor (`authorize`). A carteira (dono do registro) é conferida dentro de cada módulo e
  provada nos testes `tests/seguranca-*.test.mjs` (ver `ISOLAMENTO-CARTEIRAS.md`).

## Resumo por perfil exigido

| Perfil exigido | Funções |
| --- | --- |
| admin, comercial | 73 |
| admin | 54 |
| PÚBLICA (sem login) | 16 |
| qualquer perfil do painel | 11 |
| admin, dho | 11 |
| admin, gerente | 3 |
| admin, comercial, gerente | 2 |
| admin, comercial | admin | 1 |

## Funções públicas (sem login) — por desenho

| Arquivo | Função | Método | Motivo e proteção |
| --- | --- | --- | --- |
| auth.functions.ts | login | POST | entrada no painel (limite de tentativas + bloqueio) |
| auth.functions.ts | logout | POST | saída do painel |
| auth.functions.ts | getCurrentUser | GET | lê só a própria sessão |
| careers.functions.ts | listOpenJobs | GET | vagas abertas do site |
| careers.functions.ts | getPublicJob | GET | vaga aberta do site |
| invitations.functions.ts | getInvitationInfo | POST | convite por código de uso único (64 hex, expira em 72 h) |
| invitations.functions.ts | acceptPanelInvitation | POST | aceitar convite: código de uso único + senha forte |
| leads.functions.ts | submitQuoteRequest | POST | formulário do site (anti-robô + limite) |
| leads.functions.ts | submitContactRequest | POST | formulário do site (anti-robô + limite) |
| leads.functions.ts | submitJobApplication | POST | candidatura do site (anti-robô + limite) |
| links.functions.ts | getPublicLinkTree | GET | página pública de links |
| site-content.functions.ts | getPublicSiteContent | GET | conteúdo publicado do site |
| social.functions.ts | getSocialProfiles | GET | perfis oficiais do site (sem tokens) |
| social.functions.ts | getSocialHome | GET | seleção pública de publicações para a home |
| social.functions.ts | getSocialPage | GET | página pública /redes |
| units.functions.ts | getPublicUnits | GET | endereços públicos das unidades |

## Rotas de API

| Arquivo | Métodos | Proteção |
| --- | --- | --- |
| api.crm.webhooks.$provider.ts | GET, POST | webhooks: WAHA com HMAC-SHA512; Evolution/Meta/Google com segredo ou token de verificação (comparação em tempo constante) |
| api.csp-report.ts | GET, HEAD, PUT, PATCH, DELETE, POST | pública: relatório de CSP do navegador (só registra, limite de tamanho) |
| api.health.ts | GET | pública: saúde, sem dados |
| api.internal.link-images.$file.ts | GET | sessão admin |
| api.internal.site-images.$file.ts | GET | sessão admin |
| api.interno.crm.anexos.$id.ts | GET, HEAD | sessão admin/comercial + carteira do contato (requireCrmContact); anexo em preparação só de quem enviou |
| api.interno.crm.anexos.ts | POST | sessão admin/comercial + mesma origem + carteira do contato; limite 7 MB |
| api.interno.curriculo.$id.ts | GET | sessão admin/dho + auditoria de cada download |
| api.interno.orcamentos-internos.$id.proposta.$versao.ts | GET | sessão admin/comercial + orçamento da própria carteira + limite + auditoria |
| api.interno.produtos.$id.ts | GET, POST | sessão admin/comercial; POST (consultar Omie agora) só da própria origem, somente leitura |
| api.interno.produtos.index.ts | GET | sessão admin/comercial (consulta de produtos) |
| api.links.events.ts | POST | pública: eventos de clique da página de links (origem do site + limite de tamanho) |

## Todas as funções de servidor

| Arquivo | Função | Método | Perfil exigido |
| --- | --- | --- | --- |
| admin.functions.ts | getMe | GET | qualquer perfil do painel |
| admin.functions.ts | getDashboard | GET | qualquer perfil do painel |
| admin.functions.ts | listQuotes | GET | admin, comercial |
| admin.functions.ts | getQuote | GET | admin, comercial |
| admin.functions.ts | updateQuote | POST | admin, comercial |
| admin.functions.ts | listContacts | GET | admin, comercial |
| admin.functions.ts | getContact | GET | admin, comercial |
| admin.functions.ts | updateContact | POST | admin, comercial |
| admin.functions.ts | listApplications | GET | admin, dho |
| admin.functions.ts | getApplication | GET | admin, dho |
| admin.functions.ts | updateApplication | POST | admin, dho |
| admin.functions.ts | getResumeUrl | POST | admin, dho |
| admin.functions.ts | listUsers | GET | admin |
| admin.functions.ts | setUserRole | POST | admin |
| admin.functions.ts | createPanelUser | POST | admin |
| admin.functions.ts | resetUserPassword | POST | admin |
| admin.functions.ts | disablePanelUser | POST | admin |
| admin.functions.ts | reactivatePanelUser | POST | admin |
| administration.functions.ts | getAuditLog | GET | admin |
| assignments.functions.ts | getLeadDistribution | GET | admin, comercial |
| assignments.functions.ts | getAssignedLeads | GET | admin, comercial |
| assignments.functions.ts | setLeadAssignment | POST | admin, comercial |
| assignments.functions.ts | setLeadDistribution | POST | admin, comercial |
| assignments.functions.ts | getLeadAssignment | GET | admin, comercial |
| auth.functions.ts | login | POST | PÚBLICA (sem login) |
| auth.functions.ts | logout | POST | PÚBLICA (sem login) |
| auth.functions.ts | getCurrentUser | GET | PÚBLICA (sem login) |
| auth.functions.ts | updateMyPassword | POST | qualquer perfil do painel |
| careers.functions.ts | listOpenJobs | GET | PÚBLICA (sem login) |
| careers.functions.ts | getPublicJob | GET | PÚBLICA (sem login) |
| crm-automacoes.functions.ts | getAutomations | GET | admin |
| crm-automacoes.functions.ts | saveAutomationSwitch | POST | admin |
| crm-automacoes.functions.ts | saveAutomationRule | POST | admin |
| crm-automacoes.functions.ts | setAutomationMode | POST | admin |
| crm-automacoes.functions.ts | previewAutomationRule | GET | admin |
| crm-automacoes.functions.ts | runAutomationsNow | POST | admin |
| crm-catalogo.functions.ts | getOpportunityDraft | GET | admin, comercial |
| crm-catalogo.functions.ts | saveOpportunityDraft | POST | admin, comercial |
| crm-catalogo.functions.ts | createQuoteFromDraft | POST | admin, comercial |
| crm-catalogo.functions.ts | getContactOrders | GET | admin, comercial |
| crm-integrations.functions.ts | getEvolutionConnection | GET | admin, comercial |
| crm-integrations.functions.ts | getCrmConnection | GET | admin, comercial |
| crm-integrations.functions.ts | getCrmIntegrationSettings | GET | admin |
| crm-integrations.functions.ts | saveCrmIntegrationSettings | POST | admin |
| crm-integrations.functions.ts | sendCrmMessage | POST | admin, comercial |
| crm-integrations.functions.ts | prepareCrmEvolutionWebhook | POST | admin |
| crm-integrations.functions.ts | connectCrmEvolution | POST | admin |
| crm-integrations.functions.ts | retryCrmIntegrationEvent | POST | admin |
| crm-waha.functions.ts | getWahaContactCatalog | GET | admin, comercial |
| crm-waha.functions.ts | importWahaContact | POST | admin, comercial |
| crm-waha.functions.ts | getWahaContactContext | GET | admin, comercial |
| crm-waha.functions.ts | bindWahaContactOpportunity | POST | admin, comercial |
| crm-waha.functions.ts | getWahaSettings | GET | admin |
| crm-waha.functions.ts | saveWahaSettings | POST | admin |
| crm-waha.functions.ts | saveWahaLine | POST | admin |
| crm-waha.functions.ts | setWahaLineStatus | POST | admin |
| crm-waha.functions.ts | getWahaConnection | GET | admin, comercial |
| crm-waha.functions.ts | getWahaOutbox | GET | admin, comercial |
| crm-waha.functions.ts | retryWahaRecovery | POST | admin, comercial |
| crm-waha.functions.ts | controlWahaSession | POST | admin, comercial |
| crm-waha.functions.ts | sendWahaMessage | POST | admin, comercial |
| crm-waha.functions.ts | syncWahaHistory | POST | admin |
| crm-waha.functions.ts | syncWahaContactHistory | POST | admin, comercial |
| crm-waha.functions.ts | retryWahaEvent | POST | admin |
| crm.functions.ts | getCrmBootstrap | GET | admin, comercial |
| crm.functions.ts | getCrmContact | GET | admin, comercial |
| crm.functions.ts | getCrmOpportunity | GET | admin, comercial |
| crm.functions.ts | getCrmContactsPage | GET | admin, comercial |
| crm.functions.ts | getCrmTasksPage | GET | admin, comercial |
| crm.functions.ts | getCrmConversationPage | GET | admin, comercial |
| crm.functions.ts | getOpportunityDetail | GET | admin, comercial |
| crm.functions.ts | markConversationRead | POST | admin, comercial |
| crm.functions.ts | createContact | POST | admin, comercial |
| crm.functions.ts | updateContact | POST | admin, comercial |
| crm.functions.ts | createOpportunity | POST | admin, comercial |
| crm.functions.ts | updateOpportunity | POST | admin, comercial |
| crm.functions.ts | moveOpportunity | POST | admin, comercial |
| crm.functions.ts | scheduleTask | POST | admin, comercial |
| crm.functions.ts | completeTask | POST | admin, comercial |
| crm.functions.ts | importSiteLead | POST | admin, comercial |
| crm.functions.ts | linkQuote | POST | admin, comercial |
| crm.functions.ts | previewCrmQuoteLink | GET | admin, comercial |
| crm.functions.ts | createQuoteForOpportunity | POST | admin, comercial |
| discounts.functions.ts | getDiscountPolicy | GET | admin, gerente |
| discounts.functions.ts | setDiscountPolicy | POST | admin |
| discounts.functions.ts | getDiscountQueue | GET | admin, gerente |
| discounts.functions.ts | getQuoteDiscount | GET | admin, comercial, gerente |
| discounts.functions.ts | requestQuoteDiscount | POST | admin, comercial, gerente |
| discounts.functions.ts | decideQuoteDiscount | POST | admin, gerente |
| hr.functions.ts | listJobsAdmin | GET | admin, dho |
| hr.functions.ts | getJobAdmin | GET | admin, dho |
| hr.functions.ts | saveJobAdmin | POST | admin, dho |
| interviews.functions.ts | getInterviewOptions | GET | admin, dho |
| interviews.functions.ts | listInterviews | GET | admin, dho |
| interviews.functions.ts | saveInterview | POST | admin, dho |
| interviews.functions.ts | moveApplicationStage | POST | admin, dho |
| invitations.functions.ts | createPanelInvitation | POST | admin |
| invitations.functions.ts | getPanelInvitations | GET | admin |
| invitations.functions.ts | revokePanelInvitation | POST | admin |
| invitations.functions.ts | getInvitationInfo | POST | PÚBLICA (sem login) |
| invitations.functions.ts | acceptPanelInvitation | POST | PÚBLICA (sem login) |
| leads.functions.ts | submitQuoteRequest | POST | PÚBLICA (sem login) |
| leads.functions.ts | submitContactRequest | POST | PÚBLICA (sem login) |
| leads.functions.ts | submitJobApplication | POST | PÚBLICA (sem login) |
| links-admin.functions.ts | getLinkTreeAdmin | GET | admin |
| links-admin.functions.ts | saveLinkTreeDraft | POST | admin |
| links-admin.functions.ts | publishLinkTree | POST | admin |
| links-admin.functions.ts | restoreLinkTree | POST | admin |
| links-admin.functions.ts | uploadLinkImage | POST | admin |
| links-metrics.functions.ts | getMarketingMetrics | GET | admin |
| links-metrics.functions.ts | getCommercialMetrics | GET | admin, comercial |
| links.functions.ts | getPublicLinkTree | GET | PÚBLICA (sem login) |
| mfa.functions.ts | getMySecurity | GET | qualquer perfil do painel |
| mfa.functions.ts | startMyMfa | POST | qualquer perfil do painel |
| mfa.functions.ts | enableMyMfa | POST | qualquer perfil do painel |
| mfa.functions.ts | disableMyMfa | POST | qualquer perfil do painel |
| mfa.functions.ts | renewMyRecovery | POST | qualquer perfil do painel |
| mfa.functions.ts | revokeMySession | POST | qualquer perfil do painel |
| omie.functions.ts | painelOmie | GET | admin |
| omie.functions.ts | sincronizarOmieAgora | POST | admin |
| omie.functions.ts | confirmarVinculoVendedor | POST | admin |
| omie.functions.ts | removerVinculoVendedor | POST | admin |
| omie.functions.ts | salvarConfiguracaoOmie | POST | admin |
| orcamentos.functions.ts | listarOrcamentosInternos | GET | admin, comercial |
| orcamentos.functions.ts | lerOrcamentoInterno | GET | admin, comercial |
| orcamentos.functions.ts | opcoesDoOrcamento | GET | admin, comercial |
| orcamentos.functions.ts | criarOrcamentoInterno | POST | admin, comercial |
| orcamentos.functions.ts | duplicarOrcamentoInterno | POST | admin, comercial |
| orcamentos.functions.ts | salvarOrcamentoInterno | POST | admin, comercial |
| orcamentos.functions.ts | mudarEstadoOrcamento | POST | admin, comercial |
| orcamentos.functions.ts | atualizarPrevisaoOrcamento | POST | admin, comercial |
| orcamentos.functions.ts | revisarPedidoOmie | POST | admin, comercial |
| orcamentos.functions.ts | buscarClientesNoOmie | POST | admin, comercial |
| orcamentos.functions.ts | vincularClienteOmie | POST | admin, comercial |
| orcamentos.functions.ts | criarClienteNoOmie | POST | admin, comercial |
| orcamentos.functions.ts | gerarPedidoOmie | POST | admin, comercial |
| orcamentos.functions.ts | verificarPedidoOmie | POST | admin, comercial |
| orcamentos.functions.ts | usarEmailDoCadastroOmie | POST | admin, comercial |
| orcamentos.functions.ts | atualizarStatusOmie | POST | admin, comercial |
| panel.functions.ts | searchPanel | GET | qualquer perfil do painel |
| panel.functions.ts | getPanelCounts | GET | qualquer perfil do painel |
| propostas.functions.ts | gerarPropostaComercial | POST | admin, comercial |
| propostas.functions.ts | dadosDeEnvioDaProposta | POST | admin, comercial |
| propostas.functions.ts | marcarPropostaEnviada | POST | admin, comercial |
| propostas.functions.ts | marcarPropostaRecusada | POST | admin, comercial |
| propostas.functions.ts | registrarAcaoDaProposta | POST | admin, comercial |
| propostas.functions.ts | enviarPropostaPorEmail | POST | admin, comercial | admin |
| propostas.functions.ts | lerDadosDaProposta | GET | admin |
| propostas.functions.ts | salvarDadosDaProposta | POST | admin |
| propostas.functions.ts | lerPerfilComercial | GET | admin, comercial |
| propostas.functions.ts | salvarPerfilComercial | POST | admin, comercial |
| propostas.functions.ts | gerenciarVersoesDaProposta | POST | admin, comercial |
| propostas.functions.ts | compararVersoesDaProposta | POST | admin, comercial |
| saude.functions.ts | getSystemHealth | GET | admin |
| site-content-admin.functions.ts | getSiteContentAdmin | GET | admin |
| site-content-admin.functions.ts | saveSiteContentDraft | POST | admin |
| site-content-admin.functions.ts | publishSiteContent | POST | admin |
| site-content-admin.functions.ts | restoreSiteContent | POST | admin |
| site-content-admin.functions.ts | uploadSiteImage | POST | admin |
| site-content.functions.ts | getPublicSiteContent | GET | PÚBLICA (sem login) |
| social-admin.functions.ts | getSocialAdmin | GET | admin |
| social-admin.functions.ts | saveSocialSetting | POST | admin |
| social-admin.functions.ts | createSocialItem | POST | admin |
| social-admin.functions.ts | updateSocialItem | POST | admin |
| social-admin.functions.ts | deleteSocialItem | POST | admin |
| social.functions.ts | getSocialProfiles | GET | PÚBLICA (sem login) |
| social.functions.ts | getSocialHome | GET | PÚBLICA (sem login) |
| social.functions.ts | getSocialPage | GET | PÚBLICA (sem login) |
| units.functions.ts | getPublicUnits | GET | PÚBLICA (sem login) |
| units.functions.ts | getAdminUnits | GET | admin |
| units.functions.ts | saveAdminUnit | POST | admin |
