#!/bin/sh
# Projeto mag-site — publica uma release já copiada para /opt/mag-site/releases/<tag>.
# Uso: /opt/mag-site/bin/deploy.sh <tag>
# Constrói a imagem mag-site:<tag>, troca o container e confere a saúde; se falhar, volta à tag anterior.
set -eu
TAG=${1:?informe a tag da release}
case "$TAG" in *[!A-Za-z0-9._-]*) echo "tag inválida: $TAG" >&2; exit 2;; esac
SRC=/opt/mag-site/releases/$TAG
[ -f "$SRC/Dockerfile" ] || { echo "release não encontrada: $SRC" >&2; exit 1; }
cd /opt/mag-site
PREV=$(sed -n 's/^MAG_SITE_TAG=//p' .env)

docker build -t "mag-site:$TAG" "$SRC"
sed -i "s/^MAG_SITE_TAG=.*/MAG_SITE_TAG=$TAG/" .env

# web, omie-consulta (Consulta rápida) e omie-pedidos (Pedido de Venda) usam a mesma imagem: sobem juntos na tag nova
# e voltam juntos na falha.
if docker compose up -d --wait --wait-timeout 120 web omie-consulta omie-pedidos && curl -fsS --max-time 10 http://127.0.0.1:3020/api/health >/dev/null; then
  echo "publicada: mag-site:$TAG (anterior: ${PREV:-nenhuma})"
else
  echo "a release $TAG não ficou saudável; voltando para ${PREV:-nenhuma}" >&2
  if [ -n "$PREV" ] && [ "$PREV" != "$TAG" ]; then
    sed -i "s/^MAG_SITE_TAG=.*/MAG_SITE_TAG=$PREV/" .env
    docker compose up -d --wait --wait-timeout 120 web
    # Serviço que a tag anterior não tem (omie-consulta antes de 20261007-0815, omie-pedidos antes da conversão em
    # Pedido de Venda) só é removido; o que ela tem volta junto.
    for servico in omie-consulta omie-pedidos; do
      if docker run --rm --entrypoint test "mag-site:$PREV" -f "scripts/$servico.mjs"; then
        docker compose up -d --wait --wait-timeout 120 "$servico"
      else
        docker compose rm -sf "$servico"
      fi
    done
  fi
  exit 1
fi
