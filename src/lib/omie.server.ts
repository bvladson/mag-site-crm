import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { isShowcaseCategory, type Product, type ProductSummary } from "@/data/catalog";
import { highlightScore } from "@/lib/search";

// The worker caches every photo locally (`-p` = small listing version); external URLs (signed, expiring) are never published.
const imageUrl = z.string().max(200).refine((value) =>
  value === "/images/product-placeholder.svg" || /^\/catalog-images\/[a-f0-9]{64}(-p)?\.(jpg|png|webp|gif)$/.test(value));

// Whitelist: unexpected cache fields, costs, prices, pending orders, reservations and stock locations never
// reach visitors. The quantity available for sale (commercial locations, net of orders) stays on the server for
// ordering only; since 05/10/2026 visitors get just the stock badge (see publicProduct).
const publicProductSchema = z.object({
  slug: z.string().max(200).regex(/^[a-z0-9-]+$/),
  sku: z.string().min(1).max(100), name: z.string().min(1).max(240),
  category: z.enum(["cadeiras", "mesas", "estacoes", "reuniao", "recepcao", "armazenamento", "escolar", "home-office", "pecas", "outros"]),
  environments: z.array(z.string().max(60)).max(10),
  brand: z.string().max(120), line: z.string().max(120), color: z.string().max(120),
  image: imageUrl, images: z.array(imageUrl).min(1).max(12),
  price: z.null(), stock: z.enum(["PRONTA_ENTREGA", "DISPONIVEL", "SOB_CONSULTA"]),
  unit: z.string().max(8).default("UN"),
  available: z.number().finite().nonnegative().nullable().default(null),
  description: z.string().max(6000),
  // Identidade e camada editorial (opcionais: catálogos anteriores a 05/10/2026 não têm).
  id: z.string().regex(/^[0-9]+$/).max(20).optional(),
  omieName: z.string().max(240).optional(),
  shortDescription: z.string().max(400).default(""),
  seoTitle: z.string().max(120).default(""),
  seoDescription: z.string().max(320).default(""),
  highlights: z.array(z.string().min(1).max(160)).max(12).default([]),
  specs: z.array(z.object({ label: z.string().min(1).max(60), value: z.string().min(1).max(200) })).max(30).default([]),
  featured: z.boolean().default(false),
  homePriority: z.number().int().min(1).max(999).nullable().default(null),
});
const snapshotSchema = z.object({
  schemaVersion: z.literal(1), generatedAt: z.string().datetime(),
  products: z.array(publicProductSchema).max(100000),
  // URL antiga (produto-<id> ou slug anterior) → slug atual. Usado para o 301.
  redirects: z.record(z.string().max(160), z.string().max(160)).default({}),
});
type Snapshot = z.infer<typeof snapshotSchema>;
let lastGood: Snapshot | undefined;
let lastPath = "";
let lastModified = -1;
let lastChecked = 0;
let loading: Promise<void> | undefined;
let summaries: { source: Snapshot; fresh: boolean; list: ProductSummary[] } | undefined;

async function refresh(catalogPath: string) {
  try {
    const file = await stat(catalogPath);
    if (file.size > 64 * 1024 * 1024) throw new Error("catalog_too_large");
    if (file.mtimeMs !== lastModified) {
      const parsed = snapshotSchema.parse(JSON.parse(await readFile(catalogPath, "utf8")));
      const slugs = new Set(parsed.products.map((product) => product.slug));
      if (slugs.size !== parsed.products.length) throw new Error("duplicate_product_slug");
      // Redirecionamento nunca aponta para slug inexistente nem sai de um slug que ainda é canônico (evita laço).
      for (const [from, to] of Object.entries(parsed.redirects)) if (!slugs.has(to) || slugs.has(from)) throw new Error("invalid_redirect");
      lastGood = parsed; lastModified = file.mtimeMs;
    }
  } catch {
    console.warn("[catalog] Snapshot unavailable or invalid; keeping the last valid catalog.");
  }
}

async function snapshot(): Promise<Snapshot | undefined> {
  const catalogPath = resolve(process.env["OMIE_CATALOG_PATH"] || "./data/catalog.json");
  const now = Date.now();
  if (catalogPath !== lastPath) {
    lastGood = undefined; lastModified = -1; lastChecked = 0; lastPath = catalogPath;
  }
  if (!loading && now - lastChecked > 15000) {
    lastChecked = now;
    loading = refresh(catalogPath).finally(() => { loading = undefined; });
  }
  // Loaders run in parallel: without a catalog yet (first request after start) every caller waits for
  // the same read. Later reloads serve the previous snapshot while the new one is parsed.
  if (!lastGood && loading) await loading;
  return lastGood;
}

/** Stock older than the limit shows "sob consulta" and no quantities, instead of stale numbers. */
function isFresh(source: Snapshot) {
  const configuredAge = Number(process.env["OMIE_STOCK_MAX_AGE_SECONDS"] || 108000);
  const maxAge = Number.isFinite(configuredAge) && configuredAge > 0 ? configuredAge * 1000 : 108000000;
  const age = Date.now() - Date.parse(source.generatedAt);
  return age >= -300000 && age <= maxAge;
}

type SnapshotProduct = Snapshot["products"][number];
function withFreshness(product: SnapshotProduct, fresh: boolean): SnapshotProduct {
  return fresh ? product : { ...product, stock: "SOB_CONSULTA", available: null };
}

/**
 * Versão pública do produto. A quantidade disponível NÃO sai do servidor (decisão de 05/10/2026): o navegador recebe
 * só `stock` (Pronta entrega / Disponível / Consulte). A quantidade continua aqui para ordenação e no worker/relatórios.
 */
function publicProduct(product: SnapshotProduct, fresh: boolean, stockUpdatedAt: string): Product {
  const { available: _internalOnly, ...visible } = withFreshness(product, fresh);
  return { ...visible, stockUpdatedAt };
}

/**
 * USO INTERNO — Consulta rápida do painel (/interno/produtos, só Admin e Comercial): o snapshot como está, COM a
 * quantidade disponível. Nenhuma rota pública usa esta função; as rotas que a usam exigem sessão e perfil no servidor.
 */
export async function readInternalCatalog(): Promise<{ generatedAt: string; fresh: boolean; products: SnapshotProduct[] } | null> {
  const source = await snapshot();
  return source ? { generatedAt: source.generatedAt, fresh: isFresh(source), products: source.products } : null;
}

/** This server-only reader has no Omie API credentials or outbound calls. */
export async function readCatalog(): Promise<Product[]> {
  const source = await snapshot();
  if (!source) return [];
  const fresh = isFresh(source);
  return source.products.map((product) => publicProduct(product, fresh, source.generatedAt));
}

export async function readProduct(slug: string): Promise<Product | undefined> {
  const source = await snapshot();
  const product = source?.products.find((item) => item.slug === slug);
  return product && source ? publicProduct(product, isFresh(source), source.generatedAt) : undefined;
}

/** Alterna categorias na vitrine (mesma regra de antes, agora no servidor). */
function interleave<T extends { category: string }>(list: T[], size: number) {
  const groups = new Map<string, T[]>();
  for (const item of list) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
  const out: T[] = [];
  while (out.length < size && [...groups.values()].some((group) => group.length)) {
    for (const group of groups.values()) { const next = group.shift(); if (next && out.length < size) out.push(next); }
  }
  return out;
}

let showcase: { source: Snapshot; fresh: boolean; value: { ready: string[]; featured: string[] } } | undefined;

/**
 * Vitrines da home (slugs, em ordem). Calculadas no servidor porque o desempate usa a quantidade disponível, que não
 * vai ao navegador. Mesma regra de antes: home_priority → destaque/foto/pronta entrega → mais estoque; só mobiliário.
 */
export async function readHomeShowcase(): Promise<{ ready: string[]; featured: string[] }> {
  const source = await snapshot();
  if (!source) return { ready: [], featured: [] };
  const fresh = isFresh(source);
  if (showcase?.source === source && showcase.fresh === fresh) return showcase.value;
  const ranked = source.products.map((product) => withFreshness(product, fresh))
    .filter((product) => isShowcaseCategory(product.category))
    .sort((a, b) => (a.homePriority ?? 1000) - (b.homePriority ?? 1000) || highlightScore(b) - highlightScore(a) || (b.available ?? 0) - (a.available ?? 0));
  const ready = interleave(ranked.filter((product) => product.stock === "PRONTA_ENTREGA"), 8);
  const shown = new Set(ready.map((product) => product.slug));
  const featured = interleave(ranked.filter((product) => !shown.has(product.slug)), 8);
  showcase = { source, fresh, value: { ready: ready.map((product) => product.slug), featured: featured.map((product) => product.slug) } };
  return showcase.value;
}

/** Slug canônico para uma URL antiga (/produto/produto-<id> ou slug anterior); null se não houver. */
export async function resolveProductRedirect(slug: string): Promise<string | null> {
  const source = await snapshot();
  return source?.redirects[slug] ?? null;
}

/** Aceita slug atual, antigo ou produto-<id> (ex.: lista de orçamento salva no navegador antes da troca de URL). */
export async function canonicalProductSlug(slug: string): Promise<string | null> {
  const source = await snapshot();
  if (!source) return null;
  if (source.products.some((product) => product.slug === slug)) return slug;
  return source.redirects[slug] ?? null;
}

/** Light list for listings, search and the quote cart: no description or gallery. */
export async function readCatalogIndex(): Promise<ProductSummary[]> {
  const source = await snapshot();
  if (!source) return [];
  const fresh = isFresh(source);
  if (summaries?.source !== source || summaries.fresh !== fresh) {
    summaries = {
      source, fresh,
      list: source.products.map((product) => {
        // Lista branca: a quantidade disponível fica de fora (ver publicProduct).
        const { id, slug, sku, name, category, environments, brand, line, color, image, price, stock, unit, featured, homePriority } = withFreshness(product, fresh);
        return { ...(id ? { id } : {}), slug, sku, name, category, environments, brand, line, color, image, price, stock, unit, featured, homePriority };
      }),
    };
  }
  return summaries.list;
}

export async function catalogHealth() {
  const source = await snapshot();
  return source
    ? { products: source.products.length, generatedAt: source.generatedAt, fresh: isFresh(source) }
    : { products: 0, generatedAt: null, fresh: false };
}
