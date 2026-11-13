# mag-site — como ligar cada rede social (YouTube, Instagram, TikTok, LinkedIn)

Instalado em `/srv/mag-site/REDES.md`. Complementa o `MANIFESTO.md` (seção "Redes sociais"). Conferido nas
documentações oficiais em 06/10/2026 (Google, Meta, TikTok for Developers, LinkedIn/Microsoft Learn).

## Perfis oficiais (confirmados pela MAG em 06/10/2026)

| Rede | Endereço oficial | Modo atual |
|---|---|---|
| YouTube | https://www.youtube.com/@magmoveiscorporativos7222 | manual (só o link) |
| Instagram | https://instagram.com/magmoveiscorporativos | manual (só o link) |
| TikTok | https://www.tiktok.com/@mag.moveis | manual (só o link) |
| LinkedIn | https://www.linkedin.com/company/magmoveiscorporativos | manual (só o link) — **nunca** a outra página |

Ao ligar a API, o painel mostra de que conta veio o conteúdo e se ela **confere** com o endereço oficial. Se não
conferir, o site não publica o conteúdo daquela rede (continua só o link).

## Regras para todas as redes

- **Credencial nunca vai por chat, e-mail ou argumento de comando.** Grava-se só na VPS, digitando sem eco:
  `/opt/mag-site/bin/social-credenciais.py definir <rede>` → `/opt/mag-site/secrets/social.env` (root, 600).
  `social-credenciais.py status` mostra o que está definido (nunca o valor dos segredos).
- **Perfil oficial só depois da confirmação da MAG.** Nada encontrado em busca pública é gravado como oficial.
  O Admin cadastra no painel `/interno/redes`: endereço do perfil, nome exibido e modo. Só então o link aparece no
  rodapé, em `/redes` e no `sameAs` do Google.
- **Ordem para ligar a API de uma rede:** (1) MAG confirma o perfil → (2) credencial gravada → (3)
  `/opt/mag-site/bin/social-sync.sh --forcar` → (4) painel mostra "conectado" e a **conta sincronizada é a oficial**
  → (5) só então o Admin muda o modo da rede para "API". Antes disso a rede fica em "Manual" ou "Desligada".
- Desligar: modo "Desligada" no painel (sai do site na hora) ou `social-credenciais.py remover <rede>` (na próxima
  sincronização a rede vira "desconectado" e o conteúdo dela sai do cache).

## 1. YouTube — primeira a ativar (não depende de aprovação)

**O que a MAG faz** (no navegador, com a conta Google que administra o canal):

1. https://console.cloud.google.com → criar (ou escolher) um projeto, por exemplo "MAG Site".
2. **APIs e serviços → Biblioteca** → "YouTube Data API v3" → **Ativar**.
3. **APIs e serviços → Credenciais → Criar credenciais → Chave de API**.
4. Editar a chave: **Restrições de aplicativo → Endereços IP** → `179.197.238.57` (saída da VPS); **Restrições de
   API → Restringir chave → YouTube Data API v3** → Salvar. Assim a chave não serve em nenhum outro lugar.
5. **ID do canal** (o ID não aparece no endereço `@magmoveiscorporativos7222` e não é deduzido): duas formas oficiais —
   (a) no YouTube, logado na conta do canal: foto do perfil → **Configurações → Configurações avançadas** → "ID do canal"
   (começa com `UC`); ou (b) depois de gravar só a chave: `social-credenciais.py youtube-canal
   https://www.youtube.com/@magmoveiscorporativos7222` — consulta a API oficial pelo @handle (1 unidade de cota), confere
   que o canal devolvido tem exatamente esse @handle, mostra nome e ID e só grava se você digitar CONFIRMO.
6. Endereço oficial: `https://www.youtube.com/@magmoveiscorporativos7222` (já gravado no site).

**Na VPS (operação):**

7. `/opt/mag-site/bin/social-credenciais.py definir youtube` (chave sem eco + ID do canal, ou Enter e usar o item 5b).
8. `/opt/mag-site/bin/social-sync.sh --forcar` e `tail -n 1 /var/log/mag-site-social.log` → `"youtube":"conectado (N)"`.
9. Painel → Redes → YouTube: "Canal sincronizado" mostra nome, @handle e UC…, e "Perfil oficial: confere". Se não, parar.
10. Admin no painel: endereço oficial, nome exibido e modo **API** → Salvar.

**Fluxo (sem Search API):** `channels.list` (playlist de uploads do canal) → `playlistItems.list` (últimos uploads)
→ `videos.list` (duração e só vídeos públicos) → cache local (`catalog/social/`, miniaturas WebP no próprio
servidor) → site. Custo ≈ 3 unidades por hora (≈ 72/dia, de 10.000 da cota padrão). `search.list` (100 unidades) não é usado.

**Testes depois de ativar** (nenhum mexe em produto, Omie ou nginx):

| Teste | Como | Esperado |
|---|---|---|
| Sync manual | `social-sync.sh --forcar` | log `conectado (N)`; painel "conectado"; vídeos em `/redes` e na home |
| Sync do cron | aguardar o `:25` | linha nova no log; `checkedAt` novo em `catalog/social/social.status.json` |
| Conteúdo inalterado | duas execuções seguidas | `"changed":false`; `social.json` mantém a data |
| Vídeo novo | publicar um vídeo público no canal | aparece em até 1 h (`"changed":true`) |
| API fora do ar | `/opt/mag-site/bin/social-simular-queda.sh` | YouTube "erro" (falha de rede); o site continua com os vídeos; `social-sync.sh --forcar` volta a "conectado" |
| Miniatura | `curl -sI https://magmoveiscorporativos.com.br/social-images/<arquivo>.webp` | 200, `image/webp`, `nosniff`, CSP `sandbox` |
| Player nocookie e consentimento | navegador: sem aceitar marketing, o clique abre o YouTube; aceitando, toca no site via `youtube-nocookie.com` | iframe só depois do clique; nenhum script do YouTube antes disso |

## 2. Instagram — continua MANUAL até a MAG confirmar a conta e entregar o token

Perfil previsto: `https://instagram.com/magmoveiscorporativos` (aguardando confirmação). Nunca pedir nem usar senha.

1. Conta do Instagram da MAG **profissional** (Empresa ou Criador de conteúdo). Não precisa de Página do Facebook.
2. https://developers.facebook.com → **Meus apps → Criar app** → tipo **Empresa (Business)**.
3. No painel do app: **Instagram → API setup with Instagram business login**.
4. **Add account**: a própria MAG entra com a conta oficial (no navegador dela).
5. Permissão usada: `instagram_business_basic` (perfil e mídias). Para a conta da própria empresa, o **acesso padrão
   basta** (a Meta só exige revisão/acesso avançado para servir contas de terceiros).
6. **Generate token** ao lado da conta → token de **longa duração (60 dias)**.
7. Na VPS: `social-credenciais.py definir instagram`. O worker renova o token a cada 7 dias (a Meta só renova
   token com mais de 24 h; cada renovação vale mais 60 dias). Se o worker ficar parado 60 dias, gerar outro token.
8. `social-sync.sh --forcar` → painel: "Conta do token" deve ser `@magmoveiscorporativos`. Só então mudar para API.

## 3. TikTok — NÃO ativar ainda

Pré-requisitos: `/privacidade` e `/termos` reais e visíveis no site (a revisão do TikTok exige links ativos para
política de privacidade e termos), e a conta oficial do TikTok da MAG confirmada.

1. https://developers.tiktok.com → criar conta de desenvolvedor (e-mail) → criar ou entrar numa **organização**
   (recomendado para empresa; app em conta individual não é indicado).
2. Ícone do perfil → **Manage apps → Connect an app** → dono: a organização.
3. **Basic information:** ícone 1024×1024, nome do app (não pode citar redes sociais — ex.: "MAG Móveis Corporativos"),
   categoria, descrição, **Terms of Service URL**, **Privacy Policy URL**, plataforma **Web** com o site oficial.
4. **URL properties:** verificar o site. Usar o método **prefixo de URL** (o portal gera um arquivo; ele é publicado na
   raiz do site — sem mexer no DNS).
5. **Add products:** **Login Kit** e **Display API** ("TikTok API"). **Scopes:** só `user.info.basic` e `video.list`
   (escopo sobrando atrasa a revisão).
6. **Login Kit → Redirect URI (Web):** `https://magmoveiscorporativos.com.br/redes` (https, sem parâmetros).
7. **App review:** explicar o uso (o site mostra os vídeos públicos da própria MAG em `/redes` e na home; cada card leva
   ao TikTok) e enviar 1 a 5 vídeos de demonstração do fluxo completo, no mesmo domínio cadastrado. **Submit for review.**
   O TikTok informa de alguns dias a duas semanas. As regras dizem que o app "não pode ser de uso privado ou pessoal":
   o pedido precisa deixar claro que é um recurso público do site. A aprovação não é garantida.
8. Sandbox (opcional, só teste): conta oficial como **Target User**. Não usar sandbox como produção.
9. Depois de **Live**, na VPS:
   - `social-credenciais.py definir tiktok` (client key + client secret, sem eco);
   - `social-credenciais.py tiktok-autorizar https://magmoveiscorporativos.com.br/redes` → abrir o link num navegador
     logado na **conta oficial** → autorizar → colar o endereço de retorno (sem eco). O script confere o `state`, troca o
     código pelo **refresh token (365 dias)** e grava; o token de acesso (24 h) é renovado pelo worker, que guarda o
     refresh token novo quando o TikTok o troca (`social-state/`, incluído no backup).
10. `social-sync.sh --forcar` → painel: "Conta autorizada" = nome da conta oficial → só então modo API.

## 4. LinkedIn — NÃO ativar automaticamente

Há mais de uma página pública da MAG no LinkedIn. **A organização é sempre a informada pela MAG (ID numérico)**, gravada
em `LINKEDIN_ORGANIZATION_ID`; o sistema nunca escolhe pelo nome nem lê páginas por raspagem.

1. **Quem autentica:** pessoa com papel **Super admin** (`ADMINISTRATOR`), **Content admin** (`CONTENT_ADMIN`) ou
   `DIRECT_SPONSORED_CONTENT_POSTER` na página **oficial**. Analista e curador não leem publicações pela API.
2. https://developer.linkedin.com → **My apps → Create app**: nome, **página oficial da MAG** (um admin da página
   precisa aprovar a associação: **Settings → Verify**), URL da política de privacidade, logo.
3. **Products → Community Management API** (produto com aprovação; começa no **Development tier**). Só pode ser pedido
   num app novo, sem outros produtos. No formulário: uso = exibir as publicações públicas da própria página no site.
4. **Permissão necessária:** `r_organization_social` (ler as publicações da organização). Opcional:
   `r_organization_admin` (permite listar as páginas do usuário para conferir o ID pela API).
5. **Organization ID** da página oficial `https://www.linkedin.com/company/magmoveiscorporativos`: (a) abrir essa página
   como administrador — a URL fica
   `https://www.linkedin.com/company/<NÚMERO>/admin/`; o número é o ID; ou (b) com o token gravado,
   `social-credenciais.py linkedin-organizacoes` lista as páginas e os papéis — **não escolhe nenhuma**.
6. **Token:** no portal, **Auth → OAuth 2.0 tools → Token generator**, autenticado pela pessoa do item 1, com os escopos
   aprovados → **access token de 60 dias**. O **refresh token (365 dias)** só vem para apps aprovados para tokens
   programáticos; renovar o access token não estende o refresh token. Sem refresh token, gerar um token novo a cada
   60 dias (quando vencer, o painel mostra "erro" e o site mantém o último conteúdo).
7. Na VPS: `social-credenciais.py definir linkedin` (ID da organização + token; refresh, client ID e secret opcionais) e
   **`social-credenciais.py linkedin-verificar https://www.linkedin.com/company/magmoveiscorporativos`** — consulta oficial
   por nome da página (vanityName): só segue se responder CONFERE (o ID gravado é exatamente essa página).
8. `social-sync.sh --forcar` → painel: "Organização" = `urn:li:organization:<ID informado>` → conferir que é a página
   oficial → só então modo API.

Limites do Development tier: 500 chamadas por app e 100 por membro, por dia. O worker consulta o LinkedIn **a cada 6 h**
(`LINKEDIN_SYNC_HOURS`, 1–24) — no máximo ~52 chamadas por dia. O Standard tier exige vídeo de demonstração.
