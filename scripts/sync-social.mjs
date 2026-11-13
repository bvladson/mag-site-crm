#!/usr/bin/env node
/**
 * Projeto mag-site — redes sociais: API oficial → este worker → catalog/social/ (JSON + miniaturas locais) → site.
 * Roda de hora em hora pelo cron do host (bin/social-sync.sh). Nenhuma visita ao site chama as APIs.
 * - Rede sem credencial: "desconectado", nenhuma chamada de rede.
 * - Rede com erro: mantém o último conteúdo bom, registra o erro (sem segredo, sem URL) e segue com as outras.
 * - Conteúdo igual ao anterior: social.json não é regravado (só o estado e o histórico).
 * - Tokens só no ambiente (secrets/social.env) e, quando a plataforma os renova, em SOCIAL_STATE_DIR/tokens.json (600).
 * - Imagens: só a miniatura/capa oficial que a API entrega, convertida aqui para WebP; o visitante não acessa os CDNs
 *   das redes. Vídeo nunca é baixado. Miniatura renovada a cada 7 dias e apagada na mesma execução em que sai da lista.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const NETWORKS = ["youtube", "instagram", "tiktok", "linkedin"];
const IMAGE_FILE = /^[a-f0-9]{64}\.webp$/;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_MAX_AGE_MS = 7 * 86400000;
const DAY = 86400000;

export class ProviderError extends Error {
  constructor(message) { super(message); this.name = "ProviderError"; }
}

export function configFromEnv(env = process.env) {
  const outputDir = resolve(env.SOCIAL_OUTPUT_DIR || "./data/social");
  return {
    env, outputDir, imageDir: join(outputDir, "images"), contentPath: join(outputDir, "social.json"),
    statusPath: join(outputDir, "social.status.json"), historyPath: join(outputDir, "social-history.jsonl"),
    stateDir: resolve(env.SOCIAL_STATE_DIR || "./data/social-state"),
    maxItems: Math.min(20, Math.max(3, Number(env.SOCIAL_MAX_ITEMS) || 12)),
  };
}

const clip = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const fingerprint = (value) => createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 16);
const isoOf = (value) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null; };
function httpsOn(value, base) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === base || host.endsWith(`.${base}`)) ? url.toString() : null;
  } catch { return null; }
}

/** Duração ISO 8601 (PT1H2M3S) → segundos. */
export function parseDuration(value) {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(value ?? ""));
  if (!match) return null;
  const [days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part) || 0);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/** Versão da API REST do LinkedIn (AAAAMM): dois meses atrás, para estar sempre entre as suportadas. */
export function linkedinVersion(now) {
  const date = new Date(now);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 2);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Texto "little text" do LinkedIn → texto simples (hashtags, menções, escapes). */
export function linkedinText(value) {
  return String(value ?? "")
    .replace(/\{hashtag\|\\?#\|([^}]+)\}/g, "#$1")
    .replace(/@\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\\([\\{}()[\]@#*_~<>|])/g, "$1");
}

/** Chamada HTTP com tempo-limite. Erro vira mensagem curta e sem URL (a URL pode conter chave ou token). */
export function makeRequest(fetchImpl, label) {
  return async function request(url, init = {}) {
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20000) });
    } catch (error) {
      throw new ProviderError(`${label}: falha de rede (${clip(error?.cause?.code || error?.name || "erro", 40)})`);
    }
    let body = null;
    try { body = await response.json(); } catch { /* sem corpo JSON */ }
    if (!response.ok) {
      const code = body?.error?.errors?.[0]?.reason ?? body?.error?.code ?? body?.error?.type ?? body?.serviceErrorCode ?? body?.code ?? body?.error;
      const safe = typeof code === "string" || typeof code === "number" ? String(code).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 60) : "";
      throw new ProviderError(`${label}: HTTP ${response.status}${safe ? ` (${safe})` : ""}`);
    }
    // 200 sem JSON (corpo cortado pelo tempo-limite, página de erro de proxy) não pode virar "lista vazia":
    // isso apagaria o último conteúdo bom. Vira erro e o conteúdo anterior fica.
    if (body === null || typeof body !== "object") throw new ProviderError(`${label}: resposta inválida`);
    return body;
  };
}

// ---------------------------------------------------------------- adaptadores
/** Cada adaptador devolve itens normalizados; o site nunca vê o JSON de cada fornecedor. */
export const providers = {
  youtube: {
    configured: (env) => Boolean(env.YOUTUBE_API_KEY && env.YOUTUBE_CHANNEL_ID),
    secrets: (env) => [env.YOUTUBE_API_KEY],
    /** Playlist de uploads do canal (sem Search API): channels.list + playlistItems.list + videos.list ≈ 3 unidades de cota. */
    async fetch({ env, request, max }) {
      const key = encodeURIComponent(env.YOUTUBE_API_KEY);
      const channel = await request(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet&id=${encodeURIComponent(env.YOUTUBE_CHANNEL_ID)}&key=${key}`);
      const info = channel.items?.[0];
      const uploads = info?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) throw new ProviderError("youtube: canal não encontrado (confira YOUTUBE_CHANNEL_ID)");
      const list = await request(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=${max}&playlistId=${encodeURIComponent(uploads)}&key=${key}`);
      const ids = (list.items ?? []).map((item) => item.contentDetails?.videoId).filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id ?? ""));
      // Conta sincronizada (para o painel conferir que é o canal oficial): ID configurado + nome devolvido pela API.
      const account = {
        id: env.YOUTUBE_CHANNEL_ID, name: clip(info.snippet?.title, 120) || null,
        handle: clip(info.snippet?.customUrl, 120).replace(/^@/, "").toLowerCase() || null, // @handle do canal
      };
      if (!ids.length) return { items: [], account };
      const videos = await request(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${ids.join(",")}&key=${key}`);
      const byId = new Map((videos.items ?? []).map((video) => [video.id, video]));
      const items = ids.map((id) => byId.get(id)).filter((video) => video && video.status?.privacyStatus === "public").map((video) => {
        const thumbs = video.snippet?.thumbnails ?? {};
        return {
          external_id: video.id, url: `https://www.youtube.com/watch?v=${video.id}`, type: "video", title: clip(video.snippet?.title, 200),
          remote_image: (thumbs.maxres ?? thumbs.standard ?? thumbs.high ?? thumbs.medium ?? thumbs.default)?.url ?? null,
          published_at: isoOf(video.snippet?.publishedAt), author: clip(video.snippet?.channelTitle || info.snippet?.title, 120) || null,
          duration: parseDuration(video.contentDetails?.duration), metadata: { aspect: "16:9", youtube_id: video.id },
        };
      });
      return { items, account };
    },
  },

  instagram: {
    configured: (env) => Boolean(env.INSTAGRAM_ACCESS_TOKEN),
    secrets: (env, state) => [env.INSTAGRAM_ACCESS_TOKEN, state.instagram?.access_token],
    /** Instagram API com login do Instagram (conta profissional): /me/media. Token de 60 dias renovado a cada 7. */
    async fetch({ env, request, max, state, now }) {
      const version = /^v\d+\.\d+$/.test(env.INSTAGRAM_API_VERSION ?? "") ? env.INSTAGRAM_API_VERSION : "v22.0";
      const source = fingerprint(env.INSTAGRAM_ACCESS_TOKEN);
      const saved = state.instagram?.source === source ? state.instagram : null; // token novo no .env vence o salvo
      let token = saved?.access_token ?? env.INSTAGRAM_ACCESS_TOKEN;
      if (!saved?.refreshed_at || now - Date.parse(saved.refreshed_at) > 7 * DAY) {
        try {
          const fresh = await request(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
          if (fresh.access_token) {
            token = fresh.access_token;
            state.instagram = { source, access_token: token, refreshed_at: new Date(now).toISOString(), expires_at: new Date(now + (Number(fresh.expires_in) || 0) * 1000).toISOString() };
          }
        } catch { /* token com menos de 24 h ou renovação indisponível: segue com o atual */ }
      }
      const fields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,username";
      const media = await request(`https://graph.instagram.com/${version}/me/media?fields=${fields}&limit=${max}&access_token=${encodeURIComponent(token)}`);
      // De qual conta é o token (o painel mostra para conferir que é o perfil oficial). Falha aqui não derruba a lista.
      let account = null;
      try {
        const me = await request(`https://graph.instagram.com/${version}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`);
        account = {
          id: me.user_id ? clip(me.user_id, 40) : null, name: me.username ? `@${clip(me.username, 60)}` : null,
          handle: me.username ? clip(me.username, 60).toLowerCase() : null,
        };
      } catch { account = null; }
      const items = (media.data ?? []).map((item) => {
        const reel = item.media_product_type === "REELS";
        const type = reel ? "reel" : item.media_type === "CAROUSEL_ALBUM" ? "carousel" : item.media_type === "VIDEO" ? "video" : "image";
        return {
          external_id: String(item.id), url: httpsOn(item.permalink, "instagram.com"), type, title: clip(item.caption, 200),
          // Vídeo/reels: media_url é o próprio MP4 — só a capa (thumbnail_url) serve.
          remote_image: item.thumbnail_url || (item.media_type === "VIDEO" ? null : item.media_url) || null, published_at: isoOf(item.timestamp),
          author: item.username ? `@${clip(item.username, 60)}` : null, duration: null, metadata: { aspect: reel ? "9:16" : "1:1", youtube_id: null },
        };
      }).filter((item) => item.url);
      return { items, account };
    },
  },

  tiktok: {
    configured: (env) => Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET && (env.TIKTOK_REFRESH_TOKEN || env.TIKTOK_ACCESS_TOKEN)),
    secrets: (env, state) => [env.TIKTOK_CLIENT_SECRET, env.TIKTOK_REFRESH_TOKEN, env.TIKTOK_ACCESS_TOKEN, state.tiktok?.access_token, state.tiktok?.refresh_token],
    /** Display API: /v2/video/list/. Token de acesso dura 24 h; renovado pelo refresh token (365 dias), guardado no estado. */
    async fetch({ env, request, max, state, now }) {
      const source = fingerprint(env.TIKTOK_REFRESH_TOKEN || env.TIKTOK_ACCESS_TOKEN);
      const saved = state.tiktok?.source === source ? state.tiktok : null;
      let access = saved?.access_token ?? env.TIKTOK_ACCESS_TOKEN ?? null;
      const expiring = !access || (saved?.access_expires_at && Date.parse(saved.access_expires_at) - now < 10 * 60000);
      if (expiring) {
        const refresh = saved?.refresh_token ?? env.TIKTOK_REFRESH_TOKEN;
        if (!refresh) throw new ProviderError("tiktok: token de acesso vencido e sem TIKTOK_REFRESH_TOKEN");
        const body = new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: refresh });
        const token = await request("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
        if (!token.access_token) throw new ProviderError(`tiktok: renovação do token recusada (${clip(token.error, 40).replace(/[^A-Za-z0-9_.-]/g, "")})`);
        access = token.access_token;
        state.tiktok = {
          source, access_token: access, access_expires_at: new Date(now + (Number(token.expires_in) || 86400) * 1000).toISOString(),
          refresh_token: token.refresh_token ?? refresh, refresh_expires_at: token.refresh_expires_in ? new Date(now + Number(token.refresh_expires_in) * 1000).toISOString() : null,
        };
      }
      const fields = "id,title,video_description,cover_image_url,share_url,create_time,duration";
      const result = await request(`https://open.tiktokapis.com/v2/video/list/?fields=${fields}`, {
        method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body: JSON.stringify({ max_count: Math.min(max, 20) }),
      });
      if (result.error?.code && result.error.code !== "ok") throw new ProviderError(`tiktok: ${clip(result.error.code, 60).replace(/[^A-Za-z0-9_.-]/g, "")}`);
      const items = (result.data?.videos ?? []).map((video) => ({
        external_id: String(video.id), url: httpsOn(video.share_url, "tiktok.com"), type: "short", title: clip(video.title || video.video_description, 200),
        remote_image: video.cover_image_url || null, published_at: video.create_time ? new Date(Number(video.create_time) * 1000).toISOString() : null,
        author: null, duration: Number.isFinite(video.duration) ? video.duration : null, metadata: { aspect: "9:16", youtube_id: null },
      })).filter((item) => item.url);
      // Conta autorizada: o @usuário vem dos próprios links dos vídeos (sem escopo extra); nome e open_id do user.info.basic.
      const owner = /tiktok\.com\/@([^/?#]+)/i.exec(items[0]?.url ?? "")?.[1]?.toLowerCase() ?? null;
      let account = { id: null, name: null, handle: owner };
      try {
        const info = await request("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", { headers: { Authorization: `Bearer ${access}` } });
        const user = info.data?.user ?? {};
        account = { id: user.open_id ? clip(user.open_id, 80) : null, name: clip(user.display_name, 80) || null, handle: owner };
      } catch { /* mantém o @usuário dos links */ }
      return { items, account };
    },
  },

  linkedin: {
    configured: (env) => Boolean(env.LINKEDIN_ORGANIZATION_ID && (env.LINKEDIN_ACCESS_TOKEN || env.LINKEDIN_REFRESH_TOKEN)),
    secrets: (env, state) => [env.LINKEDIN_ACCESS_TOKEN, env.LINKEDIN_REFRESH_TOKEN, env.LINKEDIN_CLIENT_SECRET, state.linkedin?.access_token, state.linkedin?.refresh_token],
    /** Tier de desenvolvimento do LinkedIn: 100 chamadas/membro/dia. A cada 6 h (LINKEDIN_SYNC_HOURS, 1–24) = ~52/dia no máximo. */
    minIntervalMs: (env) => Math.min(24, Math.max(1, Number(env.LINKEDIN_SYNC_HOURS) || 6)) * 3600000,
    /** Community Management API: /rest/posts da organização (só PUBLISHED + PUBLIC). Exige acesso aprovado pelo LinkedIn.
     *  A organização é SEMPRE a informada em LINKEDIN_ORGANIZATION_ID (nunca deduzida pelo nome da página). */
    async fetch({ env, request, max, state, now }) {
      if (!/^\d{1,20}$/.test(env.LINKEDIN_ORGANIZATION_ID)) throw new ProviderError("linkedin: LINKEDIN_ORGANIZATION_ID deve ser o número da organização");
      const source = fingerprint(env.LINKEDIN_REFRESH_TOKEN || env.LINKEDIN_ACCESS_TOKEN);
      const saved = state.linkedin?.source === source ? state.linkedin : null;
      let access = saved?.access_token ?? env.LINKEDIN_ACCESS_TOKEN ?? null;
      const expiring = !access || (saved?.access_expires_at && Date.parse(saved.access_expires_at) - now < DAY);
      if (expiring && env.LINKEDIN_REFRESH_TOKEN && env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET) {
        const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: saved?.refresh_token ?? env.LINKEDIN_REFRESH_TOKEN, client_id: env.LINKEDIN_CLIENT_ID, client_secret: env.LINKEDIN_CLIENT_SECRET });
        const token = await request("https://www.linkedin.com/oauth/v2/accessToken", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
        if (!token.access_token) throw new ProviderError("linkedin: renovação do token recusada");
        access = token.access_token;
        state.linkedin = { source, access_token: access, access_expires_at: new Date(now + (Number(token.expires_in) || 0) * 1000).toISOString(), refresh_token: token.refresh_token ?? saved?.refresh_token ?? env.LINKEDIN_REFRESH_TOKEN };
      }
      if (!access) throw new ProviderError("linkedin: sem token de acesso válido");
      const version = /^\d{6}$/.test(env.LINKEDIN_API_VERSION ?? "") ? env.LINKEDIN_API_VERSION : linkedinVersion(now);
      const headers = { Authorization: `Bearer ${access}`, "LinkedIn-Version": version, "X-Restli-Protocol-Version": "2.0.0" };
      const author = encodeURIComponent(`urn:li:organization:${env.LINKEDIN_ORGANIZATION_ID}`);
      const posts = await request(`https://api.linkedin.com/rest/posts?author=${author}&q=author&count=${max}&sortBy=LAST_MODIFIED`, { headers });
      const items = [];
      for (const post of posts.elements ?? []) {
        if (post.lifecycleState !== "PUBLISHED" || (post.visibility && post.visibility !== "PUBLIC")) continue;
        const id = String(post.id ?? "");
        if (!/^urn:li:(share|ugcPost):\d+$/.test(id)) continue;
        let remoteImage = null;
        const media = post.content?.media?.id ?? post.content?.article?.thumbnail;
        if (typeof media === "string" && media.startsWith("urn:li:image:")) {
          try { remoteImage = (await request(`https://api.linkedin.com/rest/images/${encodeURIComponent(media)}`, { headers })).downloadUrl ?? null; } catch { remoteImage = null; }
        }
        items.push({
          external_id: id, url: `https://www.linkedin.com/feed/update/${id}/`, type: "post", title: clip(linkedinText(post.commentary), 200),
          remote_image: remoteImage, published_at: isoOf(post.publishedAt ?? post.createdAt), author: null, duration: null, metadata: { aspect: "1:1", youtube_id: null },
        });
      }
      // Página da organização configurada (vanityName = o nome na URL /company/<nome>), pela consulta oficial que não exige
      // papel de admin. Sem permissão de consulta, fica só o ID e a conferência é feita no painel.
      let account = { id: `urn:li:organization:${env.LINKEDIN_ORGANIZATION_ID}`, name: null, handle: null };
      try {
        const lookup = await request(`https://api.linkedin.com/rest/organizationsLookup?ids=List(${env.LINKEDIN_ORGANIZATION_ID})`, { headers });
        const org = lookup.results?.[env.LINKEDIN_ORGANIZATION_ID];
        if (org) account = { ...account, name: clip(org.localizedName, 120) || null, handle: clip(org.vanityName, 120).toLowerCase() || null };
      } catch { /* sem a permissão de consulta */ }
      return { items, account };
    },
  },
};

// ---------------------------------------------------------------- imagens
export function sniffImage(bytes) {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "webp";
  if (b.length >= 6 && /^GIF8[79]a$/.test(String.fromCharCode(...b.subarray(0, 6)))) return "gif";
  return null;
}

let sharpModule;
async function toWebp(bytes) {
  if (sharpModule === undefined) {
    try {
      sharpModule = (await import("sharp")).default;
      sharpModule.concurrency(1);
      sharpModule.cache(false);
    } catch { sharpModule = null; }
  }
  if (!sharpModule) return null;
  return sharpModule(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).rotate()
    .resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
}

/** Só imagem: outro content-type (vídeo, HTML) é recusado sem ler o corpo, e a leitura para em 8 MB mesmo sem content-length. */
async function download(url, fetchImpl) {
  if (!/^https:\/\//.test(url ?? "")) return null;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(20000), redirect: "follow" });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || (type && !/^image\//i.test(type)) || Number(response.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body ?? []) {
    total += chunk.length;
    if (total > MAX_IMAGE_BYTES) return null; // sair do laço cancela o restante do download
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  return sniffImage(bytes) ? bytes : null;
}

const imageName = (network, id) => `${createHash("sha256").update(`${network}:${id}`).digest("hex")}.webp`;

/** Miniatura local por item (nome = hash da rede+id). Reaproveita por 7 dias; se o download falhar, fica a anterior. */
async function cacheImages(items, imageDir, { fetchImpl, processImage, now }) {
  await mkdir(imageDir, { recursive: true, mode: 0o755 });
  for (const item of items) {
    const file = imageName(item.provider, item.external_id);
    const target = join(imageDir, file);
    let age = Infinity;
    try { age = now - (await stat(target)).mtimeMs; } catch { /* ainda não existe */ }
    item.thumbnail = null;
    if (age < IMAGE_MAX_AGE_MS) { item.thumbnail = file; continue; }
    try {
      const bytes = await download(item.remote_image, fetchImpl);
      const webp = bytes ? await processImage(bytes) : null;
      if (webp) { await atomicWrite(target, webp, 0o644); item.thumbnail = file; continue; }
    } catch { /* sem imagem nova */ }
    if (age !== Infinity) item.thumbnail = file;
  }
}

// ---------------------------------------------------------------- arquivos
async function atomicWrite(path, data, mode) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { mode, flag: "wx" });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}
async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}
async function appendHistory(path, entry) {
  let lines = [];
  try { lines = (await readFile(path, "utf8")).split("\n").filter(Boolean); } catch { /* primeiro registro */ }
  lines.push(JSON.stringify(entry));
  await atomicWrite(path, `${lines.slice(-500).join("\n")}\n`, 0o644).catch(() => {});
}
const redact = (text, secrets) => secrets.filter((secret) => typeof secret === "string" && secret.length >= 6)
  .reduce((out, secret) => out.split(secret).join("[segredo]"), String(text));

/** Só o que o site precisa; a URL remota da imagem (assinada, com prazo) não sai daqui. */
const cachedItem = ({ provider, external_id, url, type, title, thumbnail, published_at, author, duration, metadata }) =>
  ({ provider, external_id, url, type, title, thumbnail, published_at, author, duration, metadata });

// ---------------------------------------------------------------- sincronização
export async function syncSocial(config, { fetchImpl = fetch, processImage = toWebp, now = () => Date.now() } = {}) {
  const started = now();
  await mkdir(config.outputDir, { recursive: true, mode: 0o755 });
  const previous = (await readJson(config.contentPath)) ?? { providers: {} };
  const previousStatus = (await readJson(config.statusPath))?.providers ?? {};
  const state = (await readJson(join(config.stateDir, "tokens.json"))) ?? {};
  const stateBefore = JSON.stringify(state);
  const content = {};
  const status = {};
  for (const network of NETWORKS) {
    const provider = providers[network];
    const began = now();
    const before = previousStatus[network] ?? {};
    if (!provider.configured(config.env)) {
      content[network] = { items: [] };
      status[network] = { status: "desconectado", configured: false, lastAttemptAt: null, lastSuccessAt: before.lastSuccessAt ?? null, itemCount: 0, error: null, durationMs: 0, account: null };
      continue;
    }
    // Rede com intervalo mínimo (LinkedIn): dentro dele repete o último resultado, sem chamar a API.
    // SOCIAL_FORCE=1 (bin/social-sync.sh --forcar) ignora o intervalo, p. ex. logo depois de trocar a credencial.
    const interval = config.env.SOCIAL_FORCE === "1" ? 0 : provider.minIntervalMs?.(config.env) ?? 0;
    const lastAttempt = Date.parse(before.lastAttemptAt ?? "");
    if (interval && previous.providers?.[network] && Number.isFinite(lastAttempt) && now() - lastAttempt < interval) {
      content[network] = previous.providers[network];
      status[network] = { ...before, durationMs: 0 };
      continue;
    }
    try {
      const result = await provider.fetch({ env: config.env, request: makeRequest(fetchImpl, network), max: config.maxItems, state, now: now() });
      const items = result.items.slice(0, config.maxItems).map((item) => ({ ...item, provider: network }));
      await cacheImages(items, config.imageDir, { fetchImpl, processImage, now: now() });
      content[network] = { items: items.map(cachedItem) };
      status[network] = {
        status: "conectado", configured: true, lastAttemptAt: isoOf(now()), lastSuccessAt: isoOf(now()), itemCount: items.length, error: null,
        durationMs: now() - began, account: result.account ?? null, // conta/canal/organização de onde veio o conteúdo (sem segredo)
      };
    } catch (error) {
      const message = redact(error instanceof ProviderError ? error.message : `${network}: erro inesperado`, provider.secrets(config.env, state));
      content[network] = previous.providers?.[network] ?? { items: [] }; // último conteúdo bom
      status[network] = {
        status: "erro", configured: true, lastAttemptAt: isoOf(now()), lastSuccessAt: before.lastSuccessAt ?? null,
        itemCount: content[network].items?.length ?? 0, error: message, durationMs: now() - began, account: before.account ?? null,
      };
    }
  }
  // Miniaturas que não estão mais em nenhuma lista saem da pasta.
  const referenced = new Set(NETWORKS.flatMap((network) => (content[network].items ?? []).map((item) => item.thumbnail).filter(Boolean)));
  for (const name of await readdir(config.imageDir).catch(() => [])) {
    if (IMAGE_FILE.test(name) && !referenced.has(name)) await unlink(join(config.imageDir, name)).catch(() => {});
  }
  const changed = JSON.stringify(content) !== JSON.stringify(previous.providers ?? null);
  if (changed) await atomicWrite(config.contentPath, `${JSON.stringify({ schemaVersion: 1, generatedAt: isoOf(now()), providers: content })}\n`, 0o644);
  await atomicWrite(config.statusPath, `${JSON.stringify({ schemaVersion: 1, checkedAt: isoOf(now()), contentChanged: changed, providers: status })}\n`, 0o644);
  if (JSON.stringify(state) !== stateBefore) {
    await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
    await atomicWrite(join(config.stateDir, "tokens.json"), JSON.stringify(state), 0o600);
  }
  await appendHistory(config.historyPath, {
    at: isoOf(now()), changed, durationMs: now() - started,
    providers: Object.fromEntries(NETWORKS.map((network) => [network, { status: status[network].status, items: status[network].itemCount, error: status[network].error }])),
  });
  return { changed, status };
}

async function main() {
  const result = await syncSocial(configFromEnv());
  const summary = Object.fromEntries(Object.entries(result.status).map(([network, s]) => [network, s.error ? `${s.status}: ${s.error}` : `${s.status} (${s.itemCount})`]));
  console.log(JSON.stringify({ event: "social_synced", at: new Date().toISOString(), changed: result.changed, ...summary }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: "social_sync_failed", error: String(error?.code || error?.name || "erro") }));
    process.exitCode = 1;
  });
}
