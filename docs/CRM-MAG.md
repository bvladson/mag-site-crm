# CRM MAG — módulo comercial integrado

Implementação de 06/11/2026, baseada no protótipo `e1a81f20-511c-4360-8846-57ca83d80595` e nas interações do kit de referência Kommo. A aplicação continua sendo o gerencial existente, com sua autenticação, banco, propostas e integração Omie.

## Uso

O menu Comercial possui a entrada **CRM comercial**, em `/interno/crm`. Suas áreas são Meu dia, Atendimento, Meu funil, Clientes e Propostas. Administradores também acessam Integrações.

- **Meu dia:** oportunidades aguardando resposta, retornos, propostas e entradas do site. Trazer para o CRM é uma operação explícita, idempotente; os protocolos e registros antigos são preservados.
- **Funil:** busca, filtros, cartões, arraste e menu de etapa. Etapas: Novo, Conversando, Orçamento enviado, Fechado e Não fechou. A perda exige motivo e o fechamento exige confirmação.
- **Clientes:** cadastro de contato, empresa como informação do cadastro, telefone, e-mail, cidade, responsável e unidade; ficha com oportunidades e histórico.
- **Atendimento:** mensagens persistidas, leitura separada de resposta, oportunidade selecionável, notas, próxima ação e propostas no contexto.
- **Propostas:** documentos e negociações reais, incluindo os anteriores ao CRM. Criar proposta abre a negociação feita pelo motor MAG; vincular usa registros existentes. PDF, versões, cálculo, estoque, alçadas, envio, recusa, aceite e pedido Omie mantêm suas regras.

Mover para Fechado registra resultado do funil; não aceita PDF, não confirma recebimento e não envia pedido ao ERP. A escrita Omie continua dependendo da configuração operacional e de confirmação explícita no fluxo existente.

## Dados e permissões

Novas tabelas `crm_contacts`, `crm_opportunities`, `crm_lead_links`, `crm_tasks`, `crm_activities`, `crm_quote_links`, `crm_messages` e `crm_message_receipts` são adicionadas ao SQLite próprio. Não existe um segundo banco comercial do Lovable nem persistência operacional em localStorage.

Admin vê as carteiras. Comercial vê os seus contatos/oportunidades/mensagens e propostas. DHO e o perfil Gerente isolado não recebem acesso comercial automaticamente. A autorização revalida conta e perfis no servidor. Revisões impedem sobrescrever contato/oportunidade alterados em outra aba.

Importar solicitação do site respeita a atribuição existente. Pendências sem dono e mensagens institucionais ficam disponíveis para triagem administrativa. Solicitações antigas não são redistribuídas nem convertidas por simples leitura. Para transferir a atribuição de uma solicitação antes da importação, usar o painel existente. A transferência de uma carteira já vinculada a propostas não foi introduzida nesta entrega.

Telefone/e-mail são normalizados e deduplicados dentro da carteira. Conflitos entre contatos distintos exigem revisão. Webhooks preservam IDs externos e não geram nova oportunidade a cada repetição da mesma entrada. WhatsApp procura um contato único pelo número; números compartilhados/ambíguos não são unidos automaticamente.

O protótipo de dados e sua data fixa não são utilizados. Datas de agenda e apresentação usam Fortaleza. As listas do workspace possuem limite explícito de 500 registros por área; a interface informa truncamento. O módulo operacional anterior permanece disponível para histórico completo. A expansão para carteiras maiores deve acrescentar paginação/filtros no servidor antes de aumentar esse limite.

## Canais

`/interno/crm/integracoes` configura destino das entradas, Evolution, formulários Google Ads e Meta Lead Ads. Campos secretos vazios mantêm o valor salvo; a opção de remoção apaga a credencial correspondente. O retorno ao navegador contém somente indicadores de configuração, nunca o valor salvo.

### WAHA — integração preparada na Etapa 1

O conector WAHA Core 2026.10.1/NOWEB foi acrescentado como opção do Atendimento existente, sem segundo CRM. Administração, QR, configuração da responsável e do número de teste, anexos privados e histórico paginado são descritos em [WAHA-ETAPA1.md](WAHA-ETAPA1.md) e no [procedimento operacional](../deploy/waha/README.md). A implementação local e o container isolado foram validados sem pareamento; publicação no gerencial e testes com um número dependem da autorização da Etapa 2. Ao selecionar WAHA, o envio usa esse provedor; Evolution, Google e Meta mantêm a configuração própria. A paginação do histórico do Atendimento ultrapassa o limite anterior de quinhentas mensagens, enquanto os demais limites de listagem do workspace permanecem os existentes.

### Evolution

Informar URL, instância existente e chave, salvar e usar **Configurar recebimento**. Isso configura webhook por instância com o cabeçalho secreto `x-crm-webhook-secret`, sem segredo no endereço. **Conectar WhatsApp** solicita QR/código quando suportado pela instância. **Testar conexão** consulta o estado real.

O envio de texto usa `/message/sendText/{instance}`. O botão permanece indisponível quando não existe conexão. Cada tentativa tem identificador de cliente, fila de saída e proteção contra repetição. Se o provedor não confirmar o resultado, o envio fica incerto e a interface orienta conferir a conversa antes de repetir; não há retentativa automática de envio.

Recebimento aceita mensagens diretas com número resolvido, verifica segredo e instância, ignora grupos/status e deduplica por provedor/instância/ID externo. Mensagens enviadas pelo aparelho aparecem quando o provedor emite o evento correspondente. Recibos entregues/lidos são monotônicos e podem chegar antes da mensagem. Nesta entrega, áudio/imagem/documento/vídeo recebidos ficam como registro indicativo; reprodução, download e envio de mídia pelo CRM são evolução posterior. Histórico completo do aparelho e destinatários LID não resolvidos não são importados automaticamente.

### Google Ads

Configurar o endpoint e a mesma chave no formulário de leads do Google Ads. O servidor valida `google_key`, reconhece `is_test` sem criar cliente e deduplica `lead_id`. Preserva referências de formulário/campanha e respostas disponíveis. Isso não importa tráfego anônimo nem todos os contatos de uma conta Google.

### Meta Lead Ads

Informar ID da Página, token de verificação, segredo do aplicativo, token autorizado da Página e versão Graph compatível. Configurar o aplicativo Meta para evento `leadgen`. O servidor valida o desafio e assinatura HMAC do corpo, aceita a Página configurada e busca respostas via Graph API no servidor. A conta precisa conceder as permissões e o acesso aos leads; salvar campos no gerencial não concede essas permissões.

Rotas: `/api/crm/webhooks/evolution`, `/api/crm/webhooks/google` e `/api/crm/webhooks/meta`. Não colocar dados de candidatos ou canais DHO nessas integrações.

### Processamento

Eventos autenticados são persistidos criptografados em `crm_webhook_events` antes da resposta ao provedor. Worker de 15 segundos retoma entradas após reinício; há retentativas limitadas e tela administrativa de falhas/reprocessamento. O primeiro healthcheck inicia o worker. Entradas recebidas e persistidas sobrevivem a falhas do processo. A recuperação de lacunas enquanto a sessão WhatsApp estava desconectada depende do provedor.

`CRM_DISABLE_WORKER=1` desabilita o processamento automático para homologação/manutenção. Os eventos continuam podendo ser processados explicitamente pelo teste/rotina administrativa. A validação automatizada usa serviços simulados, sem mensagens externas.

## Backup e operação

Credenciais e eventos pendentes usam AES-256-GCM, com chave privada em `SITE_DATA_DIR/security/crm-integrations.key`. A chave faz parte do mesmo diretório de segurança já incluído pelo backup do site. Restaurar SQLite e a chave correspondente juntos. A ausência da chave com dados criptografados existentes causa falha explícita; o sistema não gera uma chave nova silenciosamente.

Auditoria técnica registra operações, IDs e resultados, sem mensagens, telefones ou credenciais. Segredos presentes em certos payloads Evolution são descartados antes da persistência do evento. Falhas do transporte não expõem respostas brutas do provedor na interface.

As integrações são entregues sem credenciais de produção ou canal ficticiamente conectado. A ativação das contas reais é feita em Integrações após configurar a instância e os acessos autorizados. O Frappe foi usado como referência de produto; seu backend não é instalado nem necessário para este módulo.

GA4, investimento das plataformas, ROAS e conversões offline não fazem parte das cinco telas do protótipo integrado. O painel de métricas comercial existente continua disponível. Esses conectores de relatório pertencem à etapa de aquisição e resultados descrita na proposta anterior.

## Validação

- `tests/crm-core.test.mjs`: carteiras, revogação, concorrência, perda/fechamento, tarefas, importação idempotente, propostas reais e persistência após reabrir o banco.
- `tests/crm-integrations.test.mjs`: configuração criptografada, segredos, Google, assinatura Meta, Evolution, duplicidade, recibos antecipados e envio incerto sem repetição.
- Suítes existentes de propostas, orçamento, Omie, descontos, atribuição, administração/MFA, DHO, árvore e CMS.
- Homologação de navegador isolada em `MAG-CRM-INTEGRACAO-20261106/qa`, com contatos e usuários fictícios. Nenhuma mensagem real ou pedido Omie é gerado pela homologação.
