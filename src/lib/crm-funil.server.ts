/**
 * Funis do CRM (Etapa 4): esquema aditivo, migração idempotente, acessos por vendedor e estrutura (só administrador).
 *
 * - `crm_opportunities.stage` continua sendo a categoria (novo|conversando|orcamento|fechado|perdido). A versão anterior
 *   do sistema só lê e grava essa coluna; ao voltar para esta versão, `migrateFunis` realinha a etapa pela categoria.
 * - Nada aqui apaga negócio, proposta, conversa ou vínculo. Etapa ou funil "excluído" é ARQUIVADO depois que os
 *   negócios foram para o destino escolhido; cada movimento vira atividade na linha do tempo.
 * - A carteira continua individual: acesso a um funil permite usar as etapas dele, nunca ver negócio de outra pessoa.
 */
import { randomUUID } from "node:crypto";
import { getDb, audit } from "./local-db.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";
import {
  MAX_PIPELINES,
  NEW_PIPELINE_STAGES,
  SCOPES,
  VENDAS_STAGES,
  cleanLabel,
  legacyStageFor,
  lostStage,
  normalizeStage,
  openStages,
  pipelineShapeErrors,
  sortStages,
  stageIdForLegacy,
  stageOf,
  wonStage,
  type Pipeline,
  type PipelineScope,
  type PipelineSeller,
  type PipelineStage,
  type RequiredField,
  type StageColor,
  type StageKind,
  type StageTemplate,
} from "./crm-pipelines.ts";
import type { Stage } from "./crm.ts";

type Row = Record<string, any>;
type Db = ReturnType<typeof getDb>;
const schemaReady = new WeakSet<object>();
const migrated = new WeakSet<object>();
const now = () => new Date().toISOString();
const str = (value: unknown) => String(value ?? "");
const isAdmin = (actor: SiteUser) => actor.roles.includes("admin");
let savepoint = 0;
function atomic<T>(fn: () => T): T {
  const db = getDb();
  const name = `funil_${++savepoint}`;
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
function activity(db: Db, opportunityId: string, actorId: string | null, label: string) {
  db.prepare("INSERT INTO crm_activities(id,opportunity_id,actor_id,kind,label,created_at) VALUES(?,?,?,?,?,?)").run(
    randomUUID(),
    opportunityId,
    actorId,
    "stage:changed",
    label.slice(0, 5000),
    now(),
  );
}

/** Tabelas e colunas novas (só acréscimos). Chamado por ensureCrmSchema depois de criar crm_opportunities. */
export function ensureFunilSchema(db: Db = getDb()): Db {
  if (!schemaReady.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS crm_pipelines (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'shared' CHECK(scope IN ('shared','specialized','personal')),
        is_default INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, archived_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT
      );
      CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
        id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL REFERENCES crm_pipelines(id), label TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'muted', kind TEXT NOT NULL CHECK(kind IN ('open','won','lost')),
        position INTEGER NOT NULL, probability INTEGER NOT NULL DEFAULT 0 CHECK(probability BETWEEN 0 AND 100),
        wip_limit INTEGER, stale_days INTEGER, required_fields TEXT NOT NULL DEFAULT '[]', archived_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS crm_pipeline_stages_pipeline ON crm_pipeline_stages(pipeline_id, position);
      CREATE TABLE IF NOT EXISTS crm_pipeline_access (
        pipeline_id TEXT NOT NULL REFERENCES crm_pipelines(id), user_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL, created_by TEXT, PRIMARY KEY(pipeline_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS crm_pipeline_access_user ON crm_pipeline_access(user_id);
      CREATE TABLE IF NOT EXISTS crm_pipeline_defaults (
        user_id TEXT PRIMARY KEY REFERENCES users(id), pipeline_id TEXT NOT NULL REFERENCES crm_pipelines(id),
        updated_at TEXT NOT NULL
      );
    `);
    const columns = new Set(
      (db.prepare("PRAGMA table_info(crm_opportunities)").all() as Row[]).map((column) => str(column["name"])),
    );
    for (const [name, type] of [
      ["pipeline_id", "TEXT"],
      ["stage_id", "TEXT"],
      ["stage_entered_at", "TEXT"],
      ["position", "REAL"],
    ] as const)
      if (!columns.has(name)) db.exec(`ALTER TABLE crm_opportunities ADD COLUMN ${name} ${type}`);
    db.exec("CREATE INDEX IF NOT EXISTS crm_opportunities_pipeline ON crm_opportunities(pipeline_id, stage_id, position)");
    schemaReady.add(db);
  }
  if (!migrated.has(db)) {
    migrateFunis(db);
    migrated.add(db);
  }
  return db;
}

// ---------- Leitura ----------
function stageFromRow(row: Row): PipelineStage {
  let required: RequiredField[] = [];
  try {
    required = JSON.parse(str(row["required_fields"]) || "[]");
  } catch {
    required = [];
  }
  return {
    id: str(row["id"]),
    label: str(row["label"]),
    color: str(row["color"]) as StageColor,
    kind: str(row["kind"]) as StageKind,
    position: Number(row["position"]),
    probability: Number(row["probability"]),
    wipLimit: row["wip_limit"] == null ? null : Number(row["wip_limit"]),
    staleDays: row["stale_days"] == null ? null : Number(row["stale_days"]),
    requiredFields: Array.isArray(required) ? required : [],
  };
}
/** Funis ativos (não arquivados), com as etapas ativas na ordem de exibição. */
export function loadPipelines(db: Db = getDb()): Pipeline[] {
  const stages = new Map<string, PipelineStage[]>();
  for (const row of db
    .prepare("SELECT * FROM crm_pipeline_stages WHERE archived_at IS NULL ORDER BY pipeline_id, position, id")
    .all() as Row[]) {
    const list = stages.get(str(row["pipeline_id"])) ?? [];
    list.push(stageFromRow(row));
    stages.set(str(row["pipeline_id"]), list);
  }
  return (
    db
      .prepare("SELECT * FROM crm_pipelines WHERE archived_at IS NULL ORDER BY is_default DESC, position, created_at, id")
      .all() as Row[]
  ).map((row) => ({
    id: str(row["id"]),
    name: str(row["name"]),
    scope: str(row["scope"]) as PipelineScope,
    isDefault: Boolean(row["is_default"]),
    revision: Number(row["revision"]),
    stages: sortStages(stages.get(str(row["id"])) ?? []),
  }));
}
function systemDefault(pipelines: Pipeline[]): Pipeline {
  const found = pipelines.find((pipeline) => pipeline.isDefault) ?? pipelines[0];
  if (!found) throw new Error("Nenhum funil ativo");
  return found;
}
function userRow(db: Db, userId: string) {
  return db.prepare("SELECT id,email,display_name,roles,disabled FROM users WHERE id=?").get(userId) as Row | undefined;
}
const rolesOf = (row: Row | undefined): string[] => {
  try {
    return row ? (JSON.parse(str(row["roles"])) as string[]) : [];
  } catch {
    return [];
  }
};
const isSellerRow = (row: Row | undefined) => {
  const roles = rolesOf(row);
  return roles.includes("comercial") && !roles.includes("admin");
};
/** Funis liberados para o usuário (ids de funis ativos). Administrador: todos. */
export function allowedPipelineIds(db: Db, userId: string, pipelines: Pipeline[] = loadPipelines(db)): string[] {
  const user = userRow(db, userId);
  if (rolesOf(user).includes("admin")) return pipelines.map((pipeline) => pipeline.id);
  const allowed = new Set(
    (db.prepare("SELECT pipeline_id FROM crm_pipeline_access WHERE user_id=?").all(userId) as Row[]).map((row) =>
      str(row["pipeline_id"]),
    ),
  );
  return pipelines.filter((pipeline) => allowed.has(pipeline.id)).map((pipeline) => pipeline.id);
}
/** Funil padrão: o escolhido, se ainda liberado; senão o padrão do sistema, se liberado; senão o primeiro liberado. */
export function defaultPipelineIdOf(db: Db, userId: string, pipelines: Pipeline[] = loadPipelines(db)): string | null {
  const allowed = allowedPipelineIds(db, userId, pipelines);
  if (!allowed.length) return null;
  const chosen = str(db.prepare("SELECT pipeline_id FROM crm_pipeline_defaults WHERE user_id=?").get(userId)?.["pipeline_id"]);
  if (allowed.includes(chosen)) return chosen;
  const fallback = systemDefault(pipelines).id;
  return allowed.includes(fallback) ? fallback : allowed[0]!;
}
export function visiblePipelinesFor(actor: SiteUser): { pipelines: Pipeline[]; defaultPipelineId: string | null } {
  const db = ensureFunilSchema();
  const pipelines = loadPipelines(db);
  if (!isAdmin(actor)) ensureSellerAccess(db, actor.id, pipelines);
  const allowed = new Set(allowedPipelineIds(db, actor.id, pipelines));
  return {
    pipelines: pipelines.filter((pipeline) => allowed.has(pipeline.id)),
    defaultPipelineId: defaultPipelineIdOf(db, actor.id, pipelines),
  };
}
/** Pode o DONO do negócio usar o funil? (vendedor: precisa de acesso; administrador: sempre). */
export function ownerCanUsePipeline(db: Db, ownerId: string, pipelineId: string, pipelines: Pipeline[] = loadPipelines(db)) {
  return allowedPipelineIds(db, ownerId, pipelines).includes(pipelineId);
}

// ---------- Escrita usada pelo CRM ----------
/** Todo vendedor ativo tem ao menos um funil: sem nenhum, recebe o funil padrão do sistema. */
export function ensureSellerAccess(db: Db, userId: string, pipelines: Pipeline[] = loadPipelines(db)) {
  const user = userRow(db, userId);
  if (!user || Number(user["disabled"]) || !isSellerRow(user) || !pipelines.length) return;
  if (!allowedPipelineIds(db, userId, pipelines).length)
    db.prepare("INSERT OR IGNORE INTO crm_pipeline_access(pipeline_id,user_id,created_at,created_by) VALUES(?,?,?,NULL)").run(
      systemDefault(pipelines).id,
      userId,
      now(),
    );
  const chosen = str(db.prepare("SELECT pipeline_id FROM crm_pipeline_defaults WHERE user_id=?").get(userId)?.["pipeline_id"]);
  const allowed = allowedPipelineIds(db, userId, pipelines);
  if (!allowed.includes(chosen)) {
    const fallback = allowed.includes(systemDefault(pipelines).id) ? systemDefault(pipelines).id : allowed[0];
    if (fallback)
      db.prepare(
        "INSERT INTO crm_pipeline_defaults(user_id,pipeline_id,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET pipeline_id=excluded.pipeline_id,updated_at=excluded.updated_at",
      ).run(userId, fallback, now());
  }
}
function pipelineForOwner(db: Db, ownerId: string, pipelines: Pipeline[]): Pipeline {
  ensureSellerAccess(db, ownerId, pipelines);
  const id = defaultPipelineIdOf(db, ownerId, pipelines);
  return pipelines.find((pipeline) => pipeline.id === id) ?? systemDefault(pipelines);
}
function topPosition(db: Db, pipelineId: string, stageId: string) {
  const min = db
    .prepare("SELECT min(position) p FROM crm_opportunities WHERE pipeline_id=? AND stage_id=?")
    .get(pipelineId, stageId)?.["p"];
  return min == null ? 0 : Number(min) - 1;
}
/** Negócio recém-criado: funil padrão do dono, primeira etapa em andamento, no topo da coluna. */
export function placeNewOpportunity(db: Db, opportunityId: string, ownerId: string) {
  ensureFunilSchema(db);
  const pipelines = loadPipelines(db);
  const pipeline = pipelineForOwner(db, ownerId, pipelines);
  const first = openStages(pipeline)[0]!;
  const row = db.prepare("SELECT created_at FROM crm_opportunities WHERE id=?").get(opportunityId) as Row | undefined;
  db.prepare("UPDATE crm_opportunities SET pipeline_id=?,stage_id=?,stage=?,stage_entered_at=?,position=? WHERE id=?").run(
    pipeline.id,
    first.id,
    legacyStageFor(pipeline, first.id),
    str(row?.["created_at"]) || now(),
    topPosition(db, pipeline.id, first.id),
    opportunityId,
  );
}
export interface MoveTarget {
  pipeline: Pipeline;
  stage: PipelineStage;
  legacy: Stage;
  fromPipeline: Pipeline | undefined;
  fromStage: PipelineStage | undefined;
  position: number;
}
/**
 * Destino validado de um movimento. Quem chama já conferiu que o ator pode agir no negócio (dono ou administrador).
 * O funil de destino precisa estar liberado para o DONO, para o negócio nunca sumir da carteira dele.
 */
export function resolveMoveTarget(
  db: Db,
  opportunity: { id: string; ownerId: string; pipelineId?: string | null | undefined; stageId?: string | null | undefined },
  target: { pipelineId?: string | undefined; stageId?: string | undefined; legacy?: Stage | undefined },
): MoveTarget {
  ensureFunilSchema(db);
  const pipelines = loadPipelines(db);
  const fromPipeline = pipelines.find((pipeline) => pipeline.id === opportunity.pipelineId);
  const pipelineId = target.pipelineId || opportunity.pipelineId || pipelineForOwner(db, opportunity.ownerId, pipelines).id;
  const pipeline = pipelines.find((item) => item.id === pipelineId);
  if (!pipeline) throw new Error("Funil indisponível");
  if (!ownerCanUsePipeline(db, opportunity.ownerId, pipeline.id, pipelines))
    throw new Error("Forbidden: o responsável pelo negócio não tem acesso a este funil");
  let stageId = target.stageId;
  if (!stageId && target.legacy) {
    const current = pipeline.id === fromPipeline?.id ? stageOf(pipeline, opportunity.stageId) : undefined;
    stageId = current && legacyStageFor(pipeline, current.id) === target.legacy ? current.id : stageIdForLegacy(pipeline, target.legacy);
  }
  const stage = stageOf(pipeline, stageId);
  if (!stage) throw new Error("Etapa inválida para este funil");
  return {
    pipeline,
    stage,
    legacy: legacyStageFor(pipeline, stage.id),
    fromPipeline,
    fromStage: stageOf(fromPipeline, opportunity.stageId),
    position: topPosition(db, pipeline.id, stage.id),
  };
}
/** Valor conhecido no servidor: proposta vinculada válida mais recente; senão o valor estimado. */
export function opportunityValueCents(db: Db, opportunityId: string): number | null {
  const row = db
    .prepare(
      `SELECT (SELECT COALESCE(json_extract(p.snapshot,'$.totais.totalCentavos'), q.total_cents)
         FROM crm_quote_links l JOIN internal_quotes q ON q.id=l.quote_id
         LEFT JOIN quote_proposals p ON p.quote_id=q.id AND p.current=1 AND p.deleted_at IS NULL
         WHERE l.opportunity_id=o.id AND q.status<>'cancelado' AND p.refused_at IS NULL
         ORDER BY q.updated_at DESC LIMIT 1) quote_cents, o.estimated_value_cents
       FROM crm_opportunities o WHERE o.id=?`,
    )
    .get(opportunityId) as Row | undefined;
  if (!row) return null;
  if (row["quote_cents"] != null && Number(row["quote_cents"]) > 0) return Number(row["quote_cents"]);
  return Number(row["estimated_value_cents"]) > 0 ? Number(row["estimated_value_cents"]) : null;
}

// ---------- Migração ----------
function insertPipeline(
  db: Db,
  name: string,
  scope: PipelineScope,
  stages: StageTemplate[],
  options: { isDefault?: boolean; actorId?: string | null; position?: number } = {},
) {
  const id = randomUUID();
  const at = now();
  db.prepare(
    "INSERT INTO crm_pipelines(id,name,scope,is_default,position,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?)",
  ).run(id, name, scope, options.isDefault ? 1 : 0, options.position ?? 0, at, at, options.actorId ?? null);
  stages.forEach((stage, index) =>
    db
      .prepare(
        "INSERT INTO crm_pipeline_stages(id,pipeline_id,label,color,kind,position,probability,wip_limit,stale_days,required_fields,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        id,
        stage.label,
        stage.color,
        stage.kind,
        index,
        stage.probability,
        stage.wipLimit,
        stage.staleDays,
        JSON.stringify(stage.requiredFields),
        at,
        at,
      ),
  );
  return id;
}
/**
 * Idempotente. 1) cria o funil "Vendas" (compartilhado, padrão) se não houver funis; 2) garante um funil para cada
 * vendedor ativo; 3) coloca no funil os negócios que ainda não têm funil (os de antes e os criados pela versão
 * anterior); 4) realinha a etapa quando a categoria gravada pela versão anterior não bate mais.
 */
export function migrateFunis(db: Db = getDb()) {
  atomic(() => {
    if (!db.prepare("SELECT 1 FROM crm_pipelines WHERE archived_at IS NULL LIMIT 1").get())
      insertPipeline(db, "Vendas", "shared", VENDAS_STAGES, { isDefault: true });
    const defaults = db.prepare("SELECT id FROM crm_pipelines WHERE archived_at IS NULL AND is_default=1").all() as Row[];
    if (defaults.length !== 1) {
      const first = loadPipelines(db)[0]!;
      db.prepare("UPDATE crm_pipelines SET is_default=CASE WHEN id=? THEN 1 ELSE 0 END WHERE archived_at IS NULL").run(first.id);
    }
    const pipelines = loadPipelines(db);
    for (const row of db.prepare("SELECT id FROM users WHERE disabled=0").all() as Row[])
      ensureSellerAccess(db, str(row["id"]), pipelines);
    const byId = new Map(pipelines.map((pipeline) => [pipeline.id, pipeline]));
    const lastChange = db.prepare(
      "SELECT max(created_at) at FROM crm_activities WHERE opportunity_id=? AND kind='stage:changed'",
    );
    const update = db.prepare(
      "UPDATE crm_opportunities SET pipeline_id=?,stage_id=?,stage=?,stage_entered_at=?,position=? WHERE id=?",
    );
    const rows = db
      .prepare(
        "SELECT id,owner_id,stage,pipeline_id,stage_id,stage_entered_at,position,created_at FROM crm_opportunities ORDER BY updated_at DESC, id",
      )
      .all() as Row[];
    rows.forEach((row, index) => {
      let pipeline = byId.get(str(row["pipeline_id"]));
      let stageId = str(row["stage_id"]);
      let entered = str(row["stage_entered_at"]);
      const legacy = str(row["stage"]) as Stage;
      if (!pipeline) {
        pipeline = pipelineForOwner(db, str(row["owner_id"]), pipelines);
        stageId = "";
      }
      const current = stageOf(pipeline, stageId);
      if (!current || legacyStageFor(pipeline, current.id) !== legacy) {
        stageId = stageIdForLegacy(pipeline, legacy);
        entered = str(lastChange.get(row["id"])?.["at"]) || str(row["created_at"]);
      }
      const position = row["position"] == null ? index : Number(row["position"]);
      const finalLegacy = legacyStageFor(pipeline, stageId);
      if (
        pipeline.id !== str(row["pipeline_id"]) ||
        stageId !== str(row["stage_id"]) ||
        finalLegacy !== legacy ||
        !row["stage_entered_at"] ||
        row["position"] == null
      )
        update.run(pipeline.id, stageId, finalLegacy, entered || str(row["created_at"]), position, row["id"]);
    });
  });
}

// ---------- Administração (estrutura e acessos) ----------
function requireAdmin(actor: SiteUser) {
  return requireActiveUser(actor, ["admin"]);
}
function requirePipeline(db: Db, id: string, revision?: number): Pipeline {
  const pipeline = loadPipelines(db).find((item) => item.id === id);
  if (!pipeline) throw new Error("Funil não encontrado");
  if (revision !== undefined && pipeline.revision !== revision)
    throw new Error("Conflito: o funil mudou. Atualize antes de salvar");
  return pipeline;
}
function bumpPipeline(db: Db, id: string, actorId: string) {
  db.prepare("UPDATE crm_pipelines SET revision=revision+1,updated_at=?,updated_by=? WHERE id=?").run(now(), actorId, id);
}
/** Recalcula a categoria (coluna antiga) dos negócios do funil depois de mudar ordem ou etapas. */
function syncLegacy(db: Db, pipeline: Pipeline) {
  const rows = db.prepare("SELECT id,stage,stage_id FROM crm_opportunities WHERE pipeline_id=?").all(pipeline.id) as Row[];
  for (const row of rows) {
    const legacy = legacyStageFor(pipeline, str(row["stage_id"]));
    if (legacy !== row["stage"])
      db.prepare("UPDATE crm_opportunities SET stage=?,revision=revision+1,updated_at=? WHERE id=?").run(legacy, now(), row["id"]);
  }
}
/** Move negócios entre funis mantendo o tipo da etapa (andamento → primeira etapa; ganho → ganho; perda → perda). */
function transferDeals(db: Db, rows: Row[], from: Pipeline, to: Pipeline, actorId: string, reason: string) {
  for (const row of rows) {
    const kind = stageOf(from, str(row["stage_id"]))?.kind ?? "open";
    const target = kind === "won" ? wonStage(to)! : kind === "lost" ? lostStage(to)! : openStages(to)[0]!;
    db.prepare(
      "UPDATE crm_opportunities SET pipeline_id=?,stage_id=?,stage=?,stage_entered_at=?,position=?,loss_reason=CASE WHEN ?='lost' THEN loss_reason ELSE NULL END,revision=revision+1,updated_at=? WHERE id=?",
    ).run(
      to.id,
      target.id,
      legacyStageFor(to, target.id),
      now(),
      topPosition(db, to.id, target.id),
      target.kind,
      now(),
      row["id"],
    );
    activity(
      db,
      str(row["id"]),
      actorId,
      `${from.name} · ${stageOf(from, str(row["stage_id"]))?.label ?? "—"} → ${to.name} · ${target.label} (${reason})`,
    );
  }
}

export interface FunilAdmin {
  pipelines: (Pipeline & { counts: Record<string, number>; sellers: string[] })[];
  sellers: PipelineSeller[];
}
/** Visão do administrador: funis com contagem por etapa, vendedores com seus acessos e negócios por funil. */
export function listFunilAdmin(actor: SiteUser): FunilAdmin {
  requireAdmin(actor);
  const db = ensureFunilSchema();
  const pipelines = loadPipelines(db);
  const counts = new Map<string, Record<string, number>>();
  for (const row of db
    .prepare("SELECT pipeline_id,stage_id,count(*) n FROM crm_opportunities GROUP BY pipeline_id,stage_id")
    .all() as Row[]) {
    const map = counts.get(str(row["pipeline_id"])) ?? {};
    map[str(row["stage_id"])] = Number(row["n"]);
    counts.set(str(row["pipeline_id"]), map);
  }
  const sellerRows = (
    db
      .prepare(
        `SELECT id,COALESCE(NULLIF(display_name,''),email) name,disabled,roles FROM users
         WHERE EXISTS(SELECT 1 FROM json_each(users.roles) WHERE value='comercial')
           AND (disabled=0 OR EXISTS(SELECT 1 FROM crm_opportunities o WHERE o.owner_id=users.id)) ORDER BY name`,
      )
      .all() as Row[]
  ).filter((row) => !rolesOf(row).includes("admin"));
  const deals = new Map<string, Record<string, number>>();
  for (const row of db
    .prepare("SELECT owner_id,pipeline_id,count(*) n FROM crm_opportunities GROUP BY owner_id,pipeline_id")
    .all() as Row[]) {
    const map = deals.get(str(row["owner_id"])) ?? {};
    map[str(row["pipeline_id"])] = Number(row["n"]);
    deals.set(str(row["owner_id"]), map);
  }
  const sellers: PipelineSeller[] = sellerRows.map((row) => ({
    userId: str(row["id"]),
    name: str(row["name"]),
    active: !Number(row["disabled"]),
    pipelineIds: allowedPipelineIds(db, str(row["id"]), pipelines),
    defaultPipelineId: defaultPipelineIdOf(db, str(row["id"]), pipelines),
    deals: deals.get(str(row["id"])) ?? {},
  }));
  return {
    pipelines: pipelines.map((pipeline) => ({
      ...pipeline,
      counts: counts.get(pipeline.id) ?? {},
      sellers: sellers.filter((seller) => seller.pipelineIds.includes(pipeline.id)).map((seller) => seller.userId),
    })),
    sellers,
  };
}

export function createPipeline(
  actor: SiteUser,
  input: { name: string; scope: PipelineScope; duplicateOf?: string | undefined },
) {
  actor = requireAdmin(actor);
  const db = ensureFunilSchema();
  const name = cleanLabel(input.name, 60);
  if (!name) throw new Error("Dê um nome ao funil");
  if (!SCOPES.includes(input.scope)) throw new Error("Tipo de funil inválido");
  const pipelines = loadPipelines(db);
  if (pipelines.length >= MAX_PIPELINES) throw new Error(`No máximo ${MAX_PIPELINES} funis ativos`);
  if (pipelines.some((pipeline) => pipeline.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR")))
    throw new Error("Já existe um funil com este nome");
  const source = input.duplicateOf ? requirePipeline(db, input.duplicateOf) : null;
  const stages: StageTemplate[] = source
    ? source.stages.map(({ id: _id, position: _position, ...stage }) => ({ ...stage, requiredFields: [...stage.requiredFields] }))
    : NEW_PIPELINE_STAGES;
  return atomic(() => {
    const id = insertPipeline(db, name, input.scope, stages, { actorId: actor.id, position: pipelines.length });
    audit(actor.id, "crm:funil:criado", id, { nome: name, tipo: input.scope, copiaDe: source?.id ?? null });
    return requirePipeline(db, id);
  });
}

export function updatePipeline(
  actor: SiteUser,
  input: { id: string; revision: number; name?: string | undefined; scope?: PipelineScope | undefined; isDefault?: boolean | undefined },
) {
  actor = requireAdmin(actor);
  const db = ensureFunilSchema();
  const pipeline = requirePipeline(db, input.id, input.revision);
  const name = input.name === undefined ? pipeline.name : cleanLabel(input.name, 60);
  if (!name) throw new Error("Dê um nome ao funil");
  if (
    loadPipelines(db).some(
      (item) => item.id !== pipeline.id && item.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"),
    )
  )
    throw new Error("Já existe um funil com este nome");
  const scope = input.scope ?? pipeline.scope;
  if (!SCOPES.includes(scope)) throw new Error("Tipo de funil inválido");
  if (scope === "personal") {
    const sellers = listFunilAdmin(actor).sellers.filter((seller) => seller.pipelineIds.includes(pipeline.id));
    if (sellers.length > 1) throw new Error("Funil individual aceita só um vendedor. Remova os acessos extras antes.");
  }
  return atomic(() => {
    db.prepare("UPDATE crm_pipelines SET name=?,scope=? WHERE id=?").run(name, scope, pipeline.id);
    if (input.isDefault) db.prepare("UPDATE crm_pipelines SET is_default=CASE WHEN id=? THEN 1 ELSE 0 END WHERE archived_at IS NULL").run(pipeline.id);
    bumpPipeline(db, pipeline.id, actor.id);
    audit(actor.id, "crm:funil:atualizado", pipeline.id, { nome: name, tipo: scope, padrao: Boolean(input.isDefault) });
    return requirePipeline(db, pipeline.id);
  });
}

export interface StageInput {
  id?: string | undefined;
  label: string;
  color: StageColor;
  kind?: StageKind | undefined;
  probability?: number | undefined;
  wipLimit?: number | null | undefined;
  staleDays?: number | null | undefined;
  requiredFields?: RequiredField[] | undefined;
}
/**
 * Salva a estrutura de etapas de uma vez (nome, cor, ordem, chance, limite, dias parado, obrigatórios). Etapa que sai
 * da lista com negócios exige destino em `moves`; ganho e perda não podem sair. Etapas novas são sempre "em andamento".
 */
export function saveStages(
  actor: SiteUser,
  input: { pipelineId: string; revision: number; stages: StageInput[]; moves?: Record<string, string> | undefined },
) {
  actor = requireAdmin(actor);
  const db = ensureFunilSchema();
  const pipeline = requirePipeline(db, input.pipelineId, input.revision);
  const existing = new Map(pipeline.stages.map((stage) => [stage.id, stage]));
  const seen = new Set<string>();
  const next = input.stages.map((item) => {
    if (item.id) {
      const old = existing.get(item.id);
      if (!old) throw new Error("Etapa não pertence a este funil");
      if (seen.has(item.id)) throw new Error("Etapa repetida");
      seen.add(item.id);
      return { id: item.id, ...normalizeStage(item, old.kind) };
    }
    if (item.kind && item.kind !== "open") throw new Error("Só é possível acrescentar etapas em andamento");
    return { id: "", ...normalizeStage(item, "open") };
  });
  const errors = pipelineShapeErrors(next);
  if (errors.length) throw new Error(errors[0]);
  const removed = pipeline.stages.filter((stage) => !seen.has(stage.id));
  const moves = input.moves ?? {};
  for (const stage of removed) {
    if (stage.kind !== "open") throw new Error("As etapas de ganho e de perda não podem ser excluídas");
    const count = Number(
      db.prepare("SELECT count(*) n FROM crm_opportunities WHERE pipeline_id=? AND stage_id=?").get(pipeline.id, stage.id)?.["n"],
    );
    const target = moves[stage.id];
    if (count && (!target || !seen.has(target) || target === stage.id))
      throw new Error(`Escolha para onde vão os ${count} negócio(s) da etapa “${stage.label}”`);
  }
  return atomic(() => {
    const at = now();
    const ordered = [...next.filter((stage) => stage.kind === "open"), ...next.filter((stage) => stage.kind !== "open")];
    ordered.forEach((stage, index) => {
      if (stage.id)
        db.prepare(
          "UPDATE crm_pipeline_stages SET label=?,color=?,position=?,probability=?,wip_limit=?,stale_days=?,required_fields=?,updated_at=? WHERE id=?",
        ).run(stage.label, stage.color, index, stage.probability, stage.wipLimit, stage.staleDays, JSON.stringify(stage.requiredFields), at, stage.id);
      else {
        stage.id = randomUUID();
        db.prepare(
          "INSERT INTO crm_pipeline_stages(id,pipeline_id,label,color,kind,position,probability,wip_limit,stale_days,required_fields,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(stage.id, pipeline.id, stage.label, stage.color, "open", index, stage.probability, stage.wipLimit, stage.staleDays, JSON.stringify(stage.requiredFields), at, at);
      }
    });
    const updated = requirePipeline(db, pipeline.id);
    let moved = 0;
    for (const stage of removed) {
      const target = stageOf(updated, moves[stage.id]);
      const rows = db.prepare("SELECT id FROM crm_opportunities WHERE pipeline_id=? AND stage_id=?").all(pipeline.id, stage.id) as Row[];
      for (const row of rows) {
        db.prepare("UPDATE crm_opportunities SET stage_id=?,stage=?,stage_entered_at=?,position=?,revision=revision+1,updated_at=? WHERE id=?").run(
          target!.id,
          legacyStageFor(updated, target!.id),
          at,
          topPosition(db, pipeline.id, target!.id),
          at,
          row["id"],
        );
        activity(db, str(row["id"]), actor.id, `${pipeline.name} · ${stage.label} → ${target!.label} (etapa excluída)`);
        moved++;
      }
      db.prepare("UPDATE crm_pipeline_stages SET archived_at=?,updated_at=? WHERE id=?").run(at, at, stage.id);
    }
    const final = requirePipeline(db, pipeline.id);
    syncLegacy(db, final);
    bumpPipeline(db, pipeline.id, actor.id);
    audit(actor.id, "crm:funil:etapas", pipeline.id, { etapas: ordered.length, excluidas: removed.length, movidos: moved });
    return { pipeline: requirePipeline(db, pipeline.id), moved };
  });
}

/** Arquiva o funil depois de levar todos os negócios para o destino (mesmo tipo de etapa). Nunca o último. */
export function archivePipeline(actor: SiteUser, input: { id: string; revision: number; targetPipelineId: string }) {
  actor = requireAdmin(actor);
  const db = ensureFunilSchema();
  const pipeline = requirePipeline(db, input.id, input.revision);
  const pipelines = loadPipelines(db);
  if (pipelines.length <= 1) throw new Error("Não é possível excluir o último funil");
  const target = pipelines.find((item) => item.id === input.targetPipelineId);
  if (!target || target.id === pipeline.id) throw new Error("Escolha o funil de destino");
  return atomic(() => {
    const at = now();
    const rows = db.prepare("SELECT id,owner_id,stage_id FROM crm_opportunities WHERE pipeline_id=?").all(pipeline.id) as Row[];
    // Quem tinha acesso ao funil excluído (ou tem negócio nele) passa a ter o destino.
    const users = new Set([
      ...(db.prepare("SELECT user_id FROM crm_pipeline_access WHERE pipeline_id=?").all(pipeline.id) as Row[]).map((row) => str(row["user_id"])),
      ...rows.map((row) => str(row["owner_id"])),
    ]);
    for (const userId of users)
      if (isSellerRow(userRow(db, userId)))
        db.prepare("INSERT OR IGNORE INTO crm_pipeline_access(pipeline_id,user_id,created_at,created_by) VALUES(?,?,?,?)").run(target.id, userId, at, actor.id);
    transferDeals(db, rows, pipeline, target, actor.id, "funil excluído");
    db.prepare("DELETE FROM crm_pipeline_access WHERE pipeline_id=?").run(pipeline.id);
    db.prepare("UPDATE crm_pipeline_defaults SET pipeline_id=?,updated_at=? WHERE pipeline_id=?").run(target.id, at, pipeline.id);
    db.prepare("UPDATE crm_pipelines SET archived_at=?,is_default=0,updated_at=?,updated_by=?,revision=revision+1 WHERE id=?").run(at, at, actor.id, pipeline.id);
    if (pipeline.isDefault) db.prepare("UPDATE crm_pipelines SET is_default=1 WHERE id=?").run(target.id);
    audit(actor.id, "crm:funil:arquivado", pipeline.id, { destino: target.id, movidos: rows.length });
    return { moved: rows.length, targetPipelineId: target.id };
  });
}

/**
 * Libera ou retira um funil de um vendedor. Retirar: o vendedor precisa ficar com ao menos um funil e, se tiver
 * negócios nele, eles vão para `targetPipelineId` (um funil que continua liberado para ele). Nada fica órfão.
 */
export function setPipelineAccess(
  actor: SiteUser,
  input: { pipelineId: string; userId: string; allowed: boolean; targetPipelineId?: string | undefined },
) {
  actor = requireAdmin(actor);
  const db = ensureFunilSchema();
  const pipeline = requirePipeline(db, input.pipelineId);
  const user = userRow(db, input.userId);
  if (!user || !isSellerRow(user)) throw new Error("Vendedor não encontrado");
  const pipelines = loadPipelines(db);
  const allowed = allowedPipelineIds(db, input.userId, pipelines);
  return atomic(() => {
    const at = now();
    if (input.allowed) {
      if (allowed.includes(pipeline.id)) return { changed: false, moved: 0 };
      if (Number(user["disabled"])) throw new Error("Vendedor desativado");
      if (pipeline.scope === "personal") {
        const others = db
          .prepare("SELECT count(*) n FROM crm_pipeline_access a JOIN users u ON u.id=a.user_id WHERE a.pipeline_id=? AND a.user_id<>?")
          .get(pipeline.id, input.userId)?.["n"];
        if (Number(others)) throw new Error("Funil individual: só um vendedor pode ter acesso. Mude o tipo para Compartilhado ou Especializado.");
      }
      db.prepare("INSERT OR IGNORE INTO crm_pipeline_access(pipeline_id,user_id,created_at,created_by) VALUES(?,?,?,?)").run(pipeline.id, input.userId, at, actor.id);
      ensureSellerAccess(db, input.userId, pipelines);
      audit(actor.id, "crm:funil:acesso:liberado", pipeline.id, { vendedor: input.userId });
      return { changed: true, moved: 0 };
    }
    if (!allowed.includes(pipeline.id)) return { changed: false, moved: 0 };
    const remaining = allowed.filter((id) => id !== pipeline.id);
    if (!remaining.length) throw new Error("O vendedor precisa de ao menos um funil. Libere outro funil antes de retirar este.");
    const rows = db.prepare("SELECT id,stage_id FROM crm_opportunities WHERE pipeline_id=? AND owner_id=?").all(pipeline.id, input.userId) as Row[];
    if (rows.length) {
      const target = pipelines.find((item) => item.id === input.targetPipelineId);
      if (!target || !remaining.includes(target.id))
        throw new Error(`O vendedor tem ${rows.length} negócio(s) neste funil: escolha outro funil liberado para ele como destino`);
      transferDeals(db, rows, pipeline, target, actor.id, "acesso ao funil retirado");
    }
    db.prepare("DELETE FROM crm_pipeline_access WHERE pipeline_id=? AND user_id=?").run(pipeline.id, input.userId);
    ensureSellerAccess(db, input.userId, loadPipelines(db));
    audit(actor.id, "crm:funil:acesso:retirado", pipeline.id, { vendedor: input.userId, movidos: rows.length });
    return { changed: true, moved: rows.length };
  });
}

/** Funil padrão de um usuário (precisa estar liberado para ele). */
export function setDefaultPipeline(actor: SiteUser, input: { userId: string; pipelineId: string }) {
  actor = requireAdmin(actor);
  const db = ensureFunilSchema();
  requirePipeline(db, input.pipelineId);
  if (!userRow(db, input.userId)) throw new Error("Usuário não encontrado");
  if (!allowedPipelineIds(db, input.userId).includes(input.pipelineId))
    throw new Error("O funil padrão precisa estar entre os funis liberados para o vendedor");
  db.prepare(
    "INSERT INTO crm_pipeline_defaults(user_id,pipeline_id,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET pipeline_id=excluded.pipeline_id,updated_at=excluded.updated_at",
  ).run(input.userId, input.pipelineId, now());
  audit(actor.id, "crm:funil:padrao", input.pipelineId, { usuario: input.userId });
  return { userId: input.userId, pipelineId: input.pipelineId };
}

/**
 * "Visualizar como" (só administrador, só leitura): o recorte que o vendedor veria, calculado aqui no servidor
 * com as mesmas regras das consultas dele (dono + funis liberados).
 */
export function funilAsSeller(actor: SiteUser, userId: string) {
  actor = requireAdmin(actor);
  const db = ensureFunilSchema();
  const user = userRow(db, userId);
  if (!user || !isSellerRow(user)) throw new Error("Vendedor não encontrado");
  const pipelines = loadPipelines(db);
  const pipelineIds = allowedPipelineIds(db, userId, pipelines);
  const opportunityIds = pipelineIds.length
    ? (
        db
          .prepare(
            `SELECT id FROM crm_opportunities WHERE owner_id=? AND pipeline_id IN (${pipelineIds.map(() => "?").join(",")})`,
          )
          .all(userId, ...pipelineIds) as Row[]
      ).map((row) => str(row["id"]))
    : [];
  return {
    userId,
    name: str(user["display_name"] || user["email"]),
    active: !Number(user["disabled"]),
    pipelineIds,
    defaultPipelineId: defaultPipelineIdOf(db, userId, pipelines),
    opportunityIds,
  };
}
