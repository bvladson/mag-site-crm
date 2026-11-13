import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "mag-crm-readiness-"));
process.env.SITE_DATA_DIR = dir;
const database = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const assignments = await import("../src/lib/assignments.server.ts");
const units = await import("../src/lib/units.server.ts");
const quotes = await import("../src/lib/orcamentos.server.ts");
const crm = await import("../src/lib/crm.server.ts");
async function user(label, roles = ["comercial"]) {
  const email = `${label}@readiness.example.invalid`;
  const created = await auth.createUser(email, "Senha-Forte-123", roles);
  return { id: created.id, email, roles, created_at: "" };
}
const admin = await user("admin", ["admin"]);
const other = await user("other");
const unit = units.listUnitsPublic()[0];
const sql = () => database.getDb();
const at = offset => new Date(Date.now() + offset).toISOString();
const snapshot = (table, id) => sql().prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
test.after(async () => {
  database.closeDb();
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("importing an old site request preserves the reply state of existing negotiations and historical unread", async () => {
  const seller = await user("site-history");
  const contact = crm.createContact(seller, { name: "Contato antigo", phone: "85992341122", email: "history@example.invalid" });
  const existing = crm.createOpportunity(seller, { contactId: contact.id, title: "Negociação já atendida", origin: "WhatsApp" });
  crm.recordCrmMessage({ contactId: contact.id, provider: "qa", account: "history", externalId: "reply", from: "vendedora", text: "Já respondido", at: at(60_000) });
  const before = snapshot("crm_opportunities", existing.id);
  const saved = database.saveQuote({ nome: contact.name, whatsapp: contact.phone, email: contact.email, mensagem: "Pedido antigo" }, [{ slug: "cadeira-qa", sku: "QA-1", name: "Cadeira QA", qty: 1 }]);
  assignments.assignNewLead(saved.id, unit.id);
  assignments.assignLead(admin, { leadId: saved.id, ownerId: seller.id, unitId: unit.id, revision: assignments.leadAssignment(saved.id).revision });
  sql().prepare("UPDATE quote_requests SET created_at=? WHERE id=?").run("2020-01-01T00:00:00.000Z", saved.id);
  const sourceBefore = snapshot("quote_requests", saved.id);
  const imported = crm.importSiteLead(seller, { sourceKind: "quote", sourceId: saved.id });
  assert.notEqual(imported.id, existing.id);
  assert.deepEqual(snapshot("crm_opportunities", existing.id), before);
  assert.deepEqual(snapshot("quote_requests", saved.id), sourceBefore);
  assert.equal(crm.getCrmContactDetail(seller, contact.id).conversation.unread, 0);
  assert.equal(crm.importSiteLead(seller, { sourceKind: "quote", sourceId: saved.id }).id, imported.id);
  assert.equal(crm.listCrmMessages(seller, contact.id).length, 2);
});

test("delayed live messages remain visible but never undo a newer customer/seller reply state", async () => {
  const seller = await user("chronology");
  const op = crm.createOpportunity(seller, { newContact: { name: "Cronologia" }, title: "Atendimento", origin: "WhatsApp" });
  const base = Date.now() + 60_000;
  function message(id, from, offset) { return crm.recordCrmMessage({ contactId: op.contactId, provider: "qa", account: "chronology", externalId: id, from, text: id, at: new Date(base + offset).toISOString() }); }
  message("received", "cliente", 0);
  message("reply", "vendedora", 60_000);
  const replied = snapshot("crm_opportunities", op.id);
  message("late-inbound", "cliente", -60_000);
  assert.deepEqual(snapshot("crm_opportunities", op.id), replied);
  assert.equal(crm.requireCrmOpportunity(seller, op.id).awaitingReply, false);
  message("new-inbound", "cliente", 120_000);
  const awaiting = snapshot("crm_opportunities", op.id);
  message("late-outbound", "vendedora", 30_000);
  assert.deepEqual(snapshot("crm_opportunities", op.id), awaiting);
  assert.equal(crm.requireCrmOpportunity(seller, op.id).awaitingReply, true);
  assert.equal(crm.getCrmContactDetail(seller, op.contactId).conversation.unread, 3);
});

test("pending tasks survive more than 500 completed rows and both task states remain paginated and scoped", async () => {
  const seller = await user("tasks");
  const op = crm.createOpportunity(seller, { newContact: { name: "Retornos" }, title: "Retornos", origin: "Site" });
  const insert = sql().prepare("INSERT INTO crm_tasks(id,opportunity_id,label,due,status,created_at,completed_at) VALUES(?,?,?,?,?,?,?)");
  for (let i = 0; i < 520; i++) insert.run(randomUUID(), op.id, `Concluído ${i}`, "2020-01-01T00:00:00.000Z", "done", "2020-01-01T00:00:00.000Z", "2020-01-01T01:00:00.000Z");
  const pending = crm.scheduleTask(seller, { opportunityId: op.id, label: "Retorno pendente", due: at(300_000) });
  assert.ok(crm.getCrmBootstrap(seller).tasks.some(task => task.id === pending.id));
  assert.ok(crm.getOpportunityDetail(seller, op.id).tasks.some(task => task.id === pending.id));
  assert.equal(crm.listCrmTasksPage(seller).tasks[0].id, pending.id);
  const ids = new Set();
  let after;
  do {
    const page = crm.listCrmTasksPage(seller, { opportunityId: op.id, status: "done", limit: 100, after });
    assert.equal(page.total, 520);
    for (const task of page.tasks) { assert.equal(ids.has(task.id), false); ids.add(task.id); }
    after = page.nextCursor || undefined;
  } while (after);
  assert.equal(ids.size, 520);
  assert.throws(() => crm.listCrmTasksPage(other, { opportunityId: op.id }), /Forbidden/);
  assert.equal(crm.listCrmTasksPage(other).total, 0);
});

test("a recently messaged old contact remains visible beyond 500 contacts and bootstrap carries only the latest preview", async () => {
  const seller = await user("contact-window");
  const contact = crm.createContact(seller, { name: "Contato antigo com resposta", email: "old@example.invalid" });
  const ancient = "2020-01-01T00:00:00.000Z";
  sql().prepare("UPDATE crm_contacts SET created_at=?,updated_at=? WHERE id=?").run(ancient, ancient, contact.id);
  const insert = sql().prepare("INSERT INTO crm_contacts(id,owner_id,name,phone,email,city,created_at,updated_at) VALUES(?,?,?,'','','',?,?)");
  for (let i = 0; i < 510; i++) insert.run(randomUUID(), seller.id, `Cadastro ${i}`, "2021-01-01T00:00:00.000Z", "2021-01-01T00:00:00.000Z");
  const msg = sql().prepare("INSERT INTO crm_messages(id,contact_id,provider,account,external_id,sender,text,sent_at) VALUES(?,?,'qa','window',?,'cliente',?,?)");
  for (let i = 0; i < 620; i++) msg.run(randomUUID(), contact.id, `history-${i}`, `Mensagem ${i}`, new Date(Date.parse("2022-01-01T00:00:00.000Z") + i * 1000).toISOString());
  const workspace = crm.getCrmBootstrap(seller);
  assert.equal(workspace.contacts[0].id, contact.id);
  assert.equal(workspace.contacts.length, 500);
  const conversation = workspace.conversations.find(row => row.contactId === contact.id);
  assert.equal(conversation.unread, 620);
  assert.equal(conversation.messages.length, 1);
  assert.equal(conversation.messages[0].text, "Mensagem 619");
  assert.equal(workspace.counts.awaitingContacts, 1);
  assert.equal(workspace.counts.contacts, 511);
  assert.equal(workspace.limits.truncated, true);
  const history = crm.listCrmMessagesPage(seller, { contactId: contact.id });
  assert.equal(history.messages.length, 50);
  assert.equal(history.hasMore, true);
  assert.throws(() => crm.getCrmContactDetail(other, contact.id), /Forbidden/);
});

test("contacts use complete server search and stable scoped pagination, including records outside the bootstrap", async () => {
  const seller = await user("contact-pages");
  const insert = sql().prepare("INSERT INTO crm_contacts(id,owner_id,name,phone,email,city,created_at,updated_at) VALUES(?,?,?,'','','',?,?)");
  const date = "2020-01-01T00:00:00.000Z";
  for (let i = 0; i < 512; i++) insert.run(randomUUID(), seller.id, i === 511 ? "José Fora da Janela" : `Página ${i}`, date, date);
  const ids = new Set();
  let before;
  do {
    const page = crm.listCrmContactsPage(seller, { limit: 100, before });
    assert.equal(page.total, 512);
    for (const contact of page.contacts) { assert.equal(ids.has(contact.id), false); ids.add(contact.id); }
    before = page.nextCursor || undefined;
  } while (before);
  assert.equal(ids.size, 512);
  const result = crm.listCrmContactsPage(seller, { search: "jose fora" });
  assert.equal(result.total, 1);
  const selected = result.contacts[0];
  const detail = crm.getCrmContactDetail(seller, selected.id);
  assert.equal(detail.contact.name, "José Fora da Janela");
  assert.equal(detail.conversation.messages.length, 0);
  assert.equal(crm.listCrmContactsPage(other, { search: "jose fora" }).total, 0);
  const first = crm.listCrmContactsPage(seller, { limit: 100 });
  assert.throws(() => crm.listCrmContactsPage(other, { before: first.nextCursor }), /Cursor inválido/);
  assert.throws(() => crm.listCrmContactsPage(seller, { search: "outro", before: first.nextCursor }), /Cursor inválido/);
  assert.throws(() => crm.listCrmContactsPage(other, { ownerId: seller.id }), /Forbidden/);
});

test("quote identity mismatches require an explicit current confirmation without modifying the commercial quote", async () => {
  const seller = await user("quote-identity");
  const op = crm.createOpportunity(seller, { newContact: { name: "Ana", company: "Empresa Alfa", email: "ana@alfa.invalid", phone: "85992341100" }, title: "Projeto Alfa", origin: "Indicação" });
  const q = quotes.criarOrcamento(seller, []);
  sql().prepare("UPDATE internal_quotes SET customer_name=?,customer_email=?,customer_phone=? WHERE id=?").run("Empresa Beta", "bia@beta.invalid", "85992342200", q.id);
  const before = snapshot("internal_quotes", q.id);
  const preview = crm.previewCrmQuoteLink(seller, { opportunityId: op.id, quoteId: q.id });
  assert.equal(preview.requiresConfirmation, true);
  assert.ok(preview.reasons.length >= 3);
  assert.throws(() => crm.linkQuote(seller, { opportunityId: op.id, quoteId: q.id }), /justificativa/);
  assert.throws(() => crm.linkQuote(seller, { opportunityId: op.id, quoteId: q.id, confirmMismatch: true, justification: "Cliente confirmado por ligação", confirmationToken: "0".repeat(64) }), /mudaram/);
  assert.equal(sql().prepare("SELECT count(*) n FROM crm_quote_links WHERE quote_id=?").get(q.id).n, 0);
  assert.throws(() => crm.previewCrmQuoteLink(other, { opportunityId: op.id, quoteId: q.id }), /Forbidden/);
  const linked = crm.linkQuote(seller, { opportunityId: op.id, quoteId: q.id, confirmMismatch: true, justification: "Matriz e filial confirmadas por ligação", confirmationToken: preview.confirmationToken });
  assert.deepEqual(linked.quoteIds, [q.id]);
  assert.deepEqual(snapshot("internal_quotes", q.id), before);
  assert.equal(sql().prepare("SELECT count(*) n FROM crm_activities WHERE opportunity_id=? AND kind='quote:linked:confirmed_mismatch'").get(op.id).n, 1);
  crm.linkQuote(seller, { opportunityId: op.id, quoteId: q.id });
  assert.equal(sql().prepare("SELECT count(*) n FROM crm_quote_links WHERE quote_id=?").get(q.id).n, 1);
  assert.equal(sql().prepare("SELECT count(*) n FROM omie_orders").get().n, 0);
});

test("an identity confirmation becomes stale when quote or contact identity changes", async () => {
  const seller = await user("quote-stale");
  const op = crm.createOpportunity(seller, { newContact: { name: "Contato sem dados" }, title: "Proposta", origin: "Site" });
  const q = quotes.criarOrcamento(seller, []);
  const preview = crm.previewCrmQuoteLink(seller, { opportunityId: op.id, quoteId: q.id });
  sql().prepare("UPDATE internal_quotes SET customer_name=?,version=version+1 WHERE id=?").run("Novo cliente", q.id);
  assert.throws(() => crm.linkQuote(seller, { opportunityId: op.id, quoteId: q.id, confirmMismatch: true, justification: "Conferido no atendimento", confirmationToken: preview.confirmationToken }), /mudaram/);
  const current = crm.previewCrmQuoteLink(seller, { opportunityId: op.id, quoteId: q.id });
  sql().prepare("UPDATE crm_contacts SET name=? WHERE id=?").run("Outra identidade", op.contactId);
  assert.throws(() => crm.linkQuote(seller, { opportunityId: op.id, quoteId: q.id, confirmMismatch: true, justification: "Conferido no atendimento", confirmationToken: current.confirmationToken }), /mudaram/);
});
