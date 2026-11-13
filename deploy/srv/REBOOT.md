# VPS srv1851839 — reinício planejado (procedimento de manutenção)

Instalado em `/srv/mag-site/REBOOT.md`. Vale para a VPS inteira (todos os projetos), não só para o site da MAG.
**Nenhum reinício é feito sem autorização explícita do responsável.** Preparado em 05/10/2026; não executado.

## Por que reiniciar

- O sistema roda o kernel `6.8.0-137` há 8 semanas; o `6.8.0-142` (correções de segurança) já está instalado e só
  passa a valer depois do reinício. A `libc6` também foi atualizada: processos antigos seguem com a versão anterior
  em memória até reiniciarem. Lista: `cat /var/run/reboot-required.pkgs`.
- Sem o reinício, as correções baixadas pelo `unattended-upgrades` ficam instaladas mas inativas.

## Quando

Janela de pouco uso e fora das rotinas automáticas: backups 02:10–03:35, sincronização Omie 04:00 (reserva 06:40),
limpeza de imagens Docker 05:01. Sugestão: domingo 07:30. Tempo fora do ar esperado: 2 a 5 minutos para todos os
sites e sistemas (site MAG, BIomie, base de tarefas, ERP e sites VSB, criativoemtela). Avisar quem usa os sistemas.

## Antes (checklist)

    /opt/mag-site/bin/reboot-check.sh antes      # somente leitura; grava uma fotografia e confere os 12 itens

| # | item | o que o script confere |
|---|---|---|
| 1 | containers ativos | lista (14 em 05/10) e que nenhum rodando tem `restart=no` (não voltaria sozinho) |
| 2 | serviços systemd | ssh.socket, nginx, docker, containerd, cron, fail2ban e ufw habilitados no boot; lista dos que rodam |
| 3 | montagens | `/`, `/boot`, `/boot/efi` (+ fstab) |
| 4 | disco | uso de `/` abaixo de 85% |
| 5 | memória | mais de 500 MB disponíveis |
| 6 | backup recente válido | último `RESULTADO: OK` de cada projeto e nenhum marcador de falha |
| 7 | último sync Omie | válido há menos de 26 h |
| 8 | nginx | `nginx -t` |
| 9 | Docker | ativo |
| 10 | cron | ativo |
| 11 | fail2ban | ativo |
| 12 | UFW | ativo |

Além do script:

- [ ] o script terminou com "Tudo OK" (código 0). Se não, resolver antes de reiniciar.
- [ ] o **ERP VSB não tem backup diário** (05/10/2026): fazer o backup manual da seção abaixo e conferir os arquivos.
- [ ] nada longo rodando: `pgrep -af "sync-omie|vps-backup|bench"`; sem trava em `/opt/mag-site/catalog/catalog.json.lock`.
- [ ] acesso ao console da Hostinger (VNC/recuperação) conferido — é o caminho se o SSH não voltar.
- [ ] usuários avisados.

### ERP VSB — backup manual antes do reboot (procedimento; nada executado)

O ERP (`/opt/vsb-erpnext`, ERPNext 16 / Frappe, site `portal.vsbseguranca.com.br`, imagem
`ghcr.io/bvladson/vsb-erpnext:16.36.0-vsb.3`) **não está no backup diário**. Os únicos backups dele são de 27 e
28/09/2026 e ficam dentro do próprio volume (não saem da VPS). Levantamento de 05/10/2026, somente leitura:

| preservar | onde | observação |
|---|---|---|
| banco (MariaDB 11.8) | volume `vsb-erpnext_db_data` (≈ 289 MB) | o `bench backup` gera um dump consistente sem parar o ERP |
| site e configuração | volume `vsb-erpnext_sites` (≈ 3,5 MB): `portal.vsbseguranca.com.br/`, `common_site_config.json`, `apps.txt`/`apps.json` | o `site_config.json` do site tem a **encryption_key**: sem ela as senhas guardadas no ERP não abrem |
| anexos | `sites/portal.vsbseguranca.com.br/public/files` e `private/files` | incluídos pelo `--with-files` |
| compose | `/opt/vsb-erpnext/compose.yaml` + `overrides/compose.mariadb.yaml`, `compose.mariadb-secrets.yaml`, `compose.redis.yaml`, `compose.host-nginx.yaml` | a lista exata aparece em `docker compose ls` |
| segredos | `/opt/vsb-erpnext/.env` (600) e `/opt/vsb-erpnext/secrets/db_password.txt` (senha root do MariaDB) | nunca por e-mail ou chat |
| dispensáveis | volume `vsb-erpnext_redis_queue_data` (fila, 28 KB) e volumes anônimos de log | |

**Backup completo sem parar o ERP** (root, cerca de 1 minuto):

    D=/srv/vsb-erpnext-manual/$(date +%Y%m%d-%H%M) && install -d -m 700 "$D"
    docker exec vsb-erpnext-backend-1 sh -c 'cd /home/frappe/frappe-bench && bench --site portal.vsbseguranca.com.br backup --with-files'
    P=$(docker exec vsb-erpnext-backend-1 sh -c 'cd /home/frappe/frappe-bench && ls -t sites/portal.vsbseguranca.com.br/private/backups/*-database.sql.gz | head -1' | sed 's/-database.sql.gz$//')
    for s in -database.sql.gz -files.tar -private-files.tar -site_config_backup.json; do docker cp "vsb-erpnext-backend-1:/home/frappe/frappe-bench/$P$s" "$D/"; done
    docker cp vsb-erpnext-backend-1:/home/frappe/frappe-bench/sites/common_site_config.json "$D/"
    docker cp vsb-erpnext-backend-1:/home/frappe/frappe-bench/sites/apps.txt "$D/"
    tar -C /opt/vsb-erpnext -czf "$D/config.tar.gz" compose.yaml overrides .env secrets UPSTREAM.lock
    chmod -R go-rwx "$D" && ls -la "$D"     # conferir: 4 arquivos do bench (o .sql.gz com ~1 MB), 2 configs e config.tar.gz
    # cópia fora da VPS, com a mesma ferramenta dos outros projetos (hash conferido, retenção 30 dias):
    tar -C /srv/vsb-erpnext-manual -czf "$D.tar.gz" "$(basename "$D")" && chmod 600 "$D.tar.gz" && /usr/local/bin/vps-backup-offsite "$D.tar.gz" backups/vsb-erpnext 30

Opcional, **só na janela autorizada** (para o ERP por 1–2 minutos): cópia "a frio" dos volumes, a mais completa.

    IDS=$(docker ps -q --filter label=com.docker.compose.project=vsb-erpnext) && docker stop $IDS
    for v in vsb-erpnext_db_data vsb-erpnext_sites; do docker run --rm -v "$v":/v:ro -v "$D":/b alpine tar -czf "/b/$v.tar.gz" -C /v .; done
    docker start $IDS

**Restauração mínima.** Banco ou anexos danificados, mesma VPS: copiar os arquivos do bench para o container
(`docker cp "$D/<prefixo>-database.sql.gz" vsb-erpnext-backend-1:/tmp/`, idem os `.tar`) e rodar, de forma interativa
(pede a senha root do MariaDB, que está em `secrets/db_password.txt`):

    docker exec -it vsb-erpnext-backend-1 sh -c 'cd /home/frappe/frappe-bench && bench --site portal.vsbseguranca.com.br restore /tmp/<prefixo>-database.sql.gz --with-public-files /tmp/<prefixo>-files.tar --with-private-files /tmp/<prefixo>-private-files.tar && bench --site portal.vsbseguranca.com.br migrate'

Se o `site_config.json` também se perdeu, recriá-lo antes com `db_name`, `db_password` e **`encryption_key`** do
`*-site_config_backup.json`. VPS nova: extrair `config.tar.gz` em `/opt/vsb-erpnext`, obter a imagem (GHCR ou
`docker load`), voltar os volumes da cópia a frio (`docker run --rm -v <volume>:/v -v "$D":/b alpine tar -xzf
/b/<volume>.tar.gz -C /v`) ou criar o site e usar o `bench restore`; subir com os mesmos arquivos do `docker compose ls`
e refazer o vhost/certificado de `portal.vsbseguranca.com.br`. Recomendação pendente: incluir o ERP no backup diário
(`/srv/vsb-erpnext/backup.sh` + `vps-backup-run vsb-erpnext`), decisão do responsável pelo ERP.

## Reiniciar (só com autorização)

    systemctl reboot

Esperar 1 a 3 minutos e entrar de novo por SSH (chave). Não usar `reboot -f`.

## Depois (checklist)

    /opt/mag-site/bin/reboot-check.sh depois     # compara com a última fotografia e testa os 12 itens

| # | item | o que o script confere |
|---|---|---|
| 1 | SSH | ssh.socket ativo, porta 22 escutando (e você entrou) |
| 2 | nginx 80/443 | portas escutando e `nginx -t` |
| 3 | certificado | válido por mais de 7 dias |
| 4 | site | início e `/produtos` respondem 200 |
| 5 | página de produto | URL amigável 200 e URL antiga `produto-<código>` 301 |
| 6 | catálogo | `/api/health` ok, produtos > 0, estoque atual; último sync válido |
| 7 | worker Omie | imagem da release ativa e compose do worker válidos (o sync em si roda às 04:00) |
| 8 | banco | `PRAGMA quick_check` do SQLite do site |
| 9 | cron | ativo e agendas `mag-site` e `vps-backups` presentes |
| 10 | backups | últimos resultados e marcadores de falha |
| 11 | alerta | `omie-alert.py` roda; fail2ban e UFW ativos |
| 12 | demais projetos | containers, serviços, portas e montagens que havia antes voltaram; HTTP de todos os domínios igual |

Além do script: abrir no navegador o site, uma página de produto e a lista de orçamento; com o Telegram
configurado, `/opt/mag-site/bin/omie-alert.py teste`. Conferir o kernel novo: `uname -r` → `6.8.0-142-generic`.

## Se algo não voltar

- Container de um projeto parado: `cd <pasta do projeto> && docker compose up -d` (mag-site: `/opt/mag-site`).
- Serviço do host parado: `systemctl status <serviço>`, `journalctl -u <serviço> -b`, depois `systemctl start <serviço>`.
- Nginx não sobe: `nginx -t` mostra o arquivo/linha; nada do site depende de outro serviço para subir.
- O kernel novo não inicia: pelo console da Hostinger, no GRUB escolher "Advanced options" → `6.8.0-137-generic`;
  depois de entrar, investigar antes de remover qualquer kernel.
- Sincronização Omie: se o reinício cair sobre 04:00, a reserva das 06:40 cobre; na dúvida rodar
  `/opt/mag-site/bin/omie-sync.sh` e conferir `tail /var/log/mag-site-omie.log`.
