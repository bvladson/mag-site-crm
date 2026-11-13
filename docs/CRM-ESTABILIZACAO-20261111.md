# MAG CRM — candidata de estabilização de 11/11/2026

## Estado da entrega

As correções estão no projeto local e foram verificadas em banco de teste isolado. Não constituem publicação no gerencial nem atualização do ambiente de homologação antigo da VPS. Google e Meta foram adiados por solicitação do usuário. Responsável e unidade existentes não foram alterados.

O problema de QR no gerencial publicado é de infraestrutura: `mag-site-web-1` participa somente de `mag-site_default`; o conector ativo pertence somente à homologação `mag-whatsapp-hml-20261106`. Não existe `mag-waha-waha-1` ativo em produção. Portanto `http://waha:3000` não resolve um serviço alcançável pelo backend publicado. A credencial salva no backend coincide com a credencial privada preparada para o serviço; responsável e número de teste estão preenchidos e válidos.

Uma prova isolada utilizou a mesma imagem da produção e WAHA Core/NOWEB 2026.10.1 com digest fixado. O backend MAG retornou PNG real de 292 × 292 no estado `SCAN_QR_CODE`. Nenhum aparelho foi pareado, nenhuma mensagem foi enviada e o projeto de prova foi encerrado. Os containers e arquivos de configuração de produção permaneceram iguais.

## Alterações da candidata

- `src/lib/crm.server.ts`, `crm.functions.ts`, `crm.ts`: importações antigas preservam o atendimento atual; cronologia monotônica; pendências independentes das tarefas concluídas; páginas protegidas de contatos/tarefas e detalhes por ID; resumo com uma mensagem por conversa e contagem real de não lidas; vínculo manual de orçamento divergente exige conferência, justificativa e confirmação atualizada.
- `src/lib/crm-waha.server.ts`, `crm-waha.functions.ts`: watermarks duráveis, recuperação independente de webhooks, continuidade por páginas, falhas explícitas, consulta de envios incertos e repetição autorizada da conferência. Primeira conexão, troca de número e reativação começam um novo acompanhamento sem importar passado.
- `src/lib/crm-whatsapp-store.server.ts`: inicialização do atendimento pela cronologia gravada quando páginas antigas chegam depois de respostas recentes; empate exato preserva ordem de ingestão e repetição não reordena mensagens.
- `src/components/interno/crm/{CrmClients,CrmDay,CrmDialogs,CrmInbox,CrmProvider,WahaLinePanel,WahaSettings}.tsx`: paginação, ficha fora do resumo inicial, fila sem oportunidade, carregamento/erro dos diálogos, confirmação de vínculo e recuperação parcial/erro com continuação.
- `tests/crm-readiness.test.mjs`, `tests/waha-recovery.test.mjs`: novas regressões; ajustes de `waha-multiusuario.test.mjs` para o início do acompanhamento e de `waha-noweb.test.mjs` para horários distintos na fixture; `waha-store.test.mjs` cobre empate de horário e repetição.
- `deploy/waha/README.md`: operação e limites atualizados. Nenhum serviço de produção foi criado por essas alterações.

## Verificação

158 testes automatizados passaram: segurança administrativa, carteiras, descontos, convites, orçamento/proposta, CRM, integrações e WAHA. A suíte cobre mais de 500 contatos/tarefas, 620 mensagens com resumo limitado, mais de 100 mensagens numa recuperação, catálogo com 301 conversas e mudança de atividade entre páginas, falhas de chat/anexo, reinício de backend, migração de checkpoint legado e isolamento entre responsáveis. TypeScript e build Node foram verificados.

Nove cenários de navegador passaram em fixtures locais, sem clientes reais: fila de triagem; paginação/busca; ficha e edição fora dos 500 iniciais; oportunidade com cliente predefinido; bloqueio de outra carteira; confirmação de orçamento divergente; indisponibilidade WAHA; QR exibido/renovado/cancelado; recuperação parcial/erro e continuação. O conector desses testes de tela foi simulado; a prova de QR Docker real é separada. Não houve chamadas diretas do frontend ao conector, exposição da chave nas respostas inspecionadas nem envio de mensagem.

## Recursos e preservação

Amostra da VPS em 11/11/2026 às 12:15 (São Paulo): web de produção 209,7 MiB/768 MiB, WAHA de homologação 370,8 MiB/1 GiB e 0,07% de CPU; web de homologação 50,96 MiB/768 MiB. São amostras pontuais, sem teste de carga e sem medição da candidata sob atendimento real. A VPS tinha aproximadamente 3,7 GiB de memória disponível, 29 GiB de disco livre e 1,53 GiB de swap em uso. O limite preparado para um novo conector é 1 GiB/0,5 CPU.

IDs e horários de início dos três containers de produção permaneceram iguais. `.env`, compose e configuração Nginx mantiveram seus hashes. Omie continua com escrita desligada. Backup local mais recente observado: `/srv/mag-site/backups/mag-site-20261111-033502.tar.gz`, 6.195.337 bytes. Não foi executada restauração de uma conta WhatsApp pareada nesta revisão.

## Pendências e implantação

1. A ativação do conector privado no endereço de produção requer autorização explícita, pois a autorização anterior restringia a Etapa 2 ao ambiente isolado. Isso pode corrigir a comunicação sem publicar a candidata: manter a imagem atual, preparar sessão vazia preservando os arquivos anteriores, iniciar WAHA sem porta pública e anexar somente o web à rede privada dedicada. Preservar responsável/unidade/sessão/número configurados. Não parear automaticamente.
2. Publicar a candidata exige aprovação separada e execução do procedimento de release existente com backup, validação e rollback. Primeiro homologar a imagem Linux com as alterações em projeto Docker isolado; não reutilizar dados reais nem a instância de uma conta já conectada.
3. Homologar com os números de teste já autorizados: conexão final 7035 e destinatário final 2000. Conferir texto, imagem, áudio, documento, mensagens enviadas pelo celular, ACKs, reconexão, indisponibilidade do backend, continuidade e ausência de duplicação. Não usar o número principal da MAG nem habilitar escrita Omie.
4. Antes da operação definitiva, validar responsável/unidade atuais, backup e restauração da sessão de teste, retenção, monitoramento e decisão sobre o número definitivo.

Limites: catálogo WAHA percorrido linearmente e paginado por offset; remoções concorrentes ainda podem deslocar páginas. Histórico anterior à conexão pode estar incompleto. Falha de anexo após ingestão do texto pode reduzir a precisão do contador, sem apagar a mensagem e mantendo pendência visível. O mesmo ID de solicitação de site continua permitindo o vínculo automático legado do orçamento. Resolução assistida de identidade LID e transferência de carteira não foram acrescentadas nesta candidata.

Não é possível afirmar operação “100%” antes de validar o ciclo com aparelho e a candidata Linux. A correção da comunicação de produção e a publicação das melhorias são decisões distintas.
