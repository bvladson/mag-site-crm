// Isolamento de carteiras (módulo 1 — segurança). Um vendedor nunca consulta nem altera o que é de outro vendedor,
// nem trocando IDs ou endereços de arquivo. Matriz: vendedora A, vendedora B, administrador, DHO e gerente, sobre
// solicitações do site, CRM, anexos, negociações, descontos, Omie, WhatsApp, busca, contagens e métricas.
// A rede fica BLOQUEADA: qualquer negação que chegasse ao Omie ou ao WAHA falharia aqui.
// Complementa crm-core, proposta (PDF), discounts, waha-multiusuario e crm-search, que já cobrem outros casos.
// node --test tests/seguranca-carteiras.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "mag-seguranca-"));
process.env.SITE_DATA_DIR = dir;
process.env.CRM_DISABLE_WORKER = "1";
delete process.env.OMIE_PEDIDOS_URL;
const networkCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  networkCalls.push(String(url));
  throw new Error("rede proibida no teste de carteiras");
};
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const assignments = await import("../src/lib/assignments.server.ts");
const units = await import("../src/lib/units.server.ts");
const quotes = await import("../src/lib/orcamentos.server.ts");
const crm = await import("../src/lib/crm.server.ts");
const media = await import("../src/lib/crm-media.server.ts");
const waha = await import("../src/lib/crm-waha.server.ts");
const siteLeads = await import("../src/lib/site-leads.server.ts");
const panel = await import("../src/lib/panel.server.ts");
const discounts = await import("../src/lib/discounts.server.ts");
const metrics = await import("../src/lib/links-metrics.server.ts");
const omie = await import("../src/lib/omie-conversao.server.ts");
test.after(async () => {
  globalThis.fetch = originalFetch;
  db.closeDb();
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const actor = async (email, roles) => ({
  id: (await auth.createUser(email, "Senha-Forte-123", roles)).id,
  email,
  roles,
  created_at: "",
});
const admin = await actor("admin@carteiras.example", ["admin"]);
const a = await actor("a@carteiras.example", ["comercial"]);
const b = await actor("b@carteiras.example", ["comercial"]);
const dho = await actor("dho@carteiras.example", ["dho"]);
const gerente = await actor("gerente@carteiras.example", ["gerente"]);
const unit = units.listUnitsPublic()[0];
const products = [{ id: "123", sku: "SKU-123", nome: "Cadeira QA", unidade: "UN", slug: "cadeira-qa" }];
// PNG 1x1 válido (o servidor confere a assinatura do arquivo).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

/** Nega com a mensagem esperada, seja erro síncrono ou promessa rejeitada. */
async function denied(call, pattern = /Forbidden/) {
  let error = null;
  try {
    await call();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "a operação deveria ter sido negada");
  assert.match(String(error?.message ?? error), pattern);
}

// ---- Solicitações do site -----------------------------------------------------------------------------------------
function siteQuote(owner, suffix) {
  const saved = db.saveQuote(
    {
      nome: `Pedido QA ${suffix}`,
      empresa: `Empresa QA ${suffix}`,
      whatsapp: `8599999100${suffix}`,
      email: `pedido${suffix}@example.invalid`,
      cidade: "Fortaleza",
      estado: "CE",
      mensagem: "Mensagem artificial",
    },
    [{ slug: "cadeira-qa", sku: "SKU-123", name: "Cadeira QA", qty: 2 }],
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
const leadA = siteQuote(a, 1);
const leadB = siteQuote(b, 2);
const livre = siteQuote(null, 3); // triagem do administrador (decisão D1)
// Caso antigo (antes da D1): a B converteu um pedido e depois ficou sem atribuição — continua da B pela negociação.
const livreConvertidoPelaB = siteQuote(b, 4);
quotes.criarOrcamento(b, products, livreConvertidoPelaB);
db.getDb().prepare("DELETE FROM lead_assignments WHERE lead_id=?").run(livreConvertidoPelaB);
const siteContact = (name) =>
  db.insertLead("contact_requests", { nome: name, empresa: "", email: "contato@example.invalid", whatsapp: "85999990000", assunto: "Dúvida", mensagem: "Mensagem artificial" }).id;
const contatoLivre = siteContact("Contato Livre QA");
const contatoDaA = siteContact("Contato Da A QA");

// ---- CRM da vendedora A (e um atendimento da B) --------------------------------------------------------------------
const contactA = crm.createContact(a, { name: "Cliente Sigiloso A", phone: "5585988880001", email: "clientea@example.invalid", city: "Fortaleza" });
const opportunityA = crm.createOpportunity(a, { contactId: contactA.id, title: "Mesa sigilosa", origin: "WhatsApp" });
crm.recordCrmMessage({ contactId: contactA.id, provider: "qa", account: "carteiras", externalId: randomUUID(), from: "cliente", text: "SEGREDOCARTEIRAA combinado com a vendedora", historical: true });
crm.scheduleTask(a, { opportunityId: opportunityA.id, label: "Ligar para A", due: new Date(Date.now() + 86_400_000).toISOString() });
const taskA = crm.listCrmTasksPage(a, { opportunityId: opportunityA.id }).tasks[0];
const quoteA = quotes.criarOrcamento(a, products);
const mediaA = media.stageCrmMedia(a, { contactId: contactA.id, name: "foto.png", mimeType: "image/png", bytes: PNG });
const contactB = crm.createContact(b, { name: "Cliente da B", phone: "5585988880002", email: "", city: "" });
const opportunityB = crm.createOpportunity(b, { contactId: contactB.id, title: "Armário da B", origin: "Site" });
// O contato do site "da A" foi trazido para uma oportunidade da A.
db.getDb()
  .prepare("INSERT INTO crm_lead_links(provider,external_id,opportunity_id,created_at) VALUES('site:contact',?,?,?)")
  .run(contatoDaA, opportunityA.id, new Date().toISOString());

const ids = (rows) => rows.map((row) => row.id);
const row = (table, id) => db.getDb().prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);

test("solicitações do site: vendedora vê só o que é seu; sem responsável fica na triagem do administrador", () => {
  const deA = ids(siteLeads.listSiteQuotes(a));
  assert.ok(deA.includes(leadA));
  assert.ok(!deA.includes(livre), "sem responsável: triagem do administrador");
  assert.ok(!deA.includes(leadB), "pedido atribuído à B");
  assert.ok(!deA.includes(livreConvertidoPelaB), "pedido sem responsável que a B já converteu");
  const deB = ids(siteLeads.listSiteQuotes(b));
  assert.ok(deB.includes(leadB) && deB.includes(livreConvertidoPelaB) && !deB.includes(livre));
  assert.ok(!deB.includes(leadA));
  assert.equal(siteLeads.listSiteQuotes(admin).length, 4, "administrador vê todos");
  assert.deepEqual(ids(siteLeads.listSiteQuotes(a, { q: "Empresa QA 2" })), [], "a busca respeita a carteira");
  assert.deepEqual(ids(siteLeads.listSiteQuotes(admin, { q: "Empresa QA 2" })), [leadB]);
  const contatosDaB = ids(siteLeads.listSiteContacts(b));
  assert.deepEqual(contatosDaB, [], "contato sem dono é triagem; o da A é da A");
  assert.ok(!ids(siteLeads.listSiteContacts(a)).includes(contatoLivre));
  assert.ok(ids(siteLeads.listSiteContacts(a)).includes(contatoDaA));
  assert.equal(siteLeads.listSiteContacts(admin).length, 2);
});

test("abrir, mudar status ou notas pelo ID de outra carteira é negado e nada muda", async () => {
  await denied(() => siteLeads.readSiteQuote(a, leadB));
  await denied(() => siteLeads.updateSiteLead(a, "quote", { id: leadB, status: "perdido", internal_notes: "forjado" }));
  await denied(() => siteLeads.readSiteQuote(a, livreConvertidoPelaB));
  await denied(() => siteLeads.readSiteContact(b, contatoDaA));
  await denied(() => siteLeads.updateSiteLead(b, "contact", { id: contatoDaA, status: "finalizado" }));
  assert.equal(row("quote_requests", leadB).status, "novo");
  assert.equal(row("quote_requests", leadB).internal_notes, null);
  assert.equal(row("contact_requests", contatoDaA).status, "novo");
  assert.equal(siteLeads.readSiteQuote(a, leadA).id, leadA);
  await denied(() => siteLeads.readSiteQuote(a, livre), /triagem/);
  assert.equal(siteLeads.readSiteQuote(admin, livre).quote_request_items.length, 1, "o administrador faz a triagem");
  assert.equal(siteLeads.readSiteQuote(admin, leadB).id, leadB);
  siteLeads.updateSiteLead(a, "quote", { id: leadA, status: "em atendimento", internal_notes: "retornar amanhã" });
  assert.equal(row("quote_requests", leadA).status, "em atendimento");
  assert.ok(db.getDb().prepare("SELECT 1 FROM audit_log WHERE actor_id=? AND action='update:quote_requests' AND target_id=?").get(a.id, leadA));
  await denied(() => siteLeads.readSiteQuote(a, randomUUID()), /não encontrado/);
});

test("página de Leads, busca geral e resumo do painel seguem a mesma carteira", async () => {
  const leads = ids(assignments.readAssignedLeads(a));
  assert.ok(leads.includes(leadA) && !leads.includes(livre));
  assert.ok(!leads.includes(leadB) && !leads.includes(livreConvertidoPelaB));
  await denied(() => assignments.readLeadAssignment(a, leadB));
  await denied(() => assignments.readLeadAssignment(a, livre));
  assert.equal(assignments.readLeadAssignment(a, leadA).canConvert, true);
  const titles = (user, query) => panel.searchPanelCore(user, query).map((result) => result.title);
  assert.ok(!titles(a, "Pedido QA").includes("Pedido QA 2"));
  assert.ok(titles(a, "Pedido QA").includes("Pedido QA 1"));
  assert.ok(titles(admin, "Pedido QA").includes("Pedido QA 2"));
  assert.deepEqual(titles(b, "Contato Da A"), []);
  assert.deepEqual(titles(admin, "Contato Da A"), ["Contato Da A QA"]);
  const resumo = siteLeads.siteLeadsDashboard(a);
  assert.ok(!ids(resumo.lastQuotes).includes(leadB));
  assert.ok(ids(resumo.lastContacts).includes(contatoDaA), "o contato trazido para a carteira da A aparece para a A");
  assert.ok(!ids(siteLeads.siteLeadsDashboard(b).lastContacts).includes(contatoDaA));
  assert.equal(siteLeads.siteLeadsDashboard(admin).lastQuotes.length, 4);
});

test("lead da triagem não pode ser convertido nem importado pela vendedora, nem pelo ID", async () => {
  await denied(() => quotes.criarOrcamento(a, products, livre), /triagem/);
  await denied(() => crm.importSiteLead(a, { sourceKind: "quote", sourceId: livre }));
  await denied(() => crm.importSiteLead(b, { sourceKind: "contact", sourceId: contatoLivre }));
  assert.equal(db.getDb().prepare("SELECT count(*) n FROM internal_quotes WHERE source_request_id=?").get(livre).n, 0);
  const deA = quotes.criarOrcamento(a, products, leadA);
  assert.ok(deA.id, "o que é dela continua convertendo normalmente");
});

test("perfis sem acesso comercial não leem solicitações, negociações, anexos nem WhatsApp", async () => {
  for (const user of [dho, gerente]) {
    await denied(() => siteLeads.listSiteQuotes(user));
    await denied(() => siteLeads.readSiteQuote(user, leadA));
    await denied(() => siteLeads.listSiteContacts(user));
    await denied(() => assignments.readAssignedLeads(user));
    await denied(() => quotes.lerOrcamento(user, quoteA.id));
    await denied(() => media.readCrmMedia(user, mediaA.id));
    await denied(() => crm.getCrmContactDetail(user, contactA.id));
    await denied(() => waha.readWahaContactContext(user, contactA.id));
  }
});

test("CRM: conversa, tarefas, leitura, etapas e vínculos de proposta de outra carteira são negados", async () => {
  const before = row("crm_opportunities", opportunityA.id);
  await denied(() => crm.getCrmContactDetail(b, contactA.id));
  await denied(() => crm.listCrmMessagesPage(b, { contactId: contactA.id }));
  await denied(() => crm.markCrmRead(b, contactA.id));
  await denied(() => crm.listCrmTasksPage(b, { opportunityId: opportunityA.id }));
  await denied(() => crm.completeTask(b, { id: taskA.id }));
  await denied(() => crm.moveOpportunity(b, { id: opportunityA.id, revision: before.revision, stage: "perdido", lossReason: "Preço" }));
  await denied(() => crm.updateContact(b, { id: contactA.id, revision: contactA.revision, name: "forjado" }));
  await denied(() => crm.previewCrmQuoteLink(b, { opportunityId: opportunityB.id, quoteId: quoteA.id }));
  await denied(() => crm.linkQuote(b, { opportunityId: opportunityB.id, quoteId: quoteA.id }));
  await denied(() => crm.importSiteLead(b, { sourceKind: "quote", sourceId: leadA }));
  await denied(() => crm.listCrmContactsPage(b, { ownerId: a.id }));
  const after = row("crm_opportunities", opportunityA.id);
  assert.deepEqual([after.stage, after.revision], [before.stage, before.revision]);
  assert.equal(row("crm_tasks", taskA.id).status, "pending");
  assert.equal(row("crm_contacts", contactA.id).name, "Cliente Sigiloso A");
  const search = (user) => {
    for (let pass = 0; pass < 50; pass++) {
      const page = crm.listCrmContactsPage(user, { search: "SEGREDOCARTEIRAA", searchMode: "all" });
      if (page.searchIndex?.ready !== false) return page;
    }
    throw new Error("índice de busca não terminou");
  };
  assert.deepEqual(ids(search(b).contacts), [], "a busca por texto da conversa não atravessa carteiras");
  assert.deepEqual(ids(search(a).contacts), [contactA.id]);
});

test("anexos: enviar, abrir ou reaproveitar arquivo de outra carteira é negado, inclusive forjando o ID", async () => {
  await denied(() => media.stageCrmMedia(b, { contactId: contactA.id, name: "x.png", mimeType: "image/png", bytes: PNG }));
  await denied(() => media.readCrmMedia(b, mediaA.id));
  await denied(() => media.getCrmMediaForSend(b, mediaA.id));
  for (const forged of ["../../secrets/omie.env", "..%2F..%2Fdata%2Fsite.db", `${mediaA.id}/../x`, "", randomUUID()])
    await denied(() => media.readCrmMedia(a, forged), /não encontrado/);
  assert.equal(media.readCrmMedia(a, mediaA.id).status, 200);
  assert.equal(media.readCrmMedia(admin, mediaA.id).status, 200, "administrador supervisiona");
});

test("negociações, descontos e Omie: outra carteira é negada antes de qualquer chamada externa", async () => {
  await denied(() => quotes.lerOrcamento(b, quoteA.id));
  await denied(() => quotes.mudarEstado(b, quoteA.id, "cancelar", 1));
  await denied(() => quotes.duplicarOrcamento(b, quoteA.id));
  assert.ok(!ids(quotes.listarOrcamentos(b, {})).includes(quoteA.id));
  await denied(() => discounts.discountStatus(b, quoteA.id));
  await denied(() => discounts.requestDiscountApproval(b, quoteA.id));
  for (const call of [
    () => omie.verificarNoOmie(b, quoteA.id),
    () => omie.prepararRevisao(b, quoteA.id),
    () => omie.usarEmailDoCadastro(b, quoteA.id),
    () => omie.buscarClientesOmie(b, quoteA.id, { nome: "Empresa" }),
    () => omie.vincularCliente(b, quoteA.id, "123"),
    () => omie.criarClienteOmie(b, quoteA.id),
    () => omie.atualizarStatus(b, quoteA.id),
  ])
    await denied(call);
  // gerarPedido confere primeiro o código da revisão, que é preso ao MESMO usuário e orçamento e só nasce em
  // prepararRevisao (negado acima para a B). Código congelado desde a homologação do Omie: só conferimos a negação.
  await denied(() => omie.gerarPedido(b, quoteA.id, "0".repeat(48), { revisado: true, semEstoque: true }), /Forbidden|revisão expirou/);
  assert.equal(row("internal_quotes", quoteA.id).status, "rascunho");
  assert.deepEqual(networkCalls, [], "nenhuma negação chegou à rede");
});

test("WhatsApp: contexto, fila, vínculo, envio e histórico de contato de outra carteira são negados; linhas só do administrador", async () => {
  await denied(() => waha.readWahaContactContext(b, contactA.id));
  await denied(() => waha.readWahaOutbox(b, { contactId: contactA.id }));
  await denied(() => waha.bindWahaContactOpportunity(b, { contactId: contactA.id, opportunityId: opportunityA.id }));
  await denied(() => waha.sendWahaMessage(b, { contactId: contactA.id, text: "forjado", clientMessageId: randomUUID() }));
  await denied(() => waha.syncWahaContactHistory(b, contactA.id));
  await denied(() => waha.readWahaSettings(a));
  await denied(() => waha.retryWahaEvent(a, randomUUID()));
  await denied(() => waha.syncWahaHistory(a, {}));
  await denied(() => waha.setWahaLineStatus(a, { id: randomUUID(), revision: 1, status: "disabled" }));
  await denied(() => waha.saveWahaLine(a, { userId: a.id, expectedPhone: "5585991110009" }));
  await denied(() => waha.controlWahaSession(a, { action: "configure" }));
  assert.ok(!waha.readWahaOutbox(b, {}).items.some((item) => item.contactId === contactA.id));
  assert.deepEqual(networkCalls, [], "nenhuma negação chegou ao WAHA");
});

test("contagens, busca de negociações e métricas comerciais ficam na carteira", () => {
  assert.ok(!panel.panelCountsCore(b).next.some((quote) => quote.id === quoteA.id));
  assert.ok(panel.panelCountsCore(a).next.some((quote) => quote.id === quoteA.id));
  const found = (user, query) => panel.searchPanelCore(user, query).map((result) => `${result.title} ${result.subtitle}`).join(" | ");
  assert.doesNotMatch(found(b, "Sigiloso"), /Sigiloso/);
  assert.match(found(a, "Sigiloso"), /Mesa sigilosa/);
  assert.match(found(admin, "Sigiloso"), /Mesa sigilosa/);
  const deB = metrics.readCommercialMetrics(b, 30);
  const deA = metrics.readCommercialMetrics(a, 30);
  assert.equal(deB.scope, "pessoal");
  assert.equal(deA.negotiations, 2, "só as negociações da própria A (manual + pedido do site dela)");
  assert.equal(deB.negotiations, 1, "só a negociação da própria B");
  assert.equal(metrics.readCommercialMetrics(admin, 30).negotiations, 3);
});
