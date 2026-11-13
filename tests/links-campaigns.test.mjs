import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const dir = await mkdtemp(join(tmpdir(), "mag-campaigns-"));
process.env.SITE_DATA_DIR = dir;
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const shared = await import("../src/lib/links.ts");
const links = await import("../src/lib/links.server.ts");
const metrics = await import("../src/lib/links-metrics.server.ts");
const assignments = await import("../src/lib/assignments.server.ts");
const user = async (name, roles) => ({
  id: (await auth.createUser(`${name}@campaigns.test`, "Senha-Temporaria-123", roles)).id,
  email: `${name}@campaigns.test`,
  roles,
  created_at: "",
});
const admin = await user("admin", ["admin"]);
const seller = await user("seller", ["comercial"]);
const other = await user("other", ["comercial"]);
const dho = await user("dho", ["dho"]);
const data = () => ({
  ...shared.emptyLinkTreeContent(),
  items: [{ ...shared.newLinkTreeItem("link"), title: "Catálogo", active: true, url: "/produtos" }],
});
const draft = () => links.readLinkTreeAdmin(admin).draft;
const save = (content) => links.saveLinkTreeDraftCore(admin, draft().revision, content);
const publish = () => links.publishLinkTreeCore(admin, draft().revision);
const at = new Date("2026-10-16T15:00:00.000Z");
test.after(async () => {
  db.closeDb();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test("legacy JSON receives empty campaigns and unlimited schedules without rewriting publication", () => {
  const legacy = data();
  delete legacy.campaigns;
  delete legacy.items[0].startsAt;
  delete legacy.items[0].endsAt;
  assert.equal(shared.linkTreeContentSchema.parse(legacy).campaigns.length, 0);
  assert.equal(shared.linkTreeContentSchema.parse(legacy).items[0].startsAt, "");
  links.seedLinkTreeCore(admin, legacy);
  const publication = links.readLinkTreeAdmin(admin).publications[0];
  const original = db
    .getDb()
    .prepare("SELECT content FROM link_tree_publications WHERE id=?")
    .get(publication.id).content;
  links.restoreLinkTreeCore(admin, draft().revision, publication.id);
  assert.deepEqual(draft().content.campaigns, []);
  assert.equal(
    db.getDb().prepare("SELECT content FROM link_tree_publications WHERE id=?").get(publication.id)
      .content,
    original,
  );
});

test("schedules respect local Fortaleza boundaries, inclusive whole end day and strict real dates", () => {
  assert.equal(shared.scheduleInstant("2026-10-16T00:00"), Date.parse("2026-10-16T03:00:00Z"));
  assert.equal(shared.scheduleInstant("2026-10-16", true), Date.parse("2026-10-17T03:00:00Z"));
  const scheduled = { active: true, startsAt: "2026-10-16", endsAt: "2026-10-16" };
  assert.equal(shared.isInLinkSchedule(scheduled, new Date("2026-10-16T02:59:59Z")), false);
  assert.equal(shared.isInLinkSchedule(scheduled, new Date("2026-10-16T03:00:00Z")), true);
  assert.equal(shared.isInLinkSchedule(scheduled, new Date("2026-10-17T02:59:59Z")), true);
  assert.equal(shared.isInLinkSchedule(scheduled, new Date("2026-10-17T03:00:00Z")), false);
  for (const value of [
    "2026-02-30",
    "2026-13-01",
    "2026-10-16T25:00",
    "2026-10-16T10:60",
    "2026-10-16T10:00Z",
    "javascript:alert(1)",
  ]) {
    const content = data();
    content.items[0].startsAt = value;
    assert.equal(shared.linkTreeContentSchema.safeParse(content).success, false, value);
  }
  const reversed = data();
  reversed.items[0].startsAt = "2026-10-17T10:00";
  reversed.items[0].endsAt = "2026-10-17T09:00";
  assert.equal(shared.linkTreeContentSchema.safeParse(reversed).success, false);
});

test("campaign artwork stays private until published and within schedule, including linked unit visibility", async () => {
  const bytes = await sharp({
    create: { width: 80, height: 40, channels: 3, background: "#bcddbb" },
  })
    .png()
    .toBuffer();
  const desktop = await links.uploadLinkImageCore(admin, bytes.toString("base64"));
  const mobile = await links.uploadLinkImageCore(admin, bytes.toString("base64"));
  const desktopFile = desktop.image.split("/").at(-1);
  const mobileFile = mobile.image.split("/").at(-1);
  const content = data();
  const unit = {
    ...shared.newLinkTreeItem("location"),
    active: true,
    title: "Loja exemplo",
    address: "Rua de exemplo, 20",
    endsAt: "2026-10-16T14:00",
  };
  content.items.push(unit);
  const campaign = {
    ...shared.newLinkCampaign(),
    active: true,
    title: "Campanha teste",
    desktopImage: desktop.image,
    mobileImage: mobile.image,
    startsAt: "2026-10-16T11:00",
    endsAt: "2026-10-16T13:00",
    locationId: unit.id,
  };
  content.campaigns.push(campaign);
  const before = links.readPublicLinkTree(at);
  save(content);
  assert.deepEqual(links.readPublicLinkTree(at), before);
  assert.equal(links.readPublicLinkImage(desktopFile), null);
  publish();
  assert.equal(links.readPublicLinkTree(at).content.campaigns.length, 1);
  assert.ok(links.readPublicLinkImage(desktopFile, at));
  assert.ok(links.readPublicLinkImage(mobileFile, at));
  assert.equal(
    links.readPublicLinkTree(new Date("2026-10-16T13:59:59Z")).content.campaigns.length,
    0,
  );
  assert.equal(
    links.readPublicLinkTree(new Date("2026-10-16T16:00:00Z")).content.campaigns.length,
    0,
  );
  content.items.find((item) => item.id === unit.id).endsAt = "2026-10-16T11:30";
  save(content);
  publish();
  assert.equal(links.readPublicLinkTree(at).content.campaigns.length, 0);
  for (const file of [desktopFile, mobileFile]) {
    assert.equal(links.readPublicLinkImage(file, at), null);
    assert.ok(links.readAdminLinkImage(admin, file));
    assert.throws(() => links.readAdminLinkImage(seller, file), /Forbidden/);
  }
});

test("campaign limits, destinations, immutable slugs and stale editor writes are enforced on the server", () => {
  const content = data();
  const campaign = {
    ...shared.newLinkCampaign(),
    active: true,
    title: "Catálogo",
    desktopImage: shared.LINK_STATIC_LOGO,
  };
  content.campaigns = [campaign];
  save(content);
  publish();
  const state = draft();
  assert.ok(shared.campaignDestination(campaign).startsWith("/produtos?utm_campaign="));
  for (const url of [
    "javascript:alert(1)",
    "//example.invalid",
    "https://user:pass@example.invalid",
    "http://example.invalid",
  ]) {
    const invalid = structuredClone(content);
    invalid.campaigns[0].destinationType = "link";
    invalid.campaigns[0].url = url;
    assert.throws(() => save(invalid), /HTTPS/);
  }
  const renamed = structuredClone(content);
  renamed.campaigns[0].slug = "novo-identificador";
  assert.throws(() => save(renamed), /identificador.*fixo/);
  assert.deepEqual(draft(), state);
  const tooMany = data();
  tooMany.campaigns = Array.from({ length: 4 }, () => shared.newLinkCampaign());
  assert.throws(() => save(tooMany), /três/);
  const duplicate = data();
  duplicate.campaigns = [campaign, { ...campaign, id: crypto.randomUUID() }];
  assert.throws(() => save(duplicate), /identificador diferente/);
  const rev = draft().revision;
  save(content);
  assert.throws(() => links.saveLinkTreeDraftCore(admin, rev, content), /outra aba/);
  assert.throws(() => links.publishLinkTreeCore(admin, rev), /outra aba/);
});

test("public events validate publication, active targets, token, type and expiry; only daily aggregates are persisted", () => {
  const publication = links.readPublicLinkTree(at);
  const token = metrics.metricsToken(publication.version, at.getTime());
  const event = {
    token,
    targetType: "campaign",
    targetId: publication.content.campaigns[0].id,
    action: "click",
  };
  assert.equal(metrics.recordLinkEvent(event, "source-a", at), true);
  assert.equal(
    metrics.recordLinkEvent({ ...event, targetId: crypto.randomUUID() }, "source-b", at),
    false,
  );
  assert.equal(metrics.recordLinkEvent({ ...event, token: token + "x" }, "source-b", at), false);
  assert.equal(
    metrics.recordLinkEvent(
      { ...event, token: token.split(".").slice(0, 2).join(".") + "." + "ç".repeat(43) },
      "source-b",
      at,
    ),
    false,
  );
  assert.equal(
    metrics.recordLinkEvent(
      { ...event, token: metrics.metricsToken(publication.version - 1, at.getTime()) },
      "source-b",
      at,
    ),
    false,
  );
  assert.equal(
    metrics.recordLinkEvent(
      { ...event, token: metrics.metricsToken(publication.version, at.getTime() - 7_300_000) },
      "source-b",
      at,
    ),
    false,
  );
  assert.equal(metrics.recordLinkEvent({ ...event, action: "purchase" }, "source-b", at), false);
  assert.equal(
    metrics.recordLinkEvent({ ...event, targetType: "page", targetId: null }, "source-b", at),
    false,
  );
  assert.equal(
    metrics.recordLinkEvent(
      { ...event, targetType: "page", targetId: null, action: "view" },
      "source-b",
      at,
    ),
    true,
  );
  assert.equal(
    metrics.recordLinkEvent(
      { ...event, targetType: "page", targetId: null, action: "view" },
      "source-b",
      at,
    ),
    false,
  );
  for (let n = 0; n < 9; n++) assert.equal(metrics.recordLinkEvent(event, "source-a", at), true);
  assert.equal(metrics.recordLinkEvent(event, "source-a", at), false);
  assert.deepEqual(
    db
      .getDb()
      .prepare("PRAGMA table_info(link_metrics_daily)")
      .all()
      .map((row) => row.name),
    ["day", "target_type", "target_id", "action", "count"],
  );
  const stats = metrics.readMarketingMetrics(admin, 30, at);
  assert.equal(stats.clicks, 10);
  assert.equal(stats.pageViews, 1);
  for (const actor of [seller, dho, null, { ...seller, roles: ["admin"] }])
    assert.throws(() => metrics.readMarketingMetrics(actor, 30, at), /Unauthorized|Forbidden/);
});

test("campaign attribution counts actual saved forms and commercial aggregates stay scoped to the owner", () => {
  const campaign = draft().content.campaigns[0];
  const leadA = db.insertLead("quote_requests", {
    nome: "Empresa exemplo A",
    utm: { utm_campaign: campaign.slug },
  });
  const leadB = db.insertLead("quote_requests", {
    nome: "Empresa exemplo B",
    utm: { utm_campaign: "outra" },
  });
  assignments.assignmentsSchema();
  db.getDb()
    .prepare("UPDATE quote_requests SET created_at=? WHERE id IN (?,?)")
    .run(at.toISOString(), leadA.id, leadB.id);
  for (const [lead, owner] of [
    [leadA, seller],
    [leadB, other],
  ])
    db.getDb()
      .prepare(
        "INSERT INTO lead_assignments(lead_id,owner_id,revision,updated_at) VALUES (?,?,1,?)",
      )
      .run(lead.id, owner.id, at.toISOString());
  for (const [owner, lead, total] of [
    [seller, leadA, 10000],
    [other, leadB, 990000],
  ])
    db.getDb()
      .prepare(
        `INSERT INTO internal_quotes(id,number,status,owner_id,source_request_id,customer_name,total_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        crypto.randomUUID(),
        `TEST-${owner.id}`,
        "aceito",
        owner.id,
        lead.id,
        "Empresa exemplo",
        total,
        at.toISOString(),
        at.toISOString(),
      );
  const personal = metrics.readCommercialMetrics(seller, 30, at);
  assert.equal(personal.leads, 1);
  assert.equal(personal.negotiations, 1);
  assert.equal(personal.acceptedValueCents, 10000);
  const team = metrics.readCommercialMetrics(admin, 30, at);
  assert.equal(team.leads, 2);
  assert.equal(team.negotiations, 2);
  assert.equal(team.acceptedValueCents, 1000000);
  assert.equal(
    metrics.readMarketingMetrics(admin, 30, at).campaigns.find((item) => item.id === campaign.id)
      .quoteRequests,
    1,
  );
  assert.throws(() => metrics.readCommercialMetrics(dho, 30, at), /Forbidden/);
  db.getDb().prepare("UPDATE users SET disabled=1 WHERE id=?").run(seller.id);
  assert.throws(() => metrics.readCommercialMetrics(seller, 30, at), /Forbidden/);
});
