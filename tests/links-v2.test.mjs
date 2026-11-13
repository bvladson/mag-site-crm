// Temporary SQLite only. No production data, browser session or external network.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mag-links-v2-"));
process.env.SITE_DATA_DIR = directory;
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const shared = await import("../src/lib/links.ts");
const core = await import("../src/lib/links.server.ts");
const created = await auth.createUser("admin@links-v2.test", "Senha-Temporaria-V2-123", ["admin"]);
const admin = { id: created.id, email: "admin@links-v2.test", roles: ["admin"], created_at: "" };
const current = () => core.readLinkTreeAdmin(admin);
const save = (content) => core.saveLinkTreeDraftCore(admin, current().draft.revision, content);
const publish = () => core.publishLinkTreeCore(admin, current().draft.revision);
const legacyId = crypto.randomUUID();
let legacyJson;

test.after(async () => {
  db.closeDb();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("mag-links-v2-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test("legacy draft and immutable publication gain presentation/icon defaults without rewriting stored JSON", () => {
  current();
  const legacy = shared.emptyLinkTreeContent();
  delete legacy.presentation;
  const link = {
    ...shared.newLinkTreeItem("link"),
    title: "Catálogo original",
    url: "/produtos",
    active: true,
  };
  delete link.icon;
  legacy.items = [link];
  legacyJson = JSON.stringify(legacy);
  db.getDb().prepare("UPDATE link_tree_draft SET revision=7,content=? WHERE id=1").run(legacyJson);
  db.getDb()
    .prepare(
      "INSERT INTO link_tree_publications(id,version,content,published_at,published_by) VALUES (?,1,?,?,?)",
    )
    .run(legacyId, legacyJson, new Date().toISOString(), admin.id);
  const draft = current().draft;
  const publication = core.readPublicLinkTree();
  assert.deepEqual(draft.content.presentation, shared.defaultLinkPresentation());
  assert.deepEqual(publication.content.presentation, shared.defaultLinkPresentation());
  assert.equal(draft.content.items[0].icon, "auto");
  assert.equal(publication.content.items[0].icon, "auto");
  assert.equal(draft.revision, 7);
  assert.equal(
    db.getDb().prepare("SELECT content FROM link_tree_draft WHERE id=1").get().content,
    legacyJson,
  );
  assert.equal(
    db.getDb().prepare("SELECT content FROM link_tree_publications WHERE id=?").get(legacyId)
      .content,
    legacyJson,
  );
});

test("partial presentation and label objects receive per-property defaults while intentional empty labels survive", () => {
  const document = structuredClone(current().draft.content);
  document.presentation = {
    slogan: "Slogan parcial",
    labels: { teamTitle: "", linksText: "Descrição nova" },
  };
  delete document.items[0].icon;
  const parsed = shared.linkTreeContentSchema.parse(document);
  const defaults = shared.defaultLinkPresentation();
  assert.equal(parsed.presentation.slogan, "Slogan parcial");
  assert.equal(parsed.presentation.labels.teamTitle, "");
  assert.equal(parsed.presentation.labels.linksText, "Descrição nova");
  assert.equal(parsed.presentation.labels.unitsTitle, defaults.labels.unitsTitle);
  assert.equal(parsed.presentation.contentLayout, "columns");
  assert.equal(parsed.presentation.headerLayout, "aligned");
  assert.equal(parsed.presentation.accentColor, null);
  assert.equal(parsed.items[0].icon, "auto");
  const independent = shared.defaultLinkPresentation();
  independent.labels.teamTitle = "Somente esta instância";
  assert.equal(shared.defaultLinkPresentation().labels.teamTitle, defaults.labels.teamTitle);
});

test("new layout controls, custom text and icon round-trip through draft, publication and restoration", () => {
  const document = structuredClone(current().draft.content);
  Object.assign(document.presentation, {
    slogan: "Atendimento com a sua unidade",
    siteUrl: "/produtos",
    privacyUrl: "https://magmoveiscorporativos.com.br/privacidade",
    headerLayout: "centered",
    contentLayout: "stacked",
    contentWidth: "compact",
    cardStyle: "solid",
    corners: "soft",
    backgroundAttachment: "scroll",
    overlayStrength: "strong",
    accentColor: "#12647E",
    showShare: false,
  });
  for (const key of Object.keys(document.presentation.labels))
    document.presentation.labels[key] = "Texto " + key;
  document.items[0].icon = "catalog";
  const beforePublic = core.readPublicLinkTree();
  const saved = save(document);
  assert.equal(saved.revision, 8);
  assert.deepEqual(core.readPublicLinkTree(), beforePublic);
  assert.deepEqual(current().draft.content.presentation, document.presentation);
  assert.equal(publish().version, 2);
  const published = core.readPublicLinkTree();
  assert.deepEqual(published.content.presentation, document.presentation);
  assert.equal(published.content.items[0].icon, "catalog");
  assert.ok(!JSON.stringify(published).includes(admin.id));
  assert.ok(!JSON.stringify(published).includes(admin.email));
  const history = db
    .getDb()
    .prepare("SELECT id,version,content FROM link_tree_publications ORDER BY version")
    .all();
  const restore = core.restoreLinkTreeCore(admin, current().draft.revision, legacyId);
  assert.equal(restore.revision, 9);
  assert.deepEqual(current().draft.content.presentation, shared.defaultLinkPresentation());
  assert.equal(current().draft.content.items[0].icon, "auto");
  assert.deepEqual(core.readPublicLinkTree(), published);
  assert.deepEqual(
    db
      .getDb()
      .prepare("SELECT id,version,content FROM link_tree_publications ORDER BY version")
      .all(),
    history,
  );
  assert.equal(
    db.getDb().prepare("SELECT content FROM link_tree_publications WHERE id=?").get(legacyId)
      .content,
    legacyJson,
  );
  assert.equal(publish().version, 3);
  assert.deepEqual(
    core.readPublicLinkTree().content.presentation,
    shared.defaultLinkPresentation(),
  );
  assert.equal(
    db.getDb().prepare("SELECT content FROM link_tree_publications WHERE id=?").get(legacyId)
      .content,
    legacyJson,
  );
});

test("unsafe presentation URLs, CSS, HTML, unknown settings and unsupported icon values cannot alter the draft", () => {
  const before = current().draft;
  const invalid = [];
  const vary = (mutate) => {
    const next = structuredClone(before.content);
    mutate(next);
    invalid.push(next);
  };
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,test",
    "//evil.example",
    "/foo\\bar",
    "/foo%0abar",
    "http://example.test",
    "https://user:password@example.test",
  ]) {
    vary((next) => {
      next.presentation.siteUrl = value;
    });
    vary((next) => {
      next.presentation.privacyUrl = value;
    });
  }
  for (const value of [
    "red",
    "#fff",
    "url(https://example.test/image)",
    "#123456;display:none",
    "oklch(0.5 0.2 18)",
  ])
    vary((next) => {
      next.presentation.accentColor = value;
    });
  for (const key of [
    "headerLayout",
    "contentLayout",
    "contentWidth",
    "cardStyle",
    "corners",
    "backgroundAttachment",
    "overlayStrength",
  ])
    vary((next) => {
      next.presentation[key] = "custom-css";
    });
  vary((next) => {
    next.presentation.style = "body{display:none}";
  });
  vary((next) => {
    next.presentation.labels.extra = "não permitido";
  });
  vary((next) => {
    next.presentation.labels.unitsTitle = "<img src=x onerror=alert(1)>";
  });
  vary((next) => {
    next.presentation.slogan = "<script>alert(1)</script>";
  });
  vary((next) => {
    next.presentation.labels.unitsTitle = "x".repeat(121);
  });
  vary((next) => {
    next.presentation.labels.teamText = "x".repeat(321);
  });
  vary((next) => {
    next.presentation.showShare = "false";
  });
  vary((next) => {
    next.items[0].icon = "script";
  });
  for (const document of invalid) assert.throws(() => save(document));
  assert.deepEqual(current().draft, before);
});

test("every supported enum/icon and optional empty text is accepted without weakening other link validation", () => {
  const document = structuredClone(current().draft.content);
  document.presentation.slogan = "";
  document.presentation.labels = Object.fromEntries(
    Object.keys(document.presentation.labels).map((key) => [key, ""]),
  );
  document.presentation.accentColor = null;
  for (const icon of shared.LINK_ICONS) {
    document.items[0].icon = icon;
    assert.equal(shared.linkTreeContentSchema.parse(document).items[0].icon, icon);
  }
  for (const [key, values] of Object.entries({
    headerLayout: ["aligned", "centered"],
    contentLayout: ["columns", "stacked"],
    contentWidth: ["wide", "compact"],
    cardStyle: ["glass", "solid"],
    corners: ["rounded", "soft", "square"],
    backgroundAttachment: ["fixed", "scroll"],
    overlayStrength: ["soft", "balanced", "strong"],
  }))
    for (const value of values) {
      document.presentation[key] = value;
      assert.equal(shared.linkTreeContentSchema.parse(document).presentation[key], value);
    }
  const saved = save(document);
  assert.ok(saved.revision > 9);
  publish();
  assert.deepEqual(core.readPublicLinkTree().content.presentation, document.presentation);
  const invalidLink = structuredClone(document);
  invalidLink.items[0].url = "javascript:alert(1)";
  assert.throws(() => save(invalidLink));
  assert.equal(
    db.getDb().prepare("SELECT content FROM link_tree_publications WHERE id=?").get(legacyId)
      .content,
    legacyJson,
  );
});
