#!/bin/sh
# Projeto mag-site — dados do Omie do Pedido de Venda (vendedores, etapas, formas de pagamento, categorias, contas).
# Instalado em /opt/mag-site/bin/omie-referencias.sh e chamado às 05:40 por /etc/cron.d/mag-site. Somente leitura no Omie,
# pelo serviço interno omie-pedidos; grava só no banco do site. Falha mantém o último cadastro válido.
set -u
LOG=/var/log/mag-site-omie-referencias.log
exec >>"$LOG" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') início"
cd /opt/mag-site || exit 1
# flock evita duas execuções (75 = a anterior ainda está rodando); timeout é só rede de segurança.
flock -n -E 75 /run/mag-site-omie-referencias.lock \
  timeout 10m docker compose exec -T web node scripts/omie-referencias.mjs </dev/null
status=$?
case "$status" in
  0) ;;
  75) echo "a atualização anterior ainda está em andamento; nada feito"; exit 0 ;;
  *) echo "atualização dos dados do Omie falhou (código $status); o painel segue com o último cadastro válido" ;;
esac
echo "=== $(date '+%Y-%m-%d %H:%M:%S') fim (código $status)"
exit "$status"
