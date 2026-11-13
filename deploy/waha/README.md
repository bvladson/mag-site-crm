# WAHA no MAG CRM — operação e recuperação

Preparação da Etapa 1, de 06/11/2026. A aplicação atual continua sendo a única interface da vendedora. Este diretório **não é um segundo CRM** e sua presença não autoriza implantação em produção. A publicação e o pareamento de um número de teste pertencem à Etapa 2, após autorização explícita.

## Versão e isolamento

```text
devlikeapro/waha:noweb-2026.10.1@sha256:0d64cce14a922f61bb9a620474086d1f5695f2522e7e1088704e6eca3a085d0c
```

Engine NOWEB, edição CORE. O digest do manifesto é fixado junto à tag. Não trocar por `latest`. A imagem amd64 resolvida na VPS foi `sha256:1a3e76d91455789f2147a8340c87904e7cfe70937634132f070e07105294ba49`. A API de versão do container confirmou 2026.10.1, NOWEB e CORE.

O compose não publica portas no host; a API só participa da bridge `mag-whatsapp`, que mantém saída para a internet. Dashboard e Swagger são desativados. O backend `web` da MAG será anexado à mesma rede pelo override **somente na implantação autorizada**. Omie e outros serviços não precisam participar dessa rede. Não criar proxy Nginx para a API WAHA.

Limites iniciais: 1 GiB de RAM, 0,5 CPU e 192 processos; heap Node de 512 MiB e `/tmp` de 128 MiB. Usuário 65532, raiz somente leitura, sem capabilities e sem novos privilégios. Reinicialização automática em falha do processo, com `unless-stopped`; `unhealthy` é um sinal de diagnóstico e não provoca reinicialização sozinho.

## Configuração fora do código

| Local/variável | Uso |
| --- | --- |
| `/opt/mag-whatsapp/secrets/api-key` | Chave aleatória em arquivo privado 0600; utilizada pelo healthcheck e provisionamento administrativo. Nunca publicar ou incluir em commit. |
| `secrets/waha.env`: `WAHA_API_KEY=sha512:…` | Hash da chave aceito pelo WAHA, gerado por `prepare.py`. |
| `WAHA_PROJECT_NAME` | Nome do projeto Docker; default `mag-waha`. |
| `WAHA_NETWORK_NAME` | Nome da bridge; default `mag-whatsapp`. Deve coincidir no override MAG. |
| `WHATSAPP_DEFAULT_ENGINE=NOWEB` | Engine fixada. |
| `WHATSAPP_FILES_FOLDER=/app/.media` | Destino real das mídias, montado em `data/media`. |
| `WHATSAPP_FILES_LIFETIME=86400` | Cache de mídia do conector por 24 horas; a MAG copia os anexos recebidos para armazenamento próprio. |
| `WAHA_PRINT_QR=false` | Evita gravar o QR nos logs do conector. |
| `WAHA_DASHBOARD_ENABLED=false`, `WHATSAPP_SWAGGER_ENABLED=false` | Desabilitam os painéis do conector. |
| `MAG_WAHA_WEBHOOK_URL` no backend MAG | Opcional: URL interna completa; default `http://web:3000/api/crm/webhooks/waha`. |
| `SITE_DATA_DIR` existente no backend | Contém SQLite, chave MAG e anexos privados. Preservar o volume atual. |
| `CRM_DISABLE_WORKER=1` | Somente testes/diagnóstico: suspende os workers. Não usar na operação normal. |

No painel MAG `/interno/crm/integracoes`, o administrador configura URL interna `http://waha:3000`, nome de sessão, responsável, número de teste autorizado e credencial. O HMAC é gerado no backend quando necessário. As credenciais ficam criptografadas em `crm_waha_config`, com AES-256-GCM e chave `data/security/crm-waha.key`; a leitura administrativa devolve apenas indicadores de configuração. Os campos de senha vazios mantêm o segredo existente.

É permitido salvar sem responsável e sem número nesta etapa. Iniciar, reconectar, sincronizar, enviar e processar mensagens exigem uma responsável ativa e número autorizado. Sessão: letras, números, `_` e `-`, até 54 caracteres; uma sessão inicial sugerida é `mag-teste`. Uma sessão conectada com número diferente é bloqueada no CRM. A conferência ocorre depois do pareamento; o operador deve conferir o aparelho antes de escanear.

## Sequência para a Etapa 2 autorizada

1. Fazer backup da release e dos dados MAG antes da publicação. Registrar tag anterior e hashes, usuários/roles e configuração Omie. Não habilitar escrita Omie durante homologação.
2. Copiar o conteúdo deste diretório para `/opt/mag-whatsapp`, separado de `/opt/mag-site`. Executar `python3 prepare.py /opt/mag-whatsapp` como administrador. O comando cria as pastas e credenciais sem imprimi-las.
3. Validar `docker compose config --quiet` e iniciar **apenas o conector** com `docker compose up -d --wait waha`. Conferir digest, engine, edição, health e ausência de portas publicadas.
4. Publicar a nova release MAG pelo procedimento existente, aplicando também `mag-site.override.yaml` ao serviço `web`. Conservar os dois arquivos no comando de compose usado pelo deploy e por futuras operações. Não anexar os serviços Omie à rede WAHA. Instalar também as versões atualizadas dos scripts MAG `deploy/srv/backup.sh` e `restore.sh`, que agora incluem `crm-media`.
5. No MAG, habilitar WAHA e salvar a URL privada, credencial, responsável e **número de teste**. A transferência da credencial do arquivo privado para o formulário deve ocorrer por canal administrativo protegido. Não colocá-la em URL, print, log ou conversa.
6. Usar **Iniciar sessão** para preparar o NOWEB com `store.enabled=true` **antes do QR**. `fullSync=false` é o default. Uma sessão já pareada sem store é recusada para evitar prometer histórico inexistente.
7. Visualizar QR no próprio MAG e parear exclusivamente o aparelho de teste. Confirmar estado Conectado e número correto. O CRM configura `message.any`, `message.ack` e `session.status`, assinatura HMAC SHA-512 e tentativas de webhook.
8. Executar a matriz real descrita no relatório da etapa. Só considerar migração do número principal depois de validar os resultados e receber autorização específica. O número principal não deve participar desta homologação.

## Atendimento e diagnóstico

Recebimento: webhook autenticado → fila criptografada → resolução de identidade → contato da carteira configurada → oportunidade aberta vinculada → mensagem MAG → cópia privada do anexo. Eventos são idempotentes por mensagem externa; vários eventos não devem produzir vários leads. Há até cinco tentativas de processamento com espera progressiva; falhas aparecem no painel e podem ser reprocessadas administrativamente.

Envio: composer existente → backend autenticado → outbox com chave de idempotência → WAHA → histórico MAG. Timeout ou resposta sem confirmação mantém envio **incerto**, sem reenvio automático. Conferir a conversa no aparelho antes de um novo envio deliberado. `message.any` também importa mensagens enviadas pelo celular; ACKs atrasados não rebaixam status já confirmado.

Anexos: um arquivo por mensagem, até 7 MiB. Imagens, áudio por upload, PDF/documentos permitidos. PNG/GIF/WebP enviados são convertidos em JPEG para compatibilidade; limite de 25 milhões de pixels e dimensão final de até 2560 × 2560. Áudio usa a conversão de voz do conector; texto e áudio devem ser enviados em mensagens separadas. Gravação pelo microfone e vídeo não fazem parte desta etapa. O Nginx atual limita requests a 8 MiB; o limite de arquivo e o multipart respeitam esse teto.

Histórico: **Sincronizar histórico disponível** processa um lote e salva continuidade. Cada chamada percorre uma página do catálogo de chats e até dez mensagens de uma conversa; repetir enquanto houver continuidade. O catálogo não fica limitado aos primeiros cem chats. A janela temporal é fixada durante a paginação. Duplicados não contam como novos; importação antiga não cria oportunidades, pendências de leitura ou mudanças de etapa. Ao concluir uma passagem, a próxima inicia nova conferência idempotente. A UI carrega o histórico MAG por páginas de cinquenta mensagens, inclusive acima de quinhentas.

Múltiplas oportunidades abertas exigem escolher o contexto no Atendimento. Identidade LID não resolvida ou conflitante bloqueia envio e não gera lead automático; sua resolução administrativa não deve fundir contatos silenciosamente. Não alterar telefone/carteira no banco para contornar a triagem. Reconciliação manual assistida de conflitos permanece pendente.

## Backup e recuperação

Há dois conjuntos complementares:

- **Conector:** compose, `.env` opcional, credenciais e `data/sessions` + `data/media`. Executar `sh backup.sh /opt/mag-whatsapp /srv/mag-site/backups`. O script para somente o WAHA enquanto empacota, verifica gzip, aplica 0600 e retoma o serviço se estava ativo. Essa breve indisponibilidade não para a MAG nem Omie. Não executar backups concorrentes.
- **MAG:** SQLite consistente, toda a pasta `security` (incluindo `crm-waha.key`) e `crm-media`, além dos dados já abrangidos pelo backup existente. As novas versões dos scripts devem ser instaladas na publicação autorizada. Sem a chave correspondente, a configuração/fila/outbox WAHA falha de forma fechada; não gerar uma chave nova sobre banco existente.

Para restaurar o conector: manter a instância original parada, executar `python3 restore.py PACOTE DIRETORIO_NOVO`, conferir permissões/digests e copiar os scripts operacionais deste diretório. O destino precisa ser novo. A restauração recusa entradas absolutas, `..`, links e tipos inesperados. Ela **não inicia serviço**. Revisar projeto/rede no `.env` antes de iniciar; nunca executar duas cópias da mesma sessão.

Depois de restaurar, conferir health, API privada e sessão pelo MAG; parear novamente somente se o WhatsApp solicitar. Backup de arquivo não garante que o WhatsApp continuará aceitando a autenticação. Testar isso com o número de teste. Preservar as mensagens já gravadas no banco MAG mesmo que o conector peça novo QR.

Na Etapa 1, backup/restore offline e persistência de arquivo foram testados com container real e **zero sessões autenticadas**. Não foi testada recuperação de credenciais de uma conta WhatsApp. Agendamento, cópia externa criptografada, prazos de retenção e alertas operacionais precisam ser definidos na Etapa 2; nenhum cron de produção foi modificado.

## Retorno à release anterior

Desabilitar WAHA no painel enquanto a nova release ainda está ativa; parar somente o conector. Reaplicar o procedimento de deploy da tag anterior, com o compose anterior caso seja necessário remover a nova rede. As tabelas novas são aditivas e isoladas do worker Evolution; não apagar mensagens, chaves ou anexos para reverter código. Os segredos WAHA não são misturados à configuração legada. Não restaurar banco antigo automaticamente, pois isso descartaria movimentações posteriores; uma restauração de dados precisa de janela e decisão próprias.

## Release definitiva (preparada em 06/11/2026)

A homologação real da Etapa 2 (WAHA NOWEB 2026.10.1, ambiente isolado) encontrou e corrigiu seis defeitos de integração: número brasileiro sem o 9º dígito, identificador do envio (`key.id`), eco e mensagens digitadas no aparelho sem `to`, ACKs por `@lid` (identificador estável `<fromMe>_<messageId>`, com conversão idempotente dos ids gravados), status de mensagem recebida e mensagens de sistema/recado para si mesmo.

Decisões aplicadas nesta release:

- **Resposta:** só a vendedora responsável responde pelo número. Administradores acompanham as conversas; responder exige ligar "Permitir que administradores respondam pelo número da vendedora" (desligado por padrão).
- **Histórico:** botão "Buscar histórico" no Atendimento, só da conversa aberta, para a responsável e administradores. A importação geral ("Importar histórico de todas as conversas") fica desligada por padrão; quando ligada pelo administrador, reconhece as conversas `@s.whatsapp.net` do NOWEB.
- **Telefone:** celular brasileiro é gravado com o 9º dígito e as duas grafias são tratadas como o mesmo número no cadastro manual e no WhatsApp. Cadastros existentes não são reescritos.
- **QR Code:** depois de "Iniciar sessão" ou "Reconectar", o QR aparece e se renova sozinho até ser lido, expirar ou o tempo acabar.

O número definitivo é autorizado separadamente. Não reutilizar o número de marketing usado na homologação.

## Limitações a homologar

O WAHA Core 2026.10.1 oferece os recursos de mídia anteriormente associados à edição Plus; a instalação não usa licença paga. Esta conexão usa um protocolo associado ao WhatsApp Web e pode ser afetada por mudanças do serviço, logout e restrições da conta. Histórico anterior à conexão pode ser parcial. O conector permanece separado do banco e das regras comerciais para futura troca pela API oficial, mas essa migração exigirá outro adaptador e homologação.

Referências oficiais: [release 2026.10.1](https://github.com/devlikeapro/waha/releases/tag/2026.10.1), [edições](https://waha.devlike.pro/docs/how-to/waha-plus/), [NOWEB](https://waha.devlike.pro/docs/engines/noweb/), [eventos/HMAC](https://waha.devlike.pro/docs/how-to/events/#hmac-authentication), [mídias](https://waha.devlike.pro/docs/how-to/storages/), [chats e paginação](https://waha.devlike.pro/docs/how-to/chats/). A revisão estática independente está em `docs/WAHA-REVISAO-ETAPA1.md`.
