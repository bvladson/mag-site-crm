# Deploy na VPS (Node + Docker)

Publicado em 02/10/2026 em https://magmoveiscorporativos.com.br (VPS 179.197.238.57).
Referência completa da instalação: `deploy/srv/MANIFESTO.md` (cópia viva em `/srv/mag-site/MANIFESTO.md`).

## Como o site roda

- Build Node do TanStack Start (`NITRO_PRESET=node-server`), imagem `mag-site:<tag>` feita pelo `Dockerfile`
  com `bun install --frozen-lockfile` (respeita o `bun.lock`).
- Container `mag-site-web-1` só em `127.0.0.1:3020`, atrás do Nginx; usuário dedicado `magsite`, raiz somente leitura.
- Sem Supabase: formulários e painel usam o banco próprio `SQLite` em `/opt/mag-site/data` (`src/lib/local-db.server.ts`),
  login local com senha scrypt e sessão em cookie `HttpOnly`/`Secure` (`src/lib/local-auth*.ts`).
- Catálogo: `scripts/sync-omie.mjs` roda de madrugada (04:00, Fortaleza) e grava `catalog.json` + fotos WebP;
  o site só lê esse arquivo (`src/lib/omie.server.ts`). Nenhuma visita consulta o Omie.
- Estoque: saldo total e por local de estoque do Omie aparecem discretamente em cada produto (decisão da MAG);
  custo, preço, pendências e reservas nunca são publicados. Regras e variáveis em `deploy/srv/MANIFESTO.md`.

## Arquivos de implantação (`deploy/`)

| arquivo | destino na VPS |
|---|---|
| `compose.yaml` | `/opt/mag-site/compose.yaml` |
| `bin/deploy.sh`, `bin/omie-sync.sh` | `/opt/mag-site/bin/` |
| `nginx/magmoveiscorporativos.com.br` | `/etc/nginx/sites-available/` |
| `cron/mag-site`, `logrotate/mag-site`, `motd/97-mag-site-omie` | `/etc/cron.d/`, `/etc/logrotate.d/`, `/etc/update-motd.d/` |
| `srv/MANIFESTO.md`, `srv/backup.sh`, `srv/restore.sh` | `/srv/mag-site/` |

## Publicar uma nova versão

    # no computador: empacotar sem node_modules/.output/.env
    tar --exclude=./node_modules --exclude=./.output --exclude=./.env -czf release-<tag>.tar.gz -C "SITE MAGMOVEIS INSTITUCIONAL" .
    scp release-<tag>.tar.gz root@179.197.238.57:/opt/mag-site/releases/
    # na VPS
    mkdir /opt/mag-site/releases/<tag> && tar -xzf /opt/mag-site/releases/release-<tag>.tar.gz -C /opt/mag-site/releases/<tag>
    /opt/mag-site/bin/deploy.sh <tag>    # constrói, troca e confere a saúde; volta sozinho se falhar

## Testes

    node --test tests/sync-omie.test.mjs            # worker do Omie com API e fotos simuladas
    node node_modules/typescript/bin/tsc --noEmit   # tipos

## Variáveis

Definidas no `deploy/compose.yaml`; segredos em `/opt/mag-site/secrets/` (nunca no repositório nem em `VITE_*`):
- `omie.env`: `OMIE_APP_KEY`, `OMIE_APP_SECRET` (só o worker recebe).
- `site.env` (opcional): `RESEND_API_KEY`, `EMAIL_FROM`, `COMMERCIAL_NOTIFICATION_EMAIL`, `DHO_NOTIFICATION_EMAIL`.
