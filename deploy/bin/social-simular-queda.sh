#!/bin/sh
# Projeto mag-site — TESTE: simula as APIs das redes FORA DO AR numa execução do worker (os nomes das APIs apontam
# para 127.0.0.1 só dentro deste container). Esperado: cada rede configurada fica "erro" no painel, com mensagem
# "falha de rede", o site continua mostrando o último conteúdo bom e nada é apagado.
# Para voltar ao normal: /opt/mag-site/bin/social-sync.sh --forcar (ou esperar o cron do :25).
set -u
H=$(mktemp /tmp/mag-social-hosts.XXXXXX)
trap 'rm -f "$H"' EXIT
printf '127.0.0.1 localhost\n' >"$H"
for host in www.googleapis.com i.ytimg.com graph.instagram.com open.tiktokapis.com api.linkedin.com www.linkedin.com media.licdn.com; do
  printf '127.0.0.1 %s\n' "$host" >>"$H"
done
chmod 644 "$H"
cd /opt/mag-site || exit 1
echo "$(date '+%Y-%m-%d %H:%M:%S') SIMULAÇÃO de queda das APIs (teste manual; nada é apagado)" >>/var/log/mag-site-social.log
flock -n -E 75 /run/mag-site-social.lock \
  timeout 10m docker compose --profile maintenance run --rm --no-deps -T -e SOCIAL_FORCE=1 -v "$H:/etc/hosts:ro" social-sync node scripts/sync-social.mjs </dev/null
status=$?
[ "$status" -eq 75 ] && { echo "outra sincronização em andamento; tente de novo"; exit 0; }
python3 - <<'PY'
import json
dados = json.load(open("/opt/mag-site/catalog/social/social.status.json"))
for nome, rede in dados["providers"].items():
    print("%-9s %-12s itens %3d  %s" % (nome, rede["status"], rede["itemCount"], rede["error"] or ""))
PY
echo "Conteúdo no site: o último bom (social.json não muda). Agora rode: /opt/mag-site/bin/social-sync.sh --forcar"
exit "$status"
