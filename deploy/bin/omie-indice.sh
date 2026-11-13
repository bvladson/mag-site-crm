#!/bin/sh
# Projeto mag-site — cadastro completo do Omie para a Consulta rápida do painel ("Mostrar todos os produtos do Omie").
# Só metadados (código, SKU, nome, EAN, marca, família, situação); estoque continua sob demanda. Somente leitura no Omie.
# Instalado em /opt/mag-site/bin/omie-indice.sh e chamado às 05:20 por /etc/cron.d/mag-site, depois da sincronização
# pública das 04:00 — que ele nunca bloqueia: usa trava própria e, se ela ainda estiver rodando, espera (até 30 min).
set -u
LOG=/var/log/mag-site-omie-indice.log
exec >>"$LOG" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') início"
cd /opt/mag-site || exit 1

# Pasta do índice (só o painel lê): 700 do usuário do site, recriada se faltar (ex.: depois de uma restauração).
U=$(sed -n 's/^MAG_SITE_UID=//p' .env); G=$(sed -n 's/^MAG_SITE_GID=//p' .env)
install -d -o "$U" -g "$G" -m 700 catalog/interno || exit 1

# Sincronização pública em andamento (trava com menos de 1 h; mais velha é sobra de execução morta): espera.
publica_rodando() { [ -n "$(find catalog/catalog.json.lock -mmin -60 2>/dev/null)" ]; }
espera=0
while publica_rodando && [ "$espera" -lt 1800 ]; do sleep 30; espera=$((espera + 30)); done
if publica_rodando; then
  echo "a sincronização pública ainda está rodando depois de 30 min; cadastro completo não atualizado (fica o anterior)"
  exit 75
fi

# flock evita duas execuções do índice (75 = a anterior ainda está rodando); timeout é só rede de segurança.
flock -n -E 75 /run/mag-site-omie-indice.lock \
  timeout 20m docker compose --profile maintenance run --rm --no-deps -T omie-indice node scripts/omie-indice.mjs </dev/null
status=$?
case "$status" in
  0) ;;
  75) echo "outra atualização do cadastro completo já está em andamento; nada feito"; exit 0 ;;
  *) echo "atualização do cadastro completo falhou (código $status); o painel segue com o anterior e avisa que está desatualizado" ;;
esac
echo "=== $(date '+%Y-%m-%d %H:%M:%S') fim (código $status)"
exit "$status"
