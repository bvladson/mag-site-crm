# Recuperação e continuidade — site MAG (CRM, WhatsApp, propostas)

Complementa `deploy/srv/RESTORE.md` (procedimento completo, que vai dentro de todo pacote de backup) e o
`PROTECOES-20261112.md` do WhatsApp (`/srv/mag-whatsapp/`).

## O que é guardado

| O quê | Quando | Onde | Observação |
| --- | --- | --- | --- |
| Site: banco (CRM, conversas, negociações, propostas, usuários, auditoria), anexos do CRM, currículos, catálogo, segredos, código e configuração | Todo dia às 03:35 (`vps-backup-run mag-site`) | Local `/srv/mag-site/backups` (7 diários, 4 semanais, 3 mensais) **e cópia externa** | Banco copiado de forma consistente (`VACUUM INTO`) |
| Conector do WhatsApp (sessão vinculada) | Todo dia às 03:43 (`/srv/mag-whatsapp/backup-diario.sh`) | Local `/srv/mag-whatsapp/backups` | Para o conector por ~20 s e confere a volta. **Sem cópia externa** (ver riscos). |
| Saúde do servidor (`saude-host.json`) | A cada 5 min | Pasta de dados do site | Não entra no backup; é refeito sozinho |

## Metas

- **Perda máxima de dados (RPO): até 24 h** do banco do site, se o servidor inteiro fosse perdido. As mensagens que
  chegaram ao WhatsApp nesse intervalo continuam no celular. Depois de reconectar, a conferência de mensagens
  (recuperação do conector) traz de volta o que couber na janela dela.
- **Volta de uma release com problema: 2 a 3 min.** O `deploy.sh` volta sozinho se a saúde falhar. À mão:
  `MAG_SITE_TAG=<anterior>` no `.env` e `docker compose up -d web omie-consulta omie-pedidos`.
- **Servidor novo a partir do pacote: cerca de 1 h** (`restore.sh`), mais DNS e certificado.

## Recuperação testável

1. **Teste isolado do pacote** (`RESTORE.md`, seção 7). Não é destrutivo: roda em pasta temporária, porta
   `127.0.0.1:3029` e contêiner descartável. Confere código idêntico, `integrity_check: ok`, `/api/health` e as URLs.
   **Passa a ser passo obrigatório de toda janela de publicação**, sobre o backup gerado logo antes do deploy. Assim,
   cada janela também prova que o backup daquele momento restaura.
2. **WhatsApp:** `backup-diario.sh` confere o pacote (`tar -tzf`) e a volta da sessão. O desfazer das proteções está
   documentado. Restaurar a sessão evita ler o QR de novo; sem ela, basta vincular de novo pelo QR, porque as
   conversas ficam no banco do site.
3. **Painel "Saúde do sistema":** mostra o último backup de cada projeto, a falha pendente e o vigia do WhatsApp. Backup
   com mais de 26 h ou com falha aparece como **crítico**.

## Etapas 1 e 2 e a volta

- **Etapa 1 sem mudança de estrutura no banco.** Regra de carteira, novos registros de auditoria e painel de saúde
  não criam nem alteram tabelas.
- **Etapa 2: uma tabela nova, `crm_opportunity_drafts`** (rascunho do catálogo), criada na primeira vez que alguém
  usa o rascunho. A versão anterior simplesmente não a lê. Os itens que já foram para uma negociação continuam lá,
  com preço definido no editor.
- Voltar para a release anterior não exige nada no banco. Os registros de auditoria novos ficam guardados e não
  atrapalham.
- **Cron da saúde:** remover `/etc/cron.d/mag-site-saude` desliga a coleta. O painel passa a avisar "sem dados do
  servidor" e nada mais muda.
- **Base da linha principal (multiusuário v2.1):** as tabelas das linhas de WhatsApp são criadas na primeira leitura,
  e a configuração da v1 não é reescrita (teste `waha-multiusuario`: "rollback keeps working"). Isso precisa ser
  confirmado na homologação com cópia anonimizada, antes de qualquer janela.

## Riscos conhecidos

- **Backup do WhatsApp só local.** Se o disco da VPS se perder, a sessão se perde, e a solução é vincular de novo pelo
  QR. As conversas estão no banco do site, que tem cópia externa. Levar esse pacote para fora exige combinar a
  criptografia, porque ele contém a sessão.
- **Alertas por Telegram desligados** até haver o token do bot. Hoje os avisos ficam no painel, no MOTD e nos
  marcadores.
