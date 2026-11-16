# mag-site — site institucional da MAG Móveis Corporativos

Domínio: **https://magmoveiscorporativos.com.br** (`www` redireciona para o domínio principal).
Publicado em 02/10/2026. Código-fonte de origem: `C:\Users\VLADSON\Downloads\SITE MAGMOVEIS INSTITUCIONAL`
(projeto Lovable/TanStack Start convertido para rodar sozinho na VPS, sem Supabase).

## O que pertence a este projeto

| recurso | caminho / nome | observação |
|---|---|---|
| aplicação | `/opt/mag-site/` (750 root) | `compose.yaml`, `.env` (tag ativa + UID/GID), `bin/`, `releases/<tag>/` |
| container | `mag-site-web-1` (imagem `mag-site:<tag>`) | só em `127.0.0.1:3020`; usuário `magsite`, raiz somente leitura, sem capabilities, 768 MB / 0,75 CPU |
| worker do catálogo | serviço `omie-sync` (profile `maintenance`) | roda sob demanda pelo cron; credenciais do Omie só nele, no `omie-consulta`, no `omie-indice` e no `omie-pedidos` |
| consulta rápida (painel) | serviço `omie-consulta` (container `mag-site-omie-consulta-1`, imagem `mag-site:<tag>`) | sempre ligado, **sem porta publicada** (só a rede interna do projeto); estoque de 1 produto sob demanda, somente leitura; 128 MB / 0,25 CPU; ver "Consulta rápida" |
| pedido de venda (orçamento interno) | serviço `omie-pedidos` (container `mag-site-omie-pedidos-1`) | ÚNICO que ESCREVE no Omie (IncluirPedido e IncluirCliente), só com `OMIE_ORDER_WRITE_ENABLED=true` no `/opt/mag-site/.env`; sem porta publicada; 128 MB / 0,25 CPU; ver "Orçamento interno e Pedido de Venda" |
| dados do Omie do pedido | `bin/omie-referencias.sh` (cron 05:40) | vendedores, etapas, formas de pagamento, categorias e contas → banco do site (só leitura no Omie) |
| cadastro completo (Consulta rápida) | serviço `omie-indice` (profile `maintenance`) + `bin/omie-indice.sh` (cron 05:20) | só metadados de TODOS os produtos do Omie (~16 chamadas por noite) em `catalog/interno/omie-produtos.json` (pasta 700 magsite); conferência sem chamar o Omie: `bin/omie-consulta-verificar.sh` |
| usuário de execução | `magsite` (sistema, sem login) | **não** é o UID 1000 (que é o usuário `biomie` no host) |
| banco próprio | `/opt/mag-site/data/site.sqlite` (700 magsite) | orçamentos (do site e internos), contatos, candidaturas, usuários do painel, envios ao Omie, vínculos usuário → vendedor, auditoria |
| currículos | `/opt/mag-site/data/resumes/` (700 magsite) | PDFs com nome aleatório; só Admin/DHO baixam, pelo painel |
| vagas e redes | tabelas `jobs`, `social_settings`, `social_manual_items` no mesmo banco | ver "Carreiras" e "Redes sociais" |
| imagens dos destaques | `/opt/mag-site/data/social-uploads/` (700 magsite) | JPG/PNG/WebP enviados no painel de redes, nome aleatório |
| worker das redes | serviço `social-sync` (profile `maintenance`) + `bin/social-sync.sh` | de hora em hora (:25); único que lê `secrets/social.env` |
| credenciais das redes | `bin/social-credenciais.py` (+ teste `bin/social-simular-queda.sh`) e `/srv/mag-site/REDES.md` | grava `secrets/social.env` digitando sem eco; passo a passo de cada rede |
| retenção de candidaturas | `scripts/recruitment-retention.mjs` (no container `web`) | só relatório; prazos em `secrets/site.env` quando a MAG definir |
| cache das redes | `/opt/mag-site/catalog/social/` (755 magsite) | `social.json`, `social.status.json`, `social-history.jsonl`, `images/` |
| tokens das redes | `/opt/mag-site/social-state/` (700 magsite) | `tokens.json` (600) renovado pelas plataformas; vazio enquanto nenhuma API estiver ligada |
| catálogo publicado | `/opt/mag-site/catalog/` (755 magsite) | `catalog.json` (produtos + 301), `catalog.status.json`, `images/` (fotos copiadas do Omie), `overrides.json` (exceções, opcional) |
| URLs dos produtos | `/opt/mag-site/catalog/slugs.json` | registro permanente slug ↔ código Omie (+ slugs anteriores). **Nunca apagar** |
| conteúdo editorial | `/opt/mag-site/catalog/editorial.json` (opcional) | nome comercial, textos, SEO, slug, destaque… por código Omie |
| relatórios / histórico | `/opt/mag-site/catalog/reports/products-without-images.csv`, `sync-history.jsonl` | refeitos a cada sincronização (histórico: últimas 400) |
| segredos | `/opt/mag-site/secrets/` (700 root) | `omie.env` (OMIE_APP_KEY/SECRET), `omie-consulta.env` (OMIE_CONSULTA_TOKEN: token interno site ↔ omie-consulta), `omie-pedidos.env` (OMIE_PEDIDOS_TOKEN: token interno site ↔ omie-pedidos), `site.env` (opcionais: e-mail), `alert.env` (opcional: Telegram), `social.env` (opcional: redes sociais) |
| alerta do sync | `/opt/mag-site/bin/omie-alert.py` + estado em `/var/lib/mag-site/` (`omie-sync.tentativas`, `omie-alert.ultimo`) | Telegram só em falha; ver "Alerta" |
| Nginx | `/etc/nginx/sites-available/magmoveiscorporativos.com.br` + link em `sites-enabled` | |
| Nginx (mapas) | `/etc/nginx/conf.d/mag-site.conf` | 301 dos endereços do WordPress antigo e 410 para o spam e restos dele |
| certificado | `magmoveiscorporativos.com.br` (+ www), webroot `/var/www/letsencrypt` | renovação automática do certbot |
| cron do catálogo | `/etc/cron.d/mag-site` | 04:00 diária; 05:20 cadastro completo da Consulta rápida; 05:40 dados do Omie do Pedido de Venda; 06:40 reserva só se a das 04:00 falhou; :17 de hora em hora (fora de 04–06 h) verificação de atraso; :25 de hora em hora redes sociais |
| backup | linha `mag-site` em `/etc/cron.d/vps-backups` (03:35) | `vps-backup-run mag-site` → este `backup.sh` |
| logs | `/var/log/mag-site-omie.log`, `/var/log/mag-site-omie-indice.log`, `/var/log/mag-site-omie-referencias.log`, `/var/log/mag-site-social.log` (`/etc/logrotate.d/mag-site`), `/var/log/vps-backup-mag-site.log`, `/var/log/nginx/mag-site-*.log` | |
| aviso no login SSH | `/etc/update-motd.d/97-mag-site-omie` + marcador `/var/lib/mag-site/omie-sync.falha` | aparece só quando a última sincronização falhou |
| alerta de falha do backup | `/srv/mag-site/backup-alerta.sh` (gancho chamado pelo `vps-backup-alerta`) | reaproveita `omie-alert.py backup` e o mesmo Telegram |
| reinício planejado da VPS | `/srv/mag-site/REBOOT.md` + `/opt/mag-site/bin/reboot-check.sh` (fotos em `/var/lib/mag-site/reboot/`) | só leitura; vale para todos os projetos; inclui o backup manual do ERP VSB |
| resumo diário da CSP | `/opt/mag-site/bin/csp-resumo.sh` (cron 23:58) → `/var/log/mag-site-csp.log` (logrotate do projeto) | só contagens: diretiva, endereço bloqueado, página |

Nada aqui lê ou escreve recursos do BIomie, Leantime, ERP ou sites VSB.

## Catálogo Omie (MAG filial, CNPJ 26.537.584/0003-94)

- `bin/omie-sync.sh` → `docker compose --profile maintenance run --rm omie-sync` → `scripts/sync-omie.mjs`.
- Consulta **somente leitura** (~60 chamadas por noite, uma a cada 2,5 s): `geral/produtos/ListarProdutos` (100 por página),
  `estoque/local/ListarLocaisEstoque` e `estoque/consulta/ListarPosEstoque` por local (50 por página — limite do Omie).
  O local padrão (Estoque BR 116) vem completo, com pendências; os demais só com saldo diferente de zero.
- **O Omie diz o que existe; o site só publica mobiliário e peças** (decisão da MAG, 05/10/2026). Fora do site: inativos,
  bloqueados, tipos 01–03 e 05–10, uniformes/EPI, alimentos, informática (`***`), elétrica, ferragens, papelaria, sinalização,
  cópias de cadastro ("Cópia de…") e tudo que não for reconhecido como móvel ou peça. Continuam no Omie normalmente.
- Categoria pela 1ª palavra do nome, com as abreviações do cadastro (ARM, CAD, GAV, ROUP, LONG, REUNIAO, CONJ…), depois
  palavras-chave. Peças (braço, A/E, assento, encosto, tampo, base, mecanismo, sapata…) vão para "Peças e reposição",
  que fica fora da home e por último na ordenação.
- **Exceções que sobrevivem a toda sincronização**: `/opt/mag-site/catalog/overrides.json`, por código do produto no Omie:
  `{ "8764749209": { "category": "armazenamento" }, "8764750001": { "publish": false }, "8764750002": { "publish": true, "category": "outros" } }`
  (categorias: cadeiras, mesas, estacoes, reuniao, recepcao, armazenamento, escolar, home-office, pecas, outros).
  Arquivo inválido faz a sincronização parar sem mexer no catálogo publicado.
- **Estoque = disponível para venda**: saldo dos locais comerciais − pedidos pendentes e reservas desses locais
  (decisão da MAG, 05/10/2026). Local comercial = "disponível para venda" no Omie e fora de
  `OMIE_LOCATIONS_NOT_COMMERCIAL` (padrão: Avaria, Licitação, Importação, Assistência, Demonstração, Uso interno,
  Mostruário). Locais não comerciais nem são consultados. **Desde 06/10/2026 nenhuma quantidade é pública**: home,
  vitrines, busca, categorias, ambientes, produto, relacionados, orçamento e dados estruturados mostram só o selo
  ("Pronta entrega", "Disponível" ou "Consulte disponibilidade") e, no produto, "Disponibilidade atualizada hoje às
  04:03". A quantidade continua calculada e guardada no `catalog.json` (classificação, ordenação da home — feita no
  servidor —, relatórios e worker); o servidor a retira antes de enviar ao navegador (`publicProduct`,
  `src/lib/omie.server.ts`). Nomes de locais, saldo físico, custo, preço, pendências, reservas e a URL das fotos do
  Omie (S3 assinada) nunca são publicados.
- Limpeza: valores sem sentido do cadastro ("sdf", "0", ".", "ND"…) não aparecem; descrição só quando o Omie tem texto
  próprio (hoje todos os produtos têm a descrição igual ao nome — o site não repete o nome).
- Fotos: baixadas para `catalog/images/` (validadas pelo conteúdo, até 8 MB) e convertidas com sharp em WebP de 1200 px
  (`<hash>.webp`, página do produto) e 480 px (`<hash>-p.webp`, vitrines). As do Omie chegam a 2 MB (PNG 1536 px).
- Proteções: catálogo novo só substitui o anterior se vier completo; queda de mais de 50% no número de produtos é recusada
  (`OMIE_ALLOW_SHRINK=true` para aceitar de propósito); estoque com mais de 30 h some do site e o selo vira "sob consulta".
- Estado da última execução: `/opt/mag-site/catalog/catalog.status.json` (sem segredos). Campos estáveis:
  `status`, `error`, `last_sync_started_at`, `last_sync_completed_at`, `last_successful_sync`, `products_processed`,
  `products_published`, `stock_records_processed`, `images_processed`, `duration_seconds`, `peak_memory_mb`,
  `slugs_created`, `slugs_changed`, `redirects`, `editorial_entries`, `products_without_images(_with_stock)`.
  Uma linha por execução (ok, erro ou dispensada) em `sync-history.jsonl`.
- Rodar na hora: `/opt/mag-site/bin/omie-sync.sh` (log em `/var/log/mag-site-omie.log`).
- Ordem de aplicação: Omie → classificação → `overrides.json` → `editorial.json` → site. O Omie nunca é alterado.

### URLs dos produtos (desde 05/10/2026)

- URL amigável e **permanente**: `/produto/<nome>-<sku>` (ex.: `/produto/armario-alto-fec-2-p-30mm-almeria-00003`).
  Gerada uma única vez e guardada em `catalog/slugs.json` por código do Omie: mudar o nome no Omie **não** muda a URL.
  Colisão → `<nome>-<sku>-<código>`; sem SKU → `<nome>-<código>` (o código Omie é o último recurso). Nunca reaproveita
  um dos 164 endereços de produto do WordPress antigo (`scripts/legacy-product-slugs.json`).
- A URL técnica antiga `/produto/produto-<código>` responde **301 direto** (um salto) para a amigável; com barra no fim
  também (o Nginx tira a barra internamente). Troca de slug pelo editorial → a anterior vira 301 para a nova.
- Canonical, `og:url`, sitemap e links internos usam só a URL amigável. Mapa completo da migração:
  `reports/url-migration-20261005.csv` no código-fonte (959 produtos, 0 colisões, 0 com código).
- Perder o `slugs.json`: a sincronização o reconstrói a partir do `catalog.json` publicado (ver `RESTORE.md`, seção 6).

### Conteúdo editorial (`catalog/editorial.json`, opcional)

Por código do produto no Omie; chaves começando com `_` são comentário. Arquivo inválido faz a sincronização parar
sem mexer no catálogo publicado (mesma regra do `overrides.json`, que continua valendo para classificação).

    { "_leia": "editorial do site; o Omie não é alterado",
      "8764749209": { "commercial_name": "Armário Alto Almeria 2 Portas", "slug": "armario-alto-almeria-2-portas-00003",
        "short_description": "…", "long_description": "…", "seo_title": "…", "seo_description": "…",
        "category_override": "armazenamento", "environment_override": ["operacional"], "featured": true,
        "home_priority": 10, "published": true,
        "technical_specs": [{ "label": "Altura", "value": "1,60 m" }], "marketing_highlights": ["Chave e 2 portas"] } }

Limites: nome 160, resumo 400, descrição 6.000, título SEO 120, descrição SEO 320, até 30 especificações e 12 destaques;
`home_priority` 1–999 (menor aparece antes na home). Textos passam pela mesma limpeza do Omie (sem HTML).
Para um painel no futuro (ou o CMS), os campos são os mesmos — basta gerar este arquivo.

### Fotos faltando

`catalog/reports/products-without-images.csv` (Excel: `;`, UTF-8 com BOM), refeito a cada sincronização:
SKU, nome, categoria, estoque disponível, URL, prioridade e motivo. Prioridade: 1 = com estoque; 2 = está na home;
3 = categoria estratégica (cadeiras, mesas, estações, reunião, armazenamento, recepção); 4 = demais.
Em 05/10/2026: 537 sem foto, 219 deles com estoque. As fotos entram cadastradas no Omie (o site não busca na internet).

### Alerta (Telegram)

- Silencioso quando está tudo bem. 04:00 falhou e 06:40 deu certo → só log. **04:00 e 06:40 falharam** → alerta
  (chamado por `omie-sync.sh` depois da reserva). Verificação de hora em hora (`:17`, fora de 04–06 h): último sync
  válido há **mais de 26 h** → alerta. No máximo um alerta a cada 20 h; também acende o aviso do login SSH.
- Configurar (desde 16/11/2026, só na VPS, como root, num terminal): criar o bot no @BotFather, adicioná-lo ao grupo
  dos alertas e rodar `deploy/bin/telegram-configurar.py` da release. O token é digitado sem eco (nunca em chat,
  endereço aberto no navegador, argumento de comando ou log); o número do grupo é descoberto pela API mostrando só o
  identificador; `/opt/mag-site/secrets/alert.env` (pasta 700, arquivo root:root 600) é gravado de forma atômica com
  `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`, e sai uma mensagem de teste. `--chat-id` só mostra o número, com o token
  já gravado. Testar: `/opt/mag-site/bin/omie-alert.py teste` e o ciclo do alerta do servidor (alerta, lembrete,
  recuperação; problema fictício e estado temporário): `/opt/mag-site/bin/saude-host.py --testar-alertas`.
  Telegram fora do ar não para nada: cada script registra só o tipo do erro (nunca a URL, que leva o token).
  Ver a mensagem sem enviar: `/opt/mag-site/bin/omie-alert.py reserva 1 --dry-run`.
- Sem `alert.env` (situação em 05/10/2026) o alerta fica registrado no log e no aviso do login.
- **Backup** (desde 05/10/2026): falha na geração (`backup.sh` ≠ 0), pacote não localizado, cópia externa ou hash →
  `vps-backup-alerta` (marcador + aviso no login, como sempre) chama o gancho `/srv/mag-site/backup-alerta.sh`, que roda
  `omie-alert.py backup <etapa> <código> <log>`: mensagem "🚨 MAG — Falha no backup" com data/hora, etapa, backup local,
  offsite, hash, erro (sem segredos) e servidor, montada a partir do log da execução. Sucesso não chama nada.
  Sem Telegram fica no `/var/log/vps-backup-alertas.log` e no login; o backup nunca falha por causa do alerta.
  Ver sem enviar: `omie-alert.py backup envio-externo 2 /var/log/vps-backup-mag-site.log --dry-run`.

## Carreiras (RH/DHO) — desde 06/10/2026

- Páginas: `/carreiras` (cultura com os valores Acolher, Orientar, Resolver e Evoluir — nenhum benefício inventado —,
  áreas, vagas abertas e banco de talentos), `/carreiras/vagas/<slug>` e `/carreiras/banco-de-talentos`.
- Vagas na tabela `jobs` do banco do site, cadastradas em `/interno/vagas` (Admin e DHO). Campos: título, slug, área,
  local, modelo (presencial/híbrido/remoto), contratação, horário, resumo, descrição, responsabilidades, requisitos,
  diferenciais (um item por linha), status, abertura, "inscrições até" e prioridade.
- Estados: **rascunho** (só no painel; a URL pública dá 404) → **publicada** (no site enquanto estiver no prazo; vencida
  sai sozinha) → **encerrada** (a mesma URL continua, com aviso, sem formulário, `noindex`, sem JobPosting e fora do
  sitemap). Publicada não volta a rascunho e o slug fica fixo depois da 1ª publicação (links compartilhados não quebram).
  Vaga aberta tem `JobPosting` (schema.org) e entra no sitemap. Endereço malformado → 404.
- Candidatura (vaga ou banco de talentos): nome, e-mail, WhatsApp/telefone, cidade, LinkedIn (opcional, só linkedin.com),
  apresentação (opcional) e currículo. Consentimento LGPD obrigatório e desmarcado; "também quero ficar no banco de
  talentos" é opcional; nenhum consentimento de marketing. A vaga é conferida no servidor (título e ID vêm do banco).
- **Currículo**: só PDF até 5 MB, conferido pelo conteúdo (`%PDF-`) e recusado com conteúdo ativo (`/JavaScript`,
  `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/XFA`); gravado com nome aleatório em `data/resumes/` (700 magsite, fora
  de qualquer pasta servida, nunca executado); o caminho não sai do servidor. Download só pelo painel (Admin/DHO),
  sempre como anexo, `no-store`, CSP `sandbox`, auditado (`resume:download`).
- Abuso: honeypot, 5 envios por IP a cada 15 min e 5 por e-mail por dia (mesmo limitador do site); Turnstile quando ligado.
- Painel `/interno/candidaturas`: abas Vagas e Banco de talentos (cadastro espontâneo + quem pediu na candidatura +
  status "banco de talentos"); filtros por vaga, status, área, nome, cidade e período. Status internos, nunca públicos:
  novo, em análise, contato realizado, entrevista, banco de talentos, encerrado (os antigos foram convertidos).
- Permissões: Admin e DHO veem vagas e candidaturas; Comercial não (menu escondido e o servidor responde "sem
  permissão"). Ações gravadas em `audit_log` (`job:create`, `job:update`, `job:status:<estado>`,
  `update:job_applications`, `resume:download`). Sessão com cookie `HttpOnly`/`Secure`/`SameSite=Lax`; 2FA pode entrar
  depois sem mudar as tabelas.
- Nenhum e-mail ou WhatsApp automático (a VPS não tem MTA; ver pendências).
- Formulário (desde 06/10/2026, tarde): a autorização obrigatória vale **só para a vaga**; o banco de talentos é uma
  segunda opção, desmarcada e explicada ("se eu não marcar, meus dados serão usados só nesta vaga").
- **Retenção** (preparada, sem valor definido): `RECRUITMENT_RETENTION_MONTHS` (vaga) e `TALENT_BANK_RETENTION_MONTHS`
  (banco; sem ele vale o da vaga), de 1 a 120 meses a partir da candidatura, em `secrets/site.env` + `docker compose up -d web`.
  O painel mostra em cada candidatura a finalidade, se está no banco de talentos e a expiração prevista ("a definir"
  enquanto não houver prazo; "vencida" em vermelho depois). **Nada é apagado automaticamente.** Relatório só leitura,
  sem nome/e-mail/telefone: `cd /opt/mag-site && docker compose run --rm -T web node scripts/recruitment-retention.mjs`.
- Rascunho da Política de Privacidade para revisão humana/jurídica: `docs/politica-de-privacidade-RASCUNHO.md` no
  código-fonte (não publicado; `/privacidade` segue provisória até a aprovação).

## Redes sociais — desde 06/10/2026

- Site: seção "MAG nas redes" na home (até 3 vídeos do YouTube + até 3 itens das outras redes), página `/redes`
  (indexável, no sitemap) e ícones no rodapé. Cards próprios da MAG: miniatura local + link para a publicação
  original; 9:16 para reels/TikTok, 16:9 para YouTube. Nenhum script ou widget das plataformas; o player do YouTube
  (`youtube-nocookie.com`) só carrega ao clicar **e** com consentimento de marketing — sem ele, o clique abre o YouTube.
  Nenhuma URL por publicação e nada das redes no sitemap. Rede sem conteúdo não mostra card vazio nem erro.
- Perfis oficiais **confirmados manualmente pela MAG em 06/10/2026** (`src/config/social.ts`; o painel `/interno/redes`,
  só Admin, pode sobrescrever), todos em modo **manual** — aparecem no rodapé, em `/redes` e no `sameAs` sem credencial:
  Instagram `https://instagram.com/magmoveiscorporativos` · LinkedIn `https://www.linkedin.com/company/magmoveiscorporativos`
  (a outra página da MAG nunca é usada) · TikTok `https://www.tiktok.com/@mag.moveis` · YouTube
  `https://www.youtube.com/@magmoveiscorporativos7222`. Modo "api" só com a credencial e a conta conferida.
- **Conta conferida:** o worker grava de que conta veio o conteúdo (YouTube: @handle do canal; Instagram: usuário do
  token; TikTok: @usuário dos links dos vídeos; LinkedIn: página da organização pela consulta oficial). Se divergir do
  endereço oficial configurado, o painel mostra "NÃO confere" e o **site não publica** o conteúdo da API daquela rede.
  `/redes`: redes com publicações têm seção própria; as que só têm o perfil ficam juntas em "Perfis oficiais da MAG".
- Modo por rede: `api` (worker), `manual` (destaques do painel: link da publicação + texto + imagem opcional JPG/PNG/WebP
  até 2 MB, conferida pelo conteúdo, nome aleatório em `data/social-uploads/`) ou `disabled` (não aparece).
- Fluxo: API oficial → `bin/social-sync.sh` (cron `:25` de hora em hora, `flock`, `docker compose run social-sync`)
  → `catalog/social/` → site. O site **nunca** chama as APIs durante uma visita (lê o cache, revalidado a cada 15 s);
  cada item do cache é validado (domínio da rede, campos) e o inválido é descartado.
- APIs: YouTube Data API v3 (channels → playlist de uploads → videos; sem Search API; ~3 unidades de cota por hora);
  Instagram API com login do Instagram (`/me/media`; token de 60 dias renovado a cada 7); TikTok Display API
  (`/v2/video/list/`, refresh token); LinkedIn Community Management API (`/rest/posts` da organização, só PUBLISHED e
  PUBLIC). Sem scraping e sem senha de ninguém.
- Credenciais (nenhuma em 06/10/2026) em `/opt/mag-site/secrets/social.env` (root, 600), lido só pelo `social-sync`:
  `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID` · `INSTAGRAM_ACCESS_TOKEN` · `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`,
  `TIKTOK_REFRESH_TOKEN` · `LINKEDIN_ORGANIZATION_ID`, `LINKEDIN_ACCESS_TOKEN` (opcionais `LINKEDIN_REFRESH_TOKEN`,
  `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`). Tokens renovados pelas plataformas: `social-state/tokens.json` (600).
  Gravar só com `/opt/mag-site/bin/social-credenciais.py definir <rede>` (sem eco; `status` mostra o que existe sem
  revelar valores). Depois: `/opt/mag-site/bin/social-sync.sh --forcar`, conferir no painel "conectado" e a **conta
  sincronizada** (canal, perfil ou organização de onde veio o conteúdo) e só então mudar a rede para "API".
  Passo a passo de cada rede (portais, permissões, aprovações, tokens): `/srv/mag-site/REDES.md`. ID do canal do YouTube
  pela API oficial a partir do @handle oficial: `social-credenciais.py youtube-canal <URL>` (grava só com CONFIRMO);
  página do LinkedIn: `social-credenciais.py linkedin-verificar <URL>` (o ID tem de ser exatamente a página oficial).
- LinkedIn: organização sempre a informada em `LINKEDIN_ORGANIZATION_ID` (nunca pelo nome; há mais de uma página
  pública da MAG); consultado a cada 6 h (`LINKEDIN_SYNC_HOURS`) por causa do limite do tier de desenvolvimento.
- Teste de queda: `/opt/mag-site/bin/social-simular-queda.sh` (as APIs apontam para 127.0.0.1 só dentro do container):
  cada rede configurada fica "erro", o site mantém o último conteúdo; depois `social-sync.sh --forcar`.
- Falhas: sem credencial = "desconectado" e nenhuma chamada; erro numa rede = mantém o último conteúdo bom, registra o
  erro (sem segredo, sem URL) e as outras seguem; resposta vazia ou cortada não apaga o conteúdo; credencial removida =
  o conteúdo daquela rede sai. `social.json` só é regravado quando muda. Estado por rede (conectado/desconectado/erro,
  última tentativa, último sucesso, itens, último erro) em `catalog/social/social.status.json` e no painel; histórico
  (500 linhas) em `social-history.jsonl`; log em `/var/log/mag-site-social.log`.
- Miniaturas: baixadas pelo worker (só imagem, até 8 MB; vídeo nunca), convertidas em WebP de 720 px e servidas por
  `/social-images/` (nosniff, CSP `sandbox`); renovadas a cada 7 dias e apagadas quando a publicação sai da lista.

## Consulta rápida (painel) — desde 07/10/2026

- `/interno/produtos` ("Consulta rápida" no menu): **só Admin e Comercial**. DHO não vê o menu e recebe 403 (página e
  API); sem sessão, 401 (a página volta para o login). Mesma regra no servidor para todas as rotas.
- **Busca:** no navegador, sobre o índice interno carregado uma vez (`GET /api/interno/produtos`, só os produtos
  publicados no site): nome, parte do nome, palavras fora de ordem, sem acento, SKU (com ou sem zeros à esquerda) e
  código do Omie. **Nenhuma chamada ao Omie (nem ao servidor) a cada tecla.** Filtros: Todos, Com estoque, Sem estoque,
  Cadeiras, Mesas, Armários, Estações, Peças/reposição. Card: foto do site, nome, SKU, categoria, estoque da última
  sincronização (número interno) e horário. Detalhes: "Disponível para venda" da sincronização (mesma regra do selo
  "Pronta entrega" do site) e link "Abrir produto no site".
- **"Consultar Omie agora"** (botão nos detalhes): `POST /api/interno/produtos/<código>` (mesma origem) → site → serviço
  `omie-consulta` (`http://omie-consulta:3100`, token `OMIE_CONSULTA_TOKEN`) → Omie, **1 chamada somente leitura**:
  `estoque/consulta` `ListarPosEstoque` com `lista_produtos=[produto]` e `lista_local_estoque=TODOS`
  (+ `estoque/local` `ListarLocaisEstoque` a cada 6 h). Mostra estoque físico por local (incluindo Avaria, Licitação e
  Importação, marcados "fora da venda"), **Total físico Omie** (todos os locais, só informativo) separado do
  **Disponível comercial** (bruto comercial − comprometido, com pedidos pendentes e reservas) e o horário exato.
  A regra do disponível é a do `sync-omie.mjs` (reaproveitada, não alterada): só locais comerciais; por local conta o
  maior entre pendente e reservado. O worker noturno e o site público não mudaram.
- **Chaves do Omie:** só nos containers `omie-sync` e `omie-consulta` (`secrets/omie.env`). O container `web` recebe só
  `OMIE_CONSULTA_URL` e o token interno (`secrets/omie-consulta.env`, root 600, 64 hex). O navegador nunca fala com o Omie.
- **Proteções:** resultado reaproveitado por 5 min no site (`OMIE_CONSULTA_CACHE_SECONDS`, 60–900) e por 65 s no serviço
  (regra de requisição redundante do Omie); 1 chamada por vez, ≥ 1,1 s entre elas; teto de 120 chamadas/hora;
  30 consultas reais por usuário a cada 10 min; pausa de 30 min se o Omie responder 425 (bloqueio) ou recusar as
  chaves, e de 2 min se pedir para aguardar; **nenhuma chamada enquanto a sincronização noturna roda**
  (`catalog/catalog.json.lock`).
- **Falhas:** Omie fora, erro, pausa ou serviço parado → a resposta é 200 com o motivo e o painel mostra "Não foi possível
  consultar o Omie agora" + a última sincronização; nunca erro 500. A busca continua funcionando.
- **Auditoria** (`audit_log` do banco): `omie:consulta` (usuário, código do produto, horário) a cada chamada real ao Omie;
  `omie:consulta:erro:<motivo>` nas falhas do Omie/serviço. Reaproveitamento de cache, trava da sincronização e limite
  por usuário não são registrados. Log do serviço (JSON, sem chaves nem token): `docker compose logs omie-consulta`.
- **Nada disso é público:** os números ficam só nas APIs `/api/interno/produtos*` (sessão + perfil, `no-store`,
  `noindex`) e no painel. O site continua mostrando só "Pronta entrega" ou "Consulte disponibilidade".
- Trocar o token interno: `umask 077; printf 'OMIE_CONSULTA_TOKEN=%s\n' "$(openssl rand -hex 32)" > /opt/mag-site/secrets/omie-consulta.env`
  e depois `cd /opt/mag-site && docker compose up -d --force-recreate web omie-consulta`. **Não apagar o arquivo**: o
  `compose.yaml` exige ele para o `omie-consulta`.
- Saúde do serviço: `docker compose ps omie-consulta` (healthcheck interno `/saude`, que mostra pausa e chamadas da
  última hora, sem segredos).
- **"Mostrar todos os produtos do Omie"** (desde 07/10/2026, release `20261007-0900`): chave no painel, desligada por padrão.
  Liga o cadastro completo `catalog/interno/omie-produtos.json` (~1.540 produtos: publicados, ocultos, peças, itens
  administrativos, inativos e bloqueados), gerado às 05:20 por `bin/omie-indice.sh` → serviço `omie-indice` →
  `geral/produtos` `ListarProdutos` (100 por página, ~16 chamadas, `exibir_caracteristicas=N` para nunca coincidir com
  a sincronização pública). Só metadados: código Omie, SKU, nome, EAN/código de barras, marca, família, unidade,
  inativo/bloqueado e a categoria do site quando o nome a indica (mesma regra do catálogo). Sem estoque (só pelo
  "Consultar Omie agora"), sem preço e sem fotos: fora do site vale a imagem neutra (o sincronizador apaga as fotos de
  quem sai do site, então não há foto local para reaproveitar; nenhum download). A busca também acha por EAN e família;
  selos "Fora do site", "Inativo no Omie", "Bloqueado no Omie"; "Com/Sem estoque" só consideram quem tem estoque
  calculado. Nada disso vai ao site: só as APIs internas leem o arquivo (testado: nome e EAN de produto oculto não
  aparecem em nenhuma página pública nem no sitemap).
- Proteções do cadastro completo: trava própria (`/run/mag-site-omie-indice.lock`), nunca a da sincronização pública; se
  ela ainda estiver rodando, espera até 30 min e desiste (fica o cadastro anterior); resposta com menos da metade dos
  produtos do anterior não o substitui (`queda_suspeita`); falha vai para `omie-produtos.status.json` e para o log, e o
  painel avisa "cadastro completo desatualizado" (mais de 30 h ou última tentativa com erro).
- Conferência sem chamar o Omie: `/opt/mag-site/bin/omie-consulta-verificar.sh` — segredos 600 root e token no formato,
  saúde dos dois containers, consulta local de teste pelo container do site (`/verificar` com o token certo e com um
  errado; `/estoque/0` recusado antes de qualquer chamada ao Omie), site sem as chaves do Omie, API interna 401 sem
  sessão e cadastro completo presente. `--preparar` só garante token e permissões (usado pelo restore).

## Orçamento interno e Pedido de Venda no Omie — desde 07/10/2026 (release `20261007-1356`)

- **Primeira escrita do site no Omie.** Fluxo: orçamento interno (`/interno/orcamentos-internos`, Admin e Comercial; DHO 403;
  sem sessão 401) → rascunho → salvo → enviado → **aceito pelo cliente** (itens e preços travam) → "Gerar Pedido no Omie"
  → revisão obrigatória → confirmação explícita → Pedido de Venda. Também nasce de um pedido do site ("Criar orçamento
  interno" na tela do pedido: cliente e itens copiados; preços digitados pelo Comercial). Número `MAG-Q-AAAA-NNNNN` =
  `codigo_pedido_integracao` no Omie, criado uma vez e nunca alterado. Estados: rascunho, salvo, enviado, aceito,
  enviado_omie, erro_omie, cancelado (nada é apagado).
- **Escrita no Omie: DESLIGADA por padrão.** Só o serviço `omie-pedidos` escreve, e só com `OMIE_ORDER_WRITE_ENABLED=true`
  no `/opt/mag-site/.env`. Desligada (sem a linha ou `false`), "Gerar Pedido" monta, valida e SIMULA (nada vai ao Omie).
  Ligar (só com autorização): `echo OMIE_ORDER_WRITE_ENABLED=true >> /opt/mag-site/.env && cd /opt/mag-site &&
  docker compose up -d --wait omie-pedidos`. Desligar: apagar a linha (ou `=false`) e o mesmo `up`. O `/interno/omie` e o
  `bin/omie-consulta-verificar.sh` mostram o modo atual. Restauração e `restore.sh` voltam SEMPRE desligado.
- **O que o painel faz no Omie (lista fechada no serviço):** lê vendedores, etapas, formas de pagamento, categorias, contas,
  clientes, pedido e status; estoque em lote na revisão (mesma regra do disponível comercial); escreve SÓ `IncluirPedido` e
  `IncluirCliente`. Nunca fatura (etapa 50 bloqueada no painel e no serviço), nunca emite NF-e, nunca exclui, altera ou
  cancela nada, nunca mexe em estoque. `enviar_email` sempre "N".
  Cada item vai com `reservado: "N"` (o painel nunca reserva estoque; em 08/10/2026 os 248 itens dos 133 pedidos da MAG
  dos 15 dias anteriores estavam sem reserva). `enviar_pix` não é enviado: a documentação do Omie só permite preencher uma das
  tags enviar_email/enviar_pix e o padrão das duas é "N" (conferido na leitura de volta). Logo depois de criar, o serviço lê o
  pedido de volta (ConsultarPedido pelo código do Omie) e confere campo a campo: cliente, vendedor, itens (produto,
  quantidade, preço, desconto, sem reserva), condição, etapa, categoria, conta e total. Divergência aparece em vermelho no
  painel e na auditoria (`conferido:false`); o pedido continua criado (nada é reenviado). E-mail para a NF (`utilizar_emails`) é
  obrigatório no Omie: sem ele a revisão bloqueia; o botão "Usar o e-mail do cadastro do cliente no Omie" grava o do cadastro
  (o mesmo que o ERP usa) sem digitar. Na revisão e no pedido simulado ele aparece só mascarado; nunca vai para log/auditoria.
- **Revisão obrigatória** (desde 08/10/2026, 17h o pedido é montado SÓ da versão aceita da proposta — ver "Proposta comercial"): estoque de todos os itens consultado na hora (quantidade × disponível; faltando, aviso forte e,
  pela configuração padrão, confirmação "encomenda"); vendedor do DONO do orçamento conferido no Omie (inativo ou removido
  bloqueia); cliente vinculado e ativo; condição, etapa, categoria e conta válidas; **conferência explícita versão aceita ×
  payload final** (desde 09/10/2026 — ver "Proposta comercial"); pedido validado (a mesma validação roda de novo no serviço).
  Gera um token de revisão de uso único (15 min) amarrado ao conteúdo exato do pedido.
- **Vendedor:** `codVend` = código do `ListarVendedores`, sempre o vinculado ao responsável pelo orçamento. Vínculo
  usuário → vendedor só por confirmação do Admin em `/interno/omie` (sugestão por e-mail igual ou 1º nome; nunca automático).
  Sem vínculo: "Seu usuário ainda não está vinculado a um vendedor do Omie. Solicite ao Admin." Comercial não escolhe outro.
- **Cliente:** busca por CPF/CNPJ (formato do Omie); um candidato com o mesmo documento → "Usar este cliente"; vários → escolha;
  nenhum → criação controlada (só com CPF/CNPJ válido e e-mail; nunca duplica: confere o documento e o código de integração
  `MAG-C-<id>` antes). Sem documento: busca por nome (o filtro do Omie é "contém": mostra os 20 primeiros e pede para refinar) e escolha manual explícita. O vínculo fica no cliente interno (por
  CPF/CNPJ) e vale para os próximos pedidos.
- **Nunca duplica:** código de integração fixo; trava no banco (estado "enviando"; duplo clique e duas abas não enviam duas
  vezes; o token de revisão é de uso único); consulta o Omie pelo código ANTES de incluir (uma consulta só: o serviço
  reaproveita a do site); tempo esgotado, erro de servidor ou "requisição redundante" numa escrita = **incerto** — o
  orçamento fica em erro_omie com o aviso e qualquer nova tentativa (ou o botão "Verificar no Omie") consulta antes;
  reabrir/cancelar ficam bloqueados até resolver. Erro do Omie: orçamento intacto em erro_omie, mensagem sem dado pessoal,
  nova tentativa segura. Depois de criar, o serviço confirma o pedido pelo código do Omie.
- **Pedido achado com o nosso número mas de outro cliente ou com outros itens** (ex.: banco restaurado de um backup antigo
  e a numeração repetiu um número já enviado) = **conflito**: nada é enviado nem vinculado; o orçamento fica em erro_omie
  com o aviso. Solução: avançar a numeração (tabela `counters`, linha `orcamento-AAAA`) para depois do último número já usado no Omie.
- **Regras de consumo do Omie** ([Limites de consumo da API](https://ajuda.omie.com.br/pt-BR/articles/8112984-limites-de-consumo-da-api-do-omie)):
  a mesma consulta só traz dados 1 vez a cada 60 s (repetir prorroga a espera) e 10 requisições com erro no mesmo método
  bloqueiam 30 min (425). O serviço guarda cada resposta de leitura por 65 s (revisar 2 vezes, atualizar dados e revisar
  em seguida etc. não repetem a consulta), nunca refaz a mesma consulta antes disso — a tela diz "O Omie só aceita
  repetir a mesma consulta depois de 1 minuto" — e usa 49 itens por página no estoque (≠ dos 50 da Consulta rápida: os
  dois serviços nunca mandam a mesma requisição). Depois de reiniciar o `omie-pedidos` (ex.: ligar a escrita), espere
  1 minuto antes da primeira revisão. O log mostra o código do erro do Omie (`"omie":"SOAP-ENV:Client-..."`), nunca a mensagem.
- **Depois de criado:** "Pedido Omie #número", enviado em/por, vendedor, cliente e "Atualizar status do Omie" (sob demanda:
  etapa com a descrição do Omie, faturado, cancelado). Faturar, alterar ou cancelar: só no Omie.
- **Configuração (Admin, `/interno/omie`):** etapa padrão (só 10–40 da Venda de Produto), condição de pagamento padrão,
  categoria de receita, consumidor final padrão e pedido sem estoque (confirmar/permitir/bloquear). **Sem conta corrente
  padrão** (09/10/2026; a chave antiga `conta` em `omie_settings` não é mais lida) — ver "Conta corrente da venda".
  "Atualizar dados do Omie agora" + cron 05:40 (`bin/omie-referencias.sh`); falha mantém o último cadastro válido;
  vendedor que some do Omie é marcado (nunca apagado) e deixa de poder ser usado.
- **Auditoria** (`audit_log`, coluna `details` só com ids, resultado, duração e motivo): `quote:created`, `quote:accepted`,
  `quote:status:*`, `omie_order:simulated`, `omie_order:create_attempt`, `omie_order:created`, `omie_order:failed`,
  `omie_order:verified`, `omie_order:status_sync`, `omie_customer:linked|created|failed|simulated`, `seller_mapping:changed`,
  `omie_settings:changed`, `omie_reference:sync`. Simulação, tentativa e criação registram à parte `quote_created_by` (dono do
  orçamento), `omie_order_created_by` (quem clicou em Criar; pode ser o Admin) e `omie_seller`/`omie_seller_nome` (sempre o
  vendedor vinculado ao dono — quem executa não escolhe vendedor). Logs do serviço (`docker compose logs omie-pedidos`): rota, resultado e
  duração — nunca payload, CPF/CNPJ, e-mail, telefone, endereço ou chave.
- Conferência sem chamar o Omie: `/opt/mag-site/bin/omie-consulta-verificar.sh` (agora também o omie-pedidos e o modo de escrita).

## Proposta comercial (PDF timbrado) — desde 08/10/2026

- **Onde:** card "Proposta comercial" no orçamento interno. Admin: todos os orçamentos; Comercial: só os próprios; DHO 403;
  sem sessão 401. Ações: Gerar proposta (v1) / Gerar nova versão (vN), Visualizar, Baixar PDF, Imprimir, WhatsApp, E-mail e
  Compartilhar; histórico "v2 — 08/10 11:05 — gerada por Mateus". Nada aqui chama o Omie.
- **Versões (retrato):** cada geração grava `quote_proposals` (versão, quem, quando, `snapshot` JSON com cliente, itens, preços,
  descontos, condições, consultor, observações e os dados institucionais da hora). O PDF é sempre refeito do retrato (pdf-lib,
  A4, Helvetica) e conferido com `pdf_sha256`: a proposta enviada não muda se produto, preço, foto ou cadastro mudarem.
  "Orçamento alterado depois da última proposta gerada." aparece quando o CONTEÚDO do orçamento muda depois da última versão
  (`content_hash`: cliente, itens, preços, descontos, frete, montagem, desconto geral, condição, previsão, validade e observações
  comerciais; notas internas, observações do pedido no Omie e e-mail da NF não contam). Clique duplo (mesmo conteúdo em 30 s)
  não cria versão nova.
- **Gerar não é aceite.** Rascunho vira "salvo" (exige o mesmo de "Salvar orçamento"); o andamento na tela é Rascunho → Proposta
  gerada → Enviado ao cliente → Aceito → Pedido Omie criado, e cada passo é marcado por alguém. Nova versão só em rascunho,
  salvo ou enviado; depois do aceite as versões continuam para ver e baixar. Validade vazia = hoje + padrão do Admin (gravada
  no orçamento); validade vencida bloqueia a geração.
- **No PDF:** logo, nome comercial, razão social, CNPJ, endereço e contatos (`/interno/proposta`, Admin), número, versão, data,
  validade, cliente (empresa, fantasia, A/C, CPF/CNPJ, cidade, e-mail e telefone do orçamento), consultor(a) = DONO do
  orçamento, itens com foto, SKU (opcional por versão), descrição, quantidade, preço, desconto e total, subtotal, desconto geral,
  frete, montagem, total, condição de pagamento, previsão, validade, texto das condições e observações comerciais; cabeçalho e
  rodapé em todas as páginas, "Página i de N"; totais, condições e assinatura ficam juntos. **Nunca:** estoque numérico,
  locais (Avaria, Licitação, Importação), custo, margem, notas internas, observações do pedido no Omie ou códigos do Omie.
- **Pronta entrega:** só o selo "Pronta entrega" quando o catálogo publicado (fresco) marca o produto assim E o disponível
  cobre a soma das quantidades do produto no orçamento (o número nunca sai do servidor). Fotos: as do catálogo do site
  (`/app/catalog/images`, versão "-p"); WebP vira JPEG com o sharp de `/app/scripts`. Sem foto ou sem sharp: quadro neutro.
- **PDF:** `GET /api/interno/orcamentos-internos/<id>/proposta/<versão>?modo=visualizar|imprimir|baixar|compartilhar` — sessão,
  perfil e dono conferidos a cada pedido; `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`, nosniff;
  nenhum dado do cliente na URL; 120 PDFs por 10 min por usuário. **Não existe link público:** "Compartilhar" usa o
  compartilhamento nativo do aparelho com o ARQUIVO (celular e navegadores compatíveis; nos demais, Baixar PDF).
  Nome do arquivo: `MAG-Orcamento-<número>-<Cliente>[-vN].pdf` (sem acento, sem sufixo LTDA/ME…, nunca CPF/CNPJ).
- **WhatsApp:** abre `wa.me` com a mensagem pronta e editável (nome, número, resumo, total, condição, disponibilidade, validade);
  o PDF não vai junto (o vendedor baixa e anexa; nada de automação não oficial).
- **E-mail:** prévia com Para, Assunto, Mensagem e o PDF; nunca envia ao abrir. Sem envio pelo servidor (padrão): "Abrir no
  programa de e-mail" (mailto) + Baixar PDF. Envio pelo servidor **preparado e DESLIGADO**: só com `PROPOSTA_EMAIL_ENVIO=ligado`,
  `RESEND_API_KEY` e `EMAIL_FROM` (remetente verificado; SPF/DKIM do domínio) no ambiente do `web` — ligar só com autorização.
  Ligado: confirmação explícita na tela, até 3 destinatários, Reply-To = consultor, 10 envios por hora por usuário.
- **Dados da proposta (Admin, `/interno/proposta`):** tabela `proposal_settings`; padrão = dados públicos do site + razão social
  MAGAZINE DOS MOVEIS LTDA; validade padrão 7 dias (1–90); texto das condições opcional. Valem para as próximas versões.
- **Perfil comercial (desde 08/10/2026 noite):** "Minha conta" → "Perfil comercial (proposta)" (tabela `proposal_profiles`): nome,
  cargo, telefone, WhatsApp, e-mail, assinatura (até 3 linhas) e "exibir" para telefone, WhatsApp e e-mail. O PDF usa SEMPRE o
  perfil do DONO do orçamento, nunca o de quem clicou em Gerar (Admin gerando para o Mateus sai como Mateus). Contato não
  marcado nunca sai: nem no PDF, nem no retrato, nem na prévia de outra pessoa, nem no texto do WhatsApp/e-mail. Sem perfil:
  nome do vendedor vinculado no Omie (sem o sufixo, ex.: "CAIO - VAR" → "Caio") ou do e-mail, cargo "Consultor(a) comercial" e
  NENHUM contato (o e-mail de login nunca vira contato público; sem e-mail marcado: "E-mail não informado na proposta"). Prévia "Consultor(a) que aparecerá na proposta" no orçamento ("Editar meus dados da proposta" só
  para o dono). Versões antigas (layout 1, sem perfil) são refeitas byte a byte como foram geradas.
- **Versões (desde 08/10/2026 noite):** uma **VIGENTE** por orçamento (índice único `quote_proposals_vigente`); Visualizar/Baixar
  de qualquer versão, mas WhatsApp, e-mail, imprimir, compartilhar e o aceite usam só a vigente. **Estados (desde 08/10/2026,
  17h):** GERADA → COMPARTILHAMENTO INICIADO (abriu WhatsApp/e-mail/compartilhar: o painel não sabe se o cliente recebeu) →
  ENVIADA (só pelo botão "✓ Marcar como enviada ao cliente", pelo "Marcar como enviado ao cliente" do orçamento, pelo aceite ou
  por e-mail despachado pelo provedor oficial) → ACEITA ou RECUSADA ("Cliente recusou esta versão"); a anterior a uma nova vira
  SUBSTITUÍDA. Enviada, recusada e aceita são imutáveis; só compartilhada NÃO congela. Seleção por checkbox: "Arquivar
  selecionadas" (não a vigente nem a aceita; "Desarquivar" volta) e "Excluir rascunhos selecionados" (nunca marcada como enviada,
  recusada ou aceita, e não a vigente). Excluir = soft-delete (`deleted_at`: a linha, o retrato e a auditoria ficam; o PDF deixa de
  abrir). O número nunca é reutilizado (excluída a v2, depois da v4 vem a v5). Histórico mostra as 5 mais recentes + "Ver
  versões anteriores"; acima de 5 a geração pede confirmação (não bloqueia). "Comparar versões": produtos incluídos/removidos/
  alterados (quantidade, preço, desconto), descontos, frete, montagem, condição, validade, previsão e total.
- **Aceite (desde 08/10/2026 noite):** é de uma versão — a vigente, não recusada, e só se o orçamento não mudou depois dela
  (senão: gerar nova versão e enviar). Grava `internal_quotes.accepted_proposal_id` e congela a versão. Depois do aceite ficam
  travados produtos, quantidades, preços, descontos, condição, frete, montagem, total, **previsão comercial**, cliente,
  consultor e o PDF aceito; mudar = "Criar nova revisão" (antigo "Reabrir para edição"): desfaz o aceite, a versão aceita fica
  congelada no histórico ("ACEITA (REVISADA)") e exige nova versão e novo aceite. A previsão NÃO é mais ajustável depois do
  aceite (08/10/2026, 17h). Depois do Pedido criado, a previsão OPERACIONAL muda no próprio Omie, sem tocar na proposta aceita.
- **Brecha da revisão fechada (09/10/2026, tarde):** sequência obrigatória = alteração → nova versão → "✓ Marcar como enviada ao
  cliente" (ou "Marcar como enviado ao cliente" no orçamento) → aceite. (1) Versão já aceita e depois revisada NUNCA é aceita
  de novo, mesmo sem mudança ("A vN já foi aceita e depois revisada…"); fica no histórico, com o retrato e a conta dela, e
  não é reaproveitada. (2) Conta corrente, consumidor final e observações do pedido fazem parte da versão: ficam no retrato
  (bloco interno `pedido`, fora do PDF) e em `quote_proposals.order_hash`; mudou depois de gerar → a versão não é aceita (o resto
  do que vai ao Pedido já estava no hash do conteúdo: cliente, itens, quantidades, preços, descontos, condição, previsão, frete,
  montagem, desconto geral). Versão sem `order_hash` (gerada antes) não é aceita: gerar nova. (3) O aceite exige a vigente
  marcada como ENVIADA. No Pedido, consumidor final e observações vêm do retrato aceito e a revisão/criação bloqueiam se os
  dados do pedido do orçamento vivo divergirem ou se a versão aceita não os registrar (vale para aceites antigos, como o
  MAG-Q-2026-00003: convertê-lo exigiria nova revisão). Ficam fora da versão, conferidos na revisão: e-mail da NF (do
  cadastro do cliente no Omie), cliente vinculado (pelo CPF/CNPJ aceito), vendedor (do dono) e etapa/categoria (Admin).
- **Pedido no Omie nasce SÓ da versão aceita (08/10/2026, 17h):** itens (código do produto, quantidade, preço, desconto), condição
  (`pagamentoCodigo`), previsão comercial e total vêm do retrato da versão aceita; vendedor = o do dono dessa versão; o cliente
  vinculado no Omie precisa ter o CPF/CNPJ da versão aceita. Do orçamento/configuração vêm só dados operacionais travados
  depois do aceite (cliente vinculado, consumidor final, e-mail da NF, observações do pedido) e etapa/categoria/conta do Admin.
  Bloqueia (revisão e criação): orçamento vivo diferente da versão aceita, aceito sem versão aceita registrada, versão aceita
  sem código da condição (anterior a 08/10 noite), previsão aceita já passada, soma dos itens ≠ subtotal. A auditoria do envio
  leva `proposta_versao`.
- **Conta corrente da venda (09/10/2026):** NÃO existe conta padrão. Quem faz a venda escolhe, no orçamento, a conta do Omie
  daquela venda (`internal_quotes.selected_account_id`; Bradesco e Stone primeiro na lista). Sugestão MAG, só como dica (nunca
  escolhe sozinha): vendas maiores, cliente com CNPJ ou pagamento por depósito → Bradesco; vendas menores → Stone — a dica
  automática aparece só para CNPJ/depósito (não há limite de valor definido para "venda maior"). Obrigatória no aceite e
  CONGELADA na versão aceita (`quote_proposals.accepted_account_id`/`accepted_account_label`); a auditoria `quote:accepted` leva
  `conta_corrente`. O Pedido usa só a conta da versão aceita (nunca a do orçamento vivo); trocar depois do aceite = "Criar
  nova revisão" → nova proposta → novo aceite. A conta não sai no PDF, mas faz parte da versão (desde 09/10 tarde): escolha
  ANTES de gerar a proposta — mudar depois exige nova versão marcada como enviada. "Duplicar orçamento" não copia a conta. A revisão mostra "Conta corrente: <conta> · <código> —
  selecionada para esta venda ✓" (inativa no Omie ou aceite sem conta = bloqueio).
- **Integridade da conversão — proposta aceita × Pedido Omie (09/10/2026):** a revisão mostra, antes de qualquer envio, o bloco
  "INTEGRIDADE DA CONVERSÃO": cliente (Omie, com o CPF/CNPJ da versão aceita) ✓, vendedor (do dono da versão aceita, ativo,
  codVend) ✓, conta corrente (a da venda, congelada no aceite) ✓, a versão aceita ao lado do payload que vai ao Omie item a item (SKU e nome, código do produto, quantidade, preço,
  desconto e total), condição, previsão e — sempre à vista, inclusive R$ 0,00 — desconto geral, frete e montagem, com **total
  aceito, total Omie e diferença**, e o veredito "PEDIDO ÍNTEGRO". Qualquer diferença, inclusive R$ 0,01, vira "PEDIDO NÃO
  ÍNTEGRO — criação bloqueada" (sem botão de criar) e a criação refaz a conferência no payload exato que sai (nada é enviado). O
  SKU do lado do Omie é o que o próprio Omie informa na consulta de estoque da revisão (`cCodigo` do ListarPosEstoque, mesma
  chamada — nenhuma consulta a mais); sem ele, "SKU não conferido" vira aviso e o código do produto continua conferido.
- **Observações:** as comerciais da proposta (as do PDF) NUNCA vão ao Omie; ao Pedido vai só o campo operacional "Observações do
  pedido" do orçamento (`obs_venda`). A revisão avisa quando a versão aceita tem observações comerciais. Uma opção explícita
  "Incluir também no Pedido Omie" (mantendo o campo operacional separado) fica para depois.
- **Duplicar orçamento:** número novo (= código de integração novo), mesmo cliente, itens, condições e dados da proposta; sem
  propostas, aceite, envio ao Omie ou notas internas ("Duplicado de MAG-Q-…"); o dono (vendedor) continua o mesmo, mesmo quando
  quem duplica é o Admin. Auditoria `quote:created` (`origem: duplicado`) no novo e `quote:duplicated` no original.
- **Frete, montagem e desconto geral** entram só na proposta. A revisão do Pedido no Omie **bloqueia** versão aceita com esses
  valores (o pedido sairia com valor diferente do aceito; a conferência mostra a diferença) — lançar direto no Omie, ou "Criar
  nova revisão", zerar e registrar novo aceite. Desde 09/10/2026 há **suporte preparado e DESLIGADO** (`EXTRAS_NO_PEDIDO` em
  `src/lib/orcamento-regras.ts`): desconto geral → desconto na capa do pedido (`tipo_desconto_pedido` "V" +
  `valor_desconto_pedido`, que o Omie distribui proporcionalmente nos itens); frete → bloco `frete` (`modalidade` + `valor_frete`;
  falta a MAG definir a modalidade: 0 CIF, 1 FOB, 2 terceiros, 3/4 transporte próprio, 9 sem frete). Desligados, o painel
  bloqueia e o serviço omie-pedidos RECUSA o pedido que os trouxer (nunca descarta em silêncio). Ligar = mudar a política no
  código + homologar os totais lidos de volta + release. **Montagem** continua bloqueando até a MAG definir a regra
  fiscal/contábil (produto ou serviço) — não há suporte preparado.
- **Auditoria** (`audit_log`): `quote:proposta:gerada` com `versao`, `quote_owner`, `proposal_consultant` e `proposal_generated_by`
  (só ids); `quote:proposta:compartilhamento_iniciado` com `{"versao":N,"canal":"whatsapp|email|compartilhar"}`;
  `quote:proposta:visualizar|imprimir|baixar|compartilhar|enviada|recusada|arquivada|desarquivada|excluida` com `{"versao":N}`
  (antes de 08/10 17h: `quote:proposta:whatsapp|email`); `quote:proposta:email_enviado|email_falhou` com versão e quantidade de destinatários; `quote:accepted` com
  `proposta_versao`; `proposal_settings:changed` e `user:proposal_profile` (só os nomes dos campos). Nunca CPF/CNPJ, telefone,
  e-mail, endereço ou conteúdo do PDF/e-mail.
- **Banco:** colunas novas em `internal_quotes` (`customer_contact`, `proposal_notes`, `valid_until`, `freight_cents`,
  `assembly_cents`, `general_discount_cents`, `accepted_proposal_id`), tabelas `quote_proposals` (com `current`, `owner_id`,
  `consultant_id`, `sent_at`, `share_started_at`, `share_channel`, `accepted_at`, `refused_at`, `archived_at`, `deleted_at` e
  quem), `proposal_settings`, `proposal_profiles` e `users.display_name` — criadas ao subir (nada apagado). Versões que já
  existiam ganharam vigente (a mais recente) e dono/consultor (o dono do orçamento); "enviada" só ficou onde o orçamento foi
  marcado enviado/aceito com aquela versão vigente — WhatsApp/e-mail/compartilhar virou "compartilhamento iniciado". Nada do
  retrato, PDF, autor ou horário muda. Tudo no `site.sqlite`: backup e restauração sem mudança.

## Endereços antigos e SEO

O domínio teve um WordPress (até 2026) **invadido com ~500 páginas de spam** de cassino/apostas (nov/2025–jun/2026,
Internet Archive). `/etc/nginx/conf.d/mag-site.conf`: endereços legítimos antigos (sobre-nos, contato-3,
/categoria-produto/…, /produto-tag/…, posts de 2022…) → **301** para a página nova ou para a busca do catálogo; restos do
WordPress e qualquer endereço de 1 nível que não exista no site novo → **410**; barra final → 301 sem barra.
Produtos da loja antiga: **só os 164 endereços que existiram** (`scripts/legacy-product-slugs.json`, em blocos < 4 KB —
o Nginx recusa parâmetro maior) → 301 para a busca. Nunca voltar a um padrão genérico `/produto/<qualquer>`: isso
sequestraria as URLs amigáveis do catálogo novo. `/produto/<desconhecido>` → 404.
**Ao criar rota nova de 1 nível no site, incluí-la na lista do mapa `$mag_site_gone`**, senão ela responde 410
(`redes` incluída em 06/10/2026).
Recomendado: Google Search Console (Problemas de segurança, Ações manuais, enviar `sitemap.xml`).
Nunca reaproveitar arquivos ou banco do WordPress antigo (o CMS novo deve ser instalação limpa).
**Produto inativado** (política confirmada em 05/10/2026, caso SKU 00069 inativado no Omie às 14:39 — sem regra nova):
- produto ativo com estoque zero continua publicado ("sob consulta"; 458 em 05/10);
- inativo, bloqueado ou de tipo fora do site no Omie sai do catálogo e do sitemap; URL amigável e `produto-<código>` → 404;
- o slug fica reservado no `slugs.json` (nenhum outro produto pode usá-lo) e a reativação devolve a MESMA URL e o 301
  de `produto-<código>`, mesmo com outro nome (simulado com o registro de produção). Se voltar com o nome "INATIVO5",
  o classificador não o reconhece como móvel: corrigir o nome no Omie ou publicar por `overrides.json`;
- nunca redirecionar automaticamente inativo para início, categoria ou produto parecido. 301 só para um sucessor
  definido editorialmente (ainda não existe esse campo).

## Segurança (endurecimento de 05/10/2026)

- **JSON-LD**: todo `<script type="application/ld+json">` é gerado por `jsonLd()` (`src/lib/seo.ts`), que troca
  `< > & U+2028 U+2029` por escapes unicode — dado do Omie/editorial não fecha mais o `<script>` (falha confirmada e
  corrigida na release `20261005-1512`; testes `tests/json-ld*.test.mjs`). Nunca usar `JSON.stringify` cru ali.
- **Nginx**: `server_tokens off;` global em `/etc/nginx/nginx.conf` (linha 21, antes comentada; vale para a VPS toda).
- **SSH**: `X11Forwarding no` em `/etc/ssh/sshd_config.d/02-sem-x11forwarding.conf` (drop-in, mesmo padrão do
  `01-biomie-hardening.conf`; porta, usuários, chaves e senha intocados).
- **CSP em modo só relatório** (vhost, `Content-Security-Policy-Report-Only` + `Reporting-Endpoints`): nada é bloqueado.
  Política: tudo do próprio domínio + Google Fonts (`fonts.googleapis.com` CSS, `fonts.gstatic.com` fontes); `img-src
  'self'`, `connect-src 'self'`, `frame-src https://www.youtube-nocookie.com` (desde 06/10/2026: só o player do YouTube, ao clicar e com consentimento de marketing), `frame-ancestors 'self'`, `base-uri 'self'`, `form-action 'self'`,
  `object-src 'none'`, sem `'unsafe-eval'`; `'unsafe-inline'` mantido em scripts e estilos porque o framework depende dele.
  Relatórios: `POST /api/csp-report` (público por necessidade; endurecido na release `20261005-1626` após auditoria):
  só POST (outros métodos → 405 vazio), só `application/csp-report`, `application/reports+json` ou `application/json`
  (senão 415), corpo lido em fluxo até 16 KB, até 10 relatórios por requisição, 20 linhas/min por IP e 60/min no
  total, caracteres de controle/formatação/separadores → "?", resposta 204 vazia, sem IP, sem banco, sem arquivo.
  Consultar: `/opt/mag-site/bin/csp-resumo.sh [horas]`; o cron das 23:58 grava o resumo do dia em
  `/var/log/mag-site-csp.log`. O log do container recomeça a cada release: durante a observação, antes de publicar,
  rodar `csp-resumo.sh 24 >> /var/log/mag-site-csp.log`. Mapeamento de 05/10: 0 violações em 17 páginas; primeira
  violação real: `font-src data:` na home (provável extensão do navegador de um visitante — o site não usa fonte data:).
  **Antes de passar a bloquear**: acompanhar os relatórios por 2–4 semanas; para tirar `'unsafe-inline'` de
  `script-src` é preciso nonce nos scripts de hidratação do TanStack (`ssr.nonce` do router + CSP enviada pelo app ou
  nonce gerado no Nginx); estilos inline (atributos `style` de componentes e a página 410 do Nginx) mantêm
  `'unsafe-inline'` em `style-src`. Ao ativar Turnstile, incluir `https://challenges.cloudflare.com` em `script-src` e `frame-src`.

## Operação

- Publicar nova versão: copiar o código para `/opt/mag-site/releases/<tag>/` e rodar `/opt/mag-site/bin/deploy.sh <tag>`
  (constrói, troca, confere `/api/health`; volta sozinho para a tag anterior se falhar).
- Voltar versão: `sed -i 's/^MAG_SITE_TAG=.*/MAG_SITE_TAG=<tag-anterior>/' /opt/mag-site/.env && cd /opt/mag-site && docker compose up -d web omie-consulta`.
  Ao voltar para antes de `20261007-0815` (Consulta rápida): primeiro `cd /opt/mag-site && docker compose rm -sf omie-consulta`,
  depois copiar `compose.yaml` e `bin/deploy.sh` de `/srv/mag-site/backups/config-antes-20261007-0815/` para
  `/opt/mag-site/` e então o `sed` + `docker compose up -d web`. O banco e o catálogo não mudaram nesta release.
  Ao voltar para antes de `20261007-0900` (cadastro completo): repor `compose.yaml`, `bin/`, `/etc/cron.d/mag-site` e
  `/etc/logrotate.d/mag-site` de `/srv/mag-site/backups/config-antes-20261007-0900/` (sem isso o cron das 05:20 falha na
  imagem antiga, sem afetar o site); `catalog/interno/` pode ficar (a release anterior não lê).
  Ao voltar para antes de `20261007-1356` (Pedido de Venda): primeiro `cd /opt/mag-site && docker compose rm -sf omie-pedidos`,
  depois repor `compose.yaml`, `bin/`, cron e logrotate de `/srv/mag-site/backups/config-antes-20261007-1356/`; as tabelas novas
  do banco ficam (a release anterior ignora) e os orçamentos internos voltam a aparecer ao avançar de novo.
  Atenção ao voltar para antes de `20261005-1020` (testado em 05/10/2026): a release anterior lê o catálogo novo (URLs
  amigáveis respondem 200), mas não conhece os 301 — `/produto/produto-<código>` passa a dar 404 — e a sincronização
  seguinte (worker antigo) volta os endereços para `produto-<código>`. O `slugs.json` não é tocado por ela: ao voltar
  para `20261005-1020` ou posterior, as mesmas URLs amigáveis retornam. Configuração e catálogo anteriores à troca:
  `/srv/mag-site/backups/config-antes-20261005-1020/`. O Nginx novo funciona com as duas versões (não precisa voltar).
  Ao voltar para antes de `20261006-0903` (carreiras e redes): comentar a linha `:25` do `/etc/cron.d/mag-site` (a imagem
  antiga não tem o worker das redes; sem isso o cron falha de hora em hora, sem afetar o site). O banco migrado (tabelas
  novas) funciona com as releases anteriores; `/redes` e as páginas de vaga passam a dar 404 e o rodapé volta ao antigo.
  Configuração anterior: `/srv/mag-site/backups/config-antes-20261006-0903/`.
- Primeiro administrador do painel: `cd /opt/mag-site && docker compose run --rm -it web node scripts/bootstrap-admin.mjs`
  (pergunta e-mail e senha sem mostrar; recusa senha fraca e recusa se já existir usuário; validado em 05/10/2026 num
  banco descartável). Os demais são criados pelo admin em `/interno/usuarios`. Revalidado em 06/10/2026 na imagem da
  release ativa (terminal real, banco descartável): senha não aparece, hash scrypt, auditoria `user:bootstrap`, 2ª
  execução recusada ("Administrador inicial já configurado"). Depois de criar o admin: entrar em `/interno/login`,
  criar os usuários DHO (perfil DHO) e conferir: Admin vê Vagas, Candidaturas e Redes; DHO vê Vagas, Candidaturas e
  baixa currículos, mas não vê Redes nem Usuários; Comercial não vê RH (o servidor recusa mesmo com o endereço direto).
- Imagens antigas: o cron `docker-image-prune` (05:01, VPS) apaga imagens sem uso com mais de 24 h. Para voltar a uma
  release cuja imagem já sumiu: `docker build -t mag-site:<tag> /opt/mag-site/releases/<tag>` (≈3 min) e depois o `sed`.
- Reinício da VPS: só com autorização; procedimento e checklists em `/srv/mag-site/REBOOT.md`.
- Saúde: `curl -s http://127.0.0.1:3020/api/health` (o Nginx bloqueia esse caminho para fora da VPS).

## Backup e migração

`backup.sh` gera `/srv/mag-site/backups/mag-site-AAAAMMDD-HHMMSS.tar.gz` (chmod 600; contém dados pessoais e segredos):
banco (cópia consistente via `VACUUM INTO`, sem parar o site), currículos, imagens e tokens das redes sociais
(`data/social-uploads`, `social-state`), catálogo publicado, **`slugs.json`**,
`editorial.json`/`overrides.json` (se existirem), histórico, segredos, código da release ativa, toda a configuração acima,
este manifesto, o `RESTORE.md` e o gancho `backup-alerta.sh`. As fotos não entram: a sincronização baixa de novo.
- Agenda: 03:35, `vps-backup-run mag-site` (log `/var/log/vps-backup-mag-site.log`, rotação mensal, 6 meses).
  Retenção local: 7 mais recentes + 1 por semana (4 semanas) + 1 por mês (3 meses). Cópia externa (armazenamento
  Hostinger, por SSH) com hash conferido e retenção de 30 dias. Saída ≠ 0 em falha de geração (código do script),
  pacote não localizado (1) ou envio externo (2); falha acende marcador no login SSH (`vps-backup-alerta`).
- Consulta rápida no pacote: `secrets/omie-consulta.env` (com os demais segredos) e o cadastro completo
  (`dados/catalogo-interno.tar`). O `restore.sh` sobe `web` e `omie-consulta`, gera outro token interno se faltar e roda
  `bin/omie-consulta-verificar.sh` (segredos, saúde e consulta local de teste sem chamar o Omie); se ela falhar, o restore
  termina com erro e avisa, com o site público no ar.
- **Restauração: procedimento completo em `/srv/mag-site/RESTORE.md`** (VPS nova, manual passo a passo, parciais,
  teste isolado). `restore.sh <pacote>` reconstrói tudo numa VPS nova (recusa sobrescrever banco existente sem
  `--sobrescrever`); depois só falta emitir o certificado.
- Teste de restauração isolado em 05/10/2026 10:33 (pacote `mag-site-20261005-103237`, container temporário na porta
  3029, removido depois): código idêntico à release 20261005-1020, `integrity_check: ok`, 959 produtos, URL antiga 301,
  URL nova 200.

## Remover o projeto

    cd /opt/mag-site && docker compose down && docker image rm $(docker images 'mag-site' -q)
    rm /etc/nginx/sites-enabled/magmoveiscorporativos.com.br /etc/nginx/sites-available/magmoveiscorporativos.com.br /etc/nginx/conf.d/mag-site.conf && nginx -t && systemctl reload nginx
    rm /etc/cron.d/mag-site /etc/logrotate.d/mag-site /etc/update-motd.d/97-mag-site-omie && sed -i '/vps-backup-run mag-site/d' /etc/cron.d/vps-backups
    certbot delete --cert-name magmoveiscorporativos.com.br
    userdel magsite && rm -rf /opt/mag-site /var/lib/mag-site /srv/mag-site   # depois de guardar um backup fora da VPS

## CMS editorial (WordPress) — preparado, não instalado

`cms.magmoveiscorporativos.com.br` não resolvia em 05/10/2026; nada instalado. Modelo de instalação **limpa** (projeto
separado `mag-cms`, noindex/nofollow, login com limite de tentativas, sem XML-RPC, atualizações automáticas, backup
diário) em `deploy/cms/` no código-fonte. Nunca reaproveitar nada do WordPress antigo do domínio.

## Pendências conhecidas

- Painel: 1º Admin criado em 06/10/2026 pelo bootstrap (`marketing@magmoveiscorporativos.com.br`) e 1 usuário DHO criado
  pelo painel (`dho@magmoveiscorporativos.com.br`); login, cookie seguro e permissões conferidos em produção. As senhas
  iniciais são temporárias: **trocar no 1º acesso** (Minha conta). Painel sem 2FA.
- Telegram dos alertas (sync, backup, vigia do WhatsApp e saúde do servidor): falta `secrets/alert.env` (token e chat),
  a configurar com `telegram-configurar.py` (ver "Alerta (Telegram)"). Até lá fica no log, no painel e no login SSH.
- Reinício da VPS pendente (kernel 6.8.0-142 e libc6 instalados, não ativos) — ver `REBOOT.md`; antes dele, o backup
  manual do ERP VSB (seção própria no `REBOOT.md`; o ERP continua fora do backup diário).
- CSP em observação (Report-Only) até 19/10–02/11/2026; depois decidir nonce e modo bloqueio com base no `mag-site-csp.log`.
- DMARC do domínio em `p=none` sem `rua` (sem relatórios): ver plano no relatório de 05/10/2026 antes de endurecer.
- E-mail de aviso dos formulários: sem `RESEND_API_KEY`/`EMAIL_FROM` em `secrets/site.env` (a VPS não tem MTA). Os registros
  ficam salvos e aparecem no painel; só o aviso por e-mail não sai.
- Pedido de Venda no Omie: escrita DESLIGADA até o teste controlado autorizado pela MAG; vínculos usuário → vendedor e
  padrões (etapa, categoria, conta) dependem do Admin em `/interno/omie`.
- Proposta comercial: o Admin deve conferir razão social, CNPJ e contatos em `/interno/proposta` (padrão: dados públicos do
  site + MAGAZINE DOS MOVEIS LTDA). Envio da proposta por e-mail pelo servidor desligado (sem provedor de e-mail na VPS): o
  vendedor usa o próprio programa de e-mail e anexa o PDF.
- Turnstile (anti-robô): desligado; o site usa honeypot e limite de tentativas por IP.
- 537 produtos sem foto (219 com estoque): ver `catalog/reports/products-without-images.csv`.
- Redes sociais: perfis oficiais confirmados (06/10/2026); faltam as credenciais e aprovações das APIs (ver "Redes
  sociais" e `REDES.md`). Até lá, as quatro ficam em modo manual (só o link).
- `/privacidade`, `/termos` e `/cookies` ainda são texto provisório; rascunho real da política em
  `docs/politica-de-privacidade-RASCUNHO.md` (decisões da MAG e pontos jurídicos marcados). O TikTok exige política e
  termos reais para aprovar o app. Prazos de retenção (`RECRUITMENT_RETENTION_MONTHS`) dependem dessa aprovação.
