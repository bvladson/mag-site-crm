# mag-site — restauração (procedimento manual completo)

Instalado em `/srv/mag-site/RESTORE.md` e copiado dentro de todo pacote de backup. Complementa o `MANIFESTO.md`.

**Regras:** nunca restaurar por cima da produção que está funcionando sem antes gerar um backup novo do estado atual
(`/srv/mag-site/backup.sh`); testar o pacote primeiro de forma isolada (seção 7); o pacote tem dados pessoais e
segredos — manter `chmod 600` e nunca mandar por e-mail ou chat.

## 1. O que há no pacote

`/srv/mag-site/backups/mag-site-AAAAMMDD-HHMMSS.tar.gz` (gerado às 03:35 por `vps-backup-run mag-site`) → pasta `pacote/`:

| caminho no pacote | conteúdo |
|---|---|
| `dados/site.sqlite` | banco do site: orçamentos, contatos, vagas, candidaturas, usuários do painel, configuração das redes sociais e destaques manuais, auditoria (cópia consistente, `VACUUM INTO`) |
| `dados/curriculos.tar` | PDFs dos currículos |
| `dados/social-uploads.tar` | imagens enviadas no painel para os destaques manuais das redes (se existirem) |
| `dados/social-state.tar` | tokens que Instagram/TikTok/LinkedIn renovam sozinhos (**segredo**; só existe depois de ligar alguma API) |
| `dados/catalog.json`, `dados/catalog.status.json` | catálogo publicado (produtos + redirecionamentos 301) e estado da última sincronização |
| `dados/slugs.json` | **registro das URLs amigáveis dos produtos** (permanente; ver seção 6) |
| `dados/editorial.json`, `dados/overrides.json` | conteúdo editorial e exceções de classificação (só se existirem) |
| `dados/sync-history.jsonl` | histórico das sincronizações |
| `dados/catalogo-interno.tar` | cadastro completo do Omie da Consulta rápida (`catalog/interno/`: só metadados — código, SKU, nome, EAN, marca, família, situação; refeito às 05:20) |
| `segredos/` | `omie.env` (chaves do Omie), `omie-consulta.env` (token interno site ↔ serviço da Consulta rápida), `omie-pedidos.env` (token interno site ↔ serviço do Pedido de Venda), `site.env`, `alert.env` (Telegram), `social.env` (redes sociais) — os que existirem |
| `codigo-<tag>.tar.gz` | código da release que estava no ar |
| `config/` | `compose.yaml`, `.env`, `bin/`, Nginx (vhost e `conf.d`), cron, logrotate, aviso do login |
| `MANIFESTO.md`, `RESTORE.md`, `REDES.md`, `restore.sh`, `RELEASE` | documentação (inclui o passo a passo das redes sociais), script de restauração e a tag da release |
| `backup-alerta.sh` | gancho de falha do backup (Telegram); o `restore.sh` reinstala em `/srv/mag-site/` |

Fora do pacote (infraestrutura da VPS, comum a todos os projetos): `vps-backup-run`, `vps-backup-alerta` (com a
camada 3, o gancho por projeto), `vps-backup-offsite` e `vps-backup-rotate` em `/usr/local/bin`, o drop-in
`/etc/ssh/sshd_config.d/02-sem-x11forwarding.conf` e o `server_tokens off;` do `/etc/nginx/nginx.conf`.

As fotos do catálogo não entram: a primeira sincronização baixa todas de novo (~10 min). O cache das redes
(`catalog/social/`: lista e miniaturas) também não: `/opt/mag-site/bin/social-sync.sh` refaz em segundos.

## 2. Antes de começar

    PKG=/srv/mag-site/backups/mag-site-AAAAMMDD-HHMMSS.tar.gz     # ou a cópia externa
    tar -tzf "$PKG" | head -40                                     # pacote legível?
    tar -xzOf "$PKG" pacote/RELEASE                                # release que será restaurada

Na VPS de destino: Docker com o plugin compose, Nginx, certbot (webroot `/var/www/letsencrypt`), cron, python3 e o DNS
de `magmoveiscorporativos.com.br` e `www` apontando para ela.

## 3. Restauração completa numa VPS nova (automática)

    install -d -m 755 /srv/mag-site
    tar -xzOf "$PKG" pacote/restore.sh > /srv/mag-site/restore.sh && chmod 700 /srv/mag-site/restore.sh
    /srv/mag-site/restore.sh "$PKG"            # recusa sobrescrever banco existente sem --sobrescrever

O script cria o usuário `magsite` (nunca o UID 1000), as pastas com as permissões certas, reconstrói a imagem da release,
restaura banco (com vagas e redes), currículos, imagens e tokens das redes, catálogo, URLs, editorial e segredos,
instala cron/logrotate/aviso e sobe o site em
`127.0.0.1:3020`. Com os serviços do Omie no pacote (`omie-consulta` desde `20261007-0815`; `omie-pedidos` desde o Pedido
de Venda), sobe também esses serviços e
confere token interno (gera outro se faltar), permissões dos segredos, saúde e uma consulta local de teste que não chama
o Omie (`bin/omie-consulta-verificar.sh`); se essa conferência falhar, termina com erro e avisa (o site fica no ar).
A **escrita no Omie volta sempre DESLIGADA** (o `.env` é refeito sem `OMIE_ORDER_WRITE_ENABLED`): religar só com
autorização, como descrito no `MANIFESTO.md` ("Orçamento interno e Pedido de Venda").
Banco restaurado de um backup ANTERIOR a pedidos já enviados ao Omie: a numeração dos orçamentos internos pode repetir
números já usados. O envio detecta (pedido com o mesmo número e outro cliente/itens = "conflito", nada enviado nem
vinculado), mas antes de religar a escrita avance a numeração (tabela `counters`, linha `orcamento-AAAA`) para depois do último `MAG-Q-` do Omie.
Depois, os passos que ele imprime (certificado, link do vhost, `nginx -t`, sincronização) e:

    echo '35 3 * * * root /usr/local/sbin/vps-backup-run mag-site' >> /etc/cron.d/vps-backups   # se a VPS usar vps-backup-run
    /opt/mag-site/bin/omie-alert.py teste      # confere o Telegram (se secrets/alert.env veio no pacote)

## 4. Restauração manual passo a passo (sem o restore.sh)

    W=$(mktemp -d /tmp/mag-site-restore.XXXXXX) && tar -xzf "$PKG" -C "$W" && P=$W/pacote && TAG=$(cat "$P/RELEASE")
    id magsite >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin --user-group magsite
    install -d -m 750 /opt/mag-site /opt/mag-site/releases /opt/mag-site/bin
    install -d -m 700 /opt/mag-site/secrets
    install -d -m 700 -o magsite -g magsite /opt/mag-site/data
    install -d -m 755 -o magsite -g magsite /opt/mag-site/catalog /opt/mag-site/catalog/images /opt/mag-site/catalog/social
    install -d -m 700 -o magsite -g magsite /opt/mag-site/catalog/interno /opt/mag-site/social-state
    # código e configuração
    mkdir -p /opt/mag-site/releases/$TAG && tar -xzf "$P/codigo-$TAG.tar.gz" -C /opt/mag-site/releases/$TAG
    cp "$P/config/compose.yaml" /opt/mag-site/ && cp -a "$P/config/bin/." /opt/mag-site/bin/
    printf 'MAG_SITE_TAG=%s\nMAG_SITE_UID=%s\nMAG_SITE_GID=%s\n' "$TAG" "$(id -u magsite)" "$(id -g magsite)" > /opt/mag-site/.env
    cp -a "$P/segredos/." /opt/mag-site/secrets/ && chown root:root /opt/mag-site/secrets/* && chmod 600 /opt/mag-site/secrets/*
    /opt/mag-site/bin/omie-consulta-verificar.sh --preparar   # token interno da Consulta rápida (gera se faltar) e permissões
    # dados
    install -m 600 -o magsite -g magsite "$P/dados/site.sqlite" /opt/mag-site/data/site.sqlite
    tar -xf "$P/dados/curriculos.tar" -C /opt/mag-site/data && chown -R magsite:magsite /opt/mag-site/data/resumes
    [ -f "$P/dados/social-uploads.tar" ] && tar -xf "$P/dados/social-uploads.tar" -C /opt/mag-site/data && chown -R magsite:magsite /opt/mag-site/data/social-uploads
    [ -f "$P/dados/social-state.tar" ] && tar -xf "$P/dados/social-state.tar" -C /opt/mag-site && chown -R magsite:magsite /opt/mag-site/social-state && chmod 700 /opt/mag-site/social-state
    for f in catalog.json catalog.status.json overrides.json editorial.json slugs.json sync-history.jsonl; do
      [ -f "$P/dados/$f" ] && install -m 644 -o magsite -g magsite "$P/dados/$f" /opt/mag-site/catalog/$f; done
    [ -f "$P/dados/catalogo-interno.tar" ] && tar -xf "$P/dados/catalogo-interno.tar" -C /opt/mag-site/catalog \
      && chown -R magsite:magsite /opt/mag-site/catalog/interno && chmod 700 /opt/mag-site/catalog/interno
    # site
    docker build -t mag-site:$TAG /opt/mag-site/releases/$TAG
    cd /opt/mag-site && docker compose up -d --wait web omie-consulta omie-pedidos && curl -fsS http://127.0.0.1:3020/api/health
    /opt/mag-site/bin/omie-consulta-verificar.sh   # Consulta rápida: segredos, saúde e consulta local de teste (sem chamar o Omie)
    # Nginx, agenda e documentação
    install -m 644 "$P/config/nginx-magmoveiscorporativos.com.br" /etc/nginx/sites-available/magmoveiscorporativos.com.br
    install -m 644 "$P/config/nginx-conf.d-mag-site.conf" /etc/nginx/conf.d/mag-site.conf
    install -m 644 "$P/config/cron-mag-site" /etc/cron.d/mag-site
    install -m 644 "$P/config/logrotate-mag-site" /etc/logrotate.d/mag-site
    install -m 755 "$P/config/motd-97-mag-site-omie" /etc/update-motd.d/97-mag-site-omie
    install -d -m 755 /srv/mag-site /srv/mag-site/backups
    install -m 600 "$P/MANIFESTO.md" "$P/RESTORE.md" /srv/mag-site/ && install -m 700 "$P/restore.sh" "$P/backup-alerta.sh" /srv/mag-site/
    # HTTPS: se o certificado ainda não existe nesta VPS, publicar antes só o bloco HTTP (porta 80) e:
    certbot certonly --webroot -w /var/www/letsencrypt -d magmoveiscorporativos.com.br -d www.magmoveiscorporativos.com.br
    ln -sf /etc/nginx/sites-available/magmoveiscorporativos.com.br /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx
    /opt/mag-site/bin/omie-sync.sh             # baixa as fotos e confere o Omie
    /opt/mag-site/bin/social-sync.sh           # refaz o cache das redes (sem secrets/social.env: tudo "desconectado")
    /opt/mag-site/bin/omie-indice.sh           # cadastro completo da Consulta rápida (opcional: o pacote já traz o da véspera)
    rm -rf "$W"

O `backup.sh` usado pelo `vps-backup-run` fica em `/srv/mag-site/backup.sh` (copiar do código: `deploy/srv/backup.sh`).

## 5. Restaurações parciais (servidor funcionando)

Sempre gerar um backup do estado atual antes (`/srv/mag-site/backup.sh`) e extrair o pacote em `W` como na seção 4.

- **Só o banco** (corrompido ou apagado por engano):

      cd /opt/mag-site && docker compose stop web
      mv data/site.sqlite data/site.sqlite.antes-$(date +%Y%m%d-%H%M%S); rm -f data/site.sqlite-wal data/site.sqlite-shm
      install -m 600 -o magsite -g magsite "$P/dados/site.sqlite" data/site.sqlite
      docker compose up -d --wait web && curl -fsS http://127.0.0.1:3020/api/health

  Registros feitos depois do backup se perdem — conferir o arquivo `.antes-*` antes de apagá-lo.
- **Só o catálogo / URLs** (`catalog.json`, `slugs.json`, `editorial.json`, `overrides.json`): copiar com
  `install -m 644 -o magsite -g magsite` para `/opt/mag-site/catalog/`. O site relê o catálogo em até 15 s, sem reiniciar.
  Em seguida rodar `/opt/mag-site/bin/omie-sync.sh` para atualizar estoque e fotos — as URLs saem iguais às do `slugs.json`.
- **Só o Nginx**: `install -m 644` dos dois arquivos de `config/`, depois `nginx -t && systemctl reload nginx`.
- **Só as redes sociais**: configuração e destaques estão no banco; imagens dos destaques: `social-uploads.tar` em
  `/opt/mag-site/data` (+ `chown -R magsite:magsite`); tokens: `social-state.tar` em `/opt/mag-site` (pasta 700 magsite);
  depois `/opt/mag-site/bin/social-sync.sh`.
- **Só a Consulta rápida** (token perdido, serviço parado ou com falha): `/opt/mag-site/bin/omie-consulta-verificar.sh --preparar`,
  depois `cd /opt/mag-site && docker compose up -d --wait --force-recreate web omie-consulta` (os dois relêem o token)
  e `/opt/mag-site/bin/omie-consulta-verificar.sh`. Cadastro completo: `catalogo-interno.tar` em `/opt/mag-site/catalog`
  (pasta `interno` 700 magsite) ou `/opt/mag-site/bin/omie-indice.sh` (~16 chamadas ao Omie).
- **Só o código** (voltar release): `sed -i 's/^MAG_SITE_TAG=.*/MAG_SITE_TAG=<tag>/' /opt/mag-site/.env && cd /opt/mag-site && docker compose up -d web omie-consulta`
  (a imagem `mag-site:<tag>` precisa existir; senão `docker build -t mag-site:<tag> /opt/mag-site/releases/<tag>`).
  Para antes de `20261007-0815`, ver "Voltar versão" no `MANIFESTO.md` (o `omie-consulta` sai antes).

## 6. URLs dos produtos (cuidado especial)

`catalog/slugs.json` guarda, por código do produto no Omie, a URL amigável e as anteriores. É o que mantém
`/produto/<nome>-<sku>` estável mesmo que o nome mude no Omie e o que gera os 301 das URLs antigas.
Se ele se perder, a sincronização o reconstrói a partir do `catalog.json` publicado (URLs atuais e redirecionamentos);
se os dois se perderem, as URLs são geradas de novo — iguais para quem não mudou de nome desde então, mas qualquer
URL anterior a uma troca de nome deixa de redirecionar. Por isso os dois vão no backup e nunca devem ser apagados.

## 7. Teste de restauração isolado (não destrutivo — pode rodar na produção)

Usa uma pasta temporária, outra porta (`127.0.0.1:3029`, fora do Nginx) e um container descartável; não toca em
`/opt/mag-site`, no banco em uso, no Nginx nem no cron.

    T=$(mktemp -d /tmp/mag-restore-test.XXXXXX) && tar -xzf "$PKG" -C "$T" && P=$T/pacote && TAG=$(cat "$P/RELEASE")
    mkdir -p "$T/code" "$T/data" "$T/catalog" && tar -xzf "$P/codigo-$TAG.tar.gz" -C "$T/code"
    diff -rq "$T/code" /opt/mag-site/releases/$TAG && echo "código idêntico à release $TAG"
    cp "$P/dados/site.sqlite" "$T/data/" && cp "$P/dados/"*.json* "$T/catalog/" && chown -R magsite:magsite "$T/data" "$T/catalog"
    docker run -d --name mag-restore-test --user "$(id -u magsite):$(id -g magsite)" --read-only --tmpfs /tmp \
      -p 127.0.0.1:3029:3000 -v "$T/data:/app/data/local" -v "$T/catalog:/app/catalog:ro" \
      -e SITE_DATA_DIR=/app/data/local -e OMIE_CATALOG_PATH=/app/catalog/catalog.json -e OMIE_IMAGE_DIR=/app/catalog/images \
      mag-site:$TAG
    sleep 5; curl -s http://127.0.0.1:3029/api/health     # products = número do catálogo restaurado
    docker exec mag-restore-test node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync("/app/data/local/site.sqlite",{readOnly:true});console.log(d.prepare("PRAGMA integrity_check").get())'
    docker rm -f mag-restore-test && rm -rf "$T"

Resultado esperado: código idêntico, `integrity_check: ok`, `/api/health` com o mesmo número de produtos do catálogo
restaurado, página de produto 200 e URL antiga `produto-<id>` com 301. Registro dos testes feitos: `MANIFESTO.md`.

## 8. Depois de qualquer restauração

- [ ] `curl -s http://127.0.0.1:3020/api/health` → `ok`, produtos > 0
- [ ] `https://magmoveiscorporativos.com.br/` e `/produtos` abrem; uma página de produto abre com `canonical` próprio
- [ ] `/produto/produto-<id>` → 301 direto para a URL amigável; um endereço de spam antigo → 410
- [ ] login no painel `/interno` com um usuário existente
- [ ] `/opt/mag-site/bin/omie-consulta-verificar.sh` → "Consulta rápida: tudo certo" (o `restore.sh` já roda e mostra)
- [ ] `/interno/produtos` abre para Admin/Comercial (DHO: sem permissão) e "Mostrar todos os produtos do Omie" está habilitado
- [ ] `/interno/omie` mostra "Escrita no Omie DESLIGADA"; os orçamentos internos e os pedidos já enviados aparecem
- [ ] `/carreiras` e `/redes` abrem (200); `/opt/mag-site/bin/social-sync.sh` termina com código 0 (`tail /var/log/mag-site-social.log`)
- [ ] `/opt/mag-site/bin/omie-sync.sh` termina com código 0 (`tail /var/log/mag-site-omie.log`)
- [ ] `/srv/mag-site/backup.sh` gera pacote novo; `vps-backup-run` agendado
- [ ] `/opt/mag-site/bin/omie-alert.py teste` (se o Telegram estiver configurado)
# Segurança do painel

Os pacotes desta versão incluem `dados/security.tar` quando o MFA tiver sido configurado.
Esse arquivo contém a chave que permite ler os segredos TOTP do banco restaurado e deve
ser conservado junto ao pacote privado. O restore devolve a chave ao diretório `data/security`,
com proprietário `magsite`, diretórios 700 e arquivos 600. Convites, códigos de recuperação
armazenados por hash, entrevistas, unidades, campanhas e métricas ficam no SQLite.

