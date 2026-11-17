// Etapa 4 — funis configuráveis: migração sem perdas, ida e volta de versão, carteira + funis liberados no servidor,
// campos obrigatórios, estrutura (incluir/reordenar/excluir etapa, arquivar funil) e acessos. Dados 100% fictícios.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "mag-crm-funil-"));
process.env.SITE_DATA_DIR = dir;
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const crm = await import("../src/lib/crm.server.ts");
const funil = await import("../src/lib/crm-funil.server.ts");
const rules = await import("../src/lib/crm-pipelines.ts");

async function actor(email, roles) {
  return { id: (await auth.createUser(email, "Senha-Forte-123", roles)).id, email, roles, created_at: "" };
}
const admin = await actor("admin@funil.example", ["admin"]);
const a = await actor("a@funil.example", ["comercial"]);
const b = await actor("b@funil.example", ["comercial"]);
const products = [{ id: "123", sku: "SKU-123", nome: "Cadeira QA", unidade: "UN", slug: "cadeira-qa" }];
const sql = () => db.getDb();
const opp = (id) => sql().prepare("SELECT * FROM crm_opportunities WHERE id=?").get(id);
const pipelines = () => funil.loadPipelines(sql());
const byName = (name) => pipelines().find((pipeline) => pipeline.name === name);
const stageNamed = (pipeline, label) => pipeline.stages.find((stage) => stage.label === label);
const count = (table) => Number(sql().prepare(`SELECT count(*) n FROM ${table}`).get().n);
let seq = 0;
function newOpp(owner, title = `Negócio QA ${++seq}`) {
  return crm.createOpportunity(owner, {
    newContact: { name: `Cliente QA ${seq}`, phone: `8599700${String(seq).padStart(4, "0")}` },
    title,
    origin: "Indicação",
  });
}
const move = (who, id, stageId, extra = {}) =>
  crm.moveOpportunityStage(who, { id, revision: opp(id).revision, stageId, ...extra });
const editable = (pipeline) =>
  pipeline.stages.map(({ id, label, color, kind, probability, wipLimit, staleDays, requiredFields }) => ({
    id, label, color, kind, probability, wipLimit, staleDays, requiredFields,
  }));

// Negócios do "formato de hoje" (antes da Etapa 4).
const o = {};
test("migração: negócios de antes entram no funil Vendas na mesma etapa, sem perder vínculos, e pode rodar de novo", () => {
  crm.ensureCrmSchema();
  for (const key of ["novo", "conversando", "orcamento", "fechado", "perdido"]) o[key] = newOpp(a).id;
  o.deB = newOpp(b).id;
  crm.scheduleTask(a, { opportunityId: o.conversando, label: "Ligar para o cliente", due: "2026-11-20T12:00:00Z" });
  const quote = crm.createQuoteForOpportunity(a, { opportunityId: o.orcamento }, products);
  o.quoteId = quote.id;
  // Simula a produção de hoje: sem tabelas de funil e só a categoria gravada.
  sql().exec(`DELETE FROM crm_pipeline_defaults; DELETE FROM crm_pipeline_access; DELETE FROM crm_pipeline_stages; DELETE FROM crm_pipelines;
    UPDATE crm_opportunities SET pipeline_id=NULL,stage_id=NULL,stage_entered_at=NULL,position=NULL;`);
  for (const key of ["conversando", "orcamento", "fechado", "perdido"])
    sql().prepare("UPDATE crm_opportunities SET stage=?,loss_reason=? WHERE id=?").run(key, key === "perdido" ? "Preço" : null, o[key]);
  sql().prepare("UPDATE crm_opportunities SET stage='conversando' WHERE id=?").run(o.deB);
  const before = {
    activities: count("crm_activities"), tasks: count("crm_tasks"), links: count("crm_quote_links"),
    quotes: count("internal_quotes"), contacts: count("crm_contacts"), opps: count("crm_opportunities"),
    revisions: Object.fromEntries(Object.values(o).filter((id) => opp(id)).map((id) => [id, opp(id).revision])),
  };

  funil.migrateFunis(sql());

  assert.equal(pipelines().length, 1);
  const vendas = byName("Vendas");
  assert.equal(vendas.scope, "shared");
  assert.equal(vendas.isDefault, true);
  assert.deepEqual(vendas.stages.map((s) => [s.label, s.kind]), [
    ["Novo", "open"], ["Conversando", "open"], ["Orçamento enviado", "open"], ["Fechado", "won"], ["Não fechou", "lost"],
  ]);
  assert.ok(vendas.stages.every((s) => s.requiredFields.length === 0), "nenhuma etapa nasce exigindo campo (E4-6)");
  const expected = { novo: "Novo", conversando: "Conversando", orcamento: "Orçamento enviado", fechado: "Fechado", perdido: "Não fechou" };
  for (const [legacy, label] of Object.entries(expected)) {
    const row = opp(o[legacy]);
    assert.equal(row.pipeline_id, vendas.id);
    assert.equal(row.stage_id, stageNamed(vendas, label).id, `${legacy} → ${label}`);
    assert.equal(row.stage, legacy, "a categoria não muda");
    assert.ok(row.stage_entered_at && row.position !== null);
    assert.equal(row.revision, before.revisions[o[legacy]], "migrar não muda a versão do negócio");
  }
  assert.equal(opp(o.perdido).loss_reason, "Preço");
  assert.equal(opp(o.deB).stage_id, stageNamed(vendas, "Conversando").id);
  assert.deepEqual(
    { activities: count("crm_activities"), tasks: count("crm_tasks"), links: count("crm_quote_links"), quotes: count("internal_quotes"), contacts: count("crm_contacts"), opps: count("crm_opportunities") },
    { activities: before.activities, tasks: before.tasks, links: before.links, quotes: before.quotes, contacts: before.contacts, opps: before.opps },
    "nada apagado nem criado em atividades, tarefas, propostas, vínculos, contatos ou negócios",
  );
  assert.equal(sql().prepare("SELECT opportunity_id FROM crm_quote_links WHERE quote_id=?").get(o.quoteId).opportunity_id, o.orcamento);
  for (const seller of [a, b]) {
    assert.deepEqual(funil.allowedPipelineIds(sql(), seller.id), [vendas.id]);
    assert.equal(funil.defaultPipelineIdOf(sql(), seller.id), vendas.id);
  }
  const snapshot = () => JSON.stringify([
    sql().prepare("SELECT * FROM crm_opportunities ORDER BY id").all(),
    sql().prepare("SELECT * FROM crm_pipelines ORDER BY id").all(),
    sql().prepare("SELECT * FROM crm_pipeline_stages ORDER BY id").all(),
    sql().prepare("SELECT * FROM crm_pipeline_access ORDER BY pipeline_id,user_id").all(),
  ]);
  const once = snapshot();
  funil.migrateFunis(sql());
  assert.equal(snapshot(), once, "rodar a migração de novo não muda nada");
});

test("ida e volta de versão: o que a versão anterior moveu ou criou é realinhado pela categoria", () => {
  const vendas = byName("Vendas");
  const movedAt = new Date(Date.now() - 3600_000).toISOString();
  sql().prepare("UPDATE crm_opportunities SET stage='orcamento' WHERE id=?").run(o.novo);
  sql().prepare("INSERT INTO crm_activities(id,opportunity_id,actor_id,kind,label,created_at) VALUES(?,?,?,?,?,?)")
    .run(randomUUID(), o.novo, a.id, "stage:changed", "Novo → Orçamento enviado", movedAt);
  const contact = opp(o.novo).contact_id;
  o.antiga = randomUUID();
  sql().prepare(`INSERT INTO crm_opportunities(id,contact_id,owner_id,unit_id,title,interest,origin,source_kind,source_id,created_at,updated_at,last_interaction)
    VALUES(?,?,?,NULL,?,'','Site',NULL,NULL,?,?,?)`).run(o.antiga, contact, a.id, "Criado pela versão anterior", movedAt, movedAt, movedAt);
  funil.migrateFunis(sql());
  assert.equal(opp(o.novo).stage_id, stageNamed(vendas, "Orçamento enviado").id);
  assert.equal(opp(o.novo).stage_entered_at, movedAt, "tempo na etapa vem da mudança registrada");
  assert.equal(opp(o.antiga).pipeline_id, vendas.id);
  assert.equal(opp(o.antiga).stage_id, stageNamed(vendas, "Novo").id);
});

test("carteira e funis liberados no servidor: funil compartilhado não abre negócio de outra pessoa", () => {
  const vendas = byName("Vendas");
  const lic = funil.createPipeline(admin, { name: "Licitações", scope: "specialized" });
  funil.setPipelineAccess(admin, { pipelineId: lic.id, userId: b.id, allowed: true });
  const names = (who) => crm.getCrmBootstrap(who).pipelines.map((p) => p.name).sort();
  assert.deepEqual(names(a), ["Vendas"]);
  assert.deepEqual(names(b), ["Licitações", "Vendas"]);
  assert.deepEqual(names(admin), ["Licitações", "Vendas"]);
  assert.equal(crm.getCrmBootstrap(a).defaultPipelineId, vendas.id);
  assert.ok(crm.getCrmBootstrap(a).opportunities.every((item) => item.ownerId === a.id), "vendedora só recebe a própria carteira");
  assert.ok(!crm.getCrmBootstrap(a).opportunities.some((item) => item.id === o.deB));

  const licNovo = stageNamed(lic, "Novo");
  assert.throws(() => move(a, o.conversando, licNovo.id, { pipelineId: lic.id }), /Forbidden: o responsável/);
  const moved = move(b, o.deB, stageNamed(lic, "Em negociação").id, { pipelineId: lic.id });
  assert.equal(moved.pipelineId, lic.id);
  assert.equal(opp(o.deB).stage, "orcamento", "última etapa aberta = categoria orçamento");
  const log = sql().prepare("SELECT label FROM crm_activities WHERE opportunity_id=? AND kind='stage:changed' ORDER BY created_at DESC LIMIT 1").get(o.deB).label;
  assert.equal(log, "Vendas · Conversando → Licitações · Em negociação");
  assert.ok(sql().prepare("SELECT 1 FROM audit_log WHERE action='crm:funil:movimento' AND target_id=? AND actor_id=?").get(o.deB, b.id));

  assert.throws(() => move(a, o.deB, licNovo.id), /Forbidden: oportunidade indisponível/);
  assert.throws(() => crm.requireCrmOpportunity(a, o.deB), /Forbidden/);
  assert.throws(() => move(a, o.conversando, randomUUID()), /Etapa inválida/);
  assert.throws(() => move(a, o.conversando, licNovo.id, { pipelineId: randomUUID() }), /Funil indisponível/);
  for (const call of [
    () => funil.listFunilAdmin(a),
    () => funil.createPipeline(a, { name: "Meu", scope: "personal" }),
    () => funil.updatePipeline(a, { id: vendas.id, revision: vendas.revision, name: "X" }),
    () => funil.saveStages(a, { pipelineId: vendas.id, revision: vendas.revision, stages: editable(vendas) }),
    () => funil.setPipelineAccess(a, { pipelineId: lic.id, userId: a.id, allowed: true }),
    () => funil.setDefaultPipeline(a, { userId: a.id, pipelineId: vendas.id }),
    () => funil.archivePipeline(a, { id: lic.id, revision: lic.revision, targetPipelineId: vendas.id }),
    () => funil.funilAsSeller(a, b.id),
  ])
    assert.throws(call, /Forbidden/);

  const asA = funil.funilAsSeller(admin, a.id);
  assert.deepEqual(asA.pipelineIds, [vendas.id]);
  const mine = sql().prepare("SELECT id FROM crm_opportunities WHERE owner_id=? ORDER BY id").all(a.id).map((row) => row.id);
  assert.deepEqual([...asA.opportunityIds].sort(), mine, "Visualizar como = exatamente a carteira dela");
});

test("campos obrigatórios conferidos no servidor, perda com motivo e conflito de versão", () => {
  let vendas = byName("Vendas");
  const stages = editable(vendas).map((stage) =>
    stage.label === "Orçamento enviado" ? { ...stage, requiredFields: ["value", "nextAction"] } : stage);
  funil.saveStages(admin, { pipelineId: vendas.id, revision: vendas.revision, stages });
  vendas = byName("Vendas");
  const orc = stageNamed(vendas, "Orçamento enviado");
  const fresh = newOpp(a).id;
  assert.throws(() => move(a, fresh, orc.id), /Valor \(proposta ou estimado\), Próxima ação agendada/);
  assert.throws(() => move(a, o.conversando, orc.id), /Para entrar em “Orçamento enviado”, preencha: Valor/);
  const ok = move(a, fresh, orc.id, {
    fields: { estimatedValueCents: 150000, nextAction: { label: "Enviar proposta revisada", due: "2026-11-21T12:00:00Z" } },
  });
  assert.equal(ok.stageId, orc.id);
  assert.equal(opp(fresh).estimated_value_cents, 150000);
  assert.ok(sql().prepare("SELECT 1 FROM crm_tasks WHERE opportunity_id=? AND label=?").get(fresh, "Enviar proposta revisada"));

  sql().prepare("UPDATE internal_quotes SET total_cents=50000 WHERE id=?").run(o.quoteId);
  assert.equal(funil.opportunityValueCents(sql(), o.orcamento), 50000, "proposta válida conta como valor");
  sql().prepare("UPDATE internal_quotes SET status='cancelado' WHERE id=?").run(o.quoteId);
  assert.equal(funil.opportunityValueCents(sql(), o.orcamento), null, "proposta cancelada não conta");
  sql().prepare("UPDATE internal_quotes SET status='rascunho' WHERE id=?").run(o.quoteId);

  assert.throws(() => crm.moveOpportunity(a, { id: fresh, revision: opp(fresh).revision, stage: "perdido" }), /motivo da perda/);
  crm.moveOpportunity(a, { id: fresh, revision: opp(fresh).revision, stage: "perdido", lossReason: "Prazo" });
  assert.equal(opp(fresh).stage_id, stageNamed(vendas, "Não fechou").id);
  assert.equal(opp(fresh).loss_reason, "Prazo");
  const stale = opp(o.novo).revision;
  move(a, o.novo, stageNamed(vendas, "Conversando").id);
  assert.throws(() => crm.moveOpportunityStage(a, { id: o.novo, revision: stale, stageId: stageNamed(vendas, "Novo").id }), /Conflito/);
});

test("estrutura: incluir, reordenar e excluir etapa sem perder negócio", () => {
  let vendas = byName("Vendas");
  const total = count("crm_opportunities");
  const open = editable(vendas).filter((s) => s.kind === "open");
  const closed = editable(vendas).filter((s) => s.kind !== "open");
  const visita = { label: "Visita técnica", color: "foreground", probability: 45, wipLimit: 3, staleDays: 4, requiredFields: [] };
  funil.saveStages(admin, { pipelineId: vendas.id, revision: vendas.revision, stages: [open[0], open[1], visita, open[2], ...closed] });
  vendas = byName("Vendas");
  assert.deepEqual(vendas.stages.map((s) => s.label), ["Novo", "Conversando", "Visita técnica", "Orçamento enviado", "Fechado", "Não fechou"]);
  assert.equal(rules.legacyStageFor(vendas, stageNamed(vendas, "Visita técnica").id), "conversando");
  assert.equal(opp(o.orcamento).stage, "orcamento");

  // Orçamento antes da visita: a categoria acompanha a posição e é regravada nos negócios.
  const e = editable(vendas);
  funil.saveStages(admin, { pipelineId: vendas.id, revision: vendas.revision, stages: [e[0], e[1], e[3], e[2], e[4], e[5]] });
  vendas = byName("Vendas");
  assert.equal(opp(o.orcamento).stage, "conversando");
  assert.equal(opp(o.orcamento).stage_id, stageNamed(vendas, "Orçamento enviado").id, "a etapa do negócio não muda");

  const conversando = stageNamed(vendas, "Conversando");
  const without = (label) => editable(vendas).filter((s) => s.label !== label);
  assert.throws(
    () => funil.saveStages(admin, { pipelineId: vendas.id, revision: vendas.revision, stages: without("Conversando") }),
    /Escolha para onde vão os \d+ negócio\(s\) da etapa “Conversando”/,
  );
  assert.throws(() => funil.saveStages(admin, { pipelineId: vendas.id, revision: vendas.revision, stages: without("Fechado") }), /ganho e de perda não podem ser excluídas|exatamente uma etapa de ganho/);
  assert.throws(() => funil.saveStages(admin, { pipelineId: vendas.id, revision: vendas.revision, stages: [...editable(vendas), { label: "novo", color: "info" }] }), /mesmo nome/);
  assert.throws(() => funil.saveStages(admin, { pipelineId: vendas.id, revision: vendas.revision - 1, stages: editable(vendas) }), /Conflito: o funil mudou/);
  const inConversando = sql().prepare("SELECT id FROM crm_opportunities WHERE stage_id=?").all(conversando.id).map((r) => r.id);
  assert.ok(inConversando.length > 0);
  const result = funil.saveStages(admin, {
    pipelineId: vendas.id, revision: vendas.revision, stages: without("Conversando"), moves: { [conversando.id]: stageNamed(vendas, "Novo").id },
  });
  assert.equal(result.moved, inConversando.length);
  for (const id of inConversando) {
    assert.equal(opp(id).stage_id, stageNamed(vendas, "Novo").id);
    assert.ok(
      sql().prepare("SELECT 1 FROM crm_activities WHERE opportunity_id=? AND kind='stage:changed' AND label LIKE '%(etapa excluída)%'").get(id),
      "movimento registrado na linha do tempo",
    );
  }
  assert.ok(sql().prepare("SELECT archived_at FROM crm_pipeline_stages WHERE id=?").get(conversando.id).archived_at, "etapa arquivada, não apagada");
  assert.equal(count("crm_opportunities"), total);
});

test("acessos: funil individual, retirar acesso com negócios, funil padrão e arquivar funil", () => {
  const vendas = byName("Vendas");
  const lic = byName("Licitações");
  const daA = funil.createPipeline(admin, { name: "Funil da A", scope: "personal" });
  funil.setPipelineAccess(admin, { pipelineId: daA.id, userId: a.id, allowed: true });
  assert.throws(() => funil.setPipelineAccess(admin, { pipelineId: daA.id, userId: b.id, allowed: true }), /individual/);
  assert.throws(() => funil.setDefaultPipeline(admin, { userId: b.id, pipelineId: daA.id }), /liberados/);

  assert.throws(() => funil.setPipelineAccess(admin, { pipelineId: lic.id, userId: b.id, allowed: false }), /escolha outro funil/);
  const kept = opp(o.deB);
  funil.setPipelineAccess(admin, { pipelineId: lic.id, userId: b.id, allowed: false, targetPipelineId: vendas.id });
  assert.equal(opp(o.deB).pipeline_id, vendas.id);
  assert.equal(opp(o.deB).stage_id, rules.openStages(byName("Vendas"))[0].id, "negócio aberto vai para a primeira etapa do destino");
  assert.equal(opp(o.deB).owner_id, kept.owner_id);
  assert.deepEqual(funil.allowedPipelineIds(sql(), b.id), [vendas.id]);
  assert.throws(() => funil.setPipelineAccess(admin, { pipelineId: vendas.id, userId: b.id, allowed: false }), /ao menos um funil/);

  funil.setDefaultPipeline(admin, { userId: a.id, pipelineId: daA.id });
  const created = newOpp(a);
  assert.equal(created.pipelineId, daA.id, "negócio novo cai no funil padrão do dono");
  assert.equal(created.stageId, rules.openStages(byName("Funil da A"))[0].id);

  const licNow = byName("Licitações");
  funil.archivePipeline(admin, { id: licNow.id, revision: licNow.revision, targetPipelineId: vendas.id });
  assert.equal(byName("Licitações"), undefined);
  assert.ok(sql().prepare("SELECT archived_at FROM crm_pipelines WHERE id=?").get(licNow.id).archived_at);
  const daANow = byName("Funil da A");
  const moving = sql().prepare("SELECT id FROM crm_opportunities WHERE pipeline_id=?").all(daANow.id).map((r) => r.id);
  funil.archivePipeline(admin, { id: daANow.id, revision: daANow.revision, targetPipelineId: vendas.id });
  for (const id of moving) assert.equal(opp(id).pipeline_id, vendas.id);
  assert.equal(funil.defaultPipelineIdOf(sql(), a.id), vendas.id, "padrão corrigido para o destino");
  const last = byName("Vendas");
  assert.throws(() => funil.archivePipeline(admin, { id: last.id, revision: last.revision, targetPipelineId: last.id }), /último funil/);
});

test("negócios novos pelo WhatsApp/site e vendedor novo entram sozinhos no funil padrão", async () => {
  const vendas = byName("Vendas");
  const lead = crm.ingestCrmLead({
    provider: "evolution-contact", externalId: "qa:funil:5585997001111", name: "Cliente canal QA",
    phone: "85997001111", title: "Atendimento WhatsApp", origin: "WhatsApp", ownerId: b.id,
  });
  assert.equal(opp(lead.opportunity.id).pipeline_id, vendas.id);
  assert.equal(opp(lead.opportunity.id).stage_id, rules.openStages(vendas)[0].id);
  const c = await actor("c@funil.example", ["comercial"]);
  const boot = crm.getCrmBootstrap(c);
  assert.deepEqual(boot.pipelines.map((p) => p.id), [vendas.id]);
  assert.equal(boot.defaultPipelineId, vendas.id);
});

test("regras puras: categoria, obrigatórios, indicadores e valor conhecido", () => {
  const pl = {
    id: "p", name: "P", scope: "shared", isDefault: true, revision: 1,
    stages: [
      { id: "a", label: "A", color: "info", kind: "open", position: 0, probability: 10, wipLimit: 1, staleDays: 2, requiredFields: [] },
      { id: "b", label: "B", color: "info", kind: "open", position: 1, probability: 50, wipLimit: null, staleDays: null, requiredFields: ["notes"] },
      { id: "c", label: "C", color: "info", kind: "open", position: 2, probability: 80, wipLimit: null, staleDays: null, requiredFields: [] },
      { id: "w", label: "W", color: "success", kind: "won", position: 3, probability: 100, wipLimit: null, staleDays: null, requiredFields: [] },
      { id: "l", label: "L", color: "muted", kind: "lost", position: 4, probability: 0, wipLimit: null, staleDays: null, requiredFields: [] },
    ],
  };
  assert.deepEqual(["a", "b", "c", "w", "l"].map((id) => rules.legacyStageFor(pl, id)), ["novo", "conversando", "orcamento", "fechado", "perdido"]);
  assert.deepEqual(["novo", "conversando", "orcamento", "fechado", "perdido"].map((s) => rules.stageIdForLegacy(pl, s)), ["a", "b", "c", "w", "l"]);
  assert.deepEqual(rules.missingRequired({ valueCents: 0, nextActionLabel: "", notes: " " }, pl.stages[1]), ["notes"]);
  const now = Date.parse("2026-11-20T00:00:00Z");
  const m = rules.funnelMetrics(pl, [
    { stageId: "a", valueCents: 10000, stageEnteredAt: "2026-11-10T00:00:00Z", createdAt: "2026-11-10T00:00:00Z" },
    { stageId: "a", valueCents: null, createdAt: "2026-11-19T12:00:00Z" },
    { stageId: "c", valueCents: 20000, createdAt: "2026-11-19T00:00:00Z" },
    { stageId: "w", valueCents: 5000, createdAt: "2026-11-01T00:00:00Z" },
  ], now);
  assert.equal(m.open, 3);
  assert.equal(m.openCents, 30000);
  assert.equal(m.weightedCents, 1000 + 16000);
  assert.equal(m.stale, 1);
  assert.deepEqual(m.overLimit, ["a"]);
  assert.equal(m.won, 1);
  assert.deepEqual(rules.pipelineShapeErrors([{ kind: "open", label: "x" }, { kind: "won", label: "y" }]), ["O funil precisa de exatamente uma etapa de perda"]);
  assert.equal(rules.knownValueCents({ id: "o", estimatedValueCents: 700 }, [
    { opportunityId: "o", status: "Enviada", value: 12.5, date: "2026-11-01" },
    { opportunityId: "o", status: "Cancelada", value: 99, date: "2026-11-05" },
  ]), 1250);
  assert.equal(rules.knownValueCents({ id: "o", estimatedValueCents: 0 }, []), null);
});
