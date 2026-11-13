// Catálogo no Atendimento (etapa 2): rascunho por oportunidade (sem preço, preso ao dono), negociação gerada pelo motor
// da MAG exatamente uma vez e pedidos do cliente por carteira. Rede bloqueada: nada aqui chama o Omie.
// node --test tests/crm-catalogo.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "mag-catalogo-"));
process.env.SITE_DATA_DIR = dir;
process.env.CRM_DISABLE_WORKER = "1";
delete process.env.OMIE_PEDIDOS_URL;
const networkCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  networkCalls.push(String(url));
  throw new Error("rede proibida no teste do catálogo");
};
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const crm = await import("../src/lib/crm.server.ts");
const catalogo = await import("../src/lib/crm-catalogo.server.ts");
test.after(async () => {
  globalThis.fetch = originalFetch;
  db.closeDb();
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});
const actor = async (email, roles) => ({ id: (await auth.createUser(email, "Senha-Forte-123", roles)).id, email, roles, created_at: "" });
const admin = await actor("admin@catalogo.example", ["admin"]);
const a = await actor("a@catalogo.example", ["comercial"]);
const b = await actor("b@catalogo.example", ["comercial"]);
const dho = await actor("dho@catalogo.example", ["dho"]);
const products = [
  { id: "1001", sku: "CAD-01", nome: "Cadeira QA", unidade: "UN", slug: "cadeira-qa" },
  { id: "1002", sku: "MES-02", nome: "Mesa QA", unidade: "UN", slug: null },
  { id: "1003", sku: "TAP-03", nome: "Tampo QA", unidade: "M2", slug: null },
];
const contactA = crm.createContact(a, { name: "Cliente A", phone: "5585988881001", email: "", city: "" });
const oppA = crm.createOpportunity(a, { contactId: contactA.id, title: "Sala de reunião", origin: "WhatsApp" });
const contactB = crm.createContact(b, { name: "Cliente B", phone: "5585988881002", email: "", city: "" });
crm.createOpportunity(b, { contactId: contactB.id, title: "Recepção", origin: "Site" });
const row = (sql, ...params) => db.getDb().prepare(sql).get(...params);
const all = (sql, ...params) => db.getDb().prepare(sql).all(...params);

async function denied(call, pattern = /Forbidden/) {
  let error = null;
  try {
    await call();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "deveria negar");
  assert.match(String(error?.message ?? error), pattern);
}

test("rascunho por oportunidade: só a carteira dona lê e altera; revisão protege edição concorrente", async () => {
  assert.deepEqual(catalogo.lerRascunho(a, oppA.id), { opportunityId: oppA.id, itens: [], revision: 0, atualizadoEm: null });
  const saved = catalogo.salvarRascunho(a, { opportunityId: oppA.id, revision: 0, itens: [{ produtoId: "1001", quantidade: 4 }, { produtoId: "1003", quantidade: 2.5 }] }, products);
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.itens, [
    { produtoId: "1001", sku: "CAD-01", nome: "Cadeira QA", unidade: "UN", quantidade: 4 },
    { produtoId: "1003", sku: "TAP-03", nome: "Tampo QA", unidade: "M2", quantidade: 2.5 },
  ]);
  await denied(() => catalogo.salvarRascunho(a, { opportunityId: oppA.id, revision: 0, itens: [] }, products), /Conflito/);
  for (const user of [b, dho]) {
    await denied(() => catalogo.lerRascunho(user, oppA.id));
    await denied(() => catalogo.salvarRascunho(user, { opportunityId: oppA.id, revision: 1, itens: [] }, products));
  }
  assert.equal(catalogo.lerRascunho(admin, oppA.id).itens.length, 2, "administrador supervisiona");
  for (const [itens, pattern] of [
    [[{ produtoId: "1001", quantidade: 1 }, { produtoId: "1001", quantidade: 2 }], /duas vezes/],
    [[{ produtoId: "1001", quantidade: 0 }], /Quantidade inválida/],
    [[{ produtoId: "1001", quantidade: 1.2345 }], /Quantidade inválida/],
    [[{ produtoId: "1001", quantidade: 200_000 }], /Quantidade inválida/],
    [[{ produtoId: "9999", quantidade: 1 }], /não encontrado/],
    [[{ produtoId: "../x", quantidade: 1 }], /Produto inválido/],
    [Array.from({ length: 200 }, (_, i) => ({ produtoId: String(5000 + i), quantidade: 1 })), /No máximo 199/],
  ])
    await denied(() => catalogo.salvarRascunho(a, { opportunityId: oppA.id, revision: 1, itens }, products), pattern);
  assert.equal(catalogo.lerRascunho(a, oppA.id).revision, 1, "nada mudou com as tentativas inválidas");
  assert.ok(row("SELECT 1 FROM audit_log WHERE action='crm:draft:saved' AND target_id=?", oppA.id));
});

test("rascunho de quem perdeu a oportunidade não vaza para o novo dono", async () => {
  const contact = crm.createContact(a, { name: "Cliente em transferência", phone: "5585988881003", email: "", city: "" });
  const opp = crm.createOpportunity(a, { contactId: contact.id, title: "Transferência", origin: "Site" });
  catalogo.salvarRascunho(a, { opportunityId: opp.id, revision: 0, itens: [{ produtoId: "1002", quantidade: 1 }] }, products);
  db.getDb().prepare("UPDATE crm_opportunities SET owner_id=? WHERE id=?").run(b.id, opp.id);
  db.getDb().prepare("UPDATE crm_contacts SET owner_id=? WHERE id=?").run(b.id, contact.id);
  assert.deepEqual(catalogo.lerRascunho(b, opp.id).itens, [], "a B começa sem o rascunho da A");
  await denied(() => catalogo.lerRascunho(a, opp.id));
  assert.equal(catalogo.salvarRascunho(b, { opportunityId: opp.id, revision: 0, itens: [{ produtoId: "1001", quantidade: 3 }] }, products).revision, 1);
});

test("gerar orçamento: cria pelo motor com preço zero, apaga o rascunho e não repete itens", async () => {
  await denied(() => catalogo.gerarOrcamentoDoRascunho(b, { opportunityId: oppA.id, revision: 1 }, products));
  await denied(() => catalogo.gerarOrcamentoDoRascunho(a, { opportunityId: oppA.id, revision: 7 }, products), /Conflito/);
  const first = catalogo.gerarOrcamentoDoRascunho(a, { opportunityId: oppA.id, revision: 1 }, products);
  assert.match(first.detailUrl, /^\/interno\/orcamentos-internos\/[0-9a-f-]{36}$/);
  assert.equal(first.adicionados, 2);
  const items = all("SELECT sku,quantity,unit_price_cents,total_cents,position FROM internal_quote_items WHERE quote_id=? ORDER BY position", first.quoteId);
  assert.deepEqual(items.map((i) => [i.sku, i.quantity, i.unit_price_cents, i.total_cents, i.position]), [["CAD-01", 4, 0, 0, 1], ["TAP-03", 2.5, 0, 0, 2]]);
  assert.ok(row("SELECT 1 FROM crm_quote_links WHERE opportunity_id=? AND quote_id=?", oppA.id, first.quoteId), "negociação ligada à oportunidade");
  assert.equal(row("SELECT owner_id FROM internal_quotes WHERE id=?", first.quoteId).owner_id, a.id);
  assert.deepEqual(catalogo.lerRascunho(a, oppA.id).itens, [], "rascunho apagado junto");
  await denied(() => catalogo.gerarOrcamentoDoRascunho(a, { opportunityId: oppA.id, revision: 1 }, products), /vazio/);
  // Novo rascunho vai para a MESMA negociação, no fim da lista, com nova versão.
  catalogo.salvarRascunho(a, { opportunityId: oppA.id, revision: 0, itens: [{ produtoId: "1002", quantidade: 1 }] }, products);
  const second = catalogo.gerarOrcamentoDoRascunho(a, { opportunityId: oppA.id, revision: 1 }, products);
  assert.equal(second.quoteId, first.quoteId);
  assert.equal(second.versao, first.versao + 1);
  assert.deepEqual(all("SELECT sku,position FROM internal_quote_items WHERE quote_id=? ORDER BY position", first.quoteId).map((i) => `${i.position}:${i.sku}`), ["1:CAD-01", "2:TAP-03", "3:MES-02"]);
  assert.ok(row("SELECT 1 FROM audit_log WHERE action='quote:items:added' AND target_id=?", first.quoteId));
  assert.ok(row("SELECT 1 FROM audit_log WHERE action='crm:draft:converted' AND target_id=?", oppA.id));
  // Negociação aceita não muda: o rascunho fica guardado para o vendedor decidir.
  db.getDb().prepare("UPDATE internal_quotes SET status='aceito' WHERE id=?").run(first.quoteId);
  catalogo.salvarRascunho(a, { opportunityId: oppA.id, revision: 0, itens: [{ produtoId: "1001", quantidade: 1 }] }, products);
  await denied(() => catalogo.gerarOrcamentoDoRascunho(a, { opportunityId: oppA.id, revision: 1 }, products), /não pode ser alterado/);
  assert.equal(catalogo.lerRascunho(a, oppA.id).itens.length, 1);
  assert.equal(all("SELECT 1 FROM internal_quote_items WHERE quote_id=?", first.quoteId).length, 3);
  db.getDb().prepare("UPDATE internal_quotes SET status='rascunho' WHERE id=?").run(first.quoteId);
});

test("pedidos do cliente: só da carteira, com a etapa do Omie já registrada, sem rede", async () => {
  const quoteId = row("SELECT quote_id FROM crm_quote_links WHERE opportunity_id=?", oppA.id).quote_id;
  const now = new Date().toISOString();
  db.getDb().prepare("INSERT OR REPLACE INTO omie_refs(kind,code,label,extra,inactive,synced_at) VALUES('etapa','20','Separação','{}',0,?)").run(now);
  db.getDb()
    .prepare("INSERT INTO omie_orders(quote_id,integration_code,state,omie_order_number,status_stage,status_invoiced,status_checked_at,sent_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(quoteId, "MAG-QA-1", "criado", "1234", "20", 0, now, now, now, now);
  const { pedidos } = catalogo.pedidosDoContato(a, contactA.id);
  assert.equal(pedidos.length, 1);
  assert.deepEqual(
    { numero: pedidos[0].pedido.numero, etapa: pedidos[0].pedido.etapa, estado: pedidos[0].pedido.estado, faturado: pedidos[0].pedido.faturado },
    { numero: "1234", etapa: "Separação", estado: "criado", faturado: false },
  );
  for (const user of [b, dho]) await denied(() => catalogo.pedidosDoContato(user, contactA.id));
  assert.equal(catalogo.pedidosDoContato(admin, contactA.id).pedidos.length, 1);
  assert.deepEqual(catalogo.pedidosDoContato(b, contactB.id).pedidos, []);
  assert.deepEqual(networkCalls, [], "nada aqui chamou a rede");
});
