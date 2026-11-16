// The portal uses the same private draft/publication workflow; no production data or network.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const directory = await mkdtemp(join(tmpdir(), "mag-links-portal-"));
process.env.SITE_DATA_DIR = directory;
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const shared = await import("../src/lib/links.ts");
const core = await import("../src/lib/links.server.ts");
const created = await auth.createUser(
  "admin@portal.example.invalid",
  "Portal-Test-Password-123",
  ["admin"],
);
const admin = {
  id: created.id,
  email: "admin@portal.example.invalid",
  roles: ["admin"],
  created_at: "",
};
const current = () => core.readLinkTreeAdmin(admin);
const save = (content) =>
  core.saveLinkTreeDraftCore(admin, current().draft.revision, content);
const legacyId = randomUUID();
let legacyJson;
let legacyContent;

test.after(async () => {
  db.closeDb();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("mag-links-portal-"));
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
});

test("existing presentation receives portal defaults without rewriting draft or immutable publication", () => {
  current();
  legacyContent = shared.emptyLinkTreeContent();
  legacyContent.title = "Árvore de homologação";
  delete legacyContent.presentation.portal;
  const location = {
    ...shared.newLinkTreeItem("location"),
    title: "Loja QA",
    address: "Rua de homologação, 100",
    active: true,
  };
  const seller = {
    ...shared.newLinkTreeItem("seller"),
    title: "Ana QA",
    description: "Consultora QA",
    phone: "5585900000001",
    locationId: location.id,
    active: true,
  };
  const link = {
    ...shared.newLinkTreeItem("link"),
    title: "Catálogo QA",
    url: "/produtos",
    active: true,
  };
  const campaign = {
    ...shared.newLinkCampaign(),
    name: "Campanha QA",
    title: "Campanha QA",
    slug: "campanha-qa-portal",
    desktopImage: shared.LINK_STATIC_LOGO,
    active: true,
  };
  legacyContent.items = [location, seller, link];
  legacyContent.campaigns = [campaign];
  legacyJson = JSON.stringify(legacyContent);
  db.getDb()
    .prepare("UPDATE link_tree_draft SET revision=5,content=? WHERE id=1")
    .run(legacyJson);
  db.getDb()
    .prepare(
      "INSERT INTO link_tree_publications(id,version,content,published_at,published_by) VALUES(?,1,?,?,?)",
    )
    .run(legacyId, legacyJson, new Date().toISOString(), admin.id);
  assert.deepEqual(
    current().draft.content.presentation.portal,
    shared.defaultLinkPortal(),
  );
  assert.deepEqual(
    core.readPublicLinkTree().content.presentation.portal,
    shared.defaultLinkPortal(),
  );
  assert.equal(current().draft.revision, 5);
  assert.equal(
    db.getDb().prepare("SELECT content FROM link_tree_draft WHERE id=1").get()
      .content,
    legacyJson,
  );
  assert.equal(
    db
      .getDb()
      .prepare("SELECT content FROM link_tree_publications WHERE id=?")
      .get(legacyId).content,
    legacyJson,
  );
});

test("partial portal objects get independent defaults and preserve deliberately empty text and disabled features", () => {
  const document = structuredClone(current().draft.content);
  document.presentation.portal = {
    city: "",
    heroTitle: "Título gerenciável",
    mascotEnabled: false,
  };
  const parsed = shared.linkTreeContentSchema.parse(document);
  assert.equal(parsed.presentation.portal.city, "");
  assert.equal(parsed.presentation.portal.heroTitle, "Título gerenciável");
  assert.equal(parsed.presentation.portal.mascotEnabled, false);
  assert.equal(parsed.presentation.portal.showQuickActions, true);
  assert.equal(parsed.presentation.portal.showBottomNav, true);
  assert.equal(parsed.presentation.portal.headerTitle, "MAG em um toque");
  const first = shared.defaultLinkPresentation(),
    second = shared.defaultLinkPresentation();
  first.portal.city = "Outra cidade";
  assert.equal(second.portal.city, "Fortaleza");
  assert.notEqual(first.portal, second.portal);
  for (const key of [
    "headerTitle",
    "city",
    "heroEyebrow",
    "heroTitle",
    "heroText",
    "heroCtaLabel",
    "mascotName",
  ]) {
    document.presentation.portal[key] = "";
  }
  assert.equal(
    shared.linkTreeContentSchema.parse(document).presentation.portal.heroText,
    "",
  );
});

test("portal settings follow draft, publish and restore while IDs, destinations and historical publications survive", () => {
  const document = structuredClone(current().draft.content);
  document.presentation.portal = {
    headerTitle: "A MAG perto de você",
    city: "Fortaleza e região",
    heroEyebrow: "Chamada QA",
    heroTitle: "Título principal QA",
    heroText: "Descrição principal QA",
    heroCtaLabel: "Explorar a MAG",
    showQuickActions: false,
    showBottomNav: false,
    showSearch: false,
    mascotEnabled: false,
    mascotName: "Mascote QA",
  };
  const before = core.readPublicLinkTree();
  const saved = save(document);
  assert.equal(saved.revision, 6);
  assert.deepEqual(
    core.readPublicLinkTree(),
    before,
    "draft changes must not appear publicly",
  );
  assert.deepEqual(
    current().draft.content.presentation.portal,
    document.presentation.portal,
  );
  assert.equal(core.publishLinkTreeCore(admin, saved.revision).version, 2);
  const publication = core.readPublicLinkTree();
  assert.deepEqual(
    publication.content.presentation.portal,
    document.presentation.portal,
  );
  assert.deepEqual(
    publication.content.items.map((item) => item.id),
    legacyContent.items.map((item) => item.id),
  );
  assert.deepEqual(
    publication.content.campaigns.map((item) => item.id),
    legacyContent.campaigns.map((item) => item.id),
  );
  assert.equal(
    publication.content.items.find((item) => item.type === "seller").phone,
    legacyContent.items[1].phone,
  );
  assert.equal(
    publication.content.items.find((item) => item.type === "link").url,
    "/produtos",
  );
  assert.match(
    shared.campaignDestination(publication.content.campaigns[0]),
    /utm_campaign=campanha-qa-portal/,
  );
  assert.equal(
    db
      .getDb()
      .prepare("SELECT content FROM link_tree_publications WHERE id=?")
      .get(legacyId).content,
    legacyJson,
  );
  const restored = core.restoreLinkTreeCore(
    admin,
    current().draft.revision,
    legacyId,
  );
  assert.deepEqual(
    current().draft.content.presentation.portal,
    shared.defaultLinkPortal(),
  );
  assert.deepEqual(
    core.readPublicLinkTree(),
    publication,
    "restoration affects draft only",
  );
  assert.equal(core.publishLinkTreeCore(admin, restored.revision).version, 3);
  assert.deepEqual(
    core.readPublicLinkTree().content.presentation.portal,
    shared.defaultLinkPortal(),
  );
  assert.equal(
    db
      .getDb()
      .prepare("SELECT content FROM link_tree_publications WHERE id=?")
      .get(legacyId).content,
    legacyJson,
  );
});

test("invalid portal text, flags and unknown configuration cannot modify the draft or weaken link validation", () => {
  const before = current().draft;
  const invalid = [];
  for (const mutate of [
    (doc) => {
      doc.presentation.portal.headerTitle = "<script>bad()</script>";
    },
    (doc) => {
      doc.presentation.portal.heroText = "x".repeat(321);
    },
    (doc) => {
      doc.presentation.portal.heroTitle = "x".repeat(121);
    },
    (doc) => {
      doc.presentation.portal.mascotName = "x".repeat(61);
    },
    (doc) => {
      doc.presentation.portal.city = "Cidade\u0000";
    },
    (doc) => {
      doc.presentation.portal.showSearch = "false";
    },
    (doc) => {
      doc.presentation.portal.mascotEnabled = 1;
    },
    (doc) => {
      doc.presentation.portal.customUrl = "https://unknown.example.invalid";
    },
    (doc) => {
      doc.presentation.portal = null;
    },
    (doc) => {
      doc.items.find((item) => item.type === "link").url =
        "javascript:alert(1)";
    },
  ]) {
    const document = structuredClone(before.content);
    mutate(document);
    invalid.push(document);
  }
  for (const document of invalid) assert.throws(() => save(document));
  assert.deepEqual(current().draft, before);
});
