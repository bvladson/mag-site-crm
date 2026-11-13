#!/bin/sh
# Projeto mag-site — redes sociais: API oficial -> catalog/social/ (JSON + miniaturas) -> site.
# Instalado em /opt/mag-site/bin/social-sync.sh e chamado de hora em hora por /etc/cron.d/mag-site.
# Rede sem credencial (secrets/social.env) fica "desconectado", sem nenhuma chamada; erro numa rede não afeta as
# outras e mantém o último conteúdo bom. Estado por rede (sem segredos): catalog/social/social.status.json e o painel.
# --forcar: ignora o intervalo mínimo do LinkedIn (use logo depois de gravar ou trocar uma credencial).
set -u
FORCAR=""
[ "${1:-}" = "--forcar" ] && FORCAR="-e SOCIAL_FORCE=1"
LOG=/var/log/mag-site-social.log
exec >>"$LOG" 2>&1
cd /opt/mag-site || exit 1
# flock evita execuções sobrepostas (75 = a anterior ainda está rodando); timeout é só rede de segurança.
flock -n -E 75 /run/mag-site-social.lock \
  timeout 30m docker compose --profile maintenance run --rm --no-deps -T $FORCAR social-sync node scripts/sync-social.mjs </dev/null
status=$?
case "$status" in
  0) ;;
  75) echo "$(date '+%Y-%m-%d %H:%M:%S') a sincronização anterior ainda está em andamento; nada feito"; exit 0 ;;
  *) echo "$(date '+%Y-%m-%d %H:%M:%S') sincronização das redes falhou (código $status)" ;;
esac
exit "$status"
