// node --test tests/sync-omie.test.mjs  — sem rede: Omie, locais de estoque e fotos simulados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCatalog, categoryOf, describeLocations, locationName, meaningful, parseOverrides, parseEditorial, parseSlugRegistry,
  assignSlugs, slugify, missingImagesReport, syncCatalog, createOmieClient, configFromEnv, sniffImage,
} from "../scripts/sync-omie.mjs";

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
const DEFAULT = "8759352014", LOJA = "8768398727", AVARIA = "8771815309", LICITACAO = "8798194916", IMPORTACAO = "8868511601", OUTLET = "8924618110";
const RAW_LOCATIONS = [
  { codigo: "GALPÃO BR", codigo_local_estoque: Number(DEFAULT), descricao: "ESTOQUE BR 116", inativo: "N", padrao: "S", dispVenda: "S" },
  { codigo: "LOJA CENTRO", codigo_local_estoque: Number(LOJA), descricao: "LOJA DOM MANUEL 1180", inativo: "N", padrao: "N", dispVenda: "S" },
  { codigo: "AVARIA", codigo_local_estoque: Number(AVARIA), descricao: "AVARIA", inativo: "N", padrao: "N", dispVenda: "S" },
  { codigo: "LICITAÇÃO", codigo_local_estoque: Number(LICITACAO), descricao: "LICITAÇÃO", inativo: "N", padrao: "N", dispVenda: "S" },
  { codigo: "IMPORTAÇÃO", codigo_local_estoque: Number(IMPORTACAO), descricao: "RECEBIMENTO DE IMPORTAÇÃO", inativo: "N", padrao: "N", dispVenda: "S" },
  { codigo: "OUTLET", codigo_local_estoque: Number(OUTLET), descricao: "OUTLET", inativo: "N", padrao: "N", dispVenda: "N" },
  { codigo: "ANTIGO", codigo_local_estoque: 999, descricao: "DEPÓSITO ANTIGO", inativo: "S", padrao: "N", dispVenda: "S" },
];

const product = (id, extra = {}) => ({
  codigo_produto: id, codigo: `SKU-${id}`, descricao: `CADEIRA PRESIDENTE ${id}`, tipoItem: "00", unidade: "UN",
  inativo: "N", bloqueado: "N", marca: "MAG", imagens: [], caracteristicas: [], descr_detalhada: "", ...extra,
});
const pos = (id, local, saldo, extra = {}) => ({ nCodProd: id, codigo_local_estoque: Number(local), nSaldo: saldo, fisico: saldo, nPendente: 0, reservado: 0, nCMC: 123.45, nPrecoUnitario: 999.9, ...extra });

/** Simula a API: produtos paginados, locais e posição por local ("S" = todos, "N" = só saldo ≠ 0). */
function fakeOmie(products, stockByLocation, pageSize = 2) {
  const calls = [];
  const page = (rows, n) => rows.slice((n - 1) * pageSize, n * pageSize);
  const call = async (endpoint, method, params) => {
    calls.push({ method, params });
    if (method === "ListarProdutos") {
      return { pagina: params.pagina, total_de_paginas: Math.max(1, Math.ceil(products.length / pageSize)), total_de_registros: products.length, produto_servico_cadastro: page(products, params.pagina) };
    }
    if (method === "ListarLocaisEstoque") return { nPagina: 1, nTotPaginas: 1, nRegistros: RAW_LOCATIONS.length, nTotRegistros: RAW_LOCATIONS.length, locaisEncontrados: RAW_LOCATIONS };
    let rows = stockByLocation[String(params.codigo_local_estoque)] ?? [];
    if (params.cExibeTodos === "N") rows = rows.filter((row) => Number(row.nSaldo) !== 0);
    if (!rows.length) throw Object.assign(new Error("Não existem registros para a página [1]!"), { code: "omie_no_records" });
    return { nPagina: params.nPagina, nTotPaginas: Math.ceil(rows.length / pageSize), nRegistros: page(rows, params.nPagina).length, nTotRegistros: rows.length, produtos: page(rows, params.nPagina) };
  };
  return { call, calls };
}

function fakeImages(map) {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    const entry = map[url];
    if (!entry) return new Response("no", { status: 404 });
    if (entry.redirect) return new Response(null, { status: 302, headers: { location: entry.redirect } });
    return new Response(entry, { status: 200 });
  };
  return { fetchImpl, requested };
}
const fakeOptimize = async (bytes) => ({ large: Buffer.concat([Buffer.from("L"), bytes]), small: Buffer.from("S"), extension: "webp" });

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "mag-sync-"));
  const config = {
    ...configFromEnv({ OMIE_APP_KEY: "k", OMIE_APP_SECRET: "s", OMIE_CATALOG_PATH: join(dir, "catalog.json"), OMIE_IMAGE_DIR: join(dir, "images") }),
    reservedSlugs: new Set(["cadeira-eiffel"]),
  };
  return { dir, config };
}

test("nomes dos locais ficam legíveis e siglas continuam maiúsculas", () => {
  assert.equal(locationName("ESTOQUE BR 116"), "Estoque BR 116");
  assert.equal(locationName("RECEBIMENTO DE IMPORTAÇÃO"), "Recebimento de Importação");
  assert.equal(locationName("LOJA EXPERT - UNI"), "Loja Expert - Uni");
});

test("locais comerciais: disponível para venda no Omie e fora de Avaria, Licitação e Importação", () => {
  const locations = describeLocations(RAW_LOCATIONS, configFromEnv({}));
  assert.deepEqual(locations.map((l) => [l.name, l.commercial]), [
    ["Estoque BR 116", true], ["Loja Dom Manuel 1180", true], ["Avaria", false], ["Licitação", false],
    ["Recebimento de Importação", false], ["Outlet", false],
  ]);
});

test("classificação pelo nome real do cadastro", () => {
  const cases = {
    "CADEIRA MAIA CINZA COM PLATAFORMA SECRETARIA": "cadeiras", "CAD AUD OBESO ECO C/ PRANC COURISSIMO PRETO": "cadeiras",
    "ARM ALTO EXECUTIVO FD3 80X46 PRIMA 40 - OVO PR": "armazenamento", "GAV FIXO DESM 2GAV 12MM 30L UNO - CR CR": "armazenamento",
    "MINI ROUP ACO TT 26 3P EURO - CRL AZL CR": "armazenamento", "REUNIAO RETAN PPM 250X100 PRIMA 40 - NGM PR": "reuniao",
    "MESA DE REUNIÃO1,60x0,90x,074 TAMPO MDF 30MM": "mesas", "MESA REUNIAO REDONDA 1,20": "reuniao",
    "MESA PLATAFORMA DUPLA CENTRAL 120X131,5 nogal / preto": "estacoes", "CONJ. REFEITORIO 06 LUGARES": "mesas",
    "CONJUNTO ESCOLAR FNDE MESA E CADEIRA": "escolar", "CADEIRA UNIVERSITARIA C/ PRANCHETA": "escolar",
    "Long. Flash Lug. 3 Pé ConnectPlást": "recepcao", "OPUS TRAPEZOIDAL CROMADA LINHO": "recepcao", "NEW SOFT ERGO": "cadeiras",
    "A/E PRISMA MR 800 AZUL": "pecas", "BRAÇO COM REGULAGEM CINZA": "pecas", "COMP. ANAT. ASS. DIR 1975 14MM - RETO": "pecas",
    "ASSENTO CJA05 VERDE FNDE": "pecas", "Flash - Cj. Apoio de Cabeça V1, 13 Preto": "pecas", "MÓVEL EM MDF": "outros",
    "CAMISA GOLA POLO MANGA CURTA": null, "BOTINA COURO PRETA": null, "***COMP I5 2G, 8, 240, LNX*": null, "***SSD 480GB NVME GET": null,
    "PA AAP PH 4,8 X 16 ZB": null, "DISJUNTOR MONO 1P C 3KA 16A": null, "ARROZ BENEF LF TP1": null, "Pneu de Utilitário SNW": null,
    "ABRACADEIRA 3/4\" CZ (31) IPL": null, "Cópia de CADEIRA CAIXA SEC. LAMINADA FIXA em 15/04/2026": null, "DIVISÓRIAS EM GRANITO PRETO": null,
  };
  for (const [name, expected] of Object.entries(cases)) assert.equal(categoryOf({ descricao: name }), expected, name);
});

test("valores sem sentido do cadastro não vão ao site", () => {
  for (const junk of ["sdf", "SDF", "0", ".", "ND", "sn", "SRF", " - ", "asdf", "xxx", "teste"]) assert.equal(meaningful(junk), "", junk);
  assert.equal(meaningful("Preto"), "Preto");
  assert.equal(meaningful("Nogal / Preto"), "Nogal / Preto");
});

test("disponível = locais comerciais − pendências e reservas desses locais; nada interno é publicado", () => {
  const locations = describeLocations(RAW_LOCATIONS, configFromEnv({}));
  const byId = Object.fromEntries(locations.map((l) => [l.id, l]));
  byId[DEFAULT].rows = [pos("1", DEFAULT, 4, { nPendente: 3 }), pos("2", DEFAULT, 2, { nPendente: 9 }), pos("3", DEFAULT, 0), pos("5", DEFAULT, 0), pos("6", DEFAULT, 1, { reservado: 1 }), pos("9", DEFAULT, 0)];
  byId[LOJA].rows = [pos("1", LOJA, 2), pos("5", LOJA, 6)];
  byId[AVARIA].rows = [pos("1", AVARIA, 1), pos("3", AVARIA, 1)];
  byId[LICITACAO].rows = [pos("5", LICITACAO, 490, { nPendente: 400 })];
  const overrides = parseOverrides({ 7: { publish: false }, 8: { category: "outros" } });
  const { products, excluded, unknownStock, notFurniture, hiddenByOverride } = buildCatalog([
    product("1", { caracteristicas: [{ cNomeCaract: "cor", cConteudo: "sdf" }] }), product("2"), product("3"), product("4"), product("5", { descr_detalhada: "Encosto em tela e apoio lombar." }),
    product("6"), product("7"), product("8", { descricao: "OFFICE LINE 50" }), product("9", { descricao: "CAMISETA UV PRETA" }),
    product("10", { inativo: "S" }), product("11", { tipoItem: "01" }),
  ], locations, { overrides });
  const by = Object.fromEntries(products.map((p) => [p.slug.slice(8), p]));
  assert.equal(excluded, 2); assert.equal(notFurniture, 1); assert.equal(hiddenByOverride, 1);
  assert.equal(by["1"].available, 3); // 4 + 2 comerciais − 3 pendentes; a unidade em Avaria não conta
  assert.equal(by["1"].stock, "PRONTA_ENTREGA");
  assert.equal(by["1"].color, "");
  assert.equal(by["1"].description, ""); // vazio no Omie: não repete o nome
  assert.equal(by["2"].available, 0); assert.equal(by["2"].stock, "SOB_CONSULTA"); // saldo 2, 9 em pedidos
  assert.equal(by["3"].available, 0); // só tem avaria
  assert.equal(by["4"].available, null); assert.equal(unknownStock, 2); // 4 e 8 sem posição no local padrão
  assert.equal(by["5"].available, 6); // licitação (490 com 400 pendentes) fica totalmente de fora
  assert.equal(by["5"].description, "Encosto em tela e apoio lombar.");
  assert.equal(by["6"].available, 0); // reservado
  assert.equal(by["8"].category, "outros"); // exceção liberou um item que a regra esconderia
  assert.ok(!by["7"] && !by["9"]);
  const serialized = JSON.stringify(products.map(({ sourceImages, ...p }) => p));
  assert.doesNotMatch(serialized, /nCMC|123\.45|999\.9|nPendente|reservado|nPrecoUnitario|Avaria|Licita|Estoque BR|Loja Dom/);
});

test("sync completo: não consulta locais não comerciais, aceita local vazio e otimiza fotos", async () => {
  const { dir, config } = await setup();
  const signed = "https://cdn.omie.com.br/repository/a.png?AWSAccessKeyId=X&Expires=1&Signature=segredo";
  const omie = fakeOmie(
    [
      product("10", { imagens: [{ url_imagem: signed }, { url_imagem: "https://cdn.omie.com.br/repository/b.jpg?Expires=2" }] }),
      product("11", { imagens: [{ url_imagem: "https://cdn.omie.com.br/missing.jpg" }, { url_imagem: "http://cdn.omie.com.br/insecure.jpg" }] }),
      product("12", { imagens: [{ url_imagem: "https://cdn.omie.com.br/redir" }, { url_imagem: "https://cdn.omie.com.br/to-http" }, { url_imagem: "https://cdn.omie.com.br/text" }] }),
      product("13", { descricao: "PARAFUSO CHIP CHATA 4,0X40" }),
    ],
    { [DEFAULT]: [pos("10", DEFAULT, 2), pos("11", DEFAULT, 0), pos("12", DEFAULT, 1), pos("13", DEFAULT, 50)], [LOJA]: [pos("10", LOJA, 3), pos("11", LOJA, 0)] },
  );
  const images = fakeImages({
    [signed]: PNG, "https://cdn.omie.com.br/repository/b.jpg?Expires=2": JPG,
    "https://cdn.omie.com.br/redir": { redirect: "https://cdn.omie.com.br/final.jpg" }, "https://cdn.omie.com.br/final.jpg": JPG,
    "https://cdn.omie.com.br/to-http": { redirect: "http://cdn.omie.com.br/x.jpg" },
    "https://cdn.omie.com.br/text": Buffer.from("<html>not an image</html>"),
  });
  const status = await syncCatalog(config, { call: omie.call, fetchImpl: images.fetchImpl, processImage: fakeOptimize });
  assert.equal(status.state, "ok");
  assert.equal(status.productsPublished, 3);
  assert.equal(status.notFurniture, 1);
  assert.deepEqual(status.byCategory, { cadeiras: 3 });
  assert.ok(Number.isInteger(status.durationSeconds) && status.peakMemoryMB > 0);
  const consultados = omie.calls.filter((c) => c.method === "ListarPosEstoque").map((c) => String(c.params.codigo_local_estoque));
  assert.deepEqual([...new Set(consultados)], [DEFAULT, LOJA]); // Avaria, Licitação, Importação e Outlet (N) nem são consultados
  assert.equal(status.imagesOptimized, 3);
  assert.equal(status.imagesFailed, 3);
  const raw = await readFile(config.catalogPath, "utf8");
  assert.doesNotMatch(raw, /cdn\.omie|segredo|AWSAccessKeyId|sourceImages|nCMC|PARAFUSO/);
  const by = Object.fromEntries(JSON.parse(raw).products.map((p) => [p.id, p]));
  assert.match(by["10"].image, /^\/catalog-images\/[a-f0-9]{64}-p\.webp$/);
  assert.match(by["10"].images[0], /^\/catalog-images\/[a-f0-9]{64}\.webp$/);
  assert.equal(by["10"].available, 5);
  assert.equal(by["10"].slug, "cadeira-presidente-10-sku-10");
  assert.equal(by["11"].image, "/images/product-placeholder.svg");
  await rm(dir, { recursive: true, force: true });
});

test("exceções inválidas param a sincronização sem tocar no catálogo publicado", async () => {
  const { dir, config } = await setup();
  const omie = () => fakeOmie([product("1")], { [DEFAULT]: [pos("1", DEFAULT, 1)] }).call;
  await syncCatalog(config, { call: omie(), fetchImpl: fakeImages({}).fetchImpl, processImage: fakeOptimize });
  const before = await readFile(config.catalogPath, "utf8");
  await writeFile(config.overridesPath, JSON.stringify({ 1: { category: "eletronicos" } }));
  await assert.rejects(syncCatalog(config, { call: omie(), fetchImpl: fakeImages({}).fetchImpl }), (e) => e.code === "invalid_overrides_category");
  assert.equal(await readFile(config.catalogPath, "utf8"), before);
  await rm(dir, { recursive: true, force: true });
});

test("sem sharp a foto original é usada (desenvolvimento local)", async () => {
  const { dir, config } = await setup();
  const omie = fakeOmie([product("1", { imagens: [{ url_imagem: "https://cdn.omie.com.br/x.jpg" }] })], { [DEFAULT]: [pos("1", DEFAULT, 1)] });
  await syncCatalog(config, { call: omie.call, fetchImpl: fakeImages({ "https://cdn.omie.com.br/x.jpg": JPG }).fetchImpl, processImage: async () => null });
  const [p] = JSON.parse(await readFile(config.catalogPath, "utf8")).products;
  assert.match(p.image, /^\/catalog-images\/[a-f0-9]{64}\.jpg$/);
  assert.equal(p.image, p.images[0]);
  await rm(dir, { recursive: true, force: true });
});

test("queda brusca do catálogo é recusada e o catálogo anterior fica", async () => {
  const { dir, config } = await setup();
  const many = Array.from({ length: 60 }, (_, i) => product(String(i + 1)));
  const stock = { [DEFAULT]: many.map((p) => pos(p.codigo_produto, DEFAULT, 0)) };
  await syncCatalog(config, { call: fakeOmie(many, stock, 100).call, fetchImpl: fakeImages({}).fetchImpl, processImage: fakeOptimize });
  const before = await readFile(config.catalogPath, "utf8");
  await assert.rejects(
    syncCatalog(config, { call: fakeOmie(many.slice(0, 10), stock, 100).call, fetchImpl: fakeImages({}).fetchImpl, processImage: fakeOptimize }),
    (error) => error.code === "catalog_shrank_over_50_percent",
  );
  assert.equal(await readFile(config.catalogPath, "utf8"), before);
  const status = JSON.parse(await readFile(config.statusPath, "utf8"));
  assert.equal(status.state, "error");
  assert.equal(status.errorCode, "catalog_shrank_over_50_percent");
  assert.ok(status.lastSuccessAt);
  await rm(dir, { recursive: true, force: true });
});

test("trava: execução recente bloqueia; trava abandonada há mais de 1 h é liberada", async () => {
  const { dir, config } = await setup();
  const lock = `${config.catalogPath}.lock`;
  const omie = () => fakeOmie([product("1")], { [DEFAULT]: [pos("1", DEFAULT, 1)] }).call;
  await writeFile(lock, JSON.stringify({ pid: 1, token: "x", at: Date.now() }));
  await assert.rejects(syncCatalog(config, { call: omie() }), (e) => e.code === "sync_already_running");
  await writeFile(lock, JSON.stringify({ pid: 1, token: "x", at: Date.now() - 2 * 3600 * 1000 }));
  const status = await syncCatalog(config, { call: omie(), fetchImpl: fakeImages({}).fetchImpl, processImage: fakeOptimize });
  assert.equal(status.state, "ok");
  await rm(dir, { recursive: true, force: true });
});

test("cliente Omie: chave recusada não repete; lista vazia vira código próprio; limite de consumo espera e repete", async () => {
  const config = configFromEnv({ OMIE_APP_KEY: "k", OMIE_APP_SECRET: "s", OMIE_REQUEST_INTERVAL_MS: "1000" });
  const sleeps = [];
  let calls = 0;
  const fault = (faultstring) => async () => { calls += 1; return Response.json({ faultstring, faultcode: "SOAP-ENV:Client-5" }, { status: 500 }); };
  const rejected = createOmieClient(config, { sleepImpl: async (ms) => { sleeps.push(ms); }, fetchImpl: fault("ERROR: Chave de acesso inválida") });
  await assert.rejects(rejected("geral/produtos", "ListarProdutos", {}), (e) => e.code === "omie_credentials_rejected");
  assert.equal(calls, 1);
  const empty = createOmieClient(config, { sleepImpl: async () => {}, fetchImpl: fault("ERROR: Não existem registros para a página [1]!") });
  await assert.rejects(empty("estoque/consulta", "ListarPosEstoque", {}), (e) => e.code === "omie_no_records");
  assert.equal(calls, 2);
  let attempt = 0;
  const throttled = createOmieClient(config, {
    sleepImpl: async (ms) => { sleeps.push(ms); },
    fetchImpl: async () => {
      attempt += 1;
      return attempt === 1
        ? Response.json({ faultstring: "Consumo redundante detectado. Aguarde 60 segundos." }, { status: 500 })
        : Response.json({ ok: true });
    },
  });
  assert.deepEqual(await throttled("geral/produtos", "ListarProdutos", {}), { ok: true });
  assert.ok(sleeps.some((ms) => ms >= 65000));
});

test("reconhece imagens pelo conteúdo, não pela extensão", () => {
  assert.equal(sniffImage(JPG), "jpg");
  assert.equal(sniffImage(PNG), "png");
  assert.equal(sniffImage(Buffer.from("GIF89a....")), "gif");
  assert.equal(sniffImage(Buffer.from("RIFF0000WEBPVP8 ")), "webp");
  assert.equal(sniffImage(Buffer.from("<svg onload=alert(1)>")), null);
});

// ---------- URLs amigáveis, camada editorial, relatório e observabilidade ----------
const summary = (id, extra = {}) => ({ id, sku: `SKU-${id}`, omieName: `CADEIRA ${id}`, name: `CADEIRA ${id}`, editorialSlug: null, ...extra });

test("slugify: acentos, símbolos e corte em fim de palavra", () => {
  assert.equal(slugify("ARMÁRIO ALTO FEC 2 P 30MM ALMERIA"), "armario-alto-fec-2-p-30mm-almeria");
  assert.equal(slugify("MESA PLATAFORMA T DUPLA 120X131.5 Nogal / preto"), "mesa-plataforma-t-dupla-120x131-5-nogal-preto");
  assert.equal(slugify("CADEIRA {ØSLO} Nº 1 & 2 \"PRO\""), "cadeira-slo-n-1-2-pro");
  const long = slugify("Plataforma de trabalho estilo industrial p/ 8 lugares c/ painel divisor frontal e lateral, recorte p/ caixa");
  assert.ok(long.length <= 70 && !long.endsWith("-") && long.startsWith("plataforma-de-trabalho"), long);
});

test("slug persistente: nome-sku, não muda com o nome, ID só na colisão, URLs antigas reservadas", () => {
  const registry = new Map();
  const first = [summary("2", { sku: "00003", omieName: "ARMARIO ALTO FEC 2 P 30MM ALMERIA" }), summary("1", { sku: "A.1" }), summary("3", { sku: "A-1" }), summary("4", { sku: "", omieName: "CADEIRA EIFFEL" })];
  const { redirects, created } = assignSlugs(first, registry, { reserved: new Set(["cadeira-eiffel-4"]) });
  const slug = (id) => first.find((p) => p.id === id).slug;
  assert.equal(created, 4);
  assert.equal(slug("2"), "armario-alto-fec-2-p-30mm-almeria-00003");
  assert.equal(slug("1"), "cadeira-1-a-1");            // id menor fica com o slug-base
  assert.equal(slug("3"), "cadeira-3-a-1");            // nomes diferentes: sem colisão
  assert.equal(slug("4"), "cadeira-eiffel-4-4");       // sem SKU usa o ID; colidiu com URL antiga reservada → ID de novo no fim
  assert.equal(redirects["produto-2"], "armario-alto-fec-2-p-30mm-almeria-00003");
  // Nome mudou no Omie (ou ganhou nome comercial): a URL continua a mesma.
  const again = [summary("2", { sku: "00003", omieName: "ARMÁRIO ALTO ALMERIA 2 PORTAS", name: "Armário Alto Almeria" })];
  assignSlugs(again, registry);
  assert.equal(again[0].slug, "armario-alto-fec-2-p-30mm-almeria-00003");
  // Colisão real (mesmo nome e mesmo SKU) → ID como último recurso.
  const twins = [summary("10", { sku: "X" }), summary("11", { sku: "X", omieName: "CADEIRA 10" })];
  assignSlugs(twins, registry);
  assert.deepEqual(twins.map((p) => p.slug), ["cadeira-10-x", "cadeira-10-x-11"]);
});

test("slug editorial: troca com 301 a partir do anterior; conflito para a sincronização", () => {
  const registry = parseSlugRegistry({ schemaVersion: 1, products: { 2: { slug: "armario-alto-fec-2-p-30mm-almeria-00003", previous: [] }, 5: { slug: "mesa-5", previous: [] } } });
  const products = [summary("2", { editorialSlug: "armario-alto-almeria-2-portas-00003" }), summary("5")];
  const { redirects, changed } = assignSlugs(products, registry);
  assert.equal(changed, 1);
  assert.equal(products[0].slug, "armario-alto-almeria-2-portas-00003");
  assert.equal(redirects["armario-alto-fec-2-p-30mm-almeria-00003"], "armario-alto-almeria-2-portas-00003");
  assert.equal(redirects["produto-2"], "armario-alto-almeria-2-portas-00003");
  assert.throws(() => assignSlugs([summary("5", { editorialSlug: "armario-alto-fec-2-p-30mm-almeria-00003" })], registry), (e) => e.code === "editorial_slug_conflict");
  assert.throws(() => parseSlugRegistry({ schemaVersion: 1, products: { 1: { slug: "a", previous: [] }, 2: { slug: "a", previous: [] } } }), (e) => e.code === "duplicate_slug_in_registry");
});

test("editorial.json: valida campos e ignora comentários", () => {
  const editorial = parseEditorial({ _leia: "comentário", 1: { commercial_name: "Cadeira Presidente", featured: true, _nota: "x", technical_specs: [{ label: "Altura", value: "1,20 m" }] } });
  assert.deepEqual(Object.keys(editorial.get("1")).sort(), ["commercial_name", "featured", "technical_specs"]);
  assert.throws(() => parseEditorial({ 1: { comercial_name: "erro de digitação" } }), (e) => e.code.startsWith("invalid_editorial_field"));
  assert.throws(() => parseEditorial({ 1: { home_priority: "1" } }), (e) => e.code === "invalid_editorial_home_priority");
  assert.throws(() => parseEditorial({ 1: { slug: "produto-123" } }), (e) => e.code === "invalid_editorial_slug");
  assert.throws(() => parseEditorial({ 1: { environment_override: ["cozinha"] } }), (e) => e.code === "invalid_editorial_environment_override");
});

test("camada editorial: editorial > overrides > automático; sem repetir o nome", () => {
  const locations = describeLocations(RAW_LOCATIONS, configFromEnv({}));
  locations[0].rows = [pos("1", DEFAULT, 2), pos("2", DEFAULT, 1), pos("3", DEFAULT, 1), pos("4", DEFAULT, 1)];
  const overrides = parseOverrides({ 2: { category: "mesas" }, 4: { publish: false } });
  const editorial = parseEditorial({
    1: { commercial_name: "Cadeira Presidente Couro", short_description: "Cadeira Presidente Couro", long_description: "Espaldar alto, couro natural.", seo_title: "Cadeira presidente em couro",
      marketing_highlights: ["Couro natural", "<b>Base cromada</b>"], technical_specs: [{ label: "Altura", value: "1,20 m" }], environment_override: ["diretoria"], home_priority: 2, featured: true },
    2: { category_override: "estacoes" },
    3: { published: false },
    4: { published: true, category_override: "outros" },
    5: { published: true },
  });
  const { products, hiddenByOverride, notFurniture } = buildCatalog(
    [product("1"), product("2"), product("3"), product("4"), product("5", { descricao: "CAMISETA UV" })], locations, { overrides, editorial });
  const by = Object.fromEntries(products.map((p) => [p.id, p]));
  assert.equal(by["1"].name, "Cadeira Presidente Couro");
  assert.equal(by["1"].omieName, "CADEIRA PRESIDENTE 1");
  assert.equal(by["1"].shortDescription, ""); // só repetia o nome
  assert.equal(by["1"].description, "Espaldar alto, couro natural.");
  assert.deepEqual(by["1"].highlights, ["Couro natural", "Base cromada"]);
  assert.deepEqual(by["1"].specs, [{ label: "Altura", value: "1,20 m" }]);
  assert.deepEqual(by["1"].environments, ["diretoria"]);
  assert.equal(by["1"].homePriority, 2); assert.equal(by["1"].featured, true);
  assert.equal(by["2"].category, "estacoes"); // editorial vence overrides.json
  assert.ok(!by["3"]);                        // editorial despublica
  assert.equal(by["4"].category, "outros");    // editorial republica o que o overrides escondia
  assert.equal(by["5"].category, "outros");    // item fora de mobiliário liberado de propósito
  assert.equal(hiddenByOverride, 1); assert.equal(notFurniture, 0);
});

test("relatório sem foto: estoque primeiro, depois home e categoria estratégica; CSV para Excel", () => {
  const ph = "/images/product-placeholder.svg";
  const base = { stock: "SOB_CONSULTA", available: 0, image: ph, unit: "UN", featured: false, homePriority: null };
  const products = [
    { ...base, id: "1", slug: "peca-1", sku: "P1", name: "BRAÇO A", category: "pecas", available: 50, stock: "PRONTA_ENTREGA" },
    { ...base, id: "2", slug: "cadeira-2", sku: "C2", name: "CADEIRA \"B\"", category: "cadeiras", available: 3, stock: "PRONTA_ENTREGA" },
    { ...base, id: "3", slug: "mesa-3", sku: "M3", name: "MESA C", category: "mesas" },
    { ...base, id: "4", slug: "escolar-4", sku: "E4", name: "CARTEIRA D", category: "escolar" },
    { ...base, id: "5", slug: "com-foto", sku: "F5", name: "COM FOTO", category: "cadeiras", image: "/catalog-images/x.webp" },
  ];
  const { csv, total, withStock } = missingImagesReport(products);
  assert.equal(total, 4); assert.equal(withStock, 2);
  assert.ok(csv.startsWith("﻿\"SKU\";\"Nome\""));
  const skus = csv.trim().split("\r\n").slice(1).map((line) => line.split(";")[0].replaceAll("\"", ""));
  assert.deepEqual(skus, ["C2", "P1", "M3", "E4"]); // com estoque (cadeira na home antes da peça), depois estratégica, depois o resto
  assert.ok(csv.includes("\"CADEIRA \"\"B\"\"\"") && csv.includes("https://magmoveiscorporativos.com.br/produto/cadeira-2"));
});

test("sync grava slugs, redirecionamentos, relatório, status e histórico; URL sobrevive à troca de nome e à perda do registro", async () => {
  const { dir, config } = await setup();
  const items = () => [product("20", { codigo: "00003", descricao: "ARMARIO ALTO FEC 2 P 30MM ALMERIA" }), product("21", { descricao: "CADEIRA EIFFEL", codigo: "" === "" ? "" : "" })];
  const stock = { [DEFAULT]: [pos("20", DEFAULT, 4), pos("21", DEFAULT, 0)] };
  const status = await syncCatalog(config, { call: fakeOmie([items()[0], product("21", { descricao: "CADEIRA EIFFEL", codigo: "E1" })], stock).call, fetchImpl: fakeImages({}).fetchImpl, processImage: fakeOptimize });
  for (const key of ["last_sync_started_at", "last_sync_completed_at", "last_successful_sync", "products_processed", "products_published",
    "stock_records_processed", "images_processed", "duration_seconds", "peak_memory_mb", "status", "error"]) assert.ok(key in status, key);
  assert.equal(status.status, "ok"); assert.equal(status.stock_records_processed, 2); assert.equal(status.slugs_created, 2);
  const catalog = JSON.parse(await readFile(config.catalogPath, "utf8"));
  const slugOf = (id) => catalog.products.find((p) => p.id === id).slug;
  assert.equal(slugOf("20"), "armario-alto-fec-2-p-30mm-almeria-00003");
  assert.equal(slugOf("21"), "cadeira-eiffel-e1");
  assert.equal(catalog.redirects["produto-20"], "armario-alto-fec-2-p-30mm-almeria-00003");
  assert.ok((await readFile(config.reportPath, "utf8")).includes("armario-alto-fec-2-p-30mm-almeria-00003"));
  const registry = JSON.parse(await readFile(config.slugsPath, "utf8"));
  assert.equal(registry.products["20"].slug, "armario-alto-fec-2-p-30mm-almeria-00003");

  // Nome muda no Omie: URL igual. Registro apagado: reconstruído do catálogo publicado, URL igual.
  const renamed = [product("20", { codigo: "00003", descricao: "ARMÁRIO ALMERIA 2 PORTAS" }), product("21", { descricao: "CADEIRA EIFFEL", codigo: "E1" })];
  await syncCatalog(config, { call: fakeOmie(renamed, stock).call, fetchImpl: fakeImages({}).fetchImpl, processImage: fakeOptimize });
  await unlink(config.slugsPath);
  const after = await syncCatalog(config, { call: fakeOmie(renamed, stock).call, fetchImpl: fakeImages({}).fetchImpl, processImage: fakeOptimize });
  assert.equal(after.slugs_created, 0);
  const final = JSON.parse(await readFile(config.catalogPath, "utf8"));
  assert.equal(final.products.find((p) => p.id === "20").slug, "armario-alto-fec-2-p-30mm-almeria-00003");
  assert.equal(final.products.find((p) => p.id === "20").name, "ARMÁRIO ALMERIA 2 PORTAS");

  // Falha: status e histórico registram erro sem perder o último sucesso.
  await writeFile(config.editorialPath, JSON.stringify({ 20: { slug: "PRODUTO INVÁLIDO" } }));
  await assert.rejects(syncCatalog(config, { call: fakeOmie(renamed, stock).call, fetchImpl: fakeImages({}).fetchImpl }), (e) => e.code === "invalid_editorial_slug");
  const failed = JSON.parse(await readFile(config.statusPath, "utf8"));
  assert.equal(failed.status, "error"); assert.equal(failed.error, "invalid_editorial_slug"); assert.ok(failed.last_successful_sync);
  const history = (await readFile(config.historyPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(history.map((h) => h.status), ["ok", "ok", "ok", "error"]);
  await rm(dir, { recursive: true, force: true });
});
