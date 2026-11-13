import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mag-waha-transport-"));
process.env.SITE_DATA_DIR = directory;
process.env.CRM_DISABLE_WORKER = "1";
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const crm = await import("../src/lib/crm.server.ts");
const media = await import("../src/lib/crm-media.server.ts");
const waha = await import("../src/lib/crm-waha.server.ts");
const actor = async (email, roles) => ({ id: (await auth.createUser(email, "QA-Strong-Password-123", roles)).id, email, roles, created_at: "" });
const admin = await actor("admin@waha.example.test", ["admin"]);
const seller = await actor("seller@waha.example.test", ["comercial"]);
const other = await actor("other@waha.example.test", ["comercial"]);
const dho = await actor("dho@waha.example.test", ["dho"]);
const apiKey = "QA-API-KEY-NEVER-LOG-THIS";
const hmacKey = "QA-HMAC-KEY-NEVER-LOG-THIS";
const expectedPhone = "5585999999999";
const session = "mag-teste";
const base = { revision: 0, enabled: true, baseUrl: "http://waha.example.test:3000", apiKey, hmacKey };
const count = table => Number(db.getDb().prepare(`SELECT count(*) n FROM ${table}`).get().n);
const originalFetch = globalThis.fetch;
const calls = [];
let override;
let sequence = 0;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(String(url));
  assert.equal(parsed.origin, base.baseUrl, "connector must never access an arbitrary origin");
  assert.equal(options.headers["X-Api-Key"] || options.headers["x-api-key"], apiKey);
  calls.push({ path: parsed.pathname, search: parsed.search, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
  if (override) { const response = await override(parsed, options); if (response) return response; }
  if (parsed.pathname === "/api/sessions/mag-teste" && (!options.method || options.method === "GET")) return json({ name: "mag-teste", status: "WORKING", me: { id: expectedPhone + "@c.us" }, config: { noweb: { store: { enabled: true, fullSync: false } } } });
  if (parsed.pathname === "/api/contacts") return json({ name: "Contato de teste" });
  if (parsed.pathname === "/api/contacts/check-exists") return json({ numberExists: true, chatId: parsed.searchParams.get("phone") + "@c.us" });
  if (parsed.pathname === "/api/sendText" || parsed.pathname === "/api/sendFile" || parsed.pathname === "/api/sendVoice" || parsed.pathname === "/api/sendImage") return json({ id: "waha-out-" + ++sequence });
  if (parsed.pathname.startsWith("/api/files/")) return new Response(Buffer.from("%PDF-1.7\nQA document\n%%EOF"), { headers: { "Content-Type": "application/pdf" } });
  throw new Error("Unexpected connector path: " + parsed.pathname);
};
// Shared connector settings; the seller's number is her line (one WAHA session per seller).
const save = patch => waha.saveWahaSettings(admin, { ...base, revision: waha.readWahaSettings(admin).revision, ...patch });
const line = async (number = expectedPhone) => {
  const current = waha.readWahaSettings(admin).lines.find(item => item.userId === seller.id && item.status === "active");
  return current ? waha.saveWahaLine(admin, { id: current.id, revision: current.revision, userId: seller.id, expectedPhone: number }) : waha.saveWahaLine(admin, { userId: seller.id, expectedPhone: number, session });
};
const event = (type, payload, extra = {}) => ({ id: randomUUID(), event: type, session: "mag-teste", me: { id: expectedPhone + "@c.us" }, payload, ...extra });
const deliver = async (value, headers = {}) => {
  const body = JSON.stringify(value);
  return waha.handleWahaWebhook(new Request("https://mag.example.test/api/crm/webhooks/waha", { method: "POST", headers: { "X-Webhook-Hmac-Algorithm": "sha512", "X-Webhook-Hmac": createHmac("sha512", hmacKey).update(body).digest("hex"), ...headers }, body }));
};
const message = (id, phone = "5585999110001", extra = {}) => ({ id, from: phone + "@c.us", to: expectedPhone + "@c.us", fromMe: false, timestamp: Math.floor(Date.now() / 1000), body: "Mensagem de teste", ack: 1, ...extra });
test.after(async () => { globalThis.fetch = originalFetch; db.closeDb(); await rm(directory, { recursive: true, force: true, maxRetries: 5 }); });

test("settings are isolated, encrypted, admin-only and may leave the seller unset", async () => {
  assert.throws(() => waha.saveWahaSettings(seller, base), /Forbidden/);
  assert.throws(() => waha.readWahaSettings(dho), /Forbidden/);
  waha.saveWahaSettings(admin, base);
  const safe = waha.readWahaSettings(admin);
  assert.deepEqual(safe.lines, []); assert.ok(safe.apiKeyConfigured && safe.hmacKeyConfigured);
  assert.ok(!JSON.stringify(safe).includes(apiKey) && !JSON.stringify(safe).includes(hmacKey));
  assert.ok(!String(db.getDb().prepare("SELECT encrypted FROM crm_waha_config").get().encrypted).includes(apiKey));
  const before = calls.length;
  assert.equal((await waha.readWahaConnection(admin)).state, "line_required");
  assert.equal((await waha.readWahaConnection(seller)).state, "line_required");
  await assert.rejects(waha.controlWahaSession(admin, { action: "start" }), /vendedora/);
  await assert.rejects(waha.controlWahaSession(seller, { action: "start" }), /administrador/);
  assert.equal(calls.length, before);
  await assert.rejects(waha.saveWahaLine(seller, { userId: seller.id, expectedPhone }), /Forbidden/);
  await assert.rejects(waha.saveWahaLine(admin, { userId: dho.id, expectedPhone }), /vendedora ativa/);
  await line("");
  assert.equal((await waha.readWahaConnection(admin)).state, "phone_required");
  await assert.rejects(waha.controlWahaSession(admin, { action: "start" }), /número autorizado/);
  await line();
  assert.equal((await waha.readWahaConnection(seller)).connected, true);
  assert.equal((await waha.readWahaConnection(other)).connected, false);
  assert.equal((await waha.readWahaConnection(other)).state, "line_required");
});

test("session configuration, QR and restart preserve store/webhooks and validate the allowed test number", async () => {
  // Each seller operates only her own line; "configure" stays administrative.
  const lineId = waha.readWahaSettings(admin).lines[0].id;
  await assert.rejects(waha.controlWahaSession(other, { action: "qr" }), /administrador/);
  await assert.rejects(waha.controlWahaSession(other, { action: "qr", lineId }), /Forbidden/);
  await assert.rejects(waha.controlWahaSession(dho, { action: "qr", lineId }), /Forbidden/);
  await assert.rejects(waha.controlWahaSession(seller, { action: "configure" }), /Forbidden/);
  override = async (url, options) => {
    if (url.pathname.endsWith("/auth/qr")) return json({ data: "iVBORw0KGgoAAAANSUhEUg==" });
    if (url.pathname === "/api/sessions/mag-teste" && (!options.method || options.method === "GET")) return json({ status: "SCAN_QR_CODE", config: { metadata: { keep: "yes" }, noweb: { store: { enabled: true, fullSync: false } }, webhooks: [{ url: "http://existing.example.test/hook", events: ["message.any"] }] } });
    if (options.method === "PUT" || url.pathname.endsWith("/restart") || url.pathname.endsWith("/start")) return json({ ok: true });
  };
  const qr = await waha.controlWahaSession(admin, { action: "qr" });
  assert.ok(qr.qrCode.startsWith("data:image/png;base64,"));
  const own = await waha.controlWahaSession(seller, { action: "qr" });
  assert.ok(own.qrCode.startsWith("data:image/png;base64,"), "the seller reads the QR of her own line");
  await waha.controlWahaSession(admin, { action: "restart" });
  const update = calls.filter(call => call.method === "PUT").at(-1).body.config;
  assert.equal(update.metadata.keep, "yes"); assert.equal(update.noweb.store.enabled, true);
  assert.ok(update.webhooks.some(hook => hook.url === "http://existing.example.test/hook"));
  assert.ok(update.webhooks.some(hook => hook.hmac?.key === hmacKey && hook.events.includes("message.any")));
  override = async (url, options) => {
    if (url.pathname === "/api/sessions/mag-teste") return json({ status: "WORKING", me: { id: "5585888888888@c.us" } });
    if (options.method === "POST" && /\/api\/sessions\/mag-teste\/(logout|stop)$/.test(url.pathname)) return json({}, 201);
    return null;
  };
  const unlinked = calls.length;
  const mismatch = await waha.readWahaConnection(seller);
  assert.equal(mismatch.state, "number_mismatch");
  assert.match(mismatch.message, /desfeita automaticamente/);
  assert.deepEqual(calls.slice(unlinked).filter(call => call.method === "POST").map(call => call.path.split("/").at(-1)), ["logout", "stop"], "a phone that is not the line's number is unlinked at once");
  override = undefined;
});

let inbound;
test("webhooks authenticate raw-body HMAC/session, queue durably and deduplicate the same message", async () => {
  const incoming = event("message.any", message("inbound-1"));
  assert.equal((await deliver(incoming, { "X-Webhook-Hmac-Algorithm": "sha256" })).status, 401);
  assert.equal((await deliver(incoming, { "X-Webhook-Hmac": "wrong" })).status, 401);
  assert.equal((await deliver({ ...incoming, session: "other" })).status, 400);
  assert.equal(count("crm_waha_events"), 0);
  assert.equal((await deliver(incoming)).status, 202);
  assert.equal(count("crm_messages"), 0, "processing is disabled until the durable worker is explicitly drained");
  await waha.drainWahaEvents();
  inbound = crm.getCrmBootstrap(seller).opportunities[0];
  assert.ok(inbound && inbound.ownerId === seller.id);
  assert.equal(count("crm_messages"), 1);
  assert.equal((await deliver({ ...incoming, id: randomUUID() })).status, 202);
  await waha.drainWahaEvents();
  assert.equal(count("crm_messages"), 1); assert.equal(count("crm_opportunities"), 1);
  const legacyTables = db.getDb().prepare("SELECT name FROM sqlite_master WHERE name='crm_webhook_events'").all();
  assert.equal(legacyTables.length, 0, "WAHA queue does not enter the legacy worker");
  assert.ok(!JSON.stringify(waha.readWahaSettings(admin)).includes("Mensagem de teste"));
});

test("early ACKs use WAHA codes, never regress read status, and phone sends use the recipient", async () => {
  await deliver(event("message.ack", { id: "cell-out", ack: 3 })); await waha.drainWahaEvents();
  await deliver(event("message.any", message("cell-out", "5585999110001", { fromMe: true, from: expectedPhone + "@c.us", to: "5585999110001@c.us", body: "Enviada pelo celular" })));
  await waha.drainWahaEvents();
  let row = db.getDb().prepare("SELECT * FROM crm_messages WHERE external_id='cell-out'").get();
  assert.equal(row.status, "read"); assert.equal(row.sender, "vendedora"); assert.equal(row.contact_id, inbound.contactId);
  await deliver(event("message.ack", { id: "cell-out", ack: 1 })); await waha.drainWahaEvents();
  row = db.getDb().prepare("SELECT * FROM crm_messages WHERE external_id='cell-out'").get(); assert.equal(row.status, "read");
  assert.equal(count("crm_contacts"), 1);
});

test("incoming documents are copied privately; untrusted media URLs never receive credentials", async () => {
  await deliver(event("message.any", message("media-in", "5585999110001", { body: "", hasMedia: true, media: { url: "http://waha.example.test:3000/api/files/proposal.pdf", mimetype: "application/pdf", filename: "proposta.pdf" } })));
  await waha.drainWahaEvents();
  const attachment = crm.listCrmMessages(seller, inbound.contactId).find(item => item.externalId === "media-in").attachments[0];
  assert.ok(attachment.downloadUrl.startsWith("/api/interno/crm/anexos/"));
  assert.equal(media.readCrmMedia(seller, attachment.id).status, 200);
  assert.throws(() => media.readCrmMedia(other, attachment.id), /Forbidden/);
  const before = calls.length;
  await deliver(event("message.any", message("media-unsafe", "5585999110001", { hasMedia: true, media: { url: "http://169.254.169.254/api/files/secret", mimetype: "application/pdf", filename: "bad.pdf" } })));
  await waha.drainWahaEvents();
  assert.ok(waha.readWahaSettings(admin).events.some(item => item.errorCode === "unsafe_media_url"));
  assert.ok(calls.slice(before).every(call => !call.path.includes("secret")));
});

test("text/document sends are idempotent, echo-safe and scoped; timeouts never resend automatically", async () => {
  const request = { contactId: inbound.contactId, text: "Resposta", clientMessageId: randomUUID() };
  await assert.rejects(waha.sendWahaMessage(other, request), /Forbidden/);
  const before = calls.filter(call => call.path === "/api/sendText").length;
  const first = await waha.sendWahaMessage(seller, request), second = await waha.sendWahaMessage(seller, request);
  assert.equal(first.id, second.id);
  assert.equal(calls.filter(call => call.path === "/api/sendText").length, before + 1);
  const sent = db.getDb().prepare("SELECT external_id FROM crm_messages WHERE id=?").get(first.id);
  const total = count("crm_messages");
  await deliver(event("message.any", message(sent.external_id, "5585999110001", { fromMe: true, from: expectedPhone + "@c.us", to: "5585999110001@c.us", body: "Resposta" })));
  await waha.drainWahaEvents(); assert.equal(count("crm_messages"), total);
  const pdf = media.stageCrmMedia(seller, { contactId: inbound.contactId, name: "proposta.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.7\nQA\n%%EOF") });
  const fileSend = await waha.sendWahaMessage(seller, { contactId: inbound.contactId, text: "Confira", attachmentIds: [pdf.id], clientMessageId: randomUUID() });
  assert.ok(crm.listCrmMessages(seller, inbound.contactId).find(item => item.id === fileSend.id).attachments.length === 1);
  assert.equal(calls.filter(call => call.path === "/api/sendFile").at(-1).body.caption, "Confira");
  override = async url => { if (url.pathname === "/api/sendText") throw new Error(apiKey + ": timeout"); };
  const uncertain = { contactId: inbound.contactId, text: "Não repetir", clientMessageId: randomUUID() };
  await assert.rejects(waha.sendWahaMessage(seller, uncertain), /não haverá reenvio/);
  const attempts = calls.length; await assert.rejects(waha.sendWahaMessage(seller, uncertain), /já foi iniciado/); assert.equal(calls.length, attempts);
  assert.equal(db.getDb().prepare("SELECT state FROM crm_waha_outbox WHERE request_key=?").get(uncertain.clientMessageId).state, "uncertain");
  override = undefined;
});

test("history is idempotent and does not resurrect unread tasks or change commercial stages", async () => {
  crm.markCrmRead(seller, inbound.contactId);
  const initial = crm.requireCrmOpportunity(seller, inbound.id);
  override = async url => {
    if (url.pathname.endsWith("/chats")) return json([{ id: "5585999110001@c.us" }]);
    if (url.pathname.endsWith("/messages")) return json([message("historical-1", "5585999110001", { timestamp: 1600000000, body: "Histórico antigo" })]);
  };
  // Importing every conversation is off by default and needs the explicit administrative setting.
  const catalogCalls = calls.filter(call => call.path.endsWith("/chats")).length;
  await assert.rejects(waha.syncWahaHistory(admin, { limit: 50 }), /importação geral do histórico está desativada/);
  assert.equal(calls.filter(call => call.path.endsWith("/chats")).length, catalogCalls);
  save({ allowFullHistoryImport: true });
  await waha.syncWahaHistory(admin, { limit: 50 });
  const after = crm.requireCrmOpportunity(seller, inbound.id);
  assert.equal(after.awaitingReply, initial.awaitingReply); assert.equal(after.stage, initial.stage); assert.equal(after.lastInteraction, initial.lastInteraction);
  const countBefore = count("crm_messages"); await waha.syncWahaHistory(admin, { limit: 50 }); assert.equal(count("crm_messages"), countBefore);
  const old = db.getDb().prepare("SELECT read_at FROM crm_messages WHERE external_id='historical-1'").get(); assert.ok(old.read_at);
  override = undefined;
});

test("session names follow the pinned NOWEB DTO instead of accepting invalid local settings", async () => {
  const valid = { userId: other.id, expectedPhone: "" };
  assert.ok(waha.wahaLineSchema.safeParse({ ...valid, session: "a".repeat(54) }).success);
  for (const name of ["a".repeat(55), "mag.teste", "mag teste", "mag/teste"])
    assert.equal(waha.wahaLineSchema.safeParse({ ...valid, session: name }).success, false);
  assert.equal(waha.wahaSettingsSchema.safeParse({ ...base, session }).success, false, "sessions belong to the sellers' lines");
  const previous = waha.readWahaSettings(admin);
  await assert.rejects(waha.saveWahaLine(admin, { ...valid, session: "not.allowed" }));
  await assert.rejects(waha.saveWahaLine(admin, { ...valid, session }), /já foi usado/);
  assert.equal(waha.readWahaSettings(admin).revision, previous.revision);
  assert.deepEqual(waha.readWahaSettings(admin).lines.map(item => item.session), previous.lines.map(item => item.session));
});

test("image sends convert to JPEG, voice uses conversion, and audio captions never silently disappear", async () => {
  const sharp = (await import("sharp")).default;
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
  const image = media.stageCrmMedia(seller, { contactId: inbound.contactId, name: "transparente.png", mimeType: "image/png", bytes: png });
  await waha.sendWahaMessage(seller, { contactId: inbound.contactId, text: "Imagem de teste", attachmentIds: [image.id], clientMessageId: randomUUID() });
  const imageBody = calls.filter(call => call.path === "/api/sendImage").at(-1).body;
  assert.equal(imageBody.file.mimetype, "image/jpeg"); assert.equal(imageBody.file.filename, "transparente.jpg");
  assert.equal(imageBody.caption, "Imagem de teste");
  const bytes = Buffer.from(imageBody.file.data, "base64");
  assert.ok(bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])));
  const decoded = await sharp(bytes).metadata(); assert.equal(decoded.width, 2); assert.equal(decoded.format, "jpeg");

  const wav = Buffer.alloc(48); wav.write("RIFF", 0); wav.writeUInt32LE(40, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(4, 40);
  const audio = media.stageCrmMedia(seller, { contactId: inbound.contactId, name: "audio.wav", mimeType: "audio/wav", bytes: wav });
  const before = count("crm_waha_outbox"), previousRequests = calls.length;
  await assert.rejects(waha.sendWahaMessage(seller, { contactId: inbound.contactId, text: "Legenda não suportada", attachmentIds: [audio.id], clientMessageId: randomUUID() }), /mensagens separadas/);
  assert.equal(count("crm_waha_outbox"), before); assert.equal(calls.length, previousRequests);
  const result = await waha.sendWahaMessage(seller, { contactId: inbound.contactId, text: "", attachmentIds: [audio.id], clientMessageId: randomUUID() });
  const voiceBody = calls.filter(call => call.path === "/api/sendVoice").at(-1).body;
  assert.equal(voiceBody.convert, true); assert.equal(voiceBody.file.mimetype, "audio/wav"); assert.equal(voiceBody.caption, "");
  assert.ok(crm.listCrmMessages(seller, inbound.contactId).find(item => item.id === result.id).attachments.some(item => item.kind === "audio"));
});

test("history catalog continues beyond 100 chats while each request processes only one conversation", async () => {
  save({ allowFullHistoryImport: true });
  const database = db.getDb();
  database.prepare("DELETE FROM crm_waha_history WHERE session=?").run(session);
  database.prepare("DELETE FROM crm_waha_history_scan WHERE session=?").run(session);
  database.prepare("DELETE FROM crm_waha_history_window WHERE session=?").run(session);
  const chats = Array.from({ length: 101 }, (_, index) => ({ id: `5585988${String(index).padStart(6, "0")}@c.us` }));
  const opportunityCount = count("crm_opportunities"), before = calls.length;
  override = async url => {
    if (url.pathname.endsWith("/chats")) {
      assert.equal(url.searchParams.get("sortBy"), "id"); assert.equal(url.searchParams.get("sortOrder"), "asc");
      const offset = Number(url.searchParams.get("offset")); return json(chats.slice(offset, offset + 100));
    }
    if (url.pathname.endsWith("/messages")) {
      const chatId = decodeURIComponent(url.pathname.split("/").at(-2));
      return json(chatId === chats.at(-1).id ? [message("beyond-100", chatId.split("@")[0], { timestamp: 1600000000 })] : []);
    }
  };
  try {
    let result = await waha.syncWahaHistory(admin);
    assert.equal(result.chats, 1); assert.equal(result.hasMore, true);
    result = await waha.syncWahaHistory(admin);
    assert.equal(Number(database.prepare("SELECT count(*) n FROM crm_waha_history WHERE session=?").get(session).n), 101);
    for (let index = 0; result.hasMore && index < 102; index++) {
      const messageRequests = calls.filter(call => call.path.endsWith("/messages")).length;
      result = await waha.syncWahaHistory(admin);
      assert.ok(calls.filter(call => call.path.endsWith("/messages")).length - messageRequests <= 1);
    }
    assert.equal(result.hasMore, false);
    assert.ok(database.prepare("SELECT id FROM crm_messages WHERE external_id='beyond-100'").get());
    assert.equal(count("crm_opportunities"), opportunityCount, "historical contacts must not become new sales leads");
    const catalogCalls = calls.slice(before).filter(call => call.path.endsWith("/chats"));
    assert.deepEqual(catalogCalls.map(call => new URLSearchParams(call.search).get("offset")), ["0", "100"]);
  } finally { override = undefined; }
});

test("history checkpoints retain their cutoff/offset through failure and count only new messages", async () => {
  const chatId = "5585977000001@c.us", historyRows = Array.from({ length: 12 }, (_, index) => message("checkpoint-" + index, "5585977000001", { timestamp: 1600000000 + index }));
  const beforeOpportunities = count("crm_opportunities"), observed = [];
  let fail = false;
  override = async url => {
    if (url.pathname.endsWith("/messages")) {
      const offset = Number(url.searchParams.get("offset")); observed.push({ offset, until: url.searchParams.get("filter.timestamp.lte"), limit: Number(url.searchParams.get("limit")) });
      if (fail) return json({ error: "temporary" }, 503);
      return json(historyRows.slice(offset, offset + Number(url.searchParams.get("limit"))));
    }
  };
  try {
    const first = await waha.syncWahaHistory(admin, { chatId, limit: 100 });
    assert.equal(first.processed, 10); assert.equal(first.hasMore, true); assert.equal(observed[0].limit, 10);
    const checkpoint = () => db.getDb().prepare("SELECT * FROM crm_waha_history WHERE session=? AND chat_id=?").get(session, chatId);
    assert.equal(checkpoint().offset, 10);
    const contactsBefore = calls.filter(call => call.path === "/api/contacts").length;
    fail = true; await assert.rejects(waha.syncWahaHistory(admin, { chatId }), /waha_http_503/);
    assert.equal(checkpoint().offset, 10); assert.equal(checkpoint().completed, 0);
    fail = false; const resumed = await waha.syncWahaHistory(admin, { chatId });
    assert.equal(resumed.processed, 2); assert.equal(resumed.hasMore, false);
    assert.equal(observed[1].until, observed[0].until); assert.equal(observed[2].until, observed[0].until);
    assert.equal(observed[2].offset, 10);
    assert.ok(calls.filter(call => call.path === "/api/contacts").length - contactsBefore <= 1, "one identity lookup is enough per chat/page");
    const total = count("crm_messages"), replay = await waha.syncWahaHistory(admin, { chatId });
    assert.equal(replay.processed, 0); assert.equal(count("crm_messages"), total); assert.equal(count("crm_opportunities"), beforeOpportunities);
    assert.equal(db.getDb().prepare("SELECT count(*) n FROM crm_messages WHERE external_id LIKE 'checkpoint-%' AND read_at IS NULL").get().n, 0);
  } finally { override = undefined; }
});

test("lost WAHA encryption key fails closed and does not touch legacy settings", async () => {
  const keyPath = join(directory, "security", "crm-waha.key");
  const key = await readFile(keyPath); assert.equal(key.length, 32);
  await rename(keyPath, keyPath + ".saved");
  assert.throws(() => waha.readWahaSettings(admin), /Chave WAHA ausente/);
  await rename(keyPath + ".saved", keyPath);
  assert.ok(waha.readWahaSettings(admin).apiKeyConfigured);
});
