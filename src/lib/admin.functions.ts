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
    // Mesma regra de carteira do CRM: o vendedor só vê o que é seu e a fila livre (site-leads.server).
    const { siteLeadsDashboard } = await import("./site-leads.server");
    Object.assign(out, siteLeadsDashboard(user));
  }
  if (can(DHO)) {
    out.appsNew = count(`SELECT count(*) AS n FROM job_applications WHERE status='novo' AND ${field("job_slug")} IS NOT NULL`);
    out.talentNew = count(`SELECT count(*) AS n FROM job_applications WHERE status='novo' AND ${field("job_slug")} IS NULL`);
    out.lastApps = latest("job_applications").map((r) => ({ id: r["id"], created_at: r["created_at"], nome: r["nome"], job_title: r["job_title"] ?? null, area_interesse: r["area_interesse"] ?? null, status: r["status"] }));
  }
  return out;
});

const listFilter = z.object({ status: z.string().max(40).optional(), q: z.string().max(100).optional() });

// ---------- Orçamentos e contatos do site (carteira conferida em site-leads.server) ----------
export const listQuotes = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listFilter.parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { listSiteQuotes } = await import("./site-leads.server");
    return listSiteQuotes(user, data);
  });

export const getQuote = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { readSiteQuote } = await import("./site-leads.server");
    return readSiteQuote(user, data.id) as Row;
  });

const updateSchema = (statuses: readonly string[]) =>
  z.object({ id: z.string().uuid(), status: z.enum(statuses as [string, ...string[]]), internal_notes: z.string().max(5000).optional() });

export const updateQuote = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateSchema(QUOTE_STATUS).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { updateSiteLead } = await import("./site-leads.server");
    return updateSiteLead(user, "quote", data);
  });

export const listContacts = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listFilter.parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { listSiteContacts } = await import("./site-leads.server");
    return listSiteContacts(user, data);
  });

export const getContact = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { readSiteContact } = await import("./site-leads.server");
    return readSiteContact(user, data.id) as Row;
  });

export const updateContact = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateSchema(CONTACT_STATUS).parse(d))
  .handler(async ({ data }) => {
    const user = await guard(COM);
    const { updateSiteLead } = await import("./site-leads.server");
    return updateSiteLead(user, "contact", data);
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
