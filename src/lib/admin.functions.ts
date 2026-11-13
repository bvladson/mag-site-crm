import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { APPLICATION_STAGES } from "./recruitment";
import { PANEL_ROLES } from "./roles";

/**
 * Painel interno sobre o banco próprio do site. Cada função confere sessão e papel no servidor
 * antes de ler ou gravar; o navegador nunca decide permissão.
 */
export type { Role } from "./roles";
import type { Role } from "./roles";
export const QUOTE_STATUS = ["novo", "em atendimento", "orçamento enviado", "ganho", "perdido"] as const;
export const CONTACT_STATUS = ["novo", "em atendimento", "finalizado"] as const;
/** Status internos de candidatura (nunca aparecem no site). Os antigos são convertidos no banco (local-db.server). */
export const APP_STATUS = APPLICATION_STAGES;

const COM: Role[] = ["admin", "comercial"];
const DHO: Role[] = ["admin", "dho"];
type Row = Record<string, any>;

async function guard(allowed?: Role[]) {
  const { authorize } = await import("./local-auth.server");
  return authorize(allowed);
}
const like = (s: string) => `%${s.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const field = (name: string) => `json_extract(data,'$.${name}')`;
const matchAny = (names: string[]) => `(${names.map((n) => `${n.startsWith("protocolo") ? n : field(n)} LIKE ? ESCAPE '\\'`).join(" OR ")})`;
/** Datas do filtro são dias de Fortaleza (UTC−3, sem horário de verão). */
const dayStart = (day: string) => new Date(`${day}T00:00:00-03:00`).toISOString();
const dayEnd = (day: string) => new Date(new Date(`${day}T00:00:00-03:00`).getTime() + 86400000).toISOString();
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const user = await guard();
  const { panelProfileCore } = await import("./panel.server");
  return panelProfileCore(user);
});

export const getDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const user = await guard();
  const { getDb, decodeLead } = await import("./local-db.server");
  const db = getDb();
  const can = (a: Role[]) => user.roles.some((r) => a.includes(r));
  const count = (sql: string) => Number(db.prepare(sql).get()?.["n"] ?? 0);
  const latest = (table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY created_at DESC LIMIT 5`).all().map(decodeLead);
  const out: {
    roles: Role[]; quotesNew?: number; contactsNew?: number; appsNew?: number; talentNew?: number;
    lastQuotes?: { id: string; created_at: string; nome: string; empresa: string | null; status: string }[];
    lastContacts?: { id: string; created_at: string; nome: string; assunto: string; status: string }[];
    lastApps?: { id: string; created_at: string; nome: string; job_title: string | null; area_interesse: string | null; status: string }[];
  } = { roles: user.roles };
  if (can(COM)) {
    out.quotesNew = count("SELECT count(*) AS n FROM quote_requests WHERE status='novo'");
    out.contactsNew = count("SELECT count(*) AS n FROM contact_requests WHERE status='novo'");
    out.lastQuotes = latest("quote_requests").map((r) => ({ id: r["id"], created_at: r["created_at"], nome: r["nome"], empresa: r["empresa"] ?? null, status: r["status"] }));
    out.lastContacts = latest("contact_requests").map((r) => ({ id: r["id"], created_at: r["created_at"], nome: r["nome"], assunto: r["assunto"], status: r["status"] }));
  }
  if (can(DHO)) {
    out.appsNew = count(`SELECT count(*) AS n FROM job_applications WHERE status='novo' AND ${field("job_slug")} IS NOT NULL`);
    out.talentNew = count(`SELECT count(*) AS n FROM job_applications WHERE status='novo' AND ${field("job_slug")} IS NULL`);
    out.lastApps = latest("job_applications").map((r) => ({ id: r["id"], created_at: r["created_at"], nome: r["nome"], job_title: r["job_title"] ?? null, area_interesse: r["area_interesse"] ?? null, status: r["status"] }));
  }
  return out;
});

const listFilter = z.object({ status: z.string().max(40).optional(), q: z.string().max(100).optional() });

// ---------- Orçamentos ----------
export const listQuotes = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listFilter.parse(d))
  .handler(async ({ data }) => {
    await guard(COM);
    const { getDb, decodeLead } = await import("./local-db.server");
    const where: string[] = []; const params: string[] = [];
    if (data.status) { where.push("status=?"); params.push(data.status); }
    if (data.q?.trim()) { where.push(matchAny(["nome", "empresa", "whatsapp", "email", "protocolo"])); params.push(...Array(4).fill(like(data.q)), like(data.q.toUpperCase())); }
    const rows = getDb().prepare(`SELECT q.*, (SELECT COALESCE(SUM(qty),0) FROM quote_request_items i WHERE i.quote_request_id=q.id) AS itemCount
      FROM quote_requests q ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 300`).all(...params);
    return rows.map(decodeLead).map((r) => ({
      id: r["id"] as string, protocolo: r["protocolo"] as string, created_at: r["created_at"] as string, nome: r["nome"] as string,
      empresa: (r["empresa"] ?? null) as string | null, cidade: r["cidade"] as string, estado: r["estado"] as string,
      origem: (r["origem"] ?? null) as string | null, status: r["status"] as string, itemCount: Number(r["itemCount"]),
    }));
  });

export const getQuote = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await guard(COM);
    const { getDb, readLead } = await import("./local-db.server");
    const row = readLead("quote_requests", data.id);
    row["quote_request_items"] = getDb().prepare("SELECT id,slug,sku,name,qty FROM quote_request_items WHERE quote_request_id=? ORDER BY rowid").all(data.id);
    return row as Row;
  });

const updateSchema = (statuses: readonly string[]) =>
  z.object({ id: z.string().uuid(), status: z.enum(statuses as [string, ...string[]]), internal_notes: z.string().max(5000).optional() });

export const updateQuote = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateSchema(QUOTE_STATUS).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { updateLead } = await import("./local-db.server");
    return updateLead("quote_requests", data.id, data.status, data.internal_notes ?? null, user.id);
  });

// ---------- Contatos ----------
export const listContacts = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listFilter.parse(d))
  .handler(async ({ data }) => {
    await guard(COM);
    const { getDb, decodeLead } = await import("./local-db.server");
    const where: string[] = []; const params: string[] = [];
    if (data.status) { where.push("status=?"); params.push(data.status); }
    if (data.q?.trim()) { where.push(matchAny(["nome", "empresa", "email", "whatsapp", "protocolo"])); params.push(...Array(4).fill(like(data.q)), like(data.q.toUpperCase())); }
    const rows = getDb().prepare(`SELECT * FROM contact_requests ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 300`).all(...params);
    return rows.map(decodeLead).map((r) => ({
      id: r["id"] as string, protocolo: r["protocolo"] as string, created_at: r["created_at"] as string, nome: r["nome"] as string,
      empresa: (r["empresa"] ?? null) as string | null, assunto: r["assunto"] as string, whatsapp: r["whatsapp"] as string,
      email: r["email"] as string, status: r["status"] as string,
    }));
  });

export const getContact = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await guard(COM);
    const { readLead } = await import("./local-db.server");
    return readLead("contact_requests", data.id) as Row;
  });

export const updateContact = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateSchema(CONTACT_STATUS).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { updateLead } = await import("./local-db.server");
    return updateLead("contact_requests", data.id, data.status, data.internal_notes ?? null, user.id);
  });

// ---------- Candidaturas ----------
export const listApplications = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({
      tab: z.enum(["vagas", "banco"]), status: z.string().max(40).optional(), area: z.string().max(80).optional(),
      cidade: z.string().max(80).optional(), nome: z.string().max(100).optional(), job_id: z.string().uuid().optional(),
      from: isoDay.optional(), to: isoDay.optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard(DHO);
    const { getDb, decodeLead } = await import("./local-db.server");
    // Banco de talentos = cadastro espontâneo + quem se candidatou a uma vaga e pediu para ficar no banco
    // + quem o DHO moveu para o status "banco de talentos". A aba Vagas mostra todas as candidaturas a vagas.
    const where = [data.tab === "banco"
      ? `(${field("job_slug")} IS NULL OR ${field("talent_bank")}=1 OR status='banco de talentos')`
      : `${field("job_slug")} IS NOT NULL`];
    const params: string[] = [];
    if (data.status) { where.push("status=?"); params.push(data.status); }
    if (data.area?.trim()) {
      where.push(`(${field("area_interesse")} LIKE ? ESCAPE '\\' OR ${field("job_title")} LIKE ? ESCAPE '\\')`);
      params.push(like(data.area), like(data.area));
    }
    if (data.cidade?.trim()) { where.push(`${field("cidade")} LIKE ? ESCAPE '\\'`); params.push(like(data.cidade)); }
    if (data.nome?.trim()) { where.push(`${field("nome")} LIKE ? ESCAPE '\\'`); params.push(like(data.nome)); }
    if (data.job_id) { where.push(`${field("job_id")}=?`); params.push(data.job_id); }
    if (data.from) { where.push("created_at>=?"); params.push(dayStart(data.from)); }
    if (data.to) { where.push("created_at<?"); params.push(dayEnd(data.to)); }
    const rows = getDb().prepare(`SELECT * FROM job_applications WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 300`).all(...params);
    const { retentionPolicy, expiresAt, purposeOf } = await import("./retention");
    const policy = retentionPolicy();
    return rows.map(decodeLead).map((r) => ({
      id: r["id"] as string, protocolo: r["protocolo"] as string, created_at: r["created_at"] as string, nome: r["nome"] as string,
      email: r["email"] as string, whatsapp: r["whatsapp"] as string, cidade: (r["cidade"] ?? null) as string | null,
      area_interesse: (r["area_interesse"] ?? null) as string | null, job_title: (r["job_title"] ?? null) as string | null, status: r["status"] as string,
      talent_bank: Boolean(r["talent_bank"]), purpose: purposeOf(r),
      // Previsão pela política de retenção (null enquanto RECRUITMENT_RETENTION_MONTHS não for definido). Nada é apagado.
      expires_at: expiresAt({ created_at: r["created_at"] as string, job_slug: r["job_slug"], talent_bank: r["talent_bank"] }, policy),
    }));
  });

export const getApplication = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await guard(DHO);
    const { readLead } = await import("./local-db.server");
    const row = readLead("job_applications", data.id);
    row["resume_path"] = row["resume_path"] ? "privado" : null; // o caminho interno não sai do servidor
    const { retentionPolicy, expiresAt, purposeOf, purposeLabel } = await import("./retention");
    const policy = retentionPolicy();
    const purpose = purposeOf(row);
    row["retention"] = {
      purpose, purpose_label: purposeLabel[purpose], talent_bank: purpose !== "vaga",
      months: purpose === "vaga" ? policy.jobMonths : policy.bankMonths,
      expires_at: expiresAt({ created_at: row["created_at"], job_slug: row["job_slug"], talent_bank: row["talent_bank"] }, policy),
    };
    return row as Row;
  });

export const updateApplication = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateSchema(APP_STATUS).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(DHO);
    const { updateLead } = await import("./local-db.server");
    return updateLead("job_applications", data.id, data.status, data.internal_notes ?? null, user.id);
  });

/** O arquivo é entregue por /api/interno/curriculo/:id, que confere a sessão de novo a cada download. */
export const getResumeUrl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await guard(DHO);
    const { readLead } = await import("./local-db.server");
    if (!readLead("job_applications", data.id)["resume_path"]) throw new Error("Currículo não encontrado");
    return { url: `/api/interno/curriculo/${data.id}` };
  });

// ---------- Usuários (admin) ----------
const roleSchema = z.enum(PANEL_ROLES);

export const listUsers = createServerFn({ method: "GET" }).handler(async () => {
  await guard(["admin"]);
  const { listLocalUsers } = await import("./local-auth-core.server");
  return listLocalUsers();
});

export const setUserRole = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid(), role: roleSchema, enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(["admin"]);
    const { changeRole } = await import("./local-auth-core.server");
    return changeRole(user, data.userId, data.role, data.enabled);
  });

export const createPanelUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ email: z.string().trim().email().max(255), password: z.string().min(12).max(256), roles: z.array(roleSchema).min(1).max(4) }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(["admin"]);
    const { createUser } = await import("./local-auth-core.server");
    await createUser(data.email, data.password, data.roles, user.id);
    return { ok: true };
  });

export const resetUserPassword = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid(), password: z.string().min(12).max(256) }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(["admin"]);
    const { resetPassword } = await import("./local-auth-core.server");
    await resetPassword(user, data.userId, data.password);
    return { ok: true };
  });

export const disablePanelUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(["admin"]);
    const { disableUser } = await import("./local-auth-core.server");
    disableUser(user, data.userId);
    return { ok: true };
  });

export const reactivatePanelUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(["admin"]);
    const { reactivateUser } = await import("./local-auth-core.server");
    return reactivateUser(user, data.userId);
  });
