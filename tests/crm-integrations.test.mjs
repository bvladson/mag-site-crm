import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "mag-crm-integrations-"));
process.env.SITE_DATA_DIR = dir;
process.env.CRM_DISABLE_WORKER = "1";
const database = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const core = await import("../src/lib/crm.server.ts");
const units = await import("../src/lib/units.server.ts");
const integrations = await import("../src/lib/crm-integrations.server.ts");
async function actor(email, roles) {
  return {
    id: (await auth.createUser(email, "Senha-Forte-123", roles)).id,
    email,
    roles,
    created_at: "",
  };
}
const admin = await actor("admin@integration.example", ["admin"]);
const seller = await actor("seller@integration.example", ["comercial"]);
const other = await actor("other@integration.example", ["comercial"]);
const dho = await actor("dho@integration.example", ["dho"]);
const unit = units.listUnitsPublic()[0];
const secrets = {
  evolutionApiKey: "FAKE-EVOLUTION-API-KEY-FOR-QA",
  evolutionWebhookSecret: "FAKE-WEBHOOK-SECRET-FOR-QA",
  googleWebhookKey: "FAKE-GOOGLE-KEY-FOR-QA",
  metaVerifyToken: "FAKE-VERIFY-TOKEN-FOR-QA",
  metaAppSecret: "FAKE-META-APP-SECRET-FOR-QA",
  metaPageToken: "FAKE-META-PAGE-TOKEN-FOR-QA",
};
const settings = {
  revision: 0,
  evolutionUrl: "https://evolution.example.invalid",
  evolutionInstance: "qa-mag",
  metaPageId: "123456789",
  metaGraphVersion: "v23.0",
  defaultOwnerId: seller.id,
  defaultUnitId: unit.id,
  ...secrets,
};
const originalFetch = globalThis.fetch;
let mockFetch = async () => {
  throw new Error("Unexpected network access in isolated CRM test");
};
globalThis.fetch = (...args) => mockFetch(...args);
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const webhook = (provider, payload, headers = {}) =>
  integrations.handleCrmWebhook(
    provider,
    new Request(`https://mag.example.invalid/api/crm/webhooks/${provider}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
    }),
  );
const tableCount = (table) =>
  Number(database.getDb().prepare(`SELECT count(*) n FROM ${table}`).get().n);
async function drain() {
  await integrations.drainCrmIntegrationEvents();
}
test.after(async () => {
  globalThis.fetch = originalFetch;
  database.closeDb();
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("integration settings require fresh admin, encrypt secrets and never return their values", () => {
  core.ensureCrmSchema();
  assert.throws(() => integrations.saveCrmIntegrationSettings(seller, settings), /Forbidden/);
  assert.throws(() => integrations.readCrmIntegrationSettings(dho), /Forbidden/);
  assert.deepEqual(integrations.saveCrmIntegrationSettings(admin, settings), { revision: 1 });
  const safe = integrations.readCrmIntegrationSettings(admin);
  for (const [key, value] of Object.entries(secrets)) {
    assert.equal(safe.secrets[key], true);
    assert.ok(!JSON.stringify(safe).includes(value));
    assert.ok(
      !String(
        database.getDb().prepare("SELECT encrypted FROM crm_integrations_config").get().encrypted,
      ).includes(value),
    );
  }
  assert.equal(safe.defaultOwnerId, seller.id);
  assert.throws(() => integrations.saveCrmIntegrationSettings(admin, settings), /outra sessão/);
  const updates = { ...settings, revision: 1 };
  for (const key of Object.keys(secrets)) delete updates[key];
  assert.deepEqual(integrations.saveCrmIntegrationSettings(admin, updates), { revision: 2 });
  assert.ok(
    integrations.readCrmIntegrationSettings(admin).secrets.evolutionApiKey,
    "omitted secrets stay configured",
  );
  assert.throws(
    () =>
      integrations.saveCrmIntegrationSettings(admin, {
        ...updates,
        revision: 2,
        evolutionUrl: "https://apikey:password@host.invalid",
      }),
    /sem credenciais/,
  );
});

test("Google authenticates key, distinguishes tests and durably deduplicates real leads", async () => {
  const base = {
    lead_id: "google-qa-1",
    campaign_id: "90000000000000001",
    form_id: "70000000000000001",
    user_column_data: [
      { column_id: "FULL_NAME", string_value: "Contato Google QA" },
      { column_id: "PHONE_NUMBER", string_value: "+55 85 99911-0001" },
      { column_id: "EMAIL", string_value: "google@example.invalid" },
    ],
  };
  assert.equal((await webhook("google", { ...base, google_key: "bad" })).status, 401);
  const before = tableCount("crm_webhook_events");
  assert.equal(
    (await webhook("google", { ...base, google_key: secrets.googleWebhookKey, is_test: true }))
      .status,
    200,
  );
  assert.equal(tableCount("crm_webhook_events"), before);
  const good = { ...base, google_key: secrets.googleWebhookKey };
  const accepted = await webhook("google", good);
  assert.equal(accepted.status, 202);
  assert.equal((await (await webhook("google", good)).json()).duplicate, true);
  assert.equal(tableCount("crm_webhook_events"), before + 1);
  await drain();
  const workspace = core.getCrmBootstrap(seller);
  assert.equal(workspace.opportunities.filter((o) => o.sourceKind === "google").length, 1);
  const opportunity = workspace.opportunities.find((o) => o.sourceKind === "google");
  assert.equal(opportunity.ownerId, seller.id);
  assert.equal(opportunity.origin, "Anúncio Google");
  assert.ok(opportunity.interest.includes(base.campaign_id));
  assert.equal(core.getCrmBootstrap(other).opportunities.length, 0);
  const row = database
    .getDb()
    .prepare("SELECT encrypted FROM crm_webhook_events WHERE provider='google'")
    .get();
  assert.ok(!row.encrypted.includes("Contato Google QA"));
  assert.ok(!row.encrypted.includes(secrets.googleWebhookKey));
});

test("numeric int64 Google campaign/form identifiers retain their exact digits", async () => {
  const body = JSON.stringify({
    lead_id: "google-qa-int64",
    google_key: secrets.googleWebhookKey,
    campaign_id: "CAMPAIGN_NUMBER",
    form_id: "FORM_NUMBER",
    user_column_data: [
      { column_id: "FULL_NAME", string_value: "Contato int64 QA" },
      { column_id: "PHONE_NUMBER", string_value: "5585999110009" },
    ],
  })
    .replace('"CAMPAIGN_NUMBER"', "90000000000000001")
    .replace('"FORM_NUMBER"', "9223372036854775807");
  const response = await integrations.handleCrmWebhook(
    "google",
    new Request("https://mag.example.invalid/api/crm/webhooks/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  );
  assert.equal(response.status, 202);
  await drain();
  const opportunity = core
    .getCrmBootstrap(seller)
    .opportunities.find((item) => item.title === "Contato Google — Contato int64 QA");
  assert.ok(opportunity.interest.includes("Campanha 90000000000000001"));
  assert.ok(opportunity.interest.includes("Formulário 9223372036854775807"));
});

test("Meta validates verify challenge and signature/Page before retrieving a lead server-side", async () => {
  const challenge = new Request(
    `https://mag.example.invalid/api/crm/webhooks/meta?hub.mode=subscribe&hub.verify_token=${secrets.metaVerifyToken}&hub.challenge=qa-challenge`,
  );
  assert.equal(
    await (await integrations.handleCrmWebhook("meta", challenge)).text(),
    "qa-challenge",
  );
  assert.equal(
    (
      await integrations.handleCrmWebhook(
        "meta",
        new Request(
          "https://mag.example.invalid/api/crm/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong",
        ),
      )
    ).status,
    403,
  );
  const payload = {
    object: "page",
    entry: [
      {
        id: settings.metaPageId,
        changes: [
          { field: "leadgen", value: { leadgen_id: "987654321", form_id: "456", ad_id: "789" } },
        ],
      },
    ],
  };
  assert.equal((await webhook("meta", payload, { "x-hub-signature-256": "wrong" })).status, 401);
  let calls = 0;
  mockFetch = async (url, options) => {
    calls++;
    assert.ok(String(url).startsWith("https://graph.facebook.com/v23.0/987654321?"));
    assert.equal(options.headers.Authorization, `Bearer ${secrets.metaPageToken}`);
    return json({
      id: "987654321",
      field_data: [
        { name: "full_name", values: ["Contato Meta QA"] },
        { name: "phone_number", values: ["5585999220002"] },
      ],
    });
  };
  const signature = `sha256=${createHmac("sha256", secrets.metaAppSecret).update(JSON.stringify(payload)).digest("hex")}`;
  assert.equal((await webhook("meta", payload, { "x-hub-signature-256": signature })).status, 200);
  await drain();
  assert.equal(calls, 1);
  assert.equal(
    core.getCrmBootstrap(seller).opportunities.filter((o) => o.sourceKind === "meta").length,
    1,
  );
  const safeEvents = integrations.listCrmIntegrationEvents(admin);
  assert.ok(!JSON.stringify(safeEvents).includes("Contato Meta QA"));
  assert.ok(!JSON.stringify(safeEvents).includes(secrets.metaPageToken));
});

test("Evolution requires secret and instance, dedupes changed webhook retries and preserves early receipts", async () => {
  const headers = { "x-crm-webhook-secret": secrets.evolutionWebhookSecret };
  const received = {
    event: "MESSAGES_UPSERT",
    instance: "qa-mag",
    apikey: secrets.evolutionApiKey,
    data: {
      key: { remoteJid: "5585999330003@s.whatsapp.net", id: "EV-QA-1", fromMe: false },
      pushName: "Contato WhatsApp QA",
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: "Mensagem privada QA", apikey: secrets.evolutionApiKey },
    },
  };
  assert.equal((await webhook("evolution", received)).status, 401);
  assert.equal(
    (await webhook("evolution", { ...received, instance: "unknown" }, headers)).status,
    401,
  );
  const receipt = {
    event: "MESSAGES_UPDATE",
    instance: "qa-mag",
    data: [{ key: { id: "EV-QA-1" }, update: { status: 4 } }],
  };
  assert.equal((await webhook("evolution", receipt, headers)).status, 202);
  await drain();
  assert.equal((await webhook("evolution", received, headers)).status, 202);
  await drain();
  assert.equal((await (await webhook("evolution", received, headers)).json()).duplicate, true);
  const changedRetry = {
    ...received,
    data: { ...received.data, pushName: "Nome em retry diferente" },
  };
  assert.equal((await webhook("evolution", changedRetry, headers)).status, 202);
  await drain();
  const workspace = core.getCrmBootstrap(seller);
  const contact = workspace.contacts.find((c) => c.phone === "5585999330003");
  assert.ok(contact);
  assert.equal(contact.name, "Contato WhatsApp QA");
  const messages = core.listCrmMessages(seller, contact.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].status, "read");
  assert.equal(workspace.opportunities.filter((o) => o.contactId === contact.id).length, 1);
  const rows = database
    .getDb()
    .prepare("SELECT encrypted FROM crm_webhook_events WHERE provider='evolution'")
    .all();
  for (const row of rows) assert.ok(!row.encrypted.includes(secrets.evolutionApiKey));
});

test("real outbound enforces portfolio, sends only once per client key and provider echo adds no duplicate", async () => {
  const contact = core.createContact(seller, { name: "Outbound QA", phone: "85999440004" });
  let sends = 0;
  mockFetch = async (url, options) => {
    if (String(url).includes("connectionState")) return json({ instance: { state: "open" } });
    assert.ok(String(url).endsWith("/message/sendText/qa-mag"));
    sends++;
    assert.equal(options.headers.apikey, secrets.evolutionApiKey);
    assert.equal(JSON.parse(options.body).number, "5585999440004");
    return json({ key: { id: "EV-OUT-QA-1" } });
  };
  assert.throws(() => core.requireCrmContact(other, contact.id), /Forbidden/);
  await assert.rejects(
    () =>
      integrations.sendCrmText(other, {
        contactId: contact.id,
        text: "forjado",
        clientMessageId: "forged",
      }),
    /Forbidden/,
  );
  const input = {
    contactId: contact.id,
    text: "Olá, segue o retorno QA",
    clientMessageId: "request-qa-1",
  };
  const first = await integrations.sendCrmText(seller, input);
  assert.equal(first.status, "sent");
  await integrations.sendCrmText(seller, input);
  assert.equal(sends, 1);
  const echo = {
    event: "SEND_MESSAGE",
    instance: "qa-mag",
    data: {
      key: { remoteJid: "5585999440004@s.whatsapp.net", id: "EV-OUT-QA-1", fromMe: true },
      pushName: "Nome da vendedora",
      message: { conversation: input.text },
    },
  };
  await webhook("evolution", echo, { "x-crm-webhook-secret": secrets.evolutionWebhookSecret });
  await drain();
  assert.equal(core.listCrmMessages(seller, contact.id).length, 1);
  assert.equal(core.requireCrmContact(seller, contact.id).name, "Outbound QA");
  assert.equal(
    core.getCrmBootstrap(admin).contacts.filter((c) => c.phone === contact.phone).length,
    1,
  );
});

test("uncertain outbound never automatically resends, redacts provider errors and retains retry guard", async () => {
  const contact = core.createContact(seller, { name: "Timeout QA", phone: "85999550005" });
  let sends = 0;
  mockFetch = async (url) => {
    if (String(url).includes("connectionState")) return json({ instance: { state: "open" } });
    sends++;
    throw new Error(`Sensitive provider failure ${secrets.evolutionApiKey}`);
  };
  const input = {
    contactId: contact.id,
    text: "Mensagem incerta QA",
    clientMessageId: "request-timeout-qa",
  };
  await assert.rejects(
    () => integrations.sendCrmText(seller, input),
    (error) =>
      /Não foi possível confirmar/.test(error.message) &&
      !error.message.includes(secrets.evolutionApiKey),
  );
  await assert.rejects(() => integrations.sendCrmText(seller, input), /já foi iniciado/);
  assert.equal(sends, 1);
  assert.equal(core.listCrmMessages(seller, contact.id).length, 0);
  const outbox = database
    .getDb()
    .prepare("SELECT state FROM crm_outbox WHERE request_key=?")
    .get(input.clientMessageId);
  assert.equal(outbox.state, "uncertain");
  const audits = database
    .getDb()
    .prepare("SELECT details FROM audit_log WHERE action LIKE 'crm:%'")
    .all();
  assert.ok(!JSON.stringify(audits).includes(secrets.evolutionApiKey));
  assert.ok(!JSON.stringify(audits).includes(input.text));
});

test("lost encryption key fails closed instead of silently regenerating credentials", async () => {
  const key = join(dir, "security", "crm-integrations.key");
  const saved = join(dir, "security", "crm-integrations.saved-key");
  assert.equal((await readFile(key)).length, 32);
  await rename(key, saved);
  try {
    assert.throws(() => integrations.readCrmIntegrationSettings(admin), /Restaure o backup/);
  } finally {
    await rename(saved, key);
  }
});
