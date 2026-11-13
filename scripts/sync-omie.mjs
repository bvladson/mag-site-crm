#!/usr/bin/env node
/**
 * Read-only worker, Node >=22: node --env-file=/opt/mag-site/secrets/omie.env scripts/sync-omie.mjs
 *   --if-stale-hours=N  sai sem consultar o Omie se a última sincronização boa tem menos de N horas
 *                       (usado na execução de reserva, que só age quando a das 04:00 falhou).
 *   --watch             repete a cada OMIE_SYNC_INTERVAL_SECONDS (padrão 1800).
 * Credentials belong ONLY in the worker, never VITE_* or the web container.
 * Contracts: https://app.omie.com.br/api/v1/geral/produtos/   (ListarProdutos, até 100 por página)
 *            https://app.omie.com.br/api/v1/estoque/local/    (ListarLocaisEstoque)
 *            https://app.omie.com.br/api/v1/estoque/consulta/ (ListarPosEstoque, até 50 por página e por local)
 *
 * O Omie diz o que existe; o site só publica mobiliário e peças (decisão da MAG, 05/10/2026) e só
 * mostra o disponível para venda dos depósitos comerciais. Exceções por produto: catalog/overrides.json.
 */
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const API = "https://app.omie.com.br/api/v1/";
const PLACEHOLDER = "/images/product-placeholder.svg";
const IMAGE_ROUTE = "/catalog-images/";
const IMAGE_FILE = /^([a-f0-9]{64})(-p)?\.(jpg|png|webp|gif)$/;
const MAX_IMAGES_PER_PRODUCT = 6;
const STOCK_PAGE_SIZE = 50; // o Omie limita ListarPosEstoque a 50 por página, mesmo pedindo mais
export const FURNITURE_CATEGORIES = ["cadeiras", "mesas", "estacoes", "reuniao", "recepcao", "armazenamento", "escolar", "home-office"];
export const PUBLIC_CATEGORIES = [...FURNITURE_CATEGORIES, "pecas", "outros"];
const normalize = (value) => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const clean = (value, max = 240) => String(value ?? "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]*>/g, " ").replace(/&quot;/g, "\"").replace(/&amp;/g, "&")
  .replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const yes = (value) => ["s", "sim", "true", "1"].includes(normalize(value).trim());
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const identifier = (value) => /^\d+$/.test(String(value ?? "")) && Number(value) > 0 ? String(value) : null;
const quantity = (value) => Math.round(value * 1000) / 1000;
const nameList = (value) => String(value ?? "").split(",").map((item) => normalize(item).trim()).filter(Boolean);
export const ENVIRONMENTS = ["diretoria", "operacional", "reuniao", "recepcao", "call-center", "home-office", "educacao"];
export const CATEGORY_NAMES = {
  cadeiras: "Cadeiras", mesas: "Mesas", estacoes: "Estações de trabalho", reuniao: "Reunião", recepcao: "Recepção",
  armazenamento: "Armazenamento", escolar: "Escolar", "home-office": "Home Office", pecas: "Peças e reposição", outros: "Outros produtos",
};
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LEGACY_SLUG = /^produto-\d+$/; // URL técnica usada até 05/10/2026; hoje só redireciona

/** "ARMARIO ALTO FEC 2 P 30MM ALMERIA" → "armario-alto-fec-2-p-30mm-almeria" (corta em fim de palavra). */
export function slugify(value, max = 70) {
  const slug = normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max + 1);
  const end = cut.lastIndexOf("-");
  return (end >= 20 ? cut.slice(0, end) : slug.slice(0, max)).replace(/-+$/, "");
}

class SyncError extends Error {
  constructor(code, retryable = false, retryAfterMs = 0) {
    super(code); this.code = code; this.retryable = retryable; this.retryAfterMs = retryAfterMs;
  }
}

export function configFromEnv(env = process.env) {
  const integer = (name, fallback, min, max) => {
    const number = Number(env[name] || fallback);
    if (!Number.isInteger(number) || number < min || number > max) throw new SyncError(`invalid_${name}`);
    return number;
  };
  const catalogPath = resolve(env.OMIE_CATALOG_PATH || "./data/catalog.json");
  return {
    appKey: env.OMIE_APP_KEY || "", appSecret: env.OMIE_APP_SECRET || "", catalogPath,
    statusPath: resolve(env.OMIE_STATUS_PATH || join(dirname(catalogPath), "catalog.status.json")),
    overridesPath: resolve(env.OMIE_OVERRIDES_PATH || join(dirname(catalogPath), "overrides.json")),
    editorialPath: resolve(env.OMIE_EDITORIAL_PATH || join(dirname(catalogPath), "editorial.json")),
    slugsPath: resolve(env.OMIE_SLUGS_PATH || join(dirname(catalogPath), "slugs.json")),
    historyPath: resolve(env.OMIE_HISTORY_PATH || join(dirname(catalogPath), "sync-history.jsonl")),
    reportPath: resolve(env.OMIE_REPORT_PATH || join(dirname(catalogPath), "reports", "products-without-images.csv")),
    legacySlugsPath: resolve(env.OMIE_LEGACY_SLUGS_PATH || fileURLToPath(new URL("./legacy-product-slugs.json", import.meta.url))),
    imageDir: env.OMIE_IMAGE_DIR ? resolve(env.OMIE_IMAGE_DIR) : null,
    pageSize: integer("OMIE_PAGE_SIZE", 100, 1, 100),
    minIntervalMs: integer("OMIE_REQUEST_INTERVAL_MS", 2500, 1000, 60000),
    intervalSeconds: integer("OMIE_SYNC_INTERVAL_SECONDS", 1800, 300, 86400),
    readyThreshold: integer("OMIE_READY_STOCK_THRESHOLD", 1, 1, 100000),
    imageConcurrency: integer("OMIE_IMAGE_CONCURRENCY", 4, 1, 8),
    maxImageBytes: integer("OMIE_IMAGE_MAX_BYTES", 8 * 1024 * 1024, 64 * 1024, 32 * 1024 * 1024),
    // Locais que nunca contam como disponível para venda (trecho do código ou da descrição no Omie).
    // Além desta lista, local com "disponível para venda" = N no Omie também fica de fora.
    nonCommercialLocations: nameList(env.OMIE_LOCATIONS_NOT_COMMERCIAL ?? "AVARIA,LICITAÇÃO,IMPORTAÇÃO,ASSISTÊNCIA,DEMONSTRAÇÃO,USO INTERNO,MOSTRUÁRIO"),
    maxPages: 2000, maxAttempts: 3, timeoutMs: 60000,
  };
}

/** Serial requests. Response bodies/faultstrings can contain credentials and are never logged. */
export function createOmieClient(config, { fetchImpl = fetch, sleepImpl = sleep, now = Date.now } = {}) {
  let lastRequestAt = 0;
  return async (endpoint, call, params) => {
    for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
      const wait = config.minIntervalMs - (now() - lastRequestAt);
      if (wait > 0) await sleepImpl(wait);
      lastRequestAt = now();
      try {
        const response = await fetchImpl(`${API}${endpoint}/`, {
          method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ call, app_key: config.appKey, app_secret: config.appSecret, param: [params] }),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
        // HTTP 425 means a 30-minute provider block. Stop rather than extending it.
        if (response.status === 425) throw new SyncError("omie_temporarily_blocked");
        const retrySeconds = Number(response.headers.get("retry-after"));
        let result;
        try { result = await response.json(); } catch { result = undefined; }
        // Omie answers application faults (bad key, throttling, empty list) with HTTP 500 + faultstring.
        if (result?.faultcode || result?.faultstring) {
          const fault = normalize(result.faultstring);
          if (/nao existem registros|nenhum registro/.test(fault)) throw new SyncError("omie_no_records");
          const throttle = /too many|limite|consumo|redundant|ja foi realizad|aguard|60 segundo/.test(fault);
          const credentials = /app_key|app_secret|chave de acesso|nao autorizad|invalid.*key/.test(fault);
          throw new SyncError(throttle ? "omie_rate_limit" : credentials ? "omie_credentials_rejected" : "omie_api_fault", throttle, 65000);
        }
        if (!response.ok) throw new SyncError(`omie_http_${response.status}`, response.status === 429 || response.status >= 500,
          Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 0);
        if (result === undefined) throw new SyncError("omie_invalid_json", true);
        if (!result || typeof result !== "object" || Array.isArray(result)) throw new SyncError("omie_invalid_response");
        return result;
      } catch (error) {
        const failure = error instanceof SyncError ? error : new SyncError("omie_network_error", true);
        if (!failure.retryable || attempt + 1 >= config.maxAttempts) throw failure;
        // Repeating before 60 seconds can reset Omie's redundant-request block.
        await sleepImpl(Math.max(65000 * (2 ** attempt), failure.retryAfterMs));
      }
    }
    throw new SyncError("omie_retry_exhausted");
  };
}

export async function readAllPages(call, { endpoint, method, params, pageKey, pagesKey, totalKey, rowsKey, maxPages = 2000 }) {
  const rows = [];
  let expectedPages; let expectedTotal;
  for (let page = 1; page <= maxPages; page += 1) {
    let result;
    try {
      result = await call(endpoint, method, { ...params, [pageKey]: page });
    } catch (error) {
      // Lista vazia: o Omie responde com a falha "Não existem registros para a página [1]".
      if (page === 1 && error?.code === "omie_no_records") return [];
      throw error;
    }
    const pages = finite(result[pagesKey]); const total = finite(result[totalKey]); const batch = result[rowsKey] ?? (total === 0 ? [] : undefined);
    if (finite(result[pageKey]) !== page || !Number.isInteger(pages) || pages < 0 || pages > maxPages ||
      !Number.isInteger(total) || total < 0 || !Array.isArray(batch)) throw new SyncError(`invalid_page_${method}`);
    if (page === 1) { expectedPages = pages; expectedTotal = total; }
    if (pages !== expectedPages || total !== expectedTotal) throw new SyncError(`changed_pagination_${method}`);
    if (!batch.length && total > 0) throw new SyncError(`empty_page_${method}`);
    rows.push(...batch);
    if (page >= pages) {
      if (rows.length !== total) throw new SyncError(`incomplete_${method}`);
      return rows;
    }
  }
  throw new SyncError(`pagination_limit_${method}`);
}

// ---------- Limpeza de cadastro ----------
const JUNK = new Set(["", "-", "--", ".", "..", "...", "0", "00", "000", "n/a", "na", "nd", "n/d", "sn", "s/n", "null", "none", "undefined",
  "sdf", "srf", "asd", "asdf", "qwe", "qwer", "xxx", "xx", "x", "teste", "test", "abc", "sem", "nenhum", "nenhuma", "?"]);
/** Valor de cadastro só vai ao site se parecer informação de verdade ("sdf", "0", "." e afins somem). */
export function meaningful(value, max = 120) {
  const text = clean(value, max);
  const key = normalize(text).trim();
  if (JUNK.has(key) || !/[a-z0-9]/.test(key) || /^(.)\1*$/.test(key.replace(/\s/g, ""))) return "";
  if (/^(asd|sdf|dfg|qwe|wer|zxc)+$/.test(key.replace(/\s/g, ""))) return "";
  return text;
}

// ---------- Classificação: primeira palavra do nome (com abreviações do cadastro) → palavra-chave → não publica ----------
const FIRST_WORD = {
  cadeira: "cadeiras", cad: "cadeiras", poltrona: "cadeiras", banqueta: "cadeiras", banco: "cadeiras",
  longarina: "recepcao", long: "recepcao", sofa: "recepcao", puff: "recepcao", puf: "recepcao", balcao: "recepcao", opus: "recepcao",
  mesa: "mesas", escrivaninha: "mesas", reuniao: "reuniao",
  armario: "armazenamento", arm: "armazenamento", gaveteiro: "armazenamento", gav: "armazenamento", estante: "armazenamento",
  arquivo: "armazenamento", arq: "armazenamento", roupeiro: "armazenamento", roup: "armazenamento", prateleira: "armazenamento",
  prateleiras: "armazenamento", rack: "armazenamento", armarios: "armazenamento",
  estacao: "estacoes", plataforma: "estacoes", plat: "estacoes", biombo: "estacoes", cabine: "estacoes", divisoria: "estacoes", painel: "estacoes",
  carteira: "escolar", movel: "outros",
  // Peças e reposição
  braco: "pecas", "a/e": "pecas", assento: "pecas", "assento/encosto": "pecas", encosto: "pecas", apoia: "pecas", apoio: "pecas",
  kit: "pecas", comp: "pecas", capa: "pecas", estrutura: "pecas", estr: "pecas", base: "pecas", mecanismo: "pecas", coluna: "pecas",
  rodizio: "pecas", rodizios: "pecas", pistao: "pecas", ponteira: "pecas", sapata: "pecas", pe: "pecas", prancheta: "pecas", prolongador: "pecas",
  tampo: "pecas", sub: "pecas", lamina: "pecas", alma: "pecas", concha: "pecas", espuma: "pecas", bandeja: "pecas", barra: "pecas",
  batente: "pecas", aro: "pecas", pescoco: "pecas", porta: "pecas", cj: "pecas", puxador: "pecas", corredica: "pecas",
  dobradica: "pecas", fechadura: "pecas", frente: "pecas", suporte: "pecas", calha: "pecas", ponteiras: "pecas", sapatas: "pecas",
};
const SCHOOL = /\bfnde\b|escolar|universitar|infantil|juvenil/;
const KEYWORDS = [
  [/\bcadeira|\bpoltrona|\bbanqueta|\blounge\b|\brelax\b|\brlx\b|\bergo\b/, "cadeiras"],
  [/\blongarina|\bsofa\b|\bpuff?\b|\bbalcao\b|\brecepc/, "recepcao"],
  [/\bmesa\b.*\b(reuniao|conferencia)|\b(reuniao|conferencia)\b.*\bmesa\b/, "reuniao"],
  [/\bestacao\b|\bplataforma\b|\bcall.?center\b|\bbaia\b/, "estacoes"],
  [/\barmario|\bgaveteiro|\bestante|\broupeiro|\blocker/, "armazenamento"],
  [/\bmesa\b|\bescrivaninha/, "mesas"],
  [/\bhome.?office\b/, "home-office"],
];

/** Categoria do site ou null (não publicar). Decisão por produto pode ser sobrescrita em overrides.json. */
export function categoryOf(raw) {
  const name = normalize(raw.descricao);
  const text = normalize(`${raw.descricao || ""} ${raw.descricao_familia || ""}`);
  if (/^\s*copia de\b/.test(name)) return null; // cópia de cadastro feita no Omie
  if (/^\s*\*{3}/.test(name)) return null; // "***" marca os itens de informática no cadastro
  const first = name.replace(/^[^a-z0-9]+/, "").split(/\s+/)[0].replace(/[.,:;]+$/, "");
  const known = Object.hasOwn(FIRST_WORD, first);
  let category = known ? FIRST_WORD[first] : null;
  if (first === "mini" && /\broup/.test(name)) category = "armazenamento";
  if ((first === "conj" || first === "conjunto")) category = /refeitorio/.test(name) ? "mesas" : SCHOOL.test(text) ? "escolar" : /\b(frente|gav|pedestal)\b/.test(name) ? "pecas" : null;
  if (first === "flash" && /\b(apoio|cj|kit|assento|encosto|braco)\b/.test(name)) category = "pecas";
  if (category === "estacoes" && first === "divisoria" && /granito/.test(name)) category = null;
  if (category === "mesas" && /\b(reuniao|conferencia)\b/.test(name)) category = "reuniao";
  if (category === "mesas" && /\b(plataforma|estacao|bench)\b/.test(name)) category = "estacoes";
  if (category === null && !known) {
    for (const [pattern, match] of KEYWORDS) if (pattern.test(name)) { category = match; break; }
  }
  if (category && ["cadeiras", "mesas"].includes(category) && SCHOOL.test(text)) category = "escolar";
  return category;
}

function environmentsOf(raw, category) {
  const text = normalize(raw.descricao); const environments = new Set();
  if (category === "pecas") return [];
  if (/diretor|presidente|executiv/.test(text)) environments.add("diretoria");
  if (/reuniao|conferencia/.test(text)) environments.add("reuniao");
  if (/home.?office/.test(text)) environments.add("home-office");
  if (/call.?center|baia/.test(text)) environments.add("call-center");
  if (category === "escolar") environments.add("educacao");
  if (category === "recepcao") environments.add("recepcao");
  if (/operacional|escritorio/.test(text) || ["estacoes", "armazenamento"].includes(category)) environments.add("operacional");
  return [...environments];
}

/** "ESTOQUE BR 116" → "Estoque BR 116"; siglas sem vogal continuam maiúsculas. Usado no status interno. */
export function locationName(value) {
  const small = new Set(["de", "da", "do", "das", "dos", "e", "em"]);
  return clean(value, 60).toLowerCase().split(" ").map((word, index) => {
    if (/^[a-z]{1,3}$/.test(normalize(word)) && !/[aeiou]/.test(normalize(word))) return word.toUpperCase();
    if (index > 0 && small.has(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
}

/** Locais ativos do Omie. Comercial = disponível para venda no Omie e fora da lista de exclusão. */
export function describeLocations(rawLocations, { nonCommercialLocations = [] } = {}) {
  const seen = new Set();
  return rawLocations.filter((raw) => !yes(raw?.inativo)).map((raw) => {
    const id = identifier(raw?.codigo_local_estoque);
    if (!id || seen.has(id)) throw new SyncError("invalid_or_duplicate_location");
    seen.add(id);
    const text = `${normalize(raw.codigo)} | ${normalize(raw.descricao)}`;
    const forSale = raw.dispVenda === undefined || yes(raw.dispVenda);
    return {
      id, name: locationName(raw.descricao || raw.codigo) || `Local ${id}`, isDefault: yes(raw.padrao),
      commercial: forSale && !nonCommercialLocations.some((term) => text.includes(term)),
    };
  });
}

/** Source URLs stay inside the worker: they are signed (Expires/Signature), so never published or logged. */
function sourceImagesOf(raw) {
  return [...new Set((Array.isArray(raw.imagens) ? raw.imagens : []).map((photo) => {
    try {
      const url = new URL(String(photo?.url_imagem ?? "").trim());
      return url.protocol === "https:" && !url.username && !url.password && url.href.length <= 4096 ? url.href : null;
    } catch { return null; }
  }).filter(Boolean))].slice(0, MAX_IMAGES_PER_PRODUCT);
}

// ---------- Camada editorial (catalog/editorial.json) ----------
const textField = (max, min = 0) => (value) => typeof value === "string" && value.trim().length >= min && value.length <= max;
const EDITORIAL_FIELDS = {
  commercial_name: textField(160, 2), short_description: textField(400), long_description: textField(6000),
  seo_title: textField(120), seo_description: textField(320),
  slug: (value) => typeof value === "string" && value.length <= 120 && SLUG.test(value) && !LEGACY_SLUG.test(value),
  category_override: (value) => PUBLIC_CATEGORIES.includes(value),
  environment_override: (value) => Array.isArray(value) && value.length <= ENVIRONMENTS.length && value.every((item) => ENVIRONMENTS.includes(item)),
  featured: (value) => typeof value === "boolean",
  home_priority: (value) => Number.isInteger(value) && value >= 1 && value <= 999,
  published: (value) => typeof value === "boolean",
  technical_specs: (value) => Array.isArray(value) && value.length <= 30 && value.every((spec) => spec && typeof spec === "object" &&
    Object.keys(spec).every((key) => key === "label" || key === "value") && textField(60, 1)(spec.label) && textField(200, 1)(spec.value)),
  marketing_highlights: (value) => Array.isArray(value) && value.length <= 12 && value.every(textField(160, 1)),
};

/**
 * editorial.json: { "<codigo_produto Omie>": { "commercial_name": "...", "slug": "...", ... } }.
 * Chaves que começam com "_" são comentários. Campo desconhecido ou inválido para a sincronização
 * (o catálogo publicado não muda) — erro de digitação nunca vira dado no site.
 */
export function parseEditorial(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncError("invalid_editorial");
  const editorial = new Map();
  for (const [id, entry] of Object.entries(value)) {
    if (id.startsWith("_")) continue;
    if (!identifier(id) || !entry || typeof entry !== "object" || Array.isArray(entry)) throw new SyncError("invalid_editorial");
    for (const [field, fieldValue] of Object.entries(entry)) {
      if (field.startsWith("_")) continue;
      if (!Object.hasOwn(EDITORIAL_FIELDS, field)) throw new SyncError(`invalid_editorial_field_${field}`.slice(0, 80));
      if (fieldValue !== null && !EDITORIAL_FIELDS[field](fieldValue)) throw new SyncError(`invalid_editorial_${field}`);
    }
    editorial.set(id, Object.fromEntries(Object.entries(entry).filter(([field, fieldValue]) => !field.startsWith("_") && fieldValue !== null)));
  }
  return editorial;
}

/** overrides.json: { "<codigo_produto Omie>": { "category": "cadeiras" | ..., "publish": true|false } } */
export function parseOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncError("invalid_overrides");
  const overrides = new Map();
  for (const [id, entry] of Object.entries(value)) {
    if (!identifier(id) || !entry || typeof entry !== "object") throw new SyncError("invalid_overrides");
    if (entry.category !== undefined && !PUBLIC_CATEGORIES.includes(entry.category)) throw new SyncError("invalid_overrides_category");
    if (entry.publish !== undefined && typeof entry.publish !== "boolean") throw new SyncError("invalid_overrides_publish");
    overrides.set(id, { category: entry.category, publish: entry.publish });
  }
  return overrides;
}

/**
 * Monta o catálogo público.
 * - Publica só mobiliário e peças; o resto do cadastro (uniformes, alimentos, elétrica, informática…) fica só no Omie.
 * - Disponível = saldo dos locais comerciais − pendências/reservas desses mesmos locais (nunca negativo).
 *   Locais não comerciais (Avaria, Licitação, Importação…) não entram e não aparecem.
 * - Custo, preço, pendências, reservas e nomes de locais nunca são publicados.
 * Ordem das decisões: dados do Omie → classificação automática → overrides.json → editorial.json.
 * O slug definitivo é atribuído depois, por assignSlugs (registro persistente).
 */
export function buildCatalog(rawProducts, locations, { readyThreshold = 1, overrides = new Map(), editorial = new Map() } = {}) {
  const byProduct = new Map();
  for (const location of locations) {
    const seen = new Set();
    for (const row of location.rows ?? []) {
      const id = identifier(row?.nCodProd);
      if (!id || seen.has(id)) throw new SyncError("invalid_or_duplicate_stock_id");
      if (row.codigo_local_estoque !== undefined && String(row.codigo_local_estoque) !== location.id) throw new SyncError("stock_location_mismatch");
      seen.add(id);
      if (!byProduct.has(id)) byProduct.set(id, []);
      byProduct.get(id).push({ location, row });
    }
  }
  const seen = new Set(); const products = [];
  let excluded = 0; let unknownStock = 0; let notFurniture = 0; let hiddenByOverride = 0;
  for (const raw of rawProducts) {
    const id = identifier(raw?.codigo_produto);
    if (!id || seen.has(id)) throw new SyncError("invalid_or_duplicate_product_id");
    seen.add(id);
    const type = String(raw.tipoItem || raw.recomendacoes_fiscais?.tipoItem || "");
    if (yes(raw.inativo) || yes(raw.bloqueado) || ["01", "02", "03", "05", "06", "07", "08", "09", "10"].includes(type)) {
      excluded += 1; continue;
    }
    const override = overrides.get(id);
    const edit = editorial.get(id) ?? {};
    const publish = edit.published ?? override?.publish;
    if (publish === false) { hiddenByOverride += 1; continue; }
    const category = edit.category_override ?? override?.category ?? categoryOf(raw) ?? (publish === true ? "outros" : null);
    if (!category) { notFurniture += 1; continue; }
    const omieName = clean(raw.descricao); const sku = clean(raw.codigo, 100);
    if (!omieName || !sku) throw new SyncError("missing_product_identity");
    const name = edit.commercial_name ? clean(edit.commercial_name, 160) : omieName;
    // Texto que só repete o nome não vai ao site (vale para o Omie e para o editorial).
    const own = (value, max) => { const result = meaningful(value, max); return result && ![normalize(name), normalize(omieName)].includes(normalize(result)) ? result : ""; };
    const characteristics = new Map((Array.isArray(raw.caracteristicas) ? raw.caracteristicas : [])
      .map((item) => [normalize(item?.cNomeCaract).trim(), item?.cConteudo]));

    const entries = byProduct.get(id) ?? [];
    const known = entries.some(({ location }) => location.isDefault);
    let onHand = 0; let committed = 0;
    for (const { location, row } of entries) {
      if (!location.commercial) continue;
      const balance = finite(row.nSaldo); const physical = finite(row.fisico);
      committed += Math.max(0, finite(row.nPendente) ?? 0, finite(row.reservado) ?? 0);
      if (balance !== null) onHand += Math.max(0, Math.min(balance, physical ?? balance));
    }
    if (!known) unknownStock += 1;
    const available = known ? quantity(Math.max(0, onHand - committed)) : null;
    products.push({
      id, slug: `produto-${id}`, sku, name, omieName, category, environments: edit.environment_override ?? environmentsOf(raw, category),
      brand: meaningful(raw.marca || characteristics.get("marca")),
      line: meaningful(characteristics.get("linha") || raw.modelo), color: meaningful(characteristics.get("cor")),
      image: PLACEHOLDER, images: [PLACEHOLDER], price: null,
      stock: available !== null && available >= readyThreshold ? "PRONTA_ENTREGA" :
        available !== null && available > 0 ? "DISPONIVEL" : "SOB_CONSULTA",
      unit: clean(raw.unidade, 8).toUpperCase() || "UN",
      available,
      // Descrição: editorial, senão o texto próprio do Omie; nunca a repetição do nome.
      description: own(edit.long_description, 6000) || own(raw.descr_detalhada, 6000),
      shortDescription: own(edit.short_description, 400),
      seoTitle: clean(edit.seo_title, 120), seoDescription: clean(edit.seo_description, 320),
      highlights: (edit.marketing_highlights ?? []).map((item) => clean(item, 160)).filter(Boolean),
      specs: (edit.technical_specs ?? []).map(({ label, value }) => ({ label: clean(label, 60), value: clean(value, 200) })).filter((spec) => spec.label && spec.value),
      featured: edit.featured ?? false, homePriority: edit.home_priority ?? null,
      editorialSlug: edit.slug ?? null, // consumido por assignSlugs
      sourceImages: sourceImagesOf(raw),
    });
  }
  products.sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id));
  return { products, excluded, unknownStock, notFurniture, hiddenByOverride };
}

/**
 * URL amigável persistente. O registro (catalog/slugs.json) guarda o slug de cada código do Omie e
 * nunca o recalcula pelo nome: mudar o nome no Omie ou no editorial não muda a URL. Slug novo só
 * quando o produto aparece pela 1ª vez (nome-sku; com o ID no fim se colidir) ou quando o editorial
 * define outro — o anterior vira "previous" e redireciona (301) para o atual.
 * `reserved`: slugs das URLs antigas do WordPress (/produto/<slug>), tratados no Nginx.
 */
export function assignSlugs(products, registry, { reserved = new Set(), now = new Date() } = {}) {
  const taken = new Map();
  for (const [id, entry] of registry) for (const slug of [entry.slug, ...(entry.previous ?? [])]) taken.set(slug, id);
  const free = (slug, id) => SLUG.test(slug) && !LEGACY_SLUG.test(slug) && !reserved.has(slug) && (!taken.has(slug) || taken.get(slug) === id);
  let created = 0; let changed = 0;
  for (const product of [...products].sort((a, b) => Number(a.id) - Number(b.id))) {
    let entry = registry.get(product.id);
    const wanted = product.editorialSlug;
    if (wanted && entry?.slug !== wanted) {
      if (!free(wanted, product.id)) throw new SyncError("editorial_slug_conflict");
      if (entry) {
        entry.previous = [...new Set([...(entry.previous ?? []), entry.slug])].filter((slug) => slug !== wanted);
        entry.slug = wanted; entry.changedAt = now.toISOString(); changed += 1;
      } else {
        entry = { slug: wanted, sku: product.sku, omieName: product.omieName, assignedAt: now.toISOString(), previous: [] };
        registry.set(product.id, entry); created += 1;
      }
      taken.set(wanted, product.id);
    }
    if (!entry) {
      const name = slugify(product.omieName) || "produto";
      const code = slugify(product.sku, 40);
      const base = code ? `${name}-${code}` : `${name}-${product.id}`;
      // nome-sku → nome-sku-ID → base-ID → base-ID-2…: sempre há saída, e sempre determinística.
      const candidates = [base, `${name}-${code ? `${code}-` : ""}${product.id}`, `${base}-${product.id}`];
      for (let suffix = 2; suffix <= 50; suffix += 1) candidates.push(`${base}-${product.id}-${suffix}`);
      const candidate = candidates.find((slug) => free(slug, product.id));
      if (!candidate) throw new SyncError("slug_unresolvable");
      entry = { slug: candidate, sku: product.sku, omieName: product.omieName, assignedAt: now.toISOString(), previous: [] };
      registry.set(product.id, entry); taken.set(candidate, product.id); created += 1;
    }
    product.slug = entry.slug;
    delete product.editorialSlug;
  }
  const redirects = {};
  for (const product of products) {
    redirects[`produto-${product.id}`] = product.slug;
    for (const previous of registry.get(product.id).previous ?? []) if (previous !== product.slug) redirects[previous] = product.slug;
  }
  return { redirects, created, changed };
}

export function parseSlugRegistry(value) {
  if (!value || value.schemaVersion !== 1 || !value.products || typeof value.products !== "object") throw new SyncError("invalid_slug_registry");
  const registry = new Map(); const seen = new Set();
  for (const [id, entry] of Object.entries(value.products)) {
    if (!identifier(id) || !entry || !SLUG.test(entry.slug ?? "") || !Array.isArray(entry.previous ?? [])) throw new SyncError("invalid_slug_registry");
    for (const slug of [entry.slug, ...(entry.previous ?? [])]) {
      if (seen.has(slug)) throw new SyncError("duplicate_slug_in_registry");
      seen.add(slug);
    }
    registry.set(id, { ...entry, previous: [...(entry.previous ?? [])] });
  }
  return registry;
}

// ---------- Relatório de produtos publicados sem foto (catalog/reports/products-without-images.csv) ----------
const STRATEGIC_CATEGORIES = new Set(["cadeiras", "mesas", "estacoes", "reuniao", "armazenamento", "recepcao"]);

/** Mesma escolha da home do site (src/routes/index.tsx): mobiliário, foto e pronta entrega primeiro, categorias alternadas. */
export function homeSelection(products) {
  const score = (p) => (p.featured ? 6 : 0) + 2 + (p.image !== PLACEHOLDER ? 2 : 0) + (p.stock === "PRONTA_ENTREGA" ? 1 : 0);
  const ranked = products.filter((p) => FURNITURE_CATEGORIES.includes(p.category))
    .sort((a, b) => (a.homePriority ?? 1000) - (b.homePriority ?? 1000) || score(b) - score(a) || (b.available ?? 0) - (a.available ?? 0));
  const interleave = (list, size) => {
    const groups = new Map();
    for (const p of list) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
    const out = [];
    while (out.length < size && [...groups.values()].some((g) => g.length)) for (const g of groups.values()) { const next = g.shift(); if (next && out.length < size) out.push(next); }
    return out;
  };
  const ready = interleave(ranked.filter((p) => p.stock === "PRONTA_ENTREGA"), 8);
  const shown = new Set(ready.map((p) => p.slug));
  return new Set([...shown, ...interleave(ranked.filter((p) => !shown.has(p.slug)), 8).map((p) => p.slug)]);
}

export function missingImagesReport(products, { origin = "https://magmoveiscorporativos.com.br" } = {}) {
  const onHome = homeSelection(products);
  const rows = products.filter((p) => p.image === PLACEHOLDER).map((p) => {
    const available = p.available ?? 0; const home = onHome.has(p.slug); const strategic = STRATEGIC_CATEGORIES.has(p.category);
    const tier = available > 0 ? 1 : home ? 2 : strategic ? 3 : 4;
    const reasons = [available > 0 && `estoque disponível (${String(available).replace(".", ",")} ${p.unit})`, home && "aparece na home", strategic && "categoria estratégica"].filter(Boolean);
    return { p, available, home, strategic, tier, reason: reasons.join("; ") || "demais produtos" };
  }).sort((a, b) => a.tier - b.tier || Number(b.home) - Number(a.home) || Number(b.strategic) - Number(a.strategic) ||
    b.available - a.available || a.p.name.localeCompare(b.p.name, "pt-BR"));
  const cell = (value) => `"${String(value).replace(/"/g, "\"\"")}"`;
  const lines = [["SKU", "Nome", "Categoria", "Estoque disponível", "URL", "Prioridade", "Motivo da prioridade"].map(cell).join(";")];
  for (const row of rows) {
    lines.push([row.p.sku, row.p.name, CATEGORY_NAMES[row.p.category] ?? row.p.category, String(row.available).replace(".", ","),
      `${origin}/produto/${row.p.slug}`, row.tier, row.reason].map(cell).join(";"));
  }
  // BOM + ";" + CRLF: abre direto no Excel em português.
  return { csv: `﻿${lines.join("\r\n")}\r\n`, total: rows.length, withStock: rows.filter((row) => row.available > 0).length };
}

export function sniffImage(bytes) {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 6 && String.fromCharCode(...b.subarray(0, 6)).match(/^GIF8[79]a$/)) return "gif";
  if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "webp";
  return null;
}

let sharpModule;
/**
 * Fotos do Omie chegam com até 2 MB (PNG 1536 px): gera WebP de 1200 px (página) e 480 px (vitrines).
 * Memória: a 1ª sincronização morreu por OOM (512 MB) com libvips em vários threads e cache ligado;
 * por isso 1 thread por imagem, sem cache, e a versão pequena sai da grande, em sequência.
 */
export async function optimizeImage(bytes) {
  if (sharpModule === undefined) {
    try {
      sharpModule = (await import("sharp")).default;
      sharpModule.concurrency(1);
      sharpModule.cache(false);
    } catch { sharpModule = null; }
  }
  if (!sharpModule) return null; // sem sharp (ex.: desenvolvimento local) a foto original é usada
  const fit = (size) => ({ width: size, height: size, fit: "inside", withoutEnlargement: true });
  const large = await sharpModule(bytes, { limitInputPixels: 50_000_000, failOn: "error" }).rotate().resize(fit(1200)).webp({ quality: 80 }).toBuffer();
  const small = await sharpModule(large).resize(fit(480)).webp({ quality: 76 }).toBuffer();
  return { large, small, extension: "webp" };
}

/** Limita quantas fotos são processadas ao mesmo tempo (os downloads seguem em paralelo). */
function limiter(max) {
  let active = 0; const waiting = [];
  return async (task) => {
    if (active >= max) await new Promise((resolve) => waiting.push(resolve));
    active += 1;
    try { return await task(); } finally { active -= 1; waiting.shift()?.(); }
  };
}

/** HTTPS only, at most 3 redirects, bounded size. Throws a code, never the URL. */
async function downloadImage(source, { fetchImpl, maxBytes }) {
  let url = source;
  for (let hop = 0; hop <= 3; hop += 1) {
    const response = await fetchImpl(url, { redirect: "manual", headers: { Accept: "image/*" }, signal: AbortSignal.timeout(30000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = new URL(response.headers.get("location") || "", url);
      if (next.protocol !== "https:") throw new Error("image_redirect_not_https");
      url = next.href; continue;
    }
    if (response.status !== 200 || !response.body) throw new Error(`image_http_${response.status}`);
    if (Number(response.headers.get("content-length") || 0) > maxBytes) throw new Error("image_too_large");
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel().catch(() => {}); throw new Error("image_too_large"); }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    const extension = sniffImage(bytes);
    if (!extension) throw new Error("image_not_recognized");
    return { bytes, extension };
  }
  throw new Error("image_too_many_redirects");
}

async function writeAtomic(directory, name, bytes) {
  const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o644);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, join(directory, name));
}

/**
 * Replaces each product's private source URLs with local copies served at /catalog-images/.
 * Files are named by the hash of origin+path, so a signed URL whose query changes daily is not
 * downloaded again. `<hash>.webp` is the large photo and `<hash>-p.webp` the small one used in
 * listings. A failed photo is skipped; a product with none keeps the neutral placeholder.
 */
export async function cacheProductImages(products, imageDir, { fetchImpl = fetch, concurrency = 4, processConcurrency = 2, maxBytes = 8 * 1024 * 1024, processImage = optimizeImage } = {}) {
  const processing = limiter(processConcurrency);
  await mkdir(imageDir, { recursive: true, mode: 0o755 });
  const existing = new Map();
  for (const name of await readdir(imageDir)) {
    const match = IMAGE_FILE.exec(name);
    if (!match) continue;
    const entry = existing.get(match[1]) ?? {};
    if (match[2]) entry.small = name; else entry.large = name;
    existing.set(match[1], entry);
  }
  const keyOf = (source) => { const url = new URL(source); return createHash("sha256").update(`${url.origin}${url.pathname}`).digest("hex"); };
  const pending = new Map();
  for (const product of products) for (const source of product.sourceImages) {
    const key = keyOf(source);
    if (!existing.get(key)?.large && !pending.has(key)) pending.set(key, source);
  }
  const stats = { imagesReused: 0, imagesDownloaded: 0, imagesFailed: 0, imageBytesDownloaded: 0, imageBytesStored: 0, largestImageBytes: 0, imagesOptimized: 0, failures: {} };
  const queue = [...pending.entries()];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [key, source] = item;
      try {
        const { bytes, extension } = await downloadImage(source, { fetchImpl, maxBytes });
        let optimized = null;
        try { optimized = await processing(() => processImage(bytes)); } catch { stats.failures.image_optimize_failed = (stats.failures.image_optimize_failed || 0) + 1; }
        if (optimized) {
          await writeAtomic(imageDir, `${key}-p.${optimized.extension}`, optimized.small);
          await writeAtomic(imageDir, `${key}.${optimized.extension}`, optimized.large);
          existing.set(key, { large: `${key}.${optimized.extension}`, small: `${key}-p.${optimized.extension}` });
          stats.imagesOptimized += 1; stats.imageBytesStored += optimized.large.length + optimized.small.length;
        } else {
          await writeAtomic(imageDir, `${key}.${extension}`, bytes);
          existing.set(key, { large: `${key}.${extension}` });
          stats.imageBytesStored += bytes.length;
        }
        stats.imagesDownloaded += 1; stats.imageBytesDownloaded += bytes.length;
        stats.largestImageBytes = Math.max(stats.largestImageBytes, bytes.length);
      } catch (error) {
        stats.imagesFailed += 1;
        const code = error instanceof Error && /^image_/.test(error.message) ? error.message : "image_network_error";
        stats.failures[code] = (stats.failures[code] || 0) + 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  for (const product of products) {
    const large = []; let small = null;
    for (const source of product.sourceImages) {
      const entry = existing.get(keyOf(source));
      if (!entry?.large) continue;
      if (!pending.has(keyOf(source))) stats.imagesReused += 1;
      large.push(`${IMAGE_ROUTE}${entry.large}`);
      small ??= entry.small ? `${IMAGE_ROUTE}${entry.small}` : null;
    }
    product.images = large.length ? [...new Set(large)] : [PLACEHOLDER];
    product.image = small ?? product.images[0];
  }
  return stats;
}

/** Deletes cached photos no longer referenced by the published catalog. Only runs after a good sync. */
export async function pruneImages(products, imageDir) {
  const keep = new Set();
  for (const product of products) for (const path of [product.image, ...product.images]) {
    if (path.startsWith(IMAGE_ROUTE)) keep.add(IMAGE_FILE.exec(path.slice(IMAGE_ROUTE.length))?.[1]);
  }
  let removed = 0;
  for (const name of await readdir(imageDir)) {
    const match = IMAGE_FILE.exec(name);
    if (match && !keep.has(match[1])) { await unlink(join(imageDir, name)).catch(() => {}); removed += 1; }
    else if (/^\..+\.tmp$/.test(name)) await unlink(join(imageDir, name)).catch(() => {});
  }
  return removed;
}

export async function atomicText(path, text) {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporaryPath, "wx", 0o644);
    try { await handle.writeFile(text, "utf8"); await handle.sync(); } finally { await handle.close(); }
    await rename(temporaryPath, path);
  } finally { await unlink(temporaryPath).catch(() => {}); }
}

export const atomicJson = (path, value) => atomicText(path, `${JSON.stringify(value)}\n`);

/** Histórico simples (uma linha JSON por execução, últimas 400) para observabilidade e alerta. */
async function appendHistory(path, entry) {
  let lines = [];
  try { lines = (await readFile(path, "utf8")).split("\n").filter(Boolean); } catch { /* primeiro registro */ }
  lines.push(JSON.stringify(entry));
  await atomicText(path, `${lines.slice(-400).join("\n")}\n`).catch(() => {});
}

async function acquireLock(path) {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx", 0o640);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token, at: Date.now() })); } finally { await handle.close(); }
      return async () => {
        const current = JSON.parse(await readFile(path, "utf8"));
        if (current.token === token) await unlink(path);
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let previous;
      try { previous = JSON.parse(await readFile(path, "utf8")); } catch { throw new SyncError("sync_lock_unreadable"); }
      // Each run is a fresh container (PID 1 again), so a PID check is meaningless: a lock older
      // than one hour (a full sync takes minutes) was left behind by a killed run, e.g. an OOM kill.
      // The host wrapper's flock is what really prevents overlapping cron runs.
      if (!Number.isFinite(previous.at) || Date.now() - previous.at > 60 * 60 * 1000) { await unlink(path); continue; }
      throw new SyncError("sync_already_running");
    }
  }
  throw new SyncError("sync_already_running");
}

/** Arquivo opcional de decisão humana (overrides/editorial): ausente = vazio; ilegível ou inválido = para a sincronização. */
async function readOptional(path, parse, name) {
  let text;
  try { text = await readFile(path, "utf8"); } catch (error) { if (error.code === "ENOENT") return new Map(); throw new SyncError(`${name}_unreadable`); }
  try { return parse(JSON.parse(text)); } catch (error) { throw error instanceof SyncError ? error : new SyncError(`invalid_${name}`); }
}

/**
 * Registro de slugs. Se slugs.json sumir (ex.: restauração parcial), é reconstruído a partir do catalog.json
 * publicado, que já traz id, slug e redirecionamentos: as URLs públicas nunca mudam por acidente.
 */
async function readSlugRegistry(config) {
  try {
    return parseSlugRegistry(JSON.parse(await readFile(config.slugsPath, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error instanceof SyncError ? error : new SyncError("invalid_slug_registry");
  }
  const registry = new Map();
  try {
    const published = JSON.parse(await readFile(config.catalogPath, "utf8"));
    for (const product of published.products ?? []) {
      if (identifier(product.id) && SLUG.test(product.slug ?? "") && !LEGACY_SLUG.test(product.slug)) {
        registry.set(product.id, { slug: product.slug, sku: product.sku, omieName: product.omieName ?? product.name, assignedAt: published.generatedAt, previous: [] });
      }
    }
    const bySlug = new Map([...registry].map(([id, entry]) => [entry.slug, id]));
    for (const [from, to] of Object.entries(published.redirects ?? {})) {
      if (!LEGACY_SLUG.test(from) && bySlug.has(to) && !bySlug.has(from)) registry.get(bySlug.get(to)).previous.push(from);
    }
  } catch { /* sem catálogo anterior: primeira atribuição */ }
  return registry;
}

async function readLegacySlugs(path) {
  try { return new Set(JSON.parse(await readFile(path, "utf8"))); } catch { return new Set(); }
}

export async function syncCatalog(config, { call = createOmieClient(config), now = () => new Date(), fetchImpl = fetch, processImage = optimizeImage } = {}) {
  if (!config.appKey || !config.appSecret) throw new SyncError("missing_omie_credentials");
  if (config.catalogPath === config.statusPath) throw new SyncError("status_path_must_differ");
  const release = await acquireLock(`${config.catalogPath}.lock`);
  const started = Date.now();
  const startedAt = now().toISOString();
  let previousStatus = {};
  try { previousStatus = JSON.parse(await readFile(config.statusPath, "utf8")); } catch { /* first sync */ }
  try {
    const overrides = await readOptional(config.overridesPath, parseOverrides, "overrides");
    const editorial = await readOptional(config.editorialPath, parseEditorial, "editorial");
    const registry = await readSlugRegistry(config);
    const reserved = config.reservedSlugs ?? await readLegacySlugs(config.legacySlugsPath);
    const rawProducts = await readAllPages(call, {
      endpoint: "geral/produtos", method: "ListarProdutos", pageKey: "pagina", pagesKey: "total_de_paginas",
      totalKey: "total_de_registros", rowsKey: "produto_servico_cadastro", maxPages: config.maxPages,
      params: { registros_por_pagina: config.pageSize, apenas_importado_api: "N", filtrar_apenas_omiepdv: "N", exibir_caracteristicas: "S" },
    });
    const rawLocations = await readAllPages(call, {
      endpoint: "estoque/local", method: "ListarLocaisEstoque", pageKey: "nPagina", pagesKey: "nTotPaginas",
      totalKey: "nTotRegistros", rowsKey: "locaisEncontrados", maxPages: 50, params: { nRegPorPagina: 50 },
    });
    const locations = describeLocations(rawLocations, config);
    if (locations.filter((location) => location.isDefault).length !== 1) throw new SyncError("default_stock_location_not_found");
    const date = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", year: "numeric" }).format(now());
    for (const location of locations) {
      // Locais não comerciais não são consultados. O padrão vem completo (define quais produtos têm posição).
      if (!location.commercial && !location.isDefault) { location.rows = []; continue; }
      location.rows = await readAllPages(call, {
        endpoint: "estoque/consulta", method: "ListarPosEstoque", pageKey: "nPagina", pagesKey: "nTotPaginas",
        totalKey: "nTotRegistros", rowsKey: "produtos", maxPages: config.maxPages,
        params: { nRegPorPagina: STOCK_PAGE_SIZE, dDataPosicao: date, cExibeTodos: location.isDefault ? "S" : "N", codigo_local_estoque: Number(location.id) },
      });
    }
    const { products, excluded, unknownStock, notFurniture, hiddenByOverride } = buildCatalog(rawProducts, locations, { ...config, overrides, editorial });
    if (!products.length) throw new SyncError("empty_catalog_rejected");
    // A sudden collapse (e.g. a filter/API change) must not wipe a good public catalog.
    const previousCount = Number(previousStatus.productsPublished || 0);
    if (previousCount >= 50 && products.length < previousCount * 0.5 && process.env.OMIE_ALLOW_SHRINK !== "true") {
      throw new SyncError("catalog_shrank_over_50_percent");
    }
    const slugs = assignSlugs(products, registry, { reserved, now: now() });
    const images = config.imageDir
      ? await cacheProductImages(products, config.imageDir, { fetchImpl, concurrency: config.imageConcurrency, maxBytes: config.maxImageBytes, processImage })
      : null;
    for (const product of products) delete product.sourceImages;
    const generatedAt = now().toISOString();
    // Registro antes do catálogo: uma URL publicada sempre tem o slug persistido.
    await atomicJson(config.slugsPath, { schemaVersion: 1, updatedAt: generatedAt, products: Object.fromEntries(registry) });
    await atomicJson(config.catalogPath, { schemaVersion: 1, generatedAt, products, redirects: slugs.redirects });
    const report = missingImagesReport(products);
    await atomicText(config.reportPath, report.csv);
    const imagesPruned = config.imageDir ? await pruneImages(products, config.imageDir) : 0;
    const byCategory = {};
    for (const product of products) byCategory[product.category] = (byCategory[product.category] || 0) + 1;
    const stockRecords = locations.reduce((sum, location) => sum + location.rows.length, 0);
    const status = {
      // Observabilidade (nomes estáveis, usados pelo alerta e pela operação)
      status: "ok", error: null,
      last_sync_started_at: startedAt, last_sync_completed_at: generatedAt, last_successful_sync: generatedAt,
      products_processed: rawProducts.length, products_published: products.length, stock_records_processed: stockRecords,
      images_processed: images ? images.imagesDownloaded + images.imagesReused : 0,
      duration_seconds: Math.round((Date.now() - started) / 1000), peak_memory_mb: Math.round(process.resourceUsage().maxRSS / 1024),
      slugs_created: slugs.created, slugs_changed: slugs.changed, redirects: Object.keys(slugs.redirects).length,
      editorial_entries: editorial.size, products_without_images: report.total, products_without_images_with_stock: report.withStock,
      // Campos anteriores (compatibilidade)
      state: "ok", startedAt, lastAttemptAt: generatedAt, lastSuccessAt: generatedAt,
      durationSeconds: Math.round((Date.now() - started) / 1000),
      peakMemoryMB: Math.round(process.resourceUsage().maxRSS / 1024),
      source: "omie", stockDate: date,
      productsReceived: rawProducts.length, productsPublished: products.length, excluded, notFurniture, hiddenByOverride,
      overrides: overrides.size, unknownStock, byCategory,
      withStock: products.filter((product) => (product.available ?? 0) > 0).length,
      readyToShip: products.filter((product) => product.stock === "PRONTA_ENTREGA").length,
      withPhotos: products.filter((product) => product.image !== PLACEHOLDER).length,
      locations: locations.map(({ id, name, isDefault, commercial, rows }) => ({ id, name, isDefault, commercial, rows: rows.length })),
      ...(images ? { ...images, imagesPruned } : {}),
    };
    await atomicJson(config.statusPath, status);
    await appendHistory(config.historyPath, {
      at: generatedAt, status: "ok", started_at: startedAt, duration_seconds: status.duration_seconds, peak_memory_mb: status.peak_memory_mb,
      products_processed: status.products_processed, products_published: status.products_published,
      stock_records_processed: stockRecords, images_processed: status.images_processed,
    });
    return status;
  } catch (error) {
    const code = error instanceof SyncError ? error.code : "sync_io_error";
    const failedAt = now().toISOString();
    const seconds = Math.round((Date.now() - started) / 1000);
    const lastSuccess = previousStatus.last_successful_sync ?? previousStatus.lastSuccessAt ?? null;
    await atomicJson(config.statusPath, {
      ...previousStatus, status: "error", error: code, last_sync_started_at: startedAt, last_sync_completed_at: failedAt,
      last_successful_sync: lastSuccess, duration_seconds: seconds,
      state: "error", startedAt, lastAttemptAt: failedAt, durationSeconds: seconds, lastSuccessAt: lastSuccess, errorCode: code,
    }).catch(() => {});
    await appendHistory(config.historyPath, { at: failedAt, status: "error", error: code, started_at: startedAt, duration_seconds: seconds });
    throw new SyncError(code);
  } finally { await release(); }
}

async function isFresh(config, hours) {
  try {
    const status = JSON.parse(await readFile(config.statusPath, "utf8"));
    const last = Date.parse(status.lastSuccessAt);
    return Number.isFinite(last) && Date.now() - last < hours * 3600 * 1000;
  } catch { return false; }
}

async function main() {
  const config = configFromEnv(); const watch = process.argv.includes("--watch");
  const staleArgument = process.argv.find((argument) => argument.startsWith("--if-stale-hours="));
  const staleHours = staleArgument ? Number(staleArgument.split("=")[1]) : null;
  if (staleHours !== null && (!Number.isFinite(staleHours) || staleHours <= 0)) throw new SyncError("invalid_if_stale_hours");
  if (staleHours !== null && await isFresh(config, staleHours)) {
    const at = new Date().toISOString();
    console.log(JSON.stringify({ event: "catalog_sync_skipped", reason: "fresh", at }));
    await appendHistory(config.historyPath, { at, status: "skipped", reason: "fresh" });
    return;
  }
  do {
    try {
      const status = await syncCatalog(config);
      console.log(JSON.stringify({
        event: "catalog_synced", at: status.lastSuccessAt, seconds: status.durationSeconds, peakMemoryMB: status.peakMemoryMB,
        products: status.productsPublished, received: status.productsReceived, excluded: status.excluded,
        notFurniture: status.notFurniture, hiddenByOverride: status.hiddenByOverride,
        withStock: status.withStock, readyToShip: status.readyToShip, withPhotos: status.withPhotos,
        imagesDownloaded: status.imagesDownloaded, imagesOptimized: status.imagesOptimized, imagesFailed: status.imagesFailed,
        byCategory: status.byCategory, slugsCreated: status.slugs_created, redirects: status.redirects,
        withoutImages: status.products_without_images,
      }));
    } catch (error) {
      console.error(JSON.stringify({ event: "catalog_sync_failed", at: new Date().toISOString(), code: error instanceof SyncError ? error.code : "configuration_error" }));
      if (!watch) process.exitCode = 1;
    }
    if (watch) await sleep(config.intervalSeconds * 1000);
  } while (watch);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error(JSON.stringify({ event: "catalog_sync_failed", code: "configuration_error" })); process.exitCode = 1; });
}
