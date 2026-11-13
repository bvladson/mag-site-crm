# Revisão independente da integração WAHA — Etapa 1

Data: 06/11/2026. Revisão estática do código local, em paralelo à implementação. Este revisor não acessou a VPS, não publicou arquivos, não pareou número e não executou testes de entrega pelo WhatsApp. A única alteração feita pelo revisor foi este documento. Os resultados de testes e de infraestrutura devem ser consultados no relatório principal da etapa.

## Escopo

- Transporte e configuração: `src/lib/crm-waha.server.ts` e `src/lib/crm-waha.functions.ts`.
- Identidade, contato e oportunidade: `src/lib/crm-whatsapp-store.server.ts`.
- Armazenamento privado: `src/lib/crm-media.server.ts`.
- HTTP: `src/lib/crm-http.server.ts`, `src/routes/api.interno.crm.anexos.ts` e `src/routes/api.interno.crm.anexos.$id.ts`.
- Infraestrutura local preparada: arquivos em `deploy/waha/`.
- Consulta ao código oficial do WAHA na tag `2026.10.1` para confirmar compatibilidade de parâmetros.

## Achados comunicados e corrigidos no código local

| Achado inicial | Consequência | Situação observada na revisão |
| --- | --- | --- |
| Volume `/app/.media` montado sem `WHATSAPP_FILES_FOLDER` | O WAHA gravaria no default `/tmp/whatsapp-files`, fora do volume persistente e do backup; neste compose o diretório é temporário. | Compose agora define `WHATSAPP_FILES_FOLDER: /app/.media`. Validar o caminho real na homologação do container final. |
| QR potencialmente impresso pelo próprio conector | O QR poderia permanecer no log operacional. | Compose agora define `WAHA_PRINT_QR: "false"`; `debug` da sessão é desativado. |
| Webhook padrão apontava para `mag-crm`, sem esse alias no override | Eventos não chegariam ao backend MAG pela rede Docker preparada. | Default alterado para `http://web:3000/api/crm/webhooks/waha`; existe configuração por `MAG_WAHA_WEBHOOK_URL`. |
| Nome de sessão aceitava ponto e até 80 caracteres | O CRM aceitaria uma configuração recusada pelo DTO do WAHA 2026.10.1. | Ambos os schemas agora limitam a 54 caracteres e a letras, números, hífen e sublinhado. |
| Sincronização só consultava os primeiros 100 chats e somava duplicados como novos | Histórico parcial sem continuidade do catálogo e contagem enganosa. | Há checkpoint de catálogo, paginação de chats, janela de tempo para mensagens, uma conversa por chamada, até 10 mensagens por lote e contagem apenas de novas mensagens. |
| Conversão de imagens usava o limite alto padrão do Sharp | Arquivo comprimido pequeno poderia exigir muita RAM no backend. | Conversão local agora limita a 25 milhões de pixels e redimensiona para no máximo 2560 × 2560, sem ampliar. |
| Áudio com texto tratado como legenda | O CRM poderia registrar texto que a operação de voz não entregaria. | Envio de áudio com texto agora é recusado antes da criação da outbox, com orientação para mensagens separadas. |

Correção observada em arquivo local não equivale à homologação real de uma sessão conectada. Confirmar os resultados no conjunto final de testes da etapa.

## Controles identificados

O webhook exige HMAC SHA-512 do corpo bruto, limita o tamanho, verifica sessão e evento e grava payload criptografado em fila separada das integrações anteriores. IDs externos e chaves de envio sustentam a idempotência. O envio incerto não recebe tentativa automática, evitando duplicação após timeout.

A resolução de identidade distingue telefone de LID. Conflitos de identidade entram em triagem; a escolha de oportunidade exige uma oportunidade aberta do mesmo contato. Histórico não deve criar nova oportunidade nem alterar a pendência comercial. Não identifiquei, por leitura do código revisado, uma rota que autorize o acesso a outra carteira usando apenas um ID informado pelo cliente.

Os anexos exigem sessão ativa e perfil `admin` ou `comercial`, com autorização de carteira no serviço de mídia. O POST verifica a origem, lê no máximo 8 MiB do multipart e aceita um arquivo de até 7 MiB. Tipo informado e assinatura do arquivo são confrontados; nomes e IDs não são usados como caminhos arbitrários. Os arquivos ficam fora da área pública. GET/HEAD verificam autorização e integridade; Range é validado. Respostas incluem `private, no-store` e `nosniff`; documentos são entregues como download e recebem CSP restritiva.

Downloads do conector aceitam somente o host configurado ou alias local explicitamente reescrito, sob `/api/files/`, e recusam redirecionamento. As chamadas autenticadas ao WAHA são feitas no backend. O compose não publica porta da API no host, usa usuário sem privilégio, raiz somente leitura, limites de recursos e volumes separados.

Esses controles foram identificados por inspeção estática. A ausência de um achado nesta revisão não substitui os testes automatizados, testes de navegador e homologação real.

## Limitações e prioridades para a Etapa 2

1. **Homologação com número de teste:** confirmar QR, envio e recebimento de texto/imagem/áudio/documento, ACKs, mídia enviada pelo celular, reconexão e comportamento após reiniciar o conector. Definir previamente a responsável e o telefone autorizado.
2. **Persistência e recuperação:** testar o volume de sessões e o diretório efetivamente usado para mídias; restaurar backup offline em diretório novo. Nunca iniciar duas cópias da mesma sessão. Banco MAG, `data/security/crm-waha.key` e anexos privados precisam de backup coerente.
3. **Retenção e capacidade:** não identifiquei rotina de expiração de uploads preparados e abandonados, nem limpeza programada de eventos concluídos e outbox. Definir prazos, capacidade e política LGPD antes de uma operação prolongada. A deduplicação precisa continuar válida quando houver limpeza.
4. **Carga real:** os limites de arquivo e de imagem reduzem consumo; ainda é necessário medir RAM, CPU e disco com a sessão conectada, conversas e anexos reais. Não extrapolar medições ociosas para carga comercial.
5. **Histórico e identidade:** o conector pode disponibilizar apenas parte do histórico anterior. Confirmar paginação em várias conversas, LIDs, múltiplas oportunidades e numeração brasileira com dados de teste representativos.
6. **Operação:** validar credencial inválida, API indisponível, evento que esgota tentativas, envio incerto e recuperação administrativa, preservando os controles já existentes de proposta e Omie.

## Fontes oficiais consultadas

- [WAHA 2026.10.1 — configuração do armazenamento local](https://raw.githubusercontent.com/devlikeapro/waha/2026.10.1/src/core/media/local/MediaLocalStorageConfig.ts): reconhece `WHATSAPP_FILES_FOLDER`, com default `/tmp/whatsapp-files`, e lifetime padrão de 180 segundos.
- [WAHA 2026.10.1 — configuração do engine](https://raw.githubusercontent.com/devlikeapro/waha/2026.10.1/src/core/config/EngineConfigService.ts): `WAHA_PRINT_QR` é reconhecido e seu default é verdadeiro.
- [WAHA 2026.10.1 — validação de sessão](https://raw.githubusercontent.com/devlikeapro/waha/2026.10.1/src/nestjs/validation/SessionName.ts): limite derivado de 64 menos o prefixo `waha_noweb` e caracteres permitidos.
- [Armazenamento de mídia](https://waha.devlike.pro/docs/how-to/storages/): persistência requer tanto o volume quanto a configuração do diretório.
- [Autenticação HMAC dos eventos](https://waha.devlike.pro/docs/how-to/events/#hmac-authentication): assinatura SHA-512 do corpo bruto e cabeçalhos do webhook.

