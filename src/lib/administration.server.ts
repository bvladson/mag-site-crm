import { z } from "zod";
import { getDb } from "./local-db.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const value = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(value.getTime()) && value.toISOString().startsWith(s);
  }, "Data inválida");
export const auditFilter = z
  .object({
    page: z.number().int().min(1).max(100000).default(1),
    action: z
      .string()
      .max(80)
      .regex(/^[a-zA-Z0-9_:.-]*$/)
      .default(""),
    from: date.optional(),
    to: date.optional(),
  })
  .strict()
  .refine((s) => !s.from || !s.to || s.from <= s.to, "Período inválido");
const technicalKeys = new Set([
  "revision",
  "version",
  "versao",
  "items",
  "count",
  "duration_ms",
  "duracao_ms",
  "attempts",
  "bytes",
  "width",
  "height",
  "conferido",
  "enabled",
  "active",
  "page",
  "total",
  "skipped",
  "updated",
  "created",
  "success",
  "deleted",
]);
/** Old logs may contain arbitrary details. Expose only allowlisted numeric/boolean metadata. */
export function safeAuditDetails(raw: unknown): Record<string, number | boolean | null> {
  const output: Record<string, number | boolean | null> = {};
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || typeof value !== "object" || Array.isArray(value)) return output;
    for (const [k, v] of Object.entries(value))
      if (
        technicalKeys.has(k) &&
        (v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)))
      )
        output[k] = v;
  } catch {
    /* malformed legacy metadata is omitted */
  }
  return output;
}
const safeAction = (v: unknown) =>
  typeof v === "string" && /^[a-zA-Z][a-zA-Z0-9_.:-]{0,100}$/.test(v) ? v : "evento legado";
const safeIdentifier = (v: unknown) =>
  typeof v === "string" &&
  (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ||
    /^\d{1,7}$/.test(v) ||
    /^MAG-Q-\d{4}-\d{5,10}$/.test(v))
    ? v
    : null;
export function listAuditLog(actor: SiteUser | null, input: unknown) {
  requireActiveUser(actor, ["admin"]);
  const f = auditFilter.parse(input),
    where: string[] = [],
    params: string[] = [];
  if (f.action) {
    where.push("a.action LIKE ? ESCAPE '\\'");
    params.push(`${f.action.replace(/_/g, "\\_")}%`);
  }
  if (f.from) {
    where.push("a.created_at>=?");
    params.push(`${f.from}T03:00:00.000Z`);
  }
  if (f.to) {
    where.push("a.created_at<?");
    params.push(new Date(new Date(`${f.to}T03:00:00Z`).getTime() + 86400000).toISOString());
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number(
    getDb()
      .prepare(`SELECT count(*) AS n FROM audit_log a ${clause}`)
      .get(...params)?.["n"] ?? 0,
  );
  const rows = getDb()
    .prepare(
      `SELECT a.id,a.actor_id,a.action,a.target_id,a.created_at,a.details,u.display_name AS actor_name,u.email AS actor_email FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ${clause} ORDER BY a.id DESC LIMIT 50 OFFSET ?`,
    )
    .all(...params, (f.page - 1) * 50)
    .map((r) => ({
      id: Number(r["id"]),
      actorId: safeIdentifier(r["actor_id"]),
      actorLabel: String(
        r["actor_name"] || r["actor_email"] || (r["actor_id"] ? "Conta antiga" : "Sistema"),
      ),
      action: safeAction(r["action"]),
      targetId: safeIdentifier(r["target_id"]),
      createdAt: String(r["created_at"]),
      details: safeAuditDetails(r["details"]),
    }));
  return { rows, page: f.page, pages: Math.max(1, Math.ceil(total / 50)), total };
}
