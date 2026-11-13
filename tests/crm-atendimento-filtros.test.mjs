// Filtros rápidos do Atendimento calculados no servidor (lista paginada): contagens por carteira, páginas filtradas,
// isolamento entre vendedores e cursor preso ao filtro. node --test tests/crm-atendimento-filtros.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "mag-crm-filtros-"));
process.env.SITE_DATA_DIR = dir;
process.env.CRM_DISABLE_WORKER = "1";
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const crm = await import("../src/lib/crm.server.ts");
const store = await import("../src/lib/crm-whatsapp-store.server.ts");
test.after(async () => {
  db.closeDb?.();
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});
const actor = async (email, roles) => ({
  id: (await auth.createUser(email, "Senha-Forte-123", roles)).id,
  email,
  roles,
  created_at: "",
});
const admin = await actor("admin@filtros.example", ["admin"]);
const a = await actor("a@filtros.example", ["comercial"]);
const b = await actor("b@filtros.example", ["comercial"]);
const products = [{ id: "123", sku: "SKU-123", nome: "Cadeira QA", unidade: "UN", slug: "cadeira-qa" }];
let sequence = 0;
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const say = (owner, phone, from, minutes) =>
  store.ingestWahaMessage({
    session: "mag-filtros",
    externalId: `f-${++sequence}`,
    chatId: `${phone}@c.us`,
    ownerId: owner.id,
    name: `Contato ${phone.slice(-4)}`,
    from,
    text: "Mensagem artificial",
    at: minutesAgo(minutes),
    status: from === "vendedora" ? "read" : "received",
  });
const readAll = (contactId) =>
  db.getDb().prepare("UPDATE crm_messages SET read_at=? WHERE contact_id=? AND read_at IS NULL").run(new Date().toISOString(), contactId);
const opportunityOf = (contactId) =>
  db.getDb().prepare("SELECT id FROM crm_opportunities WHERE contact_id=? ORDER BY created_at LIMIT 1").get(contactId).id;
const settle = (contactId) => {
  readAll(contactId);
  db.getDb().prepare("UPDATE crm_opportunities SET awaiting_reply=0 WHERE contact_id=?").run(contactId);
};

// Carteira da vendedora A.
const responder = say(a, "5585911120001", "cliente", 10).contactId; // cliente escreveu por último, não lida
say(a, "5585911120002", "cliente", 60);
const aguardando = say(a, "5585911120002", "vendedora", 50).contactId;
settle(aguardando);
say(a, "5585911120003", "cliente", 300);
const retorno = say(a, "5585911120003", "vendedora", 290).contactId;
settle(retorno);
crm.scheduleTask(a, { opportunityId: opportunityOf(retorno), label: "Ligar", due: minutesAgo(24 * 60) });
say(a, "5585911120004", "cliente", 400);
const proposta = say(a, "5585911120004", "vendedora", 390).contactId;
settle(proposta);
crm.createQuoteForOpportunity(a, { opportunityId: opportunityOf(proposta) }, products);
say(a, "5585911120005", "cliente", 500);
const cancelada = say(a, "5585911120005", "vendedora", 490).contactId;
settle(cancelada);
const quote = crm.createQuoteForOpportunity(a, { opportunityId: opportunityOf(cancelada) }, products);
db.getDb().prepare("UPDATE internal_quotes SET status='cancelado' WHERE id=?").run(quote.id);
// Carteira da vendedora B (nunca entra nas contagens de A).
const outraCarteira = say(b, "5585911120006", "cliente", 5).contactId;

const ids = (page) => page.contacts.map((contact) => contact.id).sort();

test("contagens dos filtros só na carteira da vendedora", () => {
  const page = crm.listCrmContactsPage(a, { limit: 50 });
  assert.deepEqual(page.viewCounts, { todas: 5, responder: 1, aguardando: 4, retornos: 1, proposta: 1 });
  assert.ok(!ids(page).includes(outraCarteira));
});

test("cada filtro devolve só os atendimentos certos", () => {
  assert.deepEqual(ids(crm.listCrmContactsPage(a, { view: "responder" })), [responder]);
  assert.deepEqual(ids(crm.listCrmContactsPage(a, { view: "aguardando" })), [aguardando, cancelada, proposta, retorno].sort());
  assert.deepEqual(ids(crm.listCrmContactsPage(a, { view: "retornos" })), [retorno]);
  assert.deepEqual(ids(crm.listCrmContactsPage(a, { view: "proposta" })), [proposta], "proposta cancelada não conta");
  assert.equal(crm.listCrmContactsPage(a, { view: "responder" }).total, 1);
});

test("retorno marcado para mais tarde hoje entra; amanhã não", () => {
  // "Mais tarde hoje" no fuso de Fortaleza, seja qual for a hora em que o teste roda.
  const day = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const later = new Date(Math.min(Date.now() + 60_000, Date.parse(`${day}T23:59:59.000-03:00`)));
  const opportunityId = opportunityOf(responder);
  crm.scheduleTask(a, { opportunityId, label: "Hoje mais tarde", due: later.toISOString() });
  assert.ok(ids(crm.listCrmContactsPage(a, { view: "retornos" })).includes(responder));
  db.getDb().prepare("UPDATE crm_tasks SET due=? WHERE opportunity_id=? AND label='Hoje mais tarde'").run(new Date(Date.now() + 2 * 86_400_000).toISOString(), opportunityId);
  assert.ok(!ids(crm.listCrmContactsPage(a, { view: "retornos" })).includes(responder));
});

test("administrador vê a soma das carteiras; vendedora não filtra a carteira de outra", () => {
  const page = crm.listCrmContactsPage(admin, { limit: 50 });
  assert.equal(page.viewCounts.todas, 6);
  assert.equal(page.viewCounts.responder, 2);
  assert.deepEqual(ids(crm.listCrmContactsPage(admin, { view: "responder", ownerId: b.id })), [outraCarteira]);
  assert.throws(() => crm.listCrmContactsPage(a, { view: "responder", ownerId: b.id }), /Forbidden/);
});

test("cursor fica preso ao filtro; busca e páginas seguintes não recalculam contagens", () => {
  const first = crm.listCrmContactsPage(a, { view: "aguardando", limit: 2 });
  assert.equal(first.contacts.length, 2);
  assert.ok(first.hasMore && first.nextCursor);
  const second = crm.listCrmContactsPage(a, { view: "aguardando", limit: 2, before: first.nextCursor });
  assert.equal(second.contacts.length, 2);
  assert.equal(second.viewCounts, undefined);
  assert.equal(new Set([...ids(first), ...ids(second)]).size, 4);
  assert.throws(() => crm.listCrmContactsPage(a, { view: "todas", limit: 2, before: first.nextCursor }), /Cursor inválido/);
  assert.equal(crm.listCrmContactsPage(a, { search: "0001" }).viewCounts, undefined);
  assert.throws(() => crm.listCrmContactsPage(a, { view: "qualquer" }), /Filtro de atendimento inválido/);
});
