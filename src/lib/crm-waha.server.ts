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
import { ensureCrmSchema, requireCrmContact, updateCrmMessageStatus } from "./crm.server.ts";
import { samePhone } from "./br-phone.ts";

type Row = Record<string, any>;
type WahaConfig = {
  enabled: boolean;
  baseUrl: string;
  session: string;
  ownerId: string;
  expectedPhone: string;
  apiKey: string;
  hmacKey: string;
  /** Import every conversation of the number at once. Off by default: history is per selected conversation. */
  allowFullHistoryImport: boolean;
  /** Administrators supervise; replying through the seller's number needs this explicit setting. */
  allowAdminReplies: boolean;
};
const defaults = (): WahaConfig => ({
  enabled: false,
  baseUrl: "http://waha:3000",
  session: "mag-teste",
  ownerId: "",
  expectedPhone: "",
  apiKey: "",
  hmacKey: "",
  allowFullHistoryImport: false,
  allowAdminReplies: false,
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
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
const MAX_MEDIA = 7 * 1024 * 1024;
const MAX_EVENT = 512 * 1024;
let initialized = new WeakSet<object>();
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
    CREATE TABLE IF NOT EXISTS crm_waha_runtime(session TEXT PRIMARY KEY,state TEXT NOT NULL,updated_at TEXT NOT NULL,error_code TEXT);`);
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
  const row = ensureWahaSchema().prepare("SELECT * FROM crm_waha_config WHERE id=1").get();
  return {
    revision: Number(row?.["revision"] ?? 0),
    config: row ? { ...defaults(), ...decrypt<WahaConfig>(String(row["encrypted"])) } : defaults(),
  };
}
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
    session: z
      .string()
      .trim()
      .min(1)
      .max(54)
      .regex(/^[a-zA-Z0-9_-]+$/),
    ownerId: z.union([z.literal(""), z.string().uuid()]),
    expectedPhone: z.string().max(30).optional(),
    apiKey: z.string().max(4000).optional(),
    hmacKey: z.string().max(500).optional(),
    clearSecrets: z
      .array(z.enum(["apiKey", "hmacKey"]))
      .max(2)
      .default([]),
    allowFullHistoryImport: z.boolean().optional(),
    allowAdminReplies: z.boolean().optional(),
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
export async function readWahaContactContext(actor: SiteUser, contactId: string) {
  const user = commercial(actor),
    { config } = configuration();
  const contact = requireCrmContact(user, contactId);
  if (!config.enabled || contact.ownerId !== config.ownerId) return null;
  return (await import("./crm-whatsapp-store.server.ts")).readWahaContactContext(user, {
    session: config.session,
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
  if (!config.enabled || contact.ownerId !== config.ownerId)
    throw new Error("Este atendimento não utiliza a sessão WAHA configurada");
  validateOwner(config.ownerId);
  return (await import("./crm-whatsapp-store.server.ts")).bindWahaContactOpportunity(user, {
    ...input,
    session: config.session,
  });
}
export function readWahaSettings(actor: SiteUser) {
  administrator(actor);
  const { config, revision } = configuration();
  const db = ensureWahaSchema();
  const sync = db
    .prepare(
      "SELECT sum(processed) processed,count(*) chats,max(updated_at) updatedAt FROM crm_waha_history WHERE session=?",
    )
    .get(config.session);
  return {
    revision,
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    session: config.session,
    ownerId: config.ownerId,
    expectedPhone: config.expectedPhone,
    apiKeyConfigured: Boolean(config.apiKey),
    hmacKeyConfigured: Boolean(config.hmacKey),
    allowFullHistoryImport: config.allowFullHistoryImport === true,
    allowAdminReplies: config.allowAdminReplies === true,
    webhookUrl: webhookUrl(),
    events: db
      .prepare(
        "SELECT id,event_type eventType,state,attempts,created_at createdAt,updated_at updatedAt,error_code errorCode FROM crm_waha_events ORDER BY created_at DESC LIMIT 30",
      )
      .all()
      .map((row) => ({
        id: String(row["id"]),
        eventType: String(row["eventType"]),
        state: String(row["state"]),
        attempts: Number(row["attempts"]),
        createdAt: String(row["createdAt"]),
        updatedAt: String(row["updatedAt"]),
        errorCode: row["errorCode"] ? String(row["errorCode"]) : null,
      })),
    sync: sync?.["updatedAt"]
      ? {
          processed: Number(sync["processed"] ?? 0),
          chats: Number(sync["chats"] ?? 0),
          updatedAt: String(sync["updatedAt"]),
        }
      : null,
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
    if (input.ownerId) validateOwner(input.ownerId);
    const expectedPhone = phone(input.expectedPhone || "");
    if (expectedPhone && !/^\d{12,15}$/.test(expectedPhone))
      throw new Error("Informe o número autorizado com DDD e DDI válidos.");
    const config: WahaConfig = {
      ...existing,
      enabled: input.enabled,
      baseUrl: baseUrl(input.baseUrl),
      session: input.session,
      ownerId: input.ownerId,
      expectedPhone,
      // Omitted flags keep the stored choice; both start disabled.
      allowFullHistoryImport:
        input.allowFullHistoryImport ?? existing.allowFullHistoryImport === true,
      allowAdminReplies: input.allowAdminReplies ?? existing.allowAdminReplies === true,
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
    audit(user.id, "crm:waha:settings", null, {
      revision: revision + 1,
      enabled: config.enabled,
      allowFullHistoryImport: config.allowFullHistoryImport,
      allowAdminReplies: config.allowAdminReplies,
    });
    return { revision: revision + 1 };
  });
}
class WahaHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`waha_http_${status}`);
    this.status = status;
  }
}
async function api(
  config: WahaConfig,
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
function canReplyWithWaha(user: SiteUser, config: WahaConfig) {
  if (!config.ownerId) return false;
  return (
    user.id === config.ownerId ||
    (user.roles.includes("admin") && config.allowAdminReplies === true)
  );
}
function numberMatches(config: WahaConfig, info: any) {
  const reported = phone(
    String(info?.me?.id || "")
      .split("@")[0]!
      .split(":")[0] ||
      info?.me?.phone ||
      "",
  );
  // WhatsApp may report a Brazilian mobile without the 9th digit; it is still the authorized line.
  return samePhone(reported, config.expectedPhone);
}
export async function readWahaConnection(actor: SiteUser) {
  const user = commercial(actor),
    { config } = configuration();
  const common = {
    provider: "waha" as const,
    canManage: user.roles.includes("admin"),
    instance: user.roles.includes("admin") ? config.session : null,
    session: config.session,
    capabilities: { media: true, history: true },
    // Only the responsible seller replies by default; administrators supervise.
    canReply: canReplyWithWaha(user, config),
    canSyncConversation:
      Boolean(config.ownerId) && (user.id === config.ownerId || user.roles.includes("admin")),
    // Portfolio served by the WhatsApp number (shown only to who may act on it).
    responsibleId:
      user.id === config.ownerId || user.roles.includes("admin") ? config.ownerId || null : null,
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
      message: "Defina o número autorizado antes de conectar o WhatsApp.",
    };
  if (!user.roles.includes("admin") && user.id !== config.ownerId)
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
    if (state === "WORKING" && !numberMatches(config, result))
      return {
        ...common,
        configured: true,
        connected: false,
        state: "number_mismatch",
        message:
          "A sessão não corresponde ao número autorizado. Envio e recebimento comercial estão bloqueados.",
      };
    const messages: Record<string, string> = {
      WORKING: "WhatsApp conectado pelo WAHA.",
      STOPPED: "Sessão WAHA parada.",
      STARTING: "A sessão WAHA está iniciando.",
      SCAN_QR_CODE: "Aguardando leitura do QR Code pelo número autorizado.",
      FAILED: "A sessão WAHA falhou. Confira a conexão e solicite uma reconexão.",
      PASSKEY_REQUIRED: "O WhatsApp solicitou uma confirmação adicional de autenticação.",
      PASSKEY_CONFIRMATION_REQUIRED:
        "Confirme a autenticação solicitada no aparelho do número autorizado.",
    };
    return {
      ...common,
      configured: true,
      connected: state === "WORKING",
      state,
      message: messages[state] || "Aguardando conclusão da conexão WAHA.",
    };
  } catch (error) {
    if (error instanceof WahaHttpError && error.status === 404)
      return {
        ...common,
        configured: true,
        connected: false,
        state: "STOPPED",
        message: "Sessão ainda não criada. Use Iniciar sessão nas integrações.",
      };
    return {
      ...common,
      configured: true,
      connected: false,
      state: "error",
      message:
        error instanceof WahaHttpError && [401, 403].includes(error.status)
          ? "O WAHA recusou a credencial configurada."
          : "Não foi possível verificar o WAHA. Confira o serviço e a configuração.",
    };
  }
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
  if (state === "WORKING") return readWahaConnection(user);
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
        message: "A sessão ainda não foi criada. Use Iniciar sessão antes de visualizar o QR Code.",
      };
    return { state: "error", message: sessionCommunicationMessage(error) };
  }
}
export async function controlWahaSession(
  actor: SiteUser,
  input: { action: "start" | "restart" | "qr" | "configure" | "status" },
) {
  const user = administrator(actor),
    { config } = configuration();
  if (input.action === "status") return readWahaConnection(user);
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
    audit(user.id, `crm:waha:session:${input.action}`);
    return readWahaConnection(user);
  } catch (error) {
    if (error instanceof WahaSessionControlError) throw error;
    throw new Error(sessionCommunicationMessage(error));
  } finally {
    if (sessionMutations.get(key) === operation) sessionMutations.delete(key);
  }
}
async function requireReady(actor: SiteUser, config: WahaConfig) {
  requireConfigured(config);
  const connection = await readWahaConnection(actor);
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
    { config } = configuration();
  requireConfigured(config);
  if (contact.ownerId !== config.ownerId)
    throw new Error("Este contato não pertence à vendedora configurada para o WAHA.");
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
  if (
    !value ||
    value.session !== config.session ||
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
      config.session,
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
async function processEvent(payload: any) {
  const { config } = configuration();
  if (!config.enabled || payload.session !== config.session) throw new Error("session_mismatch");
  if (payload.event === "session.status") {
    const state = txt(payload.payload.status, 80) || "UNKNOWN";
    ensureWahaSchema()
      .prepare(
        "INSERT INTO crm_waha_runtime VALUES(?,?,?,NULL) ON CONFLICT(session) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,error_code=NULL",
      )
      .run(config.session, state, now());
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
  } finally {
    draining = false;
  }
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
let syncingHistory = false;
export async function syncWahaHistory(
  actor: SiteUser,
  input: { chatId?: string | undefined; limit?: number | undefined } = {},
) {
  if (syncingHistory)
    throw new Error("Uma sincronização já está em andamento. Aguarde antes de continuar.");
  syncingHistory = true;
  try {
    return await syncWahaHistoryPage(administrator(actor), input);
  } finally {
    syncingHistory = false;
  }
}
/**
 * History of ONE conversation, chosen in the Atendimento: the responsible seller or an administrator
 * (supervision). Uses the conversation's WhatsApp address, or asks WhatsApp for it when none is known yet.
 */
export async function syncWahaContactHistory(actor: SiteUser, contactId: string) {
  const user = commercial(actor),
    { config } = configuration();
  const contact = requireCrmContact(user, contactId);
  if (!config.enabled || !config.ownerId || contact.ownerId !== config.ownerId)
    throw new Error("Este contato não utiliza o WhatsApp configurado para a vendedora.");
  if (user.id !== config.ownerId && !user.roles.includes("admin"))
    throw new Error("Somente a vendedora responsável ou um administrador busca este histórico.");
  if (syncingHistory)
    throw new Error("Uma sincronização já está em andamento. Aguarde antes de continuar.");
  syncingHistory = true;
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
        const result = await syncWahaHistoryPage(user, { chatId, limit: 10 }, true);
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
    syncingHistory = false;
  }
}
async function syncWahaHistoryPage(
  user: SiteUser,
  input: { chatId?: string | undefined; limit?: number | undefined },
  contactScoped = false,
) {
  const { config } = configuration();
  // Importing every conversation of the number is an explicit administrative choice (off by default).
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
