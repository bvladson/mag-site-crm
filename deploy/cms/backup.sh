#!/bin/sh
# Projeto mag-cms — pacote completo do WordPress editorial. MODELO, ainda não instalado (ver README.md).
# Contrato com vps-backup-run: imprime SOMENTE o caminho do pacote no stdout (mensagens vão para o stderr).
# Contém segredos e o banco: fica chmod 600.
set -eu
umask 077
APP=/opt/mag-cms
OUT=/srv/mag-cms/backups
STAMP=$(date +%Y%m%d-%H%M%S)
WORK=$(mktemp -d /tmp/mag-cms-backup.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT" "$WORK/pacote"
P=$WORK/pacote

# 1) Banco: dump consistente sem parar o site (InnoDB, transação única). Senha lida dentro do container (MYSQL_PWD, fora da lista de processos).
(cd "$APP" && docker compose exec -T db sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb-dump --single-transaction --routines --triggers -u root "$MARIADB_DATABASE"') > "$P/banco.sql"
[ -s "$P/banco.sql" ] || { echo "dump vazio" >&2; exit 1; }

# 2) wp-content (uploads, temas, plugins, mu-plugins) e wp-config.php (tem as chaves internas); o núcleo se reinstala.
tar -C "$APP/wordpress" -cf "$P/wp-content.tar" wp-content wp-config.php

# 3) Configuração do projeto e segredos.
cp "$APP/compose.yaml" "$P/"
cp -a "$APP/secrets" "$P/segredos"
cp /etc/nginx/sites-available/cms.magmoveiscorporativos.com.br "$P/nginx-cms.magmoveiscorporativos.com.br"
cp /etc/nginx/conf.d/mag-cms.conf "$P/nginx-conf.d-mag-cms.conf"
[ -f /srv/mag-cms/MANIFESTO.md ] && cp /srv/mag-cms/MANIFESTO.md "$P/"

PKG=$OUT/mag-cms-$STAMP.tar.gz
tar -C "$WORK" -czf "$PKG" pacote
chmod 600 "$PKG"
echo "$PKG"
