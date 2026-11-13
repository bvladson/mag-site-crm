import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDb } from "./local-db.server.ts";
import { requireRoles, type SiteUser, type Role } from "./local-auth-core.server.ts";
import { assignmentsSchema } from "./assignments.server.ts";
import { readPublicLinkTree, readLinkTreeAdmin } from "./links.server.ts";

const initialized = new WeakSet<object>();
const signingKey = randomBytes(32);
const limits = new Map<string, { count: number; until: number }>();
export function linkMetricsSchema() {
  const db = getDb();
  if (!initialized.has(db)) {
    db.exec(`CREATE TABLE IF NOT EXISTS link_metrics_daily (
      day TEXT NOT NULL, target_type TEXT NOT NULL CHECK(target_type IN ('page','item','campaign')),
      target_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('click','view')),
      count INTEGER NOT NULL DEFAULT 0 CHECK(count>=0), PRIMARY KEY(day,target_type,target_id,action)
    );`);
    initialized.add(db);
  }
  return db;
}
function role(actor: SiteUser | null, allowed: ("admin" | "comercial")[]) {
  const user = requireRoles(actor, allowed);
  const row = getDb().prepare("SELECT roles FROM users WHERE id=? AND disabled=0").get(user.id);
  const roles = row ? (JSON.parse(String(row["roles"])) as Role[]) : [];
  if (!roles.some((value) => allowed.includes(value as "admin" | "comercial")))
    throw new Error("Forbidden: sem permissão para métricas");
  return { ...user, roles };
}
export function metricsToken(version: number, now = Date.now()): string {
  const body = `${version}.${Math.floor(now / 1000) + 7200}`;
  return `${body}.${createHmac("sha256", signingKey).update(body).digest("base64url")}`;
}
function validToken(token: string, version: number, now: number): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || !/^\d+$/.test(parts[0]!) || !/^\d+$/.test(parts[1]!)) return false;
  if (!/^[A-Za-z0-9_-]{43}$/.test(parts[2]!)) return false;
  if (
    Number(parts[0]) !== version ||
    Number(parts[1]) < now / 1000 ||
    Number(parts[1]) > now / 1000 + 7300
  )
    return false;
  const expected = createHmac("sha256", signingKey)
    .update(`${parts[0]}.${parts[1]}`)
    .digest("base64url");
  return (
    parts[2]!.length === expected.length &&
    timingSafeEqual(Buffer.from(parts[2]!), Buffer.from(expected))
  );
}
export const linkEventSchema = z
  .object({
    token: z.string().max(180),
    targetType: z.enum(["page", "item", "campaign"]),
    targetId: z.string().uuid().nullable(),
    action: z.enum(["view", "click"]),
  })
  .strict();

/** The transient key is HMACed in memory only; no IP, cookie, agent, URL or visitor identifier is persisted. */
function permit(source: string, event: z.infer<typeof linkEventSchema>, now: number) {
  if (limits.size > 10000)
    for (const [key, value] of limits) if (value.until < now) limits.delete(key);
  if (limits.size > 10000) return false;
  const sourceKey = createHmac("sha256", signingKey).update(source).digest("hex");
  const keys = [
    { key: `rate:${sourceKey}`, max: 90, span: 60_000 },
    {
      key: `target:${sourceKey}:${event.targetType}:${event.targetId ?? "page"}:${event.action}`,
      max: event.action === "view" ? 1 : 10,
      span: 60_000,
    },
  ];
  for (const spec of keys) {
    const value = limits.get(spec.key);
    if (value && value.until > now && value.count >= spec.max) return false;
  }
  for (const spec of keys) {
    const value = limits.get(spec.key);
    limits.set(
      spec.key,
      !value || value.until <= now
        ? { count: 1, until: now + spec.span }
        : { count: value.count + 1, until: value.until },
    );
  }
  return true;
}
export function recordLinkEvent(input: unknown, source: string, at: Date = new Date()): boolean {
  const parsed = linkEventSchema.safeParse(input);
  if (!parsed.success) return false;
  const event = parsed.data;
  const publication = readPublicLinkTree(at);
  if (!publication || !validToken(event.token, publication.version, at.getTime())) return false;
  if (event.targetType === "page") {
    if (event.targetId !== null || event.action !== "view") return false;
  } else {
    const target =
      event.targetType === "item"
        ? publication.content.items.find(
            (item) => item.id === event.targetId && item.type !== "heading",
          )
        : publication.content.campaigns.find((item) => item.id === event.targetId);
    if (!target || (event.targetType === "item" && event.action !== "click")) return false;
  }
  if (!permit(source.slice(0, 256), event, at.getTime())) return false;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  linkMetricsSchema()
    .prepare(
      `INSERT INTO link_metrics_daily(day,target_type,target_id,action,count) VALUES (?,?,?,?,1)
    ON CONFLICT(day,target_type,target_id,action) DO UPDATE SET count=count+1`,
    )
    .run(day, event.targetType, event.targetId ?? "page", event.action);
  return true;
}
export function readMarketingMetrics(actor: SiteUser | null, days = 30, at = new Date()) {
  const user = role(actor, ["admin"]);
  z.union([z.literal(30), z.literal(90)]).parse(days);
  const from = new Date(at.getTime() - (days - 1) * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "America/Fortaleza",
  });
  const to = at.toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
  const rows = linkMetricsSchema()
    .prepare(
      `SELECT target_type,target_id,action,sum(count) AS count FROM link_metrics_daily WHERE day>=? AND day<=? GROUP BY target_type,target_id,action ORDER BY count DESC`,
    )
    .all(from, to);
  const draft = readLinkTreeAdmin(user).draft.content;
  const campaignHistory = new Map<
    string,
    { id: string; slug: string; name: string; channel: string }
  >();
  const history = getDb()
    .prepare("SELECT content FROM link_tree_publications ORDER BY version DESC LIMIT 100")
    .all()
    .reverse();
  for (const row of history)
    for (const campaign of (
      JSON.parse(String(row["content"])) as {
        campaigns?: { id: string; slug: string; name: string; channel: string }[];
      }
    ).campaigns ?? [])
      campaignHistory.set(campaign.id, campaign);
  for (const campaign of draft.campaigns) campaignHistory.set(campaign.id, campaign);
  const entries = rows.map((row) => ({
    type: String(row["target_type"]),
    id: String(row["target_id"]),
    action: String(row["action"]),
    count: Number(row["count"]),
    title:
      row["target_type"] === "page"
        ? "Página de links"
        : row["target_type"] === "campaign"
          ? (campaignHistory.get(String(row["target_id"]))?.name ?? "Campanha arquivada")
          : (draft.items.find((item) => item.id === row["target_id"])?.title ?? "Link arquivado"),
  }));
  const campaigns = Array.from(campaignHistory.values()).map((campaign) => {
    const matching = entries.filter(
      (entry) => entry.type === "campaign" && entry.id === campaign.id,
    );
    const start = new Date(`${from}T00:00:00-03:00`).toISOString();
    const count = (table: "quote_requests" | "contact_requests") =>
      Number(
        getDb()
          .prepare(
            `SELECT count(*) AS n FROM ${table} WHERE created_at>=? AND created_at<=? AND json_extract(data,'$.utm.utm_campaign')=?`,
          )
          .get(start, at.toISOString(), campaign.slug)?.["n"] ?? 0,
      );
    return {
      id: campaign.id,
      slug: campaign.slug,
      name: campaign.name,
      channel: campaign.channel,
      archived: !draft.campaigns.some((item) => item.id === campaign.id),
      views: matching
        .filter((entry) => entry.action === "view")
        .reduce((n, entry) => n + entry.count, 0),
      clicks: matching
        .filter((entry) => entry.action === "click")
        .reduce((n, entry) => n + entry.count, 0),
      quoteRequests: count("quote_requests"),
      contacts: count("contact_requests"),
    };
  });
  return {
    from,
    to,
    days,
    pageViews: entries
      .filter((item) => item.type === "page")
      .reduce((n, item) => n + item.count, 0),
    clicks: entries
      .filter((item) => item.action === "click")
      .reduce((n, item) => n + item.count, 0),
    bannerViews: entries
      .filter((item) => item.type === "campaign" && item.action === "view")
      .reduce((n, item) => n + item.count, 0),
    entries,
    campaigns,
  };
}
export function readCommercialMetrics(actor: SiteUser | null, days = 30, at = new Date()) {
  const user = role(actor, ["admin", "comercial"]);
  z.union([z.literal(30), z.literal(90)]).parse(days);
  const isAdmin = user.roles.includes("admin");
  const from = new Date(at.getTime() - days * 86_400_000).toISOString();
  const db = getDb();
  assignmentsSchema();
  const scope = isAdmin ? "" : " AND owner_id=?";
  const params = isAdmin ? [from, at.toISOString()] : [from, at.toISOString(), user.id];
  const row = db
    .prepare(
      `SELECT count(*) AS negotiations,
    sum(CASE WHEN status IN ('enviado','aceito','enviado_omie') THEN 1 ELSE 0 END) AS sent,
    sum(CASE WHEN status IN ('aceito','enviado_omie') THEN 1 ELSE 0 END) AS accepted,
    sum(CASE WHEN status IN ('aceito','enviado_omie') THEN max(0,total_cents+freight_cents+assembly_cents-general_discount_cents) ELSE 0 END) AS accepted_value
    FROM internal_quotes WHERE created_at>=? AND created_at<=?${scope}`,
    )
    .get(...params)!;
  const lead = isAdmin
    ? db
        .prepare("SELECT count(*) AS n FROM quote_requests WHERE created_at>=? AND created_at<=?")
        .get(from, at.toISOString())
    : db
        .prepare(
          `SELECT count(*) AS n FROM quote_requests r LEFT JOIN lead_assignments a ON a.lead_id=r.id
      WHERE r.created_at>=? AND r.created_at<=? AND (a.owner_id=? OR (a.owner_id IS NULL AND EXISTS(SELECT 1 FROM internal_quotes q WHERE q.source_request_id=r.id AND q.owner_id=?)))`,
        )
        .get(from, at.toISOString(), user.id, user.id);
  const proposal = db
    .prepare(
      `SELECT count(DISTINCT q.id) AS n FROM internal_quotes q JOIN quote_proposals p ON p.quote_id=q.id WHERE q.created_at>=? AND q.created_at<=?${isAdmin ? "" : " AND q.owner_id=?"}`,
    )
    .get(...params);
  return {
    days,
    scope: isAdmin ? "equipe" : "pessoal",
    leads: Number(lead?.["n"] ?? 0),
    negotiations: Number(row["negotiations"] ?? 0),
    proposals: Number(proposal?.["n"] ?? 0),
    sent: Number(row["sent"] ?? 0),
    accepted: Number(row["accepted"] ?? 0),
    acceptedValueCents: Number(row["accepted_value"] ?? 0),
  };
}
