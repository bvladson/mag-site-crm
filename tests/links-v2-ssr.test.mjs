// New link-tree layout through the production server, using a temporary database only.
// Build before running: npm run build. No production session, data or external API is used.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";

const project = resolve(import.meta.dirname, "..");
const entry = join(project, ".output/server/index.mjs");
const portAvailable = () => new Promise(done => {
  const probe = createServer().listen(0, "127.0.0.1", () => {
    const port = probe.address().port;
    probe.close(() => done(port));
  });
});

test("link tree v2: legacy publications keep content and IDs; manageable presentation stays private until published", { skip: !existsSync(entry) && "build required", timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "mag-links-v2-ssr-"));
  process.env.SITE_DATA_DIR = join(directory, "data");
  await mkdir(join(directory, "images"));
  await writeFile(join(directory, "catalog.json"), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), products: [], redirects: {} }));
  const auth = await import("../src/lib/local-auth-core.server.ts");
  const db = await import("../src/lib/local-db.server.ts");
  const links = await import("../src/lib/links.server.ts");
  const model = await import("../src/lib/links.ts");
  const { id } = await auth.createUser("admin@links-v2-ssr.test", "Temporary-QA-Links-123", ["admin"]);
  const session = auth.createSession(id);
  const actor = auth.sessionUser(session);
  const sellerAccount = await auth.createUser("comercial@links-v2-ssr.test", "Temporary-QA-Links-123", ["comercial"]);
  const sellerSession = auth.createSession(sellerAccount.id);
  const picture = await sharp({ create: { width: 1200, height: 450, channels: 3, background: "#12647e" } }).webp().toBuffer();
  const image = await links.uploadLinkImageCore(actor, picture.toString("base64"));
  const hiddenImage = await links.uploadLinkImageCore(actor, picture.toString("base64"));
  const make = (type, title, fields = {}) => ({ ...model.newLinkTreeItem(type), title, active: true, ...fields });
  const unitA = make("location", "Centro", { address: "Rua de teste A, 100", hours: "Seg a sex 8h às 17h", landline: "8531220506", accent: "amber", image: image.image });
  const unitB = make("location", "BR-116", { address: "Rua de teste B, 200", phone: "5585999990002", message: "Atendimento QA da unidade", image: image.image });
  const primary = make("link", "Prioritário artificial QA", { url: "/produtos?qa=prioritario", position: 0 });
  const sellerA = make("seller", "João artificial QA", { phone: "5585999990003", description: "Consultor de São Paulo QA", locationId: unitA.id, image: image.image, position: 3 });
  const sellerB = make("seller", "Maria artificial QA", { phone: "5585999990004", locationId: unitB.id, image: image.image, position: 4 });
  const general = make("seller", "Equipe geral artificial QA", { phone: "5585999990005", position: 5 });
  const catalog = make("link", "Catálogo artificial QA", { url: "https://example.test/catalogo", highlight: true, position: 6 });
  const sac = make("whatsapp", "SAC artificial QA", { phone: "5585999990006", message: "Mensagem original QA + acentos", position: 7 });
  const hidden = make("link", "Link privado artificial QA", { active: false, url: "/produtos?qa=privado", image: hiddenImage.image, position: 8 });
  const legacy = model.emptyLinkTreeContent();
  legacy.title = "Árvore legada artificial QA";
  legacy.subtitle = "Conteúdo anterior preservado";
  legacy.items = [primary, { ...unitA, position: 1 }, { ...unitB, position: 2 }, sellerA, sellerB, general, catalog, sac, hidden];
  delete legacy.presentation;
  for (const item of legacy.items) delete item.icon;
  const raw = JSON.stringify(legacy);
  const publicationId = crypto.randomUUID();
  links.linksSchema();
  db.getDb().prepare("UPDATE link_tree_draft SET revision=1,content=?,updated_at=?,updated_by=? WHERE id=1").run(raw, new Date().toISOString(), id);
  db.getDb().prepare("INSERT INTO link_tree_publications(id,version,content,published_at,published_by) VALUES (?,1,?,?,?)").run(publicationId, raw, new Date().toISOString(), id);
  const port = await portAvailable(), origin = "http://127.0.0.1:" + port;
  let server, log = "";
  const start = async () => {
    server = spawn(process.execPath, [entry], { cwd: project, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
      ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port), SITE_DATA_DIR: join(directory, "data"),
      SITE_PUBLIC_ORIGINS: origin, PANEL_BASE_URL: origin, SITE_TRUST_PROXY: "false",
      OMIE_CATALOG_PATH: join(directory, "catalog.json"), OMIE_IMAGE_DIR: join(directory, "images"),
      LINKTREE_API_URL: "https://must-not-fetch-fallback.invalid/link-tree",
    } });
    server.stdout.on("data", chunk => { log = (log + chunk).slice(-10000); });
    server.stderr.on("data", chunk => { log = (log + chunk).slice(-10000); });
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(origin + "/api/health")).ok) return; } catch {}
      if (server.exitCode !== null) throw new Error("Server exited: " + log);
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error("Server did not start: " + log);
  };
  const stop = async () => {
    if (!server || server.exitCode !== null) return;
    const exited = new Promise(done => server.once("exit", done));
    server.kill();
    await exited;
  };
  const get = async (path, role) => {
    const token = role === "admin" ? session : role === "comercial" ? sellerSession : null;
    const response = await fetch(origin + path, { redirect: "manual", headers: token ? { cookie: "mag_site_session=" + token } : {} });
    return { status: response.status, headers: response.headers, html: await response.text() };
  };
  try {
    await start();
    const before = await get("/links/");
    assert.equal(before.status, 200);
    for (const title of [legacy.title, unitA.title, unitB.title, sellerA.title, sellerB.title, general.title, primary.title, catalog.title, sac.title]) assert.ok(before.html.includes(title), "Missing legacy content: " + title);
    for (const item of [primary, sellerA, sellerB, general, catalog, sac]) assert.ok(before.html.includes('data-links-target="' + item.id + '"'), "Original metric ID lost: " + item.id);
    assert.ok(before.html.includes(primary.url));
    assert.ok(before.html.includes("tel:+558531220506"));
    assert.ok(before.html.includes("https://wa.me/5585999990006?text="));
    assert.ok(!before.html.includes(hidden.title));
    assert.ok(!before.html.includes(hidden.image));
    assert.ok(!before.html.includes(actor.id) && !before.html.includes(actor.email));
    assert.equal(db.getDb().prepare("SELECT content FROM link_tree_publications WHERE id=?").get(publicationId).content, raw, "Reading a legacy publication rewrote its snapshot");
    assert.equal((await get(hiddenImage.image)).status, 404);
    const qr = await get("/links/qr.svg");
    assert.equal(qr.status, 200);
    assert.match(qr.headers.get("content-type") ?? "", /image\/svg\+xml/);
    assert.match(qr.html, /<svg/);

    const draft = links.readLinkTreeAdmin(actor).draft;
    const changed = structuredClone(draft.content);
    changed.presentation.slogan = "Slogan novo ainda privado QA";
    changed.presentation.labels.unitsTitle = "Lojas com apresentação editada QA";
    changed.presentation.labels.linksTitle = "Canais com apresentação editada QA";
    changed.presentation.labels.siteLabel = "Abrir institucional QA";
    changed.presentation.siteUrl = "/sobre";
    changed.presentation.privacyUrl = "/privacidade?origem=arvore-qa";
    changed.presentation.accentColor = "#12647e";
    changed.presentation.headerLayout = "centered";
    changed.presentation.contentLayout = "stacked";
    changed.presentation.contentWidth = "compact";
    changed.presentation.cardStyle = "solid";
    changed.presentation.corners = "soft";
    changed.items.find(item => item.id === catalog.id).icon = "catalog";
    const saved = links.saveLinkTreeDraftCore(actor, draft.revision, changed);
    const privateHome = await get("/links/");
    assert.ok(!privateHome.html.includes(changed.presentation.slogan));
    assert.ok(!privateHome.html.includes(changed.presentation.labels.unitsTitle));
    for (const role of [undefined, "comercial"]) {
      const denied = await get("/links/preview", role);
      assert.ok([401, 403, 302, 303, 307, 308].includes(denied.status), "Preview must deny " + (role ?? "anonymous"));
      assert.ok(!denied.html.includes(changed.presentation.slogan));
      assert.match(denied.headers.get("cache-control") ?? "", /no-store/);
      assert.match(denied.headers.get("x-robots-tag") ?? "", /noindex/);
    }
    const privatePreview = await get("/links/preview", "admin");
    assert.equal(privatePreview.status, 200);
    assert.ok(privatePreview.html.includes(changed.presentation.slogan));
    assert.match(privatePreview.headers.get("cache-control") ?? "", /no-store/);
    assert.match(privatePreview.headers.get("x-robots-tag") ?? "", /noindex/);
    links.publishLinkTreeCore(actor, saved.revision);
    const after = await get("/links/");
    for (const value of [changed.presentation.slogan, changed.presentation.labels.unitsTitle, changed.presentation.labels.linksTitle, changed.presentation.labels.siteLabel]) assert.ok(after.html.includes(value), "Published setting absent: " + value);
    assert.ok(after.html.includes('href="/sobre"'));
    assert.ok(after.html.includes('href="/privacidade?origem=arvore-qa"'));
    for (const item of [primary, sellerA, sellerB, general, catalog, sac]) assert.ok(after.html.includes('data-links-target="' + item.id + '"'));
    assert.equal(db.getDb().prepare("SELECT content FROM link_tree_publications WHERE id=?").get(publicationId).content, raw);
    const restore = links.restoreLinkTreeCore(actor, links.readLinkTreeAdmin(actor).draft.revision, publicationId);
    assert.equal(links.readLinkTreeAdmin(actor).draft.content.presentation.headerLayout, "aligned");
    assert.ok((await get("/links/")).html.includes(changed.presentation.slogan), "Restore changed the public page before publication");
    links.publishLinkTreeCore(actor, restore.revision);
    const restored = await get("/links/");
    assert.ok(!restored.html.includes(changed.presentation.slogan));
    assert.ok(restored.html.includes(legacy.title));
    await stop();
    await start();
    assert.ok((await get("/links/")).html.includes(legacy.title));
    assert.equal(db.getDb().prepare("SELECT content FROM link_tree_publications WHERE id=?").get(publicationId).content, raw);
    assert.equal((await get("/")).status, 200);
    assert.ok(!(await get("/")).html.includes(changed.presentation.slogan), "Tree settings leaked into the institutional layout");
  } finally {
    await stop();
    auth.deleteSession(session);
    auth.deleteSession(sellerSession);
    db.closeDb();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir(), "mag-links-v2-ssr-")));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
