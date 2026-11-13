import { getDb, transaction, audit, readLead } from "./local-db.server.ts";
import { requireRoles, type SiteUser } from "./local-auth-core.server.ts";
import { listUnitsPublic, validateUnitId } from "./units.server.ts";

type Row = Record<string, any>;
export type AssignmentMode = "manual" | "unidade" | "rodizio";
const initialized = new WeakSet<object>();
export function assignmentsSchema() {
  const db = getDb();
  if (initialized.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS lead_distribution_settings(id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL DEFAULT 'manual' CHECK(mode IN ('manual','unidade','rodizio')), revision INTEGER NOT NULL DEFAULT 1, cursor INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO lead_distribution_settings(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS lead_distribution_consultants(user_id TEXT PRIMARY KEY REFERENCES users(id),unit_id TEXT,position INTEGER NOT NULL DEFAULT 100,enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS lead_distribution_cursors(scope TEXT PRIMARY KEY,cursor INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS lead_assignments(lead_id TEXT PRIMARY KEY REFERENCES quote_requests(id) ON DELETE CASCADE,owner_id TEXT REFERENCES users(id),unit_id TEXT,revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,updated_by TEXT);
    CREATE INDEX IF NOT EXISTS lead_assignment_owner ON lead_assignments(owner_id);
    CREATE TABLE IF NOT EXISTS lead_assignment_history(id INTEGER PRIMARY KEY AUTOINCREMENT,lead_id TEXT NOT NULL,owner_id TEXT,unit_id TEXT,actor_id TEXT,reason TEXT NOT NULL,created_at TEXT NOT NULL);`);
  initialized.add(db);
}
function guard(actor: SiteUser, admin = false) {
  requireRoles(actor, admin ? ["admin"] : ["admin", "comercial"]);
  const row = getDb().prepare("SELECT roles,disabled FROM users WHERE id=?").get(actor.id) as
    Row | undefined;
  const roles: string[] = row ? JSON.parse(row["roles"]) : [];
  if (
    !row ||
    row["disabled"] ||
    !roles.some((r) => (admin ? ["admin"] : ["admin", "comercial"]).includes(r))
  )
    throw new Error("Forbidden: sem permissão");
}
function validOwner(id: string) {
  const row = getDb().prepare("SELECT roles,disabled FROM users WHERE id=?").get(id) as
    Row | undefined;
  if (
    !row ||
    row["disabled"] ||
    !JSON.parse(row["roles"]).some((r: string) => ["admin", "comercial"].includes(r))
  )
    throw new Error("Consultor inválido ou inativo");
}
export function validateAssignedOwner(id: string) {
  validOwner(id);
}
export function leadAssignment(leadId: string) {
  assignmentsSchema();
  const row = getDb().prepare("SELECT * FROM lead_assignments WHERE lead_id=?").get(leadId) as
    Row | undefined;
  return row
    ? {
        ownerId: row["owner_id"] as string | null,
        unitId: row["unit_id"] as string | null,
        revision: Number(row["revision"]),
        updatedAt: String(row["updated_at"]),
      }
    : { ownerId: null, unitId: null, revision: 0, updatedAt: null };
}
function write(
  leadId: string,
  ownerId: string | null,
  unitId: string | null,
  actorId: string | null,
  reason: string,
) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO lead_assignments(lead_id,owner_id,unit_id,updated_at,updated_by) VALUES(?,?,?,?,?) ON CONFLICT(lead_id) DO UPDATE SET owner_id=excluded.owner_id,unit_id=excluded.unit_id,revision=lead_assignments.revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
  ).run(leadId, ownerId, unitId, now, actorId);
  db.prepare(
    "INSERT INTO lead_assignment_history(lead_id,owner_id,unit_id,actor_id,reason,created_at) VALUES(?,?,?,?,?,?)",
  ).run(leadId, ownerId, unitId, actorId, reason, now);
  audit(actorId, "lead:assigned", leadId, { owner_id: ownerId, unit_id: unitId, reason });
}
/** New submissions only. Never reallocates an existing manual choice or converted negotiation. */
export function assignNewLead(leadId: string, unitId?: string | null) {
  assignmentsSchema();
  if (unitId) validateUnitId(unitId);
  return transaction(() => {
    readLead("quote_requests", leadId);
    if (getDb().prepare("SELECT 1 FROM lead_assignments WHERE lead_id=?").get(leadId))
      return leadAssignment(leadId);
    if (getDb().prepare("SELECT 1 FROM internal_quotes WHERE source_request_id=?").get(leadId))
      return leadAssignment(leadId);
    const settings = getDb()
      .prepare("SELECT * FROM lead_distribution_settings WHERE id=1")
      .get() as Row;
    const pool = getDb()
      .prepare(
        `SELECT c.user_id,c.unit_id FROM lead_distribution_consultants c JOIN users u ON u.id=c.user_id WHERE c.enabled=1 AND u.disabled=0 AND (EXISTS(SELECT 1 FROM json_each(u.roles) WHERE value IN ('admin','comercial'))) ORDER BY c.position,c.user_id`,
      )
      .all() as Row[];
    const candidates =
      settings["mode"] === "unidade" ? pool.filter((c) => unitId && c["unit_id"] === unitId) : pool;
    const scope = settings["mode"] === "unidade" ? `unit:${unitId}` : "all";
    const cursor = Number(
      getDb().prepare("SELECT cursor FROM lead_distribution_cursors WHERE scope=?").get(scope)?.[
        "cursor"
      ] ?? 0,
    );
    const owner =
      settings["mode"] !== "manual" && candidates.length
        ? (candidates[cursor % candidates.length]!["user_id"] as string)
        : null;
    if (owner)
      getDb()
        .prepare(
          "INSERT INTO lead_distribution_cursors(scope,cursor) VALUES(?,1) ON CONFLICT(scope) DO UPDATE SET cursor=cursor+1",
        )
        .run(scope);
    write(leadId, owner, unitId || null, null, `automatico:${settings["mode"]}`);
    return leadAssignment(leadId);
  });
}
export function assignLead(
  actor: SiteUser,
  input: { leadId: string; ownerId: string | null; unitId: string | null; revision: number },
) {
  guard(actor, true);
  assignmentsSchema();
  if (input.ownerId) validOwner(input.ownerId);
  if (input.unitId) validateUnitId(input.unitId);
  return transaction(() => {
    readLead("quote_requests", input.leadId);
    if (leadAssignment(input.leadId).revision !== input.revision)
      throw new Error("Conflito: esta atribuição foi alterada. Atualize a página.");
    if (
      getDb().prepare("SELECT 1 FROM internal_quotes WHERE source_request_id=?").get(input.leadId)
    )
      throw new Error(
        "Este lead já foi convertido. O responsável da negociação deve permanecer preservado.",
      );
    write(input.leadId, input.ownerId, input.unitId, actor.id, "manual");
    return leadAssignment(input.leadId);
  });
}
export function saveDistribution(
  actor: SiteUser,
  input: {
    mode: AssignmentMode;
    revision: number;
    consultants: { userId: string; unitId: string | null; enabled: boolean }[];
  },
) {
  guard(actor, true);
  assignmentsSchema();
  listUnitsPublic();
  if (!["manual", "unidade", "rodizio"].includes(input.mode)) throw new Error("Modo inválido");
  if (new Set(input.consultants.map((c) => c.userId)).size !== input.consultants.length)
    throw new Error("Consultor repetido");
  for (const c of input.consultants) {
    validOwner(c.userId);
    if (c.unitId) validateUnitId(c.unitId);
  }
  if (
    input.mode !== "manual" &&
    !input.consultants.some((c) => c["enabled"] && (input.mode !== "unidade" || c.unitId))
  )
    throw new Error("Configure pelo menos um consultor ativo para este modo");
  return transaction(() => {
    const result = getDb()
      .prepare(
        "UPDATE lead_distribution_settings SET mode=?,revision=revision+1,cursor=0 WHERE id=1 AND revision=?",
      )
      .run(input.mode, input.revision);
    if (!result.changes) throw new Error("Conflito: regra alterada. Atualize a página.");
    getDb().prepare("DELETE FROM lead_distribution_consultants").run();
    getDb().prepare("DELETE FROM lead_distribution_cursors").run();
    input.consultants.forEach((c, i) =>
      getDb()
        .prepare(
          "INSERT INTO lead_distribution_consultants(user_id,unit_id,position,enabled) VALUES(?,?,?,?)",
        )
        .run(c.userId, c.unitId, i, c["enabled"] ? 1 : 0),
    );
    audit(actor.id, "lead:distribution:changed", null, {
      mode: input.mode,
      consultants: input.consultants.length,
    });
    return readDistribution(actor);
  });
}
export function readDistribution(actor: SiteUser) {
  guard(actor);
  assignmentsSchema();
  const settings = getDb()
    .prepare("SELECT mode,revision FROM lead_distribution_settings WHERE id=1")
    .get() as Row;
  const consultants = (
    getDb()
      .prepare(
        `SELECT u.id,u.email,u.display_name,c.unit_id,c.enabled FROM users u LEFT JOIN lead_distribution_consultants c ON c.user_id=u.id WHERE u.disabled=0 AND EXISTS(SELECT 1 FROM json_each(u.roles) WHERE value IN ('admin','comercial')) ORDER BY u.email`,
      )
      .all() as Row[]
  ).map((u) => ({
    userId: String(u["id"]),
    name: String(u["display_name"] || u["email"]),
    unitId: u["unit_id"] as string | null,
    enabled: Boolean(u["enabled"]),
  }));
  return {
    mode: settings["mode"] as AssignmentMode,
    revision: Number(settings["revision"]),
    consultants,
    units: listUnitsPublic(),
    canEdit: actor.roles.includes("admin"),
  };
}
export function readAssignedLeads(
  actor: SiteUser,
  filter: { status?: string | undefined; search?: string | undefined } = {},
) {
  guard(actor);
  assignmentsSchema();
  const rows = getDb()
    .prepare(
      `SELECT q.*,a.owner_id,a.unit_id,COALESCE(a.revision,0) assignment_revision,COALESCE(NULLIF(u.display_name,''),u.email) owner_name,(SELECT SUM(qty) FROM quote_request_items i WHERE i.quote_request_id=q.id) item_count,(SELECT count(*) FROM internal_quotes n WHERE n.source_request_id=q.id) negotiation_count FROM quote_requests q LEFT JOIN lead_assignments a ON a.lead_id=q.id LEFT JOIN users u ON u.id=a.owner_id ORDER BY q.created_at DESC LIMIT 500`,
    )
    .all() as Row[];
  const units = new Map(listUnitsPublic().map((u) => [u["id"], u.name]));
  const term = (filter.search || "").toLowerCase();
  return rows
    .map((q) => {
      const data = JSON.parse(q["data"]);
      return {
        id: String(q["id"]),
        protocol: String(q["protocolo"]),
        createdAt: String(q["created_at"]),
        name: String(data.nome || ""),
        company: String(data.empresa || ""),
        origin: String(data.origem || ""),
        status: String(q["status"]),
        itemCount: Number(q["item_count"] || 0),
        ownerId: q["owner_id"] as string | null,
        ownerName: q["owner_name"] as string | null,
        unitId: q["unit_id"] as string | null,
        unitName: units.get(q["unit_id"]) || null,
        revision: Number(q["assignment_revision"]),
        negotiations: Number(q["negotiation_count"]),
      };
    })
    .filter(
      (q) =>
        (!filter.status || q["status"] === filter.status) &&
        (!term ||
          [q.protocol, q.name, q.company, q.ownerName || ""]
            .join(" ")
            .toLowerCase()
            .includes(term)),
    );
}
export function readLeadAssignment(actor: SiteUser, leadId: string) {
  guard(actor);
  readLead("quote_requests", leadId);
  const assignment = leadAssignment(leadId);
  const owner = assignment.ownerId
    ? getDb().prepare("SELECT email,display_name FROM users WHERE id=?").get(assignment.ownerId)
    : null;
  const linked = getDb()
    .prepare(
      "SELECT id,number,owner_id FROM internal_quotes WHERE source_request_id=? ORDER BY created_at",
    )
    .all(leadId) as Row[];
  const unit = assignment.unitId
    ? listUnitsPublic().find((u) => u["id"] === assignment.unitId)
    : null;
  return {
    ...assignment,
    ownerName: (owner?.["display_name"] || owner?.["email"] || null) as string | null,
    unitName: unit?.name || null,
    canConvert:
      actor.roles.includes("admin") || !assignment.ownerId || assignment.ownerId === actor.id,
    negotiations: linked.map((n) => ({
      id: String(n["id"]),
      number: String(n["number"]),
      canOpen: actor.roles.includes("admin") || n["owner_id"] === actor.id,
    })),
  };
}
