// Release CRM + WhatsApp (decisoes de 06/11/2026): telefone normalizado no cadastro manual,
// administrador supervisiona sem responder por padrao, historico so da conversa selecionada e
// importacao geral desligada por padrao (quando ligada, reconhece as conversas @s.whatsapp.net do NOWEB).
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mag-waha-release-"));
process.env.SITE_DATA_DIR = directory;
process.env.CRM_DISABLE_WORKER = "1";
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const crm = await import("../src/lib/crm.server.ts");
const actor = async (email, roles) => ({
  id: (await auth.createUser(email, "QA-Strong-Password-123", roles)).id,
  email,
  roles,
  created_at: "",
});
const admin = await actor("admin@release.example.test", ["admin"]);
const seller = await actor("seller@release.example.test", ["comercial"]);
const other = await actor("other@release.example.test", ["comercial"]);
const dho = await actor("dho@release.example.test", ["dho"]);
const session = "mag-release";
const base = {
  revision: 0,
  enabled: true,
  baseUrl: "http://waha.release.test:3000",
  session,
  apiKey: "QA-API-KEY-RELEASE",
  hmacKey: "QA-HMAC-RELEASE",
};
const registered = "558588887777"; // as WhatsApp knows the customer
const calls = [];
let sequence = 0,
  override;
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(String(url));
  assert.equal(parsed.origin, base.baseUrl);
  calls.push({ path: parsed.pathname, search: parsed.search, method: options.method || "GET" });
  if (override) {
    const response = await override(parsed, options);
    if (response) return response;
  }
  if (parsed.pathname === `/api/sessions/${session}`)
    return json({ status: "WORKING", me: { id: "558591234567@c.us" } });
  if (parsed.pathname === "/api/contacts/check-exists")
    return json({ numberExists: true, chatId: `${registered}@c.us` });
  if (parsed.pathname === "/api/contacts") return json({ name: "Cliente" });
  if (parsed.pathname === "/api/sendText")
    return json(
      {
        key: {
          remoteJid: `${registered}@s.whatsapp.net`,
          fromMe: true,
          id: `3EB0REL${++sequence}`,
        },
        status: "PENDING",
      },
      201,
    );
  throw new Error("Unexpected connector path: " + parsed.pathname);
};
test.after(async () => {
  globalThis.fetch = originalFetch;
  db.closeDb();
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
});

// Old record stored without the 9th digit, before this release (must stay untouched).
const legacy = crm.createContact(seller, {
  name: "Cadastro antigo",
  phone: "",
  email: "",
  city: "",
});
db.getDb().prepare("UPDATE crm_contacts SET phone=? WHERE id=?").run("558577776666", legacy.id);

const waha = await import("../src/lib/crm-waha.server.ts");
const save = (patch = {}) =>
  waha.saveWahaSettings(admin, {
    ...base,
    revision: waha.readWahaSettings(admin).revision,
    ownerId: seller.id,
    expectedPhone: "5585991234567",
    ...patch,
  });
const count = (table) => Number(db.getDb().prepare(`SELECT count(*) n FROM ${table}`).get().n);
let customer;

test("manual registration stores Brazilian mobiles with the 9th digit and never duplicates either spelling", () => {
  customer = crm.createContact(seller, {
    name: "Cliente digitado",
    phone: "(85) 98888-7777",
    email: "",
    city: "Fortaleza/CE",
  });
  assert.equal(customer.phone, "5585988887777");
  const oldSpelling = crm.createContact(seller, {
    name: "Mesmo cliente",
    phone: "(85) 8888-7777",
    email: "",
    city: "",
  });
  assert.equal(oldSpelling.id, customer.id, "the 8-digit spelling is the same line");
  const landline = crm.createContact(seller, {
    name: "Fixo",
    phone: "(85) 3222-1111",
    email: "",
    city: "",
  });
  assert.equal(landline.phone, "558532221111", "landlines never gain a 9");
  const reused = crm.createContact(seller, {
    name: "Antigo com 9",
    phone: "5585977776666",
    email: "",
    city: "",
  });
  assert.equal(
    reused.id,
    legacy.id,
    "an existing 12-digit record is found by the 13-digit spelling",
  );
  assert.equal(
    db.getDb().prepare("SELECT phone FROM crm_contacts WHERE id=?").get(legacy.id).phone,
    "558577776666",
    "existing rows are preserved as stored",
  );
  assert.throws(
    () =>
      crm.updateContact(seller, {
        ...landline,
        id: landline.id,
        revision: landline.revision,
        phone: "558588887777",
      }),
    /Já existe outro contato/,
  );
  const otherPortfolio = crm.createContact(other, {
    name: "Outra carteira",
    phone: "85988887777",
    email: "",
    city: "",
  });
  assert.notEqual(otherPortfolio.id, customer.id, "deduplication stays inside each portfolio");
});

test("administrators supervise: they read the conversation but do not reply unless explicitly allowed", async () => {
  save();
  assert.equal(waha.readWahaSettings(admin).allowAdminReplies, false);
  assert.equal(waha.readWahaSettings(admin).allowFullHistoryImport, false);
  assert.equal((await waha.readWahaConnection(admin)).canReply, false);
  assert.equal((await waha.readWahaConnection(admin)).canSyncConversation, true);
  assert.equal((await waha.readWahaConnection(seller)).canReply, true);
  const outbox = count("crm_waha_outbox"),
    sends = calls.filter((call) => call.path === "/api/sendText").length;
  await assert.rejects(
    waha.sendWahaMessage(admin, {
      contactId: customer.id,
      text: "Resposta do admin",
      clientMessageId: randomUUID(),
    }),
    /Somente a vendedora responsável responde/,
  );
  assert.equal(count("crm_waha_outbox"), outbox);
  assert.equal(calls.filter((call) => call.path === "/api/sendText").length, sends);
  const sent = await waha.sendWahaMessage(seller, {
    contactId: customer.id,
    text: "Resposta da vendedora",
    clientMessageId: randomUUID(),
  });
  assert.equal(
    db.getDb().prepare("SELECT external_id FROM crm_messages WHERE id=?").get(sent.id).external_id,
    "true_3EB0REL1",
  );
  save({ allowAdminReplies: true });
  assert.equal((await waha.readWahaConnection(admin)).canReply, true);
  await waha.sendWahaMessage(admin, {
    contactId: customer.id,
    text: "Supervisão autorizada",
    clientMessageId: randomUUID(),
  });
  save({ allowAdminReplies: false });
  assert.equal((await waha.readWahaConnection(admin)).canReply, false);
});

test("history of the selected conversation only: owner or administrator, never the whole number", async () => {
  const before = count("crm_messages");
  override = async (url) => {
    if (url.pathname === `/api/${session}/chats`)
      throw new Error("the catalog of every chat must not be read");
    if (
      url.pathname ===
        `/api/${session}/chats/${encodeURIComponent(`${registered}@c.us`)}/messages` ||
      url.pathname === `/api/${session}/chats/${registered}@c.us/messages`
    )
      return json([
        {
          id: `false_${registered}@c.us_HIST0001`,
          timestamp: 1700000000,
          from: `${registered}@c.us`,
          fromMe: false,
          body: "Mensagem antiga",
          hasMedia: false,
          ack: 2,
        },
        {
          id: `true_${registered}@c.us_3EB0REL1`,
          timestamp: 1700000100,
          from: `${registered}@c.us`,
          fromMe: true,
          body: "Resposta da vendedora",
          hasMedia: false,
          ack: 3,
        },
      ]);
    return null;
  };
  const first = await waha.syncWahaContactHistory(seller, customer.id);
  assert.equal(first.processed, 1, "only the message not yet in the CRM is new");
  assert.equal(count("crm_messages"), before + 1);
  const opportunity = db
    .getDb()
    .prepare("SELECT count(*) n FROM crm_opportunities WHERE contact_id=?")
    .get(customer.id).n;
  assert.equal(
    (await waha.syncWahaContactHistory(admin, customer.id)).processed,
    0,
    "administrator may check it; nothing duplicates",
  );
  assert.equal(
    db
      .getDb()
      .prepare("SELECT count(*) n FROM crm_opportunities WHERE contact_id=?")
      .get(customer.id).n,
    opportunity,
    "history opens no opportunity",
  );
  await assert.rejects(waha.syncWahaContactHistory(other, customer.id), /Forbidden/);
  await assert.rejects(waha.syncWahaContactHistory(dho, customer.id), /Forbidden/);
  await assert.rejects(
    waha.syncWahaHistory(admin, {}),
    /importação geral do histórico está desativada/,
  );
  override = undefined;
});

test("when an administrator enables the general import, NOWEB @s.whatsapp.net chats are recognized", async () => {
  save({ allowFullHistoryImport: true });
  override = async (url) => {
    if (url.pathname === `/api/${session}/chats`)
      return json([{ id: "558566665555@s.whatsapp.net" }, { id: "120363000000000000@g.us" }]);
    if (url.pathname.endsWith("/messages")) return json([]);
    return null;
  };
  await waha.syncWahaHistory(admin, {});
  const chats = db
    .getDb()
    .prepare("SELECT chat_id FROM crm_waha_history WHERE session=?")
    .all(session)
    .map((row) => row.chat_id);
  assert.ok(chats.includes("558566665555@c.us"), "the NOWEB individual chat is recognized");
  assert.ok(
    !chats.some((chat) => chat.endsWith("@g.us") || chat.endsWith("@s.whatsapp.net")),
    "groups stay out; ids are normalized",
  );
  override = undefined;
  save({ allowFullHistoryImport: false });
});
