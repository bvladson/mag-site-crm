// Own temporary SQLite/media only: no production data or external network.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";

const directory = await mkdtemp(join(tmpdir(), "mag-site-content-"));
process.env.SITE_DATA_DIR = directory;
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const cms = await import("../src/lib/site-content.server.ts");
const shared = await import("../src/lib/site-content.ts");
const user = async (email, roles) => ({ id: (await auth.createUser(email, "Temporaria-Teste-123", roles)).id, email, roles, created_at: "" });
const admin = await user("admin@site-content.test", ["admin"]);
const commercial = await user("comercial@site-content.test", ["comercial"]);
const dho = await user("dho@site-content.test", ["dho"]);
const draft = () => cms.readSiteContentAdmin(admin).draft;
const save = (content) => cms.saveSiteContentDraftCore(admin, draft().revision, content);
const publish = () => cms.publishSiteContentCore(admin, draft().revision);
const content = (name = "MAG de teste") => ({ ...shared.defaultSiteContent(), general: { ...shared.defaultSiteContent().general, name } });
const fileOf = (reference) => reference.split("/").at(-1);
const upload = async (color = "#981b28") => cms.uploadSiteImageCore(admin, (await sharp({ create: { width: 40, height: 20, channels: 3, background: color } }).png().toBuffer()).toString("base64"));
test.after(async () => { db.closeDb(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

test("new CMS has original defaults publicly; editor operations require current administrator privileges", async () => {
  assert.deepEqual(cms.readPublicSiteContent(), { version: null, publishedAt: null, content: shared.defaultSiteContent() });
  assert.equal(draft().revision, 0);
  const before = draft();
  for (const actor of [null, commercial, dho, { ...commercial, roles: ["admin"] }]) {
    for (const call of [
      () => cms.readSiteContentAdmin(actor),
      () => cms.saveSiteContentDraftCore(actor, before.revision, content()),
      () => cms.publishSiteContentCore(actor, before.revision),
      () => cms.restoreSiteContentCore(actor, before.revision, crypto.randomUUID()),
      () => cms.readAdminSiteImage(actor, `${crypto.randomUUID()}.webp`),
    ]) assert.throws(call, /Unauthorized|Forbidden/);
    await assert.rejects(() => cms.uploadSiteImageCore(actor, "AAAA"), /Unauthorized|Forbidden/);
  }
  assert.deepEqual(draft(), before);
});

test("draft changes never reach visitors; publication contains no editor identity and history cannot be changed", () => {
  const before = cms.readPublicSiteContent();
  save(content("Rascunho privado"));
  assert.deepEqual(cms.readPublicSiteContent(), before);
  assert.equal(publish().version, 1);
  const published = cms.readPublicSiteContent();
  assert.equal(published.content.general.name, "Rascunho privado");
  assert.ok(!JSON.stringify(published).includes(admin.email));
  assert.ok(!JSON.stringify(published).includes(admin.id));
  const snapshot = cms.readSiteContentAdmin(admin).publications[0];
  assert.throws(() => db.getDb().prepare("UPDATE site_content_publications SET content='{}' WHERE id=?").run(snapshot.id), /imutáveis/);
  assert.throws(() => db.getDb().prepare("DELETE FROM site_content_publications WHERE id=?").run(snapshot.id), /imutáveis/);
  save(content("Outro rascunho"));
  assert.deepEqual(cms.readPublicSiteContent(), published);
});

test("stale revisions cannot save, publish or restore; restoration only creates a new draft", () => {
  const stale = draft();
  save(content("Outra aba"));
  const current = draft();
  const snapshot = cms.readSiteContentAdmin(admin).publications[0];
  assert.throws(() => cms.saveSiteContentDraftCore(admin, stale.revision, content()), /outra aba/);
  assert.throws(() => cms.publishSiteContentCore(admin, stale.revision), /outra aba/);
  assert.throws(() => cms.restoreSiteContentCore(admin, stale.revision, snapshot.id), /outra aba/);
  assert.deepEqual(draft(), current);
  const publicBefore = cms.readPublicSiteContent();
  const historyBefore = db.getDb().prepare("SELECT * FROM site_content_publications ORDER BY version").all();
  const restored = cms.restoreSiteContentCore(admin, current.revision, snapshot.id);
  assert.equal(restored.revision, current.revision + 1);
  assert.equal(draft().content.general.name, publicBefore.content.general.name);
  assert.deepEqual(cms.readPublicSiteContent(), publicBefore);
  assert.deepEqual(db.getDb().prepare("SELECT * FROM site_content_publications ORDER BY version").all(), historyBefore);
  assert.ok(publish().version > publicBefore.version);
  const newVersion = cms.readPublicSiteContent();
  assert.deepEqual(newVersion.content, publicBefore.content);
});

test("audit failures roll back draft, publish, restore and uploaded media atomically", async () => {
  const before = draft();
  const published = cms.readPublicSiteContent();
  const historyBefore = cms.readSiteContentAdmin(admin).publications;
  const imagesBefore = Number(db.getDb().prepare("SELECT count(*) n FROM site_content_images").get().n);
  const filesBefore = await readdir(join(directory, "site-uploads")).catch(() => []);
  db.getDb().exec(`CREATE TRIGGER cms_test_audit_failure BEFORE INSERT ON audit_log
    WHEN NEW.action LIKE 'site-content:%' BEGIN SELECT RAISE(ABORT,'audit indisponível'); END;`);
  try {
    assert.throws(() => save(content("Não gravar")), /audit indisponível/);
    assert.throws(() => publish(), /audit indisponível/);
    assert.throws(() => cms.restoreSiteContentCore(admin, before.revision, historyBefore[0].id), /audit indisponível/);
    await assert.rejects(upload(), /audit indisponível/);
    assert.deepEqual(draft(), before);
    assert.deepEqual(cms.readPublicSiteContent(), published);
    assert.deepEqual(cms.readSiteContentAdmin(admin).publications, historyBefore);
    assert.equal(Number(db.getDb().prepare("SELECT count(*) n FROM site_content_images").get().n), imagesBefore);
    assert.deepEqual(await readdir(join(directory, "site-uploads")), filesBefore);
  } finally { db.getDb().exec("DROP TRIGGER cms_test_audit_failure"); }
});

test("server schemas constrain destinations and layout; invalid content cannot modify the draft", () => {
  const before = draft();
  const invalid = [];
  for (const href of ["javascript:alert(1)", "data:text/html,test", "//evil.example", "https://user:password@example.test", "/interno", "/api/private", "/site-preview/secret", "/foo\\bar", "/foo%0abar", "http://example.test"]) {
    const document = content(); document.home.hero.primaryHref = href; invalid.push(document);
  }
  const arbitraryStyle = content(); arbitraryStyle.appearance.brandColor = "url(https://example.test)"; invalid.push(arbitraryStyle);
  const arbitraryLayout = content(); arbitraryLayout.home.hero.layout = "custom-html"; invalid.push(arbitraryLayout);
  const extra = content(); extra.customCss = "body{display:none}"; invalid.push(extra);
  const repeated = content(); repeated.home.sections[1] = repeated.home.sections[0]; invalid.push(repeated);
  const unknownImage = content(); unknownImage.general.logo = "https://example.test/logo.svg"; invalid.push(unknownImage);
  for (const document of invalid) assert.throws(() => save(document));
  assert.deepEqual(draft(), before);
});

test("all image references including disabled sections must be registered and present; missing images block publication", async () => {
  const unknown = content(); unknown.home.sections[0].enabled = false; unknown.home.sections[0].image = `/site-images/${crypto.randomUUID()}.webp`;
  const before = draft(); assert.throws(() => save(unknown), /não está cadastrada/); assert.deepEqual(draft(), before);
  const image = await upload(); const document = content(); document.home.hero.desktopImage = image.image;
  save(document);
  await unlink(join(directory, "site-uploads", fileOf(image.image)));
  const publicBefore = cms.readPublicSiteContent();
  assert.throws(() => publish(), /não está disponível/);
  assert.deepEqual(cms.readPublicSiteContent(), publicBefore);
  save(content());
});

test("uploads strip metadata, preserve aspect ratio, bound dimensions to 2400, and remain private until publication", async () => {
  const input = await sharp({ create: { width: 4800, height: 1800, channels: 3, background: "#deefb1" } }).withMetadata({ exif: { IFD0: { Artist: "Private QA metadata" } } }).jpeg().toBuffer();
  const image = await cms.uploadSiteImageCore(admin, input.toString("base64"));
  const file = fileOf(image.image);
  assert.equal(cms.readPublicSiteImage(file), null);
  const bytes = cms.readAdminSiteImage(admin, file); const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, "webp"); assert.equal(metadata.width, 2400); assert.equal(metadata.height, 900); assert.equal(metadata.exif, undefined);
  assert.deepEqual(await readFile(join(directory, "site-uploads", file)), bytes);
  assert.equal(shared.siteImageUrl(image.image, true), image.previewUrl);
  const document = content(); document.home.hero.desktopImage = image.image;
  save(document); assert.equal(cms.readPublicSiteImage(file), null); publish();
  assert.deepEqual(cms.readPublicSiteImage(file), bytes);
  save(content()); publish(); assert.equal(cms.readPublicSiteImage(file), null); assert.ok(cms.readAdminSiteImage(admin, file));
  assert.equal(cms.readPublicSiteImage("../site.sqlite"), null); assert.equal(cms.readAdminSiteImage(admin, "../site.sqlite"), null);
  const small = await upload(); const smallMeta = await sharp(cms.readAdminSiteImage(admin, fileOf(small.image))).metadata();
  assert.equal(smallMeta.width, 40); assert.equal(smallMeta.height, 20);
});

test("hidden blocks and out-of-schedule campaign desktop/mobile media never appear in public document or image endpoint", async () => {
  const hidden = await upload("#111111"); const desktop = await upload("#222222"); const mobile = await upload("#333333");
  const document = content();
  document.home.sections[0].enabled = false; document.home.sections[0].title = "Título ainda privado"; document.home.sections[0].image = hidden.image;
  const stats = document.home.sections.find(s => s.id === "stats");stats.enabled = false;stats.image = hidden.image;
  document.home.stats = [{ label: "Número privado", value: "1234" }];
  document.announcement = { enabled: false, text: "Aviso privado", href: "/contato", label: "Privado" };
  document.home.banners = [{ ...shared.newSiteBanner(), enabled: true, title: "Campanha agendada", image: desktop.image, mobileImage: mobile.image, startsAt: "2030-11-01T09:00", endsAt: "2030-11-01T10:00" }];
  save(document); publish();
  const before = new Date("2030-11-01T11:59:59Z"), during = new Date("2030-11-01T12:00:00Z"), after = new Date("2030-11-01T13:00:00Z");
  for (const at of [before, after]) {
    const visible = cms.readPublicSiteContent(at).content;
    assert.equal(visible.home.banners.length, 0);
    assert.ok(!JSON.stringify(visible).includes(desktop.image)); assert.ok(!JSON.stringify(visible).includes(mobile.image));
    assert.equal(cms.readPublicSiteImage(fileOf(desktop.image), at), null); assert.equal(cms.readPublicSiteImage(fileOf(mobile.image), at), null);
  }
  const visible = cms.readPublicSiteContent(during).content;
  assert.ok(!JSON.stringify(visible).includes("Título ainda privado")); assert.ok(!JSON.stringify(visible).includes(hidden.image));
  assert.deepEqual(visible.home.stats, []); assert.deepEqual(visible.announcement, { enabled: false, text: "", href: "", label: "" });
  assert.equal(cms.readPublicSiteImage(fileOf(hidden.image), during), null);
  assert.equal(visible.home.banners.length, 1);assert.ok(cms.readPublicSiteImage(fileOf(desktop.image), during)); assert.ok(cms.readPublicSiteImage(fileOf(mobile.image), during));
  document.home.sections.find(s => s.id === "banners").enabled = false;
  save(document); publish();
  assert.equal(cms.readPublicSiteContent(during).content.home.banners.length, 0);
  assert.equal(cms.readPublicSiteImage(fileOf(desktop.image), during), null); assert.equal(cms.readPublicSiteImage(fileOf(mobile.image), during), null);
  assert.ok(cms.readAdminSiteImage(admin, fileOf(hidden.image)));
});

test("malformed images, SVG, animation, excessive bytes and pixel count never register files", async () => {
  const count = () => Number(db.getDb().prepare("SELECT count(*) n FROM site_content_images").get().n);
  const before = count(); const filesBefore = await readdir(join(directory, "site-uploads"));
  const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
  const hugePixels = await sharp({ create: { width: 6100, height: 6100, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  const animatedWebp = await sharp(Buffer.from([255, 0, 0, 0, 0, 255]), { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(animatedWebp).metadata()).pages, 2);
  for (const input of ["not base64!", svg.toString("base64"), Buffer.from([0xff, 0xd8, 0xff, 0]).toString("base64"), Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"), hugePixels.toString("base64"), gif.toString("base64"), animatedWebp.toString("base64")])
    await assert.rejects(() => cms.uploadSiteImageCore(admin, input));
  assert.equal(count(), before); assert.deepEqual(await readdir(join(directory, "site-uploads")), filesBefore);
});

test("disabled and revoked admins are rejected; revocation while decoding prevents registering or leaving files", async () => {
  const before = draft();
  for (const update of ["UPDATE users SET roles='[\"comercial\"]' WHERE id=?", "UPDATE users SET disabled=1 WHERE id=?"]) {
    db.getDb().prepare(update).run(admin.id);
    try {
      assert.throws(() => cms.readSiteContentAdmin(admin), /Forbidden|Unauthorized/);
      assert.throws(() => cms.saveSiteContentDraftCore(admin, before.revision, content()), /Forbidden|Unauthorized/);
      assert.throws(() => cms.publishSiteContentCore(admin, before.revision), /Forbidden|Unauthorized/);
      assert.throws(() => cms.readAdminSiteImage(admin, `${crypto.randomUUID()}.webp`), /Forbidden|Unauthorized/);
      await assert.rejects(() => upload(), /Forbidden|Unauthorized/);
    } finally { db.getDb().prepare("UPDATE users SET disabled=0,roles='[\"admin\"]' WHERE id=?").run(admin.id); }
  }
  const bytes = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#123456" } }).png().toBuffer();
  const filesBefore = await readdir(join(directory, "site-uploads"));
  const imagesBefore = Number(db.getDb().prepare("SELECT count(*) n FROM site_content_images").get().n);
  const inFlight = cms.uploadSiteImageCore(admin, bytes.toString("base64"));
  db.getDb().prepare("UPDATE users SET roles='[\"comercial\"]' WHERE id=?").run(admin.id);
  try { await assert.rejects(inFlight, /Forbidden/); }
  finally { db.getDb().prepare("UPDATE users SET roles='[\"admin\"]' WHERE id=?").run(admin.id); }
  assert.equal(Number(db.getDb().prepare("SELECT count(*) n FROM site_content_images").get().n), imagesBefore);
  assert.deepEqual(await readdir(join(directory, "site-uploads")), filesBefore);
  assert.deepEqual(draft(), before);
});
