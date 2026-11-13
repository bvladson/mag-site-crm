// Site renderizado pelo servidor de produção (.output): estoque sem número, carreiras, redes sem credencial e sitemap.
// Pula se não houver build: rode `npm run build` antes. Não usa rede externa nem o catálogo/banco reais.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = resolve(import.meta.dirname, "..");
const server = join(root, ".output", "server", "index.mjs");
const DAY = 86400000;
const SECRETS = { YOUTUBE_API_KEY: "SEGREDO-YT-NAO-PODE-VAZAR-1", INSTAGRAM_ACCESS_TOKEN: "SEGREDO-IG-NAO-PODE-VAZAR-2", TIKTOK_CLIENT_SECRET: "SEGREDO-TT-NAO-PODE-VAZAR-3" };
const THUMB = `${"a".repeat(64)}.webp`;
const OFFICIAL = ["https://www.youtube.com/@magmoveiscorporativos7222", "https://instagram.com/magmoveiscorporativos",
  "https://www.tiktok.com/@mag.moveis", "https://www.linkedin.com/company/magmoveiscorporativos"];

const product = (id, slug, fields = {}) => ({
  id, slug, sku: `SKU-${id}`, name: `Cadeira ${id}`, omieName: `CADEIRA ${id}`, category: "cadeiras", environments: [],
  brand: "MAG", line: "", color: "", image: "/images/product-placeholder.svg", images: ["/images/product-placeholder.svg"],
  price: null, stock: "PRONTA_ENTREGA", unit: "UN", available: 4317, description: "Descrição comum.", ...fields,
});
const freePort = () => new Promise((done) => {
  const probe = createServer().listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => done(port)); });
});
/** Nenhum número de estoque nem a chave "available" no HTML (texto visível e dados de hidratação). */
function assertNoQuantity(html, page) {
  assert.ok(!/available/i.test(html), `${page}: campo available no HTML`);
  assert.ok(!/[0-9]\s*unidades?\b/i.test(html) && !/unidades? dispon/i.test(html), `${page}: "unidades disponíveis"`);
  assert.ok(!/Estoque:\s*[0-9]/i.test(html), `${page}: "Estoque: N"`);
  assert.ok(!/[0-9]+\s*UN\b/.test(html), `${page}: "N UN"`);
  assert.ok(!/\b(4317|2718)\b/.test(html), `${page}: quantidade do catálogo apareceu`);
  assert.ok(!html.includes("Disponível para pronta entrega"), `${page}: texto antigo com quantidade`);
  assert.ok(!html.includes('"disponivel"') && !html.includes("/api/interno/produtos"), `${page}: dado da Consulta rápida no HTML público`);
}

test("site: estoque sem número, carreiras, redes sem credencial, sitemap e dados privados", { skip: !existsSync(server) && "sem build (.output): rode npm run build" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "mag-site-ssr-"));
  const now = Date.now();
  await mkdir(join(dir, "data"));
  await mkdir(join(dir, "social", "images"), { recursive: true });
  const products = [
    product("1", "cadeira-alfa-sku-1"),
    product("2", "mesa-beta-sku-2", { name: "Mesa Beta", category: "mesas", stock: "DISPONIVEL", available: 2718 }),
    product("3", "armario-gama-sku-3", { name: "Armário Gama", category: "armazenamento", stock: "SOB_CONSULTA", available: 0 }),
  ];
  await writeFile(join(dir, "catalog.json"), JSON.stringify({ schemaVersion: 1, generatedAt: new Date(now).toISOString(), products, redirects: {} }));
  // Cadastro completo do Omie (Consulta rápida): os 3 publicados + 2 que NUNCA podem aparecer no site.
  const omie = (id, nome, extra = {}) => ({ id, sku: `SKU-${id}`, nome, ean: "", marca: "", familia: "", unidade: "UN", categoria: "", inativo: false, bloqueado: false, ...extra });
  await mkdir(join(dir, "interno"));
  await writeFile(join(dir, "interno", "omie-produtos.json"), JSON.stringify({ schemaVersion: 1, geradoEm: new Date(now).toISOString(), total: 5, produtos: [
    omie("1", "CADEIRA 1", { ean: "7890000000017" }), omie("2", "MESA BETA"), omie("3", "ARMARIO GAMA"),
    omie("777", "UNIFORME SECRETO INTERNO", { ean: "7891234567895", familia: "UNIFORMES" }),
    omie("778", "CADEIRA OCULTA INATIVA", { categoria: "cadeiras", inativo: true }),
  ] }));
  const video = { provider: "youtube", external_id: "aaaaaaaaaaa", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", type: "video", title: "Vídeo de teste da MAG",
    thumbnail: THUMB, published_at: "2026-10-01T12:00:00.000Z", author: "MAG", duration: 65, metadata: { aspect: "16:9", youtube_id: "aaaaaaaaaaa" } };
  const forged = { ...video, external_id: "bbbbbbbbbbb", url: "https://golpe.example/watch?v=bbbbbbbbbbb", title: "Item forjado no cache" };
  // Vídeo sincronizado de OUTRA conta do TikTok: nunca pode aparecer no site (a conta não confere com o perfil oficial).
  const otherTiktok = { provider: "tiktok", external_id: "7300000000000000001", url: "https://www.tiktok.com/@outra.conta/video/7300000000000000001", type: "short",
    title: "Vídeo de outra conta", thumbnail: null, published_at: "2026-10-01T12:00:00.000Z", author: null, duration: 10, metadata: { aspect: "9:16", youtube_id: null } };
  await writeFile(join(dir, "social", "social.json"), JSON.stringify({ schemaVersion: 1, generatedAt: new Date(now).toISOString(), providers: {
    youtube: { items: [video, forged] }, instagram: { items: [] }, tiktok: { items: [otherTiktok] }, linkedin: { items: [] } } }));
  const sync = (account) => ({ status: "conectado", configured: true, lastAttemptAt: new Date(now).toISOString(), lastSuccessAt: new Date(now).toISOString(), itemCount: 1, error: null, account });
  const off = { status: "desconectado", configured: false, lastAttemptAt: null, lastSuccessAt: null, itemCount: 0, error: null, account: null };
  await writeFile(join(dir, "social", "social.status.json"), JSON.stringify({ schemaVersion: 1, checkedAt: new Date(now).toISOString(), providers: {
    youtube: sync({ id: "UC1234567890abcdefghijkl", name: "MAG", handle: "magmoveis" }), tiktok: sync({ id: "open-1", name: "Outra", handle: "outra.conta" }),
    instagram: off, linkedin: off } }));
  await writeFile(join(dir, "social", "images", THUMB), Buffer.from("RIFF0000WEBPVP8 teste"));

  const port = await freePort();
  const child = spawn(process.execPath, [server], {
    cwd: root, stdio: "ignore",
    env: { ...process.env, ...SECRETS, HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "production", SITE_DATA_DIR: join(dir, "data"),
      OMIE_CATALOG_PATH: join(dir, "catalog.json"), OMIE_IMAGE_DIR: join(dir, "images"),
      // Consulta rápida com o serviço interno fora do ar (porta fechada): tem de responder o motivo, nunca 500.
      OMIE_CONSULTA_URL: "http://127.0.0.1:9", OMIE_CONSULTA_TOKEN: "t".repeat(48) },
  });
  let db;
  let fecharBancoDoTeste;
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { await fetch(`${base}/api/health`); break; } catch { await new Promise((wait) => setTimeout(wait, 200)); }
    }
    const get = async (path) => { const response = await fetch(`${base}${path}`, { redirect: "manual" }); return { status: response.status, headers: response.headers, html: await response.text() }; };

    // Sem credencial e sem nada cadastrado: /redes e /carreiras funcionam (a 1ª visita também cria o banco).
    const emptyCareers = await get("/carreiras");
    assert.equal(emptyCareers.status, 200);
    const emptySocial = await get("/redes");
    assert.equal(emptySocial.status, 200);
    // Perfis oficiais confirmados aparecem sem credencial nenhuma, em /redes e no rodapé (modo manual).
    assert.ok(emptySocial.html.includes("Perfis oficiais da MAG"));
    for (const url of OFFICIAL) assert.ok(emptySocial.html.includes(`href="${url}"`), `perfil oficial em /redes: ${url}`);
    assert.ok(!emptySocial.html.includes("Vídeo de teste da MAG"), "modo manual: o cache da API não aparece");
    const emptyHome = await get("/");
    for (const url of OFFICIAL) assert.ok(emptyHome.html.includes(`href="${url}"`), `rodapé: ${url}`);
    assert.equal((emptyHome.html.match(/aria-label="MAG no (YouTube|Instagram|TikTok|LinkedIn)"/g) ?? []).length, 4, "4 ícones no rodapé");

    // Vagas e redes cadastradas direto no banco (como o painel faria).
    db = new DatabaseSync(join(dir, "data", "site.sqlite"));
    const iso = (offset) => new Date(now + offset).toISOString();
    const job = db.prepare(`INSERT INTO jobs(id,slug,title,area,location,work_model,contract_type,schedule,summary,description,responsibilities,requirements,differentials,status,opened_at,closes_at,closed_at,priority,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    job.run(randomUUID(), "vendedor-externo", "Vendedor Externo", "Comercial", "Fortaleza – CE", "presencial", "CLT", "Seg a sex, 8h–18h", "Atendimento a empresas.",
      "Venda consultiva de mobiliário corporativo.", "Visitar clientes\nMontar propostas", "Ensino médio\nCNH B", "Experiência com móveis", "publicada", iso(-DAY), iso(10 * DAY), null, 10, iso(-DAY), iso(-DAY));
    job.run(randomUUID(), "rascunho-secreto", "Rascunho Secreto", "Comercial", null, null, null, null, null, null, null, null, null, "rascunho", null, null, null, 100, iso(0), iso(0));
    job.run(randomUUID(), "montador-encerrada", "Montador Encerrada", "Operações / Montagem", "Fortaleza – CE", "presencial", "CLT", null, null, "Montagem.", null, null, null, "encerrada", iso(-30 * DAY), null, iso(-DAY), 100, iso(-30 * DAY), iso(-DAY));
    job.run(randomUUID(), "publicada-vencida", "Publicada Vencida", "Logística", null, null, null, null, null, "Prazo encerrado.", null, null, null, "publicada", iso(-20 * DAY), iso(-DAY), null, 100, iso(-20 * DAY), iso(-20 * DAY));
    const setting = db.prepare("INSERT INTO social_settings(network,mode,profile_url,handle,updated_at,updated_by) VALUES (?,?,?,?,?,NULL)");
    setting.run("youtube", "api", "https://www.youtube.com/@magmoveis", "MAG Móveis", iso(0));
    setting.run("tiktok", "api", "https://www.tiktok.com/@mag.moveis", "@mag.moveis", iso(0));
    setting.run("linkedin", "disabled", "https://www.linkedin.com/company/magmoveiscorporativos", "", iso(0));
    const manual = db.prepare(`INSERT INTO social_manual_items(id,network,url,title,kind,image,published_at,position,active,created_at,updated_at,created_by) VALUES (?,?,?,?,?,NULL,?,?,?,?,?,NULL)`);
    manual.run(randomUUID(), "instagram", "https://www.instagram.com/p/ProjetoEntregue/", "Projeto entregue no Centro", "post", iso(-DAY), 10, 1, iso(0), iso(0));
    manual.run(randomUUID(), "instagram", "https://www.instagram.com/p/Oculto/", "Destaque oculto", "post", iso(-DAY), 20, 0, iso(0), iso(0));

    // Estoque: só o selo, nunca a quantidade — home, listagem, categoria e produto.
    const home = await get("/");
    assert.equal(home.status, 200);
    assert.ok(home.html.includes("Pronta entrega") && home.html.includes("Cadeira 1"), "vitrine renderizada com o produto");
    assertNoQuantity(home.html, "home");
    for (const [path, name] of [["/produtos", "Mesa Beta"], ["/categoria/cadeiras", "Cadeira 1"], ["/produtos?q=cadeira", "Cadeira 1"]]) {
      const page = await get(path);
      assert.equal(page.status, 200, path);
      assert.ok(page.html.includes(name), `${path}: produto renderizado`);
      assertNoQuantity(page.html, path);
    }
    const ready = await get("/produto/cadeira-alfa-sku-1");
    assert.equal(ready.status, 200);
    assert.ok(ready.html.includes("Pronta entrega") && ready.html.includes("Disponibilidade atualizada"));
    assertNoQuantity(ready.html, "produto pronta entrega");
    const consult = await get("/produto/armario-gama-sku-3");
    assert.ok(consult.html.includes("Consulte disponibilidade"), "sob consulta continua igual");
    assertNoQuantity(consult.html, "produto sob consulta");

    // Carreiras: só vagas publicadas e no prazo; rascunho não existe; encerrada fica com aviso e noindex.
    const careers = await get("/carreiras");
    assert.ok(careers.html.includes("Vendedor Externo"));
    for (const hidden of ["Rascunho Secreto", "Montador Encerrada", "Publicada Vencida"]) assert.ok(!careers.html.includes(hidden), `${hidden} não aparece como aberta`);
    const open = await get("/carreiras/vagas/vendedor-externo");
    assert.equal(open.status, 200);
    assert.ok(open.html.includes('"@type":"JobPosting"') && !open.html.includes("noindex"));
    assert.ok(open.html.includes("Enviar candidatura") || open.html.includes("currículo"), "formulário de candidatura");
    assert.equal((await get("/carreiras/vagas/rascunho-secreto")).status, 404);
    // Endereço malformado é 404 (antes: 500 pela validação do servidor), em vaga e em produto.
    for (const path of ["/carreiras/vagas/ABC", "/carreiras/vagas/a_b", "/carreiras/vagas/%C3%A7", "/carreiras/vagas/..%2Finterno",
      "/produto/ABC", "/produto/a_b", "/produto/%C3%A7", "/produto/..%2Finterno", `/produto/${"a".repeat(201)}`]) {
      assert.equal((await get(path)).status, 404, path);
    }
    assert.equal((await get("/produto/cadeira-alfa-sku-1")).status, 200, "slug válido continua igual");
    for (const slug of ["montador-encerrada", "publicada-vencida"]) {
      const closed = await get(`/carreiras/vagas/${slug}`);
      assert.equal(closed.status, 200, slug);
      assert.ok(closed.html.includes("noindex") && !closed.html.includes("JobPosting") && closed.html.includes("Esta vaga foi encerrada"), slug);
    }
    assert.equal((await get("/carreiras/banco-de-talentos")).status, 200);

    // Redes: cache da API (item forjado descartado), destaque manual ativo, rodapé e Organization.sameAs.
    const social = await get("/redes");
    assert.ok(social.html.includes("Vídeo de teste da MAG") && social.html.includes(`/social-images/${THUMB}`));
    assert.ok(!social.html.includes("Item forjado no cache") && !social.html.includes("golpe.example"));
    assert.ok(social.html.includes("Projeto entregue no Centro") && !social.html.includes("Destaque oculto"));
    assert.ok(!social.html.includes("<iframe"), "player só depois do clique");
    assert.ok(!social.html.includes("Vídeo de outra conta") && !social.html.includes("@outra.conta"), "conteúdo de outra conta do TikTok bloqueado");
    assert.ok(social.html.includes('href="https://www.tiktok.com/@mag.moveis"'), "o perfil oficial do TikTok continua como link");
    assert.ok(!social.html.includes("linkedin.com"), "rede desligada não aparece nem como card vazio");
    const home2 = await get("/");
    assert.ok(home2.html.includes("MAG nas redes") && home2.html.includes("Vídeo de teste da MAG"), "seção social na home");
    assert.ok(home2.html.includes('href="https://www.youtube.com/@magmoveis"') && home2.html.includes('href="https://instagram.com/magmoveiscorporativos"')
      && home2.html.includes('href="https://www.tiktok.com/@mag.moveis"') && !home2.html.includes("linkedin.com/company"), "rodapé segue a configuração (LinkedIn desligado)");
    assert.match(home2.html, /"sameAs":\["https:..www.youtube.com.@magmoveis","https:..instagram.com.magmoveiscorporativos","https:..www.tiktok.com.@mag.moveis"\]/);
    for (const page of [home2, social, open, careers]) for (const secret of Object.values(SECRETS)) assert.ok(!page.html.includes(secret), "segredo no HTML");

    const thumb = await fetch(`${base}/social-images/${THUMB}`);
    assert.equal(thumb.status, 200);
    assert.equal(thumb.headers.get("content-type"), "image/webp");
    assert.equal(thumb.headers.get("x-content-type-options"), "nosniff");
    assert.match(thumb.headers.get("content-security-policy") ?? "", /sandbox/);
    for (const path of ["/social-images/..%2Fsocial.json", "/social-images/social.json", `/social-images/m-${randomUUID()}.jpg`, "/social-images/m-..%2F..%2Fdata%2Fsite.sqlite"]) {
      assert.equal((await fetch(`${base}${path}`)).status, 404, path);
    }

    // Sitemap: vaga aberta e /redes; nada de rascunho, encerrada, vencida ou URL externa das redes.
    const sitemap = (await get("/sitemap.xml")).html;
    assert.ok(sitemap.includes("/carreiras/vagas/vendedor-externo") && sitemap.includes("/redes</loc>"));
    for (const absent of ["rascunho-secreto", "montador-encerrada", "publicada-vencida", "youtube.com", "instagram.com"]) assert.ok(!sitemap.includes(absent), `sitemap: ${absent}`);

    // Consulta rápida (painel): número interno só na API autenticada; sem sessão 401, DHO 403, Admin/Comercial 200.
    process.env.SITE_DATA_DIR = join(dir, "data");
    const auth = await import("../src/lib/local-auth-core.server.ts");
    fecharBancoDoTeste = (await import("../src/lib/local-db.server.ts")).closeDb;
    const sessao = {};
    for (const perfil of ["admin", "comercial", "dho"]) {
      const { id } = await auth.createUser(`${perfil}@teste.example`, "Senha-Forte-123", [perfil]);
      sessao[perfil] = { cookie: `mag_site_session=${auth.createSession(id)}` };
    }
    const api = (caminho, quem, init = {}) => fetch(`${base}${caminho}`, { ...init, headers: { ...(quem ? sessao[quem] : {}), ...(init.headers ?? {}) } });
    assert.equal((await api("/api/interno/produtos")).status, 401);
    assert.equal((await api("/api/interno/produtos", "dho")).status, 403);
    for (const perfil of ["comercial", "admin"]) {
      const resposta = await api("/api/interno/produtos", perfil);
      assert.equal(resposta.status, 200, perfil);
      assert.match(resposta.headers.get("cache-control") ?? "", /no-store/);
      const corpo = await resposta.json();
      assert.equal(corpo.itens.find((item) => item.id === "1").disponivel, 4317, "número interno só aqui");
    }
    const busca = await (await api(`/api/interno/produtos?q=${encodeURIComponent("beta MESA")}`, "comercial")).json();
    assert.deepEqual(busca.itens.map((item) => item.sku), ["SKU-2"]);
    const longa = await api(`/api/interno/produtos?q=${encodeURIComponent("<script>%'".repeat(200))}&filtro=xyz`, "comercial");
    assert.equal(longa.status, 200, "busca enorme e com caracteres especiais");
    assert.equal((await api("/api/interno/produtos/2", "comercial")).status, 200);
    assert.equal((await (await api("/api/interno/produtos/2", "comercial")).json()).produto.disponivel, 2718);
    assert.equal((await api("/api/interno/produtos/999999", "comercial")).status, 404);
    assert.equal((await api("/api/interno/produtos/abc", "comercial")).status, 400);
    assert.equal((await api("/api/interno/produtos/2", "dho")).status, 403);
    assert.equal((await api("/api/interno/produtos/2")).status, 401);
    assert.equal((await api("/api/interno/produtos/1", "comercial", { method: "POST" })).status, 403, "POST sem Origin");
    assert.equal((await api("/api/interno/produtos/1", "comercial", { method: "POST", headers: { origin: "https://golpe.example" } })).status, 403);
    assert.equal((await api("/api/interno/produtos/1", "dho", { method: "POST", headers: { origin: base } })).status, 403);
    assert.equal((await api("/api/interno/produtos/1", null, { method: "POST", headers: { origin: base } })).status, 401);
    const offline = await api("/api/interno/produtos/1", "comercial", { method: "POST", headers: { origin: base } });
    assert.equal(offline.status, 200, "Omie/serviço fora do ar nunca vira 500");
    const falha = await offline.json();
    assert.equal(falha.ok, false);
    assert.equal(falha.motivo, "indisponivel");
    assert.ok(falha.ultimaSincronizacao, "devolve a última sincronização");
    const registro = db.prepare("SELECT action FROM audit_log WHERE action LIKE 'omie:%'").all().map((linha) => linha.action);
    assert.deepEqual(registro, ["omie:consulta:erro:indisponivel"], "erro da consulta auditado");

    // Cadastro completo ("Mostrar todos os produtos do Omie"): só com ?todos=1, só no painel e nunca no site.
    const padrao = await (await api("/api/interno/produtos", "comercial")).json();
    assert.equal(padrao.itens.length, 3, "por padrão, só os publicados");
    assert.equal(padrao.itens.find((item) => item.id === "1").ean, "7890000000017", "EAN do cadastro completo também nos publicados");
    assert.deepEqual({ total: padrao.cadastro.total, foraDoSite: padrao.cadastro.foraDoSite }, { total: 5, foraDoSite: 2 });
    const completo = await (await api("/api/interno/produtos?todos=1", "comercial")).json();
    const secreto = completo.itens.find((item) => item.id === "777");
    assert.deepEqual({ publicado: secreto.publicado, estoque: secreto.estoque, disponivel: secreto.disponivel, slug: secreto.slug, imagem: secreto.imagem },
      { publicado: false, estoque: null, disponivel: null, slug: null, imagem: "/images/product-placeholder.svg" });
    assert.equal(completo.itens.find((item) => item.id === "778").inativo, true);
    assert.deepEqual((await (await api("/api/interno/produtos?todos=1&q=7891234567895", "comercial")).json()).itens.map((item) => item.id), ["777"], "busca pelo EAN");
    assert.equal((await (await api("/api/interno/produtos?q=uniforme", "comercial")).json()).total, 0, "sem todos=1 não aparece");
    assert.equal((await api("/api/interno/produtos/777", "comercial")).status, 200);
    for (const [caminho, quem, esperado] of [["/api/interno/produtos?todos=1", "dho", 403], ["/api/interno/produtos?todos=1", null, 401], ["/api/interno/produtos/777", null, 401]]) {
      assert.equal((await api(caminho, quem)).status, esperado, `${caminho} ${quem ?? "sem sessão"}`);
    }
    const consultaFora = await (await api("/api/interno/produtos/777", "comercial", { method: "POST", headers: { origin: base } })).json();
    assert.equal(consultaFora.motivo, "indisponivel", "produto fora do site também vai ao Omie (sob demanda), nunca 404");
    for (const caminho of ["/", "/produtos", "/produtos?q=uniforme", "/produtos?q=oculta", "/categoria/cadeiras", "/sitemap.xml"]) {
      const pagina = await get(caminho);
      assert.ok(!/UNIFORME SECRETO|CADEIRA OCULTA|7891234567895|7890000000017/i.test(pagina.html), `${caminho}: cadastro interno no site`);
    }
    assert.equal((await get("/produto/produto-777")).status, 404, "produto fora do site não ganha página");

    // Currículo e painel: nada sem sessão.
    assert.equal((await get(`/api/interno/curriculo/${randomUUID()}`)).status, 401);
    const robots = (await get("/robots.txt")).html;
    assert.ok(robots.includes("Disallow: /interno") && robots.includes("Disallow: /api/"));

    // Bundle do navegador: nenhum padrão de credencial (chave Google, tokens Meta/Instagram, TikTok, LinkedIn, Omie).
    const assets = join(root, ".output", "public", "assets");
    for (const file of (await readdir(assets)).filter((name) => name.endsWith(".js"))) {
      const code = await readFile(join(assets, file), "utf8");
      assert.ok(!/AIza[0-9A-Za-z_-]{30,}|IGQV[0-9A-Za-z_-]{20,}|EAA[0-9A-Za-z]{30,}|act[.][0-9A-Za-z]{20,}|AQV[0-9A-Za-z_-]{30,}/.test(code), `credencial no bundle: ${file}`);
      for (const name of ["OMIE_APP_KEY", "OMIE_APP_SECRET", "TELEGRAM_BOT_TOKEN"]) assert.ok(!code.includes(name), `${name} no bundle: ${file}`);
    }
  } finally {
    db?.close();
    fecharBancoDoTeste?.(); // a conexão deste processo (sessões de teste) segurava o arquivo no Windows
    const exited = child.exitCode !== null ? Promise.resolve() : new Promise((done) => child.once("exit", done));
    child.kill();
    await exited;
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
