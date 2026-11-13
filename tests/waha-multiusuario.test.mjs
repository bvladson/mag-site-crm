// Multiusuário (decisão de 09/11/2026): cada vendedora tem a sua linha (sessão WAHA e número próprios),
// conecta e desconecta pelo QR quantas vezes precisar, e as conversas ficam guardadas no CRM. O Admin vê
// todas as linhas e conversas, sem responder por padrão. O WhatsApp oficial da MAG nunca é conectado.
import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mag-waha-multi-"));
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
const admin = await actor("admin@multi.example.test", ["admin"]);
const ana = await actor("ana@multi.example.test", ["comercial"]);
const bia = await actor("bia@multi.example.test", ["comercial"]);
const caio = await actor("caio@multi.example.test", ["comercial"]);
const dho = await actor("dho@multi.example.test", ["dho"]);

const apiKey = "QA-API-KEY-MULTI";
const hmacKey = "QA-HMAC-KEY-MULTI";
const baseUrl = "http://waha.multi.test:3000";
const official = "5585998610074"; // WhatsApp comercial oficial da MAG (src/config/site.ts)
const anaPhone = "5585991110001";
const biaPhone = "5585992220002";
const legacySession = "mag-vendas";

// ---- Fake WAHA with state: sessions, QR, logout/stop and a message store per chat -----------------
const sessions = new Map();
const store = new Map(); // `${session}|${chat}` -> messages
const calls = [];
let sequence = 0;
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(String(url)),
    method = options.method || "GET",
    path = decodeURIComponent(parsed.pathname);
  assert.equal(parsed.origin, baseUrl);
  assert.equal(options.headers["X-Api-Key"], apiKey);
  calls.push({ path, method, search: parsed.search, body: options.body ? JSON.parse(options.body) : null });
  if (path === "/api/sessions" && method === "GET")
    return json([...sessions.entries()].map(([name, item]) => ({ name, ...item })));
  if (path === "/api/sessions" && method === "POST") {
    const body = JSON.parse(options.body);
    sessions.set(body.name, { status: "STOPPED", me: null, config: body.config });
    return json({ name: body.name }, 201);
  }
  let match = /^\/api\/sessions\/([^/]+)(?:\/(start|restart|stop|logout))?$/.exec(path);
  if (match) {
    const item = sessions.get(match[1]);
    if (!item) return json({ error: "not found" }, 404);
    if (!match[2] && method === "GET") return json({ name: match[1], ...item });
    if (!match[2] && method === "PUT") {
      item.config = JSON.parse(options.body).config;
      return json({ ok: true });
    }
    if (match[2] === "start" || match[2] === "restart") item.status = item.me ? "WORKING" : "SCAN_QR_CODE";
    if (match[2] === "logout") Object.assign(item, { status: "SCAN_QR_CODE", me: null });
    if (match[2] === "stop") item.status = "STOPPED";
    return json({ ok: true }, 201);
  }
  match = /^\/api\/([^/]+)\/auth\/qr$/.exec(path);
  if (match) return json({ data: "iVBORw0KGgoAAAANSUhEUg==" });
  // Chat list of the NOWEB store: individual chats as `@s.whatsapp.net`, newest activity first.
  match = /^\/api\/([^/]+)\/chats$/.exec(path);
  if (match) {
    const session = match[1],
      offset = Number(parsed.searchParams.get("offset") || 0),
      limit = Number(parsed.searchParams.get("limit") || 20);
    const chats = [...store.entries()]
      .filter(([key, list]) => key.startsWith(`${session}|`) && list.length)
      .map(([key, list]) => ({
        id: key.split("|")[1].replace(/@c\.us$/, "@s.whatsapp.net"),
        conversationTimestamp: Math.max(...list.map((item) => item.timestamp)),
      }))
      .sort((a, b) =>
        parsed.searchParams.get("sortBy") === "conversationTimestamp"
          ? b.conversationTimestamp - a.conversationTimestamp
          : a.id.localeCompare(b.id),
      );
    return json(chats.slice(offset, offset + limit));
  }
  match = /^\/api\/([^/]+)\/chats\/([^/]+)\/messages$/.exec(path);
  if (match) {
    const gte = Number(parsed.searchParams.get("filter.timestamp.gte") || 0),
      lte = Number(parsed.searchParams.get("filter.timestamp.lte") || Infinity),
      offset = Number(parsed.searchParams.get("offset") || 0),
      limit = Number(parsed.searchParams.get("limit") || 10);
    const list = (store.get(`${match[1]}|${match[2]}`) || [])
      .filter((item) => item.timestamp >= gte && item.timestamp <= lte)
      .sort((a, b) => b.timestamp - a.timestamp);
    return json(list.slice(offset, offset + limit));
  }
  if (path === "/api/contacts/check-exists")
    return json({ numberExists: true, chatId: `${parsed.searchParams.get("phone")}@c.us` });
  if (path === "/api/contacts") return json({ name: "Cliente" });
  if (path === "/api/sendText") {
    const body = JSON.parse(options.body);
    return json({ key: { remoteJid: body.chatId, fromMe: true, id: `3EBMULTI${++sequence}` }, status: "PENDING" }, 201);
  }
  throw new Error("Unexpected connector path: " + path);
};
const pair = (session, number) => Object.assign(sessions.get(session), { status: "WORKING", me: { id: `${number}@c.us` } });
const now = () => Math.floor(Date.now() / 1000);
let waha;
const deliver = async (event, session, payload, me) => {
  // WAHA sends the last status points with their timestamps: two reconnections are two events.
  if (event === "session.status" && !payload.statuses)
    payload = { ...payload, statuses: [{ status: payload.status, timestamp: Date.now() + ++sequence }] };
  const body = JSON.stringify({ id: randomUUID(), event, session, me: me || null, payload });
  const response = await waha.handleWahaWebhook(
    new Request("https://mag.example.test/api/crm/webhooks/waha", {
      method: "POST",
      headers: {
        "X-Webhook-Hmac-Algorithm": "sha512",
        "X-Webhook-Hmac": createHmac("sha512", hmacKey).update(body).digest("hex"),
      },
      body,
    }),
  );
  await waha.drainWahaEvents();
  return response;
};
const inbound = (id, from, text, extra = {}) => ({
  id: `false_${from}@c.us_${id}`,
  from: `${from}@c.us`,
  fromMe: false,
  timestamp: now(),
  body: text,
  ack: 1,
  ...extra,
});
const count = (table, where = "1", ...args) =>
  Number(db.getDb().prepare(`SELECT count(*) n FROM ${table} WHERE ${where}`).get(...args).n);
const lineOf = (user) => waha.readWahaSettings(admin).lines.find((line) => line.userId === user.id && line.status === "active");
test.after(async () => {
  globalThis.fetch = originalFetch;
  db.closeDb();
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
});

// ---- The production database before this release: release v1 settings (one number) + one stored chat --
const key = randomBytes(32);
mkdirSync(join(directory, "security"), { recursive: true, mode: 0o700 });
writeFileSync(join(directory, "security", "crm-waha.key"), key, { mode: 0o600 });
const encryptV1 = (value) => {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
};
crm.ensureCrmSchema();
db.getDb().exec("CREATE TABLE IF NOT EXISTS crm_waha_config(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,encrypted TEXT NOT NULL,updated_at TEXT NOT NULL)");
const v1 = { enabled: true, baseUrl, session: legacySession, ownerId: ana.id, expectedPhone: "", apiKey, hmacKey, allowFullHistoryImport: false, allowAdminReplies: false };
db.getDb().prepare("INSERT INTO crm_waha_config VALUES(1,3,?,?)").run(encryptV1(v1), new Date().toISOString());
const oldCustomer = crm.createContact(ana, { name: "Cliente de antes", phone: "5585981230001", email: "", city: "" });
db.getDb()
  .prepare("INSERT INTO crm_messages(id,contact_id,provider,account,external_id,sender,text,channel,status,sent_at,read_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
  .run(randomUUID(), oldCustomer.id, "waha", legacySession, "false_OLD0001", "cliente", "Mensagem guardada antes", "whatsapp", "received", new Date(Date.now() - 86_400_000).toISOString(), new Date().toISOString());
waha = await import("../src/lib/crm-waha.server.ts");

test("the single number of release v1 becomes the seller's line with the same session", async () => {
  const settings = waha.readWahaSettings(admin);
  assert.equal(settings.lines.length, 1);
  assert.deepEqual(
    { userId: settings.lines[0].userId, session: settings.lines[0].session, expectedPhone: settings.lines[0].expectedPhone, status: settings.lines[0].status },
    { userId: ana.id, session: legacySession, expectedPhone: "", status: "active" },
  );
  assert.equal(settings.revision, 3, "the stored settings are not rewritten (rollback keeps working)");
  assert.equal(count("crm_messages", "account=?", legacySession), 1, "stored conversations keep their session");
  // Reading again never creates a second line.
  waha.readWahaSettings(admin);
  assert.equal(count("crm_waha_lines"), 1);
  assert.ok(count("audit_log", "action='crm:waha:line:migrated'") === 1);
});

test("only administrators register lines: one active line per seller and per number, never MAG's official number", async () => {
  await assert.rejects(waha.saveWahaLine(ana, { userId: ana.id, expectedPhone: anaPhone }), /Forbidden/);
  await assert.rejects(waha.saveWahaLine(admin, { userId: dho.id, expectedPhone: "5585993330003" }), /vendedora ativa/);
  await assert.rejects(waha.saveWahaLine(admin, { userId: bia.id, expectedPhone: official }), /protegido/);
  await assert.rejects(waha.saveWahaLine(admin, { userId: bia.id, expectedPhone: "558598610074" }), /protegido/, "the official number without the 9th digit is the same line");
  await assert.rejects(waha.saveWahaLine(admin, { userId: ana.id, expectedPhone: anaPhone }), /já tem uma linha ativa/);
  const anaLine = lineOf(ana);
  await waha.saveWahaLine(admin, { id: anaLine.id, revision: anaLine.revision, userId: ana.id, expectedPhone: anaPhone });
  assert.equal(lineOf(ana).session, legacySession, "first number for a line without one keeps the session");
  await assert.rejects(waha.saveWahaLine(admin, { userId: bia.id, expectedPhone: "558591110001" }), /outra vendedora/);
  const created = await waha.saveWahaLine(admin, { userId: bia.id, expectedPhone: biaPhone });
  assert.match(created.session, /^mag-[0-9a-f]{10}$/, "session names never reveal the seller");
  const settings = waha.readWahaSettings(admin);
  waha.saveWahaSettings(admin, { revision: settings.revision, enabled: true, baseUrl, blockedPhones: ["(85) 99444-0004"] });
  await assert.rejects(waha.saveWahaLine(admin, { userId: caio.id, expectedPhone: "5585994440004" }), /protegido/);
  assert.ok(waha.readWahaSettings(admin).protectedPhones.includes(official));
  assert.ok(!JSON.stringify(waha.readWahaSettings(admin)).includes(apiKey));
});

test("each seller connects, reads the QR and disconnects only her own line", async () => {
  const anaLine = lineOf(ana),
    biaLine = lineOf(bia);
  assert.equal((await waha.readWahaConnection(caio)).state, "line_required");
  await assert.rejects(waha.controlWahaSession(caio, { action: "start" }), /Peça ao administrador/);
  await assert.rejects(waha.controlWahaSession(ana, { action: "start", lineId: biaLine.id }), /Forbidden/);
  await assert.rejects(waha.controlWahaSession(dho, { action: "status" }), /Forbidden/);
  await assert.rejects(waha.controlWahaSession(ana, { action: "configure" }), /Forbidden/);
  const started = await waha.controlWahaSession(ana, { action: "start" });
  assert.equal(started.state, "SCAN_QR_CODE");
  assert.equal(started.ownLine, true);
  const qr = await waha.controlWahaSession(ana, { action: "qr" });
  assert.ok(qr.qrCode.startsWith("data:image/png;base64,"));
  const created = calls.find((call) => call.method === "POST" && call.path === "/api/sessions");
  assert.equal(created.body.name, legacySession);
  assert.equal(created.body.config.noweb.store.enabled, true, "history storage is on before the first QR");
  pair(legacySession, "558591110001"); // WhatsApp reports the authorized mobile without the 9th digit
  assert.equal((await waha.readWahaConnection(ana)).connected, true);
  await deliver("session.status", legacySession, { status: "WORKING" }, { id: "558591110001@c.us" });
  await waha.controlWahaSession(bia, { action: "start" });
  pair(biaLine.session, biaPhone);
  assert.equal((await waha.readWahaConnection(bia)).connected, true);
  assert.equal(anaLine.id !== biaLine.id, true);
});

let anaCustomer, biaCustomer;
test("events are routed by session to the right portfolio; sellers never see each other's conversations", async () => {
  const biaSession = lineOf(bia).session;
  assert.equal((await deliver("message.any", legacySession, inbound("A1", "5585981110010", "Quero cadeiras"), { id: "558591110001@c.us" })).status, 202);
  assert.equal((await deliver("message.any", biaSession, inbound("B1", "5585982220020", "Quero mesas"), { id: `${biaPhone}@c.us` })).status, 202);
  assert.equal((await deliver("message.any", "mag-desconhecida", inbound("X1", "5585983330030", "?"))).status, 400);
  anaCustomer = crm.getCrmBootstrap(ana).contacts.find((item) => item.phone === "5585981110010");
  biaCustomer = crm.getCrmBootstrap(bia).contacts.find((item) => item.phone === "5585982220020");
  assert.ok(anaCustomer && anaCustomer.ownerId === ana.id);
  assert.ok(biaCustomer && biaCustomer.ownerId === bia.id);
  assert.ok(!crm.getCrmBootstrap(ana).contacts.some((item) => item.id === biaCustomer.id));
  assert.ok(!crm.getCrmBootstrap(bia).contacts.some((item) => item.id === anaCustomer.id));
  const everyone = crm.getCrmBootstrap(admin).contacts.map((item) => item.id);
  assert.ok(everyone.includes(anaCustomer.id) && everyone.includes(biaCustomer.id), "only the administrator sees everything");
  assert.throws(() => crm.listCrmMessages(ana, biaCustomer.id), /Forbidden/);
  await assert.rejects(waha.syncWahaContactHistory(ana, biaCustomer.id), /Forbidden/);
});

test("replies leave through the line of the contact's seller; administrators supervise without replying", async () => {
  await waha.sendWahaMessage(bia, { contactId: biaCustomer.id, text: "Olá, sou a Bia", clientMessageId: randomUUID() });
  assert.equal(calls.filter((call) => call.path === "/api/sendText").at(-1).body.session, lineOf(bia).session);
  await assert.rejects(waha.sendWahaMessage(ana, { contactId: biaCustomer.id, text: "x", clientMessageId: randomUUID() }), /Forbidden/);
  const supervision = await waha.readWahaConnection(admin);
  assert.equal(supervision.state, "supervision");
  assert.equal(supervision.canReply, false);
  assert.deepEqual(supervision.lines.map((line) => [line.ownerId, line.connected, line.canReply]).sort(), [[ana.id, true, false], [bia.id, true, false]].sort());
  await assert.rejects(waha.sendWahaMessage(admin, { contactId: anaCustomer.id, text: "Admin", clientMessageId: randomUUID() }), /Somente a vendedora responsável/);
  const settings = waha.readWahaSettings(admin);
  waha.saveWahaSettings(admin, { revision: settings.revision, enabled: true, baseUrl, allowAdminReplies: true });
  await waha.sendWahaMessage(admin, { contactId: anaCustomer.id, text: "Supervisão autorizada", clientMessageId: randomUUID() });
  assert.equal(calls.filter((call) => call.path === "/api/sendText").at(-1).body.session, legacySession, "through Ana's line");
  const again = waha.readWahaSettings(admin);
  waha.saveWahaSettings(admin, { revision: again.revision, enabled: true, baseUrl, allowAdminReplies: false });
  assert.equal((await waha.readWahaConnection(ana)).lines, undefined, "sellers never receive the list of lines");
});

const recoveryRow = (session = legacySession) =>
  db.getDb().prepare("SELECT * FROM crm_waha_recovery WHERE session=?").get(session);
const runCatchUp = async (session = legacySession) => {
  db.getDb().prepare("UPDATE crm_waha_recovery SET available_at=0 WHERE session=?").run(session);
  await waha.drainWahaEvents();
};
const posts = (from, session = legacySession) =>
  calls
    .slice(from)
    .filter((call) => call.method === "POST" && call.path.startsWith(`/api/sessions/${session}/`))
    .map((call) => call.path.split("/").at(-1));
const leadOf = (user, phone) => {
  const boot = crm.getCrmBootstrap(user),
    contact = boot.contacts.find((item) => item.phone === phone);
  return { contact, opportunities: contact ? boot.opportunities.filter((item) => item.contactId === contact.id) : [] };
};
const readAt = (externalId) =>
  db.getDb().prepare("SELECT read_at FROM crm_messages WHERE external_id=?").get(externalId)?.read_at;

test("unlinking keeps every conversation; the reconnection brings what arrived meanwhile, existing and new conversations, once", async () => {
  // The line had been in service before this gap; overlap must never precede its first baseline.
  db.getDb().prepare("UPDATE crm_waha_watermarks SET baseline=? WHERE session=?").run(now() - 86400, legacySession);
  const stored = count("crm_messages", "account=?", legacySession);
  const before = calls.length,
    startedAt = Date.now();
  const unlinked = await waha.controlWahaSession(ana, { action: "logout" });
  assert.deepEqual(posts(before), ["logout", "stop"], "unlinking a connected line removes the device");
  assert.equal(unlinked.connected, false);
  assert.match(unlinked.message, /desvinculado/i);
  assert.match(unlinked.message, /novo QR Code/);
  await deliver("session.status", legacySession, { status: "STOPPED" });
  assert.equal(count("crm_messages", "account=?", legacySession), stored, "nothing stored is removed");
  assert.ok(recoveryRow().offline_since >= startedAt, "the CRM knows since when the line is offline");
  assert.equal(recoveryRow().mode, "unlinked");
  assert.equal((await waha.readWahaConnection(ana)).state, "STOPPED");
  // While unlinked: the customer wrote and Ana answered on the phone; two new people wrote (one was
  // already answered on the phone); an old conversation had no activity during the gap.
  const t = now();
  // The last interaction of Ana's existing opportunity is older than the gap.
  db.getDb()
    .prepare("UPDATE crm_opportunities SET last_interaction=? WHERE contact_id=?")
    .run(new Date((t - 3600) * 1000).toISOString(), anaCustomer.id);
  store.set(`${legacySession}|5585981110010@c.us`, [
    inbound("GAP1", "5585981110010", "Ainda tem as cadeiras?", { timestamp: t - 30 }),
    { id: "true_5585981110010@c.us_GAP2", from: "5585981110010@c.us", fromMe: true, timestamp: t - 20, body: "Tenho sim", ack: 2 },
  ]);
  store.set(`${legacySession}|5585989990090@c.us`, [inbound("GAP3", "5585989990090", "Pessoa nova", { timestamp: t - 10 })]);
  store.set(`${legacySession}|5585986660060@c.us`, [
    inbound("GAP4", "5585986660060", "Oi, vi o anúncio", { timestamp: t - 15 }),
    { id: "true_5585986660060@c.us_GAP5", from: "5585986660060@c.us", fromMe: true, timestamp: t - 5, body: "Olá! Já te mando", ack: 2 },
  ]);
  store.set(`${legacySession}|5585987770070@c.us`, [inbound("OLD9", "5585987770070", "Conversa antiga", { timestamp: t - 7200 })]);
  const opportunities = count("crm_opportunities"),
    contacts = count("crm_contacts");
  await waha.controlWahaSession(ana, { action: "start" });
  assert.equal(sessions.get(legacySession).status, "SCAN_QR_CODE", "unlinked: a new QR, same line and session");
  pair(legacySession, anaPhone);
  await deliver("session.status", legacySession, { status: "WORKING" }, { id: `${anaPhone}@c.us` });
  assert.equal(recoveryRow().state, "pending");
  assert.ok(recoveryRow().available_at > Date.now() + 60_000, "the catch-up waits for WhatsApp to deliver the history");
  assert.ok(recoveryRow().window_start <= Math.floor(startedAt / 1000) - 600 + 1, "window: since the line went offline, with overlap");
  assert.equal(recoveryRow().offline_since, null);
  await runCatchUp();
  const caught = crm.listCrmMessages(ana, anaCustomer.id).map((item) => item.externalId);
  assert.ok(caught.includes("false_GAP1") && caught.includes("true_GAP2"));
  assert.equal(db.getDb().prepare("SELECT sender FROM crm_messages WHERE external_id='true_GAP2'").get().sender, "vendedora");
  assert.equal(readAt("false_GAP1"), null, "as if it had arrived live: unread until the seller opens it");
  assert.equal(leadOf(ana, "5585981110010").opportunities[0].awaitingReply, false, "Ana answered on the phone after the customer");
  // New people become leads of Ana's portfolio, ready for treatment.
  const newcomer = leadOf(ana, "5585989990090");
  assert.equal(newcomer.contact.ownerId, ana.id);
  assert.equal(newcomer.opportunities.length, 1);
  assert.equal(newcomer.opportunities[0].awaitingReply, true);
  assert.match(newcomer.opportunities[0].interest, /enquanto a linha estava desconectada/);
  assert.equal(readAt("false_GAP3"), null);
  const answered = leadOf(ana, "5585986660060");
  assert.equal(answered.opportunities.length, 1);
  assert.equal(answered.opportunities[0].awaitingReply, false, "recorded in the order they happened");
  assert.ok(!crm.getCrmBootstrap(bia).contacts.some((item) => item.id === newcomer.contact.id), "other sellers never see it");
  assert.ok(crm.getCrmBootstrap(admin).contacts.some((item) => item.id === newcomer.contact.id), "the administrator does");
  assert.equal(count("crm_messages", "external_id='false_OLD9'"), 0, "conversations without activity in the gap are not imported");
  assert.equal(count("crm_contacts"), contacts + 2);
  assert.equal(count("crm_opportunities"), opportunities + 2);
  assert.deepEqual([recoveryRow().passes, recoveryRow().processed, recoveryRow().new_chats], [1, 5, 2]);
  const summary = (await waha.readWahaConnection(ana)).recovery;
  assert.deepEqual(
    [summary.state, summary.processed, summary.newChats, summary.includesNewChats],
    ["pending", 5, 2, true],
  );
  assert.ok(count("audit_log", "action='crm:waha:recovery'") >= 1);
  const total = count("crm_messages");
  await runCatchUp();
  assert.equal(recoveryRow().state, "done");
  assert.equal(count("crm_messages"), total, "the second pass never duplicates messages");
  assert.equal(count("crm_opportunities"), opportunities + 2, "nor opportunities");
  assert.equal(count("crm_contacts"), contacts + 2, "nor contacts");
  assert.equal(
    Number(db.getDb().prepare("SELECT count(*) n FROM (SELECT external_id FROM crm_messages GROUP BY provider,account,external_id HAVING count(*)>1)").get().n),
    0,
  );
});

test("pausing keeps the phone linked: resuming needs no QR and what arrived meanwhile enters the CRM once", async () => {
  const me = { id: `${anaPhone}@c.us` };
  const before = calls.length;
  const paused = await waha.controlWahaSession(ana, { action: "pause" });
  assert.deepEqual(posts(before), ["stop"], "pausing never logs out");
  assert.equal(paused.state, "PAUSED");
  assert.match(paused.message, /Retomar/);
  await deliver("session.status", legacySession, { status: "STOPPED" });
  assert.equal(recoveryRow().mode, "paused");
  assert.ok(recoveryRow().offline_since);
  assert.equal((await waha.readWahaConnection(ana)).state, "PAUSED");
  const supervision = await waha.readWahaConnection(admin);
  assert.equal(supervision.lines.find((line) => line.ownerId === ana.id).state, "PAUSED");
  await assert.rejects(waha.controlWahaSession(ana, { action: "pause" }), /conectado/);
  // While paused: an existing customer and a new person wrote.
  const t = now();
  store.set(`${legacySession}|5585981110010@c.us`, [
    ...store.get(`${legacySession}|5585981110010@c.us`),
    inbound("P1", "5585981110010", "Pode me ligar?", { timestamp: t }),
  ]);
  store.set(`${legacySession}|5585985550050@c.us`, [inbound("P2", "5585985550050", "Vi no Instagram", { timestamp: t })]);
  const resumed = await waha.controlWahaSession(ana, { action: "start" });
  assert.equal(sessions.get(legacySession).status, "WORKING", "no QR: the phone stayed linked");
  assert.equal(resumed.connected, true);
  await deliver("session.status", legacySession, { status: "WORKING" }, me);
  assert.equal(recoveryRow().mode, null);
  // WhatsApp delivers what it kept for the linked device: P2 arrives live.
  await deliver("message.any", legacySession, inbound("P2", "5585985550050", "Vi no Instagram", { timestamp: t }), me);
  assert.equal(leadOf(ana, "5585985550050").opportunities.length, 1);
  // The catch-up adds what did not arrive live (P1) and never duplicates P2.
  await runCatchUp();
  assert.equal(count("crm_messages", "external_id='false_P1'"), 1);
  assert.equal(count("crm_messages", "external_id='false_P2'"), 1);
  assert.equal(leadOf(ana, "5585985550050").opportunities.length, 1);
  assert.deepEqual([recoveryRow().processed, recoveryRow().new_chats], [1, 0]);
  await runCatchUp();
  assert.equal(recoveryRow().state, "done");
});

test("unlinking a paused line resumes it first so WhatsApp removes the device; a second gap is never lost", async () => {
  await waha.controlWahaSession(ana, { action: "pause" });
  await deliver("session.status", legacySession, { status: "STOPPED" });
  const pausedAt = recoveryRow().offline_since;
  const before = calls.length;
  const unlinked = await waha.controlWahaSession(ana, { action: "logout" });
  assert.deepEqual(posts(before), ["start", "logout", "stop"]);
  assert.match(unlinked.message, /desvinculado/i);
  // The brief resume reported WORKING (catch-up scheduled) and the line went offline again before it ran.
  await deliver("session.status", legacySession, { status: "WORKING" }, { id: `${anaPhone}@c.us` });
  await deliver("session.status", legacySession, { status: "STOPPED" });
  await runCatchUp();
  assert.equal(recoveryRow().state, "idle", "offline again: the window waits for the next connection");
  pair(legacySession, anaPhone);
  await deliver("session.status", legacySession, { status: "WORKING" }, { id: `${anaPhone}@c.us` });
  assert.ok(recoveryRow().window_start <= Math.floor(pausedAt / 1000) - 600, "the window still starts at the pause");
  await runCatchUp();
  await runCatchUp();
  assert.equal(recoveryRow().state, "done");
});

test("a phone that is not the line's number is unlinked at once and nothing from it is recorded", async () => {
  const biaSession = lineOf(bia).session;
  pair(biaSession, "5585987654321");
  const before = calls.length;
  await deliver("session.status", biaSession, { status: "WORKING" }, { id: "5585987654321@c.us" });
  assert.deepEqual(calls.slice(before).filter((call) => call.method === "POST").map((call) => call.path.split("/").at(-1)), ["logout", "stop"]);
  assert.equal(sessions.get(biaSession).status, "STOPPED");
  assert.equal(db.getDb().prepare("SELECT error_code FROM crm_waha_runtime WHERE session=?").get(biaSession).error_code, "number_mismatch");
  assert.ok(count("audit_log", "action='crm:waha:session:wrong-number'") >= 1);
  pair(biaSession, "5585987654321");
  const messages = count("crm_messages");
  await deliver("message.any", biaSession, inbound("WRONG1", "5585980000001", "não deve entrar"), { id: "5585987654321@c.us" });
  assert.equal(count("crm_messages"), messages);
  assert.ok(waha.readWahaSettings(admin).events.some((event) => event.errorCode === "number_mismatch"));
  pair(biaSession, biaPhone);
});

test("a new number moves the line to a fresh session; the old conversations stay in the CRM", async () => {
  const line = lineOf(bia),
    oldSession = line.session;
  await assert.rejects(waha.saveWahaLine(admin, { id: line.id, revision: line.revision, userId: bia.id, expectedPhone: "5585995550005" }), /Desconecte/);
  await waha.controlWahaSession(bia, { action: "logout" });
  const messages = count("crm_messages", "account=?", oldSession);
  assert.ok(messages > 0);
  const saved = await waha.saveWahaLine(admin, { id: line.id, revision: line.revision, userId: bia.id, expectedPhone: "5585995550005" });
  assert.notEqual(saved.session, oldSession);
  assert.equal(count("crm_messages", "account=?", oldSession), messages);
  assert.ok(crm.listCrmMessages(bia, biaCustomer.id).length > 0, "Bia still reads the conversation");
  assert.equal((await deliver("message.any", oldSession, inbound("OLD2", "5585982220020", "?"))).status, 400, "the previous session no longer feeds the CRM");
  await assert.rejects(waha.saveWahaLine(admin, { id: line.id, revision: line.revision, userId: caio.id, expectedPhone: "5585995550005" }), /mudou em outra sessão/);
  const current = lineOf(bia);
  await assert.rejects(waha.saveWahaLine(admin, { id: current.id, revision: current.revision, userId: caio.id, expectedPhone: "5585995550005" }), /nova linha/);
});

test("the first connection of a new number never imports the conversations already on the phone", async () => {
  const line = lineOf(bia);
  store.set(`${line.session}|5585984440040@c.us`, [inbound("PHONE1", "5585984440040", "Conversa que já estava no celular", { timestamp: now() - 60 })]);
  const messages = count("crm_messages"),
    contacts = count("crm_contacts");
  await waha.controlWahaSession(bia, { action: "start" });
  pair(line.session, "5585995550005");
  await deliver("session.status", line.session, { status: "WORKING" }, { id: "5585995550005@c.us" });
  assert.equal(recoveryRow(line.session), undefined, "first connection establishes a baseline without scheduling history");
  await runCatchUp(line.session);
  await runCatchUp(line.session);
  assert.equal(recoveryRow(line.session), undefined);
  assert.equal(count("crm_messages"), messages);
  assert.equal(count("crm_contacts"), contacts);
  assert.equal((await waha.readWahaConnection(bia)).recovery, null);
});

test("offboarding disconnects and disables the line; the portfolio stays visible to the administrator", async () => {
  const line = lineOf(bia);
  await waha.controlWahaSession(bia, { action: "start" });
  pair(line.session, "5585995550005");
  await assert.rejects(waha.setWahaLineStatus(bia, { id: line.id, revision: line.revision, status: "disabled" }), /Forbidden/);
  const before = calls.length;
  await waha.setWahaLineStatus(admin, { id: line.id, revision: line.revision, status: "disabled" });
  assert.deepEqual(calls.slice(before).filter((call) => call.method === "POST").map((call) => call.path.split("/").at(-1)), ["logout", "stop"]);
  assert.equal((await waha.readWahaConnection(bia)).state, "line_required");
  assert.equal((await deliver("message.any", line.session, inbound("OFF1", "5585982220020", "?"))).status, 400);
  assert.ok(crm.getCrmBootstrap(admin).contacts.some((item) => item.id === biaCustomer.id), "conversations are kept");
  const disabled = waha.readWahaSettings(admin).lines.find((item) => item.id === line.id);
  assert.equal(disabled.status, "disabled");
  await waha.saveWahaLine(admin, { userId: caio.id, expectedPhone: "5585995550005" });
  await assert.rejects(waha.setWahaLineStatus(admin, { id: line.id, revision: disabled.revision, status: "active" }), /outra vendedora/);
  const caioLine = lineOf(caio);
  await waha.setWahaLineStatus(admin, { id: caioLine.id, revision: caioLine.revision, status: "disabled" });
  await waha.setWahaLineStatus(admin, { id: line.id, revision: disabled.revision, status: "active" });
  assert.equal(lineOf(bia).session, line.session, "reactivation keeps the session and its history");
  assert.deepEqual(
    [recoveryRow(line.session)?.offline_since ?? null, recoveryRow(line.session)?.window_start ?? null],
    [null, null],
    "a disabled period is not a pause: nothing from it is imported on reactivation",
  );
});

test("history of a conversation and the general import never cross into another seller's line", async () => {
  store.set(`${legacySession}|5585981110010@c.us`, [inbound("HIST1", "5585981110010", "Mensagem antiga", { timestamp: 1700000000 })]);
  pair(legacySession, anaPhone);
  const result = await waha.syncWahaContactHistory(ana, anaCustomer.id);
  assert.equal(result.processed, 1);
  assert.ok(calls.filter((call) => call.path.endsWith("/messages")).at(-1).path.startsWith(`/api/${legacySession}/`));
  await assert.rejects(waha.syncWahaHistory(ana, {}), /Forbidden/);
  await assert.rejects(waha.syncWahaHistory(admin, {}), /Escolha a linha|desativada/);
});
