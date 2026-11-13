// Built Node runtime with a temporary database, artificial accounts/catalog and loopback only.
// Build first: npm run build. Never uses production data or a logged-in browser profile.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const entry = join(root, ".output/server/index.mjs");
const freePort = () => new Promise((done) => {
  const probe = createServer().listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => done(port)); });
});
const jsonLd = (html) => Array.from(html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g), ([, value]) => JSON.parse(value));
const product = { id: "90001", slug: "cadeira-ficticia-qa", sku: "QA-90001", name: "Cadeira fictícia QA", omieName: "QA", category: "cadeiras", environments: ["home-office"], brand: "QA", line: "", color: "", image: "/images/product-placeholder.svg", images: ["/images/product-placeholder.svg"], price: null, stock: "PRONTA_ENTREGA", unit: "UN", available: 4317, description: "Produto artificial exclusivo do teste local." };

test("CMS runtime: admin-only preview, private drafts/media, published SSR/SEO/JSON-LD and persistent restoration", { skip: !existsSync(entry) && "sem build: rode npm run build", timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "mag-content-ssr-"));
  process.env.SITE_DATA_DIR = join(directory, "data");
  await mkdir(join(directory, "images"));
  await writeFile(join(directory, "catalog.json"), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), products: [product], redirects: {} }));
  const auth = await import("../src/lib/local-auth-core.server.ts");
  const db = await import("../src/lib/local-db.server.ts");
  const cms = await import("../src/lib/site-content.server.ts");
  const shared = await import("../src/lib/site-content.ts");
  const accounts = {};
  for (const role of ["admin", "comercial"]) {
    const { id } = await auth.createUser(`${role}@cms-ssr.test`, "Temporaria-Cms-123", [role]);
    const token = auth.createSession(id);
    accounts[role] = { cookie: `mag_site_session=${token}`, actor: auth.sessionUser(token) };
  }
  const actor = accounts.admin.actor;
  const current = () => cms.readSiteContentAdmin(actor);
  const save = (value) => cms.saveSiteContentDraftCore(actor, current().draft.revision, value);
  const publish = () => cms.publishSiteContentCore(actor, current().draft.revision);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let child;
  let log = "";
  const start = async () => {
    child = spawn(process.execPath, [entry], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
      ...process.env, HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "production", SITE_DATA_DIR: join(directory, "data"),
      SITE_PUBLIC_ORIGINS: base, PANEL_BASE_URL: base, SITE_TRUST_PROXY: "false", TURNSTILE_ENABLED: "false",
      OMIE_CATALOG_PATH: join(directory, "catalog.json"), OMIE_IMAGE_DIR: join(directory, "images"),
      OMIE_CONSULTA_URL: "http://127.0.0.1:9", OMIE_CONSULTA_TOKEN: "cms-local-qa-token",
    } });
    child.stdout.on("data", (chunk) => { log = (log + chunk).slice(-20000); });
    child.stderr.on("data", (chunk) => { log = (log + chunk).slice(-20000); });
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
      if (child.exitCode !== null) throw new Error(`runtime exited: ${log}`);
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error(`runtime did not start: ${log}`);
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(done => child.once("exit", done));child.kill();await exited;
  };
  const get = async (path, role) => {
    const response = await fetch(`${base}${path}`, { redirect: "manual", headers: role ? { cookie: accounts[role].cookie } : {} });
    return { status: response.status, headers: response.headers, html: await response.text() };
  };
  try {
    await start();
    assert.equal((await get("/")).status, 200);
    const artificialImage = async (width, height, color) => cms.uploadSiteImageCore(actor,
      (await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer()).toString("base64"));
    const desktop = await artificialImage(1600, 600, "#12647e");
    const mobile = await artificialImage(600, 900, "#875217");
    const hidden = await artificialImage(100, 100, "#111111");
    const document = shared.defaultSiteContent();
    Object.assign(document.general, { name: "CMS QA Organização", tagline: "Slogan QA publicado", logo: desktop.image, favicon: mobile.image, footerText: "Rodapé QA publicado" });
    Object.assign(document.seo, { title: "CMS QA título SEO", description: "Descrição SEO artificial da publicação CMS QA.", image: desktop.image });
    document.appearance.brandColor = "#12647e";
    document.announcement = { enabled: true, text: "Aviso QA publicado", href: "/produtos", label: "Ver catálogo QA" };
    Object.assign(document.home.hero, { title: "Hero QA publicado", desktopImage: desktop.image, mobileImage: mobile.image, layout: "banner", imageAlt: "Arte sintética QA" });
    const project = document.home.sections.find(section => section.id === "project");project.title = "Projeto QA primeiro";
    const environments = document.home.sections.find(section => section.id === "environments");environments.title = "Ambientes QA segundo";
    const categories = document.home.sections.find(section => section.id === "categories");categories.enabled = false;categories.title = "Categorias QA privadas";categories.image = hidden.image;
    document.home.sections = [project, environments, ...document.home.sections.filter(section => !["project", "environments"].includes(section.id))];
    document.home.banners = [{ ...shared.newSiteBanner(), enabled: true, image: desktop.image, mobileImage: mobile.image, title: "Banner QA publicado", fit: "natural", width: "full", href: "/produtos" }, { ...shared.newSiteBanner(), enabled: true, image: hidden.image, title: "Banner QA futuro privado", startsAt: "2099-01-01T00:00" }];
    save(document);
    const draftHome = await get("/");assert.equal(draftHome.status, 200);
    for (const privateValue of [document.general.name, document.home.hero.title, document.seo.title, actor.id, actor.email]) assert.ok(!draftHome.html.includes(privateValue), `public draft leakage: ${privateValue}`);
    assert.equal((await get(desktop.image)).status, 404);
    assert.equal((await get(desktop.previewUrl)).status, 401);
    assert.equal((await get(desktop.previewUrl, "comercial")).status, 403);
    const privateImage = await get(desktop.previewUrl, "admin");assert.equal(privateImage.status, 200);assert.match(privateImage.headers.get("cache-control") ?? "", /private.*no-store/);
    for (const role of [undefined, "comercial"]) {
      const denied = await get("/site-preview", role);
      assert.ok([401, 403, 302, 303, 307, 308].includes(denied.status), `preview must deny ${role ?? "anonymous"}: ${denied.status}`);
      assert.ok(!denied.html.includes(document.home.hero.title));
    }
    const preview = await get("/site-preview", "admin");assert.equal(preview.status, 200);assert.ok(preview.html.includes(document.home.hero.title));
    assert.match(preview.headers.get("cache-control") ?? "", /no-store/);
    assert.match((preview.headers.get("x-robots-tag") ?? "") + preview.html, /noindex/);
    assert.equal(publish().version, 1);
    const publicHome = await get("/");assert.equal(publicHome.status, 200);
    for (const value of [document.general.name, document.general.footerText, document.home.hero.title, document.seo.title, document.seo.description, "Aviso QA publicado", "Banner QA publicado"]) assert.ok(publicHome.html.includes(value), `SSR lacks ${value}`);
    for (const absent of [actor.id, actor.email, "Categorias QA privadas", hidden.image, "Banner QA futuro privado", "4317"]) assert.ok(!publicHome.html.includes(absent), `SSR exposed ${absent}`);
    assert.match(publicHome.html, /<title>CMS QA título SEO<\/title>/);
    assert.match(publicHome.html, /--brand:#12647e/);
    assert.ok(publicHome.html.indexOf("Projeto QA primeiro") < publicHome.html.indexOf("Ambientes QA segundo"), "section ordering in SSR");
    assert.ok(publicHome.html.includes(desktop.image) && publicHome.html.includes(mobile.image));
    const organization = jsonLd(publicHome.html).find(block => block["@type"] === "Organization");
    assert.equal(organization?.name, document.general.name);assert.equal(organization?.slogan, document.general.tagline);assert.ok(organization?.logo.endsWith(desktop.image));
    for (const reference of [desktop.image, mobile.image]) {
      const response = await get(reference);assert.equal(response.status, 200);assert.equal(response.headers.get("content-type"), "image/webp");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");assert.match(response.headers.get("content-security-policy") ?? "", /sandbox/);
    }
    assert.equal((await get(hidden.image)).status, 404);
    const firstPublication = current().publications[0];
    const second = structuredClone(document);second.home.hero.title = "Hero QA versão dois";save(second);publish();
    const changedDraft = structuredClone(second);changedDraft.home.hero.title = "Rascunho QA não publicado";save(changedDraft);
    cms.restoreSiteContentCore(actor, current().draft.revision, firstPublication.id);
    assert.ok((await get("/")).html.includes(second.home.hero.title));
    assert.ok(!(await get("/")).html.includes(changedDraft.home.hero.title));
    assert.ok((await get("/site-preview", "admin")).html.includes(document.home.hero.title));
    await stop();await start();
    assert.ok((await get("/")).html.includes(second.home.hero.title), "publication survives process restart");
    assert.ok((await get("/site-preview", "admin")).html.includes(document.home.hero.title), "restored private draft survives process restart");
    const hostile = structuredClone(document);hostile.general.name = "</script><script>alert(987)</script>";save(hostile);publish();
    const hostileHtml = (await get("/")).html;
    assert.ok(!hostileHtml.includes("<script>alert(987)</script>"));
    assert.equal(jsonLd(hostileHtml).find(block => block["@type"] === "Organization")?.name, hostile.general.name);
  } finally {
    await stop();db.closeDb();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
