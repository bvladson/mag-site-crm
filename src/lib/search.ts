/**
 * Busca tolerante a erros sobre o catálogo (client-side).
 * Quando o catálogo vier do Omie/PostgreSQL, trocar por pg_trgm no servidor.
 */
import { categories, environments, isShowcaseCategory, productPlaceholderImage, type ProductSummary } from "@/data/catalog";

export const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function lev(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length]!;
}

/** Pontua o quanto um termo casa com um texto (0 = não casa). */
function wordScore(word: string, tokens: string[]) {
  let best = 0;
  const w = word.replace(/s$/, "");
  for (const t of tokens) {
    if (t === w) return 3;
    if (t.startsWith(w)) best = Math.max(best, 2.5);
    else if (t.includes(w) && w.length >= 3) best = Math.max(best, 2);
    else if (w.length >= 4) {
      const cut = t.slice(0, w.length);
      const dist = Math.min(lev(w, t), lev(w, cut));
      if (dist <= (w.length >= 7 ? 2 : 1)) best = Math.max(best, 1.5);
    }
  }
  return best;
}

const STOPWORDS = new Set(["de", "da", "do", "das", "dos", "e", "com", "para", "pra", "em", "na", "no", "um", "uma"]);
/** Palavras da busca: hífen e barra também separam (endereços antigos chegam como "cadeira-eiffel-braco"). */
const queryWords = (query: string) => norm(query).split(/[^a-z0-9]+/).filter((w) => w && !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w)));

export function scoreText(query: string, text: string) {
  const words = queryWords(query);
  if (!words.length) return 1;
  const tokens = norm(text).split(/[^a-z0-9]+/).filter(Boolean);
  // Buscas curtas exigem todas as palavras; nomes longos (ex.: endereço antigo) aceitam até metade sem casar.
  let misses = words.length >= 4 ? Math.floor(words.length / 2) : 0;
  let total = 0;
  for (const w of words) {
    const s = wordScore(w, tokens);
    if (!s && --misses < 0) return 0;
    total += s;
  }
  return total;
}

const productText = (p: ProductSummary & { description?: string }) =>
  `${p.name} ${p.sku} ${categories.find((c) => c.slug === p.category)?.name ?? ""} ${p.brand} ${p.line} ${p.color} ${p.environments
    .map((e) => environments.find((x) => x.slug === e)?.name ?? e)
    .join(" ")} ${p.description ?? ""}`;

/** Destaque manual > mobiliário com foto e pronta entrega > peças e outros (sempre por último). */
export const highlightScore = (p: ProductSummary) =>
  (p.featured ? 6 : 0) + (isShowcaseCategory(p.category) ? 2 : p.category === "pecas" ? -2 : -3) +
  (p.image && p.image !== productPlaceholderImage ? 2 : 0) + (p.stock === "PRONTA_ENTREGA" ? 1 : 0);

export function searchProducts<T extends ProductSummary>(query: string, list: T[]): T[] {
  if (!query.trim()) return list;
  return list
    .map((p) => ({ p, s: scoreText(query, productText(p)) + (scoreText(query, p.name) ? 2 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
}

export function suggest(query: string, products: ProductSummary[]) {
  if (norm(query).trim().length < 2) return null;
  return {
    products: searchProducts(query, products).slice(0, 5),
    categories: categories.filter((c) => scoreText(query, c.name) > 0).slice(0, 3),
    environments: environments.filter((e) => scoreText(query, `${e.name} ${e.tagline}`) > 0).slice(0, 3),
  };
}
