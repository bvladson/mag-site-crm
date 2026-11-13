import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mag-waha-store-"));
process.env.SITE_DATA_DIR = directory;
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const core = await import("../src/lib/crm.server.ts");
const store = await import("../src/lib/crm-whatsapp-store.server.ts");
const media = await import("../src/lib/crm-media.server.ts");
const actor = async (name, roles) => ({ id: (await auth.createUser(name + "@waha.example.invalid", "QaPassword-123", roles)).id, email: name + "@waha.example.invalid", roles, created_at: "" });
const admin = await actor("admin", ["admin"]), seller = await actor("seller", ["comercial"]), other = await actor("other", ["comercial"]), dho = await actor("dho", ["dho"]);
const incoming = (externalId, phone, patch = {}) => store.ingestWahaMessage({ session: "mag-test", externalId, chatId: phone + "@c.us", ownerId: seller.id, name: "Contato artificial WAHA", from: "cliente", text: "Mensagem artificial de teste", at: new Date(Date.now() - 5000).toISOString(), ...patch });
const count = table => Number(db.getDb().prepare(`SELECT count(*) n FROM ${table}`).get().n);
let first;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=", "base64");
const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.from([20, 0, 0, 0]), Buffer.from("WAVEfmt audio fixture")]);

test.after(async () => { db.closeDb(); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

test("inbound requires an active configured owner and creates one contact/opportunity for a live attendance", () => {
  assert.throws(() => incoming("no-owner", "5585999000001", { ownerId: "" }), /responsável/);
  assert.equal(count("crm_contacts"), 0);
  first = incoming("first", "5585999000001");
  assert.equal(first.duplicate, false);
  assert.equal(count("crm_contacts"), 1); assert.equal(count("crm_opportunities"), 1);
  assert.equal(core.requireCrmOpportunity(seller, first.opportunityId).awaitingReply, true);
  const duplicated = incoming("first", "5585999000001", { text: "Repeated event changed display name", name: "Changed provider name" });
  assert.equal(duplicated.message.id, first.message.id); assert.equal(duplicated.duplicate, true);
  assert.equal(count("crm_opportunities"), 1); assert.equal(count("crm_messages"), 1);
  assert.equal(core.requireCrmContact(seller, first.contactId).name, "Contato artificial WAHA");
  assert.throws(() => core.requireCrmContact(other, first.contactId), /Forbidden/);
});

test("phone aliases and cellphone outgoing messages converge without creating another lead", () => {
  const outgoing = incoming("phone-out", "5585999000001", { chatId: "5585999000001@s.whatsapp.net", from: "vendedora", text: "Resposta enviada pelo celular", at: new Date().toISOString() });
  assert.equal(outgoing.contactId, first.contactId); assert.equal(outgoing.opportunityId, first.opportunityId);
  assert.equal(core.requireCrmOpportunity(seller, first.opportunityId).awaitingReply, false);
  assert.equal(count("crm_opportunities"), 1);
  const unknown = incoming("unknown-cell-out", "5585999000002", { from: "vendedora" });
  assert.equal(unknown.opportunityId, null);
  assert.equal(count("crm_opportunities"), 1);
  incoming("unknown-cell-in", "5585999000002");
  assert.equal(count("crm_opportunities"), 2);
});

test("historical sync preserves unread, current activity and business stages and creates no historical opportunity", () => {
  const before = db.getDb().prepare("SELECT * FROM crm_opportunities WHERE id=?").get(first.opportunityId);
  const unread = core.getCrmBootstrap(seller).counts.unread;
  incoming("old-history", "5585999000001", { historical: true, at: "2024-05-02T12:00:00.000Z" });
  assert.deepEqual(db.getDb().prepare("SELECT * FROM crm_opportunities WHERE id=?").get(first.opportunityId), before);
  assert.equal(core.getCrmBootstrap(seller).counts.unread, unread);
  const rows = count("crm_opportunities");
  const unknown = incoming("old-new-contact", "5585999000010", { historical: true, at: "2024-05-01T10:00:00.000Z" });
  assert.equal(unknown.opportunityId, null); assert.equal(count("crm_opportunities"), rows);
});

test("delayed live events do not replace the newer reply state and early receipts remain monotonic", () => {
  const state = core.requireCrmOpportunity(seller, first.opportunityId);
  incoming("late-live", "5585999000001", { at: "2024-05-02T12:00:00.000Z" });
  assert.equal(core.requireCrmOpportunity(seller, first.opportunityId).awaitingReply, state.awaitingReply);
  core.updateCrmMessageStatus({ provider: "waha", account: "mag-test", externalId: "early-ack", status: "read" });
  const received = incoming("early-ack", "5585999000001", { from: "vendedora", status: "sent" });
  assert.equal(received.message.status, "read");
  core.updateCrmMessageStatus({ provider: "waha", account: "mag-test", externalId: "early-ack", status: "delivered" });
  assert.equal(core.listCrmMessages(seller, first.contactId).find(item => item.id === received.message.id).status, "read");
});

test("multiple open opportunities are retained for selection instead of updating all of them", () => {
  const contact = core.createContact(seller, { name: "Cliente com dois projetos", phone: "5585999000003" });
  const a = core.createOpportunity(seller, { contactId: contact.id, title: "Projeto A", origin: "WhatsApp" });
  const b = core.createOpportunity(seller, { contactId: contact.id, title: "Projeto B", origin: "WhatsApp" });
  const result = incoming("ambiguous", "5585999000003");
  assert.equal(result.triageReason, "multiple_open_opportunities"); assert.equal(result.opportunityId, null);
  assert.equal(core.requireCrmOpportunity(seller, a.id).awaitingReply, false); assert.equal(core.requireCrmOpportunity(seller, b.id).awaitingReply, false);
  assert.throws(() => store.bindWahaConversationOpportunity(other, { session: "mag-test", chatId: "5585999000003@c.us", opportunityId: a.id }), /Forbidden/);
  store.bindWahaConversationOpportunity(seller, { session: "mag-test", chatId: "5585999000003@c.us", opportunityId: b.id });
  const next = incoming("selected-project", "5585999000003", { at: new Date(Date.now() + 1000).toISOString() });
  assert.equal(next.opportunityId, b.id);
  assert.equal(core.requireCrmOpportunity(seller, a.id).awaitingReply, false); assert.equal(core.requireCrmOpportunity(seller, b.id).awaitingReply, true);
});

test("closed opportunities remain intact while a new incoming attendance opens one new cycle", () => {
  const current = core.requireCrmOpportunity(seller, first.opportunityId);
  core.moveOpportunity(seller, { id: current.id, revision: current.revision, stage: "fechado" });
  const before = count("crm_opportunities"), next = incoming("new-cycle", "5585999000001");
  assert.notEqual(next.opportunityId, current.id); assert.equal(count("crm_opportunities"), before + 1);
  incoming("new-cycle-repeat-message", "5585999000001"); assert.equal(count("crm_opportunities"), before + 1);
  assert.equal(core.requireCrmOpportunity(seller, current.id).stage, "fechado");
});

test("contact-level context selection requires an open opportunity in the same portfolio and contact", () => {
  const contact = core.createContact(seller, { name: "Escolha explícita do atendimento", phone: "5585999000021" });
  const a = core.createOpportunity(seller, { contactId: contact.id, title: "Projeto contexto A", origin: "WhatsApp" });
  const b = core.createOpportunity(seller, { contactId: contact.id, title: "Projeto contexto B", origin: "WhatsApp" });
  incoming("contact-context", contact.phone);
  assert.deepEqual(store.readWahaContactContext(seller, { session: "mag-test", contactId: contact.id }), { opportunityId: null, triageReason: "multiple_open_opportunities" });
  assert.throws(() => store.readWahaContactContext(other, { session: "mag-test", contactId: contact.id }), /Forbidden/);
  assert.throws(() => store.bindWahaContactOpportunity(other, { session: "mag-test", contactId: contact.id, opportunityId: a.id }), /Forbidden/);
  assert.throws(() => store.bindWahaContactOpportunity(dho, { session: "mag-test", contactId: contact.id, opportunityId: a.id }), /Forbidden/);
  const foreign = core.createOpportunity(seller, { newContact: { name: "Outro contato", phone: "5585999000022" }, title: "Outro projeto", origin: "WhatsApp" });
  assert.throws(() => store.bindWahaContactOpportunity(seller, { session: "mag-test", contactId: contact.id, opportunityId: foreign.id }), /deste contato/);
  core.moveOpportunity(seller, { id: a.id, revision: core.requireCrmOpportunity(seller, a.id).revision, stage: "fechado" });
  assert.throws(() => store.bindWahaContactOpportunity(seller, { session: "mag-test", contactId: contact.id, opportunityId: a.id }), /aberta/);
  assert.equal(store.bindWahaContactOpportunity(seller, { session: "mag-test", contactId: contact.id, opportunityId: b.id }).ok, true);
  assert.deepEqual(store.readWahaContactContext(seller, { session: "mag-test", contactId: contact.id }), { opportunityId: b.id, triageReason: null });
  const next = incoming("contact-context-next", contact.phone, { at: new Date(Date.now() + 1000).toISOString() });
  assert.equal(next.opportunityId, b.id); assert.equal(core.requireCrmOpportunity(seller, a.id).stage, "fechado");
  const unknown = core.createContact(seller, { name: "Sem atendimento vinculado", phone: "5585999000023" });
  assert.equal(store.readWahaContactContext(seller, { session: "mag-test", contactId: unknown.id }), null);
});

test("contact-level selection cannot clear unresolved or conflicting WhatsApp identities", () => {
  const unresolved = incoming("context-lid", "5585999000024", { chatId: "1111111111111111111@lid", phone: undefined });
  const opportunity = core.createOpportunity(seller, { contactId: unresolved.contactId, title: "Contexto sem identidade confirmada", origin: "WhatsApp" });
  assert.throws(() => store.bindWahaContactOpportunity(seller, { session: "mag-test", contactId: unresolved.contactId, opportunityId: opportunity.id }), /identificação/);
  assert.equal(store.readWahaContactContext(seller, { session: "mag-test", contactId: unresolved.contactId }).triageReason, "unresolved_identity");
});

test("unresolved LIDs preserve identity without treating hidden digits as a phone", () => {
  const result = incoming("lid-in", "5585999000004", { chatId: "1234567890123456789@lid", phone: undefined });
  assert.equal(result.triageReason, "unresolved_identity"); assert.equal(core.requireCrmContact(seller, result.contactId).phone, "");
  const resolved = incoming("lid-resolved", "5585999000004", { chatId: "1234567890123456789@lid", phone: "5585999000004" });
  assert.equal(resolved.contactId, result.contactId); assert.equal(resolved.triageReason, null); assert.ok(resolved.opportunityId);
  assert.throws(() => incoming("group", "5585999000004", { chatId: "123456789@g.us" }), /individual/);
});

test("inactive owner preserves queue retry semantics by refusing processing without changing the portfolio", () => {
  const before = count("crm_messages"); db.getDb().prepare("UPDATE users SET disabled=1 WHERE id=?").run(seller.id);
  assert.throws(() => incoming("disabled", "5585999000001"), /indisponível/); assert.equal(count("crm_messages"), before);
  db.getDb().prepare("UPDATE users SET disabled=0 WHERE id=?").run(seller.id);
});

test("keyset pagination accesses more than 500 messages without duplicate or skipped timestamp ties", () => {
  const contact = core.createContact(seller, { name: "Histórico paginado", phone: "5585999000008" });
  for (let index = 0; index < 521; index++) core.recordCrmMessage({ contactId: contact.id, provider: "waha", account: "history", externalId: "page-" + index, from: "cliente", text: "Histórico artificial " + index, at: "2024-01-01T00:00:00.000Z", historical: true });
  const ids = new Set(); let before;
  do { const page = core.listCrmMessagesPage(seller, { contactId: contact.id, before, limit: 50 }); assert.ok(page.messages.length <= 50); for (const item of page.messages) { assert.ok(!ids.has(item.id)); ids.add(item.id); } before = page.nextCursor || undefined; } while (before);
  assert.equal(ids.size, 521); assert.equal(core.listCrmMessages(seller, contact.id).length, 500);
  assert.throws(() => core.listCrmMessagesPage(other, { contactId: contact.id }), /Forbidden/);
  assert.throws(() => core.listCrmMessagesPage(seller, { contactId: contact.id, before: "invalid" }), /Cursor/);
  assert.throws(() => core.listCrmMessagesPage(seller, { contactId: contact.id, limit: 1000 }), /Limite/);
  store.saveWahaHistoryCheckpoint({ session: "history", chatId: "5585999000008@c.us", cursor: "next-page", state: "pending" });
  assert.equal(store.readWahaHistoryCheckpoint("history", "5585999000008@c.us").cursor, "next-page");
});

test("private staged media validates signature, type, size and permissions without exposing provider URLs", () => {
  const image = media.stageCrmMedia(seller, { contactId: first.contactId, name: "../../imagem\n.png", mimeType: "image/png", bytes: png });
  assert.equal(image.name, "imagem.png"); assert.equal(image.kind, "image"); assert.equal(image.downloadUrl, "/api/interno/crm/anexos/" + image.id);
  assert.ok(!JSON.stringify(image).includes(directory));
  assert.deepEqual(media.getCrmMediaForSend(seller, image.id).bytes, png);
  assert.equal(media.readCrmMedia(seller, image.id).headers["Cache-Control"], "private, no-store");
  assert.throws(() => media.readCrmMedia(other, image.id), /Forbidden/); assert.throws(() => media.readCrmMedia(dho, image.id), /Forbidden/);
  assert.throws(() => media.stageCrmMedia(seller, { contactId: first.contactId, name: "evil.svg", mimeType: "image/svg+xml", bytes: Buffer.from("<svg onload='alert(1)'/>") }), /não suportado/);
  assert.throws(() => media.stageCrmMedia(seller, { contactId: first.contactId, name: "fake.png", mimeType: "image/png", bytes: Buffer.from("%PDF-1.7") }), /não corresponde/);
  assert.throws(() => media.stageCrmMedia(seller, { contactId: first.contactId, name: "huge.txt", mimeType: "text/plain", bytes: Buffer.alloc(media.CRM_MEDIA_MAX_BYTES + 1) }), /7 MiB/);
});

test("audio Range supports playback while documents download with sanitized filenames", () => {
  const audio = media.stageCrmMedia(seller, { contactId: first.contactId, name: "audio.wav", mimeType: "audio/x-wav", bytes: wav });
  const partial = media.readCrmMedia(seller, audio.id, { range: "bytes=0-3" }); assert.equal(partial.status, 206); assert.equal(partial.body.toString(), "RIFF");
  const suffix = media.readCrmMedia(seller, audio.id, { range: "bytes=-4" }); assert.equal(suffix.body.length, 4);
  assert.equal(media.readCrmMedia(seller, audio.id, { range: "bytes=999999-" }).status, 416);
  assert.equal(media.readCrmMedia(seller, audio.id, { range: "bytes=0-3,5-9" }).status, 416);
  const pdf = media.stageCrmMedia(seller, { contactId: first.contactId, name: 'proposta\r\n".pdf', mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.7\nfixture\n%%EOF") });
  const download = media.readCrmMedia(seller, pdf.id); assert.ok(download.headers["Content-Disposition"].startsWith("attachment;")); assert.ok(!/[\r\n]/.test(download.headers["Content-Disposition"]));
});

test("incoming media and outbound attachment bindings remain idempotent and scoped to their message", () => {
  const message = incoming("image-incoming", "5585999000001", { text: "[Imagem]" });
  const input = { contactId: first.contactId, messageId: message.message.id, externalKey: "waha:mag-test:image-incoming", name: "imagem.png", mimeType: "image/png", bytes: png };
  const one = media.saveIncomingCrmMedia(input), again = media.saveIncomingCrmMedia(input); assert.equal(one.id, again.id);
  const loaded = core.listCrmMessagesPage(seller, { contactId: first.contactId }).messages.find(item => item.id === message.message.id); assert.equal(loaded.attachments[0].id, one.id);
  const staged = media.stageCrmMedia(seller, { contactId: first.contactId, name: "send.png", mimeType: "image/png", bytes: png });
  const otherContact = core.createContact(seller, { name: "Outro contato anexo", phone: "5585999000090" });
  const wrongMessage = core.recordCrmMessage({ contactId: otherContact.id, provider: "waha", account: "mag-test", externalId: "other-message", from: "vendedora", text: "Outro" });
  assert.throws(() => media.bindCrmMediaToMessage(seller, [staged.id], wrongMessage.id), /outro atendimento/);
  const outgoing = core.recordCrmMessage({ contactId: first.contactId, provider: "waha", account: "mag-test", externalId: "media-outgoing", from: "vendedora", text: "[Imagem enviada]" });
  media.bindCrmMediaToMessage(seller, [staged.id], outgoing.id); media.bindCrmMediaToMessage(seller, [staged.id], outgoing.id);
  assert.throws(() => media.getCrmMediaForSend(seller, staged.id), /já pertence/);
});

test("outgoing provider media echoes converge whether the echo arrives before or after the API result", () => {
  const one = core.recordCrmMessage({ contactId: first.contactId, provider: "waha", account: "mag-test", externalId: "echo-file-first", from: "vendedora", text: "[Imagem enviada]" });
  const prepared = media.stageCrmMedia(seller, { contactId: first.contactId, name: "original.png", mimeType: "image/png", bytes: png });
  const delivered = media.saveIncomingCrmMedia({ contactId: first.contactId, messageId: one.id, externalKey: "waha:echo-file-first", name: "delivered.png", mimeType: "image/png", bytes: png });
  media.bindCrmMediaToMessage(seller, [prepared.id], one.id);
  assert.throws(() => media.getCrmMediaForSend(seller, prepared.id), /já pertence/);
  assert.deepEqual(core.listCrmMessages(seller, first.contactId).find(item => item.id === one.id).attachments.map(file => file.id), [delivered.id]);
  const two = core.recordCrmMessage({ contactId: first.contactId, provider: "waha", account: "mag-test", externalId: "api-file-first", from: "vendedora", text: "[Imagem enviada]" });
  const original = media.stageCrmMedia(seller, { contactId: first.contactId, name: "original2.png", mimeType: "image/png", bytes: png });
  media.bindCrmMediaToMessage(seller, [original.id], two.id);
  const echo = media.saveIncomingCrmMedia({ contactId: first.contactId, messageId: two.id, externalKey: "waha:api-file-first", name: "echo.png", mimeType: "image/png", bytes: png });
  assert.equal(echo.id, original.id);
  assert.equal(core.listCrmMessages(seller, first.contactId).find(item => item.id === two.id).attachments.length, 1);
});

test("corrupted files and malicious storage paths are rejected; all data survives reopening SQLite", async () => {
  const file = media.stageCrmMedia(seller, { contactId: first.contactId, name: "tamper.png", mimeType: "image/png", bytes: png });
  const row = db.getDb().prepare("SELECT storage_id FROM crm_media WHERE id=?").get(file.id);
  await writeFile(join(directory, "crm-media", row.storage_id), Buffer.from("corrupt"));
  assert.throws(() => media.readCrmMedia(seller, file.id), /inválido/);
  db.getDb().prepare("UPDATE crm_media SET storage_id='../outside' WHERE id=?").run(file.id); assert.throws(() => media.readCrmMedia(seller, file.id), /Identificador/);
  const before = count("crm_messages"); db.closeDb(); assert.equal(count("crm_messages"), before);
  assert.ok(core.listCrmMessagesPage(seller, { contactId: first.contactId }).messages.length > 0);
  assert.ok(store.readWahaHistoryCheckpoint("history", "5585999000008@c.us"));
  const audit = db.getDb().prepare("SELECT details FROM audit_log WHERE action LIKE 'crm:%'").all();
  assert.ok(!JSON.stringify(audit).includes("Mensagem artificial de teste"));
});
