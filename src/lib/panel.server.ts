import { getDb } from "./local-db.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";
import { PANEL_ROLES } from "./roles.ts";
import { siteLeadScope } from "./site-leads.server.ts";

export type PanelResult = { title: string; subtitle: string; kind: string; href: string };
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** A busca usa as mesmas fronteiras de acesso das telas, inclusive o dono da negociação. */
export function searchPanelCore(actor: SiteUser, query: string): PanelResult[] {
  const user = requireActiveUser(actor, [...PANEL_ROLES]);
  const term = query.trim();
  if (term.length < 2 || term.length > 100) return [];
  const db = getDb();
  const needle = like(term);
  const out: PanelResult[] = [];
  if (user.roles.some((r) => r === "admin" || r === "comercial")) {
    const mine = !user.roles.includes("admin");
    if (
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_opportunities'")
        .get()
    ) {
      const opportunities = db
        .prepare(
          `SELECT o.id,o.title,c.name,c.id contact_id FROM crm_opportunities o JOIN crm_contacts c ON c.id=o.contact_id
        WHERE (o.title LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.company LIKE ? ESCAPE '\\') ${mine ? "AND o.owner_id=? AND c.owner_id=?" : ""}
        ORDER BY o.updated_at DESC LIMIT 5`,
        )
        .all(needle, needle, needle, ...(mine ? [user.id, user.id] : []));
      for (const opportunity of opportunities)
        out.push({
          title: String(opportunity["title"]),
          subtitle: String(opportunity["name"]),
          kind: "CRM",
          href: `/interno/crm/atendimento?c=${encodeURIComponent(String(opportunity["contact_id"]))}&o=${encodeURIComponent(String(opportunity["id"]))}`,
        });
    }
    const quotes = db
      .prepare(
        `SELECT id,number,customer_name,status FROM internal_quotes
      WHERE (customer_name LIKE ? ESCAPE '\\' OR number LIKE ? ESCAPE '\\') ${mine ? "AND owner_id=?" : ""}
      ORDER BY updated_at DESC LIMIT 5`,
      )
      .all(needle, needle, ...(mine ? [user.id] : []));
    for (const q of quotes)
      out.push({
        title: String(q["customer_name"] || "Cliente ainda não informado"),
        subtitle: `${q["number"]} · ${q["status"]}`,
        kind: "Negociação",
        href: `/interno/orcamentos-internos/${q["id"]}`,
      });
    for (const table of ["quote_requests", "contact_requests"] as const) {
      // Mesma regra de carteira do CRM: o que é meu + fila livre; nunca o de outro vendedor.
      const scope = siteLeadScope(user, table === "quote_requests" ? "quote" : "contact", "r");
      const rows = db
        .prepare(
          `SELECT r.id,r.protocolo,r.status,json_extract(r.data,'$.nome') name FROM ${table} r
        WHERE (json_extract(r.data,'$.nome') LIKE ? ESCAPE '\\' OR json_extract(r.data,'$.empresa') LIKE ? ESCAPE '\\' OR r.protocolo LIKE ? ESCAPE '\\')
        AND ${scope.clause} ORDER BY r.created_at DESC LIMIT 4`,
        )
        .all(needle, needle, needle, ...scope.params);
      for (const r of rows)
        out.push({
          title: String(r["name"] || r["protocolo"]),
          subtitle: `${r["protocolo"]} · ${r["status"]}`,
          kind: table === "quote_requests" ? "Solicitação" : "Contato",
          href: `/interno/${table === "quote_requests" ? "orcamentos" : "contatos"}/${r["id"]}`,
        });
    }
  }
  if (user.roles.some((r) => r === "admin" || r === "dho")) {
    const rows = db
      .prepare(
        `SELECT id,protocolo,status,json_extract(data,'$.nome') name FROM job_applications
      WHERE (json_extract(data,'$.nome') LIKE ? ESCAPE '\\' OR protocolo LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT 5`,
      )
      .all(needle, needle);
    for (const r of rows)
      out.push({
        title: String(r["name"] || r["protocolo"]),
        subtitle: `${r["protocolo"]} · ${r["status"]}`,
        kind: "Candidatura",
        href: `/interno/candidaturas/${r["id"]}`,
      });
  }
  return out;
}

export function panelProfileCore(actor: SiteUser) {
  const user = requireActiveUser(actor, [...PANEL_ROLES]);
  const row = getDb().prepare("SELECT display_name FROM users WHERE id=?").get(user.id);
  return {
    id: user.id,
    email: user.email,
    roles: user.roles,
    displayName: String(row?.["display_name"] || user.email.split("@")[0]),
  };
}

export function panelCountsCore(actor: SiteUser) {
  const user = requireActiveUser(actor, [...PANEL_ROLES]);
  if (!user.roles.some((r) => r === "admin" || r === "comercial")) return null;
  const mine = !user.roles.includes("admin");
  const rows = getDb()
    .prepare(
      `SELECT status,count(*) n FROM internal_quotes ${mine ? "WHERE owner_id=?" : ""} GROUP BY status`,
    )
    .all(...(mine ? [user.id] : []));
  const count = (status: string) => Number(rows.find((r) => r["status"] === status)?.["n"] ?? 0);
  const next = getDb()
    .prepare(
      `SELECT id,number,customer_name,status,
    total_cents-general_discount_cents+freight_cents+assembly_cents AS total_cents FROM internal_quotes
    WHERE status IN ('rascunho','salvo','enviado','aceito','erro_omie') ${mine ? "AND owner_id=?" : ""}
    ORDER BY CASE status WHEN 'erro_omie' THEN 0 WHEN 'aceito' THEN 1 WHEN 'rascunho' THEN 2 ELSE 3 END, updated_at DESC LIMIT 6`,
    )
    .all(...(mine ? [user.id] : []));
  return {
    sent: count("enviado"),
    accepted: count("aceito"),
    drafts: count("rascunho") + count("salvo"),
    next: next.map((r) => ({
      id: String(r["id"]),
      number: String(r["number"]),
      customer: String(r["customer_name"] || "Cliente ainda não informado"),
      status: String(r["status"]),
      totalCents: Number(r["total_cents"]),
    })),
  };
}
