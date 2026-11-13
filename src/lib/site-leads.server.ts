/**
 * Solicitações do site (pedidos de orçamento e contatos) no painel, com a MESMA regra de carteira do CRM.
 *
 * - Administrador vê tudo, inclusive a TRIAGEM: o que ainda não tem responsável (decisão D1 da MAG, 13/11/2026 —
 *   distribuição automática por unidade/rodízio; o que sobrar fica com o administrador para distribuir).
 * - Comercial vê só o que é seu: atribuído a ele, convertido numa negociação dele ou trazido para uma oportunidade dele
 *   no CRM. Nunca o de outro vendedor nem o que está na triagem — nem pela lista, nem pela busca, nem pelo resumo do
 *   painel, nem abrindo ou alterando pelo ID.
 *
 * Usado pelas páginas Orçamentos do site, Contatos e Leads, pela busca geral e pelo resumo do painel. A conversão em
 * negociação (criarOrcamento) e a importação no CRM (importSiteLead) seguem a mesma regra.
 */
import { decodeLead, getDb, readLead, updateLead } from "./local-db.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";

export type SiteLeadKind = "quote" | "contact";
export const SITE_LEAD_TABLE = { quote: "quote_requests", contact: "contact_requests" } as const;
type Row = Record<string, unknown>;

const isAdmin = (user: SiteUser) => user.roles.includes("admin");
const hasTable = (name: string) =>
  Boolean(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const commercial = (actor: SiteUser | null) => requireActiveUser(actor, ["admin", "comercial"]);

/**
 * Cláusula SQL de visibilidade sobre o alias da tabela de solicitações. Para quem não é administrador: só o que está
 * ligado a ele — atribuição, negociação criada a partir dela ou oportunidade do CRM trazida dela. Tabelas que ainda não
 * existem (bancos antigos) simplesmente não entram na regra; sem nenhuma, o vendedor não vê nada (triagem).
 */
export function siteLeadScope(actor: SiteUser, kind: SiteLeadKind, alias: string): { clause: string; params: string[] } {
  if (isAdmin(actor)) return { clause: "1=1", params: [] };
  const mine: string[] = [];
  if (kind === "quote") {
    if (hasTable("lead_assignments"))
      mine.push(`EXISTS(SELECT 1 FROM lead_assignments sa WHERE sa.lead_id=${alias}.id AND sa.owner_id=?)`);
    mine.push(`EXISTS(SELECT 1 FROM internal_quotes sn WHERE sn.source_request_id=${alias}.id AND sn.owner_id=?)`);
  }
  if (hasTable("crm_lead_links") && hasTable("crm_opportunities")) {
    const provider = kind === "quote" ? "site:quote" : "site:contact";
    mine.push(`EXISTS(SELECT 1 FROM crm_lead_links sl JOIN crm_opportunities so ON so.id=sl.opportunity_id WHERE sl.provider='${provider}' AND sl.external_id=${alias}.id AND so.owner_id=?)`);
  }
  if (!mine.length) return { clause: "0=1", params: [] };
  return { clause: `(${mine.join(" OR ")})`, params: mine.map(() => actor.id) };
}

/** Confere sessão, perfil e carteira de uma solicitação; devolve o usuário conferido. */
export function requireSiteLead(actor: SiteUser | null, kind: SiteLeadKind, id: string) {
  const user = commercial(actor);
  const table = SITE_LEAD_TABLE[kind];
  if (!getDb().prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id)) throw new Error("Registro não encontrado");
  const scope = siteLeadScope(user, kind, "r");
  if (!getDb().prepare(`SELECT 1 FROM ${table} r WHERE r.id=? AND ${scope.clause}`).get(id, ...scope.params))
    throw new Error("Forbidden: esta solicitação é de outra carteira ou está na triagem do administrador");
  return user;
}

const like = (s: string) => `%${s.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const field = (name: string) => `json_extract(r.data,'$.${name}')`;
function searchClause(names: string[], term: string) {
  const sql = `(${names.map((n) => `${n === "protocolo" ? "r.protocolo" : field(n)} LIKE ? ESCAPE '\\'`).join(" OR ")})`;
  return { sql, params: names.map((n) => (n === "protocolo" ? like(term.toUpperCase()) : like(term))) };
}
type Filter = { status?: string | undefined; q?: string | undefined };
function scopedRows(actor: SiteUser | null, kind: SiteLeadKind, filter: Filter, names: string[], extraColumns = "") {
  const user = commercial(actor);
  const scope = siteLeadScope(user, kind, "r");
  const where = [scope.clause];
  const params: string[] = [...scope.params];
  if (filter.status) {
    where.push("r.status=?");
    params.push(filter.status);
  }
  if (filter.q?.trim()) {
    const search = searchClause(names, filter.q);
    where.push(search.sql);
    params.push(...search.params);
  }
  return getDb()
    .prepare(`SELECT r.*${extraColumns} FROM ${SITE_LEAD_TABLE[kind]} r WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC LIMIT 300`)
    .all(...params)
    .map((row) => decodeLead(row as Record<string, string>));
}

export function listSiteQuotes(actor: SiteUser | null, filter: Filter = {}) {
  return scopedRows(actor, "quote", filter, ["nome", "empresa", "whatsapp", "email", "protocolo"],
    ",(SELECT COALESCE(SUM(qty),0) FROM quote_request_items i WHERE i.quote_request_id=r.id) AS itemCount").map((r: Row) => ({
    id: r["id"] as string, protocolo: r["protocolo"] as string, created_at: r["created_at"] as string, nome: r["nome"] as string,
    empresa: (r["empresa"] ?? null) as string | null, cidade: r["cidade"] as string, estado: r["estado"] as string,
    origem: (r["origem"] ?? null) as string | null, status: r["status"] as string, itemCount: Number(r["itemCount"]),
  }));
}
export function listSiteContacts(actor: SiteUser | null, filter: Filter = {}) {
  return scopedRows(actor, "contact", filter, ["nome", "empresa", "email", "whatsapp", "protocolo"]).map((r: Row) => ({
    id: r["id"] as string, protocolo: r["protocolo"] as string, created_at: r["created_at"] as string, nome: r["nome"] as string,
    empresa: (r["empresa"] ?? null) as string | null, assunto: r["assunto"] as string, whatsapp: r["whatsapp"] as string,
    email: r["email"] as string, status: r["status"] as string,
  }));
}
export function readSiteQuote(actor: SiteUser | null, id: string) {
  requireSiteLead(actor, "quote", id);
  const row = readLead("quote_requests", id);
  row["quote_request_items"] = getDb()
    .prepare("SELECT id,slug,sku,name,qty FROM quote_request_items WHERE quote_request_id=? ORDER BY rowid")
    .all(id) as never;
  return row;
}
export function readSiteContact(actor: SiteUser | null, id: string) {
  requireSiteLead(actor, "contact", id);
  return readLead("contact_requests", id);
}
export function updateSiteLead(
  actor: SiteUser | null,
  kind: SiteLeadKind,
  input: { id: string; status: string; internal_notes?: string | undefined },
) {
  const user = requireSiteLead(actor, kind, input.id);
  return updateLead(SITE_LEAD_TABLE[kind], input.id, input.status, input.internal_notes ?? null, user.id);
}

/** Bloco comercial do resumo do painel (novos e últimos 5), dentro da carteira de quem pede. */
export function siteLeadsDashboard(actor: SiteUser | null) {
  const user = commercial(actor);
  const db = getDb();
  const out = {} as {
    quotesNew: number; contactsNew: number;
    lastQuotes: { id: string; created_at: string; nome: string; empresa: string | null; status: string }[];
    lastContacts: { id: string; created_at: string; nome: string; assunto: string; status: string }[];
  };
  for (const kind of ["quote", "contact"] as const) {
    const scope = siteLeadScope(user, kind, "r");
    const table = SITE_LEAD_TABLE[kind];
    const count = Number(
      (db.prepare(`SELECT count(*) AS n FROM ${table} r WHERE r.status='novo' AND ${scope.clause}`).get(...scope.params) as Row | undefined)?.["n"] ?? 0,
    );
    const latest = db
      .prepare(`SELECT r.* FROM ${table} r WHERE ${scope.clause} ORDER BY r.created_at DESC LIMIT 5`)
      .all(...scope.params)
      .map((row) => decodeLead(row as Record<string, string>));
    if (kind === "quote") {
      out.quotesNew = count;
      out.lastQuotes = latest.map((r: Row) => ({ id: String(r["id"]), created_at: String(r["created_at"]), nome: String(r["nome"] ?? ""), empresa: (r["empresa"] ?? null) as string | null, status: String(r["status"]) }));
    } else {
      out.contactsNew = count;
      out.lastContacts = latest.map((r: Row) => ({ id: String(r["id"]), created_at: String(r["created_at"]), nome: String(r["nome"] ?? ""), assunto: String(r["assunto"] ?? ""), status: String(r["status"]) }));
    }
  }
  return out;
}
