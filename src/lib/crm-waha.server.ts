import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { audit, dataDirectory, getDb } from "./local-db.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";
import { createContact, ensureCrmSchema, requireCrmContact, updateCrmMessageStatus } from "./crm.server.ts";
import { brPhoneVariants, normalizeBrPhone, samePhone } from "./br-phone.ts";
import type { WahaCatalogContact, WahaContactCatalogInput, WahaContactCatalogPage, WahaContactImportInput } from "./crm-waha-contacts.ts";
import { site } from "../config/site.ts";
import { readPublicSiteContent } from "./site-content.server.ts";

type Row = Record<string, any>;
/** Connector settings shared by every line: one WAHA, one webhook and one HMAC key. */
type WahaSettings = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  hmacKey: string;
  /** Import every conversation of a number at once. Off by default: history is per selected conversation. */
  allowFullHistoryImport: boolean;
  /** Administrators supervise; replying through a seller's number needs this explicit setting. */
  allowAdminReplies: boolean;
  /** Numbers that can never be paired, besides MAG's official WhatsApp published on the site. */
  blockedPhones: string[];
  /** Release v1 (a single number). Kept as stored for rollback and migrated once into crm_waha_lines. */
  session?: string;
  ownerId?: string;
  expectedPhone?: string;
};
/** One seller's WhatsApp: its own WAHA session, the seller who answers and the authorized number. */
type WahaLine = {
  id: string;
  userId: string;
  session: string;
  expectedPhone: string;
  status: "active" | "disabled";
  revision: number;
  createdAt: string;
  updatedAt: string;
};
/** What a WAHA call needs: the shared settings plus one line. Never stored. */
type WahaConfig = WahaSettings & {
  lineId: string;
  session: string;
  ownerId: string;
  expectedPhone: string;
};
const defaults = (): WahaSettings => ({
  enabled: false,
  baseUrl: "http://waha:3000",
  apiKey: "",
  hmacKey: "",
  allowFullHistoryImport: false,
  allowAdminReplies: false,
  blockedPhones: [],
});
const now = () => new Date().toISOString();
const txt = (value: unknown, max = 500) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const phone = (value: unknown) => {
  const valueDigits = digits(value);
  return valueDigits.length === 10 || valueDigits.length === 11 ? `55${valueDigits}` : valueDigits;
};
const SESSION_NAME = /^[a-zA-Z0-9_-]{1,54}$/;
/**
 * WAHA serializes message ids as `<fromMe>_<chat>_<messageId>`. With NOWEB the chat part can be the
 * phone (`55...@c.us`) in one event and the LID (`...@lid`) in the next (sends, echoes and ACKs), so the
 * CRM keeps `<fromMe>_<messageId>` as the stable identity. Ids without that format are kept as they are.
 */
const SERIALIZED_ID = /^(true|false)_([^_]+)_([^_]+)(?:_.*)?$/;
function canonicalMessageId(value: unknown, fromMe?: boolean): string {
  if (value && typeof value === "object") {
    const key = value as { id?: unknown; fromMe?: unknown; _serialized?: unknown };
    if (typeof key._serialized === "string") return canonicalMessageId(key._serialized, fromMe);
    if (typeof key.id === "string" && key.id)
      return `${key.fromMe === true || fromMe === true}_${txt(key.id, 200)}`;
    return "";
  }
  const text = txt(value, 240),
    match = SERIALIZED_ID.exec(text);
  return match ? `${match[1]}_${match[3]}` : text;
}
function chatFromMessageId(value: unknown) {
  const text = typeof value === "string" ? value : (value as any)?._serialized;
  const match = SERIALIZED_ID.exec(typeof text === "string" ? text : "");
  return match ? match[2]! : "";
}
/** Protocol notices (sync, edits, deletions) and reactions are not conversation messages. */
function isSystemMessage(payload: any) {
  const content = payload?._data?.message;
  return Boolean(
    content && typeof content === "object" && (content.protocolMessage || content.reactionMessage),
  );
}
const administrator = (actor: SiteUser) => requireActiveUser(actor, ["admin"]);
const commercial = (actor: SiteUser) => requireActiveUser(actor, ["admin", "comercial"]);
const isAdmin = (user: SiteUser) => user.roles.includes("admin");
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
const MAX_MEDIA = 7 * 1024 * 1024;
const MAX_EVENT = 512 * 1024;
let initialized = new WeakSet<object>();
const migrated = new WeakSet<object>();
let savepoint = 0;
function atomic<T>(work: () => T): T {
  const db = getDb(),
    name = `waha_${++savepoint}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = work();
    db.exec(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}
export function ensureWahaSchema() {
  const db = ensureCrmSchema();
  if (initialized.has(db)) return db;
  db.exec(`CREATE TABLE IF NOT EXISTS crm_waha_config(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,encrypted TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS crm_waha_events(id TEXT PRIMARY KEY,external_id TEXT NOT NULL UNIQUE,session TEXT NOT NULL,event_type TEXT NOT NULL,encrypted TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,error_code TEXT);
    CREATE INDEX IF NOT EXISTS crm_waha_event_due ON crm_waha_events(state,available_at);
    CREATE TABLE IF NOT EXISTS crm_waha_outbox(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,contact_id TEXT NOT NULL,session TEXT NOT NULL,request_key TEXT NOT NULL,body_hash TEXT NOT NULL,encrypted TEXT NOT NULL,state TEXT NOT NULL,external_id TEXT,message_id TEXT,error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(actor_id,request_key));
    CREATE TABLE IF NOT EXISTS crm_waha_status_errors(session TEXT NOT NULL,external_id TEXT NOT NULL,error_code TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(session,external_id));
    CREATE TABLE IF NOT EXISTS crm_waha_history(session TEXT NOT NULL,chat_id TEXT NOT NULL,offset INTEGER NOT NULL DEFAULT 0,processed INTEGER NOT NULL DEFAULT 0,completed INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,PRIMARY KEY(session,chat_id));
    CREATE TABLE IF NOT EXISTS crm_waha_history_scan(session TEXT PRIMARY KEY,offset INTEGER NOT NULL DEFAULT 0,completed INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS crm_waha_history_window(session TEXT NOT NULL,chat_id TEXT NOT NULL,until_timestamp INTEGER NOT NULL,PRIMARY KEY(session,chat_id));
    CREATE TABLE IF NOT EXISTS crm_waha_runtime(session TEXT PRIMARY KEY,state TEXT NOT NULL,updated_at TEXT NOT NULL,error_code TEXT);
    CREATE TABLE IF NOT EXISTS crm_waha_lines(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),session TEXT NOT NULL UNIQUE,expected_phone TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),revision INTEGER NOT NULL DEFAULT 1,created_by TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS crm_waha_lines_one_active ON crm_waha_lines(user_id) WHERE status='active';
    CREATE TABLE IF NOT EXISTS crm_waha_recovery(session TEXT PRIMARY KEY,state TEXT NOT NULL,passes INTEGER NOT NULL DEFAULT 0,cursor TEXT,processed INTEGER NOT NULL DEFAULT 0,available_at INTEGER NOT NULL,updated_at TEXT NOT NULL,error_code TEXT,offline_since INTEGER,mode TEXT,window_start INTEGER,new_chats INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS crm_waha_watermarks(session TEXT PRIMARY KEY,baseline INTEGER NOT NULL,covered_until INTEGER NOT NULL,last_probe INTEGER NOT NULL DEFAULT 0);`);
  // Builds of 09/11 (homologation only) created crm_waha_recovery without the reconnection columns.
  const recoveryColumns = new Set(
    (db.prepare("PRAGMA table_info(crm_waha_recovery)").all() as Row[]).map((column) =>
      String(column["name"]),
    ),
  );
  for (const [name, type] of [
    ["offline_since", "INTEGER"],
    ["mode", "TEXT"],
    ["window_start", "INTEGER"],
    ["new_chats", "INTEGER NOT NULL DEFAULT 0"],
    ["window_end", "INTEGER"],
    ["failed_count", "INTEGER NOT NULL DEFAULT 0"],
    ["failure_attempts", "INTEGER NOT NULL DEFAULT 0"],
    ["has_more", "INTEGER NOT NULL DEFAULT 0"],
  ] as const)
    if (!recoveryColumns.has(name)) db.exec(`ALTER TABLE crm_waha_recovery ADD COLUMN ${name} ${type}`);
  canonicalizeStoredMessageIds(db);
  initialized.add(db);
  return db;
}
/** Idempotent: earlier builds stored full serialized ids; keep the stable form so replays and ACKs match. */
function canonicalizeStoredMessageIds(db: ReturnType<typeof getDb>) {
  const legacy = (value: unknown) => {
    const text = String(value ?? "");
    return SERIALIZED_ID.test(text) && canonicalMessageId(text) !== text;
  };
  const messages = db
    .prepare(
      "SELECT id,account,external_id FROM crm_messages WHERE provider='waha' AND (substr(external_id,1,5)='true_' OR substr(external_id,1,6)='false_')",
    )
    .all() as Row[];
  for (const row of messages.filter((item) => legacy(item["external_id"]))) {
    const canonical = canonicalMessageId(row["external_id"]);
    const taken = db
      .prepare("SELECT 1 FROM crm_messages WHERE provider='waha' AND account=? AND external_id=?")
      .get(row["account"], canonical);
    if (!taken)
      db.prepare("UPDATE crm_messages SET external_id=? WHERE id=?").run(canonical, row["id"]);
  }
  const outbox = db
    .prepare("SELECT id,external_id FROM crm_waha_outbox WHERE external_id IS NOT NULL")
    .all() as Row[];
  for (const row of outbox.filter((item) => legacy(item["external_id"])))
    db.prepare("UPDATE crm_waha_outbox SET external_id=? WHERE id=?").run(
      canonicalMessageId(row["external_id"]),
      row["id"],
    );
  const failures = db
    .prepare("SELECT session,external_id FROM crm_waha_status_errors")
    .all() as Row[];
  for (const row of failures.filter((item) => legacy(item["external_id"]))) {
    db.prepare(
      "INSERT OR IGNORE INTO crm_waha_status_errors SELECT session,?,error_code,created_at FROM crm_waha_status_errors WHERE session=? AND external_id=?",
    ).run(canonicalMessageId(row["external_id"]), row["session"], row["external_id"]);
    db.prepare("DELETE FROM crm_waha_status_errors WHERE session=? AND external_id=?").run(
      row["session"],
      row["external_id"],
    );
  }
}
function encryptionKey() {
  const db = ensureWahaSchema();
  const directory = join(dataDirectory(), "security"),
    path = join(directory, "crm-waha.key");
  if (!existsSync(path)) {
    const hasData = ["crm_waha_config", "crm_waha_events", "crm_waha_outbox"].some((table) =>
      Boolean(db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()),
    );
    if (hasData) throw new Error("Chave WAHA ausente. Restaure a chave correspondente ao banco.");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (!existsSync(path)) throw error;
    }
  }
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error("Chave WAHA inválida.");
  return key;
}
function encrypt(value: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
function decrypt<T>(value: string): T {
  const data = Buffer.from(value, "base64"),
    cipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8"),
  ) as T;
}
function configuration() {
  const db = ensureWahaSchema();
  const row = db.prepare("SELECT * FROM crm_waha_config WHERE id=1").get();
  const config: WahaSettings = row
    ? { ...defaults(), ...decrypt<WahaSettings>(String(row["encrypted"])) }
    : defaults();
  if (!Array.isArray(config.blockedPhones)) config.blockedPhones = [];
  migrateSingleNumber(db, config);
  return { revision: Number(row?.["revision"] ?? 0), config };
}
/**
 * Release v1 had one number (session, seller and authorized number in the settings). The first time
 * this release reads them, they become that seller's line with the same session, so every stored
 * conversation, binding and history checkpoint keeps working. The stored settings are not changed.
 */
function migrateSingleNumber(db: ReturnType<typeof getDb>, config: WahaSettings) {
  if (migrated.has(db)) return;
  const session = txt(config.session, 60),
    ownerId = txt(config.ownerId, 60);
  if (
    ownerId &&
    SESSION_NAME.test(session) &&
    !db.prepare("SELECT 1 FROM crm_waha_lines LIMIT 1").get() &&
    db.prepare("SELECT 1 FROM users WHERE id=?").get(ownerId)
  ) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO crm_waha_lines(id,user_id,session,expected_phone,status,revision,created_by,created_at,updated_at) VALUES(?,?,?,?,'active',1,NULL,?,?)",
    ).run(id, ownerId, session, phone(config.expectedPhone || ""), now(), now());
    audit(null, "crm:waha:line:migrated", id, { session });
  }
  migrated.add(db);
}
const lineOf = (row: Row | undefined): WahaLine | null =>
  row
    ? {
        id: String(row["id"]),
        userId: String(row["user_id"]),
        session: String(row["session"]),
        expectedPhone: String(row["expected_phone"] || ""),
        status: row["status"] === "disabled" ? "disabled" : "active",
        revision: Number(row["revision"]),
        createdAt: String(row["created_at"]),
        updatedAt: String(row["updated_at"]),
      }
    : null;
const lineById = (id: string) =>
  lineOf(ensureWahaSchema().prepare("SELECT * FROM crm_waha_lines WHERE id=?").get(id) as Row);
const activeLineOf = (userId: string) =>
  lineOf(
    ensureWahaSchema()
      .prepare("SELECT * FROM crm_waha_lines WHERE user_id=? AND status='active'")
      .get(userId) as Row,
  );
const activeLineBySession = (session: unknown) =>
  typeof session === "string" && session
    ? lineOf(
        ensureWahaSchema()
          .prepare("SELECT * FROM crm_waha_lines WHERE session=? AND status='active'")
          .get(session) as Row,
      )
    : null;
const activeLines = () =>
  (
    ensureWahaSchema()
      .prepare("SELECT * FROM crm_waha_lines WHERE status='active' ORDER BY created_at,id")
      .all() as Row[]
  ).map((row) => lineOf(row)!);
const withLine = (settings: WahaSettings, line: WahaLine): WahaConfig => ({
  ...settings,
  lineId: line.id,
  session: line.session,
  ownerId: line.userId,
  expectedPhone: line.expectedPhone,
});
/** Session names never reveal the seller and are never reused (stored messages keep their session). */
const newSessionName = () => `mag-${randomBytes(5).toString("hex")}`;
function userSummary(userId: string) {
  const row = getDb()
    .prepare("SELECT COALESCE(NULLIF(display_name,''),email) name,disabled FROM users WHERE id=?")
    .get(userId);
  return { name: row ? String(row["name"]) : "Usuário removido", active: Boolean(row && !row["disabled"]) };
}
const phoneHint = (value: string) => (value ? `…${value.slice(-4)}` : null);
/**
 * The line a user operates. Sellers only ever reach their own line; administrators name the line
 * (or get their own, or the only one registered).
 */
function resolveLine(user: SiteUser, lineId?: string): WahaLine {
  if (lineId) {
    const line = lineById(lineId);
    if (!line || line.status !== "active")
      throw new Error("Linha de WhatsApp não encontrada ou desativada.");
    if (!isAdmin(user) && line.userId !== user.id) throw new Error("Forbidden");
    return line;
  }
  const own = activeLineOf(user.id);
  if (own) return own;
  if (isAdmin(user)) {
    const lines = activeLines();
    if (lines.length === 1) return lines[0]!;
    if (lines.length > 1) throw new Error("Escolha a linha de WhatsApp da vendedora.");
    throw new Error("Cadastre a linha de WhatsApp de uma vendedora nas integrações.");
  }
  throw new Error(
    "Seu número de WhatsApp ainda não foi cadastrado. Peça ao administrador para cadastrá-lo.",
  );
}
let published: { at: number; whatsapp: string } | null = null;
/** WhatsApp published on the site (read at most once a minute: it is checked on every event). */
function publishedWhatsapp() {
  if (published && Date.now() - published.at < 60_000) return published.whatsapp;
  let whatsapp = "";
  try {
    whatsapp = readPublicSiteContent().content.general.whatsapp || "";
  } catch {
    /* The published site is optional here; the official number from the code still applies. */
  }
  published = { at: Date.now(), whatsapp };
  return whatsapp;
}
/** MAG's official WhatsApp (site) and the numbers blocked by an administrator: never paired. */
function protectedPhones(config: WahaSettings) {
  return [
    ...new Set(
      [site.whatsapp, publishedWhatsapp(), ...config.blockedPhones]
        .map((item) => phone(item))
        .filter((item) => /^\d{12,15}$/.test(item)),
    ),
  ];
}
const isProtectedPhone = (config: WahaSettings, value: string) =>
  Boolean(value) && protectedPhones(config).some((item) => samePhone(item, value));
const baseUrl = (value: string) => {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Informe uma URL HTTP/HTTPS do WAHA sem credenciais ou parâmetros.");
  return url.href.replace(/\/$/, "");
};
export const wahaSettingsSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    baseUrl: z.string().trim().min(1).max(500),
    apiKey: z.string().max(4000).optional(),
    hmacKey: z.string().max(500).optional(),
    clearSecrets: z
      .array(z.enum(["apiKey", "hmacKey"]))
      .max(2)
      .default([]),
    allowFullHistoryImport: z.boolean().optional(),
    allowAdminReplies: z.boolean().optional(),
    blockedPhones: z.array(z.string().max(30)).max(20).optional(),
  })
  .strict();
export const wahaLineSchema = z
  .object({
    id: z.string().uuid().optional(),
    revision: z.number().int().nonnegative().optional(),
    userId: z.string().uuid(),
    expectedPhone: z.string().max(30).default(""),
    // Pinned NOWEB session DTO; generated when omitted (the screen never asks for it).
    session: z.string().trim().regex(SESSION_NAME).optional(),
  })
  .strict();
function validateOwner(ownerId: string) {
  const row = getDb().prepare("SELECT id,roles FROM users WHERE id=? AND disabled=0").get(ownerId);
  if (
    !row ||
    !JSON.parse(String(row["roles"])).some(
      (role: string) => role === "admin" || role === "comercial",
    )
  )
    throw new Error("Configure uma vendedora ativa como responsável pelo WAHA.");
}
function requireConfigured(config: WahaConfig) {
  if (!config.enabled) throw new Error("Selecione o WAHA como provedor antes de iniciar a sessão.");
  if (!config.apiKey || !config.hmacKey) throw new Error("Configure as credenciais do WAHA.");
  if (!config.ownerId)
    throw new Error("Defina a vendedora responsável antes de conectar o WhatsApp.");
  validateOwner(config.ownerId);
  if (!/^\d{12,15}$/.test(config.expectedPhone))
    throw new Error("Defina o número autorizado antes de iniciar o WhatsApp.");
  if (isProtectedPhone(config, config.expectedPhone))
    throw new Error(
      "Este número é protegido (WhatsApp oficial da MAG ou bloqueado) e não pode ser conectado ao CRM.",
    );
}
const webhookUrl = () => {
  const raw = process.env["MAG_WAHA_WEBHOOK_URL"] || "http://web:3000/api/crm/webhooks/waha";
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Endereço interno do webhook WAHA inválido.");
  return url.href;
};
export function isWahaSelected() {
  return configuration().config.enabled;
}
/** Operational metadata only. An uncertain send is never retried by this read. */
export function readWahaOutbox(actor: SiteUser, input: { contactId?: string | undefined; lineId?: string | undefined } = {}) {
  const user = commercial(actor), db = ensureWahaSchema();
  const clauses = ["(o.state IN ('sending','uncertain') OR o.error_code IS NOT NULL)"];
  const values: string[] = [];
  if (!isAdmin(user)) { clauses.push("c.owner_id=?"); values.push(user.id); }
  if (input.contactId) { requireCrmContact(user, input.contactId); clauses.push("o.contact_id=?"); values.push(input.contactId); }
  if (input.lineId) { const line = resolveLine(user, input.lineId); clauses.push("o.session=?"); values.push(line.session); }
  const rows = db.prepare(`SELECT o.id,o.contact_id,o.actor_id,c.owner_id,o.state,o.error_code,o.created_at,o.updated_at,o.message_id FROM crm_waha_outbox o JOIN crm_contacts c ON c.id=o.contact_id WHERE ${clauses.join(" AND ")} ORDER BY o.updated_at DESC,o.id LIMIT 50`).all(...values);
  return { items: rows.map(row => ({ id: String(row["id"]), contactId: String(row["contact_id"]), actorId: String(row["actor_id"]), ownerId: String(row["owner_id"]), state: String(row["state"]), errorCode: row["error_code"] ? String(row["error_code"]) : null, createdAt: String(row["created_at"]), updatedAt: String(row["updated_at"]), hasMessage: Boolean(row["message_id"]) })) };
}
export async function readWahaContactContext(actor: SiteUser, contactId: string) {
  const user = commercial(actor),
    { config } = configuration();
  const contact = requireCrmContact(user, contactId);
  const line = config.enabled ? activeLineOf(contact.ownerId) : null;
  if (!line) return null;
  return (await import("./crm-whatsapp-store.server.ts")).readWahaContactContext(user, {
    session: line.session,
    contactId,
  });
}
export async function bindWahaContactOpportunity(
  actor: SiteUser,
  input: { contactId: string; opportunityId: string },
) {
  const user = commercial(actor),
    { config } = configuration();
  const contact = requireCrmContact(user, input.contactId);
  const line = config.enabled ? activeLineOf(contact.ownerId) : null;
  if (!line) throw new Error("Este atendimento não utiliza uma linha WAHA ativa");
  validateOwner(line.userId);
  return (await import("./crm-whatsapp-store.server.ts")).bindWahaContactOpportunity(user, {
    ...input,
    session: line.session,
  });
}
export function readWahaSettings(actor: SiteUser) {
  administrator(actor);
  const { config, revision } = configuration();
  const db = ensureWahaSchema();
  const lines = (
    db.prepare("SELECT * FROM crm_waha_lines ORDER BY status,created_at,id").all() as Row[]
  ).map((row) => {
    const line = lineOf(row)!,
      owner = userSummary(line.userId);
    const history = db
      .prepare(
        "SELECT sum(processed) processed,count(*) chats,max(updated_at) updatedAt FROM crm_waha_history WHERE session=?",
      )
      .get(line.session);
    const runtime = db
      .prepare("SELECT state,updated_at FROM crm_waha_runtime WHERE session=?")
      .get(line.session);
    return {
      id: line.id,
      userId: line.userId,
      ownerName: owner.name,
      ownerActive: owner.active,
      session: line.session,
      expectedPhone: line.expectedPhone,
      protectedNumber: isProtectedPhone(config, line.expectedPhone),
      status: line.status,
      revision: line.revision,
      createdAt: line.createdAt,
      updatedAt: line.updatedAt,
      lastState: runtime ? String(runtime["state"]) : null,
      lastStateAt: runtime ? String(runtime["updated_at"]) : null,
      history: history?.["updatedAt"]
        ? {
            processed: Number(history["processed"] ?? 0),
            chats: Number(history["chats"] ?? 0),
            updatedAt: String(history["updatedAt"]),
          }
        : null,
    };
  });
  const owners = new Map(lines.map((line) => [line.session, line.ownerName]));
  return {
    revision,
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    apiKeyConfigured: Boolean(config.apiKey),
    hmacKeyConfigured: Boolean(config.hmacKey),
    allowFullHistoryImport: config.allowFullHistoryImport === true,
    allowAdminReplies: config.allowAdminReplies === true,
    blockedPhones: config.blockedPhones,
    protectedPhones: protectedPhones(config),
    webhookUrl: webhookUrl(),
    lines,
    events: db
      .prepare(
        "SELECT id,session,event_type eventType,state,attempts,created_at createdAt,updated_at updatedAt,error_code errorCode FROM crm_waha_events ORDER BY created_at DESC LIMIT 30",
      )
      .all()
      .map((row) => ({
        id: String(row["id"]),
        lineOwner: owners.get(String(row["session"])) || null,
        eventType: String(row["eventType"]),
        state: String(row["state"]),
        attempts: Number(row["attempts"]),
        createdAt: String(row["createdAt"]),
        updatedAt: String(row["updatedAt"]),
        errorCode: row["errorCode"] ? String(row["errorCode"]) : null,
      })),
  };
}
export function saveWahaSettings(actor: SiteUser, raw: z.input<typeof wahaSettingsSchema>) {
  const user = administrator(actor),
    input = wahaSettingsSchema.parse(raw);
  ensureWahaSchema();
  return atomic(() => {
    const { config: existing, revision } = configuration();
    if (revision !== input.revision)
      throw new Error("A configuração WAHA mudou em outra sessão. Atualize antes de salvar.");
    const blockedPhones = [
      ...new Set((input.blockedPhones ?? existing.blockedPhones).map((item) => phone(item))),
    ].filter(Boolean);
    if (blockedPhones.some((item) => !/^\d{12,15}$/.test(item)))
      throw new Error("Informe cada número bloqueado com DDI e DDD.");
    const config: WahaSettings = {
      ...existing,
      enabled: input.enabled,
      baseUrl: baseUrl(input.baseUrl),
      // Omitted flags keep the stored choice; both start disabled.
      allowFullHistoryImport:
        input.allowFullHistoryImport ?? existing.allowFullHistoryImport === true,
      allowAdminReplies: input.allowAdminReplies ?? existing.allowAdminReplies === true,
      blockedPhones,
    };
    for (const field of ["apiKey", "hmacKey"] as const) {
      if (input.clearSecrets.includes(field)) config[field] = "";
      else if (input[field]?.trim()) config[field] = input[field]!.trim();
    }
    if (config.apiKey && !config.hmacKey && !input.clearSecrets.includes("hmacKey"))
      config.hmacKey = randomBytes(32).toString("hex");
    getDb()
      .prepare(
        "INSERT INTO crm_waha_config VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,encrypted=excluded.encrypted,updated_at=excluded.updated_at",
      )
      .run(revision + 1, encrypt(config), now());
    if (!config.enabled) {
      // Deliberate disabled periods never become an implicit historical import later.
      getDb().prepare("DELETE FROM crm_waha_watermarks").run();
      getDb().prepare("UPDATE crm_waha_recovery SET state='cancelled',offline_since=NULL,window_start=NULL,window_end=NULL,cursor=NULL,has_more=0,failed_count=0 WHERE state!='cancelled'").run();
    }
    audit(user.id, "crm:waha:settings", null, {
      revision: revision + 1,
      enabled: config.enabled,
      allowFullHistoryImport: config.allowFullHistoryImport,
      allowAdminReplies: config.allowAdminReplies,
      blockedPhones: blockedPhones.length,
    });
    return { revision: revision + 1 };
  });
}
/**
 * Registers or edits a seller's line (administrators only). One active line per seller and per
 * number; protected numbers are refused. Changing the number of a line that already had one moves
 * the line to a new session, so the new phone never reads the previous phone's WhatsApp store;
 * conversations already in the CRM stay where they are.
 */
export async function saveWahaLine(actor: SiteUser, raw: z.input<typeof wahaLineSchema>) {
  const user = administrator(actor),
    input = wahaLineSchema.parse(raw),
    { config } = configuration();
  const expectedPhone = phone(input.expectedPhone || "");
  if (expectedPhone && !/^\d{12,15}$/.test(expectedPhone))
    throw new Error("Informe o número da vendedora com DDI e DDD válidos.");
  if (expectedPhone && isProtectedPhone(config, expectedPhone))
    throw new Error(
      "Este número é protegido (WhatsApp oficial da MAG ou bloqueado) e não pode ser usado por uma vendedora.",
    );
  validateOwner(input.userId);
  const taken =
    expectedPhone &&
    activeLines().find(
      (line) =>
        line.id !== input.id && line.expectedPhone && samePhone(line.expectedPhone, expectedPhone),
    );
  if (taken) throw new Error("Este número já está cadastrado na linha de outra vendedora.");
  const db = ensureWahaSchema();
  if (!input.id) {
    if (activeLineOf(input.userId))
      throw new Error("Esta vendedora já tem uma linha ativa. Edite a linha existente.");
    const session = input.session || newSessionName();
    if (db.prepare("SELECT 1 FROM crm_waha_lines WHERE session=?").get(session))
      throw new Error("Este nome de sessão já foi usado por outra linha.");
    const id = randomUUID();
    db.prepare(
      "INSERT INTO crm_waha_lines(id,user_id,session,expected_phone,status,revision,created_by,created_at,updated_at) VALUES(?,?,?,?,'active',1,?,?,?)",
    ).run(id, input.userId, session, expectedPhone, user.id, now(), now());
    audit(user.id, "crm:waha:line:create", id, { number: Boolean(expectedPhone) });
    return { id, revision: 1, session };
  }
  const line = lineById(input.id);
  if (!line) throw new Error("Linha de WhatsApp não encontrada.");
  if (input.revision !== line.revision)
    throw new Error("A linha mudou em outra sessão. Atualize antes de salvar.");
  if (line.userId !== input.userId)
    throw new Error(
      "Para outra vendedora, cadastre uma nova linha: cada linha guarda o histórico de quem a usou.",
    );
  let session = line.session;
  const numberChanged = line.expectedPhone !== expectedPhone;
  if (numberChanged && line.expectedPhone && !samePhone(line.expectedPhone, expectedPhone)) {
    const lineConfig = withLine(config, line);
    if (config.apiKey) {
      let state = "";
      try {
        state = txt((await sessionState(lineConfig))?.status, 80);
      } catch (error) {
        if (!(error instanceof WahaHttpError) || error.status !== 404)
          throw new Error(
            "Não foi possível confirmar no WAHA que esta linha está desconectada. Nada foi alterado.",
          );
      }
      if (["WORKING", "STARTING", "SCAN_QR_CODE"].includes(state))
        throw new Error("Desconecte o WhatsApp desta linha antes de trocar o número.");
      // Drops any stored login of the previous phone; its conversations stay in the CRM.
      await unlinkSession(lineConfig, {
        resumeFirst: recoveryOf(line.session)?.["mode"] === "paused",
      }).catch(() => {});
    }
    session = newSessionName();
  }
  db.prepare(
    "UPDATE crm_waha_lines SET expected_phone=?,session=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
  ).run(expectedPhone, session, now(), line.id, line.revision);
  audit(user.id, "crm:waha:line:update", line.id, {
    number: Boolean(expectedPhone),
    newSession: session !== line.session,
  });
  return { id: line.id, revision: line.revision + 1, session };
}
/**
 * Offboarding and return of a line (administrators only). Disabling disconnects the phone first;
 * the seller's conversations, contacts and opportunities stay in the CRM.
 */
export async function setWahaLineStatus(
  actor: SiteUser,
  input: { id: string; revision: number; status: "active" | "disabled" },
) {
  const user = administrator(actor),
    { config } = configuration();
  const line = lineById(input.id);
  if (!line) throw new Error("Linha de WhatsApp não encontrada.");
  if (line.revision !== input.revision)
    throw new Error("A linha mudou em outra sessão. Atualize antes de salvar.");
  if (line.status === input.status) return { id: line.id, revision: line.revision };
  if (input.status === "disabled") {
    if (config.enabled && config.apiKey) {
      try {
        await unlinkSession(withLine(config, line), {
          resumeFirst: recoveryOf(line.session)?.["mode"] === "paused",
        });
      } catch {
        throw new Error(
          "Não foi possível desconectar o WhatsApp desta linha no WAHA. Nada foi alterado; tente novamente.",
        );
      }
    }
    // A disabled period is not a pause: reactivating the line never imports what arrived meanwhile.
    ensureWahaSchema()
      .prepare(
        "UPDATE crm_waha_recovery SET state='cancelled',offline_since=NULL,mode=NULL,window_start=NULL,cursor=NULL,updated_at=? WHERE session=?",
      )
      .run(now(), line.session);
    ensureWahaSchema().prepare("DELETE FROM crm_waha_watermarks WHERE session=?").run(line.session);
  } else {
    validateOwner(line.userId);
    if (activeLineOf(line.userId)) throw new Error("Esta vendedora já tem outra linha ativa.");
    if (
      line.expectedPhone &&
      activeLines().some((item) => item.expectedPhone && samePhone(item.expectedPhone, line.expectedPhone))
    )
      throw new Error("O número desta linha já está em uso na linha de outra vendedora.");
  }
  ensureWahaSchema()
    .prepare(
      "UPDATE crm_waha_lines SET status=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
    )
    .run(input.status, now(), line.id, line.revision);
  audit(user.id, input.status === "disabled" ? "crm:waha:line:disable" : "crm:waha:line:enable", line.id);
  return { id: line.id, revision: line.revision + 1 };
}
class WahaHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`waha_http_${status}`);
    this.status = status;
  }
}
async function api(
  config: Pick<WahaSettings, "baseUrl" | "apiKey">,
  path: string,
  options: { method?: string; body?: unknown; accept?: string; timeout?: number } = {},
) {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "X-Api-Key": config.apiKey,
      Accept: options.accept || "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(options.timeout || 15_000),
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new WahaHttpError(response.status);
  }
  return response;
}
const sessionPath = (config: WahaConfig) => `/api/sessions/${encodeURIComponent(config.session)}`;
async function sessionState(config: WahaConfig) {
  return (await (await api(config, sessionPath(config))).json()) as any;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * NOWEB: logout unlinks the phone and waits for a new QR at once; stop leaves the line disconnected.
 * WhatsApp only removes the device from a running session: a paused session (stopped with its login
 * kept) is resumed first. Returns false when the removal from the phone could not be confirmed (the
 * CRM's login is deleted anyway).
 */
async function unlinkSession(config: WahaConfig, options: { resumeFirst?: boolean } = {}) {
  let confirmed = true;
  if (options.resumeFirst) {
    confirmed = false;
    try {
      await api(config, `${sessionPath(config)}/start`, { method: "POST", body: {} });
      for (let attempt = 0; attempt < 25 && !confirmed; attempt++) {
        const status = txt((await sessionState(config).catch(() => null))?.status, 80);
        // WORKING: logout removes the device; a QR (or failure) means WhatsApp already dropped the login.
        if (["WORKING", "SCAN_QR_CODE", "FAILED"].includes(status)) confirmed = true;
        else await sleep(1_000);
      }
    } catch {
      /* The CRM's login is removed below even if the session could not be resumed. */
    }
  }
  for (const step of ["logout", "stop"]) {
    try {
      await api(config, `${sessionPath(config)}/${step}`, { method: "POST", body: {} });
    } catch (error) {
      // Absent or already stopped sessions are already disconnected.
      if (!(error instanceof WahaHttpError) || ![404, 422].includes(error.status)) throw error;
    }
  }
  return confirmed;
}
/**
 * Reconnection state of a session: since when the line is offline (the catch-up window), how the
 * CRM took it offline (paused keeps the phone linked; unlinked needs a new QR) and the catch-up
 * progress after it comes back.
 */
const recoveryOf = (session: string) =>
  ensureWahaSchema().prepare("SELECT * FROM crm_waha_recovery WHERE session=?").get(session) as
    | Row
    | undefined;
/** `online`: the line was WORKING with its own number until now, so the gap starts now. */
function markOffline(session: string, mode: "paused" | "unlinked" | null, online: boolean) {
  ensureWahaSchema()
    .prepare(
      "INSERT INTO crm_waha_recovery(session,state,passes,cursor,processed,available_at,updated_at,offline_since,mode) VALUES(?,'idle',0,NULL,0,0,?,?,?) ON CONFLICT(session) DO UPDATE SET offline_since=COALESCE(crm_waha_recovery.offline_since,excluded.offline_since),mode=COALESCE(excluded.mode,crm_waha_recovery.mode),updated_at=excluded.updated_at",
    )
    .run(session, now(), online ? Date.now() : null, mode);
}
/** What the seller sees about the catch-up after a reconnection (counts only, never content). */
function recoverySummary(row: Row | undefined) {
  if (!row || !["pending", "done", "partial", "error"].includes(String(row["state"]))) return null;
  // Older builds marked a capped scan as done. Never present that result as complete.
  const legacyPartial = row["state"] === "done" && Boolean(row["error_code"]);
  return {
    state: (legacyPartial ? "partial" : String(row["state"])) as "pending" | "done" | "partial" | "error",
    processed: Number(row["processed"] || 0),
    newChats: Number(row["new_chats"] || 0),
    /** False: first connection or unknown gap, only the seller's existing conversations are completed. */
    includesNewChats: row["window_start"] !== null && row["window_start"] !== undefined,
    nextAt: row["state"] === "pending" ? new Date(Number(row["available_at"])).toISOString() : null,
    updatedAt: String(row["updated_at"]),
    errorCode: row["error_code"] ? String(row["error_code"]) : null,
    hasMore: Boolean(row["has_more"]) || legacyPartial || ["partial", "error"].includes(String(row["state"])),
    failedCount: Number(row["failed_count"] || 0),
  };
}
function canReplyWithWaha(user: SiteUser, config: WahaConfig) {
  if (!config.ownerId) return false;
  return user.id === config.ownerId || (isAdmin(user) && config.allowAdminReplies === true);
}
/** Phone reported by the session (`me`); empty when WAHA did not report a phone address. */
function reportedPhone(info: any) {
  const id = txt(info?.me?.id, 200);
  const fromId = /^\d+(:\d+)?@(c\.us|s\.whatsapp\.net)$/.test(id)
    ? id.split("@")[0]!.split(":")[0]!
    : "";
  const value = phone(fromId || digits(info?.me?.phone));
  return /^\d{12,15}$/.test(value) ? value : "";
}
function numberMatches(config: WahaConfig, info: any) {
  const reported = reportedPhone(info);
  // WhatsApp may report a Brazilian mobile without the 9th digit; it is still the authorized line.
  return (
    Boolean(reported) &&
    samePhone(reported, config.expectedPhone) &&
    !isProtectedPhone(config, reported)
  );
}
/** True only when WAHA reported a phone that is not the line's authorized number (or is protected). */
function pairedWithAnotherPhone(config: WahaConfig, info: any) {
  const reported = reportedPhone(info);
  return (
    Boolean(reported) &&
    (!samePhone(reported, config.expectedPhone) || isProtectedPhone(config, reported))
  );
}
/** A phone that is not the line's number never stays linked: the session is logged out at once. */
async function rejectAnotherPhone(config: WahaConfig, actorId: string | null) {
  try {
    await unlinkSession(config);
  } catch {
    /* The state stays "number_mismatch" and the next check tries again. */
  }
  audit(actorId, "crm:waha:session:wrong-number", config.lineId);
}
const stateMessages: Record<string, string> = {
  WORKING: "WhatsApp conectado pelo WAHA.",
  STOPPED: "WhatsApp desconectado. As conversas continuam guardadas no CRM.",
  STARTING: "A sessão WAHA está iniciando.",
  SCAN_QR_CODE: "Aguardando leitura do QR Code pelo número autorizado.",
  FAILED: "A sessão WAHA falhou. Confira a conexão e solicite uma reconexão.",
  PASSKEY_REQUIRED: "O WhatsApp solicitou uma confirmação adicional de autenticação.",
  PASSKEY_CONFIRMATION_REQUIRED:
    "Confirme a autenticação solicitada no aparelho do número autorizado.",
};
const wrongPhoneMessage =
  "O WhatsApp conectado não é o número autorizado desta linha. A conexão foi desfeita automaticamente; conecte com o celular do número autorizado.";
/** A stopped line is "paused" when the CRM paused it (phone still linked) or "unlinked" (new QR). */
function displayedState(state: string, reconnection: Row | undefined) {
  if (state === "STOPPED" && reconnection?.["mode"] === "paused")
    return { state: "PAUSED", message: pausedMessage };
  if (state === "STOPPED" && reconnection?.["mode"] === "unlinked")
    return { state, message: unlinkedMessage };
  return { state, message: stateMessages[state] || "Aguardando conclusão da conexão WAHA." };
}
/** State of one line as seen by `user` (its seller, or an administrator in supervision). */
async function lineConnection(user: SiteUser, config: WahaConfig) {
  const admin = isAdmin(user);
  const reconnection = recoveryOf(config.session);
  const common = {
    /** Catch-up after the last reconnection (counts only). */
    recovery: recoverySummary(reconnection),
    provider: "waha" as const,
    canManage: admin,
    lineId: config.lineId,
    /** The seller connects, disconnects and reconnects her own number; administrators may help. */
    canControl: admin || user.id === config.ownerId,
    ownLine: user.id === config.ownerId,
    instance: admin ? config.session : null,
    session: config.session,
    capabilities: { media: true, history: true },
    // Only the responsible seller replies by default; administrators supervise.
    canReply: canReplyWithWaha(user, config),
    canSyncConversation:
      Boolean(config.ownerId) && (user.id === config.ownerId || admin),
    // Portfolio served by this number (shown only to who may act on it).
    responsibleId: user.id === config.ownerId || admin ? config.ownerId || null : null,
    phoneHint: phoneHint(config.expectedPhone),
  };
  if (!config.enabled || !config.apiKey || !config.hmacKey)
    return {
      ...common,
      configured: false,
      connected: false,
      state: "unconfigured",
      message:
        "WAHA ainda não configurado. Um administrador pode preparar a conexão nas integrações.",
    };
  if (!config.ownerId)
    return {
      ...common,
      configured: true,
      connected: false,
      state: "owner_required",
      message: "Defina a vendedora responsável antes de conectar o WhatsApp.",
    };
  if (!config.expectedPhone)
    return {
      ...common,
      configured: true,
      connected: false,
      state: "phone_required",
      message: admin
        ? "Defina o número autorizado desta linha antes de conectar o WhatsApp."
        : "Seu número de WhatsApp ainda não foi informado. Peça ao administrador para cadastrá-lo.",
    };
  if (!admin && user.id !== config.ownerId)
    return {
      ...common,
      configured: true,
      connected: false,
      state: "portfolio_unavailable",
      message:
        "O número WAHA está destinado à vendedora configurada. Sua carteira não utiliza esta conexão.",
    };
  try {
    validateOwner(config.ownerId);
    const result = await sessionState(config),
      state = txt(result.status, 80) || "STOPPED";
    if (state === "WORKING" && !numberMatches(config, result)) {
      const another = pairedWithAnotherPhone(config, result);
      if (another) await rejectAnotherPhone(config, user.id);
      return {
        ...common,
        configured: true,
        connected: false,
        state: "number_mismatch",
        message: another
          ? wrongPhoneMessage
          : "A sessão não corresponde ao número autorizado. Envio e recebimento comercial estão bloqueados.",
      };
    }
    const shown = displayedState(state, reconnection);
    return {
      ...common,
      configured: true,
      connected: state === "WORKING",
      state: shown.state,
      message: shown.message,
    };
  } catch (error) {
    if (error instanceof WahaHttpError && error.status === 404)
      return {
        ...common,
        configured: true,
        connected: false,
        state: "STOPPED",
        message: common.canControl
          ? "WhatsApp ainda não conectado. Use Conectar para ler o QR Code."
          : "Sessão ainda não criada.",
      };
    return {
      ...common,
      configured: true,
      connected: false,
      state: "error",
      message:
        error instanceof WahaHttpError && [401, 403].includes(error.status)
          ? "O WAHA recusou a credencial configurada."
          : error instanceof Error && /vendedora ativa/.test(error.message)
            ? "A vendedora desta linha está inativa. Um administrador deve desativar ou revisar a linha."
            : "Não foi possível verificar o WAHA. Confira o serviço e a configuração.",
    };
  }
}
type LineSummary = {
  lineId: string;
  ownerId: string;
  ownerName: string;
  connected: boolean;
  state: string;
  message: string;
  canReply: boolean;
  canSyncConversation: boolean;
  phoneHint: string | null;
  recovery: ReturnType<typeof recoverySummary>;
};
/** Administrators without a line of their own: every seller's line, read with one WAHA request. */
async function supervisionConnection(user: SiteUser, config: WahaSettings, lines: WahaLine[]) {
  const common = {
    provider: "waha" as const,
    canManage: true,
    lineId: null,
    canControl: true,
    ownLine: false,
    instance: null,
    session: null,
    capabilities: { media: true, history: true },
    canReply: false,
    canSyncConversation: true,
    responsibleId: null,
    phoneHint: null,
    recovery: null,
  };
  if (!config.enabled || !config.apiKey || !config.hmacKey)
    return {
      ...common,
      configured: false,
      connected: false,
      state: "unconfigured",
      message:
        "WAHA ainda não configurado. Um administrador pode preparar a conexão nas integrações.",
      lines: [] as LineSummary[],
    };
  if (!lines.length)
    return {
      ...common,
      configured: true,
      connected: false,
      state: "line_required",
      message: "Cadastre a linha de WhatsApp de cada vendedora nas integrações.",
      lines: [] as LineSummary[],
    };
  const sessions = new Map<string, any>();
  let failed = false;
  try {
    const list = await (await api(config, "/api/sessions?all=true")).json();
    for (const item of Array.isArray(list) ? list : []) sessions.set(String(item?.name), item);
  } catch {
    failed = true;
  }
  const summaries: LineSummary[] = [];
  for (const line of lines) {
    const lineConfig = withLine(config, line),
      info = sessions.get(line.session),
      reconnection = recoveryOf(line.session);
    let state = failed ? "error" : txt(info?.status, 80) || "STOPPED",
      message = failed
        ? "Não foi possível verificar o WAHA. Confira o serviço e a configuração."
        : info
          ? stateMessages[state] || "Aguardando conclusão da conexão WAHA."
          : "WhatsApp ainda não conectado pela vendedora.";
    if (info && !failed) ({ state, message } = displayedState(state, reconnection));
    if (!line.expectedPhone) {
      state = "phone_required";
      message = "Defina o número autorizado desta linha antes de conectar o WhatsApp.";
    } else if (state === "WORKING" && !numberMatches(lineConfig, info)) {
      const another = pairedWithAnotherPhone(lineConfig, info);
      if (another) await rejectAnotherPhone(lineConfig, user.id);
      state = "number_mismatch";
      message = another
        ? wrongPhoneMessage
        : "A sessão não corresponde ao número autorizado. Envio e recebimento comercial estão bloqueados.";
    }
    summaries.push({
      lineId: line.id,
      ownerId: line.userId,
      ownerName: userSummary(line.userId).name,
      connected: state === "WORKING",
      state,
      message,
      canReply: canReplyWithWaha(user, lineConfig),
      canSyncConversation: true,
      phoneHint: phoneHint(line.expectedPhone),
      recovery: recoverySummary(reconnection),
    });
  }
  const connected = summaries.filter((item) => item.connected).length;
  return {
    ...common,
    configured: true,
    connected: connected > 0,
    state: "supervision",
    message: `${connected} de ${summaries.length} linha(s) de WhatsApp conectada(s). Administradores acompanham as conversas${config.allowAdminReplies ? " e podem responder pela linha de cada vendedora." : " sem responder."}`,
    lines: summaries,
  };
}
const summaryOf = (
  connection: Awaited<ReturnType<typeof lineConnection>>,
  line: WahaLine,
): LineSummary => ({
  lineId: line.id,
  ownerId: line.userId,
  ownerName: userSummary(line.userId).name,
  connected: connection.connected,
  state: connection.state,
  message: connection.message,
  canReply: connection.canReply,
  canSyncConversation: connection.canSyncConversation,
  phoneHint: connection.phoneHint,
  recovery: connection.recovery,
});
/**
 * Connection shown in the CRM. A seller sees her own line; an administrator sees her own line (if
 * she sells too) or the single line, plus `lines` with every seller's line for supervision.
 */
export async function readWahaConnection(actor: SiteUser) {
  const user = commercial(actor),
    { config } = configuration();
  const own = activeLineOf(user.id);
  if (!isAdmin(user)) {
    if (own) return lineConnection(user, withLine(config, own));
    return {
      provider: "waha" as const,
      canManage: false,
      lineId: null,
      canControl: false,
      ownLine: false,
      instance: null,
      session: null,
      capabilities: { media: true, history: true },
      canReply: false,
      canSyncConversation: false,
      responsibleId: null,
      phoneHint: null,
      configured: false,
      connected: false,
      state: config.enabled ? "line_required" : "unconfigured",
      message: config.enabled
        ? "Seu número de WhatsApp ainda não foi cadastrado. Peça ao administrador para cadastrá-lo."
        : "WAHA ainda não configurado. Um administrador pode preparar a conexão nas integrações.",
    };
  }
  const lines = activeLines();
  const single = own || (lines.length === 1 ? lines[0]! : null);
  if (!single) return supervisionConnection(user, config, lines);
  const main = await lineConnection(user, withLine(config, single));
  const others = lines.filter((line) => line.id !== single.id);
  const rest = others.length
    ? (await supervisionConnection(user, config, others)).lines
    : ([] as LineSummary[]);
  return { ...main, lines: [summaryOf(main, single), ...rest] };
}
function managedSessionConfig(config: WahaConfig, current: any = {}) {
  const existingHooks = Array.isArray(current.webhooks)
    ? current.webhooks.filter((hook: any) => hook.url !== webhookUrl())
    : [];
  return {
    ...current,
    debug: false,
    noweb: {
      ...(current.noweb || {}),
      store: {
        ...(current.noweb?.store || {}),
        enabled: true,
        fullSync: current.noweb?.store?.fullSync ?? false,
      },
    },
    ignore: { ...(current.ignore || {}), groups: true, status: true, channels: true },
    webhooks: [
      ...existingHooks,
      {
        url: webhookUrl(),
        events: ["message.any", "message.ack", "session.status"],
        hmac: { key: config.hmacKey },
        retries: { policy: "constant", delaySeconds: 2, attempts: 15 },
      },
    ],
  };
}
type WahaQrResult = {
  state: string;
  message: string;
  qrCode?: string;
  fetchedAt?: string;
  refreshAfterMs?: number;
  retryAfterMs?: number;
  requiresRestart?: boolean;
  requiresStart?: boolean;
  connected?: boolean;
};
const sessionMutations = new Map<string, symbol>();
const sessionControlKey = (config: WahaConfig) => `${config.baseUrl}\0${config.session}`;
class WahaSessionControlError extends Error {}
function sessionCommunicationMessage(error: unknown) {
  if (error instanceof WahaHttpError && [401, 403].includes(error.status))
    return "O WAHA recusou a credencial configurada. Revise a chave de acesso nas integrações.";
  if (error instanceof WahaHttpError && error.status === 429)
    return "O WAHA limitou as solicitações. Aguarde antes de tentar novamente.";
  return "Não foi possível comunicar com o WAHA. Confira o serviço e tente novamente.";
}
const preparingQr = (
  message = "A sessão está preparando o QR Code. Aguarde alguns instantes.",
): WahaQrResult => ({ state: "STARTING", message, retryAfterMs: 1500 });
async function qrSessionState(
  user: SiteUser,
  config: WahaConfig,
  info: any,
): Promise<WahaQrResult | null> {
  const state = txt(info?.status, 80) || "STOPPED";
  if (state === "SCAN_QR_CODE") return null;
  if (state === "WORKING") return lineConnection(user, config);
  if (state === "STARTING") return preparingQr();
  if (["STOPPED", "FAILED"].includes(state))
    return {
      state,
      requiresRestart: true,
      message:
        "O QR Code expirou ou a sessão foi interrompida. Use Reconectar para preparar um novo código.",
    };
  return {
    state,
    message:
      "O WhatsApp está aguardando uma confirmação de autenticação. Consulte o estado da conexão e confira o aparelho do número autorizado.",
  };
}
async function readWahaQr(user: SiteUser, config: WahaConfig): Promise<WahaQrResult> {
  if (sessionMutations.has(sessionControlKey(config)))
    return preparingQr(
      "Uma operação da sessão está em andamento. Aguarde antes de visualizar o QR Code.",
    );
  try {
    const state = await qrSessionState(user, config, await sessionState(config));
    if (state) return state;
    // A lifecycle operation may have started while the read-only status request awaited.
    if (sessionMutations.has(sessionControlKey(config))) return preparingQr();
    let result: any;
    try {
      result = await (
        await api(config, `/api/${encodeURIComponent(config.session)}/auth/qr`, {
          accept: "application/json",
        })
      ).json();
    } catch (error) {
      if (!(error instanceof WahaHttpError) || ![400, 422].includes(error.status)) throw error;
      const latest = await qrSessionState(user, config, await sessionState(config));
      return (
        latest || {
          state: "SCAN_QR_CODE",
          message:
            "O WAHA está renovando o QR Code. Aguarde alguns instantes para tentar a leitura novamente.",
          retryAfterMs: 1500,
        }
      );
    }
    if (sessionMutations.has(sessionControlKey(config))) return preparingQr();
    const data = txt(result.data || result.base64, 300_000),
      candidate = data.startsWith("data:") ? data : `data:image/png;base64,${data}`;
    const validPng =
      /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(candidate) &&
      Buffer.from(candidate.slice("data:image/png;base64,".length), "base64")
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!validPng)
      return {
        state: "SCAN_QR_CODE",
        message:
          "O WAHA ainda não disponibilizou uma imagem válida do QR Code. Aguarde antes de tentar novamente.",
        retryAfterMs: 1500,
      };
    return {
      qrCode: candidate,
      state: "SCAN_QR_CODE",
      message: "Leia com o WhatsApp do número autorizado.",
      fetchedAt: now(),
      refreshAfterMs: 10_000,
    };
  } catch (error) {
    if (error instanceof WahaHttpError && error.status === 404)
      return {
        state: "STOPPED",
        requiresStart: true,
        message: "A sessão ainda não foi criada. Use Conectar antes de visualizar o QR Code.",
      };
    return { state: "error", message: sessionCommunicationMessage(error) };
  }
}
/**
 * Connect or resume (start), reconnect (restart), QR, status, pause (stop, phone stays linked) and
 * unlink (logout) of a line. Sellers act on their own line only, as often as they need;
 * administrators may act on any line and also reapply the receiving configuration (configure).
 */
export async function controlWahaSession(
  actor: SiteUser,
  input: {
    action: "start" | "restart" | "qr" | "configure" | "status" | "pause" | "logout";
    lineId?: string | undefined;
  },
) {
  const user = commercial(actor),
    { config: settings } = configuration();
  if (input.action === "configure" && !isAdmin(user)) throw new Error("Forbidden");
  const config = withLine(settings, resolveLine(user, input.lineId));
  if (input.action === "status") return lineConnection(user, config);
  if (input.action === "logout") return disconnectLine(user, config);
  if (input.action === "pause") return pauseLine(user, config);
  requireConfigured(config);
  if (input.action === "qr") return readWahaQr(user, config);
  const key = sessionControlKey(config);
  if (sessionMutations.has(key))
    throw new WahaSessionControlError(
      "Uma operação desta sessão já está em andamento. Aguarde antes de tentar novamente.",
    );
  const operation = Symbol();
  sessionMutations.set(key, operation);
  try {
    let existing: any;
    try {
      existing = await sessionState(config);
    } catch (error) {
      if (!(error instanceof WahaHttpError) || error.status !== 404) throw error;
    }
    if (!existing) {
      await api(config, "/api/sessions", {
        method: "POST",
        body: { name: config.session, start: false, config: managedSessionConfig(config) },
      });
    } else {
      if (existing.status === "WORKING" && pairedWithAnotherPhone(config, existing)) {
        await rejectAnotherPhone(config, user.id);
        throw new WahaSessionControlError(wrongPhoneMessage);
      }
      if (existing.status === "WORKING" && !numberMatches(config, existing))
        throw new WahaSessionControlError(
          "A sessão está vinculada a um número diferente do número autorizado.",
        );
      if (existing.status === "WORKING" && existing.config?.noweb?.store?.enabled !== true)
        throw new WahaSessionControlError(
          "Esta sessão foi pareada sem armazenamento de histórico. Prepare uma nova sessão antes do pareamento.",
        );
      await api(config, sessionPath(config), {
        method: "PUT",
        body: { name: config.session, config: managedSessionConfig(config, existing.config || {}) },
      });
    }
    if (input.action !== "configure")
      await api(config, `${sessionPath(config)}/${input.action}`, { method: "POST", body: {} });
    audit(user.id, `crm:waha:session:${input.action}`, config.lineId);
    return lineConnection(user, config);
  } catch (error) {
    if (error instanceof WahaSessionControlError) throw error;
    throw new Error(sessionCommunicationMessage(error));
  } finally {
    if (sessionMutations.get(key) === operation) sessionMutations.delete(key);
  }
}
/** Current WAHA state of a line; null when the session was never created. */
async function sessionStateOrNull(config: WahaConfig) {
  try {
    return await sessionState(config);
  } catch (error) {
    if (error instanceof WahaHttpError && error.status === 404) return null;
    throw error;
  }
}
/** Runs one lifecycle operation of a line at a time (connect, pause, unlink). */
async function withSessionMutation<T>(config: WahaConfig, work: () => Promise<T>) {
  if (!config.enabled || !config.apiKey || !config.hmacKey)
    throw new Error("Configure as credenciais do WAHA.");
  const key = sessionControlKey(config);
  if (sessionMutations.has(key))
    throw new WahaSessionControlError(
      "Uma operação desta sessão já está em andamento. Aguarde antes de tentar novamente.",
    );
  const operation = Symbol();
  sessionMutations.set(key, operation);
  try {
    return await work();
  } catch (error) {
    if (error instanceof WahaSessionControlError) throw error;
    throw new Error(sessionCommunicationMessage(error));
  } finally {
    if (sessionMutations.get(key) === operation) sessionMutations.delete(key);
  }
}
const pausedMessage =
  "WhatsApp pausado: o celular continua vinculado e nada foi apagado. Use Retomar para voltar sem QR Code; o que chegar enquanto estiver pausado entra no CRM quando a conexão voltar.";
const unlinkedMessage =
  "Aparelho desvinculado do CRM. As conversas continuam guardadas; para voltar, use Conectar e leia um novo QR Code.";
/**
 * "Pausar": stops the session and keeps the phone linked (no QR to come back). WhatsApp keeps what
 * arrives meanwhile and delivers it when the line resumes; the catch-up covers anything missing.
 */
async function pauseLine(user: SiteUser, config: WahaConfig) {
  await withSessionMutation(config, async () => {
    const info = await sessionStateOrNull(config);
    if (info?.status !== "WORKING")
      throw new WahaSessionControlError("Só é possível pausar um WhatsApp conectado.");
    if (pairedWithAnotherPhone(config, info)) {
      await rejectAnotherPhone(config, user.id);
      throw new WahaSessionControlError(wrongPhoneMessage);
    }
    await api(config, `${sessionPath(config)}/stop`, { method: "POST", body: {} });
    markOffline(config.session, "paused", true);
    audit(user.id, "crm:waha:session:pause", config.lineId);
  });
  return { ...(await lineConnection(user, config)), message: pausedMessage };
}
/**
 * "Desvincular aparelho": unlinks the phone (logout) and stops the session; coming back needs a new
 * QR Code. Nothing stored in the CRM is removed.
 */
async function disconnectLine(user: SiteUser, config: WahaConfig) {
  const outcome = await withSessionMutation(config, async () => {
    const info = await sessionStateOrNull(config);
    const online = info?.status === "WORKING" && !pairedWithAnotherPhone(config, info);
    const paused = info?.status === "STOPPED" && recoveryOf(config.session)?.["mode"] === "paused";
    const removed = await unlinkSession(config, { resumeFirst: paused });
    // Cancelling a QR Code that was never read unlinks nothing: no "unlinked" label then.
    markOffline(config.session, online || paused ? "unlinked" : null, online);
    audit(user.id, "crm:waha:session:logout", config.lineId, { fromPause: paused, confirmed: removed });
    return { removed, linked: online || paused };
  });
  const connection = await lineConnection(user, config);
  return {
    ...connection,
    message: !outcome.linked
      ? "Conexão cancelada. As conversas continuam guardadas; use Conectar quando quiser ler o QR Code."
      : outcome.removed
        ? unlinkedMessage
        : "O acesso do CRM foi removido. Se o aparelho ainda aparecer no celular, remova-o em WhatsApp → Aparelhos conectados. As conversas continuam guardadas.",
  };
}
async function requireReady(actor: SiteUser, config: WahaConfig) {
  requireConfigured(config);
  const connection = await lineConnection(actor, config);
  if (!connection.connected) throw new Error(connection.message);
}
/** Registered WhatsApp address of a phone (`check-exists`), so sends never target a spelling that does not exist. */
async function resolveRecipientChat(config: WahaConfig, number: string) {
  const unconfirmed =
    "Não foi possível confirmar o número no WhatsApp. Nada foi enviado; tente novamente.";
  let result: any;
  try {
    result = await (
      await api(
        config,
        `/api/contacts/check-exists?session=${encodeURIComponent(config.session)}&phone=${encodeURIComponent(number)}`,
      )
    ).json();
  } catch (error) {
    throw new Error(
      error instanceof WahaHttpError && [401, 403].includes(error.status)
        ? "O WAHA recusou a credencial configurada. Nada foi enviado."
        : unconfirmed,
    );
  }
  if (result?.numberExists === false)
    throw new Error(
      "Este telefone não está no WhatsApp. Confira o número do contato; nada foi enviado.",
    );
  const chatId = txt(result?.chatId, 200).replace(/@s\.whatsapp\.net$/, "@c.us");
  if (!/^\d{8,20}@(c\.us|lid)$/.test(chatId)) throw new Error(unconfirmed);
  return chatId;
}
async function boundedBody(response: Response, max: number) {
  if (Number(response.headers.get("content-length") || 0) > max) {
    await response.body?.cancel();
    throw new Error("media_too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty_body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error("body_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function sendWahaMessage(
  actor: SiteUser,
  input: {
    contactId: string;
    text?: string | undefined;
    attachmentIds?: string[] | undefined;
    clientMessageId: string;
  },
) {
  const user = commercial(actor),
    contact = requireCrmContact(user, input.contactId),
    { config: settings } = configuration();
  // Each contact is answered through the line of the seller who owns it.
  const line = settings.enabled ? activeLineOf(contact.ownerId) : null;
  if (!line)
    throw new Error("A vendedora responsável por este contato não tem uma linha de WhatsApp ativa.");
  const config = withLine(settings, line);
  requireConfigured(config);
  if (!canReplyWithWaha(user, config))
    throw new Error(
      "Somente a vendedora responsável responde por este número. O administrador acompanha a conversa sem responder.",
    );
  const context = await readWahaContactContext(user, contact.id);
  if (context?.triageReason && context.triageReason !== "multiple_open_opportunities")
    throw new Error("Revise a identificação deste contato antes de enviar mensagens.");
  const text = (input.text || "").trim(),
    ids = input.attachmentIds || [];
  if (text.length > 4000 || ids.length > 1 || (!text && !ids.length))
    throw new Error("Envie uma mensagem ou um anexo por vez, com até 4.000 caracteres.");
  const number = phone(contact.phone);
  if (!/^\d{12,15}$/.test(number))
    throw new Error("Cadastre o telefone do contato com DDD e DDI válidos.");
  if (!z.string().uuid().safeParse(input.clientMessageId).success)
    throw new Error("Identificador de envio inválido.");
  const db = ensureWahaSchema(),
    hash = createHash("sha256")
      .update(JSON.stringify({ contactId: contact.id, session: config.session, text, ids }))
      .digest("hex");
  const previous = db
    .prepare("SELECT * FROM crm_waha_outbox WHERE actor_id=? AND request_key=?")
    .get(user.id, input.clientMessageId);
  if (previous) {
    if (previous["body_hash"] !== hash)
      throw new Error("Identificador de envio já utilizado para outra mensagem.");
    if (previous["state"] === "sent") return { id: String(previous["message_id"]), status: "sent" };
    throw new Error("Este envio já foi iniciado. Confira a conversa antes de repetir.");
  }
  const mediaModule = ids.length ? await import("./crm-media.server.ts") : null;
  const attachment = ids[0] ? mediaModule!.getCrmMediaForSend(user, ids[0]) : null;
  if (attachment && attachment.contactId !== contact.id)
    throw new Error("O anexo não pertence a este contato.");
  if (attachment?.mimeType.startsWith("audio/") && text)
    throw new Error("Envie o áudio e o texto em mensagens separadas. Áudios não aceitam legenda.");
  await requireReady(user, config);
  // Ask WhatsApp for the registered address first (e.g. Brazilian mobiles without the 9th digit).
  // Nothing is sent and no outbox row exists if this lookup fails, so a retry is safe.
  const chatId = await resolveRecipientChat(config, number);
  const id = randomUUID();
  try {
    db.prepare(
      "INSERT INTO crm_waha_outbox(id,actor_id,contact_id,session,request_key,body_hash,encrypted,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'sending',?,?)",
    ).run(
      id,
      user.id,
      contact.id,
      config.session,
      input.clientMessageId,
      hash,
      encrypt({ text, ids }),
      now(),
      now(),
    );
  } catch {
    throw new Error("Este envio já foi iniciado. Confira a conversa antes de repetir.");
  }
  try {
    let path = "/api/sendText",
      body: Row = { session: config.session, chatId, text, linkPreview: false };
    if (attachment) {
      let bytes = attachment.bytes,
        mimetype = attachment.mimeType,
        filename = attachment.name;
      const isImage = mimetype.startsWith("image/"),
        isAudio = mimetype.startsWith("audio/");
      if (isImage && mimetype !== "image/jpeg") {
        const sharp = (await import("sharp")).default;
        bytes = await sharp(bytes, { limitInputPixels: 25_000_000 })
          .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 90 })
          .toBuffer();
        mimetype = "image/jpeg";
        filename = filename.replace(/\.[^.]+$/, "") + ".jpg";
      }
      path = isImage ? "/api/sendImage" : isAudio ? "/api/sendVoice" : "/api/sendFile";
      body = {
        session: config.session,
        chatId,
        caption: text,
        file: { mimetype, filename, data: bytes.toString("base64") },
        ...(isAudio ? { convert: true } : {}),
      };
    }
    const response = await api(config, path, {
      method: "POST",
      body,
      timeout: attachment ? 45_000 : 15_000,
    });
    const result = (await response.json()) as any,
      // WEBJS returns `id`; NOWEB returns the raw WhatsApp message with `key.id`.
      externalId = canonicalMessageId(result?.id, true) || canonicalMessageId(result?.key, true);
    if (!externalId || externalId.length > 240) throw new Error("missing_message_id");
    const { ingestWahaMessage } = await import("./crm-whatsapp-store.server.ts");
    const stored = ingestWahaMessage({
      session: config.session,
      externalId,
      chatId,
      phone: number,
      name: contact.name,
      from: "vendedora",
      text:
        text ||
        (attachment?.mimeType.startsWith("image/")
          ? "[Imagem]"
          : attachment?.mimeType.startsWith("audio/")
            ? "[Áudio]"
            : "[Documento]"),
      at: now(),
      status: "sent",
      historical: false,
      ownerId: config.ownerId,
    });
    if (ids.length) mediaModule!.bindCrmMediaToMessage(user, ids, stored.message.id);
    db.prepare(
      "UPDATE crm_waha_outbox SET state='sent',external_id=?,message_id=?,updated_at=? WHERE id=?",
    ).run(externalId, stored.message.id, now(), id);
    applyEarlyFailure(config.session, externalId);
    audit(user.id, "crm:waha:sent", contact.id, { media: Boolean(attachment) });
    return { id: stored.message.id, status: "sent" };
  } catch {
    db.prepare(
      "UPDATE crm_waha_outbox SET state='uncertain',error_code='send_unconfirmed',updated_at=? WHERE id=?",
    ).run(now(), id);
    audit(user.id, "crm:waha:send:uncertain", contact.id);
    throw new Error(
      "Não foi possível confirmar o envio pelo WAHA. Confira a conversa no aparelho antes de repetir; não haverá reenvio automático.",
    );
  }
}
function equalSignature(a: string, b: string) {
  return (
    Boolean(a && b) &&
    timingSafeEqual(
      createHash("sha256").update(a).digest(),
      createHash("sha256").update(b).digest(),
    )
  );
}
export async function handleWahaWebhook(request: Request) {
  const { config } = configuration();
  if (!config.enabled || !config.hmacKey)
    return Response.json({ error: "not_configured" }, { status: 503, headers: privateHeaders });
  const algorithm = request.headers.get("x-webhook-hmac-algorithm");
  if (algorithm?.toLowerCase() !== "sha512")
    return Response.json({ error: "unauthorized" }, { status: 401, headers: privateHeaders });
  let bytes: Buffer;
  try {
    bytes = await boundedBody(new Response(request.body), MAX_EVENT);
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 413, headers: privateHeaders });
  }
  const signature = request.headers.get("x-webhook-hmac") || "",
    expected = createHmac("sha512", config.hmacKey).update(bytes).digest("hex");
  if (!equalSignature(signature, expected))
    return Response.json({ error: "unauthorized" }, { status: 401, headers: privateHeaders });
  let value: any;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400, headers: privateHeaders });
  }
  // Every seller's session posts to the same address; only active lines are accepted.
  const line = activeLineBySession(value?.session);
  if (
    !line ||
    !["message.any", "message.ack", "session.status"].includes(value.event) ||
    !value.payload ||
    typeof value.payload !== "object"
  )
    return Response.json({ error: "invalid_event" }, { status: 400, headers: privateHeaders });
  // Events are encrypted, limited and isolated from the legacy worker. Never retain transport credentials.
  const payload = JSON.parse(
    JSON.stringify(
      { event: value.event, session: value.session, me: value.me || null, payload: value.payload },
      (name, item) =>
        /^(apikey|api_key|access_token|authorization|token|hmac)$/i.test(name) ? undefined : item,
    ),
  );
  const externalId = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const result = ensureWahaSchema()
    .prepare(
      "INSERT OR IGNORE INTO crm_waha_events(id,external_id,session,event_type,encrypted,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      randomUUID(),
      externalId,
      line.session,
      value.event,
      encrypt(payload),
      Date.now(),
      now(),
      now(),
    );
  startWahaWorker();
  if (process.env["CRM_DISABLE_WORKER"] !== "1") void drainWahaEvents();
  return Response.json(
    { received: true, duplicate: !Number(result.changes) },
    { status: 202, headers: privateHeaders },
  );
}
function ackStatus(value: unknown) {
  const text = String(value).toUpperCase(),
    mapping: Record<string, string> = {
      "0": "pending",
      PENDING: "pending",
      "1": "sent",
      SERVER: "sent",
      "2": "delivered",
      DEVICE: "delivered",
      "3": "read",
      READ: "read",
      "4": "played",
      PLAYED: "played",
    };
  return mapping[text] || null;
}
function applyEarlyFailure(session: string, externalId: string) {
  const db = ensureWahaSchema();
  if (
    db
      .prepare("SELECT 1 FROM crm_waha_status_errors WHERE session=? AND external_id=?")
      .get(session, externalId)
  )
    db.prepare(
      "UPDATE crm_messages SET status='failed' WHERE provider='waha' AND account=? AND external_id=? AND sender='vendedora' AND status NOT IN ('delivered','read','played')",
    ).run(session, externalId);
}
async function resolveIdentity(config: WahaConfig, chatId: string, payload: any) {
  let number = chatId.endsWith("@c.us") ? phone(chatId.split("@")[0]) : "";
  if (chatId.endsWith("@lid")) {
    // NOWEB already sends the phone address of a LID conversation as `remoteJidAlt`.
    const alternate = txt(payload?._data?.key?.remoteJidAlt, 200);
    if (/^\d+(:\d+)?@(s\.whatsapp\.net|c\.us)$/.test(alternate))
      number = phone(alternate.split("@")[0]!.split(":")[0]);
  }
  if (chatId.endsWith("@lid") && !number) {
    try {
      const resolved = (await (
        await api(
          config,
          `/api/${encodeURIComponent(config.session)}/lids/${encodeURIComponent(chatId)}`,
        )
      ).json()) as any;
      number = phone((resolved.pn || "").split("@")[0]);
    } catch {
      /* Preserve unresolved identity for explicit triage. */
    }
  }
  if (number && !/^\d{12,15}$/.test(number)) number = "";
  let name = payload.fromMe
    ? ""
    : txt(payload.pushName || payload._data?.pushName || payload._data?.notifyName, 200);
  if (!name) {
    try {
      const contact = (await (
        await api(
          config,
          `/api/contacts?session=${encodeURIComponent(config.session)}&contactId=${encodeURIComponent(chatId)}`,
        )
      ).json()) as any;
      name = txt(contact.name || contact.pushname, 200);
    } catch {
      /* Contact names are optional; never invent one. */
    }
  }
  return { phone: number || undefined, name: name || number || "Contato WhatsApp" };
}
async function downloadMedia(config: WahaConfig, media: any) {
  if (!media?.url) throw new Error("media_unavailable");
  const url = new URL(media.url, config.baseUrl),
    known = new URL(config.baseUrl);
  const localAlias =
    ["localhost", "127.0.0.1"].includes(url.hostname) && (!url.port || url.port === "3000");
  if (
    (url.origin !== known.origin && !localAlias) ||
    url.username ||
    url.password ||
    !url.pathname.startsWith("/api/files/") ||
    url.hash
  )
    throw new Error("unsafe_media_url");
  const response = await api(config, url.pathname + url.search, {
    timeout: 30_000,
    accept: "application/octet-stream",
  });
  return boundedBody(response, MAX_MEDIA);
}
function isOwnAddress(chatId: string, me: any) {
  const clean = (value: unknown) =>
    txt(value, 200)
      .replace(/:\d+(?=@)/, "")
      .replace(/@s\.whatsapp\.net$/, "@c.us");
  return [me?.id, me?.lid].some((item) => Boolean(item) && clean(item) === chatId);
}
async function processMessage(
  config: WahaConfig,
  payload: any,
  historical: boolean,
  identities?: Map<string, Awaited<ReturnType<typeof resolveIdentity>>>,
  me?: any,
  /** recovered: arrived while the line was offline and found after the reconnection. */
  options: { recovered?: boolean } = {},
) {
  const fromMe = payload.fromMe === true;
  // Full id for WAHA API calls; stable id (without the chat address) for CRM records.
  const rawId = typeof payload.id === "string" ? payload.id : payload.id?._serialized;
  const externalId =
    canonicalMessageId(payload.id, fromMe) || canonicalMessageId(payload._data?.key, fromMe);
  if (!externalId || externalId.length > 240) throw new Error("invalid_message_id");
  if (isSystemMessage(payload)) return null;
  // NOWEB has no `to`: the chat is in the serialized id (and `from`), also for messages sent by the phone.
  const chatId = txt(
    payload.chatId ||
      chatFromMessageId(payload.id) ||
      (fromMe ? payload.to : payload.from) ||
      payload._data?.key?.remoteJid,
    200,
  ).replace(/@s\.whatsapp\.net$/, "@c.us");
  if (!/^\d+@(c\.us|lid)$/.test(chatId)) return null; // This CRM handles direct commercial conversations only.
  if (isOwnAddress(chatId, me)) return null; // Notes to self are not customer conversations.
  const identity = identities?.get(chatId) || (await resolveIdentity(config, chatId, payload));
  identities?.set(chatId, identity);
  const body = txt(payload.body, 20000),
    mediaType = txt(payload.media?.mimetype, 100);
  const text =
    body ||
    (payload.hasMedia
      ? mediaType.startsWith("image/")
        ? "[Imagem]"
        : mediaType.startsWith("audio/")
          ? "[Áudio]"
          : "[Documento]"
      : "[Mensagem WhatsApp]");
  const timestamp = Number(payload.timestamp),
    at =
      Number.isFinite(timestamp) && timestamp > 0 && timestamp < Date.now() / 1000 + 86_400
        ? new Date(timestamp * 1000).toISOString()
        : now();
  const { ingestWahaMessage } = await import("./crm-whatsapp-store.server.ts");
  const result = ingestWahaMessage({
    session: config.session,
    externalId,
    chatId,
    ...identity,
    from: fromMe ? "vendedora" : "cliente",
    text,
    at,
    // Delivery codes describe our own messages; customer messages are simply received.
    status: fromMe ? ackStatus(payload.ack) || "sent" : "received",
    historical,
    recovered: options.recovered === true,
    ownerId: config.ownerId,
  });
  if (
    payload.hasMedia &&
    !result.message.attachments?.some((attachment: any) => attachment.status === "ready")
  ) {
    let media = payload.media;
    if (!media?.url) {
      const refreshed = (await (
        await api(
          config,
          `/api/${encodeURIComponent(config.session)}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(rawId || externalId)}?downloadMedia=true`,
        )
      ).json()) as any;
      media = refreshed.media;
    }
    const bytes = await downloadMedia(config, media);
    const { saveIncomingCrmMedia } = await import("./crm-media.server.ts");
    await saveIncomingCrmMedia({
      contactId: result.contactId,
      messageId: result.message.id,
      name: txt(media.filename, 200) || "anexo",
      mimeType: txt(media.mimetype, 100) || "application/octet-stream",
      bytes,
      externalKey: `waha:${config.session}:${externalId}`,
    });
  }
  applyEarlyFailure(config.session, externalId);
  return result;
}
/**
 * After a reconnection the CRM catches up on what arrived while the line was offline. With a known
 * gap (the CRM saw the line leave WORKING) it reads every conversation with activity since then,
 * the seller's and new ones, and records them as if they had arrived live. Without a known gap
 * (first connection of a number) it only completes the seller's existing conversations, as history.
 */
const RECOVERY_DELAY_MS = 120_000;
const RECOVERY_SECOND_PASS_MS = 15 * 60_000;
const RECOVERY_OVERLAP_S = 600;
const RECOVERY_MAX_CHATS = 300;
const RECOVERY_MAX_MESSAGES = 100;
const RECONCILE_INTERVAL_MS = 60_000;
function watermarkOf(session: string) {
  return ensureWahaSchema().prepare("SELECT * FROM crm_waha_watermarks WHERE session=?").get(session) as Row | undefined;
}
function baselineWorkingSession(session: string) {
  const seconds = Math.floor(Date.now() / 1000);
  ensureWahaSchema().prepare("INSERT OR IGNORE INTO crm_waha_watermarks(session,baseline,covered_until,last_probe) VALUES(?,?,?,?)").run(session, seconds, seconds, Date.now());
}
/** Independent of webhook delivery. First observation only sets a baseline, never imports history. */
async function reconcileWorkingLines() {
  const { config: settings } = configuration();
  if (!settings.enabled || !settings.apiKey || !settings.hmacKey) return;
  const db = ensureWahaSchema();
  const lines = activeLines().filter(line => line.expectedPhone && (!watermarkOf(line.session) || Date.now() - Number(watermarkOf(line.session)!["last_probe"]) >= RECONCILE_INTERVAL_MS));
  if (!lines.length) return;
  let list: any;
  try { list = await (await api(settings, "/api/sessions?all=true")).json(); } catch { return; }
  if (!Array.isArray(list)) return;
  const sessions = new Map(list.map((item: any) => [String(item?.name), item]));
  for (const line of lines) {
    const config = withLine(settings, line), info = sessions.get(line.session), marker = watermarkOf(line.session);
    if (marker) db.prepare("UPDATE crm_waha_watermarks SET last_probe=? WHERE session=?").run(Date.now(), line.session);
    try { validateOwner(line.userId); } catch { continue; }
    if (info?.status !== "WORKING" || !numberMatches(config, info)) {
      if (marker && info?.status !== "WORKING" && recoveryOf(line.session)?.["offline_since"] == null) markOffline(line.session, null, true);
      continue;
    }
    if (!marker) { baselineWorkingSession(line.session); continue; }
    const previous = recoveryOf(line.session);
    if (previous && (["partial", "error"].includes(String(previous["state"])) || (["pending", "idle"].includes(String(previous["state"])) && (previous["window_start"] != null || previous["offline_since"] != null)))) {
      if (previous["state"] === "idle") scheduleRecovery(line.session);
      continue;
    }
    const end = Math.floor(Date.now() / 1000);
    if (end <= Number(marker["covered_until"])) continue;
    const start = Math.max(Number(marker["baseline"]), Number(marker["covered_until"]) - RECOVERY_OVERLAP_S);
    db.prepare("INSERT INTO crm_waha_recovery(session,state,passes,cursor,processed,available_at,updated_at,window_start,window_end,new_chats,has_more,failed_count,failure_attempts,mode) VALUES(?,'pending',0,NULL,0,?,?,?,?,0,0,0,0,'reconcile') ON CONFLICT(session) DO UPDATE SET state='pending',passes=0,cursor=NULL,processed=0,available_at=excluded.available_at,updated_at=excluded.updated_at,error_code=NULL,window_start=excluded.window_start,window_end=excluded.window_end,new_chats=0,has_more=0,failed_count=0,failure_attempts=0,mode='reconcile'").run(line.session, Date.now(), now(), start, end);
  }
}
function scheduleRecovery(session: string) {
  const row = recoveryOf(session);
  const gap = row?.["offline_since"]
    ? Math.floor(Number(row["offline_since"]) / 1000) - RECOVERY_OVERLAP_S
    : null;
  // A window not caught up yet (offline again before its catch-up ran) is merged, never lost.
  const kept =
    row && row["state"] !== "done" && row["window_start"] !== null && row["window_start"] !== undefined
      ? Number(row["window_start"])
      : null;
  const rawStart = gap === null ? kept : kept === null ? gap : Math.min(gap, kept);
  // A first connection (or return from a disabled period) never imports the phone's past.
  if (rawStart === null) return;
  const marker = watermarkOf(session);
  const start = marker ? Math.max(Number(marker["baseline"]), rawStart) : rawStart;
  ensureWahaSchema()
    .prepare(
      "INSERT INTO crm_waha_recovery(session,state,passes,cursor,processed,available_at,updated_at,window_start,new_chats,window_end,failed_count,has_more,failure_attempts) VALUES(?,'pending',0,NULL,0,?,?,?,0,?,0,0,0) ON CONFLICT(session) DO UPDATE SET state='pending',passes=0,cursor=NULL,processed=0,new_chats=0,available_at=excluded.available_at,updated_at=excluded.updated_at,error_code=NULL,window_start=excluded.window_start,window_end=excluded.window_end,offline_since=NULL,mode=NULL,failed_count=0,has_more=0,failure_attempts=0",
    )
    .run(session, Date.now() + RECOVERY_DELAY_MS, now(), start, Math.floor(Date.now() / 1000));
}
async function processEvent(payload: any) {
  const { config: settings } = configuration();
  const line = settings.enabled ? activeLineBySession(payload.session) : null;
  if (!line) throw new Error("session_mismatch");
  const config = withLine(settings, line);
  if (payload.event === "session.status") {
    const db = ensureWahaSchema(),
      state = txt(payload.payload.status, 80) || "UNKNOWN";
    const runtime = db
      .prepare("SELECT state,error_code FROM crm_waha_runtime WHERE session=?")
      .get(config.session);
    const previous = runtime?.["state"];
    // Online = WORKING with the line's own number (a rejected phone never opens a gap).
    const wasOnline = previous === "WORKING" && !runtime?.["error_code"];
    const info = { me: payload.payload.me || payload.me };
    const another = state === "WORKING" && pairedWithAnotherPhone(config, info);
    db.prepare(
      "INSERT INTO crm_waha_runtime VALUES(?,?,?,?) ON CONFLICT(session) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,error_code=excluded.error_code",
    ).run(config.session, state, now(), another ? "number_mismatch" : null);
    if (another) await rejectAnotherPhone(config, null);
    else if (state === "WORKING" && previous !== "WORKING") {
      if (numberMatches(config, info)) baselineWorkingSession(config.session);
      scheduleRecovery(config.session);
    }
    else if (state !== "WORKING" && wasOnline) markOffline(config.session, null, true);
    return;
  }
  requireConfigured(config);
  if (payload.me?.id) {
    if (!numberMatches(config, payload)) throw new Error("number_mismatch");
  } else {
    const current = await sessionState(config);
    if (!numberMatches(config, current)) throw new Error("number_mismatch");
  }
  if (payload.event === "message.ack") {
    // ACKs may address the chat by LID while the message was sent to the phone address.
    const externalId = canonicalMessageId(
        payload.payload.id ?? payload.payload.messageId,
        payload.payload.fromMe === true,
      ),
      status = ackStatus(payload.payload.ack ?? payload.payload.ackName);
    if (!externalId) throw new Error("invalid_message_id");
    if (status) {
      if (status !== "pending")
        getDb()
          .prepare("DELETE FROM crm_waha_status_errors WHERE session=? AND external_id=?")
          .run(config.session, externalId);
      updateCrmMessageStatus({ provider: "waha", account: config.session, externalId, status });
    } else if (String(payload.payload.ack) === "-1" || payload.payload.ackName === "ERROR") {
      getDb()
        .prepare(
          "INSERT INTO crm_waha_status_errors VALUES(?,?,'provider_error',?) ON CONFLICT(session,external_id) DO UPDATE SET error_code='provider_error',created_at=excluded.created_at",
        )
        .run(config.session, externalId, now());
      getDb()
        .prepare(
          "UPDATE crm_waha_outbox SET error_code='provider_error',updated_at=? WHERE session=? AND external_id=?",
        )
        .run(now(), config.session, externalId);
      applyEarlyFailure(config.session, externalId);
    }
    return;
  }
  await processMessage(config, payload.payload, false, undefined, payload.me);
}
/** One bounded page; the fixed end prevents new live messages from shifting offsets. */
async function windowMessages(config: WahaConfig, chatId: string, since: number, pageOffset = 0, until = Math.floor(Date.now() / 1000)) {
  const list: any[] = [];
  let more = false;
  for (let offset = pageOffset; offset < pageOffset + RECOVERY_MAX_MESSAGES; offset += 25) {
    const response = await (await api(config, `/api/${encodeURIComponent(config.session)}/chats/${encodeURIComponent(chatId)}/messages?limit=25&offset=${offset}&filter.timestamp.gte=${since}&filter.timestamp.lte=${until}&downloadMedia=false`)).json() as any;
    const page = Array.isArray(response) ? response : response?.messages || response?.data;
    if (!Array.isArray(page)) throw new Error("invalid_history");
    list.push(...page.slice(0, 25));
    if (page.length < 25) break;
  }
  if (list.length === RECOVERY_MAX_MESSAGES) {
    const response = await (await api(config, `/api/${encodeURIComponent(config.session)}/chats/${encodeURIComponent(chatId)}/messages?limit=1&offset=${pageOffset + RECOVERY_MAX_MESSAGES}&filter.timestamp.gte=${since}&filter.timestamp.lte=${until}&downloadMedia=false`)).json() as any;
    const page = Array.isArray(response) ? response : response?.messages || response?.data;
    if (!Array.isArray(page)) throw new Error("invalid_history");
    more = page.length > 0;
  }
  return { truncated: more, messages: list.map((message, index) => ({ message, index })).sort((a,b) => (Number(a.message?.timestamp) || 0) - (Number(b.message?.timestamp) || 0) || b.index-a.index).map(item => item.message) };
}
type RecoveryPage = { chatId: string; pageOffset: number; since: number };
type RecoveryCursor = { version: 3; catalogOffset: number; catalogDone: boolean; loaded: boolean; tasks: RecoveryPage[]; index: number; subindex: number; page: string | null; pageMore: boolean; deferred: RecoveryPage[]; failed: RecoveryPage[]; failedKeys: string[]; until: number };
type RecoveryStep = { complete: boolean; cursor: string | null; processed: number; created: number; truncated: boolean; failedCount: number; needsRetry?: boolean };
/** Checkpoints contain metadata and at most one encrypted page, never message text in clear. */
async function recoverWindow(config: WahaConfig, due: Row, deadline: number, me: any, historical = false): Promise<RecoveryStep | "unavailable"> {
  const db = ensureWahaSchema(), since = Number(due["window_start"] || 0);
  let cursor: RecoveryCursor | null = null;
  try { const saved = due["cursor"] ? JSON.parse(String(due["cursor"])) : null; if (saved?.version === 3 && Array.isArray(saved.tasks)) cursor = saved; } catch { /* Start the same window again; message IDs make replay safe. */ }
  if (!cursor) {
    cursor = { version: 3, catalogOffset: 0, catalogDone: historical, loaded: false, tasks: [], index: 0, subindex: 0, page: null, pageMore: false, deferred: [], failed: [], failedKeys: [], until: Number(due["window_end"]) || Math.floor(Date.now()/1000) };
    if (historical) {
      const bindings = db.prepare("SELECT chat_id,contact_id FROM crm_whatsapp_bindings WHERE session=? ORDER BY id").all(config.session);
      for (const binding of bindings) {
        const last = db.prepare("SELECT max(sent_at) at FROM crm_messages WHERE provider='waha' AND account=? AND contact_id=?").get(config.session, String(binding["contact_id"]))?.["at"];
        if (last) cursor.tasks.push({ chatId: String(binding["chat_id"]), pageOffset: 0, since: Math.floor(new Date(String(last)).getTime()/1000) - RECOVERY_OVERLAP_S });
      }
    }
  }
  if (!cursor.loaded) {
    try {
      for (let fetched = 0; !cursor.catalogDone && fetched < RECOVERY_MAX_CHATS; fetched += 50) {
        // NOWEB 2026.10.1 supports sorting by id. Activity ordering would move an unseen chat
        // behind the offset when it receives a new message between continuation requests.
        const response = await (await api(config, `/api/${encodeURIComponent(config.session)}/chats?limit=50&offset=${cursor.catalogOffset}&sortBy=id&sortOrder=asc`)).json() as any;
        const page = Array.isArray(response) ? response : response?.chats || response?.data;
        if (!Array.isArray(page)) return "unavailable";
        for (const chat of page.slice(0,50)) {
          const id = txt(typeof chat?.id === "string" ? chat.id : chat?.id?._serialized, 200).replace(/@s\.whatsapp\.net$/, "@c.us");
          if (/^\d+@(c\.us|lid)$/.test(id) && !cursor.tasks.some(task => task.chatId === id && task.pageOffset === 0)) cursor.tasks.push({ chatId: id, pageOffset: 0, since });
        }
        cursor.catalogOffset += 50;
        if (page.length < 50) cursor.catalogDone = true;
        if (Date.now() > deadline) break;
      }
    } catch { return "unavailable"; }
    cursor.loaded = true;
  }
  const identities = new Map<string, Awaited<ReturnType<typeof resolveIdentity>>>();
  let processed = 0, created = 0;
  const result = (complete: boolean, truncated = false, needsRetry = false, failedCount = cursor!.failedKeys.length): RecoveryStep => ({ complete, cursor: complete ? null : JSON.stringify(cursor), processed, created, truncated, failedCount, ...(needsRetry ? { needsRetry: true } : {}) });
  const failed = (task: RecoveryPage, key: string) => {
    if (!cursor!.failed.some(item => item.chatId === task.chatId && item.pageOffset === task.pageOffset)) cursor!.failed.push(task);
    if (!cursor!.failedKeys.includes(key)) cursor!.failedKeys.push(key);
  };
  while (cursor.index < cursor.tasks.length) {
    if (Date.now() > deadline) return result(false);
    const task = cursor.tasks[cursor.index]!;
    if (!cursor.page) {
      try {
        const page = await windowMessages(config, task.chatId, task.since, task.pageOffset, cursor.until);
        cursor.page = encrypt(page.messages); cursor.pageMore = page.truncated; cursor.subindex = 0;
      } catch { failed(task, `${task.chatId}:${task.pageOffset}:fetch`); cursor.index++; continue; }
    }
    const list = decrypt<any[]>(cursor.page);
    for (; cursor.subindex < list.length; cursor.subindex++) {
      if (Date.now() > deadline) return result(false);
      const message = list[cursor.subindex];
      try {
        const stored = await processMessage(config, { ...message, chatId: task.chatId }, historical, identities, me, { recovered: !historical });
        if (stored && !stored.duplicate) processed++;
        if (stored?.created) created++;
      } catch { failed(task, `${task.chatId}:${task.pageOffset}:${canonicalMessageId(message?.id) || cursor.subindex}`); }
    }
    if (cursor.pageMore) cursor.deferred.push({ ...task, pageOffset: task.pageOffset + RECOVERY_MAX_MESSAGES });
    cursor.page = null; cursor.pageMore = false; cursor.subindex = 0; cursor.index++;
  }
  if (cursor.deferred.length || !cursor.catalogDone) {
    cursor.tasks = cursor.deferred; cursor.deferred = []; cursor.index = 0; cursor.loaded = false;
    return result(false, true);
  }
  if (cursor.failed.length) {
    const count = cursor.failedKeys.length;
    cursor.tasks = cursor.failed; cursor.failed = []; cursor.failedKeys = []; cursor.index = 0; cursor.loaded = true;
    return result(false, false, true, count);
  }
  return result(true);
}
/**
 * One step of the catch-up after a reconnection, run after live events and in small steps. Two
 * passes (2 and 15 minutes after the reconnection): WhatsApp may deliver the history of a newly
 * linked phone a few minutes later. Message ids keep every pass free of duplicates.
 */
async function runRecoveryStep(budgetMs = 10_000): Promise<void> {
  const db = ensureWahaSchema();
  const due = db
    .prepare(
      "SELECT * FROM crm_waha_recovery WHERE state='pending' AND available_at<=? ORDER BY available_at LIMIT 1",
    )
    .get(Date.now());
  if (!due) return;
  const session = String(due["session"]);
  const finish = (state: string, error: string | null = null): void => {
    db
      .prepare("UPDATE crm_waha_recovery SET state=?,error_code=?,updated_at=? WHERE session=?")
      .run(state, error, now(), session);
  };
  const later = (delay: number, error: string | null = null): void => {
    const attempts = Number(due["failure_attempts"] || 0) + 1;
    db
      .prepare(
        "UPDATE crm_waha_recovery SET state=?,available_at=?,error_code=?,failure_attempts=?,failed_count=?,has_more=1,updated_at=? WHERE session=?",
      )
      .run(attempts >= 5 ? "error" : "pending", Date.now() + delay, error, attempts, Math.max(1, Number(due["failed_count"] || 0)), now(), session);
  };
  const { config: settings } = configuration();
  const line = settings.enabled ? activeLineBySession(session) : null;
  if (!line) return finish("cancelled");
  const config = withLine(settings, line);
  let info: any;
  try {
    info = await sessionState(config);
  } catch {
    return later(60_000, "waha_unavailable");
  }
  // Offline again before the catch-up: the window is kept and merged into the next reconnection.
  if (info?.status !== "WORKING") return finish("idle", "not_connected");
  if (!numberMatches(config, info)) return finish("cancelled", "number_mismatch");
  // Earlier homologation builds scheduled unknown-gap history on first connection. Do not resume
  // those checkpoints implicitly; historical imports remain explicit, per selected conversation.
  if (due["window_start"] === null || due["window_start"] === undefined)
    return finish("cancelled", "unknown_window");
  if (due["mode"] === "reconcile" && Number(due["passes"]) > 0 && !due["cursor"]) {
    due["window_end"] = Math.floor(Date.now() / 1000);
    db.prepare("UPDATE crm_waha_recovery SET window_end=? WHERE session=?").run(due["window_end"], session);
  }
  const deadline = Date.now() + budgetMs;
  const step = await recoverWindow(config, due, deadline, info.me);
  if (step === "unavailable") return later(60_000, "waha_unavailable");
  if (step.truncated || step.needsRetry) {
    db.prepare("UPDATE crm_waha_recovery SET state='partial',cursor=?,processed=processed+?,new_chats=new_chats+?,failed_count=?,has_more=1,error_code=?,failure_attempts=0,updated_at=? WHERE session=?").run(step.cursor, step.processed, step.created, step.failedCount, step.truncated ? "limit" : "recovery_failed", now(), session);
    return;
  }
  if (!step.complete) {
    db.prepare(
      "UPDATE crm_waha_recovery SET cursor=?,processed=processed+?,new_chats=new_chats+?,failed_count=?,has_more=0,failure_attempts=0,available_at=?,updated_at=? WHERE session=?",
    ).run(step.cursor, step.processed, step.created, step.failedCount, Date.now(), now(), session);
    return;
  }
  const passes = Number(due["passes"]) + 1;
  db.prepare(
    "UPDATE crm_waha_recovery SET state=?,passes=?,cursor=NULL,processed=processed+?,new_chats=new_chats+?,available_at=?,updated_at=?,error_code=NULL,has_more=0,failed_count=0,failure_attempts=0 WHERE session=?",
  ).run(
    passes >= 2 ? "done" : "pending",
    passes,
    step.processed,
    step.created,
    Date.now() + (due["mode"] === "reconcile" ? RECONCILE_INTERVAL_MS : RECOVERY_SECOND_PASS_MS),
    now(),
    session,
  );
  if (passes >= 2 && due["window_start"] != null) db.prepare("UPDATE crm_waha_watermarks SET covered_until=max(covered_until,?) WHERE session=?").run(Number(due["window_end"]) || Math.floor(Date.now()/1000), session);
  if (step.processed || step.created)
    audit(null, "crm:waha:recovery", line.id, {
      processed: step.processed,
      newChats: step.created,
      pass: passes,
      gap: due["window_start"] !== null && due["window_start"] !== undefined,
    });
}
let draining = false,
  worker: ReturnType<typeof setInterval> | undefined;
export async function drainWahaEvents() {
  if (draining) return;
  draining = true;
  try {
    const db = ensureWahaSchema();
    if (!configuration().config.enabled) return;
    db.prepare(
      "UPDATE crm_waha_events SET state='pending' WHERE state='processing' AND updated_at<?",
    ).run(new Date(Date.now() - 120_000).toISOString());
    const events = db
      .prepare(
        "SELECT * FROM crm_waha_events WHERE state='pending' AND available_at<=? ORDER BY created_at,id LIMIT 10",
      )
      .all(Date.now());
    for (const event of events) {
      const attempts = Number(event["attempts"]) + 1;
      db.prepare(
        "UPDATE crm_waha_events SET state='processing',attempts=?,updated_at=? WHERE id=?",
      ).run(attempts, now(), String(event["id"]));
      try {
        await processEvent(decrypt(String(event["encrypted"])));
        db.prepare(
          "UPDATE crm_waha_events SET state='done',error_code=NULL,updated_at=? WHERE id=?",
        ).run(now(), String(event["id"]));
      } catch (error) {
        const known =
          error instanceof Error &&
          /^(session_mismatch|number_mismatch|media_unavailable|unsafe_media_url|body_too_large|media_too_large|invalid_message_id|waha_http_\d+)$/.test(
            error.message,
          )
            ? error.message
            : "processing_failed";
        db.prepare(
          "UPDATE crm_waha_events SET state=?,error_code=?,available_at=?,updated_at=? WHERE id=?",
        ).run(
          attempts >= 5 ? "error" : "pending",
          known,
          Date.now() + Math.min(15 * 60_000, 15_000 * 2 ** attempts),
          now(),
          String(event["id"]),
        );
      }
    }
    await reconcileWorkingLines().catch(() => {});
    // Catch-up work never delays live events: it runs after them, in small steps.
    if (events.length < 10) await runRecoveryStep().catch(() => {});
  } finally {
    draining = false;
  }
}
/** Continues a capped scan or retries only the failed pages of this line, never sends a message. */
export async function retryWahaRecovery(actor: SiteUser, input: { lineId?: string | undefined } = {}) {
  const user = commercial(actor), { config: settings } = configuration();
  const line = resolveLine(user, input.lineId), config = withLine(settings, line);
  await requireReady(user, config);
  const row = recoveryOf(line.session);
  if (!row || (!['partial','error'].includes(String(row['state'])) && !row['error_code'])) throw new Error("Não há conferência parcial ou com falha para continuar nesta linha.");
  ensureWahaSchema().prepare("UPDATE crm_waha_recovery SET state='pending',available_at=?,error_code=NULL,failure_attempts=0,failed_count=0,has_more=0,updated_at=? WHERE session=?").run(Date.now(), now(), line.session);
  audit(user.id, "crm:waha:recovery:retry", line.id);
  if (process.env["CRM_DISABLE_WORKER"] !== "1") void drainWahaEvents().catch(() => {});
  return { ok: true as const, recovery: recoverySummary(recoveryOf(line.session)) };
}
export function startWahaWorker() {
  if (worker || process.env["CRM_DISABLE_WORKER"] === "1") return;
  worker = setInterval(() => {
    void drainWahaEvents().catch(() => {});
  }, 15_000);
  worker.unref?.();
  void drainWahaEvents().catch(() => {});
}
export function retryWahaEvent(actor: SiteUser, id: string) {
  const user = administrator(actor);
  const result = ensureWahaSchema()
    .prepare(
      "UPDATE crm_waha_events SET state='pending',attempts=0,available_at=?,updated_at=? WHERE id=? AND state IN ('pending','error')",
    )
    .run(Date.now(), now(), id);
  if (!result.changes) throw new Error("Evento não encontrado ou já processado.");
  audit(user.id, "crm:waha:event:retry", id);
  if (process.env["CRM_DISABLE_WORKER"] !== "1") void drainWahaEvents().catch(() => {});
  return { ok: true };
}
/** One history import at a time per line; different sellers never wait for each other. */
const syncingSessions = new Set<string>();
function lockHistory(session: string) {
  if (syncingSessions.has(session))
    throw new Error("Uma sincronização já está em andamento. Aguarde antes de continuar.");
  syncingSessions.add(session);
  return () => syncingSessions.delete(session);
}
export async function syncWahaHistory(
  actor: SiteUser,
  input: { chatId?: string | undefined; limit?: number | undefined; lineId?: string | undefined } = {},
) {
  const user = administrator(actor),
    { config: settings } = configuration();
  const config = withLine(settings, resolveLine(user, input.lineId));
  const release = lockHistory(config.session);
  try {
    return await syncWahaHistoryPage(user, config, input);
  } finally {
    release();
  }
}
/**
 * History of ONE conversation, chosen in the Atendimento: the seller who owns the contact or an
 * administrator (supervision). Uses the conversation's WhatsApp address, or asks WhatsApp for it when
 * none is known yet. Always through the line of the contact's seller.
 */
export async function syncWahaContactHistory(actor: SiteUser, contactId: string) {
  const user = commercial(actor),
    { config: settings } = configuration();
  const contact = requireCrmContact(user, contactId);
  const line = settings.enabled ? activeLineOf(contact.ownerId) : null;
  if (!line) throw new Error("Este contato não utiliza uma linha de WhatsApp ativa.");
  if (user.id !== line.userId && !isAdmin(user))
    throw new Error("Somente a vendedora responsável ou um administrador busca este histórico.");
  const config = withLine(settings, line);
  const release = lockHistory(config.session);
  try {
    await requireReady(user, config);
    const { ensureWhatsAppStoreSchema } = await import("./crm-whatsapp-store.server.ts");
    const known = ensureWhatsAppStoreSchema()
      .prepare(
        "SELECT chat_id FROM crm_whatsapp_bindings WHERE session=? AND contact_id=? ORDER BY updated_at DESC LIMIT 3",
      )
      .all(config.session, contact.id)
      .map((row) => String(row["chat_id"]));
    let chats = known;
    if (!chats.length) {
      const number = phone(contact.phone);
      if (!/^\d{12,15}$/.test(number))
        throw new Error("Cadastre o telefone do contato com DDD e DDI válidos.");
      chats = [await resolveRecipientChat(config, number)];
    }
    let processed = 0,
      hasMore = false;
    const started = Date.now();
    for (const chatId of chats) {
      for (let page = 0; page < 30; page++) {
        const result = await syncWahaHistoryPage(user, config, { chatId, limit: 10 }, true);
        processed += result.processed;
        hasMore = result.hasMore;
        if (!result.hasMore || Date.now() - started > 45_000) break;
      }
      if (Date.now() - started > 45_000) break;
    }
    audit(user.id, "crm:waha:history:contact", contact.id, { processed });
    return {
      processed,
      hasMore,
      message: hasMore
        ? `${processed} mensagem(ns) nova(s). Ainda há histórico disponível; busque novamente para continuar.`
        : `${processed} mensagem(ns) nova(s). Histórico disponível desta conversa conferido.`,
    };
  } finally {
    release();
  }
}
async function syncWahaHistoryPage(
  user: SiteUser,
  config: WahaConfig,
  input: { chatId?: string | undefined; limit?: number | undefined },
  contactScoped = false,
) {
  // Importing every conversation of a number is an explicit administrative choice (off by default).
  if (!input.chatId && config.allowFullHistoryImport !== true)
    throw new Error(
      "A importação geral do histórico está desativada. Use “Buscar histórico desta conversa” no Atendimento.",
    );
  if (!contactScoped) administrator(user);
  await requireReady(user, config);
  const limit = Math.min(10, Math.max(1, input.limit || 10)),
    db = ensureWahaSchema();
  const validChat = (id: unknown): id is string =>
    typeof id === "string" && /^\d+@(c\.us|lid)$/.test(id);
  let chatId: string | undefined;
  if (input.chatId) {
    if (!validChat(input.chatId)) throw new Error("Conversa inválida.");
    chatId = input.chatId;
  } else {
    let scan = db
      .prepare("SELECT * FROM crm_waha_history_scan WHERE session=?")
      .get(config.session);
    const pending = () =>
      db
        .prepare(
          "SELECT chat_id FROM crm_waha_history WHERE session=? AND completed=0 ORDER BY updated_at,chat_id LIMIT 1",
        )
        .get(config.session);
    if (scan?.["completed"] && !pending()) {
      // A new pass starts from the newest available messages; external IDs keep it idempotent.
      db.prepare("UPDATE crm_waha_history SET offset=0,completed=0 WHERE session=?").run(
        config.session,
      );
      db.prepare("DELETE FROM crm_waha_history_window WHERE session=?").run(config.session);
      scan = undefined;
    }
    if (!scan || !scan["completed"]) {
      const offset = Number(scan?.["offset"] || 0);
      const response = (await (
        await api(
          config,
          `/api/${encodeURIComponent(config.session)}/chats?limit=100&offset=${offset}&sortBy=id&sortOrder=asc`,
        )
      ).json()) as any;
      const list = Array.isArray(response) ? response : response.data || response.chats;
      if (!Array.isArray(list)) throw new Error("O WAHA retornou uma lista de conversas inválida.");
      atomic(() => {
        for (const chat of list.slice(0, 100)) {
          // The NOWEB store lists individual chats as `...@s.whatsapp.net`.
          const id = txt(typeof chat.id === "string" ? chat.id : chat.id?._serialized, 200).replace(
            /@s\.whatsapp\.net$/,
            "@c.us",
          );
          if (validChat(id))
            db.prepare("INSERT OR IGNORE INTO crm_waha_history VALUES(?,?,0,0,0,?)").run(
              config.session,
              id,
              now(),
            );
        }
        db.prepare(
          "INSERT INTO crm_waha_history_scan VALUES(?,?,?,?) ON CONFLICT(session) DO UPDATE SET offset=excluded.offset,completed=excluded.completed,updated_at=excluded.updated_at",
        ).run(config.session, offset + 100, Number(list.length < 100), now());
      });
    }
    chatId = pending()?.["chat_id"] as string | undefined;
  }
  let processed = 0,
    more = false;
  if (chatId) {
    const checkpoint = db
      .prepare("SELECT * FROM crm_waha_history WHERE session=? AND chat_id=?")
      .get(config.session, chatId);
    const offset = checkpoint?.["completed"] ? 0 : Number(checkpoint?.["offset"] || 0);
    if (checkpoint?.["completed"])
      db.prepare("DELETE FROM crm_waha_history_window WHERE session=? AND chat_id=?").run(
        config.session,
        chatId,
      );
    db.prepare("INSERT OR IGNORE INTO crm_waha_history_window VALUES(?,?,?)").run(
      config.session,
      chatId,
      Math.floor(Date.now() / 1000),
    );
    const until = Number(
      db
        .prepare(
          "SELECT until_timestamp FROM crm_waha_history_window WHERE session=? AND chat_id=?",
        )
        .get(config.session, chatId)!["until_timestamp"],
    );
    const response = (await (
      await api(
        config,
        `/api/${encodeURIComponent(config.session)}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&offset=${offset}&filter.timestamp.lte=${until}&downloadMedia=false`,
      )
    ).json()) as any;
    const list = Array.isArray(response) ? response : response.messages || response.data || [];
    if (!Array.isArray(list)) throw new Error("O WAHA retornou um histórico inválido.");
    const identities = new Map<string, Awaited<ReturnType<typeof resolveIdentity>>>(),
      started = Date.now(),
      me = list.length ? (await sessionState(config).catch(() => null))?.me : null;
    let consumed = 0;
    for (const message of list.slice(0, limit)) {
      const result = await processMessage(config, { ...message, chatId }, true, identities, me);
      if (result && !result.duplicate) processed++;
      consumed++;
      if (Date.now() - started > 15_000) break;
    }
    more = consumed < list.length || list.length >= limit;
    db.prepare(
      "INSERT INTO crm_waha_history VALUES(?,?,?,?,?,?) ON CONFLICT(session,chat_id) DO UPDATE SET offset=excluded.offset,processed=crm_waha_history.processed+excluded.processed,completed=excluded.completed,updated_at=excluded.updated_at",
    ).run(config.session, chatId, more ? offset + consumed : 0, processed, Number(!more), now());
  }
  const hasMore = input.chatId
    ? more
    : Boolean(
        db
          .prepare("SELECT 1 FROM crm_waha_history WHERE session=? AND completed=0 LIMIT 1")
          .get(config.session) ||
        !db
          .prepare("SELECT completed FROM crm_waha_history_scan WHERE session=?")
          .get(config.session)?.["completed"],
      );
  audit(user.id, "crm:waha:history:sync", null, { chats: Number(Boolean(chatId)), processed });
  return {
    processed,
    chats: Number(Boolean(chatId)),
    hasMore,
    message:
      "Lote sincronizado com continuidade salva. O histórico disponibilizado pelo conector pode estar incompleto.",
  };
}

const CATALOG_TOKEN_MS = 15 * 60_000;
const CATALOG_SCAN_LIMIT = 200;
const catalogFold = (value: unknown) =>
  txt(value, 500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const catalogName = (value: unknown) =>
  typeof value === "string" ? txt(value, 200).replace(/[\u0000-\u001f\u007f]/g, " ") : "";
const catalogAddress = (value: unknown) => {
  const id = txt(typeof value === "string" ? value : (value as any)?._serialized, 200).replace(
    /@s\.whatsapp\.net$/,
    "@c.us",
  );
  return /^\d{5,30}@(c\.us|lid)$/.test(id) ? id : null;
};
const catalogInputSchema = z
  .object({
    lineId: z.string().uuid().optional(),
    search: z.string().trim().max(200).optional(),
    before: z.string().max(2048).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
const catalogImportSchema = z
  .object({
    lineId: z.string().uuid().optional(),
    chatId: z.string().max(200),
    selectionToken: z.string().min(1).max(4096),
  })
  .strict();
function catalogToken<T extends z.ZodTypeAny>(token: string, schema: T): z.infer<T> {
  try {
    if (
      !/^[A-Za-z0-9+/=]+$/.test(token) ||
      Buffer.from(token, "base64").toString("base64") !== token
    )
      throw new Error();
    return schema.parse(decrypt<unknown>(token));
  } catch {
    throw new Error(
      "A seleção do WhatsApp expirou ou é inválida. Atualize a lista e escolha novamente.",
    );
  }
}
async function catalogContext(actor: SiteUser, lineId?: string | undefined) {
  const user = commercial(actor),
    { config: settings } = configuration();
  // Catalog supervision must be deliberate even when the administrator also owns a line.
  if (isAdmin(user) && !lineId && activeLines().length > 1)
    throw new Error("Escolha a linha de WhatsApp da vendedora.");
  const line = resolveLine(user, lineId),
    config = withLine(settings, line);
  await requireReady(user, config);
  const info = await sessionState(config);
  if (info.status !== "WORKING" || !numberMatches(config, info))
    throw new Error("O WhatsApp mudou de conexão. Consulte o estado e tente novamente.");
  return { user, config, line, me: info.me };
}
function catalogStillCurrent(config: WahaConfig, revision: number) {
  const current = configuration().config,
    line = lineById(config.lineId);
  if (
    !line ||
    line.status !== "active" ||
    line.revision !== revision ||
    line.userId !== config.ownerId ||
    line.session !== config.session ||
    !samePhone(line.expectedPhone, config.expectedPhone) ||
    !current.enabled ||
    current.baseUrl !== config.baseUrl ||
    current.apiKey !== config.apiKey
  )
    throw new Error("A configuração da linha mudou. Atualize a lista antes de continuar.");
  requireConfigured(withLine(current, line));
}
async function catalogIdentity(config: WahaConfig, chatId: string, chat: any, refreshName = false) {
  let number = chatId.endsWith("@c.us") ? phone(chatId.split("@")[0]) : "";
  if (chatId.endsWith("@lid")) {
    try {
      const resolved = await (
        await api(
          config,
          `/api/${encodeURIComponent(config.session)}/lids/${encodeURIComponent(chatId)}`,
          { timeout: 3000 },
        )
      ).json();
      // A LID is not a telephone. Only an explicit phone-address mapping is accepted.
      if (/^\d{10,15}@(c\.us|s\.whatsapp\.net)$/.test(String(resolved?.pn || "")))
        number = phone(String(resolved.pn).split("@")[0]);
    } catch {
      /* Unresolved identities remain visible but cannot be imported. */
    }
  }
  if (!/^\d{12,15}$/.test(number)) number = "";
  let name = catalogName(chat?.name || chat?.notifyName || chat?.verifiedName);
  if (!name || refreshName) {
    try {
      const contact = await (
        await api(
          config,
          `/api/contacts?session=${encodeURIComponent(config.session)}&contactId=${encodeURIComponent(chatId)}`,
          { timeout: 3000 },
        )
      ).json();
      name = catalogName(contact?.name || contact?.pushname || contact?.notify) || name;
    } catch {
      /* A phone-only conversation does not need a saved address-book name. */
    }
  }
  return {
    phone: number ? normalizeBrPhone(number) : null,
    name: name || number || "Contato sem identificação",
  };
}
function catalogExistingContact(config: WahaConfig, number: string, chatId: string) {
  const variants = brPhoneVariants(number);
  const db = ensureCrmSchema(), rows = db
    .prepare(
      `SELECT id FROM crm_contacts WHERE owner_id=? AND phone IN (${variants.map(() => "?").join(",")}) LIMIT 2`,
    )
    .all(config.ownerId, ...variants);
  const conflict = "Este atendimento tem uma identificação pendente ou conflitante no CRM. Revise antes de importar.";
  if (rows.length > 1) return { contactId: null, reason: "Há cadastros com o mesmo telefone nesta carteira. Revise antes de importar." };
  const tables = Number(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name IN ('crm_whatsapp_bindings','crm_whatsapp_identities')").get()?.["n"]);
  let boundId: string | null = null;
  if (tables) {
    if (tables !== 2) return { contactId: null, reason: conflict };
    const addresses = [...new Set([chatId, ...variants.map(value => `${value}@c.us`)])];
    const bindings = db.prepare(`SELECT DISTINCT b.contact_id,b.owner_id,b.triage_reason,c.phone FROM crm_whatsapp_bindings b LEFT JOIN crm_whatsapp_identities i ON i.binding_id=b.id AND i.session=b.session JOIN crm_contacts c ON c.id=b.contact_id WHERE b.session=? AND (b.chat_id IN (${addresses.map(() => "?").join(",")}) OR i.address IN (${addresses.map(() => "?").join(",")}))`).all(config.session, ...addresses, ...addresses);
    if (new Set(bindings.map(row => String(row["contact_id"]))).size > 1 || bindings.some(row => row["owner_id"] !== config.ownerId || ["unresolved_identity", "identity_conflict"].includes(String(row["triage_reason"])) || !row["phone"] || !samePhone(row["phone"],number)))
      return { contactId: null, reason: conflict };
    if (bindings.length) boundId = String(bindings[0]!["contact_id"]);
    if (boundId && rows.length && boundId !== rows[0]!["id"]) return { contactId: null, reason: conflict };
  }
  return { contactId: boundId || (rows.length === 1 ? String(rows[0]!["id"]) : null), reason: null };
}
function catalogMatches(item: Pick<WahaCatalogContact, "name" | "phone">, search: string) {
  if (!search) return true;
  const folded = catalogFold(search),
    numeric = /^[+\d\s().-]+$/.test(search) ? digits(search) : "";
  if (numeric)
    return (
      brPhoneVariants(item.phone).some((number) => number.includes(numeric)) ||
      (numeric.length >= 10 && samePhone(phone(numeric), item.phone))
    );
  const haystack = catalogFold(`${item.name} ${item.phone || ""}`);
  return folded
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}
/** Read-only catalog: at most 200 provider rows per call; never imports contacts, messages or leads. */
export async function readWahaContactCatalog(
  actor: SiteUser,
  raw: WahaContactCatalogInput = {},
): Promise<WahaContactCatalogPage> {
  const input = catalogInputSchema.parse(raw),
    { user, config, line, me } = await catalogContext(actor, input.lineId);
  const search = txt(input.search, 200),
    limit = input.limit ?? 20;
  const context = {
    actorId: user.id,
    lineId: config.lineId,
    session: config.session,
    search: catalogFold(search),
    limit,
  };
  let offset = 0;
  if (input.before) {
    const cursor = catalogToken(
      input.before,
      z
        .object({
          purpose: z.literal("waha-catalog-page"),
          actorId: z.string(),
          lineId: z.string(),
          session: z.string(),
          search: z.string(),
          limit: z.number(),
          offset: z.number().int().min(0).max(10_000_000),
          expires: z.number(),
        })
        .strict(),
    );
    if (
      cursor.expires < Date.now() ||
      Object.entries(context).some(([key, value]) => cursor[key as keyof typeof cursor] !== value)
    )
      throw new Error("A busca do WhatsApp mudou ou expirou. Atualize a lista.");
    offset = cursor.offset;
  }
  const items: WahaCatalogContact[] = [],
    seen = new Set<string>(),
    started = Date.now();
  let scanned = 0,
    hasMore = true;
  while (scanned < CATALOG_SCAN_LIMIT && items.length < limit && Date.now() - started < 10_000) {
    const result = await (
      await api(
        config,
        `/api/${encodeURIComponent(config.session)}/chats?limit=50&offset=${offset}&sortBy=id&sortOrder=asc&merge=true`,
      )
    ).json();
    const rows = Array.isArray(result) ? result : result?.chats || result?.data;
    if (!Array.isArray(rows) || rows.length > 50)
      throw new Error("O WAHA retornou uma lista de conversas inválida.");
    if (!rows.length) {
      hasMore = false;
      break;
    }
    let consumed = 0;
    for (
      let index = 0;
      index < rows.length && scanned < CATALOG_SCAN_LIMIT && items.length < limit;
    ) {
      if (Date.now() - started >= 10_000) break;
      const chunk = rows.slice(index, index + Math.min(5, CATALOG_SCAN_LIMIT - scanned));
      const candidates = await Promise.all(
        chunk.map(async (chat) => {
          const chatId = catalogAddress(chat?.id);
          if (!chatId || isOwnAddress(chatId, me)) return null;
          const identity = await catalogIdentity(config, chatId, chat);
          if (
            identity.phone &&
            (samePhone(identity.phone, config.expectedPhone) ||
              isProtectedPhone(config, identity.phone))
          )
            return null;
          const known = identity.phone
            ? catalogExistingContact(config, identity.phone, chatId)
            : { contactId: null, reason: null };
          const unavailableReason = !identity.phone
            ? "O WhatsApp ainda não confirmou o telefone deste contato."
            : known.reason;
          const timestamp = Number(chat?.conversationTimestamp ?? chat?.lastMessage?.timestamp);
          const lastActivityAt =
            Number.isFinite(timestamp) && timestamp > 0 && timestamp < 253402300800
              ? new Date(timestamp * 1000).toISOString()
              : null;
          return {
            chatId,
            name: identity.name,
            phone: identity.phone,
            contactId: known.contactId,
            canImport: !unavailableReason,
            unavailableReason,
            lastActivityAt,
          };
        }),
      );
      for (const candidate of candidates) {
        consumed++;
        scanned++;
        index++;
        if (!candidate || !catalogMatches(candidate, search)) continue;
        const identityKey = candidate.phone || candidate.chatId;
        if (seen.has(identityKey)) continue;
        seen.add(identityKey);
        items.push({
          ...candidate,
          selectionToken: candidate.canImport
            ? encrypt({
                purpose: "waha-catalog-import",
                actorId: user.id,
                lineId: config.lineId,
                session: config.session,
                chatId: candidate.chatId,
                phone: candidate.phone,
                expires: Date.now() + CATALOG_TOKEN_MS,
              })
            : null,
        });
        if (items.length >= limit) break;
      }
    }
    offset += consumed;
    if (consumed === rows.length && rows.length < 50) {
      hasMore = false;
      break;
    }
    if (!consumed) break;
  }
  await requireReady(user, config);
  commercial(user);
  catalogStillCurrent(config, line.revision);
  return {
    lineId: config.lineId,
    ownerName: userSummary(config.ownerId).name,
    items,
    hasMore,
    nextCursor: hasMore
      ? encrypt({
          purpose: "waha-catalog-page",
          ...context,
          offset,
          expires: Date.now() + CATALOG_TOKEN_MS,
        })
      : null,
    scanned,
    searchScope: "loaded-window",
    notice:
      "A lista consulta as conversas disponíveis no WhatsApp conectado, em lotes. Carregue mais para continuar a busca. Trazer um contato não importa mensagens antigas nem cria oportunidade.",
  };
}
/** Explicit contact-only import. A catalog selection cannot be forged or reused across portfolios. */
export async function importWahaContact(actor: SiteUser, raw: WahaContactImportInput) {
  const input = catalogImportSchema.parse(raw),
    { user, config, line, me } = await catalogContext(actor, input.lineId);
  const chatId = catalogAddress(input.chatId);
  if (!chatId || chatId !== input.chatId)
    throw new Error("Escolha uma conversa individual válida da lista.");
  const proof = catalogToken(
    input.selectionToken,
    z
      .object({
        purpose: z.literal("waha-catalog-import"),
        actorId: z.string(),
        lineId: z.string(),
        session: z.string(),
        chatId: z.string(),
        phone: z.string(),
        expires: z.number(),
      })
      .strict(),
  );
  if (
    proof.actorId !== user.id ||
    proof.lineId !== config.lineId ||
    proof.session !== config.session ||
    proof.chatId !== chatId ||
    proof.expires < Date.now()
  )
    throw new Error("A seleção do WhatsApp mudou ou expirou. Atualize a lista.");
  // Revalidate membership against the provider on the explicit import, not merely its phone syntax.
  const result = await (
    await api(
      config,
      `/api/${encodeURIComponent(config.session)}/chats/overview?limit=1&offset=0&ids=${encodeURIComponent(chatId)}&merge=true`,
    )
  ).json();
  const rows = Array.isArray(result) ? result : result?.chats || result?.data;
  const chat = Array.isArray(rows)
    ? rows.find((item) => catalogAddress(item?.id) === chatId)
    : null;
  if (!chat || isOwnAddress(chatId, me))
    throw new Error("Esta conversa não está mais disponível no WhatsApp. Atualize a lista.");
  const identity = await catalogIdentity(config, chatId, chat, true);
  if (
    !identity.phone ||
    !samePhone(identity.phone, proof.phone) ||
    samePhone(identity.phone, config.expectedPhone) ||
    isProtectedPhone(config, identity.phone)
  )
    throw new Error("O telefone desta conversa não foi confirmado ou mudou. Atualize a lista.");
  // Administrative changes while provider calls awaited must not import into a stale/disabled line.
  await requireReady(user, config);
  commercial(user);
  catalogStillCurrent(config, line.revision);
  const known = catalogExistingContact(config, identity.phone, chatId);
  if (known.reason) throw new Error(known.reason);
  if (known.contactId) return { contactId: known.contactId, created: false };
  return atomic(() => {
    // createContact deduplicates phone aliases again inside the transaction; no messages or fake events.
    const configuredUnit = ensureWahaSchema()
      .prepare("SELECT unit_id FROM lead_distribution_consultants WHERE user_id=? AND enabled=1")
      .get(config.ownerId);
    const contact = createContact(user, {
      name: identity.name,
      phone: identity.phone!,
      email: "",
      city: "",
      ownerId: config.ownerId,
      unitId: configuredUnit?.["unit_id"] ? String(configuredUnit["unit_id"]) : null,
    });
    audit(user.id, "crm:waha:contact:import", contact.id, { lineId: config.lineId });
    return { contactId: contact.id, created: true };
  });
}
