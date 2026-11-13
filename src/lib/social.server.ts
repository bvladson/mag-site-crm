import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  NETWORKS, accountMatch, defaultProfiles, isNetworkUrl, networkInfo, youtubeId,
  type Network, type SocialAspect, type SocialItem, type SocialMode, type SocialNetworkPublic, type SocialProfile, type SocialType,
} from "@/config/social";
import { dataDirectory, getDb } from "./local-db.server.ts";

/**
 * Redes sociais no site. O worker (scripts/sync-social.mjs) grava catalog/social/ fora do horário das visitas; aqui só
 * se lê esse cache e o banco do painel (modo/perfil por rede e itens manuais). Nenhuma API externa é chamada por visita.
 */
export function socialDir() {
  return resolve(process.env["SOCIAL_DIR"] || join(dirname(resolve(process.env["OMIE_CATALOG_PATH"] || "./data/catalog.json")), "social"));
}
const uploadsDir = () => join(dataDirectory(), "social-uploads");

const TYPES = ["video", "short", "reel", "post", "image", "carousel"] as const;
const cachedItem = z.object({
  provider: z.enum(NETWORKS), external_id: z.string().min(1).max(200), url: z.string().max(500), type: z.enum(TYPES),
  title: z.string().max(300), thumbnail: z.string().regex(/^[a-f0-9]{64}\.webp$/).nullable(), published_at: z.string().max(40).nullable(),
  author: z.string().max(200).nullable(), duration: z.number().nonnegative().nullable(),
  metadata: z.object({ aspect: z.enum(["16:9", "9:16", "1:1"]), youtube_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/).nullable() }),
});
const statusEntry = z.object({
  status: z.enum(["conectado", "desconectado", "erro"]), configured: z.boolean(), lastAttemptAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(), itemCount: z.number(), error: z.string().max(300).nullable(),
  // Conta de onde veio o conteúdo (canal, perfil, organização) — para o Admin conferir que é a oficial. Nunca segredo.
  account: z.object({
    id: z.string().max(200).nullable(), name: z.string().max(200).nullable(), handle: z.string().max(200).nullable().optional(),
  }).nullable().optional(),
}); // só estes campos chegam ao painel (o resto do arquivo é descartado)

type Cache = { mtime: number; checked: number; value: unknown };
const caches = new Map<string, Cache>();
/** Lê um JSON do cache do worker no máximo a cada 15 s, só reprocessando quando o arquivo muda. Arquivo ruim = vazio. */
function readCached(path: string): unknown {
  const now = Date.now();
  const cached = caches.get(path);
  if (cached && now - cached.checked < 15000) return cached.value;
  try {
    const { mtimeMs, size } = statSync(path);
    if (size > 4 * 1024 * 1024) throw new Error("grande demais");
    if (cached && cached.mtime === mtimeMs) { cached.checked = now; return cached.value; }
    const value = JSON.parse(readFileSync(path, "utf8"));
    caches.set(path, { mtime: mtimeMs, checked: now, value });
    return value;
  } catch {
    caches.set(path, { mtime: -1, checked: now, value: null });
    return null;
  }
}

/** Itens sincronizados por rede, validados um a um (item inválido é descartado, nunca derruba a página). */
function apiItems(network: Network, officialUrl: string): SocialItem[] {
  // Só publica se a conta sincronizada não divergir do perfil oficial configurado (nunca conteúdo de outra conta).
  if (accountMatch(network, officialUrl, readSocialStatus().providers[network]?.account) === "diverge") return [];
  const content = readCached(join(socialDir(), "social.json")) as { providers?: Record<string, { items?: unknown[] }> } | null;
  const raw = content?.providers?.[network]?.items ?? [];
  return raw.flatMap((entry) => {
    const parsed = cachedItem.safeParse(entry);
    if (!parsed.success || parsed.data.provider !== network || !isNetworkUrl(network, parsed.data.url)) return [];
    const item = parsed.data;
    return [{
      network, id: item.external_id, url: item.url, type: item.type, title: item.title,
      image: item.thumbnail ? `/social-images/${item.thumbnail}` : null, publishedAt: item.published_at, author: item.author,
      duration: item.duration, aspect: item.metadata.aspect, youtubeId: item.metadata.youtube_id,
    }];
  });
}

export function readSocialStatus() {
  const file = readCached(join(socialDir(), "social.status.json")) as { checkedAt?: string; providers?: Record<string, unknown> } | null;
  const providers = Object.fromEntries(NETWORKS.map((network) => {
    const parsed = statusEntry.safeParse(file?.providers?.[network]);
    return [network, parsed.success ? parsed.data : null];
  })) as Record<Network, z.infer<typeof statusEntry> | null>;
  return { checkedAt: file?.checkedAt ?? null, providers };
}

export type SocialSetting = { network: Network; mode: SocialMode; url: string; handle: string; updatedAt: string | null };
export function readSocialSettings(): Record<Network, SocialSetting> {
  const rows = getDb().prepare("SELECT network, mode, profile_url, handle, updated_at FROM social_settings").all() as
    { network: Network; mode: SocialMode; profile_url: string | null; handle: string | null; updated_at: string }[];
  const saved = new Map(rows.map((row) => [row.network, row]));
  return Object.fromEntries(NETWORKS.map((network) => {
    const row = saved.get(network);
    const fallback = defaultProfiles[network];
    return [network, row
      ? { network, mode: row.mode, url: row.profile_url ?? "", handle: row.handle ?? "", updatedAt: row.updated_at }
      : { network, mode: fallback.mode, url: fallback.url, handle: fallback.handle, updatedAt: null }];
  })) as Record<Network, SocialSetting>;
}

export type ManualRow = {
  id: string; network: Network; url: string; title: string | null; kind: SocialType; image: string | null;
  published_at: string | null; position: number; active: number; created_at: string;
};
export function readManualItems(includeInactive = false): ManualRow[] {
  return getDb().prepare(`SELECT * FROM social_manual_items ${includeInactive ? "" : "WHERE active=1"} ORDER BY network, position ASC, published_at DESC, created_at DESC`)
    .all() as unknown as ManualRow[];
}

const aspectOf = (network: Network, kind: SocialType): SocialAspect =>
  network === "youtube" ? "16:9" : kind === "reel" || kind === "short" ? "9:16" : "1:1";

function manualToItem(row: ManualRow, handle: string): SocialItem {
  return {
    network: row.network, id: row.id, url: row.url, type: row.kind, title: row.title ?? "",
    image: row.image ? `/social-images/m-${row.image}` : null, publishedAt: row.published_at, author: handle || null,
    duration: null, aspect: aspectOf(row.network, row.kind), youtubeId: row.network === "youtube" ? youtubeId(row.url) : null,
  };
}

/** Redes visíveis no site: fora as desligadas; cada uma com o perfil oficial e os itens do modo dela (api ou manual). */
export function publicNetworks(limit = 12): SocialNetworkPublic[] {
  const settings = readSocialSettings();
  const manual = readManualItems();
  return NETWORKS.flatMap((network) => {
    const setting = settings[network];
    if (setting.mode === "disabled") return [];
    const items = setting.mode === "api" ? apiItems(network, setting.url) : manual.filter((row) => row.network === network).map((row) => manualToItem(row, setting.handle));
    const url = isNetworkUrl(network, setting.url) ? setting.url : "";
    if (!url && !items.length) return [];
    return [{ network, label: networkInfo[network].label, url, handle: setting.handle, items: items.slice(0, limit) }];
  });
}

export function publicProfiles(): SocialProfile[] {
  return publicNetworks(0).filter((network) => network.url).map(({ network, label, url, handle }) => ({ network, label, url, handle }));
}

const newest = (a: SocialItem, b: SocialItem) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
/** Home: seleção curta — até 3 vídeos do YouTube e até 3 itens das outras redes (6 se não houver YouTube). */
export function homeSocial() {
  const networks = publicNetworks();
  const videos = networks.find((network) => network.network === "youtube")?.items.slice(0, 3) ?? [];
  const others = networks.filter((network) => network.network !== "youtube").flatMap((network) => network.items).sort(newest).slice(0, videos.length ? 3 : 6);
  return { profiles: networks.filter((network) => network.url).map(({ network, label, url, handle }) => ({ network, label, url, handle })), videos, others };
}

// ---------------------------------------------------------------- imagens enviadas no painel (modo manual)
const UPLOAD = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)$/;
export function sniffUpload(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("latin1") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("latin1") === "WEBP") return "webp";
  return null; // SVG e qualquer outro formato: recusado
}

/** Grava a imagem de um destaque manual com nome aleatório (o tipo vem do conteúdo, não do nome enviado). */
export function storeSocialImage(bytes: Uint8Array) {
  if (bytes.length > 2 * 1024 * 1024) throw new Error("Imagem maior que 2 MB");
  const kind = sniffUpload(bytes);
  if (!kind) throw new Error("Use uma imagem JPG, PNG ou WebP");
  mkdirSync(uploadsDir(), { recursive: true, mode: 0o700 });
  const name = `${randomUUID()}.${kind}`;
  writeFileSync(join(uploadsDir(), name), bytes, { mode: 0o600, flag: "wx" });
  return name;
}

export function deleteSocialImage(name: string | null) {
  if (!name || !UPLOAD.test(name)) return;
  try { unlinkSync(join(uploadsDir(), name)); } catch { /* já não existe */ }
}

/** Caminho seguro de uma imagem pública (sincronizada ou enviada); null se o nome não for de um dos dois formatos. */
export function socialImagePath(file: string): { path: string; type: string } | null {
  const synced = /^[a-f0-9]{64}\.webp$/.test(file);
  const uploaded = /^m-(.+)$/.exec(file);
  const root = synced ? join(socialDir(), "images") : uploadsDir();
  const name = synced ? file : uploaded && UPLOAD.test(uploaded[1]!) ? uploaded[1]! : null;
  if (!name) return null;
  const path = resolve(root, name);
  if (!path.startsWith(root + sep)) return null;
  const ext = name.split(".").pop()!;
  return { path, type: ext === "jpg" ? "image/jpeg" : `image/${ext}` };
}
