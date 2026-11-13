#!/bin/sh
# Projeto mag-site — atualiza o catálogo do site a partir do Omie (somente leitura no Omie).
# Instalado em /opt/mag-site/bin/omie-sync.sh e chamado por /etc/cron.d/mag-site.
# Argumentos extras vão para o worker (ex.: --if-stale-hours=20 na execução de reserva).
set -u
LOG=/var/log/mag-site-omie.log
FALHA=/var/lib/mag-site/omie-sync.falha
TENTATIVAS=/var/lib/mag-site/omie-sync.tentativas
mkdir -p /var/lib/mag-site
exec >>"$LOG" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') início $*"
# Com --if-stale-hours é a execução de reserva (06:40); sem, a principal (04:00 ou manual).
case " $* " in *" --if-stale-hours="*) TIPO=reserva ;; *) TIPO=principal ;; esac

cd /opt/mag-site || exit 1
# flock evita duas execuções sobrepostas (o worker também tem trava própria); 75 = já em andamento.
flock -n -E 75 /run/mag-site-omie.lock \
  docker compose --profile maintenance run --rm --no-deps -T omie-sync node scripts/sync-omie.mjs "$@"
status=$?

if [ "$status" -eq 75 ]; then
  echo "outra sincronização já está em andamento; nada feito"
  exit 0
elif [ "$status" -eq 0 ]; then
  rm -f "$FALHA"
else
  # Aviso no login SSH (/etc/update-motd.d/97-mag-site-omie). Só código e horário, nunca credenciais.
  printf '%s sincronização do catálogo Omie falhou (código %s). Detalhes: %s\n' "$(date '+%d/%m/%Y %H:%M')" "$status" "$LOG" >"$FALHA"
fi
# Cada tentativa (data, tipo, código) para o alerta; guarda as 200 últimas.
printf '%s %s %s\n' "$(date -Iseconds)" "$TIPO" "$status" >>"$TENTATIVAS"
tail -n 200 "$TENTATIVAS" >"$TENTATIVAS.tmp" && mv "$TENTATIVAS.tmp" "$TENTATIVAS"
# Alerta técnico (Telegram) só quando a reserva também falha; a principal sozinha fica no log e no MOTD.
if [ "$TIPO" = reserva ] && [ -x /opt/mag-site/bin/omie-alert.py ]; then
  /opt/mag-site/bin/omie-alert.py reserva "$status"
fi
echo "=== $(date '+%Y-%m-%d %H:%M:%S') fim (código $status)"
exit "$status"
