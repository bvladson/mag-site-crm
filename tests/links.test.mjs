// node --test tests/links.test.mjs: temporary database, no external network or real customer data.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";

const dir = await mkdtemp(join(tmpdir(), "mag-links-"));
process.env.SITE_DATA_DIR = dir;
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const links = await import("../src/lib/links.server.ts");
const shared = await import("../src/lib/links.ts");
const makeUser = async (email, roles) => ({ id: (await auth.createUser(email, "Senha-Temporaria-123", roles)).id, email, roles, created_at: "" });
const admin = await makeUser("admin@links.test", ["admin"]);
const comercial = await makeUser("comercial@links.test", ["comercial"]);
const dho = await makeUser("dho@links.test", ["dho"]);
const content = (title = "MAG de teste") => ({ ...shared.emptyLinkTreeContent(), title, items: [{ ...shared.newLinkTreeItem("link"), title: "Catálogo", url: "/produtos", active: true, position: 0 }] });
const draft = () => links.readLinkTreeAdmin(admin).draft;
const save = (data) => links.saveLinkTreeDraftCore(admin, draft().revision, data);
const publish = () => links.publishLinkTreeCore(admin, draft().revision);

test.after(async () => { db.closeDb(); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

test("all editor operations, including image reads, reject anonymous and non-admin actors", async () => {
  assert.equal(links.readPublicLinkTree(), null);
  for (const actor of [null, comercial, dho, { ...comercial, roles: ["admin"] }]) {
    for (const call of [
      () => links.readLinkTreeAdmin(actor),
      () => links.saveLinkTreeDraftCore(actor, 0, content()),
      () => links.publishLinkTreeCore(actor, 0),
      () => links.restoreLinkTreeCore(actor, 0, crypto.randomUUID()),
      () => links.readAdminLinkImage(actor, `${crypto.randomUUID()}.webp`),
      () => links.seedLinkTreeCore(actor, content()),
    ]) assert.throws(call, /Unauthorized|Forbidden/);
    await assert.rejects(() => links.uploadLinkImageCore(actor, "AAAA"), /Unauthorized|Forbidden/);
  }
});

test("bootstrap publishes official seed once and never overwrites existing content", () => {
  assert.deepEqual(links.seedLinkTreeCore(admin, content()), { seeded: true });
  const initial = links.readPublicLinkTree();
  assert.equal(initial.version, 1);
  assert.deepEqual(links.seedLinkTreeCore(admin, content("Não substituir")), { seeded: false });
  assert.deepEqual(links.readPublicLinkTree(), initial);
});

test("real seed CLI validates the actor and publishes existing official contacts idempotently", () => {
  const seedDir = join(dir, "seed-cli");
  const env = { ...process.env, SITE_DATA_DIR: seedDir };
  const created = spawnSync(process.execPath, ["--input-type=module", "-e", `const auth=await import('./src/lib/local-auth-core.server.ts'); await auth.createUser('admin@seed.test','Senha-Temporaria-123',['admin']); await auth.createUser('comercial@seed.test','Senha-Temporaria-123',['comercial']); const db=await import('./src/lib/local-db.server.ts'); db.closeDb();`], { env, encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  const cli = (...args) => spawnSync(process.execPath, ["scripts/seed-links.mjs", ...args], { env, encoding: "utf8" });
  assert.equal(cli().status, 1);
  assert.equal(cli("--actor", "comercial@seed.test").status, 1);
  const first = cli("--actor", "admin@seed.test");
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /versão 1/);
  const again = cli("--actor=admin@seed.test");
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Nenhuma alteração/);
  const seedDb = new DatabaseSync(join(seedDir, "site.sqlite"));
  try {
    const rows = seedDb.prepare("SELECT content FROM link_tree_publications").all();
    assert.equal(rows.length, 1);
    const data = JSON.parse(rows[0].content);
    assert.equal(data.items.find((item) => item.type === "whatsapp").phone, "5585998610074");
    assert.equal(data.items.filter((item) => item.type === "seller").length, 0);
    assert.ok(data.items.some((item) => item.type === "location"));
  } finally { seedDb.close(); }
});

function upgradeFixture(name) {
  const fixtureDir = join(dir, name);
  const env = { ...process.env, SITE_DATA_DIR: fixtureDir };
  const created = spawnSync(process.execPath, ["--input-type=module", "-e", `const auth=await import('./src/lib/local-auth-core.server.ts'); await auth.createUser('admin@upgrade.test','Senha-Temporaria-123',['admin']); await auth.createUser('comercial@upgrade.test','Senha-Temporaria-123',['comercial']); const db=await import('./src/lib/local-db.server.ts'); db.closeDb();`], { env, encoding: "utf8", timeout: 15000 });
  assert.equal(created.status, 0, created.stderr);
  const seed = spawnSync(process.execPath, ["scripts/seed-links.mjs", "--actor", "admin@upgrade.test"], { env, encoding: "utf8", timeout: 15000 });
  assert.equal(seed.status, 0, seed.stderr);
  const fixtureDb = new DatabaseSync(join(fixtureDir, "site.sqlite"));
  const adminId = String(fixtureDb.prepare("SELECT id FROM users WHERE email='admin@upgrade.test'").get().id);
  const comercialId = String(fixtureDb.prepare("SELECT id FROM users WHERE email='comercial@upgrade.test'").get().id);
  const cli = (actor = adminId) => spawnSync(process.execPath, ["scripts/upgrade-links-units.mjs", "--actor", actor], { env, encoding: "utf8", timeout: 15000 });
  return { fixtureDb, cli, adminId, comercialId };
}

test("real unit upgrade CLI preserves v1 and existing fields, publishes Centro with landline and monthly themes once", () => {
  const { fixtureDb, cli, comercialId } = upgradeFixture("upgrade-units-cli");
  try {
    const v1Row = fixtureDb.prepare("SELECT * FROM link_tree_publications WHERE version=1").get();
    const v1 = shared.linkTreeContentSchema.parse(JSON.parse(v1Row.content));
    assert.equal(Number(fixtureDb.prepare("SELECT revision FROM link_tree_draft").get().revision), 1);
    assert.equal(cli(comercialId).status, 1);
    assert.equal(Number(fixtureDb.prepare("SELECT count(*) AS n FROM link_tree_publications").get().n), 1);
    const result = cli();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /versão 2/);
    const rows = fixtureDb.prepare("SELECT * FROM link_tree_publications ORDER BY version").all();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], v1Row);
    const upgraded = shared.linkTreeContentSchema.parse(JSON.parse(rows[1].content));
    const locations = upgraded.items.filter((item) => item.type === "location");
    assert.equal(locations.length, 2);
    const centro = locations.find((item) => item.title === "Unidade Centro");
    const br = locations.find((item) => item.title === "Unidade BR-116");
    assert.ok(centro && br);
    assert.equal(centro.address, "Av. Dom Manuel, 1180 - Centro, Fortaleza - CE, CEP 60060-091");
    assert.equal(centro.landline, "558531220506");
    assert.equal(shared.telephoneLink(centro.landline), "tel:+558531220506");
    assert.equal(centro.phone, "");
    assert.equal(centro.accent, "ocean");
    assert.equal(centro.active, true);
    assert.equal(centro.position, br.position + 1);
    assert.equal(upgraded.items.filter((item) => item.type === "seller").length, 0);
    assert.equal(upgraded.background.mode, "monthly");
    for (const key of ["title", "subtitle", "logo", "cover", "theme"]) assert.deepEqual(upgraded[key], v1[key]);
    assert.deepEqual({ ...upgraded.background, mode: v1.background.mode }, v1.background);
    const oldBr = v1.items.find((item) => item.type === "location");
    for (const oldItem of v1.items) {
      const newItem = upgraded.items.find((item) => item.id === oldItem.id);
      assert.ok(newItem, `Existing item ${oldItem.id} must remain`);
      const expected = { ...oldItem, position: oldItem.position > oldBr.position ? oldItem.position + 1 : oldItem.position };
      if (oldItem.id === oldBr.id) { expected.title = "Unidade BR-116"; expected.accent = "burgundy"; }
      assert.deepEqual(newItem, expected);
    }
    const draftAfter = fixtureDb.prepare("SELECT * FROM link_tree_draft").get();
    assert.equal(Number(draftAfter.revision), 2);
    assert.deepEqual(JSON.parse(draftAfter.content), JSON.parse(rows[1].content));
    const again = cli();
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /Nenhuma alteração/);
    assert.deepEqual(fixtureDb.prepare("SELECT * FROM link_tree_publications ORDER BY version").all(), rows);
    assert.deepEqual(fixtureDb.prepare("SELECT * FROM link_tree_draft").get(), draftAfter);
  } finally { fixtureDb.close(); }
});

test("real unit upgrade CLI refuses a changed or divergent draft and leaves publication and draft untouched", () => {
  const { fixtureDb, cli } = upgradeFixture("upgrade-conflict-cli");
  try {
    const published = fixtureDb.prepare("SELECT * FROM link_tree_publications").all();
    const original = fixtureDb.prepare("SELECT * FROM link_tree_draft").get();
    const changed = JSON.parse(original.content); changed.subtitle = "Edição administrativa ainda não publicada";
    fixtureDb.prepare("UPDATE link_tree_draft SET revision=2,content=? WHERE id=1").run(JSON.stringify(changed));
    const editedDraft = fixtureDb.prepare("SELECT * FROM link_tree_draft").get();
    const result = cli();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /conteúdo mudou|preservar as edições/);
    assert.deepEqual(fixtureDb.prepare("SELECT * FROM link_tree_publications").all(), published);
    assert.deepEqual(fixtureDb.prepare("SELECT * FROM link_tree_draft").get(), editedDraft);
    fixtureDb.prepare("UPDATE link_tree_draft SET revision=1 WHERE id=1").run();
    const divergentDraft = fixtureDb.prepare("SELECT * FROM link_tree_draft").get();
    const divergent = cli();
    assert.equal(divergent.status, 1);
    assert.match(divergent.stderr, /rascunho diferente/);
    assert.deepEqual(fixtureDb.prepare("SELECT * FROM link_tree_publications").all(), published);
    assert.deepEqual(fixtureDb.prepare("SELECT * FROM link_tree_draft").get(), divergentDraft);
  } finally { fixtureDb.close(); }
});

test("draft edits stay private, hidden items never appear, and published snapshots are immutable", () => {
  const initial = links.readPublicLinkTree();
  const changed = content("Página nova");
  changed.items.push({ ...shared.newLinkTreeItem("seller"), title: "Vendedor ainda não aprovado", phone: "5585999990000", active: false, position: 1 });
  save(changed);
  assert.deepEqual(links.readPublicLinkTree(), initial);
  const version = publish().version;
  const published = links.readPublicLinkTree();
  assert.equal(published.version, version);
  assert.equal(published.content.items.length, 1);
  assert.ok(!JSON.stringify(published).includes("Vendedor ainda não aprovado"));
  assert.ok(!JSON.stringify(published).includes(admin.email));
  const publication = links.readLinkTreeAdmin(admin).publications[0];
  assert.throws(() => db.getDb().prepare("UPDATE link_tree_publications SET content='{}' WHERE id=?").run(publication.id), /imutáveis/);
  assert.throws(() => db.getDb().prepare("DELETE FROM link_tree_publications WHERE id=?").run(publication.id), /imutáveis/);
  save(content("Outro rascunho"));
  assert.deepEqual(links.readPublicLinkTree(), published);
});

test("optimistic revision prevents save, restore and publish from stale tabs", () => {
  const before = draft();
  save(content("Atualizado por outra aba"));
  const current = draft();
  const publication = links.readLinkTreeAdmin(admin).publications[0];
  assert.throws(() => links.saveLinkTreeDraftCore(admin, before.revision, content("Obsoleto")), /outra aba/);
  assert.throws(() => links.publishLinkTreeCore(admin, before.revision), /outra aba/);
  assert.throws(() => links.restoreLinkTreeCore(admin, before.revision, publication.id), /outra aba/);
  assert.deepEqual(draft(), current);
});

test("restoration copies an earlier snapshot into draft, requiring an explicit new publication", () => {
  const before = links.readPublicLinkTree();
  const oldest = links.readLinkTreeAdmin(admin).publications.at(-1);
  const result = links.restoreLinkTreeCore(admin, draft().revision, oldest.id);
  assert.equal(result.revision, draft().revision);
  assert.equal(draft().content.title, "MAG de teste");
  assert.deepEqual(links.readPublicLinkTree(), before);
  assert.ok(publish().version > before.version);
  assert.equal(links.readPublicLinkTree().content.title, "MAG de teste");
});

test("audit failure rolls back both draft changes and publication insertion", () => {
  const before = draft();
  const publicBefore = links.readPublicLinkTree();
  const countBefore = links.readLinkTreeAdmin(admin).publications.length;
  db.getDb().exec(`CREATE TRIGGER links_test_audit_failure BEFORE INSERT ON audit_log
    WHEN NEW.action IN ('links:draft:save','links:publish') BEGIN SELECT RAISE(ABORT,'audit indisponível'); END;`);
  try {
    assert.throws(() => save(content("Falha de gravação")), /audit indisponível/);
    assert.deepEqual(draft(), before);
    assert.throws(() => publish(), /audit indisponível/);
    assert.equal(links.readLinkTreeAdmin(admin).publications.length, countBefore);
    assert.deepEqual(links.readPublicLinkTree(), publicBefore);
  } finally { db.getDb().exec("DROP TRIGGER links_test_audit_failure"); }
});

test("URL and text validation reject executable destinations, unsafe maps, HTML and duplicate ids", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,test", "http://example.com", "//evil.example", "/\\evil.example", "/%2f%2fevil.example", "https://user:pass@example.com", "https://example.com/%0d%0aevil", "https://example.com/\nhi"]) assert.equal(shared.isSafeLink(url), false, url);
  for (const url of ["/produtos?q=mesa", "/", "https://instagram.com/magmoveiscorporativos"]) assert.equal(shared.isSafeLink(url), true, url);
  const html = content(); html.items[0].title = "<img src=x onerror=alert(1)>";
  assert.throws(() => save(html), /HTML/);
  const unsafeMap = content(); unsafeMap.items[0].mapUrl = "https://evil.example/maps";
  assert.throws(() => save(unsafeMap), /Google Maps/);
  const duplicate = content(); duplicate.items.push({ ...duplicate.items[0] });
  assert.throws(() => save(duplicate), /identificadores diferentes/);
  const image = content(); image.cover = `/link-images/${crypto.randomUUID()}.webp`;
  assert.throws(() => save(image), /imagem|imagens/);
  const remoteImage = content(); remoteImage.logo = "https://evil.example/logo.png";
  assert.throws(() => save(remoteImage), /Envie a imagem/);
  assert.equal(shared.whatsappLink("+55 (85) 99861-0074", "Olá!"), "https://wa.me/5585998610074?text=Ol%C3%A1!");
  assert.equal(shared.locationMapLink({ mapUrl: "", address: "Rua A, 10" }), "https://www.google.com/maps/search/?api=1&query=Rua%20A%2C%2010");
});

test("monthly backgrounds use twelve validated presets and the Fortaleza calendar at UTC boundaries", () => {
  assert.equal(shared.BACKGROUND_MONTHS.length, 12);
  assert.equal(shared.BACKGROUND_MONTHS[0], "Janeiro");
  assert.equal(shared.BACKGROUND_MONTHS[11], "Dezembro");
  assert.equal(shared.currentLinkMonth(new Date("2026-11-01T02:59:59.999Z")), 10);
  assert.equal(shared.currentLinkMonth(new Date("2026-11-01T03:00:00.000Z")), 11);
  assert.equal(shared.currentLinkMonth(new Date("2027-01-01T02:59:59.999Z")), 12);
  assert.equal(shared.currentLinkMonth(new Date("2027-01-01T03:00:00.000Z")), 1);
  const data = content();
  data.background.mode = "monthly";
  for (let month = 1; month <= 12; month++) assert.equal(shared.resolveLinkBackground(data, month), ["summer", "carnival", "women", "autumn", "work", "june", "winter", "fathers", "spring", "pink", "blue", "christmas"][month - 1]);
  data.background.monthlyPresets[9] = "brand";
  assert.equal(shared.resolveLinkBackground(data, 10), "brand");
  data.background.mode = "fixed"; data.background.preset = "spring";
  assert.equal(shared.resolveLinkBackground(data, 10), "spring");
  data.background.mode = "image";
  assert.equal(shared.resolveLinkBackground(data, 1), "spring");
  for (const month of [0, 13, 1.5, NaN]) assert.throws(() => shared.resolveLinkBackground(data, month), RangeError);
  const first = shared.defaultLinkBackground(); const second = shared.defaultLinkBackground();
  first.monthlyPresets[0] = "brand";
  assert.equal(second.monthlyPresets[0], "summer");
  for (const monthlyPresets of [Array(11).fill("brand"), Array(13).fill("brand"), [...Array(11).fill("brand"), "not-a-theme"]]) {
    const invalid = content(); invalid.background.monthlyPresets = monthlyPresets;
    assert.equal(shared.linkTreeContentSchema.safeParse(invalid).success, false);
  }
  const unregistered = content(); unregistered.background.image = `/link-images/${crypto.randomUUID()}.webp`;
  assert.throws(() => save(unregistered), /imagem|imagens/);
  for (const image of ["https://example.com/background.webp", "javascript:alert(1)", "/images/arbitrary.png"]) {
    const invalid = content(); invalid.background.image = image;
    assert.equal(shared.linkTreeContentSchema.safeParse(invalid).success, false);
  }
});

test("seller branches require real locations and active sellers cannot reference a hidden branch", () => {
  const data = content("Unidades e equipe");
  const location = { ...shared.newLinkTreeItem("location"), title: "Unidade Teste", address: "Rua de teste, 10", hours: "Segunda a sexta, 8h às 18h", active: true, accent: "ocean", position: 1 };
  const seller = { ...shared.newLinkTreeItem("seller"), title: "Consultora de teste", phone: "5585999990000", locationId: location.id, active: true, position: 2 };
  data.items.push(location, seller);
  const before = draft();
  for (const locationId of [crypto.randomUUID(), data.items[0].id, seller.id]) {
    seller.locationId = locationId;
    assert.throws(() => save(data), /unidade cadastrada/);
    assert.deepEqual(draft(), before);
  }
  seller.locationId = location.id; location.active = false;
  assert.throws(() => save(data), /unidade ativa/);
  seller.active = false;
  assert.doesNotThrow(() => shared.linkTreeContentSchema.parse(data));
  location.active = true; seller.active = true;
  for (const actor of [comercial, dho]) assert.throws(() => links.saveLinkTreeDraftCore(actor, before.revision, data), /Forbidden/);
  save(data); publish();
  const published = links.readPublicLinkTree();
  assert.equal(published.content.items.find((item) => item.type === "seller").locationId, location.id);
  const publicLocation = published.content.items.find((item) => item.type === "location");
  assert.equal(publicLocation.accent, "ocean");
  assert.equal(publicLocation.hours, "Segunda a sexta, 8h às 18h");
  const oldSnapshot = structuredClone(published);
  location.hours = "Atendimento com agendamento";
  data.background.mode = "monthly"; data.background.monthlyPresets[9] = "pink";
  save(data);
  assert.deepEqual(links.readPublicLinkTree(), oldSnapshot);
  seller.locationId = null; location.active = false;
  assert.doesNotThrow(() => shared.linkTreeContentSchema.parse(data));
  location.hours = "x".repeat(121);
  assert.equal(shared.linkTreeContentSchema.safeParse(data).success, false);
  location.hours = ""; location.accent = "javascript:alert(1)";
  assert.equal(shared.linkTreeContentSchema.safeParse(data).success, false);
});

test("legacy draft and publication snapshots get defaults at read time without rewriting immutable history", () => {
  const legacy = content("Snapshot legado");
  delete legacy.background;
  for (const item of legacy.items) { delete item.locationId; delete item.accent; delete item.hours; delete item.landline; }
  const originalJson = JSON.stringify(legacy);
  const id = crypto.randomUUID();
  const version = Number(db.getDb().prepare("SELECT MAX(version)+1 AS version FROM link_tree_publications").get().version);
  db.getDb().prepare("INSERT INTO link_tree_publications(id,version,content,published_at,published_by) VALUES (?,?,?,?,?)").run(id, version, originalJson, new Date().toISOString(), admin.id);
  const publicData = links.readPublicLinkTree();
  assert.deepEqual(publicData.content.background, shared.defaultLinkBackground());
  assert.equal(publicData.content.items[0].locationId, null);
  assert.equal(publicData.content.items[0].accent, "burgundy");
  assert.equal(publicData.content.items[0].hours, "");
  assert.equal(publicData.content.items[0].landline, "");
  links.restoreLinkTreeCore(admin, draft().revision, id);
  assert.deepEqual(draft().content, publicData.content);
  assert.equal(db.getDb().prepare("SELECT content FROM link_tree_publications WHERE id=?").get(id).content, originalJson);
  publish();
  assert.ok(links.readPublicLinkTree().version > version);
  assert.equal(db.getDb().prepare("SELECT content FROM link_tree_publications WHERE id=?").get(id).content, originalJson);
});

test("landline is an independent optional dialable number and preserves the WhatsApp destination", () => {
  const data = content();
  const location = { ...shared.newLinkTreeItem("location"), title: "Centro", address: "Av. Dom Manuel, 1180, Centro, CEP 60060-091", phone: "5585998610074", landline: "(85) 3122-0506", active: true };
  data.items.push(location);
  const normalized = shared.linkTreeContentSchema.parse(data).items[1];
  assert.equal(normalized.landline, "8531220506");
  assert.equal(normalized.phone, "5585998610074");
  assert.equal(shared.telephoneLink(normalized.landline), "tel:+558531220506");
  assert.equal(shared.telephoneLink("+55 (85) 3122-0506"), "tel:+558531220506");
  assert.equal(shared.whatsappLink(normalized.phone), "https://wa.me/5585998610074");
  for (const landline of ["12345", "not a phone", "+0000000000", "javascript:alert(1)", "1".repeat(16)]) {
    location.landline = landline;
    assert.equal(shared.linkTreeContentSchema.safeParse(data).success, false);
    assert.equal(shared.telephoneLink(landline), "");
  }
  location.landline = "";
  assert.doesNotThrow(() => shared.linkTreeContentSchema.parse(data));
  assert.equal(shared.telephoneLink(""), "");
});

test("background uploads follow the same private draft, publication and replacement rules as seller photos", async () => {
  const bytes = await sharp({ create: { width: 20, height: 30, channels: 3, background: "#aaeedd" } }).png().toBuffer();
  const uploaded = await links.uploadLinkImageCore(admin, bytes.toString("base64"));
  const file = uploaded.image.split("/").at(-1);
  const data = content("Fundo personalizado");
  data.background = { ...shared.defaultLinkBackground(), mode: "image", image: uploaded.image, overlay: "dark" };
  const previousPublic = links.readPublicLinkTree();
  save(data);
  assert.deepEqual(links.readPublicLinkTree(), previousPublic);
  assert.equal(links.readPublicLinkImage(file), null);
  for (const actor of [comercial, dho]) assert.throws(() => links.readAdminLinkImage(actor, file), /Forbidden/);
  assert.ok(links.readAdminLinkImage(admin, file));
  publish();
  assert.ok(links.readPublicLinkImage(file));
  assert.equal(links.readPublicLinkTree().content.background.overlay, "dark");
  data.background = shared.defaultLinkBackground();
  save(data);
  assert.ok(links.readPublicLinkImage(file));
  publish();
  assert.equal(links.readPublicLinkImage(file), null);
  assert.ok(links.readAdminLinkImage(admin, file));
});

test("remembered background images stay private in fixed and monthly modes and can be restored without rewriting history", async () => {
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#91ba75" } }).png().toBuffer();
  const uploaded = await links.uploadLinkImageCore(admin, bytes.toString("base64"));
  const file = uploaded.image.split("/").at(-1);
  const data = content("Foto de fundo lembrada");
  data.background = { ...shared.defaultLinkBackground(), mode: "image", image: uploaded.image };
  save(data); publish();
  const imagePublication = links.readLinkTreeAdmin(admin).publications[0];
  const originalImageSnapshot = db.getDb().prepare("SELECT content FROM link_tree_publications WHERE id=?").get(imagePublication.id).content;
  assert.ok(links.readPublicLinkImage(file));
  for (const mode of ["fixed", "monthly"]) {
    data.background.mode = mode;
    save(data);
    assert.ok(links.readPublicLinkImage(file));
    publish();
    const hiddenPublication = links.readLinkTreeAdmin(admin).publications[0];
    const hiddenSnapshot = db.getDb().prepare("SELECT content FROM link_tree_publications WHERE id=?").get(hiddenPublication.id).content;
    assert.equal(JSON.parse(hiddenSnapshot).background.image, uploaded.image);
    assert.equal(draft().content.background.image, uploaded.image);
    const publicData = links.readPublicLinkTree();
    assert.equal(publicData.content.background.mode, mode);
    assert.equal(publicData.content.background.image, null);
    assert.ok(!JSON.stringify(publicData).includes(uploaded.image));
    assert.equal(links.readPublicLinkImage(file), null);
    assert.ok(links.readAdminLinkImage(admin, file));
    links.restoreLinkTreeCore(admin, draft().revision, imagePublication.id);
    assert.equal(draft().content.background.mode, "image");
    assert.equal(draft().content.background.image, uploaded.image);
    assert.equal(links.readPublicLinkImage(file), null);
    publish();
    assert.equal(links.readPublicLinkTree().content.background.image, uploaded.image);
    assert.ok(links.readPublicLinkImage(file));
    assert.equal(db.getDb().prepare("SELECT content FROM link_tree_publications WHERE id=?").get(hiddenPublication.id).content, hiddenSnapshot);
    assert.equal(db.getDb().prepare("SELECT content FROM link_tree_publications WHERE id=?").get(imagePublication.id).content, originalImageSnapshot);
  }
  data.background.mode = "fixed"; data.cover = uploaded.image;
  save(data); publish();
  assert.equal(links.readPublicLinkTree().content.background.image, null);
  assert.equal(links.readPublicLinkTree().content.cover, uploaded.image);
  assert.ok(links.readPublicLinkImage(file));
});

test("uploads decode images, remove metadata, resize and only become public with an active published reference", async () => {
  const original = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: "#deefb1" } }).withMetadata({ exif: { IFD0: { Artist: "Private test EXIF" } } }).jpeg().toBuffer();
  const uploaded = await links.uploadLinkImageCore(admin, original.toString("base64"));
  const file = uploaded.image.split("/").at(-1);
  assert.equal(links.readPublicLinkImage(file), null);
  const bytes = links.readAdminLinkImage(admin, file);
  assert.ok(bytes);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, "webp");
  assert.ok(metadata.width <= 1600 && metadata.height <= 1600);
  assert.equal(metadata.exif, undefined);
  const data = content("Imagem privada"); data.items[0].image = uploaded.image;
  save(data);
  assert.equal(links.readPublicLinkImage(file), null);
  publish();
  assert.deepEqual(links.readPublicLinkImage(file), bytes);
  data.items[0].active = false;
  data.items.push({ ...shared.newLinkTreeItem("link"), title: "Site", url: "/", active: true, position: 1 });
  save(data); publish();
  assert.equal(links.readPublicLinkImage(file), null);
  assert.ok(!JSON.stringify(links.readPublicLinkTree()).includes(uploaded.image));
  assert.ok(links.readAdminLinkImage(admin, file));
  assert.equal(shared.imageUrl(uploaded.image, true), uploaded.previewUrl);
  assert.equal(links.readPublicLinkImage("../site.sqlite"), null);
  assert.equal(links.readAdminLinkImage(admin, "../site.sqlite"), null);
  const stored = await readFile(join(dir, "link-uploads", file));
  assert.deepEqual(stored, bytes);
});

test("invalid images, oversized bytes and SVG are rejected without registering files", async () => {
  const count = () => Number(db.getDb().prepare("SELECT COUNT(*) AS n FROM link_tree_images").get().n);
  const before = count();
  for (const input of ["not base64!", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>").toString("base64"), Buffer.from([0xff, 0xd8, 0xff, 0]).toString("base64"), Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64")]) {
    await assert.rejects(() => links.uploadLinkImageCore(admin, input), /imagem|Imagem|MB|JPG/);
  }
  assert.equal(count(), before);
});

test("revoked administrator privileges take effect even for an actor object from an existing session", () => {
  db.getDb().prepare("UPDATE users SET roles='[\"comercial\"]' WHERE id=?").run(admin.id);
  try { assert.throws(() => links.readLinkTreeAdmin(admin), /Forbidden/); }
  finally { db.getDb().prepare("UPDATE users SET roles='[\"admin\"]' WHERE id=?").run(admin.id); }
});
