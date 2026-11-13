#!/bin/sh
# Projeto mag-site — restaura um pacote gerado por backup.sh (VPS nova ou reconstrução).
# Uso: restore.sh <mag-site-AAAAMMDD-HHMMSS.tar.gz> [--sobrescrever]
# Recusa sobrescrever um banco existente sem --sobrescrever. Sobe o site e os serviços internos do Omie que o pacote tiver
# (omie-consulta desde 20261007-0815; omie-pedidos desde a conversão em Pedido de Venda): tokens internos, permissões dos
# segredos, saúde e uma consulta local de teste que não chama o Omie. Termina com saída ≠ 0 se algo disso falhar.
# A escrita no Omie volta SEMPRE desligada (o .env é refeito sem OMIE_ORDER_WRITE_ENABLED). Depois: emitir o certificado.
set -eu
PKG=${1:?informe o pacote}
FORCE=${2:-}
APP=/opt/mag-site
WORK=$(mktemp -d /tmp/mag-site-restore.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
tar -xzf "$PKG" -C "$WORK"
P=$WORK/pacote
TAG=$(cat "$P/RELEASE")
if [ -f "$APP/data/site.sqlite" ] && [ "$FORCE" != "--sobrescrever" ]; then
  echo "já existe $APP/data/site.sqlite; use --sobrescrever para substituir" >&2; exit 1
fi

# Usuário dedicado (nunca reutilizar o UID de outro projeto).
id magsite >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin --user-group magsite
U=$(id -u magsite); G=$(id -g magsite)

install -d -m 750 "$APP" "$APP/releases" "$APP/bin"
install -d -m 700 "$APP/secrets"
install -d -m 700 -o magsite -g magsite "$APP/data"
install -d -m 755 -o magsite -g magsite "$APP/catalog" "$APP/catalog/images" "$APP/catalog/social"
install -d -m 700 -o magsite -g magsite "$APP/catalog/interno" "$APP/social-state"

mkdir -p "$APP/releases/$TAG" && tar -xzf "$P/codigo-$TAG.tar.gz" -C "$APP/releases/$TAG"
cp "$P/config/compose.yaml" "$APP/compose.yaml"
cp -a "$P/config/bin/." "$APP/bin/" && chmod 755 "$APP/bin/"*.sh
printf 'MAG_SITE_TAG=%s\nMAG_SITE_UID=%s\nMAG_SITE_GID=%s\n' "$TAG" "$U" "$G" > "$APP/.env"
cp -a "$P/segredos/." "$APP/secrets/"

# Serviços internos do Omie: token interno site <-> serviço. O pacote o traz; se faltar, um novo (só os dois o usam).
SERVICOS=web
for servico in omie-consulta omie-pedidos; do
  grep -q "^  $servico:" "$APP/compose.yaml" || continue
  SERVICOS="$SERVICOS $servico"
  VAR=OMIE_CONSULTA_TOKEN; [ "$servico" = omie-pedidos ] && VAR=OMIE_PEDIDOS_TOKEN
  if ! grep -Eq "^$VAR=[0-9a-f]{64}$" "$APP/secrets/$servico.env" 2>/dev/null; then
    (umask 077; printf '%s=%s\n' "$VAR" "$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')" > "$APP/secrets/$servico.env")
    echo "secrets/$servico.env ausente ou inválido no pacote: token interno novo gerado"
  fi
done
chown root:root "$APP/secrets" "$APP/secrets/"*
chmod 700 "$APP/secrets" && chmod 600 "$APP/secrets/"*

[ -f "$P/dados/site.sqlite" ] && install -m 600 -o magsite -g magsite "$P/dados/site.sqlite" "$APP/data/site.sqlite"
for f in site.sqlite-wal site.sqlite-shm; do [ -f "$P/dados/$f" ] && install -m 600 -o magsite -g magsite "$P/dados/$f" "$APP/data/$f"; done
[ -f "$P/dados/curriculos.tar" ] && tar -xf "$P/dados/curriculos.tar" -C "$APP/data" && chown -R magsite:magsite "$APP/data/resumes"
[ -f "$P/dados/social-uploads.tar" ] && tar -xf "$P/dados/social-uploads.tar" -C "$APP/data" && chown -R magsite:magsite "$APP/data/social-uploads"
[ -f "$P/dados/link-uploads.tar" ] && tar -xf "$P/dados/link-uploads.tar" -C "$APP/data" && chown -R magsite:magsite "$APP/data/link-uploads"
[ -f "$P/dados/site-uploads.tar" ] && tar -xf "$P/dados/site-uploads.tar" -C "$APP/data" && chown -R magsite:magsite "$APP/data/site-uploads"
if [ -f "$P/dados/crm-media.tar" ]; then
  tar -xf "$P/dados/crm-media.tar" -C "$APP/data"
  chown -R magsite:magsite "$APP/data/crm-media"
  find "$APP/data/crm-media" -type d -exec chmod 700 {} \;
  find "$APP/data/crm-media" -type f -exec chmod 600 {} \;
fi
if [ -f "$P/dados/security.tar" ]; then
  tar -xf "$P/dados/security.tar" -C "$APP/data"
  chown -R magsite:magsite "$APP/data/security"
  find "$APP/data/security" -type d -exec chmod 700 {} \;
  find "$APP/data/security" -type f -exec chmod 600 {} \;
fi
[ -f "$P/dados/social-state.tar" ] && tar -xf "$P/dados/social-state.tar" -C "$APP" && chown -R magsite:magsite "$APP/social-state" && chmod 700 "$APP/social-state"
for f in catalog.json catalog.status.json overrides.json editorial.json slugs.json sync-history.jsonl; do [ -f "$P/dados/$f" ] && install -m 644 -o magsite -g magsite "$P/dados/$f" "$APP/catalog/$f"; done
# Cadastro completo do Omie da Consulta rápida (só metadados): volta junto, para o painel não esperar as 05:20.
[ -f "$P/dados/catalogo-interno.tar" ] && tar -xf "$P/dados/catalogo-interno.tar" -C "$APP/catalog" && chown -R magsite:magsite "$APP/catalog/interno" && chmod 700 "$APP/catalog/interno"

install -m 644 "$P/config/cron-mag-site" /etc/cron.d/mag-site
install -m 644 "$P/config/logrotate-mag-site" /etc/logrotate.d/mag-site
install -m 755 "$P/config/motd-97-mag-site-omie" /etc/update-motd.d/97-mag-site-omie
install -d -m 755 /srv/mag-site /srv/mag-site/backups /srv/mag-site/docs
install -m 600 "$P/MANIFESTO.md" /srv/mag-site/MANIFESTO.md
[ -f "$P/RESTORE.md" ] && install -m 600 "$P/RESTORE.md" /srv/mag-site/RESTORE.md
[ -f "$P/REDES.md" ] && install -m 600 "$P/REDES.md" /srv/mag-site/REDES.md
[ -f "$P/backup-alerta.sh" ] && install -m 700 "$P/backup-alerta.sh" /srv/mag-site/backup-alerta.sh
install -m 700 "$P/restore.sh" /srv/mag-site/restore.sh

docker build -t "mag-site:$TAG" "$APP/releases/$TAG"
(cd "$APP" && docker compose up -d --wait --wait-timeout 120 $SERVICOS)
curl -fsS http://127.0.0.1:3020/api/health && echo

install -m 644 "$P/config/nginx-magmoveiscorporativos.com.br" /etc/nginx/sites-available/magmoveiscorporativos.com.br
install -m 644 "$P/config/nginx-conf.d-mag-site.conf" /etc/nginx/conf.d/mag-site.conf

# Serviços do Omie: segredos, saúde e consulta local de teste pelo container do site (sem chamar o Omie).
CONSULTA=ok
if [ "$SERVICOS" != web ]; then
  V=$APP/bin/omie-consulta-verificar.sh
  [ -f "$V" ] || V=$APP/releases/$TAG/deploy/bin/omie-consulta-verificar.sh
  if [ -f "$V" ]; then
    sh "$V" || CONSULTA=falha
  else
    # Pacote da 20261007-0815 (antes da verificação automática): ao menos a saúde do serviço.
    for servico in $SERVICOS; do
      [ "$servico" = web ] && continue
      [ "$(cd "$APP" && docker compose ps --format '{{.Health}}' "$servico")" = healthy ] && echo "ok      $servico saudável" || CONSULTA=falha
    done
  fi
fi
cat <<'EOF'
Site no ar em 127.0.0.1:3020. Falta só o HTTPS público:
  1) se o certificado não existir nesta VPS, publique antes um bloco só HTTP com o webroot e rode:
     certbot certonly --webroot -w /var/www/letsencrypt -d magmoveiscorporativos.com.br -d www.magmoveiscorporativos.com.br
  2) ln -sf /etc/nginx/sites-available/magmoveiscorporativos.com.br /etc/nginx/sites-enabled/
  3) nginx -t && systemctl reload nginx
  4) /opt/mag-site/bin/omie-sync.sh   (baixa as fotos e atualiza o catálogo)
  5) /opt/mag-site/bin/social-sync.sh (redes sociais; sem secrets/social.env tudo fica "desconectado")
  6) /opt/mag-site/bin/omie-indice.sh (cadastro completo da Consulta rápida; o pacote já traz o da véspera — opcional)
EOF
if [ "$CONSULTA" != ok ]; then
  echo "ATENÇÃO: os serviços do Omie (Consulta rápida / Pedido de Venda) NÃO passaram na verificação acima; o site público está no ar." >&2
  exit 1
fi
