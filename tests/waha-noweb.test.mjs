// Real WAHA NOWEB 2026.10.1 shapes observed in the isolated homologation (numbers/ids anonymized):
// - Brazilian mobiles may be registered without the 9th digit (12 digits) while contacts store 13.
// - send* returns the raw WhatsApp message ({ key: { id } }), not { id }.
// - echoes/phone sends have no `to`; the chat is in the serialized id and `from`.
// - ACKs and inbound messages may address the chat by LID, with `remoteJidAlt` carrying the phone.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mag-waha-noweb-"));
process.env.SITE_DATA_DIR = directory;
process.env.CRM_DISABLE_WORKER = "1";
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const crm = await import("../src/lib/crm.server.ts");
const phones = await import("../src/lib/br-phone.ts");
const actor = async (email, roles) => ({ id: (await auth.createUser(email, "QA-Strong-Password-123", roles)).id, email, roles, created_at: "" });
const admin = await actor("admin@noweb.example.test", ["admin"]);
const seller = await actor("seller@noweb.example.test", ["comercial"]);

const session = "mag-noweb";
const apiKey = "QA-API-KEY-NOWEB";
const hmacKey = "QA-HMAC-KEY-NOWEB";
const authorized = "5585991234567"; // typed with the 9th digit
const meId = "558591234567@c.us"; // reported by WhatsApp without it
const meLid = "99999999999999@lid";
const typed = "5585988887777"; // customer as typed by the seller
const registered = "558588887777"; // customer as registered on WhatsApp
const lid = "12345678901234@lid";
const base = { revision: 0, enabled: true, baseUrl: "http://waha.noweb.test:3000", apiKey, hmacKey };
const calls = [];
let sequence = 0;
let override;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(String(url));
  assert.equal(parsed.origin, base.baseUrl);
  calls.push({ path: parsed.pathname, search: parsed.search, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
  if (override) { const response = await override(parsed, options); if (response) return response; }
  if (parsed.pathname === `/api/sessions/${session}`) return json({ name: session, status: "WORKING", me: { id: meId, lid: meLid, pushName: "MAG" }, config: { noweb: { store: { enabled: true, fullSync: false } } } });
  if (parsed.pathname === "/api/contacts/check-exists") {
    const asked = parsed.searchParams.get("phone");
    return json(phones.samePhone(asked, registered) ? { numberExists: true, chatId: `${registered}@c.us` } : { numberExists: false, chatId: null });
  }
  if (parsed.pathname === "/api/contacts") return json({ name: "Cliente NOWEB" });
  if (["/api/sendText", "/api/sendFile", "/api/sendImage", "/api/sendVoice"].includes(parsed.pathname)) {
    const body = JSON.parse(options.body);
    return json({ key: { remoteJid: body.chatId.replace("@c.us", "@s.whatsapp.net"), fromMe: true, id: `3EB0NOWEB${++sequence}` }, message: { extendedTextMessage: { text: body.text || "" } }, messageTimestamp: String(Math.floor(Date.now() / 1000)), status: "PENDING" }, 201);
  }
  if (parsed.pathname.startsWith(`/api/${session}/lids/`)) return json({ lid, pn: `${registered}@c.us` });
  if (parsed.pathname.startsWith("/api/files/")) return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]), { headers: { "Content-Type": "image/jpeg" } });
  throw new Error("Unexpected connector path: " + parsed.pathname);
};
test.after(async () => { globalThis.fetch = originalFetch; db.closeDb(); await rm(directory, { recursive: true, force: true, maxRetries: 5 }); });

// A message stored by the previous build with the full serialized id, BEFORE the WAHA schema initializes.
const legacyContact = crm.createContact(seller, { name: "Contato legado", phone: "5585977776666", email: "", city: "Fortaleza/CE" });
db.getDb().prepare("INSERT INTO crm_messages(id,contact_id,provider,account,external_id,sender,text,channel,status,sent_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
  .run(randomUUID(), legacyContact.id, "waha", session, "false_55559999@lid_LEGACY0001", "cliente", "Mensagem antiga", "whatsapp", "received", new Date(Date.now() - 3_600_000).toISOString());

const waha = await import("../src/lib/crm-waha.server.ts");
const deliver = async (event, payload) => {
  const body = JSON.stringify({ id: randomUUID(), event, session, me: { id: meId, lid: meLid }, payload });
  const response = await waha.handleWahaWebhook(new Request("https://mag.example.test/api/crm/webhooks/waha", { method: "POST", headers: { "X-Webhook-Hmac-Algorithm": "sha512", "X-Webhook-Hmac": createHmac("sha512", hmacKey).update(body).digest("hex") }, body }));
  await waha.drainWahaEvents();
  return response;
};
const count = (table) => Number(db.getDb().prepare(`SELECT count(*) n FROM ${table}`).get().n);
const message = (externalId) => db.getDb().prepare("SELECT * FROM crm_messages WHERE provider='waha' AND external_id=?").get(externalId);
let contact;

test("Brazilian 9th-digit spellings are the same line; other numbers stay blocked", async () => {
  assert.deepEqual(phones.brPhoneVariants("5585988887777"), ["5585988887777", "558588887777"]);
  assert.deepEqual(phones.brPhoneVariants("558588887777"), ["558588887777", "5585988887777"]);
  assert.deepEqual(phones.brPhoneVariants("558532221111"), ["558532221111"], "landlines never gain a 9");
  assert.ok(!phones.samePhone("5585988887777", "5585988887778"));
  waha.saveWahaSettings(admin, base);
  await waha.saveWahaLine(admin, { userId: seller.id, expectedPhone: authorized, session });
  const connection = await waha.readWahaConnection(admin);
  assert.equal(connection.state, "WORKING");
  assert.equal(connection.connected, true);
  override = async (url) => (url.pathname === `/api/sessions/${session}` ? json({ status: "WORKING", me: { id: "558599990000@c.us" } }) : null);
  assert.equal((await waha.readWahaConnection(admin)).state, "number_mismatch");
  override = undefined;
});

test("stored legacy serialized ids are converted once, so a replay does not duplicate", async () => {
  assert.ok(message("false_LEGACY0001"), "legacy id converted to the stable form");
  assert.equal(message("false_55559999@lid_LEGACY0001"), undefined);
});

test("sends resolve the registered address, read NOWEB key ids and keep the echo single", async () => {
  contact = crm.createContact(seller, { name: "Cliente com 9", phone: typed, email: "", city: "Fortaleza/CE" });
  const sent = await waha.sendWahaMessage(seller, { contactId: contact.id, text: "Proposta enviada", clientMessageId: randomUUID() });
  const call = calls.filter((item) => item.path === "/api/sendText").at(-1);
  assert.equal(call.body.chatId, `${registered}@c.us`, "sent to the address WhatsApp knows, not the typed spelling");
  const row = db.getDb().prepare("SELECT * FROM crm_messages WHERE id=?").get(sent.id);
  assert.equal(row.external_id, "true_3EB0NOWEB1");
  assert.equal(row.status, "sent");
  assert.equal(db.getDb().prepare("SELECT state FROM crm_waha_outbox WHERE message_id=?").get(sent.id).state, "sent");
  const total = count("crm_messages");
  await deliver("message.any", { id: `true_${registered}@c.us_3EB0NOWEB1`, timestamp: Math.floor(Date.now() / 1000), from: `${registered}@c.us`, fromMe: true, source: "api", body: "Proposta enviada", hasMedia: false, media: null, ack: 0, ackName: "PENDING", _data: { key: { remoteJid: `${registered}@s.whatsapp.net`, fromMe: true, id: "3EB0NOWEB1" }, message: { extendedTextMessage: {} } } });
  assert.equal(count("crm_messages"), total, "the echo converges with the API record");
  assert.equal(count("crm_contacts"), 2, "no contact created for the 12-digit spelling");
});

test("ACKs addressed by LID update the message sent to the phone address", async () => {
  await deliver("message.ack", { id: `true_${lid}_3EB0NOWEB1`, from: lid, fromMe: true, ack: 2, ackName: "DEVICE" });
  assert.equal(message("true_3EB0NOWEB1").status, "delivered");
  await deliver("message.ack", { id: `true_${lid}_3EB0NOWEB1`, from: lid, fromMe: true, ack: 3, ackName: "READ" });
  assert.equal(message("true_3EB0NOWEB1").status, "read");
  await deliver("message.ack", { id: `true_${lid}_3EB0NOWEB1`, from: lid, fromMe: true, ack: 1, ackName: "SERVER" });
  assert.equal(message("true_3EB0NOWEB1").status, "read", "late server receipts never regress");
});

test("inbound LID messages use remoteJidAlt, reach the typed contact and are received", async () => {
  const before = calls.length;
  await deliver("message.any", { id: `false_${lid}_3EB0IN0001`, timestamp: Math.floor(Date.now() / 1000), from: lid, fromMe: false, source: "app", body: "Recebido MAG", hasMedia: false, media: null, ack: 2, ackName: "DEVICE", _data: { key: { remoteJid: lid, remoteJidAlt: `${registered}@s.whatsapp.net`, fromMe: false, id: "3EB0IN0001" }, pushName: "Cliente", message: { extendedTextMessage: {} } } });
  const row = message("false_3EB0IN0001");
  assert.equal(row.contact_id, contact.id);
  assert.equal(row.sender, "cliente");
  assert.equal(row.status, "received");
  assert.ok(!calls.slice(before).some((item) => item.path.includes("/lids/")), "no extra lookup when the phone address is present");
  const opportunity = db.getDb().prepare("SELECT * FROM crm_opportunities WHERE contact_id=?").get(contact.id);
  assert.ok(opportunity && opportunity.awaiting_reply === 1, "live inbound opens one attendance awaiting reply");
  assert.equal(count("crm_contacts"), 2);
});

test("inbound media in a LID chat downloads through the serialized id and stays private", async () => {
  await deliver("message.any", { id: `false_${lid}_3EB0IMG001`, timestamp: Math.floor(Date.now() / 1000), from: lid, fromMe: false, body: "", hasMedia: true, media: { url: `${base.baseUrl}/api/files/${session}/3EB0IMG001.jpeg`, filename: null, mimetype: "image/jpeg" }, ack: 2, _data: { key: { remoteJid: lid, remoteJidAlt: `${registered}@s.whatsapp.net`, fromMe: false, id: "3EB0IMG001" }, message: { imageMessage: {} } } });
  const row = message("false_3EB0IMG001");
  assert.equal(row.contact_id, contact.id);
  assert.equal(crm.listCrmMessages(seller, contact.id).find((item) => item.id === row.id).attachments.length, 1);
});

test("messages typed on the phone are recorded as the seller's, in the same conversation", async () => {
  await deliver("message.any", { id: `true_${lid}_3EB0PHONE1`, timestamp: Math.floor(Date.now() / 1000), from: lid, fromMe: true, source: "app", body: "Teste enviado pelo aparelho", hasMedia: false, media: null, ack: 1, _data: { key: { remoteJid: lid, remoteJidAlt: `${registered}@s.whatsapp.net`, fromMe: true, id: "3EB0PHONE1" }, message: { conversation: "x" } } });
  const row = message("true_3EB0PHONE1");
  assert.equal(row.contact_id, contact.id);
  assert.equal(row.sender, "vendedora");
  assert.equal(db.getDb().prepare("SELECT awaiting_reply FROM crm_opportunities WHERE contact_id=?").get(contact.id).awaiting_reply, 0);
});

test("protocol notices and notes to self never become contacts", async () => {
  const contacts = count("crm_contacts"), messages = count("crm_messages");
  await deliver("message.any", { id: `true_${meLid}_PROTOCOL01`, timestamp: Math.floor(Date.now() / 1000), from: meLid, fromMe: true, body: "", hasMedia: false, media: null, ack: 1, _data: { key: { remoteJid: meLid, fromMe: true, id: "PROTOCOL01" }, message: { protocolMessage: {} } } });
  await deliver("message.any", { id: `true_${meId}_SELFNOTE01`, timestamp: Math.floor(Date.now() / 1000), from: meId, fromMe: true, body: "lembrete", hasMedia: false, media: null, ack: 1, _data: { key: { remoteJid: meId.replace("@c.us", "@s.whatsapp.net"), fromMe: true, id: "SELFNOTE01" }, message: { conversation: "x" } } });
  assert.equal(count("crm_contacts"), contacts);
  assert.equal(count("crm_messages"), messages);
});

test("a number without WhatsApp is refused before any outbox row or send", async () => {
  const other = crm.createContact(seller, { name: "Sem WhatsApp", phone: "5585900000000", email: "", city: "" });
  const sends = calls.filter((item) => item.path === "/api/sendText").length, outbox = count("crm_waha_outbox");
  await assert.rejects(waha.sendWahaMessage(seller, { contactId: other.id, text: "Oi", clientMessageId: randomUUID() }), /não está no WhatsApp/);
  assert.equal(calls.filter((item) => item.path === "/api/sendText").length, sends);
  assert.equal(count("crm_waha_outbox"), outbox);
});

test("history in a LID chat converges with webhook records", async () => {
  override = async (url) => {
    if (url.pathname === `/api/${session}/chats`) return json([{ id: lid }]);
    if (url.pathname === `/api/${session}/chats/${encodeURIComponent(lid)}/messages` || url.pathname === `/api/${session}/chats/${lid}/messages`)
      return json([
        { id: `false_${lid}_3EB0IN0001`, timestamp: Math.floor(Date.now() / 1000), from: lid, fromMe: false, body: "Recebido MAG", hasMedia: false, ack: 2, _data: { key: { remoteJid: lid, remoteJidAlt: `${registered}@s.whatsapp.net`, fromMe: false, id: "3EB0IN0001" } } },
        { id: `true_${lid}_3EB0NOWEB1`, timestamp: Math.floor(Date.now() / 1000), from: lid, fromMe: true, body: "Proposta enviada", hasMedia: false, ack: 3, _data: { key: { remoteJid: lid, remoteJidAlt: `${registered}@s.whatsapp.net`, fromMe: true, id: "3EB0NOWEB1" } } },
      ]);
    return null;
  };
  const before = count("crm_messages");
  const result = await waha.syncWahaHistory(admin, { chatId: lid });
  assert.equal(result.processed, 0);
  assert.equal(count("crm_messages"), before);
  override = undefined;
});
