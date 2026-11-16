// Isolated SQLite fixture; no production data, credentials or connector calls.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const directory = await mkdtemp(join(tmpdir(), "mag-editorial-"));
process.env.SITE_DATA_DIR = directory;
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const cms = await import("../src/lib/site-content.server.ts");
const shared = await import("../src/lib/site-content.ts");
const user = await auth.createUser("admin@editorial.test", "Temporaria-Teste-123", ["admin"]);
const admin = { id: user.id, email: "admin@editorial.test", roles: ["admin"], created_at: "" };
const draft = () => cms.readSiteContentAdmin(admin).draft;
test.after(async () => { db.closeDb(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

test("complete legacy publication expands on read without changing stored bytes, fields or relative order", () => {
  draft();
  const legacy = shared.defaultSiteContent();
  delete legacy.home.editorial;
  legacy.home.sections = legacy.home.sections.filter((s) => !["manifesto", "process"].includes(s.id)).reverse();
  legacy.home.hero.title = "Título já publicado pela MAG";
  legacy.home.sections[0].title = "Bloco personalizado";
  const original = JSON.stringify(legacy);
  const publicationId = crypto.randomUUID();
  db.getDb().prepare("INSERT INTO site_content_publications(id,version,content,published_at,published_by) VALUES (?,?,?,?,?)")
    .run(publicationId, 1, original, new Date().toISOString(), admin.id);
  db.getDb().prepare("UPDATE site_content_draft SET content=? WHERE id=1").run(original);
  const read = cms.readPublicSiteContent();
  assert.equal(read.version, 1);
  assert.equal(read.content.home.hero.title, legacy.home.hero.title);
  assert.deepEqual(read.content.home.sections.slice(2), legacy.home.sections);
  assert.deepEqual(read.content.home.sections.slice(0, 2).map((s) => s.id), ["manifesto", "process"]);
  assert.equal(read.content.home.editorial.processSteps.length, 6);
  assert.deepEqual(draft().content.home.sections.slice(2), legacy.home.sections);
  cms.restoreSiteContentCore(admin, draft().revision, publicationId);
  assert.equal(db.getDb().prepare("SELECT content FROM site_content_publications WHERE id=?").get(publicationId).content, original);
  assert.equal(cms.readPublicSiteContent().content.home.hero.title, legacy.home.hero.title);
});

test("editorial content follows draft, publication and hidden-section privacy rules", () => {
  const document = draft().content;
  document.home.editorial.manifestoSupport = "Complemento editável ainda privado";
  document.home.editorial.processSteps = [{ title: "Etapa editável", text: "Texto privado da etapa" }];
  cms.saveSiteContentDraftCore(admin, draft().revision, document);
  assert.ok(!JSON.stringify(cms.readPublicSiteContent()).includes("Texto privado da etapa"));
  cms.publishSiteContentCore(admin, draft().revision);
  assert.deepEqual(cms.readPublicSiteContent().content.home.editorial, document.home.editorial);
  document.home.sections.find((s) => s.id === "manifesto").enabled = false;
  document.home.sections.find((s) => s.id === "process").enabled = false;
  cms.saveSiteContentDraftCore(admin, draft().revision, document);
  cms.publishSiteContentCore(admin, draft().revision);
  const publicDocument = cms.readPublicSiteContent();
  assert.equal(publicDocument.content.home.editorial.manifestoSupport, "");
  assert.deepEqual(publicDocument.content.home.editorial.processSteps, []);
  assert.ok(!JSON.stringify(publicDocument).includes("Texto privado da etapa"));
  assert.equal(draft().content.home.editorial.processSteps[0].title, "Etapa editável");
});

test("compatibility does not accept incomplete/duplicate sections, extra keys or invalid process steps", () => {
  const original = shared.defaultSiteContent();
  const invalid = [];
  const short = structuredClone(original); short.home.sections.pop(); invalid.push(short);
  const duplicate = structuredClone(original); duplicate.home.sections[1] = duplicate.home.sections[0]; invalid.push(duplicate);
  const incompleteLegacy = structuredClone(original); incompleteLegacy.home.sections = incompleteLegacy.home.sections.filter((s) => !["manifesto", "process"].includes(s.id)); incompleteLegacy.home.sections[1] = incompleteLegacy.home.sections[0]; invalid.push(incompleteLegacy);
  const extra = structuredClone(original); extra.home.editorial.video = "https://unknown.test/file.mp4"; invalid.push(extra);
  const empty = structuredClone(original); empty.home.editorial.processSteps = []; invalid.push(empty);
  const excess = structuredClone(original); excess.home.editorial.processSteps = Array.from({ length: 9 }, () => ({ title: "Etapa", text: "" })); invalid.push(excess);
  for (const document of invalid) assert.equal(shared.siteContentSchema.safeParse(document).success, false);
  assert.equal(shared.siteContentSchema.safeParse(original).success, true);
});
