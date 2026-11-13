import { randomUUID } from "node:crypto";
import { getDb, audit } from "./local-db.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";
import { assignmentsSchema, leadAssignment, validateAssignedOwner } from "./assignments.server.ts";
import { listUnitsPublic, validateUnitId } from "./units.server.ts";
import { criarOrcamento, orcamentoDoUsuario } from "./orcamentos.server.ts";
import { brPhoneVariants, normalizeBrPhone } from "./br-phone.ts";
import {
  STAGE_LABEL,
  ORIGINS,
  LOSS_REASONS,
  type Contact,
  type Opportunity,
  type Stage,
  type Origin,
  type LossReason,
  type CrmContactInput,
  type CrmBootstrap,
  type CrmTask,
  type Proposal,
  type SiteLead,
  type Message,
  type IngestCrmLeadInput,
  type RecordCrmMessageInput,
  type CrmAttachment,
} from "./crm.ts";

type Row = Record<string, any>;
const initialized = new WeakSet<object>();
const LIMIT = 500;
const receiptRanks: Record<string, number> = {
  pending: 0,
  queued: 0,
  sent: 1,
  received: 1,
  delivered: 2,
  read: 3,
  played: 4,
};
const now = () => new Date().toISOString();
const str = (value: unknown) => String(value ?? "");
const text = (value: unknown, max: number) =>
  str(value)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .trim()
    .slice(0, max);
const phone = (value: unknown) => {
  const digits = str(value).replace(/\D/g, "");
  // Brazilian mobiles are stored with the 9th digit; existing rows are matched in both spellings.
  return normalizeBrPhone(digits.length === 10 || digits.length === 11 ? `55${digits}` : digits);
};
/** SQL fragment + values matching a phone in both Brazilian spellings (never matches an empty phone). */
const phoneMatch = (value: string) => {
  const variants = brPhoneVariants(value);
  return variants.length
    ? { sql: `phone IN (${variants.map(() => "?").join(",")})`, values: variants }
    : { sql: "0", values: [] as string[] };
};
const guard = (actor: SiteUser) => requireActiveUser(actor, ["admin", "comercial"]);
const isAdmin = (actor: SiteUser) => actor.roles.includes("admin");
let savepoint = 0;
function atomic<T>(fn: () => T): T {
  const db = getDb();
  const name = `crm_${++savepoint}`;
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

/** Only additive tables. GET never imports or rewrites historical commercial records. */
export function ensureCrmSchema() {
  const db = getDb();
  if (initialized.has(db)) return db;
  assignmentsSchema();
  listUnitsPublic();
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_contacts (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), unit_id TEXT,
      name TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_contacts_owner ON crm_contacts(owner_id, updated_at);
    CREATE INDEX IF NOT EXISTS crm_contacts_phone ON crm_contacts(owner_id, phone);
    CREATE INDEX IF NOT EXISTS crm_contacts_email ON crm_contacts(owner_id, email);
    CREATE TABLE IF NOT EXISTS crm_opportunities (
      id TEXT PRIMARY KEY, contact_id TEXT NOT NULL REFERENCES crm_contacts(id), owner_id TEXT NOT NULL REFERENCES users(id), unit_id TEXT,
      title TEXT NOT NULL, interest TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT 'novo'
        CHECK(stage IN ('novo','conversando','orcamento','fechado','perdido')),
      origin TEXT NOT NULL DEFAULT 'Desconhecida', notes TEXT NOT NULL DEFAULT '', loss_reason TEXT,
      awaiting_reply INTEGER NOT NULL DEFAULT 0, estimated_value_cents INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1, source_kind TEXT, source_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_interaction TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_opportunities_owner ON crm_opportunities(owner_id, updated_at);
    CREATE TABLE IF NOT EXISTS crm_lead_links (
      provider TEXT NOT NULL, external_id TEXT NOT NULL, opportunity_id TEXT NOT NULL REFERENCES crm_opportunities(id),
      created_at TEXT NOT NULL, PRIMARY KEY(provider, external_id)
    );
    CREATE TABLE IF NOT EXISTS crm_tasks (
      id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES crm_opportunities(id), label TEXT NOT NULL,
      due TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done')),
      created_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS crm_tasks_due ON crm_tasks(status, due);
    CREATE TABLE IF NOT EXISTS crm_activities (
      id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES crm_opportunities(id), actor_id TEXT REFERENCES users(id),
      kind TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_activities_parent ON crm_activities(opportunity_id, created_at);
    CREATE TABLE IF NOT EXISTS crm_quote_links (
      quote_id TEXT PRIMARY KEY REFERENCES internal_quotes(id), opportunity_id TEXT NOT NULL REFERENCES crm_opportunities(id),
      created_at TEXT NOT NULL, created_by TEXT REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS crm_quotes_opportunity ON crm_quote_links(opportunity_id);
    CREATE TABLE IF NOT EXISTS crm_messages (
      id TEXT PRIMARY KEY, contact_id TEXT NOT NULL REFERENCES crm_contacts(id), provider TEXT NOT NULL,
      account TEXT NOT NULL, external_id TEXT NOT NULL, sender TEXT NOT NULL CHECK(sender IN ('cliente','vendedora')),
      text TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'whatsapp', status TEXT NOT NULL DEFAULT 'received',
      sent_at TEXT NOT NULL, read_at TEXT, UNIQUE(provider,account,external_id)
    );
    CREATE INDEX IF NOT EXISTS crm_messages_contact ON crm_messages(contact_id, sent_at);
    CREATE TABLE IF NOT EXISTS crm_message_receipts (
      provider TEXT NOT NULL, account TEXT NOT NULL, external_id TEXT NOT NULL, status TEXT NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY(provider,account,external_id)
    );
  `);
  initialized.add(db);
  return db;
}

function ownerName(id: string) {
  const row = getDb().prepare("SELECT email,display_name FROM users WHERE id=?").get(id);
  return str(row?.["display_name"] || row?.["email"]);
}
function validateOwnership(actor: SiteUser, ownerId?: string, unitId?: string | null) {
  const owner = ownerId || actor.id;
  if (!isAdmin(actor) && owner !== actor.id)
    throw new Error("Forbidden: somente o administrador pode definir outro responsável");
  validateAssignedOwner(owner);
  if (unitId) validateUnitId(unitId);
  return { ownerId: owner, unitId: unitId || null };
}
function contactFromRow(r: Row): Contact {
  return {
    id: r["id"],
    name: r["name"],
    company: r["company"] || undefined,
    phone: r["phone"],
    email: r["email"],
    city: r["city"],
    ownerId: r["owner_id"],
    ownerName: ownerName(r["owner_id"]),
    unitId: r["unit_id"],
    revision: r["revision"],
    createdAt: r["created_at"],
    updatedAt: r["updated_at"],
  };
}
export function requireCrmContact(actor: SiteUser, id: string): Contact {
  actor = guard(actor);
  const db = ensureCrmSchema();
  const row = db.prepare("SELECT * FROM crm_contacts WHERE id=?").get(id) as Row | undefined;
  if (!row || (!isAdmin(actor) && row["owner_id"] !== actor.id))
    throw new Error("Forbidden: contato indisponível para sua carteira");
  return contactFromRow(row);
}
function opportunityFromRow(r: Row): Opportunity {
  const db = getDb();
  const next = db
    .prepare(
      "SELECT id,label,due FROM crm_tasks WHERE opportunity_id=? AND status='pending' ORDER BY due,id LIMIT 1",
    )
    .get(r["id"]);
  const quoteIds = db
    .prepare(
      "SELECT quote_id FROM crm_quote_links WHERE opportunity_id=? ORDER BY created_at,quote_id",
    )
    .all(r["id"])
    .map((q) => str(q["quote_id"]));
  return {
    id: r["id"],
    contactId: r["contact_id"],
    title: r["title"],
    interest: r["interest"],
    stage: r["stage"],
    origin: r["origin"],
    createdAt: r["created_at"],
    lastInteraction: r["last_interaction"],
    awaitingReply: Boolean(r["awaiting_reply"]),
    nextAction: next
      ? { label: str(next["label"]), due: str(next["due"]), taskId: str(next["id"]) }
      : { label: "", due: "" },
    notes: r["notes"],
    lossReason: r["loss_reason"] || undefined,
    revision: r["revision"],
    ownerId: r["owner_id"],
    ownerName: ownerName(r["owner_id"]),
    unitId: r["unit_id"],
    quoteIds,
    estimatedValueCents: r["estimated_value_cents"],
    sourceKind: r["source_kind"] || undefined,
    sourceId: r["source_id"] || undefined,
  };
}
export function requireCrmOpportunity(actor: SiteUser, id: string): Opportunity {
  actor = guard(actor);
  const db = ensureCrmSchema();
  const row = db.prepare("SELECT * FROM crm_opportunities WHERE id=?").get(id) as Row | undefined;
  if (!row || (!isAdmin(actor) && row["owner_id"] !== actor.id))
    throw new Error("Forbidden: oportunidade indisponível para sua carteira");
  return opportunityFromRow(row);
}
function event(opportunityId: string, actorId: string | null, kind: string, label: string) {
  getDb()
    .prepare(
      "INSERT INTO crm_activities(id,opportunity_id,actor_id,kind,label,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(randomUUID(), opportunityId, actorId, kind, text(label, 5000), now());
  audit(actorId, `crm:${kind}`, opportunityId);
}
function createContactInternal(
  input: CrmContactInput,
  ownerId: string,
  unitId: string | null,
): Contact {
  const db = getDb();
  const p = phone(input.phone);
  const email = text(input.email, 255).toLowerCase();
  const name = text(input.name, 200);
  if (!name) throw new Error("Informe o nome do contato");
  if (p && (p.length < 10 || p.length > 15)) throw new Error("Telefone inválido");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("E-mail inválido");
  // Deduplicate only within the same private portfolio, never by name alone.
  const byPhone = phoneMatch(p);
  const matches = db
    .prepare(
      `SELECT * FROM crm_contacts WHERE owner_id=? AND (${byPhone.sql} OR (?<>'' AND email=?))`,
    )
    .all(ownerId, ...byPhone.values, email, email) as Row[];
  if (matches.length > 1 && new Set(matches.map((r) => r["id"])).size > 1)
    throw new Error("Telefone e e-mail pertencem a contatos diferentes; revise os cadastros");
  if (matches[0]) return contactFromRow(matches[0]);
  const id = randomUUID();
  const at = now();
  db.prepare(
    "INSERT INTO crm_contacts(id,owner_id,unit_id,name,company,phone,email,city,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    ownerId,
    unitId,
    name,
    text(input.company, 200),
    p,
    email,
    text(input.city, 120),
    at,
    at,
  );
  return contactFromRow(db.prepare("SELECT * FROM crm_contacts WHERE id=?").get(id) as Row);
}
export function createContact(actor: SiteUser, input: CrmContactInput) {
  actor = guard(actor);
  ensureCrmSchema();
  const ownership = validateOwnership(actor, input.ownerId, input.unitId);
  return atomic(() => {
    const contact = createContactInternal(input, ownership.ownerId, ownership.unitId);
    audit(actor.id, "crm:contact:saved", contact.id);
    return contact;
  });
}
export function updateContact(
  actor: SiteUser,
  input: CrmContactInput & { id: string; revision: number },
) {
  actor = guard(actor);
  const contact = requireCrmContact(actor, input.id);
  const ownership = validateOwnership(
    actor,
    input.ownerId || contact.ownerId,
    input.unitId === undefined ? contact.unitId : input.unitId,
  );
  if (
    ownership.ownerId !== contact.ownerId &&
    getDb().prepare("SELECT 1 FROM crm_opportunities WHERE contact_id=?").get(contact.id)
  )
    throw new Error(
      "Contato com oportunidades: mantenha o responsável para preservar a carteira e as propostas vinculadas",
    );
  const p = phone(input.phone);
  const email = text(input.email, 255).toLowerCase();
  if (!text(input.name, 200)) throw new Error("Informe o nome do contato");
  if (p && (p.length < 10 || p.length > 15)) throw new Error("Telefone inválido");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("E-mail inválido");
  return atomic(() => {
    const byPhone = phoneMatch(p);
    const duplicate = getDb()
      .prepare(
        `SELECT 1 FROM crm_contacts WHERE owner_id=? AND id<>? AND (${byPhone.sql} OR (?<>'' AND email=?))`,
      )
      .get(ownership.ownerId, contact.id, ...byPhone.values, email, email);
    if (duplicate)
      throw new Error("Já existe outro contato com este telefone ou e-mail na carteira");
    const result = getDb()
      .prepare(
        "UPDATE crm_contacts SET name=?,company=?,phone=?,email=?,city=?,owner_id=?,unit_id=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
      )
      .run(
        text(input.name, 200),
        text(input.company, 200),
        p,
        email,
        text(input.city, 120),
        ownership.ownerId,
        ownership.unitId,
        now(),
        contact.id,
        input.revision,
      );
    if (!result.changes) throw new Error("Conflito: o contato mudou. Atualize antes de salvar");
    audit(actor.id, "crm:contact:updated", contact.id);
    return requireCrmContact(actor, contact.id);
  });
}
export interface CreateOpportunityInput {
  contactId?: string | undefined;
  newContact?: CrmContactInput | undefined;
  title: string;
  interest?: string | undefined;
  origin: Origin;
  ownerId?: string | undefined;
  unitId?: string | null | undefined;
}
function createOpportunityInternal(
  contact: Contact,
  input: CreateOpportunityInput,
  source?: { kind: string; id: string; at?: string },
) {
  const id = randomUUID();
  const at = now();
  const title = text(input.title, 240);
  if (!title) throw new Error("Informe o título da oportunidade");
  if (!ORIGINS.includes(input.origin)) throw new Error("Origem inválida");
  getDb()
    .prepare(
      `INSERT INTO crm_opportunities(id,contact_id,owner_id,unit_id,title,interest,origin,source_kind,source_id,created_at,updated_at,last_interaction)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      contact.id,
      contact.ownerId,
      input.unitId === undefined ? contact.unitId : input.unitId,
      title,
      text(input.interest, 3000),
      input.origin,
      source?.kind || null,
      source?.id || null,
      source?.at || at,
      at,
      source?.at || at,
    );
  event(id, null, "opportunity:created", "Oportunidade criada");
  return opportunityFromRow(
    getDb().prepare("SELECT * FROM crm_opportunities WHERE id=?").get(id) as Row,
  );
}
export function createOpportunity(actor: SiteUser, input: CreateOpportunityInput) {
  actor = guard(actor);
  ensureCrmSchema();
  return atomic(() => {
    const ownership = validateOwnership(actor, input.ownerId, input.unitId);
    const contact = input.contactId
      ? requireCrmContact(actor, input.contactId)
      : input.newContact
        ? createContactInternal(input.newContact, ownership.ownerId, ownership.unitId)
        : null;
    if (!contact) throw new Error("Selecione ou cadastre um contato");
    if (input.ownerId && input.ownerId !== contact.ownerId)
      throw new Error("A oportunidade deve usar o responsável da carteira do contato");
    return createOpportunityInternal(contact, input);
  });
}
export interface UpdateOpportunityInput {
  id: string;
  revision: number;
  title?: string | undefined;
  interest?: string | undefined;
  notes?: string | undefined;
  awaitingReply?: boolean | undefined;
  estimatedValueCents?: number | undefined;
  ownerId?: string | undefined;
  unitId?: string | null | undefined;
}
export function updateOpportunity(actor: SiteUser, input: UpdateOpportunityInput) {
  actor = guard(actor);
  const op = requireCrmOpportunity(actor, input.id);
  if (input.ownerId && input.ownerId !== op.ownerId)
    throw new Error(
      "A troca de responsável exige transferência da carteira; preserve os vínculos existentes",
    );
  if (input.unitId) validateUnitId(input.unitId);
  const title = input.title === undefined ? op.title : text(input.title, 240);
  if (!title) throw new Error("Informe o título da oportunidade");
  const amount = input.estimatedValueCents ?? op.estimatedValueCents;
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000_000)
    throw new Error("Valor estimado inválido");
  return atomic(() => {
    const result = getDb()
      .prepare(
        "UPDATE crm_opportunities SET title=?,interest=?,notes=?,awaiting_reply=?,estimated_value_cents=?,unit_id=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
      )
      .run(
        title,
        input.interest === undefined ? op.interest : text(input.interest, 3000),
        input.notes === undefined ? op.notes : text(input.notes, 5000),
        Number(input.awaitingReply ?? op.awaitingReply),
        amount,
        input.unitId === undefined ? op.unitId : input.unitId,
        now(),
        op.id,
        input.revision,
      );
    if (!result.changes)
      throw new Error("Conflito: a oportunidade mudou. Atualize antes de salvar");
    event(
      op.id,
      actor.id,
      input.notes !== undefined ? "note:saved" : "opportunity:updated",
      input.notes !== undefined
        ? "Notas internas atualizadas"
        : "Dados da oportunidade atualizados",
    );
    return requireCrmOpportunity(actor, op.id);
  });
}
export function moveOpportunity(
  actor: SiteUser,
  input: { id: string; revision: number; stage: Stage; lossReason?: LossReason | undefined },
) {
  actor = guard(actor);
  const op = requireCrmOpportunity(actor, input.id);
  if (!(input.stage in STAGE_LABEL)) throw new Error("Etapa inválida");
  if (input.stage === "perdido" && (!input.lossReason || !LOSS_REASONS.includes(input.lossReason)))
    throw new Error("Informe o motivo da perda");
  return atomic(() => {
    const result = getDb()
      .prepare(
        "UPDATE crm_opportunities SET stage=?,loss_reason=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
      )
      .run(
        input.stage,
        input.stage === "perdido" ? input.lossReason! : null,
        now(),
        op.id,
        input.revision,
      );
    if (!result.changes) throw new Error("Conflito: a oportunidade mudou. Atualize antes de mover");
    event(
      op.id,
      actor.id,
      "stage:changed",
      `${STAGE_LABEL[op.stage]} → ${STAGE_LABEL[input.stage]}${input.stage === "perdido" ? ` · ${input.lossReason}` : ""}`,
    );
    return requireCrmOpportunity(actor, op.id);
  });
}
function taskFromRow(r: Row): CrmTask {
  return {
    id: r["id"],
    opportunityId: r["opportunity_id"],
    label: r["label"],
    due: r["due"],
    status: r["status"],
    createdAt: r["created_at"],
    completedAt: r["completed_at"],
  };
}
export function scheduleTask(
  actor: SiteUser,
  input: { opportunityId: string; label: string; due: string },
) {
  actor = guard(actor);
  const op = requireCrmOpportunity(actor, input.opportunityId);
  const label = text(input.label, 240);
  const due = new Date(input.due);
  if (!label || !Number.isFinite(due.getTime())) throw new Error("Informe uma ação e data válidas");
  return atomic(() => {
    const id = randomUUID();
    getDb()
      .prepare("INSERT INTO crm_tasks(id,opportunity_id,label,due,created_at) VALUES(?,?,?,?,?)")
      .run(id, op.id, label, due.toISOString(), now());
    getDb()
      .prepare("UPDATE crm_opportunities SET revision=revision+1,updated_at=? WHERE id=?")
      .run(now(), op.id);
    event(op.id, actor.id, "task:scheduled", `Retorno agendado: ${label}`);
    return taskFromRow(getDb().prepare("SELECT * FROM crm_tasks WHERE id=?").get(id) as Row);
  });
}
export function completeTask(actor: SiteUser, input: { id: string }) {
  actor = guard(actor);
  ensureCrmSchema();
  const row = getDb().prepare("SELECT * FROM crm_tasks WHERE id=?").get(input.id) as
    Row | undefined;
  if (!row) throw new Error("Tarefa não encontrada");
  requireCrmOpportunity(actor, row["opportunity_id"]);
  return atomic(() => {
    const result = getDb()
      .prepare("UPDATE crm_tasks SET status='done',completed_at=? WHERE id=? AND status='pending'")
      .run(now(), input.id);
    if (result.changes) {
      event(row["opportunity_id"], actor.id, "task:completed", `Concluído: ${row["label"]}`);
      getDb()
        .prepare("UPDATE crm_opportunities SET revision=revision+1,updated_at=? WHERE id=?")
        .run(now(), row["opportunity_id"]);
    }
    return taskFromRow(getDb().prepare("SELECT * FROM crm_tasks WHERE id=?").get(input.id) as Row);
  });
}

function sourceOrigin(data: Row): Origin {
  const source = str(data["utm"]?.utm_source).toLowerCase();
  const medium = str(data["utm"]?.utm_medium).toLowerCase();
  const paid = /^(cpc|ppc|paid|paid_social|paid-social|paid_search|paid-search|social_paid)$/.test(
    medium,
  );
  if (data["utm"]?.gclid || (paid && /google|adwords/.test(source))) return "Anúncio Google";
  if (paid && /facebook|instagram|meta|^fb$|^ig$/.test(source)) return "Anúncio Meta";
  return "Site";
}
function readSource(actor: SiteUser, sourceKind: "quote" | "contact", sourceId: string) {
  const db = ensureCrmSchema();
  const table = sourceKind === "quote" ? "quote_requests" : "contact_requests";
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(sourceId) as Row | undefined;
  if (!row) throw new Error("Solicitação não encontrada");
  const assignment =
    sourceKind === "quote" ? leadAssignment(sourceId) : { ownerId: null, unitId: null };
  if (!isAdmin(actor) && assignment.ownerId !== actor.id)
    throw new Error("Forbidden: solicitação não atribuída à sua carteira");
  return { row, data: JSON.parse(row["data"]) as Row, assignment };
}
function siteLeads(actor: SiteUser): SiteLead[] {
  const db = getDb();
  const quoteWhere = isAdmin(actor) ? "" : "WHERE a.owner_id=?";
  const quotes = db
    .prepare(
      `SELECT q.*,a.owner_id,a.unit_id FROM quote_requests q LEFT JOIN lead_assignments a ON a.lead_id=q.id ${quoteWhere} ORDER BY q.created_at DESC LIMIT ${LIMIT}`,
    )
    .all(...(isAdmin(actor) ? [] : [actor.id])) as Row[];
  const contacts = isAdmin(actor)
    ? (db
        .prepare(
          `SELECT *,NULL owner_id,NULL unit_id FROM contact_requests ORDER BY created_at DESC LIMIT ${LIMIT}`,
        )
        .all() as Row[])
    : [];
  return [
    ...quotes.map((r) => ({ r, kind: "quote" as const })),
    ...contacts.map((r) => ({ r, kind: "contact" as const })),
  ]
    .map(({ r, kind }) => {
      const data = JSON.parse(r["data"]);
      const imported = db
        .prepare("SELECT opportunity_id FROM crm_lead_links WHERE provider=? AND external_id=?")
        .get(`site:${kind}`, r["id"]);
      return {
        id: r["id"],
        sourceId: r["id"],
        sourceKind: kind,
        protocol: r["protocolo"],
        name: str(data.nome),
        company: str(data.empresa),
        origin: sourceOrigin(data),
        createdAt: r["created_at"],
        ownerId: r["owner_id"],
        ownerName: r["owner_id"] ? ownerName(r["owner_id"]) : null,
        unitId: r["unit_id"],
        importedOpportunityId: imported ? str(imported["opportunity_id"]) : null,
        interest: text(data.mensagem || data.assunto, 3000),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, LIMIT);
}
export function importSiteLead(
  actor: SiteUser,
  input: { sourceKind: "quote" | "contact"; sourceId: string },
) {
  actor = guard(actor);
  const { row, data, assignment } = readSource(actor, input.sourceKind, input.sourceId);
  return atomic(() => {
    const provider = `site:${input.sourceKind}`;
    const previous = getDb()
      .prepare("SELECT opportunity_id FROM crm_lead_links WHERE provider=? AND external_id=?")
      .get(provider, row["id"]);
    if (previous) return requireCrmOpportunity(actor, str(previous["opportunity_id"]));
    const contact = createContactInternal(
      {
        name: data["nome"] || data["empresa"] || "Contato do site",
        company: data["empresa"],
        phone: data["whatsapp"],
        email: data["email"],
        city: [data["cidade"], data["estado"]].filter(Boolean).join("/"),
      },
      assignment.ownerId || actor.id,
      assignment.unitId,
    );
    const op = createOpportunityInternal(
      contact,
      {
        title:
          input.sourceKind === "quote"
            ? `Orçamento ${row["protocolo"]}`
            : data["assunto"] || `Contato ${row["protocolo"]}`,
        interest: data["mensagem"] || "",
        origin: sourceOrigin(data),
      },
      { kind: input.sourceKind, id: row["id"], at: row["created_at"] },
    );
    getDb()
      .prepare(
        "INSERT INTO crm_lead_links(provider,external_id,opportunity_id,created_at) VALUES(?,?,?,?)",
      )
      .run(provider, row["id"], op.id, now());
    event(
      op.id,
      actor.id,
      "lead:imported",
      `Solicitação ${row["protocolo"]} vinculada; origem preservada no registro original`,
    );
    if (data["mensagem"])
      recordCrmMessage({
        contactId: contact.id,
        provider: "site",
        account: input.sourceKind,
        externalId: row["id"],
        from: "cliente",
        text: data["mensagem"],
        at: row["created_at"],
        channel: "site",
        status: "received",
      });
    const linked =
      input.sourceKind === "quote"
        ? (getDb()
            .prepare(
              "SELECT id,owner_id FROM internal_quotes WHERE source_request_id=? ORDER BY created_at",
            )
            .all(row["id"]) as Row[])
        : [];
    for (const q of linked)
      if (q["owner_id"] === op.ownerId)
        linkQuote(actor, { opportunityId: op.id, quoteId: q["id"] });
    return requireCrmOpportunity(actor, op.id);
  });
}

function allProposals(actor: SiteUser): Proposal[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT q.*,l.opportunity_id,o.contact_id,p.id proposal_id,p.version proposal_version,p.created_at proposal_date,p.sent_at proposal_sent,p.accepted_at proposal_accepted,p.refused_at proposal_refused,
      json_extract(p.snapshot,'$.totais.totalCentavos') snapshot_total
    FROM internal_quotes q LEFT JOIN crm_quote_links l ON l.quote_id=q.id LEFT JOIN crm_opportunities o ON o.id=l.opportunity_id
    LEFT JOIN quote_proposals p ON p.quote_id=q.id AND p.current=1 AND p.deleted_at IS NULL
    ${isAdmin(actor) ? "" : "WHERE q.owner_id=?"} ORDER BY q.updated_at DESC LIMIT ${LIMIT}`,
    )
    .all(...(isAdmin(actor) ? [] : [actor.id])) as Row[];
  return rows.map((r) => {
    const status =
      r["status"] === "cancelado"
        ? "Cancelada"
        : r["proposal_refused"]
          ? "Recusada"
          : r["proposal_accepted"]
            ? "Aceita"
            : r["proposal_sent"]
              ? "Enviada"
              : "Rascunho";
    const detailUrl = `/interno/orcamentos-internos/${r["id"]}`;
    return {
      id: r["proposal_id"] || r["id"],
      quoteId: r["id"],
      number: r["number"],
      opportunityId: r["opportunity_id"] || "",
      contactId: r["contact_id"] || "",
      status,
      value: Number(r["snapshot_total"] ?? r["total_cents"]) / 100,
      date: r["proposal_date"] || r["updated_at"],
      version: r["proposal_version"] || null,
      detailUrl,
      pdfUrl: r["proposal_version"] ? `${detailUrl}/pdf?v=${r["proposal_version"]}` : null,
      customerName: r["customer_name"] || r["customer_trade_name"] || "Cliente não informado",
    };
  });
}
export function linkQuote(actor: SiteUser, input: { opportunityId: string; quoteId: string }) {
  actor = guard(actor);
  const op = requireCrmOpportunity(actor, input.opportunityId);
  const quote = orcamentoDoUsuario(actor, input.quoteId);
  if (quote["owner_id"] !== op.ownerId)
    throw new Error("A proposta e a oportunidade devem pertencer ao mesmo responsável");
  return atomic(() => {
    const previous = getDb()
      .prepare("SELECT opportunity_id FROM crm_quote_links WHERE quote_id=?")
      .get(input.quoteId);
    if (previous && previous["opportunity_id"] !== op.id)
      throw new Error("Esta proposta já está vinculada a outra oportunidade");
    const result = getDb()
      .prepare(
        "INSERT OR IGNORE INTO crm_quote_links(quote_id,opportunity_id,created_at,created_by) VALUES(?,?,?,?)",
      )
      .run(input.quoteId, op.id, now(), actor.id);
    if (result.changes) {
      event(op.id, actor.id, "quote:linked", `Negociação ${quote["number"]} vinculada`);
      getDb()
        .prepare("UPDATE crm_opportunities SET revision=revision+1,updated_at=? WHERE id=?")
        .run(now(), op.id);
    }
    return requireCrmOpportunity(actor, op.id);
  });
}
export function createQuoteForOpportunity(
  actor: SiteUser,
  input: { opportunityId: string },
  products: { id: string; sku: string; nome: string; unidade: string; slug: string | null }[],
) {
  actor = guard(actor);
  const op = requireCrmOpportunity(actor, input.opportunityId);
  const contact = requireCrmContact(actor, op.contactId);
  const previous = op.quoteIds[0];
  if (previous) {
    const q = orcamentoDoUsuario(actor, previous);
    return {
      id: previous,
      numero: str(q["number"]),
      detailUrl: `/interno/orcamentos-internos/${previous}`,
    };
  }
  // The original engine creates number/items/rules. CRM only fills the new draft's contact and links it.
  const sourceId = op.sourceKind === "quote" ? op.sourceId : undefined;
  const created = criarOrcamento(actor, products, sourceId);
  const q = orcamentoDoUsuario(actor, created.id);
  if (!sourceId) {
    getDb()
      .prepare(
        "UPDATE internal_quotes SET owner_id=?,customer_name=?,customer_trade_name=?,customer_contact=?,customer_email=?,customer_phone=?,customer_city=? WHERE id=? AND status='rascunho'",
      )
      .run(
        op.ownerId,
        contact.company || contact.name,
        contact.company || null,
        contact.company ? contact.name : null,
        contact.email || null,
        contact.phone || null,
        contact.city || null,
        created.id,
      );
  } else if (q["owner_id"] !== op.ownerId)
    throw new Error("Responsável da solicitação mudou; revise antes de vincular a proposta");
  linkQuote(actor, { opportunityId: op.id, quoteId: created.id });
  return { ...created, detailUrl: `/interno/orcamentos-internos/${created.id}` };
}

function messageFromRow(r: Row): Message {
  const db = getDb();
  const attachments: CrmAttachment[] = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_media'")
    .get()
    ? db
        .prepare(
          "SELECT id,name,mime_type,size,kind FROM crm_media WHERE message_id=? ORDER BY created_at,id",
        )
        .all(r["id"])
        .map((file) => ({
          id: str(file["id"]),
          name: str(file["name"]),
          mimeType: str(file["mime_type"]),
          size: Number(file["size"]),
          kind: file["kind"] as CrmAttachment["kind"],
          status: "ready" as const,
          downloadUrl: `/api/interno/crm/anexos/${file["id"]}`,
        }))
    : [];
  return {
    id: r["id"],
    from: r["sender"],
    text: r["text"],
    at: r["sent_at"],
    status: r["status"],
    channel: r["channel"],
    provider: r["provider"],
    externalId: r["external_id"],
    ...(attachments.length ? { attachments } : {}),
  };
}
/** Stable keyset pagination; history remains accessible beyond the workspace's legacy 500-row limit. */
export function listCrmMessagesPage(
  actor: SiteUser,
  input: { contactId: string; before?: string | undefined; limit?: number | undefined },
) {
  requireCrmContact(actor, input.contactId);
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Limite de mensagens inválido");
  let cursor: { at: string; id: string } | null = null;
  if (input.before) {
    try {
      if (input.before.length > 512) throw new Error("cursor");
      const value = JSON.parse(Buffer.from(input.before, "base64url").toString("utf8"));
      if (
        typeof value.at !== "string" ||
        new Date(value.at).toISOString() !== value.at ||
        !/^[0-9a-f-]{36}$/i.test(value.id)
      )
        throw new Error("cursor");
      cursor = { at: value.at, id: value.id };
    } catch {
      throw new Error("Cursor de mensagens inválido");
    }
  }
  const rows = getDb()
    .prepare(
      `SELECT * FROM crm_messages WHERE contact_id=? ${cursor ? "AND (sent_at<? OR (sent_at=? AND id<?))" : ""} ORDER BY sent_at DESC,id DESC LIMIT ?`,
    )
    .all(input.contactId, ...(cursor ? [cursor.at, cursor.at, cursor.id] : []), limit + 1) as Row[];
  const hasMore = rows.length > limit;
  const selected = rows.slice(0, limit);
  const oldest = selected.at(-1);
  return {
    messages: selected.reverse().map(messageFromRow),
    hasMore,
    nextCursor:
      hasMore && oldest
        ? Buffer.from(JSON.stringify({ at: oldest["sent_at"], id: oldest["id"] })).toString(
            "base64url",
          )
        : null,
  };
}
export function listCrmMessages(actor: SiteUser, contactId: string): Message[] {
  requireCrmContact(actor, contactId);
  return (
    getDb()
      .prepare(
        `SELECT * FROM (SELECT * FROM crm_messages WHERE contact_id=? ORDER BY sent_at DESC,id DESC LIMIT ${LIMIT}) ORDER BY sent_at,id`,
      )
      .all(contactId) as Row[]
  ).map(messageFromRow);
}
/** Trusted server transport only. Never expose directly as an unauthenticated server function. */
export function recordCrmMessage(input: RecordCrmMessageInput): Message {
  const db = ensureCrmSchema();
  if (!db.prepare("SELECT 1 FROM crm_contacts WHERE id=?").get(input.contactId))
    throw new Error("Contato não encontrado");
  if (!["cliente", "vendedora"].includes(input.from)) throw new Error("Remetente inválido");
  const provider = text(input.provider, 80);
  const account = text(input.account, 160);
  const externalId = text(input.externalId, 240);
  if (!provider || !account || !externalId)
    throw new Error("Identificação da mensagem obrigatória");
  const messageText = text(input.text, 20000);
  if (!messageText) throw new Error("Mensagem vazia");
  const date = input.at ? new Date(input.at) : new Date();
  if (!Number.isFinite(date.getTime())) throw new Error("Data da mensagem inválida");
  return atomic(() => {
    const existing = db
      .prepare("SELECT * FROM crm_messages WHERE provider=? AND account=? AND external_id=?")
      .get(provider, account, externalId) as Row | undefined;
    if (existing) {
      if (existing["contact_id"] !== input.contactId)
        throw new Error("Mensagem já associada a outro contato");
      return messageFromRow(existing);
    }
    const id = randomUUID();
    const at = date.toISOString();
    let status = text(input.status || (input.from === "cliente" ? "received" : "sent"), 40);
    const receipt = db
      .prepare(
        "SELECT status FROM crm_message_receipts WHERE provider=? AND account=? AND external_id=?",
      )
      .get(provider, account, externalId);
    if (receipt && (receiptRanks[str(receipt["status"])] ?? -1) > (receiptRanks[status] ?? -1))
      status = str(receipt["status"]);
    db.prepare(
      "INSERT INTO crm_messages(id,contact_id,provider,account,external_id,sender,text,channel,status,sent_at,read_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      input.contactId,
      provider,
      account,
      externalId,
      input.from,
      messageText,
      text(input.channel || "whatsapp", 40),
      status,
      at,
      input.historical ? at : input.from === "vendedora" ? now() : null,
    );
    if (!input.historical && !input.suppressOpportunityUpdate)
      db.prepare(
        "UPDATE crm_opportunities SET awaiting_reply=?,last_interaction=CASE WHEN last_interaction<? THEN ? ELSE last_interaction END,revision=revision+1,updated_at=? WHERE contact_id=? AND stage NOT IN ('fechado','perdido')",
      ).run(Number(input.from === "cliente"), at, at, now(), input.contactId);
    return messageFromRow(db.prepare("SELECT * FROM crm_messages WHERE id=?").get(id) as Row);
  });
}
export function markCrmRead(actor: SiteUser, contactId: string) {
  requireCrmContact(actor, contactId);
  getDb()
    .prepare(
      "UPDATE crm_messages SET read_at=? WHERE contact_id=? AND sender='cliente' AND read_at IS NULL",
    )
    .run(now(), contactId);
  return { ok: true };
}
/** Trusted transport receipt only; never regress delivered/read on a delayed event. */
export function updateCrmMessageStatus(input: {
  provider: string;
  account: string;
  externalId: string;
  status: string;
}) {
  const db = ensureCrmSchema();
  return atomic(() => {
    const nextRank = receiptRanks[input.status] ?? -1;
    const previous = db
      .prepare(
        "SELECT status FROM crm_message_receipts WHERE provider=? AND account=? AND external_id=?",
      )
      .get(input.provider, input.account, input.externalId);
    if (nextRank >= 0 && nextRank > (receiptRanks[str(previous?.["status"])] ?? -1))
      db.prepare(
        "INSERT INTO crm_message_receipts(provider,account,external_id,status,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(provider,account,external_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at",
      ).run(input.provider, input.account, input.externalId, input.status, now());
    const row = db
      .prepare("SELECT * FROM crm_messages WHERE provider=? AND account=? AND external_id=?")
      .get(input.provider, input.account, input.externalId) as Row | undefined;
    if (!row) return null;
    if (nextRank > (receiptRanks[row["status"]] ?? -1))
      db.prepare("UPDATE crm_messages SET status=? WHERE id=?").run(input.status, row["id"]);
    return messageFromRow(
      db.prepare("SELECT * FROM crm_messages WHERE id=?").get(row["id"]) as Row,
    );
  });
}
/** Matching by normalized address is scoped to a portfolio; trusted webhooks only. */
export function findCrmContactByPhone(value: string, ownerId?: string): Contact | null {
  const db = ensureCrmSchema();
  const normalized = phone(value);
  if (!normalized) return null;
  // The same Brazilian mobile may be stored with or without the 9th digit.
  const variants = brPhoneVariants(normalized);
  const rows = db
    .prepare(
      `SELECT * FROM crm_contacts WHERE phone IN (${variants.map(() => "?").join(",")}) ${ownerId ? "AND owner_id=?" : ""} ORDER BY created_at LIMIT 2`,
    )
    .all(...variants, ...(ownerId ? [ownerId] : [])) as Row[];
  return rows.length === 1 ? contactFromRow(rows[0]!) : null;
}
/** Trusted ingress: caller must authenticate/validate its provider and preserve provider identity. */
export function ingestCrmLead(input: IngestCrmLeadInput) {
  const db = ensureCrmSchema();
  const provider = text(input.provider, 80);
  const externalId = text(input.externalId, 240);
  if (!provider || !externalId) throw new Error("Identificação do lead obrigatória");
  return atomic(() => {
    const previous = db
      .prepare("SELECT opportunity_id FROM crm_lead_links WHERE provider=? AND external_id=?")
      .get(provider, externalId);
    if (previous) {
      const row = db
        .prepare("SELECT * FROM crm_opportunities WHERE id=?")
        .get(previous["opportunity_id"] as string) as Row;
      const opportunity = opportunityFromRow(row);
      const contact = contactFromRow(
        db.prepare("SELECT * FROM crm_contacts WHERE id=?").get(opportunity.contactId) as Row,
      );
      return { contact, opportunity, duplicate: true };
    }
    const fallback = db
      .prepare(
        "SELECT id FROM users WHERE disabled=0 AND EXISTS(SELECT 1 FROM json_each(users.roles) WHERE value='admin') ORDER BY created_at,id LIMIT 1",
      )
      .get();
    const ownerId = input.ownerId || str(fallback?.["id"]);
    if (!ownerId) throw new Error("Nenhum administrador ativo para receber o contato");
    validateAssignedOwner(ownerId);
    if (input.unitId) validateUnitId(input.unitId);
    const contact = createContactInternal(input, ownerId, input.unitId || null);
    const opportunity = createOpportunityInternal(contact, input, {
      kind: provider,
      id: externalId,
    });
    db.prepare(
      "INSERT INTO crm_lead_links(provider,external_id,opportunity_id,created_at) VALUES(?,?,?,?)",
    ).run(provider, externalId, opportunity.id, now());
    return { contact, opportunity, duplicate: false };
  });
}

export function getCrmBootstrap(actor: SiteUser): CrmBootstrap {
  actor = guard(actor);
  const db = ensureCrmSchema();
  const own = isAdmin(actor) ? "" : "WHERE owner_id=?";
  const args = isAdmin(actor) ? [] : [actor.id];
  const contacts = (
    db
      .prepare(`SELECT * FROM crm_contacts ${own} ORDER BY updated_at DESC,id LIMIT ${LIMIT}`)
      .all(...args) as Row[]
  ).map(contactFromRow);
  const opportunities = (
    db
      .prepare(`SELECT * FROM crm_opportunities ${own} ORDER BY updated_at DESC,id LIMIT ${LIMIT}`)
      .all(...args) as Row[]
  ).map(opportunityFromRow);
  const tasks = (
    db
      .prepare(
        `SELECT t.* FROM crm_tasks t JOIN crm_opportunities o ON o.id=t.opportunity_id ${isAdmin(actor) ? "" : "WHERE o.owner_id=?"} ORDER BY t.due,t.id LIMIT ${LIMIT}`,
      )
      .all(...args) as Row[]
  ).map(taskFromRow);
  const tasksDone = tasks
    .filter((t) => t.status === "done")
    .map((t) => ({ id: t.id, opportunityId: t.opportunityId, label: t.label, at: t.completedAt! }));
  const conversations = contacts.map((contact) => {
    const messages = listCrmMessages(actor, contact.id);
    const unread = Number(
      db
        .prepare(
          "SELECT count(*) n FROM crm_messages WHERE contact_id=? AND sender='cliente' AND read_at IS NULL",
        )
        .get(contact.id)?.["n"],
    );
    return {
      id: contact.id,
      contactId: contact.id,
      unread,
      messages,
      channel: messages.at(-1)?.channel || "whatsapp",
    };
  });
  const owners = db
    .prepare(
      `SELECT id,COALESCE(NULLIF(display_name,''),email) name FROM users WHERE disabled=0 AND EXISTS(SELECT 1 FROM json_each(users.roles) WHERE value IN ('admin','comercial')) ${isAdmin(actor) ? "" : "AND id=?"} ORDER BY name`,
    )
    .all(...args)
    .map((r) => ({ id: str(r["id"]), name: str(r["name"]) }));
  const count = (table: "crm_contacts" | "crm_opportunities") =>
    Number(db.prepare(`SELECT count(*) n FROM ${table} ${own}`).get(...args)?.["n"]);
  const counts = {
    contacts: count("crm_contacts"),
    opportunities: count("crm_opportunities"),
    unread: Number(
      db
        .prepare(
          `SELECT count(*) n FROM crm_messages m JOIN crm_contacts c ON c.id=m.contact_id WHERE m.sender='cliente' AND m.read_at IS NULL ${isAdmin(actor) ? "" : "AND c.owner_id=?"}`,
        )
        .get(...args)?.["n"],
    ),
    tasksPending: Number(
      db
        .prepare(
          `SELECT count(*) n FROM crm_tasks t JOIN crm_opportunities o ON o.id=t.opportunity_id WHERE t.status='pending' ${isAdmin(actor) ? "" : "AND o.owner_id=?"}`,
        )
        .get(...args)?.["n"],
    ),
  };
  return {
    contacts,
    opportunities,
    conversations,
    proposals: allProposals(actor),
    tasksDone,
    tasks,
    owners,
    units: listUnitsPublic().map((u) => ({ id: u.id, name: u.name })),
    canManage: isAdmin(actor),
    now: now(),
    siteLeads: siteLeads(actor),
    limits: {
      records: LIMIT,
      truncated: counts.contacts > LIMIT || counts.opportunities > LIMIT || tasks.length === LIMIT,
    },
    counts,
  };
}
export function getOpportunityDetail(actor: SiteUser, id: string) {
  actor = guard(actor);
  const opportunity = requireCrmOpportunity(actor, id);
  const contact = requireCrmContact(actor, opportunity.contactId);
  const activities = (
    getDb()
      .prepare(
        `SELECT a.*,COALESCE(NULLIF(u.display_name,''),u.email,'Sistema') actor_name FROM crm_activities a LEFT JOIN users u ON u.id=a.actor_id WHERE opportunity_id=? ORDER BY created_at DESC,id DESC LIMIT ${LIMIT}`,
      )
      .all(id) as Row[]
  ).map((r) => ({
    id: r["id"] as string,
    opportunityId: id,
    kind: r["kind"] as string,
    label: r["label"] as string,
    at: r["created_at"] as string,
    actorName: r["actor_name"] as string,
  }));
  const tasks = (
    getDb()
      .prepare(`SELECT * FROM crm_tasks WHERE opportunity_id=? ORDER BY due,id LIMIT ${LIMIT}`)
      .all(id) as Row[]
  ).map(taskFromRow);
  return {
    opportunity,
    contact,
    activities,
    tasks,
    proposals: allProposals(actor).filter((p) => p.opportunityId === id),
  };
}
