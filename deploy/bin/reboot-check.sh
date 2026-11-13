#!/bin/sh
# VPS (todos os projetos) — fotografia ANTES e conferência DEPOIS de um reboot planejado. SOMENTE LEITURA:
# não reinicia, não para e não altera serviço nenhum. Procedimento completo: /srv/mag-site/REBOOT.md.
#   reboot-check.sh antes    confere os 12 itens de antes e grava /var/lib/mag-site/reboot/antes-AAAAMMDD-HHMMSS/
#   reboot-check.sh depois   confere os 12 itens de depois e compara com a última fotografia "antes"
# Sai com código 1 quando algum item falha (antes: não reiniciar; depois: algo não voltou).
set -u
BASE=/var/lib/mag-site/reboot
SITE=https://magmoveiscorporativos.com.br
APP=/opt/mag-site
falhas=0
ok() { printf '  OK     %s\n' "$*"; }
ruim() { printf '  FALHA  %s\n' "$*"; falhas=$((falhas + 1)); }
ativo() { [ "$(systemctl is-active "$1" 2>/dev/null)" = active ] && ok "$2 ($1 ativo)" || ruim "$2 ($1: $(systemctl is-active "$1" 2>/dev/null))"; }
codigo() { curl -sk -o /dev/null -m 15 -w '%{http_code}' "$1"; }

fotografa() {  # estado comparável, sem horários: containers, serviços, portas, montagens e HTTP de cada domínio
  mkdir -p "$1"
  docker ps --format '{{.Names}}' | sort > "$1/containers.txt"
  systemctl list-units --type=service --state=running --no-legend --plain | awk '{print $1}' \
    | grep -vE '^(user@|user-runtime-dir@|packagekit|fwupd|apt-daily|man-db|sysstat-collect|systemd-tmpfiles-clean|motd-news|update-notifier)' | sort > "$1/servicos.txt"
  ss -tlnH | awk '{print $4}' | sort -u > "$1/portas.txt"
  findmnt -rn -o TARGET -t ext4,xfs,btrfs,vfat,nfs,nfs4,cifs | sort > "$1/montagens.txt"
  for n in $(nginx -T 2>/dev/null | awk '$1=="server_name"{for(i=2;i<=NF;i++){gsub(";","",$i); print $i}}' | grep -vE '^(_|localhost)$' | sort -u); do
    printf '%s %s\n' "$n" "$(codigo "https://$n/")"
  done > "$1/http.txt"
  { uname -r; df -h / | tail -1; free -m | sed -n 2p; } > "$1/sistema.txt"
}

backups_ok() {  # último resultado de cada projeto em /var/log/vps-backup-*.log
  for f in /var/log/vps-backup-*.log; do
    [ "$f" = /var/log/vps-backup-alertas.log ] && continue
    r=$(grep 'RESULTADO' "$f" | tail -1)
    case "$r" in *"RESULTADO: OK"*) ok "backup $(basename "$f" .log | sed 's/vps-backup-//'): ${r%%  RESULTADO*}";; *) ruim "backup $(basename "$f" .log | sed 's/vps-backup-//'): ${r:-sem resultado no log}";; esac
  done
  [ -z "$(ls /var/lib/vps-backup/falhas/ 2>/dev/null)" ] && ok "nenhum marcador de falha de backup" || ruim "marcadores de falha: $(ls /var/lib/vps-backup/falhas/ | tr '\n' ' ')"
}

catalogo_ok() {  # último sync Omie válido (estado do worker) e catálogo servido pelo site
  s=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("last_successful_sync") or d.get("lastSuccessAt") or "")' "$APP/catalog/catalog.status.json" 2>/dev/null)
  idade=$(( ( $(date +%s) - $(date -d "${s:-1970-01-01}" +%s) ) / 3600 ))
  [ -n "$s" ] && [ "$idade" -le 26 ] && ok "último sync Omie válido há ${idade} h ($s)" || ruim "último sync Omie válido: ${s:-nenhum} (há ${idade} h)"
}

case "${1:-}" in
antes)
  D="$BASE/antes-$(date +%Y%m%d-%H%M%S)"; fotografa "$D"
  echo "Fotografia: $D"
  echo " 1. containers ativos ($(wc -l < "$D/containers.txt")): $(tr '\n' ' ' < "$D/containers.txt")"
  for n in $(docker ps --format '{{.Names}}'); do
    [ "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$n")" = no ] && ruim "container $n está rodando com restart=no (não volta sozinho)"
  done
  echo " 2. serviços systemd ($(wc -l < "$D/servicos.txt") rodando):"; antes_falhas=$falhas; for s in ssh.socket nginx docker containerd cron fail2ban ufw; do [ "$(systemctl is-enabled "$s" 2>/dev/null)" = enabled ] || ruim "$s não está habilitado para subir no boot"; done; [ "$falhas" -eq "$antes_falhas" ] && ok "ssh, nginx, docker, containerd, cron, fail2ban e ufw habilitados no boot"
  echo " 3. montagens: $(tr '\n' ' ' < "$D/montagens.txt")"; ok "fstab com $(grep -vcE '^[[:space:]]*(#|$)' /etc/fstab) linha(s) ativas"
  echo " 4. disco:"; uso=$(df --output=pcent / | tail -1 | tr -dc 0-9); [ "$uso" -lt 85 ] && ok "/ com ${uso}% usado" || ruim "/ com ${uso}% usado"
  echo " 5. memória:"; livre=$(free -m | awk '/^Mem:/{print $7}'); [ "$livre" -gt 500 ] && ok "${livre} MB disponíveis" || ruim "só ${livre} MB disponíveis"
  echo " 6. backup recente válido:"; backups_ok
  echo " 7. último sync Omie:"; catalogo_ok
  echo " 8. nginx:"; nginx -t >/dev/null 2>&1 && ok "nginx -t" || ruim "nginx -t"
  echo " 9. docker:"; ativo docker "Docker"
  echo "10. cron:"; ativo cron "cron"
  echo "11. fail2ban:"; ativo fail2ban "fail2ban"
  echo "12. UFW:"; ufw status 2>/dev/null | grep -q "Status: active" && ok "UFW ativo" || ruim "UFW inativo"
  echo "Kernel atual: $(uname -r) | instalado mais novo: $(ls /boot/vmlinuz-* | sed 's#/boot/vmlinuz-##' | sort -V | tail -1)"
  ;;
depois)
  A=$(ls -d "$BASE"/antes-* 2>/dev/null | sort | tail -1)
  [ -n "$A" ] || { echo "nenhuma fotografia 'antes' em $BASE"; exit 2; }
  D="$BASE/depois-$(date +%Y%m%d-%H%M%S)"; fotografa "$D"
  echo "Comparando com $A (kernel antes: $(head -1 "$A/sistema.txt") | agora: $(uname -r))"
  echo " 1. SSH:"; ativo ssh.socket "SSH"; ss -tlnH | awk '{print $4}' | grep -q ':22$' && ok "porta 22 escutando" || ruim "porta 22 fechada"
  echo " 2. nginx 80/443:"; ss -tlnH | awk '{print $4}' | grep -q ':443$' && ss -tlnH | awk '{print $4}' | grep -q ':80$' && ok "80 e 443 escutando" || ruim "80/443"; nginx -t >/dev/null 2>&1 && ok "nginx -t" || ruim "nginx -t"
  echo " 3. certificado:"; openssl x509 -checkend 604800 -noout -in /etc/letsencrypt/live/magmoveiscorporativos.com.br/fullchain.pem >/dev/null && ok "válido por mais de 7 dias" || ruim "vence em menos de 7 dias"
  echo " 4. site:"; [ "$(codigo "$SITE/")" = 200 ] && [ "$(codigo "$SITE/produtos")" = 200 ] && ok "início e /produtos 200" || ruim "início $(codigo "$SITE/") / produtos $(codigo "$SITE/produtos")"
  set -- $(python3 -c 'import json,sys; p=json.load(open(sys.argv[1]))["products"][0]; print(p["slug"], p.get("id", ""))' "$APP/catalog/catalog.json" 2>/dev/null)
  slug=${1:-}; id=${2:-}
  echo " 5. página de produto:"; [ "$(codigo "$SITE/produto/$slug")" = 200 ] && ok "/produto/$slug 200" || ruim "/produto/$slug $(codigo "$SITE/produto/$slug")"
  [ "$(codigo "$SITE/produto/produto-$id")" = 301 ] && ok "URL antiga produto-$id 301" || ruim "URL antiga produto-$id $(codigo "$SITE/produto/produto-$id")"
  echo " 6. catálogo:"; h=$(curl -s -m 10 http://127.0.0.1:3020/api/health); case "$h" in *'"status":"ok"'*'"fresh":true'*) ok "saúde: $(echo "$h" | sed 's/.*"products":\([0-9]*\).*/\1/') produtos, estoque atual";; *) ruim "saúde: ${h:-sem resposta}";; esac
  catalogo_ok
  echo " 7. worker Omie:"; TAG=$(sed -n 's/^MAG_SITE_TAG=//p' "$APP/.env"); docker image inspect "mag-site:$TAG" >/dev/null 2>&1 && (cd "$APP" && docker compose --profile maintenance config -q) && ok "imagem mag-site:$TAG e compose do worker válidos (sync roda às 04:00)" || ruim "imagem mag-site:$TAG ou compose"
  echo " 8. banco:"; r=$(docker exec mag-site-web-1 node -e 'const {DatabaseSync}=require("node:sqlite");console.log(new DatabaseSync("/app/data/local/site.sqlite",{readOnly:true}).prepare("PRAGMA quick_check").get().quick_check)' 2>&1); [ "$r" = ok ] && ok "SQLite quick_check ok" || ruim "SQLite: $r"
  echo " 9. cron:"; ativo cron "cron"; [ -f /etc/cron.d/mag-site ] && [ -f /etc/cron.d/vps-backups ] && ok "agendas mag-site e vps-backups presentes" || ruim "agenda ausente"
  echo "10. backups:"; backups_ok
  echo "11. alerta:"; "$APP/bin/omie-alert.py" teste --dry-run >/dev/null && ok "omie-alert.py roda" || ruim "omie-alert.py"; ativo fail2ban "fail2ban"; ufw status 2>/dev/null | grep -q "Status: active" && ok "UFW ativo" || ruim "UFW inativo"
  echo "12. demais projetos (comparação com a fotografia):"
  for f in containers servicos portas montagens; do
    falta=$(comm -23 "$A/$f.txt" "$D/$f.txt" | tr '\n' ' ')
    [ -z "$falta" ] && ok "$f: tudo que havia antes voltou" || ruim "$f que não voltaram: $falta"
  done
  mud=$(comm -23 "$A/http.txt" "$D/http.txt" | while read -r n c; do printf '%s %s→%s; ' "$n" "$c" "$(grep "^$n " "$D/http.txt" | cut -d' ' -f2)"; done)
  [ -z "$mud" ] && ok "HTTP de $(wc -l < "$D/http.txt") domínios igual ao de antes" || ruim "HTTP mudou: $mud"
  ;;
*) echo "uso: reboot-check.sh antes | depois" >&2; exit 2 ;;
esac
echo
[ "$falhas" -eq 0 ] && echo "Tudo OK." || echo "$falhas item(ns) com FALHA."
[ "$falhas" -eq 0 ]
