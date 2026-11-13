import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, audit, transaction } from "./local-db.server.ts";
import { hashPassword, requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";
import { PANEL_ROLES } from "./roles.ts";

const initialized = new WeakSet<object>();
type Row = Record<string, any>;
export const invitationToken = z.string().regex(/^[a-f0-9]{64}$/, "Convite inválido ou expirado");
const roles = z
  .array(z.enum(PANEL_ROLES))
  .min(1)
  .max(4)
  .transform((r) => [...new Set(r)]);
export const createInvitationSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(255)
      .transform((s) => s.toLowerCase()),
    roles,
  })
  .strict();
export const acceptInvitationSchema = z
  .object({
    token: invitationToken,
    password: z.string().min(12).max(256),
    name: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .refine((s) => !/[<>\u0000-\u001f\u007f]/.test(s), "Nome inválido"),
  })
  .strict();
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const invalid = () =>
  new Error("Convite inválido, revogado ou expirado. Solicite um novo link ao administrador.");
function schema() {
  const db = getDb();
  if (!initialized.has(db)) {
    db.exec(`CREATE TABLE IF NOT EXISTS site_invitations (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL COLLATE NOCASE,
      roles TEXT NOT NULL CHECK(json_valid(roles)), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id), revoked_at INTEGER, revoked_by TEXT,
      accepted_at INTEGER, accepted_by TEXT REFERENCES users(id)
    ); CREATE INDEX IF NOT EXISTS site_invitations_email ON site_invitations(email,expires_at);`);
    initialized.add(db);
  }
  return db;
}
function creatorActive(value: Row) {
  try {
    requireActiveUser({ id: String(value["created_by"]), email: "", roles: [], created_at: "" }, [
      "admin",
    ]);
    return true;
  } catch {
    return false;
  }
}
function pending(token: string, now: number) {
  invitationToken.parse(token);
  const value = schema()
    .prepare("SELECT * FROM site_invitations WHERE token_hash=?")
    .get(digest(token)) as Row | undefined;
  if (
    !value ||
    value["accepted_at"] ||
    value["revoked_at"] ||
    Number(value["expires_at"]) <= now ||
    !creatorActive(value)
  )
    throw invalid();
  return value;
}
export function createInvitation(actor: SiteUser | null, input: unknown, now = Date.now()) {
  const user = requireActiveUser(actor, ["admin"]),
    data = createInvitationSchema.parse(input);
  schema();
  const token = randomBytes(32).toString("hex"),
    id = randomUUID(),
    expiresAt = now + 72 * 60 * 60_000;
  transaction(() => {
    requireActiveUser(user, ["admin"]);
    if (getDb().prepare("SELECT 1 FROM users WHERE email=? COLLATE NOCASE").get(data.email))
      throw new Error("Já existe uma conta com este e-mail. Gerencie a conta existente.");
    getDb()
      .prepare(
        "UPDATE site_invitations SET revoked_at=?,revoked_by=? WHERE email=? COLLATE NOCASE AND accepted_at IS NULL AND revoked_at IS NULL",
      )
      .run(now, user.id, data.email);
    getDb()
      .prepare(
        "INSERT INTO site_invitations(id,token_hash,email,roles,created_at,expires_at,created_by) VALUES (?,?,?,?,?,?,?)",
      )
      .run(id, digest(token), data.email, JSON.stringify(data.roles), now, expiresAt, user.id);
    audit(user.id, "user:invite:created", id, { count: data.roles.length });
  });
  // Fragment is never sent in an HTTP request, access log, or Referrer header.
  return {
    id,
    url: `https://magmoveiscorporativos.com.br/interno/convite#token=${token}`,
    expiresAt,
  };
}
export function inspectInvitation(token: string, now = Date.now()) {
  const value = pending(token, now);
  return {
    email: String(value["email"]),
    roles: JSON.parse(String(value["roles"])) as string[],
    expiresAt: Number(value["expires_at"]),
  };
}
export async function acceptInvitation(input: unknown, clock: () => number = Date.now) {
  const data = acceptInvitationSchema.parse(input);
  pending(data.token, clock());
  const passwordHash = await hashPassword(data.password);
  // The password hash awaits scrypt. Recheck all conditions after it, inside the final write transaction.
  return transaction(() => {
    const now = clock(),
      value = pending(data.token, now);
    const email = String(value["email"]),
      id = randomUUID();
    if (getDb().prepare("SELECT 1 FROM users WHERE email=? COLLATE NOCASE").get(email))
      throw new Error(
        "Já existe uma conta para este e-mail. Entre na conta ou procure o administrador.",
      );
    const assignedRoles = roles.parse(JSON.parse(String(value["roles"])));
    getDb()
      .prepare(
        "INSERT INTO users(id,email,password_hash,roles,created_at,display_name) VALUES (?,?,?,?,?,?)",
      )
      .run(
        id,
        email,
        passwordHash,
        JSON.stringify(assignedRoles),
        new Date(now).toISOString(),
        data.name,
      );
    const changed = getDb()
      .prepare(
        "UPDATE site_invitations SET accepted_at=?,accepted_by=? WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?",
      )
      .run(now, id, String(value["id"]), now);
    if (changed.changes !== 1) throw invalid();
    audit(id, "user:invite:accepted", String(value["id"]));
    audit(String(value["created_by"]), "user:create", id, { count: assignedRoles.length });
    return { ok: true };
  });
}
export function listInvitations(actor: SiteUser | null, now = Date.now()) {
  requireActiveUser(actor, ["admin"]);
  return schema()
    .prepare(
      "SELECT id,email,roles,created_at,expires_at,revoked_at,accepted_at FROM site_invitations ORDER BY created_at DESC LIMIT 100",
    )
    .all()
    .map((r) => ({
      id: String(r["id"]),
      email: String(r["email"]),
      roles: JSON.parse(String(r["roles"])) as string[],
      createdAt: Number(r["created_at"]),
      expiresAt: Number(r["expires_at"]),
      state: r["accepted_at"]
        ? "aceito"
        : r["revoked_at"]
          ? "revogado"
          : Number(r["expires_at"]) <= now
            ? "expirado"
            : "pendente",
    }));
}
export function revokeInvitation(actor: SiteUser | null, id: string, now = Date.now()) {
  const user = requireActiveUser(actor, ["admin"]);
  z.string().uuid().parse(id);
  schema();
  return transaction(() => {
    const result = getDb()
      .prepare(
        "UPDATE site_invitations SET revoked_at=?,revoked_by=? WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL",
      )
      .run(now, user.id, id);
    if (!result.changes) throw new Error("O convite já foi aceito ou revogado");
    audit(user.id, "user:invite:revoked", id);
    return { ok: true };
  });
}
