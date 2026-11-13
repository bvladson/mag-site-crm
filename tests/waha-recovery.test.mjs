import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mag-waha-recovery-"));
process.env.SITE_DATA_DIR = directory;
process.env.CRM_DISABLE_WORKER = "1";
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const crm = await import("../src/lib/crm.server.ts");
const waha = await import("../src/lib/crm-waha.server.ts");
const actor = async (email, roles) => ({ id: (await auth.createUser(email, "QA-Strong-Password-123", roles)).id, email, roles, created_at: "" });
const admin = await actor("admin@recovery.example.test", ["admin"]);
const seller = await actor("seller@recovery.example.test", ["comercial"]);
const other = await actor("other@recovery.example.test", ["comercial"]);
const baseUrl = "http://waha.recovery.test:3000", session = "recovery-test", expectedPhone = "5585991110001";
const apiKey = "QA-KEY-RECOVERY", hmacKey = "QA-HMAC-RECOVERY";
const seconds = () => Math.floor(Date.now() / 1000);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const store = new Map(), calls = [];
let state = "WORKING", failSession = false, failMedia = false, failChat = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(String(url)), path = decodeURIComponent(parsed.pathname);
  assert.equal(parsed.origin, baseUrl);
  assert.equal(options.headers["X-Api-Key"], apiKey);
  calls.push({ path, method: options.method || "GET" });
  const info = { name: session, status: state, me: { id: expectedPhone + "@c.us" } };
  if (path === "/api/sessions") return json([info]);
  if (path === `/api/sessions/${session}`) { if (failSession) throw new Error("simulated outage"); return json(info); }
  if (path === `/api/${session}/chats`) {
    const chats = [...store.entries()].filter(([, messages]) => messages.length).map(([id, messages]) => ({ id: id.replace("@c.us", "@s.whatsapp.net"), conversationTimestamp: Math.max(...messages.map(message => message.timestamp)) })).sort((a,b) => parsed.searchParams.get("sortBy")==="id" ? a.id.localeCompare(b.id) : b.conversationTimestamp-a.conversationTimestamp || a.id.localeCompare(b.id));
    const offset = Number(parsed.searchParams.get("offset")), limit = Number(parsed.searchParams.get("limit"));
    return json(chats.slice(offset, offset + limit));
  }
  const match = new RegExp(`^/api/${session}/chats/([^/]+)/messages(?:/([^/]+))?$`).exec(path);
  if (match) {
    if (match[2]) { if (failMedia) return json({ error: "unavailable" }, 503); return json({ media: { url: baseUrl + "/api/files/doc.pdf", filename: "documento.pdf", mimetype: "application/pdf" } }); }
    if (match[1] === failChat) return json({ error: "unavailable" }, 503);
    const since = Number(parsed.searchParams.get("filter.timestamp.gte")), until = Number(parsed.searchParams.get("filter.timestamp.lte") || Infinity);
    const offset = Number(parsed.searchParams.get("offset")), limit = Number(parsed.searchParams.get("limit"));
    return json((store.get(match[1]) || []).filter(message => message.timestamp >= since && message.timestamp <= until).sort((a,b) => b.timestamp-a.timestamp || b.id.localeCompare(a.id)).slice(offset,offset+limit));
  }
  if (path === "/api/contacts") return json({ name: "Contato de homologação" });
  if (path === "/api/files/doc.pdf") return new Response(Buffer.from("%PDF-1.7\nRecovery test\n%%EOF"), { headers: { "Content-Type": "application/pdf" } });
  throw new Error("Unexpected recovery call: " + path);
};
waha.saveWahaSettings(admin, { revision: 0, enabled: true, baseUrl, apiKey, hmacKey });
const line = await waha.saveWahaLine(admin, { userId: seller.id, expectedPhone, session });
const row = () => db.getDb().prepare("SELECT * FROM crm_waha_recovery WHERE session=?").get(session);
const marker = () => db.getDb().prepare("SELECT * FROM crm_waha_watermarks WHERE session=?").get(session);
const count = (table) => Number(db.getDb().prepare(`SELECT count(*) n FROM ${table}`).get().n);
const inbound = (id, phone, timestamp, extra = {}) => ({ id: `false_${phone}@c.us_${id}`, from: `${phone}@c.us`, fromMe: false, timestamp, body: `Mensagem ${id}`, ack: 1, ...extra });
const beginWindow = () => {
  waha.ensureWahaSchema();
  db.getDb().prepare("DELETE FROM crm_waha_recovery WHERE session=?").run(session);
  db.getDb().prepare("UPDATE crm_waha_watermarks SET baseline=?,covered_until=?,last_probe=0 WHERE session=?").run(seconds()-86400,seconds()-3600,session);
};
const step = async () => {
  db.getDb().prepare("UPDATE crm_waha_recovery SET available_at=0 WHERE session=?").run(session);
  await waha.drainWahaEvents();
};
const finish = async () => {
  for (let n=0; n<15 && row()?.state !== "done"; n++) {
    if (["partial","error"].includes(row()?.state)) await waha.retryWahaRecovery(seller);
    await step();
  }
  assert.equal(row()?.state,"done");
};
test.after(async () => { globalThis.fetch = originalFetch; db.closeDb(); await rm(directory, { recursive: true, force: true, maxRetries: 5 }); });

test("first working observation establishes a durable baseline without fetching even an existing conversation's past", async () => {
  const contact = crm.createContact(seller, { name: "Cliente existente", phone: "5585992220002", email: "", city: "" });
  store.set("5585992220002@c.us", [inbound("PAST", "5585992220002", seconds()-120)]);
  const before = calls.length;
  await waha.drainWahaEvents();
  assert.ok(marker().baseline >= seconds()-2);
  assert.equal(row(), undefined);
  assert.equal(count("crm_messages"),0);
  assert.ok(!calls.slice(before).some(call => call.path.endsWith("/chats") || call.path.endsWith("/messages")));
  assert.equal(crm.listCrmMessages(seller,contact.id).length,0);
});

test("legacy unknown-window checkpoints are cancelled instead of importing first-connection history", async () => {
  db.getDb().prepare("INSERT INTO crm_waha_recovery(session,state,available_at,updated_at,window_start) VALUES(?,'pending',0,?,NULL)").run(session,new Date().toISOString());
  const before=count("crm_messages"),from=calls.length;
  await waha.drainWahaEvents();
  assert.equal(row().state,"cancelled");
  assert.equal(row().error_code,"unknown_window");
  assert.equal(count("crm_messages"),before);
  assert.ok(!calls.slice(from).some(call=>call.path.endsWith("/messages")));
});

test("backend restart with WAHA continuously WORKING recovers missed live and phone-sent messages once", async () => {
  store.clear(); beginWindow();
  const t = seconds()-60, phone = "5585993330003";
  store.set(phone+"@c.us", [inbound("MISSED",phone,t), { ...inbound("PHONE",phone,t+1), id:`true_${phone}@c.us_PHONE`,fromMe:true,body:"Resposta pelo celular" }]);
  const before = calls.length;
  db.closeDb(); // Reopen through the worker: neither a status webhook nor a UI request is available.
  await waha.drainWahaEvents();
  assert.equal(count("crm_messages"),2);
  assert.equal(count("crm_opportunities"),1);
  const boot = crm.getCrmBootstrap(seller), contact = boot.contacts.find(item => item.phone === phone);
  assert.equal(boot.opportunities.find(item => item.contactId===contact.id).awaitingReply,false);
  assert.equal(crm.listCrmMessages(seller,contact.id).find(item=>item.externalId==="true_PHONE").from,"vendedora");
  assert.equal(marker().covered_until < t,true,"watermark waits for both completed passes");
  await finish();
  assert.ok(marker().covered_until>=t);
  assert.equal(count("crm_messages"),2);
  assert.ok(calls.slice(before).every(call=>call.method==="GET"),"reconciliation never starts sessions or sends messages");
});

test("more than 100 messages remains visibly partial and continues without duplicates or advancing coverage early", async () => {
  store.clear(); beginWindow();
  const phone="5585994440004", start=seconds()-1000;
  store.set(phone+"@c.us",Array.from({length:105},(_,index)=>inbound(`PAGE${index}`,phone,start+index)));
  const before=count("crm_messages"), coverage=marker().covered_until;
  await waha.drainWahaEvents();
  assert.equal(row().state,"partial");
  assert.equal(row().error_code,"limit");
  assert.equal(marker().covered_until,coverage);
  const summary=(await waha.readWahaConnection(seller)).recovery;
  assert.equal(summary.hasMore,true);
  assert.equal(summary.processed,100);
  await assert.rejects(waha.retryWahaRecovery(other,{lineId:line.id}),/Forbidden/);
  await finish();
  assert.equal(count("crm_messages"),before+105);
  assert.equal(row().failed_count,0);
  assert.ok(!String(row().cursor).includes("Mensagem PAGE"),"checkpoint does not store clear text");
});

test("more than 300 chats can be continued without skipping a chat whose activity changes between pages", async () => {
  store.clear(); beginWindow();
  const t=seconds()-60;
  for (let index=0;index<301;index++) {
    const phone="558599"+String(5000000+index);
    store.set(phone+"@c.us",[inbound(`CAT${index}`,phone,t)]);
  }
  const before=count("crm_messages");
  await waha.drainWahaEvents();
  // A slow machine may checkpoint the 10s work budget before it reaches the catalog cap.
  for(let n=0;n<8 && row().state==="pending";n++) await step();
  assert.equal(row().state,"partial");
  assert.equal(row().error_code,"limit");
  const lastPhone="558599"+String(5000300);
  // This unseen chat would move from offset 300 to the front under activity sorting.
  store.get(lastPhone+"@c.us").push(inbound("CAT_MOVED",lastPhone,Number(row().window_end)-1));
  await waha.retryWahaRecovery(seller);
  await step();
  assert.ok(db.getDb().prepare("SELECT id FROM crm_messages WHERE external_id='false_CAT300'").get(),"the unseen chat is present before the second pass");
  await finish();
  assert.equal(count("crm_messages"),before+302);
  assert.equal(row().processed,302);
  assert.ok(calls.filter(call=>call.path===`/api/${session}/chats`).length>0);
});

test("an older incoming page cannot revive awaiting-reply after a newer page of phone replies", async () => {
  store.clear(); beginWindow();
  const phone="5585996660006", t=seconds()-1000;
  store.set(phone+"@c.us",Array.from({length:105},(_,index)=>index<5
    ? inbound(`ORDER${index}`,phone,t+index)
    : {...inbound(`ORDER${index}`,phone,t+index),id:`true_${phone}@c.us_ORDER${index}`,fromMe:true}));
  await waha.drainWahaEvents();
  assert.equal(row().state,"partial");
  let bootstrap=crm.getCrmBootstrap(seller),contact=bootstrap.contacts.find(item=>item.phone===phone);
  assert.ok(contact);
  assert.ok(!bootstrap.opportunities.some(item=>item.contactId===contact.id),"only replies in the first page do not create a lead");
  await finish();
  bootstrap=crm.getCrmBootstrap(seller);
  const opportunity=bootstrap.opportunities.find(item=>item.contactId===contact.id);
  assert.ok(opportunity);
  assert.equal(opportunity.awaitingReply,false);
  assert.equal(opportunity.lastInteraction,new Date((t+104)*1000).toISOString());
});

test("per-chat and media failures remain partial and retry only failed pages without duplicating leads", async () => {
  store.clear(); beginWindow();
  const phone="5585997770007", failedPhone="5585998880008", t=seconds()-60;
  store.set(phone+"@c.us",[inbound("MEDIA",phone,t,{hasMedia:true,media:{mimetype:"application/pdf"}})]);
  store.set(failedPhone+"@c.us",[inbound("FETCH",failedPhone,t)]);
  failMedia=true; failChat=failedPhone+"@c.us";
  const coverage=marker().covered_until, before=count("crm_messages"), opportunities=count("crm_opportunities");
  await waha.drainWahaEvents();
  assert.equal(row().state,"partial");
  assert.equal(row().error_code,"recovery_failed");
  assert.equal(row().failed_count,2);
  assert.equal(marker().covered_until,coverage);
  const summary=(await waha.readWahaConnection(seller)).recovery;
  assert.equal(summary.failedCount,2);
  assert.equal(summary.hasMore,true);
  assert.ok(!String(row().cursor).includes("Mensagem MEDIA"));
  failMedia=false; failChat=null;
  await finish();
  assert.equal(count("crm_messages"),before+2);
  assert.equal(count("crm_opportunities"),opportunities+2);
  const message=db.getDb().prepare("SELECT id FROM crm_messages WHERE external_id='false_MEDIA'").get();
  const contact=db.getDb().prepare("SELECT contact_id FROM crm_messages WHERE id=?").get(message.id);
  assert.equal(crm.listCrmMessages(seller,contact.contact_id).find(item=>item.id===message.id).attachments[0].status,"ready");
});

test("repeated connector failures are shown as errors and can be explicitly resumed without resending", async () => {
  store.clear(); beginWindow();
  // First pass creates a durable pending checkpoint; the connector fails before the second.
  await waha.drainWahaEvents();
  const coverage=marker().covered_until;
  failSession=true;
  for(let n=0;n<5;n++) await step();
  assert.equal(row().state,"error");
  assert.equal(row().error_code,"waha_unavailable");
  assert.equal(marker().covered_until,coverage);
  assert.equal((await waha.readWahaConnection(seller)).recovery.state,"error");
  failSession=false;
  await finish();
  assert.equal(row().error_code,null);
  assert.ok(calls.every(call=>call.method==="GET"));
});

test("disabling and re-enabling never recovers messages from the disabled period", async () => {
  const current=waha.readWahaSettings(admin);
  waha.saveWahaSettings(admin,{revision:current.revision,enabled:false,baseUrl});
  store.clear(); store.set("5585999990009@c.us",[inbound("DISABLED","5585999990009",seconds()-60)]);
  assert.equal(marker(),undefined);
  const before=count("crm_messages");
  waha.saveWahaSettings(admin,{revision:current.revision+1,enabled:true,baseUrl});
  await waha.drainWahaEvents();
  assert.equal(count("crm_messages"),before);
  assert.ok(marker().baseline>=seconds()-2);
  assert.notEqual(row()?.state,"pending");
});
