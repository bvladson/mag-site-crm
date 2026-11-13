import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { audit, dataDirectory, getDb, transaction } from "./local-db.server.ts";
import { authenticate, requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";

const initialized = new WeakSet<object>();
type Row = Record<string, any>;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes: Uint8Array) {
  let bits = 0,
    value = 0,
    result = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >>> bits) & 31];
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function unbase32(secret: string) {
  let bits = 0,
    value = 0;
  const result: number[] = [];
  if (!/^[A-Z2-7]+$/.test(secret)) throw new Error("Segredo MFA inválido");
  for (const c of secret) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      result.push((value >>> bits) & 255);
    }
  }
  return Buffer.from(result);
}
/** RFC 4226 dynamic truncation; RFC 6238 Unix time, 30-second steps. */
export function totpAt(
  secret: string,
  timeMillis: number,
  digits: 6 | 8 = 6,
  algorithm: "sha1" | "sha256" | "sha512" = "sha1",
) {
  if (!Number.isFinite(timeMillis) || timeMillis < 0) throw new Error("Horário inválido");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMillis / 30_000)));
  const hash = createHmac(algorithm, unbase32(secret)).update(counter).digest();
  const offset = hash[hash.length - 1]! & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, "0");
}
function matchingCounter(secret: string, code: string, now: number, last = -1) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30_000);
  for (const step of [current, current - 1, current + 1]) {
    if (step < 0 || step <= last) continue;
    if (timingSafeEqual(Buffer.from(totpAt(secret, step * 30_000)), Buffer.from(code))) return step;
  }
  return null;
}
function schema() {
  const db = getDb();
  if (!initialized.has(db)) {
    db.exec(`CREATE TABLE IF NOT EXISTS user_mfa (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0, secret TEXT, pending_secret TEXT, pending_until INTEGER,
      last_counter INTEGER NOT NULL DEFAULT -1, recovery_hashes TEXT NOT NULL DEFAULT '[]',
      failures INTEGER NOT NULL DEFAULT 0, blocked_until INTEGER NOT NULL DEFAULT 0,
      enabled_at TEXT, updated_at TEXT NOT NULL
    );`);
    initialized.add(db);
  }
  return db;
}
function row(userId: string) {
  return schema().prepare("SELECT * FROM user_mfa WHERE user_id=?").get(userId) as Row | undefined;
}
function key(create = false) {
  const dir = join(dataDirectory(), "security");
  const file = join(dir, "mfa.key");
  if (create) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(file, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const bytes = readFileSync(file);
  if (bytes.length !== 32) throw new Error("Chave MFA indisponível");
  if (process.platform !== "win32") {
    chmodSync(dir, 0o700);
    chmodSync(file, 0o600);
  }
  return bytes;
}
function encrypt(secret: string, userId: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(true), iv);
  cipher.setAAD(Buffer.from(`mag-mfa:v1:${userId}`));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}
function decrypt(value: string, userId: string) {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext)
    throw new Error("Configuração MFA indisponível");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(`mag-mfa:v1:${userId}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
const recoveryHash = (userId: string, code: string) =>
  createHash("sha256")
    .update(`mag-recovery:v1:${userId}:${code.toUpperCase().replace(/[\s-]/g, "")}`)
    .digest("hex");
const newRecovery = () =>
  Array.from({ length: 8 }, () =>
    randomBytes(12).toString("hex").toUpperCase().match(/.{4}/g)!.join("-"),
  );
const authError = () =>
  new Error(
    "Código inválido, já utilizado ou expirado. Tente o próximo código do aplicativo ou um código de recuperação.",
  );
async function passwordUser(actor: SiteUser | null, password: string) {
  const user = requireActiveUser(actor);
  const check = await authenticate(user.email, password);
  if (!check || check.id !== user.id) throw new Error("Senha atual incorreta");
  return requireActiveUser(user);
}
export function mfaEnabled(userId: string) {
  return Boolean(row(userId)?.["enabled"]);
}
export function mfaStatus(actor: SiteUser | null) {
  const user = requireActiveUser(actor),
    value = row(user.id);
  return {
    enabled: Boolean(value?.["enabled"]),
    enabledAt: (value?.["enabled_at"] as string | null) ?? null,
    recoveryRemaining: value?.["enabled"]
      ? (JSON.parse(String(value["recovery_hashes"])) as string[]).length
      : 0,
  };
}
export async function beginMfaSetup(actor: SiteUser | null, password: string, now = Date.now()) {
  const user = await passwordUser(actor, password);
  if (mfaEnabled(user.id))
    throw new Error("A verificação já está ativa. Desative antes de cadastrar outro aplicativo.");
  const secret = base32(randomBytes(20)),
    encrypted = encrypt(secret, user.id);
  schema()
    .prepare(
      `INSERT INTO user_mfa(user_id,pending_secret,pending_until,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET pending_secret=excluded.pending_secret,pending_until=excluded.pending_until,updated_at=excluded.updated_at`,
    )
    .run(user.id, encrypted, now + 10 * 60_000, new Date(now).toISOString());
  audit(user.id, "mfa:setup:start", user.id);
  const uri = `otpauth://totp/${encodeURIComponent(`MAG:${user.email}`)}?secret=${secret}&issuer=MAG&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri, expiresAt: now + 10 * 60_000 };
}

/** Returns a result from the transaction so failed counters are committed too. */
function consumeCode(
  userId: string,
  code: string,
  now: number,
  pending = false,
): { ok: boolean; locked?: boolean } {
  return transaction(() => {
    const value = row(userId);
    if (
      !value ||
      (pending
        ? !value["pending_secret"] || Number(value["pending_until"]) <= now
        : !value["enabled"])
    )
      return { ok: false };
    if (Number(value["blocked_until"]) > now) return { ok: false, locked: true };
    const last = Number(value["last_counter"]);
    const secret = decrypt(String(value[pending ? "pending_secret" : "secret"]), userId);
    const counter = matchingCounter(secret, code.trim(), now, last);
    let hashes = JSON.parse(String(value["recovery_hashes"])) as string[];
    let recovery = false;
    if (!pending && counter === null && /^[A-Fa-f0-9\s-]{24,35}$/.test(code)) {
      const digest = recoveryHash(userId, code);
      const index = hashes.findIndex((h) =>
        timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(digest, "hex")),
      );
      if (index >= 0) {
        hashes.splice(index, 1);
        recovery = true;
      }
    }
    if (counter !== null || recovery) {
      schema()
        .prepare(
          "UPDATE user_mfa SET last_counter=?,recovery_hashes=?,failures=0,blocked_until=0,updated_at=? WHERE user_id=?",
        )
        .run(counter ?? last, JSON.stringify(hashes), new Date(now).toISOString(), userId);
      audit(userId, recovery ? "mfa:recovery:used" : "mfa:verified", userId);
      return { ok: true };
    }
    const failures =
      Number(value["blocked_until"]) > 0 && Number(value["blocked_until"]) <= now
        ? 1
        : Number(value["failures"]) + 1;
    const blocked = failures >= 5;
    schema()
      .prepare("UPDATE user_mfa SET failures=?,blocked_until=?,updated_at=? WHERE user_id=?")
      .run(failures, blocked ? now + 15 * 60_000 : 0, new Date(now).toISOString(), userId);
    audit(userId, blocked ? "mfa:locked" : "mfa:invalid", userId);
    return { ok: false, locked: blocked };
  });
}
function demandCode(userId: string, code: string, now: number, pending = false) {
  const result = consumeCode(userId, code, now, pending);
  if (result.locked)
    throw new Error("Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.");
  if (!result.ok) throw authError();
}
function revokeOtherSessions(userId: string, keepHash?: string) {
  if (keepHash)
    getDb().prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").run(userId, keepHash);
  else getDb().prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
}
export function confirmMfaSetup(
  actor: SiteUser | null,
  code: string,
  keepSessionHash?: string,
  now = Date.now(),
) {
  const user = requireActiveUser(actor);
  if (mfaEnabled(user.id)) throw new Error("A verificação já está ativa");
  demandCode(user.id, code, now, true);
  const codes = newRecovery();
  transaction(() => {
    const value = row(user.id);
    if (!value?.["pending_secret"] || Number(value["pending_until"]) <= now || value["enabled"])
      throw new Error("Inicie o cadastro novamente");
    schema()
      .prepare(
        "UPDATE user_mfa SET enabled=1,secret=pending_secret,pending_secret=NULL,pending_until=NULL,recovery_hashes=?,enabled_at=?,updated_at=? WHERE user_id=?",
      )
      .run(
        JSON.stringify(codes.map((c) => recoveryHash(user.id, c))),
        new Date(now).toISOString(),
        new Date(now).toISOString(),
        user.id,
      );
    revokeOtherSessions(user.id, keepSessionHash);
    audit(user.id, "mfa:enabled", user.id);
  });
  return { recoveryCodes: codes };
}
/** Password is checked by login before this function; no session is issued on a challenge. */
export function verifyMfaLogin(actor: SiteUser | null, code?: string, now = Date.now()) {
  const user = requireActiveUser(actor);
  if (!mfaEnabled(user.id)) return true;
  if (!code?.trim()) return false;
  demandCode(user.id, code, now);
  return true;
}
export async function disableMfa(
  actor: SiteUser | null,
  password: string,
  code: string,
  keepSessionHash?: string,
  now = Date.now(),
) {
  const user = await passwordUser(actor, password);
  if (!mfaEnabled(user.id)) throw new Error("A verificação já está desligada");
  demandCode(user.id, code, now);
  transaction(() => {
    schema().prepare("DELETE FROM user_mfa WHERE user_id=?").run(user.id);
    revokeOtherSessions(user.id, keepSessionHash);
    audit(user.id, "mfa:disabled", user.id);
  });
  return { ok: true };
}
export async function regenerateMfaRecovery(
  actor: SiteUser | null,
  password: string,
  code: string,
  now = Date.now(),
) {
  const user = await passwordUser(actor, password);
  if (!mfaEnabled(user.id)) throw new Error("Ative a verificação primeiro");
  demandCode(user.id, code, now);
  const codes = newRecovery();
  schema()
    .prepare("UPDATE user_mfa SET recovery_hashes=?,updated_at=? WHERE user_id=?")
    .run(
      JSON.stringify(codes.map((c) => recoveryHash(user.id, c))),
      new Date(now).toISOString(),
      user.id,
    );
  audit(user.id, "mfa:recovery:renewed", user.id);
  return { recoveryCodes: codes };
}
export function ownSessions(actor: SiteUser | null, currentHash: string) {
  const user = requireActiveUser(actor);
  return getDb()
    .prepare(
      "SELECT token_hash,created_at,expires_at FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC",
    )
    .all(user.id, Date.now())
    .map((r) => ({
      id: String(r["token_hash"]),
      current: r["token_hash"] === currentHash,
      createdAt: Number(r["created_at"]),
      expiresAt: Number(r["expires_at"]),
    }));
}
export function revokeSession(actor: SiteUser | null, sessionId: string, currentHash: string) {
  const user = requireActiveUser(actor);
  if (sessionId === currentHash) throw new Error("Use Sair para encerrar esta sessão");
  const result = getDb()
    .prepare("DELETE FROM sessions WHERE user_id=? AND token_hash=?")
    .run(user.id, sessionId);
  if (!result.changes) throw new Error("Sessão não encontrada");
  audit(user.id, "auth:session:revoke", user.id);
  return { ok: true };
}
export function teamMfaStatus(actor: SiteUser | null) {
  requireActiveUser(actor, ["admin"]);
  schema();
  return getDb()
    .prepare(
      `SELECT u.id,u.email,u.roles,m.enabled,m.enabled_at,(SELECT max(created_at) FROM sessions s WHERE s.user_id=u.id) AS last_login
    FROM users u LEFT JOIN user_mfa m ON m.user_id=u.id WHERE u.disabled=0 ORDER BY u.email LIMIT 200`,
    )
    .all()
    .map((r) => ({
      id: String(r["id"]),
      email: String(r["email"]),
      roles: JSON.parse(String(r["roles"])) as string[],
      enabled: Boolean(r["enabled"]),
      enabledAt: (r["enabled_at"] as string | null) ?? null,
      lastLogin: r["last_login"] ? Number(r["last_login"]) : null,
    }));
}
