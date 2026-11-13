/**
 * Automações comerciais INTERNAS (etapa 3).
 *
 * Nada aqui fala com o cliente, muda etapa, marca venda ou toca o Omie. As únicas ações são:
 * - criar tarefa para o responsável (aparece no "Meu dia", no filtro Retornos e na oportunidade);
 * - checklist pós-venda (três tarefas);
 * - aviso para o gestor (registro na página de automações).
 *
 * Toda regra nasce DESLIGADA. O administrador passa para SIMULAÇÃO (registra o que aconteceria, sem criar nada) e só
 * depois para ATIVA. Um interruptor geral desliga tudo. Horário comercial de Fortaleza (seg–sex, 08–18) por regra.
 * Duplicidade: chave única por regra + oportunidade + janela (ou evento, na venda ganha), gravada no mesmo SAVEPOINT
 * da ação — exatamente uma vez, mesmo com duas execuções ao mesmo tempo. Falha numa oportunidade desfaz só aquela ação
 * e ela volta na próxima rodada. Limite de ações por regra em cada rodada contra avalanche.
 */
import { randomUUID } from "node:crypto";
import { audit, getDb } from "./local-db.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";
import { listUnitsPublic, validateUnitId } from "./units.server.ts";

export const TRIGGERS = ["cliente_sem_resposta", "retorno_vencido", "proposta_sem_contato", "negocio_parado", "venda_ganha"] as const;
export const ACTIONS = ["tarefa_responsavel", "aviso_gestor", "checklist_pos_venda"] as const;
export const MODES = ["desligada", "simulacao", "ativa"] as const;
export const DELAY_UNITS = ["minutos", "horas", "dias"] as const;
/** Documentação viva: estas ações NÃO existem aqui; o validador recusa qualquer ação fora de ACTIONS. */
export const ACOES_PROIBIDAS = ["enviar_whatsapp", "enviar_meta", "marcar_venda", "alterar_pedido_omie"] as const;
export type Trigger = (typeof TRIGGERS)[number];
export type Action = (typeof ACTIONS)[number];
export type Mode = (typeof MODES)[number];
export type DelayUnit = (typeof DELAY_UNITS)[number];

export const TRIGGER_LABEL: Record<Trigger, string> = {
  cliente_sem_resposta: "Cliente sem resposta",
  retorno_vencido: "Retorno vencido",
  proposta_sem_contato: "Proposta enviada sem contato",
  negocio_parado: "Negócio parado na etapa",
  venda_ganha: "Venda ganha",
};
export const ACTION_LABEL: Record<Action, string> = {
  tarefa_responsavel: "Criar tarefa para o responsável",
  aviso_gestor: "Aviso para o gestor",
  checklist_pos_venda: "Checklist pós-venda (3 tarefas)",
};
export const MAX_ACOES_POR_RODADA = 50;
const TASK_PREFIX = "Automação: ";
const POS_VENDA = [
  { label: "pós-venda — confirmar o pedido no Omie", dias: 0 },
  { label: "pós-venda — combinar entrega e montagem", dias: 2 },
  { label: "pós-venda — pedir a avaliação do cliente", dias: 7 },
];
const MS: Record<DelayUnit, number> = { minutos: 60_000, horas: 3_600_000, dias: 86_400_000 };
const ORIGINS = ["todas", "Anúncio Meta", "Anúncio Google", "Site", "Indicação", "WhatsApp", "Desconhecida"] as const;

export interface AutomationRule {
  id: string;
  name: string;
  trigger: Trigger;
  delayAmount: number;
  delayUnit: DelayUnit;
  origin: (typeof ORIGINS)[number];
  minValueCents: number;
  ownerScope: string;
  unitScope: string;
  action: Action;
  taskLabel: string;
  mode: Mode;
  businessHoursOnly: boolean;
  businessDaysOnly: boolean;
  dedupeHours: number;
  activeSince: string | null;
  revision: number;
  updatedAt: string;
}
type Row = Record<string, unknown>;
const admin = (actor: SiteUser | null) => requireActiveUser(actor, ["admin"]);
const nowIso = (now: number) => new Date(now).toISOString();

let savepoint = 0;
function atomic<T>(fn: () => T): T {
  const db = getDb();
  const name = `auto_${++savepoint}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}

const DEFAULTS: Omit<AutomationRule, "id" | "revision" | "updatedAt" | "activeSince" | "mode">[] = [
  { name: "Cliente sem resposta há 30 minutos", trigger: "cliente_sem_resposta", delayAmount: 30, delayUnit: "minutos", origin: "todas", minValueCents: 0, ownerScope: "todos", unitScope: "todas", action: "tarefa_responsavel", taskLabel: "responder o cliente", businessHoursOnly: true, businessDaysOnly: true, dedupeHours: 4 },
  { name: "Retorno vencido há 1 dia", trigger: "retorno_vencido", delayAmount: 1, delayUnit: "dias", origin: "todas", minValueCents: 0, ownerScope: "todos", unitScope: "todas", action: "aviso_gestor", taskLabel: "", businessHoursOnly: true, businessDaysOnly: true, dedupeHours: 24 },
  { name: "Proposta enviada sem contato há 2 dias", trigger: "proposta_sem_contato", delayAmount: 2, delayUnit: "dias", origin: "todas", minValueCents: 0, ownerScope: "todos", unitScope: "todas", action: "tarefa_responsavel", taskLabel: "cobrar o retorno da proposta", businessHoursOnly: true, businessDaysOnly: true, dedupeHours: 48 },
  { name: "Negócio parado há 7 dias", trigger: "negocio_parado", delayAmount: 7, delayUnit: "dias", origin: "todas", minValueCents: 0, ownerScope: "todos", unitScope: "todas", action: "aviso_gestor", taskLabel: "", businessHoursOnly: true, businessDaysOnly: true, dedupeHours: 72 },
  { name: "Venda ganha: checklist pós-venda", trigger: "venda_ganha", delayAmount: 0, delayUnit: "minutos", origin: "todas", minValueCents: 0, ownerScope: "todos", unitScope: "todas", action: "checklist_pos_venda", taskLabel: "", businessHoursOnly: false, businessDaysOnly: false, dedupeHours: 24 },
];

export function ensureAutomationSchema() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS crm_automation_settings(id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT, updated_by TEXT);
    CREATE TABLE IF NOT EXISTS crm_automation_rules(id TEXT PRIMARY KEY, name TEXT NOT NULL, trigger TEXT NOT NULL, delay_amount INTEGER NOT NULL,
      delay_unit TEXT NOT NULL, origin TEXT NOT NULL DEFAULT 'todas', min_value_cents INTEGER NOT NULL DEFAULT 0, owner_scope TEXT NOT NULL DEFAULT 'todos',
      unit_scope TEXT NOT NULL DEFAULT 'todas', action TEXT NOT NULL, task_label TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'desligada',
      business_hours_only INTEGER NOT NULL DEFAULT 1, business_days_only INTEGER NOT NULL DEFAULT 1, dedupe_hours INTEGER NOT NULL DEFAULT 24,
      active_since TEXT, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT);
    CREATE TABLE IF NOT EXISTS crm_automation_runs(id TEXT PRIMARY KEY, execution_id TEXT NOT NULL, rule_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
      owner_id TEXT, dedupe_key TEXT NOT NULL UNIQUE, mode TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL, reason TEXT NOT NULL,
      task_ids TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS crm_automation_runs_recent ON crm_automation_runs(created_at);
    CREATE TABLE IF NOT EXISTS crm_automation_executions(id TEXT PRIMARY KEY, origin TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
      evaluated INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL DEFAULT 0, simulated INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0,
      outside_hours INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, note TEXT);
    INSERT OR IGNORE INTO crm_automation_settings(id,enabled,revision) VALUES(1,0,1);`);
  if (!db.prepare("SELECT 1 FROM crm_automation_rules LIMIT 1").get()) {
    const at = new Date().toISOString();
    const insert = db.prepare(`INSERT INTO crm_automation_rules(id,name,trigger,delay_amount,delay_unit,origin,min_value_cents,owner_scope,unit_scope,action,task_label,mode,
      business_hours_only,business_days_only,dedupe_hours,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'desligada',?,?,?,?,?)`);
    for (const r of DEFAULTS)
      insert.run(randomUUID(), r.name, r.trigger, r.delayAmount, r.delayUnit, r.origin, r.minValueCents, r.ownerScope, r.unitScope, r.action, r.taskLabel,
        r.businessHoursOnly ? 1 : 0, r.businessDaysOnly ? 1 : 0, r.dedupeHours, at, at);
  }
  return db;
}

function ruleFrom(r: Row): AutomationRule {
  return {
    id: String(r["id"]), name: String(r["name"]), trigger: r["trigger"] as Trigger, delayAmount: Number(r["delay_amount"]), delayUnit: r["delay_unit"] as DelayUnit,
    origin: r["origin"] as AutomationRule["origin"], minValueCents: Number(r["min_value_cents"]), ownerScope: String(r["owner_scope"]), unitScope: String(r["unit_scope"]),
    action: r["action"] as Action, taskLabel: String(r["task_label"] ?? ""), mode: r["mode"] as Mode, businessHoursOnly: r["business_hours_only"] === 1,
    businessDaysOnly: r["business_days_only"] === 1, dedupeHours: Number(r["dedupe_hours"]), activeSince: r["active_since"] ? String(r["active_since"]) : null,
    revision: Number(r["revision"]), updatedAt: String(r["updated_at"]),
  };
}
const rules = () => (ensureAutomationSchema().prepare("SELECT * FROM crm_automation_rules ORDER BY created_at,name").all() as Row[]).map(ruleFrom);
const settings = () => ensureAutomationSchema().prepare("SELECT enabled,revision,updated_at FROM crm_automation_settings WHERE id=1").get() as Row;

/** Horário comercial de Fortaleza (UTC−3 fixo): seg–sex e 08h–18h, conforme a regra. */
export function dentroDoHorario(rule: Pick<AutomationRule, "businessHoursOnly" | "businessDaysOnly">, now: number) {
  const local = new Date(now - 3 * 3_600_000);
  const day = local.getUTCDay();
  const hour = local.getUTCHours();
  if (rule.businessDaysOnly && (day === 0 || day === 6)) return false;
  if (rule.businessHoursOnly && (hour < 8 || hour >= 18)) return false;
  return true;
}

export interface Candidate { opportunityId: string; ownerId: string; title: string; reason: string; eventAt: string | null }
const OPEN = "o.stage NOT IN ('fechado','perdido')";

/** Oportunidades que batem com a regra agora (sem escrever nada). */
export function candidatos(rule: AutomationRule, now: number, limit = 200): Candidate[] {
  const db = getDb();
  const cutoff = nowIso(now - rule.delayAmount * MS[rule.delayUnit]);
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (rule.ownerScope !== "todos") { where.push("o.owner_id=?"); params.push(rule.ownerScope); }
  if (rule.unitScope !== "todas") { where.push("o.unit_id=?"); params.push(rule.unitScope); }
  if (rule.origin !== "todas") { where.push("o.origin=?"); params.push(rule.origin); }
  const quotesTable = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_quote_links'").get());
  const value = quotesTable
    ? "max(o.estimated_value_cents, COALESCE((SELECT max(q.total_cents-q.general_discount_cents+q.freight_cents+q.assembly_cents) FROM crm_quote_links l JOIN internal_quotes q ON q.id=l.quote_id WHERE l.opportunity_id=o.id AND q.status<>'cancelado'),0))"
    : "o.estimated_value_cents";
  if (rule.minValueCents > 0) { where.push(`${value}>=?`); params.push(rule.minValueCents); }
  const stageEntered = "COALESCE((SELECT max(a.created_at) FROM crm_activities a WHERE a.opportunity_id=o.id AND a.kind='stage:changed'),o.created_at)";
  let extra = "";
  let condition: string;
  switch (rule.trigger) {
    case "cliente_sem_resposta":
      condition = `${OPEN} AND o.awaiting_reply=1 AND o.last_interaction<=?`;
      params.push(cutoff);
      break;
    case "retorno_vencido":
      condition = `${OPEN} AND EXISTS(SELECT 1 FROM crm_tasks t WHERE t.opportunity_id=o.id AND t.status='pending' AND t.due<=? AND t.label NOT LIKE '${TASK_PREFIX}%')`;
      params.push(cutoff);
      extra = `,(SELECT t.label||'|'||t.due FROM crm_tasks t WHERE t.opportunity_id=o.id AND t.status='pending' AND t.due<=? AND t.label NOT LIKE '${TASK_PREFIX}%' ORDER BY t.due LIMIT 1) AS info`;
      break;
    case "proposta_sem_contato":
      if (!quotesTable) return [];
      condition = `${OPEN} AND o.last_interaction<=? AND EXISTS(SELECT 1 FROM crm_quote_links l JOIN internal_quotes q ON q.id=l.quote_id WHERE l.opportunity_id=o.id AND q.status='enviado')`;
      params.push(cutoff);
      extra = ",(SELECT q.number FROM crm_quote_links l JOIN internal_quotes q ON q.id=l.quote_id WHERE l.opportunity_id=o.id AND q.status='enviado' LIMIT 1) AS info";
      break;
    case "negocio_parado":
      condition = `${OPEN} AND ${stageEntered}<=?`;
      params.push(cutoff);
      break;
    case "venda_ganha":
      // Só vendas ganhas depois que a regra foi ligada: ligar a regra nunca dispara o pós-venda de vendas antigas.
      condition = `o.stage='fechado' AND ${stageEntered}<=? AND ${stageEntered}>=?`;
      params.push(cutoff, rule.activeSince ?? nowIso(now));
      break;
  }
  const sql = `SELECT o.id,o.owner_id,o.title,o.stage,o.last_interaction,${stageEntered} AS stage_entered${extra}
    FROM crm_opportunities o WHERE ${[condition, ...where].join(" AND ")} ORDER BY o.last_interaction LIMIT ${Math.max(1, Math.min(500, limit))}`;
  // Parâmetros na ordem do texto: o "info" (só no retorno vencido) vem antes do WHERE.
  const ordered = rule.trigger === "retorno_vencido" ? [cutoff, ...params] : params;
  const rows = db.prepare(sql).all(...ordered) as Row[];
  return rows.map((r) => {
    const when = (iso: unknown) => new Date(String(iso)).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" });
    let reason: string;
    switch (rule.trigger) {
      case "cliente_sem_resposta": reason = `Cliente esperando resposta desde ${when(r["last_interaction"])}`; break;
      case "retorno_vencido": { const [label, due] = String(r["info"] ?? "|").split("|"); reason = `Retorno “${label}” venceu em ${when(due)}`; break; }
      case "proposta_sem_contato": reason = `Proposta ${String(r["info"] ?? "")} enviada e sem contato desde ${when(r["last_interaction"])}`; break;
      case "negocio_parado": reason = `Na mesma etapa desde ${when(r["stage_entered"])}`; break;
      case "venda_ganha": reason = `Venda ganha em ${when(r["stage_entered"])}`; break;
    }
    return { opportunityId: String(r["id"]), ownerId: String(r["owner_id"]), title: String(r["title"]), reason, eventAt: rule.trigger === "venda_ganha" ? String(r["stage_entered"]) : null };
  });
}

function dedupeKey(rule: AutomationRule, candidate: Candidate, now: number) {
  if (rule.trigger === "venda_ganha") return `${rule.id}:${candidate.opportunityId}:evt:${candidate.eventAt}`;
  return `${rule.id}:${candidate.opportunityId}:w${Math.floor(now / (Math.max(1, rule.dedupeHours) * 3_600_000))}`;
}

function createTask(opportunityId: string, label: string, due: number, now: number) {
  const id = randomUUID();
  const db = getDb();
  db.prepare("INSERT INTO crm_tasks(id,opportunity_id,label,due,created_at) VALUES(?,?,?,?,?)").run(id, opportunityId, `${TASK_PREFIX}${label}`.slice(0, 240), nowIso(due), nowIso(now));
  db.prepare("UPDATE crm_opportunities SET revision=revision+1,updated_at=? WHERE id=?").run(nowIso(now), opportunityId);
  db.prepare("INSERT INTO crm_activities(id,opportunity_id,actor_id,kind,label,created_at) VALUES(?,?,NULL,'automation:task',?,?)")
    .run(randomUUID(), opportunityId, `Tarefa criada pela automação: ${label}`.slice(0, 5000), nowIso(now));
  return id;
}

export interface ExecutionSummary { id: string | null; evaluated: number; created: number; simulated: number; duplicates: number; outsideHours: number; errors: number; note?: string }

/**
 * Uma rodada. Pela agenda só roda com o interruptor geral ligado; regras em SIMULAÇÃO registram o que aconteceria
 * (chave "sim:") e regras ATIVAS criam as tarefas/avisos. Nada nesta função chama a rede.
 */
export function executarAutomacoes(options: { now?: number; origem?: "agenda" | "manual" } = {}): ExecutionSummary {
  const now = options.now ?? Date.now();
  const db = ensureAutomationSchema();
  if (options.origem !== "manual" && Number(settings()["enabled"]) !== 1)
    return { id: null, evaluated: 0, created: 0, simulated: 0, duplicates: 0, outsideHours: 0, errors: 0, note: "interruptor geral desligado" };
  const summary: ExecutionSummary = { id: randomUUID(), evaluated: 0, created: 0, simulated: 0, duplicates: 0, outsideHours: 0, errors: 0 };
  db.prepare("INSERT INTO crm_automation_executions(id,origin,started_at) VALUES(?,?,?)").run(summary.id, options.origem ?? "agenda", nowIso(now));
  const errorNotes: string[] = [];
  for (const rule of rules().filter((r) => r.mode !== "desligada")) {
    if (!dentroDoHorario(rule, now)) { summary.outsideHours += 1; continue; }
    let acted = 0;
    for (const candidate of candidatos(rule, now)) {
      summary.evaluated += 1;
      if (acted >= MAX_ACOES_POR_RODADA) break;
      const key = `${rule.mode === "simulacao" ? "sim:" : ""}${dedupeKey(rule, candidate, now)}`;
      try {
        const outcome = atomic(() => {
          const inserted = db.prepare(`INSERT OR IGNORE INTO crm_automation_runs(id,execution_id,rule_id,opportunity_id,owner_id,dedupe_key,mode,action,outcome,reason,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), summary.id, rule.id, candidate.opportunityId, candidate.ownerId, key, rule.mode, rule.action, "pendente", candidate.reason, nowIso(now));
          if (!inserted.changes) return "duplicado" as const;
          let result: string;
          const taskIds: string[] = [];
          if (rule.mode === "simulacao") result = "simulado";
          else if (rule.action === "aviso_gestor") result = "aviso";
          else if (rule.action === "tarefa_responsavel") {
            const label = rule.taskLabel || TRIGGER_LABEL[rule.trigger].toLowerCase();
            const pending = db.prepare("SELECT 1 FROM crm_tasks WHERE opportunity_id=? AND status='pending' AND label=?").get(candidate.opportunityId, `${TASK_PREFIX}${label}`.slice(0, 240));
            if (pending) result = "ja_pendente";
            else { taskIds.push(createTask(candidate.opportunityId, label, now, now)); result = "criado"; }
          } else {
            for (const item of POS_VENDA) taskIds.push(createTask(candidate.opportunityId, item.label, now + item.dias * 86_400_000, now));
            result = "criado";
          }
          db.prepare("UPDATE crm_automation_runs SET outcome=?,task_ids=? WHERE dedupe_key=?").run(result, taskIds.length ? JSON.stringify(taskIds) : null, key);
          return result;
        });
        if (outcome === "duplicado") summary.duplicates += 1;
        else {
          acted += 1;
          if (outcome === "simulado") summary.simulated += 1;
          else if (outcome === "criado" || outcome === "aviso") summary.created += 1;
        }
      } catch (error) {
        summary.errors += 1;
        errorNotes.push(`${rule.name}: ${error instanceof Error ? error.message.slice(0, 120) : "erro"}`);
      }
    }
  }
  if (errorNotes.length) summary.note = errorNotes.slice(0, 5).join(" | ");
  db.prepare("UPDATE crm_automation_executions SET finished_at=?,evaluated=?,created=?,simulated=?,duplicates=?,outside_hours=?,errors=?,note=? WHERE id=?")
    .run(nowIso(Date.now()), summary.evaluated, summary.created, summary.simulated, summary.duplicates, summary.outsideHours, summary.errors, summary.note ?? null, summary.id);
  return summary;
}

// ---------- Administração (só administrador) ----------

export function lerAutomacoes(actor: SiteUser | null, now = Date.now()) {
  admin(actor);
  const db = ensureAutomationSchema();
  const s = settings();
  const names = new Map((db.prepare("SELECT id,COALESCE(NULLIF(display_name,''),email) name FROM users").all() as Row[]).map((u) => [String(u["id"]), String(u["name"])]));
  const units = listUnitsPublic().map((u) => ({ id: String(u.id), name: String(u.name) }));
  const owners = (db.prepare("SELECT id,COALESCE(NULLIF(display_name,''),email) name FROM users WHERE disabled=0 AND EXISTS(SELECT 1 FROM json_each(roles) WHERE value IN ('admin','comercial')) ORDER BY name").all() as Row[])
    .map((u) => ({ id: String(u["id"]), name: String(u["name"]) }));
  const runs = (db.prepare(`SELECT r.*,o.title FROM crm_automation_runs r LEFT JOIN crm_opportunities o ON o.id=r.opportunity_id
    WHERE r.created_at>=? ORDER BY r.created_at DESC LIMIT 200`).all(nowIso(now - 7 * 86_400_000)) as Row[]).map((r) => ({
    id: String(r["id"]), ruleId: String(r["rule_id"]), opportunityId: String(r["opportunity_id"]), title: String(r["title"] ?? "(oportunidade removida)"),
    ownerName: names.get(String(r["owner_id"])) ?? "—", mode: String(r["mode"]), action: r["action"] as Action, outcome: String(r["outcome"]), reason: String(r["reason"]), at: String(r["created_at"]),
  }));
  const executions = (db.prepare("SELECT * FROM crm_automation_executions ORDER BY started_at DESC LIMIT 15").all() as Row[]).map((e) => ({
    id: String(e["id"]), origin: String(e["origin"]), startedAt: String(e["started_at"]), finishedAt: e["finished_at"] ? String(e["finished_at"]) : null,
    evaluated: Number(e["evaluated"]), created: Number(e["created"]), simulated: Number(e["simulated"]), duplicates: Number(e["duplicates"]),
    outsideHours: Number(e["outside_hours"]), errors: Number(e["errors"]), note: e["note"] ? String(e["note"]) : null,
  }));
  return {
    enabled: Number(s["enabled"]) === 1,
    revision: Number(s["revision"]),
    rules: rules(),
    runs,
    executions,
    owners,
    units,
    labels: { triggers: TRIGGER_LABEL, actions: ACTION_LABEL },
  };
}

export function salvarInterruptor(actor: SiteUser | null, input: { enabled: boolean; revision: number }) {
  const user = admin(actor);
  const db = ensureAutomationSchema();
  const result = db.prepare("UPDATE crm_automation_settings SET enabled=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=1 AND revision=?")
    .run(input.enabled ? 1 : 0, new Date().toISOString(), user.id, input.revision);
  if (!result.changes) throw new Error("Conflito: as automações mudaram em outra tela. Atualize.");
  audit(user.id, input.enabled ? "crm:automation:on" : "crm:automation:off", null);
  return { enabled: input.enabled, revision: input.revision + 1 };
}

export interface RuleInput {
  id?: string | undefined;
  revision?: number | undefined;
  name: string;
  trigger: string;
  delayAmount: number;
  delayUnit: string;
  origin: string;
  minValueCents: number;
  ownerScope: string;
  unitScope: string;
  action: string;
  taskLabel: string;
  businessHoursOnly: boolean;
  businessDaysOnly: boolean;
  dedupeHours: number;
}
/** Validação no servidor: ações proibidas, números e alcance. */
export function validarRegra(input: RuleInput) {
  const errors: string[] = [];
  const name = input.name.trim();
  if (!name || name.length > 80) errors.push("Dê um nome de até 80 caracteres.");
  if (!TRIGGERS.includes(input.trigger as Trigger)) errors.push("Gatilho inválido.");
  if (!ACTIONS.includes(input.action as Action)) errors.push("Ação não permitida: as automações só criam tarefas e avisos internos.");
  if (!DELAY_UNITS.includes(input.delayUnit as DelayUnit)) errors.push("Unidade de tempo inválida.");
  if (!Number.isInteger(input.delayAmount) || input.delayAmount < 0 || input.delayAmount > 365) errors.push("Tempo entre 0 e 365.");
  if (input.trigger === "cliente_sem_resposta" && input.delayAmount < 1) errors.push("Para cliente sem resposta, use pelo menos 1.");
  if (!Number.isInteger(input.dedupeHours) || input.dedupeHours < 1 || input.dedupeHours > 720) errors.push("Intervalo entre avisos iguais de 1 a 720 horas.");
  if (!Number.isInteger(input.minValueCents) || input.minValueCents < 0) errors.push("Valor mínimo inválido.");
  if (!ORIGINS.includes(input.origin as (typeof ORIGINS)[number])) errors.push("Origem inválida.");
  if (input.taskLabel.length > 120) errors.push("Texto da tarefa até 120 caracteres.");
  if (input.trigger === "venda_ganha" && input.action === "tarefa_responsavel" && !input.taskLabel.trim()) errors.push("Informe o texto da tarefa.");
  const db = getDb();
  if (input.ownerScope !== "todos" && !db.prepare("SELECT 1 FROM users WHERE id=? AND disabled=0").get(input.ownerScope)) errors.push("Responsável não encontrado.");
  if (input.unitScope !== "todas") {
    try {
      validateUnitId(input.unitScope);
    } catch {
      errors.push("Unidade não encontrada.");
    }
  }
  return errors;
}

export function salvarRegra(actor: SiteUser | null, input: RuleInput) {
  const user = admin(actor);
  const db = ensureAutomationSchema();
  const errors = validarRegra(input);
  if (errors.length) throw new Error(errors.join(" "));
  const at = new Date().toISOString();
  const values = [input.name.trim(), input.trigger, input.delayAmount, input.delayUnit, input.origin, input.minValueCents, input.ownerScope, input.unitScope,
    input.action, input.taskLabel.trim(), input.businessHoursOnly ? 1 : 0, input.businessDaysOnly ? 1 : 0, input.dedupeHours];
  if (!input.id) {
    const id = randomUUID();
    db.prepare(`INSERT INTO crm_automation_rules(id,name,trigger,delay_amount,delay_unit,origin,min_value_cents,owner_scope,unit_scope,action,task_label,
      business_hours_only,business_days_only,dedupe_hours,mode,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'desligada',?,?,?)`)
      .run(id, ...values, at, at, user.id);
    audit(user.id, "crm:automation:rule:create", id);
    return ruleFrom(db.prepare("SELECT * FROM crm_automation_rules WHERE id=?").get(id) as Row);
  }
  const result = db.prepare(`UPDATE crm_automation_rules SET name=?,trigger=?,delay_amount=?,delay_unit=?,origin=?,min_value_cents=?,owner_scope=?,unit_scope=?,
    action=?,task_label=?,business_hours_only=?,business_days_only=?,dedupe_hours=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=?`)
    .run(...values, at, user.id, input.id, input.revision ?? -1);
  if (!result.changes) throw new Error("Conflito: a regra mudou em outra tela. Atualize.");
  audit(user.id, "crm:automation:rule:update", input.id);
  return ruleFrom(db.prepare("SELECT * FROM crm_automation_rules WHERE id=?").get(input.id) as Row);
}

export function mudarModo(actor: SiteUser | null, input: { id: string; revision: number; mode: string }) {
  const user = admin(actor);
  const db = ensureAutomationSchema();
  if (!MODES.includes(input.mode as Mode)) throw new Error("Modo inválido.");
  const current = db.prepare("SELECT * FROM crm_automation_rules WHERE id=?").get(input.id) as Row | undefined;
  if (!current) throw new Error("Regra não encontrada.");
  const at = new Date().toISOString();
  // "Ligada desde": ao sair de desligada. Venda ganha só considera vendas depois disso.
  const activeSince = input.mode === "desligada" ? null : current["mode"] === "desligada" ? at : (current["active_since"] as string | null) ?? at;
  const result = db.prepare("UPDATE crm_automation_rules SET mode=?,active_since=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=?")
    .run(input.mode, activeSince, at, user.id, input.id, input.revision);
  if (!result.changes) throw new Error("Conflito: a regra mudou em outra tela. Atualize.");
  audit(user.id, `crm:automation:rule:${input.mode}`, input.id);
  return ruleFrom(db.prepare("SELECT * FROM crm_automation_rules WHERE id=?").get(input.id) as Row);
}

/** "Simular agora": o que a regra faria neste momento, sem gravar nada (inclui regras desligadas). */
export function simularRegra(actor: SiteUser | null, ruleId: string, now = Date.now()) {
  admin(actor);
  const db = ensureAutomationSchema();
  const row = db.prepare("SELECT * FROM crm_automation_rules WHERE id=?").get(ruleId) as Row | undefined;
  if (!row) throw new Error("Regra não encontrada.");
  const rule = ruleFrom(row);
  const simulated = rule.trigger === "venda_ganha" && !rule.activeSince ? { ...rule, activeSince: nowIso(now - 30 * 86_400_000) } : rule;
  const names = new Map((db.prepare("SELECT id,COALESCE(NULLIF(display_name,''),email) name FROM users").all() as Row[]).map((u) => [String(u["id"]), String(u["name"])]));
  const list = candidatos(simulated, now, 100);
  return {
    dentroDoHorario: dentroDoHorario(rule, now),
    total: list.length,
    limitePorRodada: MAX_ACOES_POR_RODADA,
    itens: list.slice(0, 50).map((c) => ({
      ...c,
      ownerName: names.get(c.ownerId) ?? "—",
      jaFeito: Boolean(db.prepare("SELECT 1 FROM crm_automation_runs WHERE dedupe_key=?").get(dedupeKey(simulated, c, now))),
    })),
    observacao: rule.trigger === "venda_ganha" && !rule.activeSince ? "Regra desligada: a prévia considera vendas dos últimos 30 dias; ligada, só vale para vendas a partir de agora." : null,
  };
}

let worker: ReturnType<typeof setInterval> | undefined;
/** Rodada a cada 10 min (só com o interruptor geral ligado). Desligada nos testes (CRM_DISABLE_WORKER=1). */
export function startAutomationWorker() {
  if (worker || process.env["CRM_DISABLE_WORKER"] === "1" || process.env["CRM_AUTOMACOES_DESLIGADAS"] === "1") return;
  const tick = () => {
    try {
      executarAutomacoes({ origem: "agenda" });
    } catch (error) {
      console.error(`[automacoes] rodada falhou: ${error instanceof Error ? error.name : "erro"}`);
    }
  };
  worker = setInterval(tick, 10 * 60_000);
  worker.unref?.();
}
