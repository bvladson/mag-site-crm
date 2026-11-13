import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "mag-crm-core-"));
process.env.SITE_DATA_DIR = dir;
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const assignments = await import("../src/lib/assignments.server.ts");
const units = await import("../src/lib/units.server.ts");
const quotes = await import("../src/lib/orcamentos.server.ts");
const crm = await import("../src/lib/crm.server.ts");
async function actor(email, roles) {
  return {
    id: (await auth.createUser(email, "Senha-Forte-123", roles)).id,
    email,
    roles,
    created_at: "",
  };
}
const admin = await actor("admin@crm.example", ["admin"]);
const a = await actor("a@crm.example", ["comercial"]);
const b = await actor("b@crm.example", ["comercial"]);
const dho = await actor("dho@crm.example", ["dho"]);
const manager = await actor("manager@crm.example", ["gerente"]);
const unit = units.listUnitsPublic()[0];
const products = [
  { id: "123", sku: "SKU-123", nome: "Cadeira QA", unidade: "UN", slug: "cadeira-qa" },
];
function lead(owner, suffix) {
  const saved = db.saveQuote(
    {
      nome: `Contato QA ${suffix}`,
      empresa: "Empresa QA",
      whatsapp: `8599999000${suffix}`,
      email: `qa${suffix}@example.invalid`,
      cidade: "Fortaleza",
      estado: "CE",
      mensagem: "Mensagem privada de diagnóstico",
      utm: { utm_source: "google", gclid: `qa-${suffix}` },
    },
    [{ slug: "cadeira-qa", sku: "SKU-123", name: "Cadeira QA", qty: 3 }],
  );
  assignments.assignNewLead(saved.id, unit.id);
  if (owner)
    assignments.assignLead(admin, {
      leadId: saved.id,
      ownerId: owner.id,
      unitId: unit.id,
      revision: assignments.leadAssignment(saved.id).revision,
    });
  return saved.id;
}
const leadA = lead(a, 1),
  leadB = lead(b, 2),
  unassigned = lead(null, 3);
const quoteA = quotes.criarOrcamento(a, products, leadA);
const sourceBefore = db.getDb().prepare("SELECT * FROM quote_requests WHERE id=?").get(leadA);
const quoteBefore = db.getDb().prepare("SELECT * FROM internal_quotes WHERE id=?").get(quoteA.id);
let opportunityA;
test.after(async () => {
  db.closeDb();
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("workspace uses fresh roles, no samples or automatic source backfill, and scopes source queues", () => {
  const workspace = crm.getCrmBootstrap(a);
  assert.equal(workspace.contacts.length, 0);
  assert.equal(workspace.opportunities.length, 0);
  assert.deepEqual(
    workspace.siteLeads.map((l) => l.id),
    [leadA],
  );
  assert.equal(workspace.proposals[0].quoteId, quoteA.id);
  assert.equal(workspace.proposals[0].number, quoteA.numero);
  assert.equal(workspace.proposals[0].opportunityId, "");
  assert.equal(crm.getCrmBootstrap(admin).siteLeads.length, 3);
  assert.throws(() => crm.getCrmBootstrap(dho), /Forbidden/);
  assert.throws(() => crm.getCrmBootstrap(manager), /Forbidden/);
  assert.throws(() => crm.getCrmBootstrap({ ...dho, roles: ["admin"] }), /Forbidden/);
});

test("explicit import is idempotent, links existing quote, preserves source and document rows", () => {
  opportunityA = crm.importSiteLead(a, { sourceKind: "quote", sourceId: leadA });
  assert.equal(opportunityA.origin, "Anúncio Google");
  assert.equal(opportunityA.ownerId, a.id);
  assert.deepEqual(opportunityA.quoteIds, [quoteA.id]);
  const repeated = crm.importSiteLead(a, { sourceKind: "quote", sourceId: leadA });
  assert.equal(repeated.id, opportunityA.id);
  assert.equal(crm.getCrmBootstrap(a).contacts.length, 1);
  assert.equal(crm.getCrmBootstrap(a).opportunities.length, 1);
  assert.deepEqual(
    db.getDb().prepare("SELECT * FROM quote_requests WHERE id=?").get(leadA),
    sourceBefore,
  );
  assert.deepEqual(
    db.getDb().prepare("SELECT * FROM internal_quotes WHERE id=?").get(quoteA.id),
    quoteBefore,
  );
  assert.throws(() => crm.importSiteLead(b, { sourceKind: "quote", sourceId: leadA }), /Forbidden/);
  assert.throws(
    () => crm.importSiteLead(a, { sourceKind: "quote", sourceId: unassigned }),
    /Forbidden/,
  );
  assert.equal(crm.getCrmBootstrap(a).proposals[0].opportunityId, opportunityA.id);
});

test("owner guard covers contact, opportunity, notes, tasks and quote operations", () => {
  assert.throws(() => crm.requireCrmContact(b, opportunityA.contactId), /Forbidden/);
  assert.throws(() => crm.getOpportunityDetail(b, opportunityA.id), /Forbidden/);
  assert.throws(
    () =>
      crm.updateOpportunity(b, {
        id: opportunityA.id,
        revision: opportunityA.revision,
        notes: "forjado",
      }),
    /Forbidden/,
  );
  assert.throws(
    () =>
      crm.scheduleTask(b, {
        opportunityId: opportunityA.id,
        label: "forjado",
        due: new Date().toISOString(),
      }),
    /Forbidden/,
  );
  assert.throws(
    () => crm.createQuoteForOpportunity(b, { opportunityId: opportunityA.id }, products),
    /Forbidden/,
  );
  assert.throws(() => crm.createContact(a, { name: "Outro", ownerId: b.id }), /Forbidden/);
  assert.equal(crm.getCrmBootstrap(b).opportunities.length, 0);
});

test("stage revision rejects stale updates; loss requires reason; CRM close cannot accept a proposal or order", () => {
  const current = crm.requireCrmOpportunity(a, opportunityA.id);
  const moved = crm.moveOpportunity(a, {
    id: current.id,
    revision: current.revision,
    stage: "conversando",
  });
  assert.equal(moved.stage, "conversando");
  assert.throws(
    () => crm.moveOpportunity(a, { id: current.id, revision: current.revision, stage: "novo" }),
    /Conflito/,
  );
  assert.throws(
    () => crm.moveOpportunity(a, { id: moved.id, revision: moved.revision, stage: "perdido" }),
    /motivo/,
  );
  const lost = crm.moveOpportunity(a, {
    id: moved.id,
    revision: moved.revision,
    stage: "perdido",
    lossReason: "Preço",
  });
  assert.equal(lost.lossReason, "Preço");
  const closed = crm.moveOpportunity(a, { id: lost.id, revision: lost.revision, stage: "fechado" });
  assert.equal(closed.lossReason, undefined);
  assert.deepEqual(
    db.getDb().prepare("SELECT * FROM internal_quotes WHERE id=?").get(quoteA.id),
    quoteBefore,
  );
  assert.equal(db.getDb().prepare("SELECT count(*) n FROM omie_orders").get().n, 0);
  assert.equal(db.getDb().prepare("SELECT count(*) n FROM quote_proposals").get().n, 0);
});

test("notes and separate scheduled tasks persist, complete idempotently and retain activity history", () => {
  let op = crm.requireCrmOpportunity(a, opportunityA.id);
  op = crm.updateOpportunity(a, {
    id: op.id,
    revision: op.revision,
    notes: "Diagnóstico privado: medir sala",
  });
  assert.equal(op.notes, "Diagnóstico privado: medir sala");
  const late = crm.scheduleTask(a, {
    opportunityId: op.id,
    label: "Visita de medição",
    due: "2026-11-20T15:00:00-03:00",
  });
  const first = crm.scheduleTask(a, {
    opportunityId: op.id,
    label: "Confirmar endereço",
    due: "2026-11-19T15:00:00-03:00",
  });
  assert.equal(crm.requireCrmOpportunity(a, op.id).nextAction.taskId, first.id);
  assert.throws(() => crm.completeTask(b, { id: first.id }), /Forbidden/);
  crm.completeTask(a, { id: first.id });
  crm.completeTask(a, { id: first.id });
  assert.equal(crm.requireCrmOpportunity(a, op.id).nextAction.taskId, late.id);
  const detail = crm.getOpportunityDetail(a, op.id);
  assert.equal(detail.tasks.filter((t) => t.status === "done").length, 1);
  assert.equal(detail.activities.filter((t) => t.kind === "task:completed").length, 1);
  const technical = db
    .getDb()
    .prepare("SELECT details FROM audit_log WHERE action LIKE 'crm:%'")
    .all()
    .map((r) => r.details)
    .join(" ");
  assert.ok(!technical.includes("medir sala"));
});

test("contact normalization deduplicates same owner without rewriting a name and isolates another portfolio", () => {
  const input = {
    name: "Pessoa QA",
    phone: "(85) 98888-0001",
    email: "pessoa@example.invalid",
    company: "Organização QA",
  };
  const one = crm.createContact(a, input);
  const repeated = crm.createContact(a, {
    ...input,
    name: "PushName de outro aparelho",
    phone: "5585988880001",
  });
  assert.equal(repeated.id, one.id);
  assert.equal(repeated.name, "Pessoa QA");
  assert.equal(one.phone, "5585988880001");
  const other = crm.createContact(b, input);
  assert.notEqual(other.id, one.id);
  assert.equal(crm.findCrmContactByPhone(input.phone), null);
  assert.equal(crm.findCrmContactByPhone(input.phone, a.id).id, one.id);
  const updated = crm.updateContact(a, {
    ...one,
    name: "Pessoa corrigida",
    company: one.company,
    phone: one.phone,
    email: one.email,
    city: one.city,
  });
  assert.equal(updated.name, "Pessoa corrigida");
  assert.throws(() => crm.updateContact(a, { ...one, name: "Edição antiga" }), /Conflito/);
});

test("trusted ingress and transport deduplicate retries, retain messages and reject cross-contact external IDs", () => {
  const input = {
    provider: "evolution-contact",
    externalId: "qa:5585998877001",
    name: "Cliente canal QA",
    phone: "85998877001",
    title: "Atendimento WhatsApp",
    origin: "WhatsApp",
    ownerId: a.id,
    unitId: unit.id,
  };
  const first = crm.ingestCrmLead(input);
  const repeat = crm.ingestCrmLead({ ...input, name: "PushName diferente" });
  assert.equal(repeat.duplicate, true);
  assert.equal(first.opportunity.id, repeat.opportunity.id);
  assert.equal(repeat.contact.name, "Cliente canal QA");
  const message = {
    contactId: first.contact.id,
    provider: "evolution",
    account: "qa",
    externalId: "msg-qa-1",
    from: "cliente",
    text: "Pode me enviar as medidas?",
    at: "2026-11-06T12:00:00Z",
  };
  const stored = crm.recordCrmMessage(message);
  assert.equal(crm.recordCrmMessage(message).id, stored.id);
  assert.equal(crm.listCrmMessages(a, first.contact.id).length, 1);
  assert.equal(
    crm.getCrmBootstrap(a).conversations.find((c) => c.contactId === first.contact.id).unread,
    1,
  );
  crm.markCrmRead(a, first.contact.id);
  assert.equal(
    crm.getCrmBootstrap(a).conversations.find((c) => c.contactId === first.contact.id).unread,
    0,
  );
  assert.equal(
    crm.requireCrmOpportunity(a, first.opportunity.id).awaitingReply,
    true,
    "reading is not responding",
  );
  assert.throws(
    () => crm.recordCrmMessage({ ...message, contactId: opportunityA.contactId }),
    /outro contato/,
  );
  assert.throws(() => crm.listCrmMessages(b, first.contact.id), /Forbidden/);
  crm.updateCrmMessageStatus({
    provider: "evolution",
    account: "qa",
    externalId: message.externalId,
    status: "read",
  });
  crm.updateCrmMessageStatus({
    provider: "evolution",
    account: "qa",
    externalId: message.externalId,
    status: "delivered",
  });
  assert.equal(crm.listCrmMessages(a, first.contact.id)[0].status, "read");
  assert.equal(
    crm.updateCrmMessageStatus({
      provider: "evolution",
      account: "qa",
      externalId: "receipt-before-message",
      status: "read",
    }),
    null,
  );
  const delayed = crm.recordCrmMessage({
    ...message,
    externalId: "receipt-before-message",
    from: "vendedora",
    status: "sent",
  });
  assert.equal(delayed.status, "read", "receipt survives arriving before the message");
  crm.updateCrmMessageStatus({
    provider: "evolution",
    account: "another-instance",
    externalId: delayed.externalId,
    status: "delivered",
  });
  assert.equal(
    crm.listCrmMessages(a, first.contact.id).find((m) => m.id === delayed.id).status,
    "read",
  );
});

test("creating a real quote reuses the existing engine/number and is idempotent without modifying states", () => {
  const op = crm.createOpportunity(a, {
    newContact: { name: "Responsável QA", company: "Empresa nova QA", phone: "85995551122" },
    title: "Mobiliário completo QA",
    origin: "Indicação",
  });
  const created = crm.createQuoteForOpportunity(a, { opportunityId: op.id }, products);
  assert.match(created.numero, /^MAG-Q-/);
  assert.equal(crm.createQuoteForOpportunity(a, { opportunityId: op.id }, products).id, created.id);
  const quote = db.getDb().prepare("SELECT * FROM internal_quotes WHERE id=?").get(created.id);
  assert.equal(quote.customer_name, "Empresa nova QA");
  assert.equal(quote.customer_contact, "Responsável QA");
  assert.equal(quote.owner_id, a.id);
  assert.equal(quote.status, "rascunho");
  const opB = crm.createOpportunity(b, {
    newContact: { name: "Outro QA" },
    title: "Outro projeto QA",
    origin: "Site",
  });
  assert.throws(
    () => crm.linkQuote(admin, { opportunityId: opB.id, quoteId: created.id }),
    /mesmo responsável/,
  );
  assert.equal(db.getDb().prepare("SELECT count(*) n FROM omie_orders").get().n, 0);
});

test("explicit no-unit opportunity is preserved while omitted unit inherits the contact", () => {
  const contact = crm.createContact(a, { name: "Unidade QA", unitId: unit.id });
  const inherited = crm.createOpportunity(a, {
    contactId: contact.id,
    title: "Com unidade QA",
    origin: "Indicação",
  });
  const cleared = crm.createOpportunity(a, {
    contactId: contact.id,
    title: "Sem unidade QA",
    origin: "Indicação",
    unitId: null,
  });
  assert.equal(inherited.unitId, unit.id);
  assert.equal(cleared.unitId, null);
});

test("disabled accounts and revoked commercial roles are rejected even with forged cached profile", () => {
  db.getDb().prepare("UPDATE users SET disabled=1 WHERE id=?").run(b.id);
  assert.throws(() => crm.getCrmBootstrap(b), /Unauthorized/);
  db.getDb().prepare("UPDATE users SET disabled=0,roles='[\"dho\"]' WHERE id=?").run(b.id);
  assert.throws(
    () => crm.createContact({ ...b, roles: ["admin"] }, { name: "Forjado" }),
    /Forbidden/,
  );
});

test("CRM records and original commercial snapshots survive closing/reopening the database", () => {
  const before = crm.getOpportunityDetail(a, opportunityA.id);
  const messages = crm.listCrmMessages(a, opportunityA.contactId);
  db.closeDb();
  const after = crm.getOpportunityDetail(a, opportunityA.id);
  assert.deepEqual(after, before);
  assert.deepEqual(crm.listCrmMessages(a, opportunityA.contactId), messages);
  assert.deepEqual(
    db.getDb().prepare("SELECT * FROM quote_requests WHERE id=?").get(leadA),
    sourceBefore,
  );
  assert.deepEqual(
    db.getDb().prepare("SELECT * FROM internal_quotes WHERE id=?").get(quoteA.id),
    quoteBefore,
  );
});
