// Automações comerciais internas (etapa 3): nascem desligadas, simulam antes de agir, agem uma vez por janela, respeitam
// o horário comercial e os filtros, recusam ações proibidas e nunca falam com o cliente, mudam etapa ou tocam o Omie.
// node --test tests/crm-automacoes.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "mag-automacoes-"));
process.env.SITE_DATA_DIR = dir;
process.env.CRM_DISABLE_WORKER = "1";
const networkCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  networkCalls.push(String(url));
  throw new Error("rede proibida no teste das automações");
};
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const crm = await import("../src/lib/crm.server.ts");
const units = await import("../src/lib/units.server.ts");
const auto = await import("../src/lib/crm-automacoes.server.ts");
test.after(async () => {
  globalThis.fetch = originalFetch;
  db.closeDb();
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

// Segunda-feira às 10:00 em Fortaleza (13:00 UTC), sempre no futuro: o teste não depende do dia em que roda.
const base = new Date(Date.now() + 2 * 86_400_000);
const monday = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 13, 0, 0));
while (monday.getUTCDay() !== 1) monday.setUTCDate(monday.getUTCDate() + 1);
const NOW = monday.getTime();
const H = 3_600_000;
const D = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

const actor = async (email, roles) => ({ id: (await auth.createUser(email, "Senha-Forte-123", roles)).id, email, roles, created_at: "" });
const admin = await actor("admin@auto.example", ["admin"]);
const a = await actor("a@auto.example", ["comercial"]);
const b = await actor("b@auto.example", ["comercial"]);
const dho = await actor("dho@auto.example", ["dho"]);
const unit = units.listUnitsPublic()[0];
const sql = (statement, ...params) => db.getDb().prepare(statement).run(...params);
const get = (statement, ...params) => db.getDb().prepare(statement).get(...params);
const all = (statement, ...params) => db.getDb().prepare(statement).all(...params);

function opportunity(owner, name, fields = {}) {
  const contact = crm.createContact(owner, { name, phone: `55859${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, email: "", city: "" });
  const op = crm.createOpportunity(owner, { contactId: contact.id, title: `Negócio ${name}`, origin: fields.origin ?? "WhatsApp", unitId: unit.id });
  sql("UPDATE crm_opportunities SET created_at=?,last_interaction=?,awaiting_reply=?,stage=? WHERE id=?",
    iso(fields.createdAt ?? NOW - D), iso(fields.lastInteraction ?? NOW - D), fields.awaiting ? 1 : 0, fields.stage ?? "conversando", op.id);
  return op;
}
const semResposta = opportunity(a, "Sem resposta", { awaiting: true, lastInteraction: NOW - 2 * H });
const comRetorno = opportunity(a, "Retorno vencido");
sql("INSERT INTO crm_tasks(id,opportunity_id,label,due,created_at) VALUES('t-retorno',?,?,?,?)", comRetorno.id, "Ligar para o cliente", iso(NOW - 2 * D), iso(NOW - 3 * D));
const comProposta = opportunity(b, "Proposta enviada", { lastInteraction: NOW - 3 * D });
const quote = crm.createQuoteForOpportunity(b, { opportunityId: comProposta.id }, []);
sql("UPDATE internal_quotes SET status='enviado',total_cents=150000 WHERE id=?", quote.id);
const parado = opportunity(b, "Parado");
sql("INSERT INTO crm_activities(id,opportunity_id,actor_id,kind,label,created_at) VALUES('a-parado',?,NULL,'stage:changed','Novo → Conversando',?)", parado.id, iso(NOW - 10 * D));
const ganha = opportunity(a, "Venda nova", { stage: "fechado" });
sql("INSERT INTO crm_activities(id,opportunity_id,actor_id,kind,label,created_at) VALUES('a-ganha',?,NULL,'stage:changed','Orçamento → Fechado',?)", ganha.id, iso(NOW - H));
const ganhaAntiga = opportunity(a, "Venda antiga", { stage: "fechado" });
sql("INSERT INTO crm_activities(id,opportunity_id,actor_id,kind,label,created_at) VALUES('a-antiga',?,NULL,'stage:changed','Orçamento → Fechado',?)", ganhaAntiga.id, iso(NOW - 400 * D));

const ruleOf = (trigger) => auto.lerAutomacoes(admin, NOW).rules.find((r) => r.trigger === trigger);
const setMode = (trigger, mode) => {
  const rule = ruleOf(trigger);
  return auto.mudarModo(admin, { id: rule.id, revision: rule.revision, mode });
};
const tasksOf = (opportunityId) => all("SELECT label,status,due FROM crm_tasks WHERE opportunity_id=? ORDER BY created_at,label", opportunityId);
const snapshot = () => ({
  messages: get("SELECT count(*) n FROM crm_messages").n,
  stages: all("SELECT id,stage FROM crm_opportunities ORDER BY id").map((r) => `${r.id}:${r.stage}`).join(","),
  quotes: all("SELECT id,status FROM internal_quotes ORDER BY id").map((r) => `${r.id}:${r.status}`).join(","),
});
const before = snapshot();

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

test("regras nascem desligadas; com o interruptor geral desligado nada roda; só administrador configura", async () => {
  const state = auto.lerAutomacoes(admin, NOW);
  assert.equal(state.enabled, false);
  assert.deepEqual(state.rules.map((r) => r.mode), ["desligada", "desligada", "desligada", "desligada", "desligada"]);
  assert.deepEqual(state.rules.map((r) => r.trigger).sort(), [...auto.TRIGGERS].sort());
  assert.equal(auto.executarAutomacoes({ now: NOW }).note, "interruptor geral desligado");
  setMode("cliente_sem_resposta", "ativa");
  assert.equal(auto.executarAutomacoes({ now: NOW }).note, "interruptor geral desligado", "regra ativa com o geral desligado também não roda");
  setMode("cliente_sem_resposta", "desligada");
  assert.equal(get("SELECT count(*) n FROM crm_automation_runs").n, 0);
  for (const user of [a, dho]) {
    await denied(() => auto.lerAutomacoes(user));
    await denied(() => auto.salvarInterruptor(user, { enabled: true, revision: 1 }));
    await denied(() => auto.simularRegra(user, state.rules[0].id));
  }
  auto.salvarInterruptor(admin, { enabled: true, revision: state.revision });
  await denied(() => auto.salvarInterruptor(admin, { enabled: false, revision: state.revision }), /Conflito/);
});

test("simulação registra o que aconteceria sem criar nada e não repete na mesma janela", () => {
  setMode("cliente_sem_resposta", "simulacao");
  const first = auto.executarAutomacoes({ now: NOW });
  assert.equal(first.simulated, 1);
  assert.equal(first.created, 0);
  assert.deepEqual(tasksOf(semResposta.id), [], "simulação não cria tarefa");
  const run = get("SELECT * FROM crm_automation_runs WHERE opportunity_id=?", semResposta.id);
  assert.equal(run.outcome, "simulado");
  assert.match(run.dedupe_key, /^sim:/);
  assert.match(run.reason, /Cliente esperando resposta desde/);
  const again = auto.executarAutomacoes({ now: NOW + 10 * 60_000 });
  assert.equal(again.simulated, 0);
  assert.equal(again.duplicates, 1);
  const preview = auto.simularRegra(admin, ruleOf("cliente_sem_resposta").id, NOW);
  assert.equal(preview.total, 1);
  assert.equal(preview.itens[0].opportunityId, semResposta.id);
});

test("ativa cria a tarefa uma vez por janela, não empilha pendente e volta a criar depois de concluída", () => {
  setMode("cliente_sem_resposta", "ativa");
  const first = auto.executarAutomacoes({ now: NOW });
  assert.equal(first.created, 1);
  assert.deepEqual(tasksOf(semResposta.id).map((t) => [t.label, t.status]), [["Automação: responder o cliente", "pending"]]);
  assert.ok(get("SELECT 1 FROM crm_activities WHERE opportunity_id=? AND kind='automation:task'", semResposta.id));
  assert.equal(auto.executarAutomacoes({ now: NOW + 10 * 60_000 }).duplicates, 1, "mesma janela");
  const nextWindow = auto.executarAutomacoes({ now: NOW + 4 * H });
  assert.equal(nextWindow.created, 0);
  assert.equal(get("SELECT outcome FROM crm_automation_runs WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 1", semResposta.id).outcome, "ja_pendente");
  assert.equal(tasksOf(semResposta.id).length, 1, "não empilha tarefa igual pendente");
  sql("UPDATE crm_tasks SET status='done',completed_at=? WHERE opportunity_id=?", iso(NOW + 5 * H), semResposta.id);
  assert.equal(auto.executarAutomacoes({ now: NOW + D }).created, 1, "concluída e o cliente segue sem resposta: nova tarefa no dia seguinte");
  assert.equal(tasksOf(semResposta.id).filter((t) => t.status === "pending").length, 1);
});

test("horário comercial: fim de semana e madrugada esperam; regra sem restrição (pós-venda) roda e só uma vez", () => {
  const saturday = NOW - 2 * D;
  const early = NOW - 4 * H;
  const sat = auto.executarAutomacoes({ now: saturday });
  assert.ok(sat.outsideHours >= 1);
  assert.equal(sat.created, 0);
  assert.ok(auto.executarAutomacoes({ now: early }).outsideHours >= 1);
  setMode("venda_ganha", "ativa");
  const posVenda = auto.executarAutomacoes({ now: saturday + 3 * D });
  assert.ok(posVenda.created >= 1);
  assert.deepEqual(tasksOf(ganha.id).map((t) => t.label), [
    "Automação: pós-venda — combinar entrega e montagem",
    "Automação: pós-venda — confirmar o pedido no Omie",
    "Automação: pós-venda — pedir a avaliação do cliente",
  ]);
  assert.deepEqual(tasksOf(ganhaAntiga.id), [], "venda ganha antes de ligar a regra não dispara");
  assert.equal(auto.executarAutomacoes({ now: saturday + 3 * D + 30 * 60_000 }).created, 0, "evento já tratado");
  assert.equal(tasksOf(ganha.id).length, 3);
});

test("cada gatilho pega só o caso certo e respeita responsável, origem e valor", () => {
  const preview = (trigger, at = NOW) => auto.simularRegra(admin, ruleOf(trigger).id, at).itens.map((i) => i.opportunityId);
  assert.deepEqual(preview("proposta_sem_contato"), [comProposta.id]);
  assert.deepEqual(preview("negocio_parado"), [parado.id]);
  const retornos = preview("retorno_vencido", NOW + 3 * D);
  assert.ok(retornos.includes(comRetorno.id));
  assert.ok(!retornos.includes(semResposta.id), "tarefa criada pela automação não conta como retorno vencido");
  setMode("retorno_vencido", "ativa");
  auto.executarAutomacoes({ now: NOW + 3 * D });
  const aviso = get("SELECT outcome,action FROM crm_automation_runs WHERE opportunity_id=? AND action='aviso_gestor'", comRetorno.id);
  assert.deepEqual([aviso.outcome, aviso.action], ["aviso", "aviso_gestor"]);
  assert.deepEqual(tasksOf(comRetorno.id).map((t) => t.label), ["Ligar para o cliente"], "aviso ao gestor não cria tarefa");
  const rule = ruleOf("proposta_sem_contato");
  const edit = (patch) => auto.salvarRegra(admin, { ...rule, ...patch, revision: ruleOf("proposta_sem_contato").revision });
  edit({ ownerScope: a.id });
  assert.deepEqual(preview("proposta_sem_contato"), [], "só a carteira escolhida");
  edit({ ownerScope: "todos", minValueCents: 1_000_000 });
  assert.deepEqual(preview("proposta_sem_contato"), [], "valor da proposta (R$ 1.500) abaixo do mínimo");
  edit({ minValueCents: 100_000, origin: "Anúncio Meta" });
  assert.deepEqual(preview("proposta_sem_contato"), [], "origem diferente");
  edit({ origin: "todas" });
  assert.deepEqual(preview("proposta_sem_contato"), [comProposta.id]);
});

test("ação proibida e valores inválidos são recusados no servidor", async () => {
  const rule = ruleOf("negocio_parado");
  const input = { ...rule, revision: rule.revision };
  for (const [patch, pattern] of [
    [{ action: "enviar_whatsapp" }, /Ação não permitida/],
    [{ action: "marcar_venda" }, /Ação não permitida/],
    [{ action: "alterar_pedido_omie" }, /Ação não permitida/],
    [{ name: "" }, /nome/],
    [{ dedupeHours: 0 }, /1 a 720/],
    [{ delayAmount: -1 }, /0 e 365/],
    [{ trigger: "cliente_sem_resposta", delayAmount: 0 }, /pelo menos 1/],
    [{ ownerScope: "00000000-0000-4000-8000-000000000000" }, /Responsável não encontrado/],
    [{ unitScope: "00000000-0000-4000-8000-000000000000" }, /Unidade não encontrada/],
  ])
    await denied(() => auto.salvarRegra(admin, { ...input, ...patch }), pattern);
  await denied(() => auto.salvarRegra(a, input));
  await denied(() => auto.mudarModo(b, { id: rule.id, revision: rule.revision, mode: "ativa" }));
  assert.ok(auto.ACOES_PROIBIDAS.every((acao) => !auto.ACTIONS.includes(acao)));
});

test("falha numa ação desfaz só aquela ação e ela volta na próxima rodada", () => {
  const nova = opportunity(a, "Falha simulada", { awaiting: true, lastInteraction: NOW + 2 * D - 2 * H });
  sql("CREATE TRIGGER falha_tarefa BEFORE INSERT ON crm_tasks BEGIN SELECT RAISE(ABORT,'falha simulada'); END");
  const failed = auto.executarAutomacoes({ now: NOW + 2 * D });
  assert.ok(failed.errors >= 1);
  assert.match(get("SELECT note FROM crm_automation_executions WHERE id=?", failed.id).note, /falha simulada/);
  assert.equal(get("SELECT count(*) n FROM crm_automation_runs WHERE opportunity_id=?", nova.id).n, 0, "nada ficou gravado pela metade");
  sql("DROP TRIGGER falha_tarefa");
  const retry = auto.executarAutomacoes({ now: NOW + 2 * D + 10 * 60_000 });
  assert.ok(retry.created >= 1);
  assert.equal(tasksOf(nova.id).length, 1);
});

test("nenhuma automação fala com o cliente, muda etapa ou mexe em negociação/Omie", () => {
  const after = snapshot();
  assert.equal(after.messages, before.messages, "nenhuma mensagem criada");
  assert.equal(after.quotes, before.quotes, "nenhuma negociação alterada");
  const stagesBefore = before.stages.split(",").filter(Boolean);
  assert.ok(stagesBefore.every((entry) => after.stages.includes(entry)), "nenhuma etapa mudou");
  assert.deepEqual(networkCalls, [], "nenhuma chamada de rede");
});
