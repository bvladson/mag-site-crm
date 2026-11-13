# mag-cms — WordPress editorial (headless) — PREPARADO, NÃO INSTALADO

Situação em 05/10/2026: `cms.magmoveiscorporativos.com.br` **não resolve** (sem registro DNS). Pela regra combinada,
nada é instalado até o DNS apontar para `179.197.238.57`. Estes arquivos são o modelo da instalação.

## Princípios

- **Instalação nova e limpa.** Banco, usuário do banco, senhas, arquivos, tema, plugins e usuários do painel novos.
  Nada do WordPress antigo do domínio (invadido com ~500 páginas de spam em 2025–26): nem dump, nem `wp-content`,
  nem uploads, nem usuários, nem tema ou plugin, nem configuração.
- **Só editorial.** O WordPress não atende o domínio principal: o site continua sendo o `mag-site`. O CMS vive em
  `cms.` e o conteúdo chega ao site por API, no servidor (próxima fase).
- **Fora do Google.** `X-Robots-Tag: noindex, nofollow` em toda resposta (Nginx), `robots.txt` bloqueando tudo,
  meta robots forçado e sitemap nativo desligado (`mu-plugins/mag-cms-protecao.php`).
- **Projeto isolado** (convenção do `/srv/LEIA-ME.md`): `/opt/mag-cms` e `/srv/mag-cms`, containers, rede, banco,
  volumes e segredos próprios; só escuta em `127.0.0.1:3030`; nada compartilhado com `mag-site` ou outros projetos.

## Arquivos

| arquivo | instalado em |
|---|---|
| `compose.yaml` | `/opt/mag-cms/compose.yaml` |
| `nginx-cms.magmoveiscorporativos.com.br` | `/etc/nginx/sites-available/cms.magmoveiscorporativos.com.br` (+ link em `sites-enabled`) |
| `nginx-conf.d-mag-cms.conf` | `/etc/nginx/conf.d/mag-cms.conf` (limite de tentativas de login) |
| `mu-plugins/mag-cms-protecao.php` | `/opt/mag-cms/wordpress/wp-content/mu-plugins/` |
| `backup.sh` | `/srv/mag-cms/backup.sh` (chamado por `vps-backup-run mag-cms`) |

## Instalação (somente quando o DNS estiver pronto)

    getent hosts cms.magmoveiscorporativos.com.br        # tem que mostrar 179.197.238.57
    install -d -m 750 /opt/mag-cms && install -d -m 700 /opt/mag-cms/secrets /opt/mag-cms/db
    install -d -m 755 /opt/mag-cms/wordpress /srv/mag-cms /srv/mag-cms/backups
    # senhas novas, geradas aqui e guardadas só em /opt/mag-cms/secrets (600)
    DBP=$(openssl rand -base64 33 | tr -d '/+=' | cut -c1-32); ROOTP=$(openssl rand -base64 33 | tr -d '/+=' | cut -c1-32)
    printf 'MARIADB_DATABASE=magcms\nMARIADB_USER=magcms\nMARIADB_PASSWORD=%s\nMARIADB_ROOT_PASSWORD=%s\n' "$DBP" "$ROOTP" > /opt/mag-cms/secrets/db.env
    printf 'WORDPRESS_DB_HOST=db\nWORDPRESS_DB_NAME=magcms\nWORDPRESS_DB_USER=magcms\nWORDPRESS_DB_PASSWORD=%s\n' "$DBP" > /opt/mag-cms/secrets/wp.env
    chmod 600 /opt/mag-cms/secrets/*.env; unset DBP ROOTP
    # fixar no compose a tag estável vigente do WordPress (hub.docker.com/_/wordpress) antes de subir
    cd /opt/mag-cms && docker compose up -d && docker compose ps
    install -D -m 644 mu-plugins/mag-cms-protecao.php /opt/mag-cms/wordpress/wp-content/mu-plugins/mag-cms-protecao.php
    # Nginx: primeiro só o bloco da porta 80 para emitir o certificado, depois o arquivo completo
    certbot certonly --webroot -w /var/www/letsencrypt -d cms.magmoveiscorporativos.com.br
    install -m 644 nginx-conf.d-mag-cms.conf /etc/nginx/conf.d/mag-cms.conf
    install -m 644 nginx-cms.magmoveiscorporativos.com.br /etc/nginx/sites-available/cms.magmoveiscorporativos.com.br
    ln -s /etc/nginx/sites-available/cms.magmoveiscorporativos.com.br /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx

No assistente do WordPress (https://cms.magmoveiscorporativos.com.br/wp-admin/install.php — fazer logo após subir):
usuário administrador **novo** (não "admin"), senha forte gerada, e-mail da MAG; marcar "Evitar que mecanismos de
busca indexem este site". Depois: só os plugins necessários (2FA para o painel; campos personalizados quando a
integração começar), editores com papel "Editor", nunca "Administrador".

Registrar o projeto em `/srv/LEIA-ME.md`, criar `/srv/mag-cms/MANIFESTO.md` e incluir no backup diário:

    install -m 700 backup.sh /srv/mag-cms/backup.sh
    echo '50 3 * * *  root  /usr/local/bin/vps-backup-run mag-cms  >> /var/log/vps-backup-mag-cms.log 2>&1' >> /etc/cron.d/vps-backups

## Segurança e atualizações

- Painel: limite de 10 tentativas/min por IP no `wp-login.php` (Nginx) + 2FA; `xmlrpc.php` bloqueado; edição de
  arquivos pelo painel desligada (`DISALLOW_FILE_EDIT`); PHP não executa em `uploads`; arquivos ocultos, `readme.html`,
  `license.txt` e cópias de `wp-config` bloqueados; lista pública de usuários da API fechada para visitantes.
- Atualizações automáticas: núcleo (versões de segurança/menores) e plugins/temas (`mag-cms-protecao.php`).
  MariaDB e PHP: `cd /opt/mag-cms && docker compose pull && docker compose up -d` mensalmente (tags fixas na série).
- Banco só na rede interna do compose (sem porta publicada). WordPress só em `127.0.0.1:3030`.
- Segredos fora do repositório: `/opt/mag-cms/secrets/*.env` (root, 600). As chaves internas do WordPress
  (salts) são geradas aleatoriamente na primeira subida e ficam no `wp-config.php` do volume.

## Integração com o site (fase seguinte, depois de instalado)

O site lê o WordPress pela REST API **no servidor**, com cache — o visitante nunca acessa o CMS. Os campos editoriais
dos produtos (`catalog/editorial.json`: `commercial_name`, `short_description`, `long_description`, `seo_title`,
`seo_description`, `slug`, `category_override`, `environment_override`, `featured`, `home_priority`, `published`,
`technical_specs`, `marketing_highlights`) passam a vir do CMS com os mesmos nomes; o worker do catálogo continua
aplicando a mesma validação e a mesma ordem (Omie → classificação → `overrides.json` → editorial → site).

## Remover (enquanto não houver conteúdo)

    cd /opt/mag-cms && docker compose down -v && rm -rf /opt/mag-cms /srv/mag-cms
    rm /etc/nginx/sites-enabled/cms.magmoveiscorporativos.com.br /etc/nginx/sites-available/cms.magmoveiscorporativos.com.br /etc/nginx/conf.d/mag-cms.conf
    nginx -t && systemctl reload nginx && certbot delete --cert-name cms.magmoveiscorporativos.com.br
    sed -i '/vps-backup-run mag-cms/d' /etc/cron.d/vps-backups
