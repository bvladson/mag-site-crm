#!/bin/sh
# Projeto mag-site — gera um pacote completo e portátil.
# Contrato com vps-backup-run: imprime SOMENTE o caminho do pacote no stdout (mensagens vão para o stderr).
# O pacote contém dados pessoais (orçamentos, contatos, currículos) e segredos: fica chmod 600.
set -eu
umask 077
APP=/opt/mag-site
OUT=/srv/mag-site/backups
STAMP=$(date +%Y%m%d-%H%M%S)
WORK=$(mktemp -d /tmp/mag-site-backup.XXXXXX)
trap 'rm -rf "$WORK"; rm -f "$APP/data/.backup-$STAMP.sqlite"' EXIT
mkdir -p "$OUT" "$WORK/pacote/config" "$WORK/pacote/dados"
P=$WORK/pacote
TAG=$(sed -n 's/^MAG_SITE_TAG=//p' "$APP/.env")

# 1) Banco: cópia consistente feita pelo próprio SQLite, sem parar o site.
if [ -n "$(cd "$APP" && docker compose ps -q --status running web 2>/dev/null)" ]; then
  (cd "$APP" && docker compose exec -T -e "BACKUP_FILE=/app/data/local/.backup-$STAMP.sqlite" web node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync("/app/data/local/site.sqlite");
    db.prepare("VACUUM INTO ?").run(process.env.BACKUP_FILE);
    db.close();') >&2
  cp "$APP/data/.backup-$STAMP.sqlite" "$P/dados/site.sqlite"
elif [ -f "$APP/data/site.sqlite" ]; then
  echo "container parado: copiando o banco diretamente" >&2
  cp "$APP/data/site.sqlite" "$P/dados/site.sqlite"
  for f in site.sqlite-wal site.sqlite-shm; do [ -f "$APP/data/$f" ] && cp "$APP/data/$f" "$P/dados/$f"; done
fi

# 2) Currículos, catálogo publicado, URLs persistentes (slugs.json), conteúdo editorial e segredos
#    (as fotos são baixadas de novo pela sincronização).
[ -d "$APP/data/resumes" ] && tar -C "$APP/data" -cf "$P/dados/curriculos.tar" resumes
# Redes sociais: imagens enviadas no painel (destaques manuais) e tokens renovados pelas plataformas (segredo).
# O cache catalog/social/ não entra: o worker refaz na próxima hora.
[ -d "$APP/data/social-uploads" ] && tar -C "$APP/data" -cf "$P/dados/social-uploads.tar" social-uploads
[ -d "$APP/data/link-uploads" ] && tar -C "$APP/data" -cf "$P/dados/link-uploads.tar" link-uploads
# CMS próprio: as mídias de rascunhos e versões históricas acompanham o banco.
[ -d "$APP/data/site-uploads" ] && tar -C "$APP/data" -cf "$P/dados/site-uploads.tar" site-uploads
# CRM attachments are private and must follow messages/keys in the same database backup.
[ -d "$APP/data/crm-media" ] && tar -C "$APP/data" -cf "$P/dados/crm-media.tar" crm-media
# MFA: a chave que protege os segredos TOTP faz parte do mesmo pacote privado do banco.
[ -d "$APP/data/security" ] && tar -C "$APP/data" -cf "$P/dados/security.tar" security
[ -d "$APP/social-state" ] && tar -C "$APP" -cf "$P/dados/social-state.tar" social-state
for f in catalog.json catalog.status.json overrides.json editorial.json slugs.json sync-history.jsonl; do [ -f "$APP/catalog/$f" ] && cp "$APP/catalog/$f" "$P/dados/$f"; done
# Consulta rápida: cadastro completo do Omie (só metadados, refeito às 05:20) — a restauração o devolve sem chamar o Omie.
[ -d "$APP/catalog/interno" ] && tar -C "$APP/catalog" -cf "$P/dados/catalogo-interno.tar" interno
cp -a "$APP/secrets" "$P/segredos"

# 3) Código da release ativa (o restore reconstrói a mesma imagem) e configuração do projeto.
[ -n "$TAG" ] && tar -C "$APP/releases/$TAG" -czf "$P/codigo-$TAG.tar.gz" .
cp "$APP/compose.yaml" "$APP/.env" "$P/config/"
cp -a "$APP/bin" "$P/config/bin"
cp /etc/nginx/sites-available/magmoveiscorporativos.com.br "$P/config/nginx-magmoveiscorporativos.com.br"
cp /etc/nginx/conf.d/mag-site.conf "$P/config/nginx-conf.d-mag-site.conf"
cp /etc/cron.d/mag-site "$P/config/cron-mag-site"
cp /etc/logrotate.d/mag-site "$P/config/logrotate-mag-site"
cp /etc/update-motd.d/97-mag-site-omie "$P/config/motd-97-mag-site-omie"
cp /srv/mag-site/MANIFESTO.md /srv/mag-site/restore.sh "$P/"
[ -f /srv/mag-site/RESTORE.md ] && cp /srv/mag-site/RESTORE.md "$P/"
[ -f /srv/mag-site/REDES.md ] && cp /srv/mag-site/REDES.md "$P/"
[ -f /srv/mag-site/backup-alerta.sh ] && cp /srv/mag-site/backup-alerta.sh "$P/"
echo "$TAG" > "$P/RELEASE"

PKG=$OUT/mag-site-$STAMP.tar.gz
tar -C "$WORK" -czf "$PKG" pacote
chmod 600 "$PKG"
echo "$PKG"
