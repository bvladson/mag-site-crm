# MAG CRM + WAHA — relatório da Etapa 1

**Data:** 06/11/2026. **Resultado:** implementação preparada e validada localmente; conector real validado em Docker isolado na VPS, sem conta WhatsApp autenticada. **A integração não foi publicada no gerencial de produção. Nenhum número foi pareado.**

O trabalho preserva o MAG CRM como única interface da vendedora. A responsável fica como configuração administrativa, sem nome fixado no código, e pode permanecer pendente até a homologação. Publicação e pareamento dependem de autorização explícita, conforme a tarefa. Não há Frappe, Chatwoot ou outro painel instalado para atendimento.

## Auditoria e decisões

O código inspecionado corresponde à aplicação em `C:\Users\VLADSON\Downloads\SITE MAGMOVEIS INSTITUCIONAL`. A release ativa consultada é `/opt/mag-site/releases/20261106-crm-mag-v2`; hashes de seus fontes foram comparados com os arquivos locais para produzir o inventário final. O snapshot local inicial também foi preservado. O projeto não possui metadados Git utilizáveis nessa pasta; a revisão utiliza snapshots e hashes SHA-256.

| Área existente | Estrutura identificada e preservada |
| --- | --- |
| CRM | Rotas autenticadas sob `/interno/crm`; `CrmProvider`, funções servidor e SQLite próprio. |
| Atendimento | `CrmInbox`, `crm_messages`, recibos, leitura e pendências comerciais. O compositor existente foi ampliado. |
| Clientes | `crm_contacts`, dados normalizados, revisões e acesso por carteira validado no servidor. |
| Oportunidades | `crm_opportunities`, tarefas, atividades e vínculos; etapas do funil continuam independentes de aceitação de proposta e de escrita Omie. |
| Integrações | Evolution, Google Ads e Meta Lead Ads, com configuração e fila criptografadas próprias. WAHA fica separado para preservar compatibilidade e reversão. |
| Comercial/Omie | Orçamentos, descontos, cálculo, PDFs/versionamento, alçadas e conversão de pedido existentes. Seus arquivos de regras não foram substituídos. |
| VPS | Docker/Compose, Nginx e serviços MAG `web`, `omie-consulta`, `omie-pedidos`; aplicação somente em loopback pelo proxy existente. Outros projetos também estão na VPS. |
| Segurança | Sessão MAG e perfis atuais; administradores configuram o conector, comercial utiliza sua carteira; DHO não recebe acesso comercial. |

A estratégia aplicada foi aditiva: adaptador WAHA no backend, persistência de mensagens no banco MAG, identidade/conversa vinculada a contato e oportunidade, mídia privada e container independente. A bridge WAHA não publica API no host e ainda não está conectada ao `web` de produção. O Nginx de produção não foi alterado. O limite atual de request de 8 MiB foi respeitado com arquivos de até 7 MiB.

## Funcionalidades implementadas

- Administração no próprio `/interno/crm/integracoes`: habilitar provedor, URL/sessão, responsável, número de teste, credencial, iniciar, QR, consultar estado, reconectar, configurar recebimento, sincronizar histórico e reprocessar eventos com falha. Estados e erros são apresentados em português.
- Chamadas WAHA autenticadas exclusivamente pelo backend. O navegador não recebe a chave salva nem chama diretamente o conector.
- Fila de webhook durável e criptografada, assinatura HMAC SHA-512 do corpo bruto, limite de tamanho, validação de sessão e tipos de evento. Processamento com tentativas limitadas e retomada após reinício.
- Mensagens recebidas, respostas no CRM e eventos de mensagens enviadas pelo celular convergem para o histórico MAG. IDs externos, recibos monotônicos e chave de idempotência evitam duplicação. Envios sem confirmação ficam incertos e não são reenviados automaticamente.
- Contato associado à responsável configurada; oportunidade aberta existente é reaproveitada. Sem oportunidade, uma mensagem recebida ao vivo pode abrir uma entrada comercial. Múltiplas oportunidades exigem escolha explícita no Atendimento; grupos, status e canais são ignorados.
- Texto, imagem, áudio por arquivo e documentos no compositor existente. Anexos ficam fora da área pública, com leitura por sessão/carteira, integridade SHA-256, HEAD e Range para reprodução. Downloads do WAHA não seguem URLs arbitrárias nem redirecionamentos.
- Histórico do Atendimento paginado em lotes de cinquenta mensagens, sem o bloqueio anterior de quinhentas. Histórico do conector usa continuidade persistida, catálogo com paginação além de cem chats, janela temporal estável e até dez mensagens de uma conversa por chamada. Duplicados não são contados como novos.
- Importação histórica não cria oportunidades, pendências de leitura ou alterações de etapas/última interação. LIDs não resolvidos e conflitos são preservados para revisão, sem transformar identificador oculto em telefone.
- Configuração, fila e outbox WAHA separadas das integrações anteriores, usando AES-256-GCM e chave `data/security/crm-waha.key`. Ausência da chave de um banco existente causa falha explícita.

## Container, serviços e recursos

Imagem fixada:

```text
devlikeapro/waha:noweb-2026.10.1@sha256:0d64cce14a922f61bb9a620474086d1f5695f2522e7e1088704e6eca3a085d0c
```

A API da imagem real confirmou **2026.10.1, NOWEB, CORE, linux/x64**, sem navegador Chromium. A edição Core escolhida disponibiliza os recursos de mídia necessários nesta versão; nenhuma licença Plus foi adicionada. [Release oficial](https://github.com/devlikeapro/waha/releases/tag/2026.10.1) e [informações da edição](https://waha.devlike.pro/docs/how-to/waha-plus/).

| Item | Medição/configuração |
| --- | --- |
| Projeto isolado criado | `mag-waha-stage-20261106` |
| Diretório | `/opt/mag-waha-stage-20261106` |
| Container | `mag-waha-stage-20261106-waha-1` |
| Rede | `mag-whatsapp-stage-20261106`, separada da rede MAG; API sem portas publicadas |
| Estado final | **Parado**; zero sessões autenticadas; arquivos e imagem mantidos para revisão |
| RAM final ociosa | **285,5–285,7 MiB**, quatro amostras da versão final do compose |
| CPU final ociosa | **0,09–0,24%**, conforme `docker stats` |
| Processos | 17 PIDs nas quatro amostras |
| Janela das amostras | 06/11/2026, 15:11:08–15:11:27 UTC |
| Limites do conector | 1 GiB RAM, 0,5 CPU, 192 PIDs; heap Node 512 MiB e tmpfs 128 MiB |
| Tamanho Docker da imagem | 757.415.708 bytes, aproximadamente 722,3 MiB, sem considerar compartilhamento de camadas |
| Endurecimento | UID/GID 65532, raiz somente leitura, capabilities removidas, sem novos privilégios; dashboard/Swagger desativados, QR fora dos logs |
| Persistência | Sessões em `data/sessions`; mídias em `data/media`, com `WHATSAPP_FILES_FOLDER=/app/.media`; cache de mídia 24 horas |

Esses números representam o conector **ocioso e sem número pareado**, não consumo sob atendimento real. Uma execução preliminar registrou cerca de 310 MiB; os valores da tabela vêm da execução final, após corrigir o destino das mídias. Não foi medida a carga real do backend MAG com uma conta conectada. A imagem ocupa disco mesmo com o container parado.

Os três containers MAG permaneceram saudáveis, com os mesmos IDs e horários de início antes/depois dos testes. Os hashes de compose, `.env`, Nginx e scripts de backup/restore instalados na VPS permaneceram iguais. Os scripts MAG modificados existem apenas no projeto local; não foram instalados em produção. Nenhuma escrita Omie foi habilitada.

## Testes executados

| Validação | Resultado e limites |
| --- | --- |
| Build de produção local | Aprovado com preset `node-server`; nova árvore de rotas gerada. |
| TypeScript | `tsc --noEmit --pretty false`, sem erros. |
| Backend e regressões | **169 testes aprovados**, zero falhas: CRM, integrações existentes, WAHA, carteiras/atribuições, descontos, orçamento, proposta/PDF, Omie, árvore de links e CMS. |
| SSR público | **4 testes aprovados**, zero falhas: páginas públicas/dados privados, CMS, árvore v2 e JSON-LD hostil. Total: **173 testes automatizados distintos**. |
| Reexecução após consolidação | Os **47 testes CRM/integrações/WAHA** foram repetidos após a formatação/consolidação e passaram. Já estão incluídos nos 169, não são testes distintos adicionais. |
| WAHA específico | 28 testes entre armazenamento e transporte: deduplicação, ACK antecipado, carteira, histórico acima de 500 mensagens e catálogo com 101 conversas, retomada após falha, contexto, LID, mídias, validação de sessão e perda da chave. |
| Navegador local | **11 cenários aprovados**, zero erros JavaScript, sem chamada direta do browser ao conector. App MAG real com banco sintético e servidor WAHA artificial em loopback. |
| Container real isolado | Health aprovado; API versão correta; sessões retornam lista vazia; sem chave retorna 401; dashboard/Swagger 404; sem porta publicada. |
| Backup e restore do conector | Aprovados; arquivo privado 0600, gzip íntegro, restauração offline em novo diretório e hashes iguais para credencial, configuração e arquivo de prova persistente. |
| Persistência | Arquivo de prova preservado após reinício do container; banco, configurações e anexos sintéticos preservados após reinício do app local. Recuperação de sessão autenticada ainda não testada. |

No navegador foram exercitados: salvar sem responsável e bloquear operação; QR artificial e estado conectado; paginação/contexto; envios de texto/PDF/imagem/voz; 401 anônimo, 403 DHO/outra carteira, 200 responsável/admin nos anexos; HEAD/Range 206; origem externa bloqueada; HMAC e evento repetido com uma entrada comercial; envio incerto sem repetição; falha de conexão; reprocessamento administrativo; telas de 320/390 pixels; persistência após reinício.

O backup real testado está em `/opt/mag-waha-stage-20261106/backups/waha-20261106-120444.tar.gz`; a cópia restaurada offline em `offline-restored-verified` não foi iniciada. Ele contém dados de prova e credencial do serviço de teste, **nenhuma sessão WhatsApp autenticada**. Os scripts operacionais MAG que incluem `crm-media` foram revisados localmente; o backup/restore completo da aplicação de produção não foi executado nesta etapa.

## Arquivos alterados e artefatos

O inventário exato, incluindo tipo de alteração e hashes antes/depois em comparação com a release ativa, está em `MAG-WAHA-ETAPA1-20261106/changed-files.json`. Nenhum arquivo da release foi removido. `waha-reviewable-changes.zip` contém somente os arquivos modificados/adicionados e o inventário; `source-after.tar.gz` preserva os fontes completos selecionados. Dados, `.env` e credenciais da VPS não são incluídos nesses pacotes de código.

| Grupo | Arquivos |
| --- | --- |
| Transporte WAHA | `src/lib/crm-waha.server.ts`, `src/lib/crm-waha.functions.ts` |
| Identidade e vínculo | `src/lib/crm-whatsapp-store.server.ts` |
| Mídia/HTTP privado | `src/lib/crm-media.server.ts`, `src/lib/crm-http.server.ts`, `src/routes/api.interno.crm.anexos.ts`, `src/routes/api.interno.crm.anexos.$id.ts` |
| Extensões do CRM | `src/lib/crm.ts`, `src/lib/crm.server.ts`, `src/lib/crm.functions.ts`, `src/lib/crm-integrations.functions.ts` |
| Webhook/worker/rotas | `src/routes/api.crm.webhooks.$provider.ts`, `src/server.ts`, `src/routeTree.gen.ts` |
| Interface existente | `src/components/interno/crm/CrmInbox.tsx`, `CrmIntegrations.tsx`, `CrmProvider.tsx`, novos `WahaSettings.tsx` e `MessageMedia.tsx` |
| Docker e recuperação | `deploy/waha/compose.yaml`, `mag-site.override.yaml`, `prepare.py`, `backup.sh`, `restore.py`, `README.md`; `deploy/srv/backup.sh` e `restore.sh` |
| Testes | `tests/waha-store.test.mjs`, `tests/waha-transport.test.mjs` |
| Orientação e documentação | `AGENTS.md`, `docs/CRM-MAG.md`, este relatório e `docs/WAHA-REVISAO-ETAPA1.md` |

Evidências locais em `C:\Users\VLADSON\Downloads\MAG-WAHA-ETAPA1-20261106`:

- `regression-final.log`, `ssr-regression.log`, `crm-consolidated-final.log`, `typescript-final.log` e `build-final.log`.
- `qa/latest-results.json`, `qa/README.md`, `qa/browser-final.log` e capturas da execução final `qa/run-RQARfS`.
- `waha-container-report.json` (primeira execução), `waha-recovery-report.json` e `waha-final-report.json` (configuração final).
- `production-source-hashes.json`, `changed-files.json`, snapshots e pacote de revisão.

As pastas de QA contêm somente banco/usuários/mensagens artificiais. Não reutilizar contas, senhas, sessões ou chaves de teste em produção.

## Pendências, riscos e Etapa 2

1. **Autorização explícita de publicação:** a versão do MAG em produção continua a anterior. Antes de instalar a release e o override, aprovar a implantação e preservar backup/reversão. A etapa de implementação local foi concluída; a operação real ainda não foi homologada.
2. **Responsável e aparelho de teste:** definir uma usuária ativa no gerencial e o número autorizado. Fazer o pareamento somente com esse aparelho; o backend bloqueia operações se o número reportado divergir. O número principal da MAG não participa dessa etapa.
3. **Matriz real:** enviar/receber texto, imagem, áudio e PDF; responder pelo celular e conferir uma cópia no MAG; confirmar contatos, responsável, contexto, Kanban e ACKs. Testar rede indisponível, API recusando chave, reinício, reconexão e timeout sem duplicação. A conversão/qualidade do áudio precisa de validação real.
4. **Histórico e conta autenticada:** testar o histórico efetivamente disponibilizado, várias páginas/conversas, formatos brasileiros de telefone e LIDs. Não prometer recuperação integral anterior à conexão. Sessões sem store prévio exigem nova preparação controlada.
5. **Recuperação completa:** repetir backup/restore com número de teste autenticado, original parado e cópia offline; conferir também o pacote MAG com SQLite, chave WAHA e anexos correspondentes. Nunca iniciar duas cópias da mesma sessão. Recuperação de arquivo não garante aceitação da autenticação pelo WhatsApp.
6. **Capacidade e monitoramento:** medir RAM/CPU/disco com sessão e mídias reais; definir alertas para desconexão, fila com erro, disco e backup. Healthcheck e estados no painel já existem; agendamento de backup e alertas externos não foram alterados na VPS.
7. **Retenção/LGPD:** definir prazos e rotina de limpeza de anexos preparados e abandonados, eventos concluídos e outbox. A deduplicação deve continuar válida após limpeza. Não foi adicionada exclusão automática sem política aprovada; planejar capacidade e backups externos criptografados antes de operação prolongada.
8. **Identidades excepcionais:** números compartilhados, conflito entre contatos/carteiras e LID não resolvido precisam de revisão assistida. Não há fusão silenciosa nem fluxo complexo de distribuição; a ferramenta administrativa completa de reconciliação permanece fora desta entrega inicial.
9. **Dependência do conector:** WAHA/NOWEB depende de protocolo do WhatsApp Web e pode sofrer logout, mudanças de compatibilidade e restrições da conta. O adaptador está isolado, mantendo possível a migração futura para a API oficial; essa migração exigirá desenvolvimento e homologação próprios. Usar primeiro o número de teste, como previsto na tarefa.

O procedimento completo de preparação, variáveis, backup, restauração e retorno à release anterior está em [deploy/waha/README.md](../deploy/waha/README.md). A revisão independente e suas fontes estão em [WAHA-REVISAO-ETAPA1.md](WAHA-REVISAO-ETAPA1.md).
