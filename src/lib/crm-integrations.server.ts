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
import { audit, dataDirectory, getDb, transaction } from "./local-db.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";
import {
  ensureCrmSchema,
  findCrmContactByPhone,
  ingestCrmLead,
  recordCrmMessage,
  requireCrmContact,
} from "./crm.server.ts";

const trim = (value: unknown, max = 500) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const iso = () => new Date().toISOString();
const com = (actor: SiteUser) => requireActiveUser(actor, ["admin", "comercial"]);
const admin = (actor: SiteUser) => requireActiveUser(actor, ["admin"]);
const publicBase = () =>
  (
    process.env["SITE_PUBLIC_ORIGINS"]?.split(",")[0]?.trim() ||
    "https://magmoveiscorporativos.com.br"
  ).replace(/\/$/, "");
type Provider = "evolution" | "google" | "meta";
type Config = {
  evolutionUrl: string;
  evolutionInstance: string;
  evolutionApiKey: string;
  evolutionWebhookSecret: string;
  googleWebhookKey: string;
  metaVerifyToken: string;
  metaAppSecret: string;
  metaPageToken: string;
  metaPageId: string;
  metaGraphVersion: string;
  defaultOwnerId: string;
  defaultUnitId: string;
};
const emptyConfig = (): Config => ({
  evolutionUrl: "",
  evolutionInstance: "",
  evolutionApiKey: "",
  evolutionWebhookSecret: "",
  googleWebhookKey: "",
  metaVerifyToken: "",
  metaAppSecret: "",
  metaPageToken: "",
  metaPageId: "",
  metaGraphVersion: "v23.0",
  defaultOwnerId: "",
  defaultUnitId: "",
});
let schemaDb: unknown;
function schema() {
  ensureCrmSchema();
  const db = getDb();
  if (schemaDb === db) return db;
  db.exec(`CREATE TABLE IF NOT EXISTS crm_integrations_config(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, encrypted TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS crm_webhook_events(id TEXT PRIMARY KEY,provider TEXT NOT NULL,external_id TEXT NOT NULL,encrypted TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,error_code TEXT,UNIQUE(provider,external_id));
    CREATE INDEX IF NOT EXISTS crm_webhook_due ON crm_webhook_events(state,available_at);
    CREATE TABLE IF NOT EXISTS crm_outbox(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,contact_id TEXT NOT NULL,request_key TEXT NOT NULL,state TEXT NOT NULL,external_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,message_id TEXT,body_hash TEXT NOT NULL DEFAULT '',UNIQUE(actor_id,request_key));`);
  for (const [column, definition] of [
    ["message_id", "TEXT"],
    ["body_hash", "TEXT NOT NULL DEFAULT ''"],
  ]) {
    if (!db.prepare("SELECT 1 FROM pragma_table_info('crm_outbox') WHERE name=?").get(column!))
      db.exec(`ALTER TABLE crm_outbox ADD COLUMN ${column} ${definition}`);
  }
  schemaDb = db;
  return db;
}
function key() {
  const directory = join(dataDirectory(), "security");
  const path = join(directory, "crm-integrations.key");
  if (!existsSync(path)) {
    const db = getDb();
    const hasData =
      db.prepare("SELECT 1 FROM crm_integrations_config LIMIT 1").get() ||
      db.prepare("SELECT 1 FROM crm_webhook_events LIMIT 1").get();
    if (hasData)
      throw new Error("Chave das integrações ausente. Restaure o backup correspondente.");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (!existsSync(path)) throw error;
    }
  }
  const value = readFileSync(path);
  if (value.length !== 32) throw new Error("Chave das integrações inválida.");
  return value;
}
function seal(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
function unseal<T>(value: string): T {
  const data = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8"),
  ) as T;
}
function configuration() {
  const row = schema()
    .prepare("SELECT revision,encrypted FROM crm_integrations_config WHERE id=1")
    .get();
  return {
    config: row ? { ...emptyConfig(), ...unseal<Config>(String(row["encrypted"])) } : emptyConfig(),
    revision: Number(row?.["revision"] ?? 0),
  };
}
const secretFields = [
  "evolutionApiKey",
  "evolutionWebhookSecret",
  "googleWebhookKey",
  "metaVerifyToken",
  "metaAppSecret",
  "metaPageToken",
] as const;
const safeBaseUrl = (value: string) => {
  if (!value) return "";
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Informe uma URL HTTP/HTTPS sem credenciais ou parâmetros.");
  return url.href.replace(/\/$/, "");
};
export const crmIntegrationSettingsSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    evolutionUrl: z.string().max(500),
    evolutionInstance: z
      .string()
      .max(100)
      .regex(/^[a-zA-Z0-9_.-]*$/),
    evolutionApiKey: z.string().max(2000).optional(),
    evolutionWebhookSecret: z.string().max(500).optional(),
    googleWebhookKey: z.string().max(500).optional(),
    metaVerifyToken: z.string().max(500).optional(),
    metaAppSecret: z.string().max(500).optional(),
    metaPageToken: z.string().max(4000).optional(),
    metaPageId: z.string().max(40).regex(/^\d*$/),
    metaGraphVersion: z.string().regex(/^v\d{1,2}\.0$/),
    defaultOwnerId: z.string().max(100),
    defaultUnitId: z.string().max(100),
    clearSecrets: z.array(z.enum(secretFields)).max(6).default([]),
  })
  .strict();
export function readCrmIntegrationSettings(actor: SiteUser) {
  admin(actor);
  const { config, revision } = configuration();
  const {
    evolutionApiKey,
    evolutionWebhookSecret,
    googleWebhookKey,
    metaVerifyToken,
    metaAppSecret,
    metaPageToken,
    ...plain
  } = config;
  return {
    ...plain,
    revision,
    secrets: Object.fromEntries(
      secretFields.map((field) => [field, Boolean(config[field])]),
    ) as Record<(typeof secretFields)[number], boolean>,
    webhookUrls: {
      evolution: `${publicBase()}/api/crm/webhooks/evolution`,
      google: `${publicBase()}/api/crm/webhooks/google`,
      meta: `${publicBase()}/api/crm/webhooks/meta`,
    },
    events: listCrmIntegrationEvents(actor),
  };
}
export function saveCrmIntegrationSettings(
  actor: SiteUser,
  raw: z.input<typeof crmIntegrationSettingsSchema>,
) {
  const user = admin(actor);
  const input = crmIntegrationSettingsSchema.parse(raw);
  schema();
  return transaction(() => {
    const { config: current, revision } = configuration();
    if (revision !== input.revision)
      throw new Error(
        "As integrações foram alteradas em outra sessão. Recarregue antes de salvar.",
      );
    const config: Config = {
      ...current,
      evolutionUrl: safeBaseUrl(input.evolutionUrl.trim()),
      evolutionInstance: input.evolutionInstance.trim(),
      metaPageId: input.metaPageId.trim(),
      metaGraphVersion: input.metaGraphVersion,
      defaultOwnerId: input.defaultOwnerId,
      defaultUnitId: input.defaultUnitId,
    };
    if (config.defaultOwnerId) {
      const owner = getDb()
        .prepare("SELECT roles FROM users WHERE id=? AND disabled=0")
        .get(config.defaultOwnerId);
      if (
        !owner ||
        !JSON.parse(String(owner["roles"])).some(
          (role: string) => role === "admin" || role === "comercial",
        )
      )
        throw new Error("Responsável inválido.");
    }
    if (
      config.defaultUnitId &&
      !getDb().prepare("SELECT 1 FROM site_units WHERE id=? AND active=1").get(config.defaultUnitId)
    )
      throw new Error("Unidade inválida.");
    for (const field of secretFields) {
      if (input.clearSecrets.includes(field)) config[field] = "";
      else if (input[field]?.trim()) config[field] = input[field]!.trim();
    }
    if (config.evolutionApiKey && !config.evolutionWebhookSecret)
      config.evolutionWebhookSecret = randomBytes(32).toString("hex");
    schema()
      .prepare(
        "INSERT INTO crm_integrations_config VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,encrypted=excluded.encrypted,updated_at=excluded.updated_at",
      )
      .run(revision + 1, seal(config), iso());
    audit(user.id, "crm:integrations:settings", null, { revision: revision + 1 });
    return { revision: revision + 1 };
  });
}
async function evolutionRequest(config: Config, path: string, body?: unknown) {
  if (!config.evolutionUrl || !config.evolutionInstance || !config.evolutionApiKey)
    throw new Error("Configure URL, instância e chave da Evolution nas integrações do CRM.");
  const response = await fetch(
    `${config.evolutionUrl}${path}/${encodeURIComponent(config.evolutionInstance)}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: { apikey: config.evolutionApiKey, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(12_000),
      redirect: "error",
    },
  );
  if (!response.ok)
    throw new Error(`Evolution indisponível ou configuração recusada (HTTP ${response.status}).`);
  return response.json() as Promise<any>;
}
export async function readCrmConnection(actor: SiteUser) {
  const user = com(actor);
  const { config } = configuration();
  const canManage = user.roles.includes("admin");
  const configured = Boolean(
    config.evolutionUrl && config.evolutionInstance && config.evolutionApiKey,
  );
  const result = {
    provider: "evolution" as const,
    configured,
    canManage,
    instance: canManage ? config.evolutionInstance || null : null,
  };
  if (!configured)
    return {
      ...result,
      connected: false,
      state: "unconfigured" as const,
      message:
        "WhatsApp ainda não conectado. Um administrador pode configurar a Evolution nas integrações do CRM.",
    };
  try {
    const response = await evolutionRequest(config, "/instance/connectionState");
    const state = response.instance?.state ?? response.state;
    return {
      ...result,
      connected: state === "open",
      state:
        state === "open"
          ? ("open" as const)
          : state === "connecting"
            ? ("connecting" as const)
            : ("close" as const),
      message:
        state === "open"
          ? "WhatsApp conectado pela Evolution."
          : "Instância configurada, aguardando conexão do WhatsApp.",
    };
  } catch {
    return {
      ...result,
      connected: false,
      state: "error" as const,
      message:
        "Não foi possível verificar a Evolution. Confira a configuração e a disponibilidade do serviço.",
    };
  }
}
export async function prepareCrmEvolutionWebhook(actor: SiteUser) {
  const user = admin(actor);
  const { config } = configuration();
  if (!config.evolutionWebhookSecret)
    throw new Error("Salve primeiro a configuração da Evolution.");
  await evolutionRequest(config, "/webhook/set", {
    webhook: {
      enabled: true,
      url: `${publicBase()}/api/crm/webhooks/evolution`,
      byEvents: false,
      base64: false,
      headers: { "x-crm-webhook-secret": config.evolutionWebhookSecret },
      events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "SEND_MESSAGE"],
    },
  });
  audit(user.id, "crm:integrations:webhook:configured");
  return { ok: true };
}
export async function connectCrmEvolution(actor: SiteUser) {
  admin(actor);
  const { config } = configuration();
  const result = await evolutionRequest(config, "/instance/connect");
  const value = trim(result.base64, 100_000);
  return {
    qrCode: /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null,
    pairingCode: trim(result.pairingCode, 100) || null,
  };
}
export async function sendCrmText(
  actor: SiteUser,
  input: { contactId: string; text: string; clientMessageId?: string | undefined },
) {
  const user = com(actor);
  const contact = requireCrmContact(user, input.contactId);
  const text = input.text.trim();
  if (!text || text.length > 4000) throw new Error("A mensagem deve ter de 1 a 4.000 caracteres.");
  const phone = contact.phone.replace(/\D/g, "");
  const number = phone.length === 10 || phone.length === 11 ? `55${phone}` : phone;
  if (!/^\d{12,15}$/.test(number))
    throw new Error("Cadastre o WhatsApp do contato com DDD e DDI válidos.");
  const { config } = configuration();
  const requestKey = input.clientMessageId || randomUUID();
  const bodyHash = createHash("sha256").update(text).digest("hex");
  const db = schema();
  const previous = db
    .prepare("SELECT * FROM crm_outbox WHERE actor_id=? AND request_key=?")
    .get(user.id, requestKey);
  if (previous) {
    if (previous["contact_id"] !== contact.id || previous["body_hash"] !== bodyHash)
      throw new Error("Identificador de envio já utilizado para outra mensagem.");
    if (previous["state"] === "sent")
      return { id: String(previous["message_id"] || previous["id"]), status: "sent" };
    throw new Error("Este envio já foi iniciado. Confira a conversa antes de tentar novamente.");
  }
  const connection = await readCrmConnection(user);
  if (!connection.connected) throw new Error(connection.message);
  const id = randomUUID();
  try {
    db.prepare(
      "INSERT INTO crm_outbox(id,actor_id,contact_id,request_key,state,created_at,updated_at,body_hash) VALUES(?,?,?,?,?,?,?,?)",
    ).run(id, user.id, contact.id, requestKey, "sending", iso(), iso(), bodyHash);
  } catch {
    throw new Error("Este envio já foi iniciado. Confira a conversa antes de tentar novamente.");
  }
  try {
    const result = await evolutionRequest(config, "/message/sendText", {
      number,
      text,
      linkPreview: false,
    });
    const externalId = trim(result.key?.id, 200);
    if (!externalId) throw new Error("A Evolution não confirmou o identificador da mensagem.");
    const message = recordCrmMessage({
      contactId: contact.id,
      provider: "evolution",
      account: config.evolutionInstance,
      externalId,
      from: "vendedora",
      text,
      status: "sent",
      channel: "whatsapp",
    });
    db.prepare(
      "UPDATE crm_outbox SET state='sent',external_id=?,message_id=?,updated_at=? WHERE id=?",
    ).run(externalId, message.id, iso(), id);
    audit(user.id, "crm:message:sent", contact.id, { provider: "evolution" });
    return { id: message.id, status: "sent" };
  } catch {
    db.prepare("UPDATE crm_outbox SET state='uncertain',updated_at=? WHERE id=?").run(iso(), id);
    audit(user.id, "crm:message:uncertain", contact.id);
    throw new Error(
      "Não foi possível confirmar o envio. Confira a conversa no WhatsApp antes de repetir a mensagem.",
    );
  }
}
const same = (a: string, b: string) =>
  Boolean(a && b) &&
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
const jsonHeaders = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
async function requestBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("body");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 512_000) {
      await reader.cancel();
      throw new Error("size");
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString("utf8");
}
function enqueue(provider: Provider, externalId: string, payload: unknown) {
  const id = randomUUID();
  const encrypted = seal(payload);
  const inserted = schema()
    .prepare("INSERT OR IGNORE INTO crm_webhook_events VALUES(?,?,?,?,'pending',0,?,?,?,NULL)")
    .run(id, provider, externalId, encrypted, Date.now(), iso(), iso());
  startCrmIntegrationWorker();
  if (process.env["CRM_DISABLE_WORKER"] !== "1") void drainCrmIntegrationEvents();
  return { duplicate: Number(inserted.changes) === 0 };
}
export async function handleCrmWebhook(provider: Provider, request: Request) {
  const { config } = configuration();
  if (provider === "meta" && request.method === "GET") {
    const params = new URL(request.url).searchParams;
    if (
      params.get("hub.mode") === "subscribe" &&
      same(params.get("hub.verify_token") || "", config.metaVerifyToken)
    )
      return new Response(params.get("hub.challenge") || "", { headers: jsonHeaders });
    return new Response("Forbidden", { status: 403, headers: jsonHeaders });
  }
  let raw: string;
  let payload: any;
  try {
    raw = await requestBody(request);
    // Provider int64 identifiers can exceed JavaScript's safe integer range.
    payload = JSON.parse(raw, (_name, value, context?: { source?: string }) => {
      if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) {
        if (!context?.source) throw new Error("unsafe_json_integer");
        return context.source;
      }
      return value;
    });
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("body");
  } catch (error) {
    return Response.json(
      { error: "invalid_body" },
      { status: (error as Error).message === "size" ? 413 : 400, headers: jsonHeaders },
    );
  }
  if (provider === "evolution") {
    if (
      !same(request.headers.get("x-crm-webhook-secret") || "", config.evolutionWebhookSecret) ||
      payload.instance !== config.evolutionInstance
    )
      return Response.json({ error: "unauthorized" }, { status: 401, headers: jsonHeaders });
    const event = trim(payload.event, 100).toLowerCase().replace(/_/g, ".");
    if (
      !["messages.upsert", "messages.update", "send.message", "connection.update"].includes(event)
    )
      return Response.json({ ignored: true }, { headers: jsonHeaders });
    // Never persist the API key included by some Evolution versions.
    const data = payload.data;
    if (!data || typeof data !== "object")
      return Response.json({ error: "invalid_data" }, { status: 400, headers: jsonHeaders });
    const minimal = {
      event,
      instance: config.evolutionInstance,
      data: JSON.parse(
        JSON.stringify(data, (name, value) =>
          /^(apikey|api_key|token|access_token|authorization)$/i.test(name) ? undefined : value,
        ),
      ),
    };
    const external = createHash("sha256").update(JSON.stringify(minimal)).digest("hex");
    return Response.json(enqueue(provider, external, minimal), {
      status: 202,
      headers: jsonHeaders,
    });
  }
  if (provider === "google") {
    if (!same(trim(payload.google_key, 500), config.googleWebhookKey))
      return Response.json({ error: "unauthorized" }, { status: 401, headers: jsonHeaders });
    if (payload.is_test === true) return Response.json({ test: true }, { headers: jsonHeaders });
    const id = trim(payload.lead_id, 200);
    if (!id || !Array.isArray(payload.user_column_data))
      return Response.json({ error: "invalid_lead" }, { status: 400, headers: jsonHeaders });
    const fields = payload.user_column_data.slice(0, 50).map((field: any) => ({
      id: trim(field.column_id, 80),
      value: trim(field.string_value, 2000),
    }));
    return Response.json(
      enqueue(provider, id, {
        id,
        fields,
        campaignId: trim(payload.campaign_id, 100),
        formId: trim(payload.form_id, 100),
      }),
      { status: 202, headers: jsonHeaders },
    );
  }
  if (!config.metaAppSecret || !config.metaPageToken || !config.metaPageId)
    return Response.json({ error: "not_configured" }, { status: 503, headers: jsonHeaders });
  const signature = request.headers.get("x-hub-signature-256") || "";
  const expected = `sha256=${createHmac("sha256", config.metaAppSecret).update(raw!).digest("hex")}`;
  if (!same(signature, expected))
    return Response.json({ error: "unauthorized" }, { status: 401, headers: jsonHeaders });
  if (payload.object !== "page" || !Array.isArray(payload.entry))
    return Response.json({ ignored: true }, { headers: jsonHeaders });
  let count = 0;
  for (const entry of payload.entry.slice(0, 30)) {
    if (String(entry.id) !== config.metaPageId) continue;
    for (const change of (Array.isArray(entry.changes) ? entry.changes : []).slice(0, 50)) {
      const id = trim(change.value?.leadgen_id, 100);
      if (change.field !== "leadgen" || !/^\d+$/.test(id)) continue;
      enqueue(provider, id, {
        id,
        pageId: config.metaPageId,
        formId: trim(change.value.form_id, 100),
        adId: trim(change.value.ad_id, 100),
      });
      count++;
    }
  }
  return Response.json({ received: count }, { status: 200, headers: jsonHeaders });
}
async function processEvent(provider: Provider, payload: any) {
  const { config } = configuration();
  const owner = config.defaultOwnerId || undefined;
  const unit = config.defaultUnitId || null;
  if (provider === "google") {
    const fields = new Map<string, string>(
      payload.fields.map((field: any) => [field.id, field.value]),
    );
    const name =
      fields.get("FULL_NAME") ||
      [fields.get("FIRST_NAME"), fields.get("LAST_NAME")].filter(Boolean).join(" ") ||
      "Contato Google";
    ingestCrmLead({
      provider: "google",
      externalId: payload.id,
      name,
      phone: fields.get("PHONE_NUMBER") || fields.get("PHONE_NUMBER_VERIFIED"),
      email: fields.get("EMAIL") || fields.get("WORK_EMAIL"),
      company: fields.get("COMPANY_NAME"),
      city: fields.get("CITY"),
      title: `Contato Google — ${name}`,
      interest:
        `Formulário ${payload.formId || "não informado"} · Campanha ${payload.campaignId || "não informada"}\n${[...fields.entries()].map(([key, value]) => `${key}: ${value}`).join("\n")}`.slice(
          0,
          5000,
        ),
      origin: "Anúncio Google",
      ownerId: owner,
      unitId: unit,
    });
    return;
  }
  if (provider === "meta") {
    if (!/^\d+$/.test(payload.id)) throw new Error("invalid_id");
    const url = `https://graph.facebook.com/${config.metaGraphVersion}/${payload.id}?fields=id,created_time,field_data,ad_id,form_id`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.metaPageToken}` },
      signal: AbortSignal.timeout(12_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`meta_http_${response.status}`);
    const lead = (await response.json()) as any;
    const fields = new Map<string, string>(
      (lead.field_data || [])
        .slice(0, 50)
        .map((field: any) => [trim(field.name, 100), trim((field.values || []).join(", "), 2000)]),
    );
    const name =
      fields.get("full_name") ||
      [fields.get("first_name"), fields.get("last_name")].filter(Boolean).join(" ") ||
      "Contato Meta";
    ingestCrmLead({
      provider: "meta",
      externalId: payload.id,
      name,
      phone: fields.get("phone_number"),
      email: fields.get("email"),
      company: fields.get("company_name"),
      city: fields.get("city"),
      title: `Contato Meta — ${name}`,
      interest:
        `Formulário ${payload.formId || lead.form_id || "não informado"} · Anúncio ${payload.adId || lead.ad_id || "não informado"}\n${[...fields.entries()].map(([key, value]) => `${key}: ${value}`).join("\n")}`.slice(
          0,
          5000,
        ),
      origin: "Anúncio Meta",
      ownerId: owner,
      unitId: unit,
    });
    return;
  }
  if (payload.event === "connection.update") return;
  const list = Array.isArray(payload.data) ? payload.data : [payload.data];
  for (const message of list.slice(0, 100)) {
    const externalId = trim(message.key?.id || message.keyId || message.id, 200);
    if (payload.event === "messages.update") {
      // Delivery updates only affect the matching instance/external message, never another channel.
      const status = trim(message.update?.status ?? message.status, 40);
      if (externalId && status) {
        const rank =
          (
            {
              "2": 1,
              SENT: 1,
              SERVER_ACK: 1,
              "3": 2,
              DELIVERED: 2,
              DELIVERY_ACK: 2,
              "4": 3,
              READ: 3,
              "5": 4,
              PLAYED: 4,
            } as Record<string, number>
          )[status.toUpperCase()] || 0;
        const mapped =
          rank >= 3 ? "read" : rank === 2 ? "delivered" : rank === 1 ? "sent" : "pending";
        // Schema belongs to crm.server; a dedicated update hook is used when available below.
        const { updateCrmMessageStatus } = await import("./crm.server.ts");
        updateCrmMessageStatus({
          provider: "evolution",
          account: payload.instance,
          externalId,
          status: mapped,
        });
      }
      continue;
    }
    const jid = trim(message.key?.remoteJid, 200);
    if (!externalId || !jid.endsWith("@s.whatsapp.net")) continue; // Groups, status and unresolved LIDs aren't sales contacts.
    const phone = jid.split("@")[0]?.replace(/\D/g, "") || "";
    if (!/^\d{10,15}$/.test(phone)) continue;
    const content = message.message || {};
    const text =
      trim(
        content.conversation ||
          content.extendedTextMessage?.text ||
          content.imageMessage?.caption ||
          content.documentMessage?.caption,
        4000,
      ) ||
      (content.audioMessage
        ? "[Áudio recebido no WhatsApp]"
        : content.imageMessage
          ? "[Imagem recebida no WhatsApp]"
          : content.documentMessage
            ? "[Documento recebido no WhatsApp]"
            : content.videoMessage
              ? "[Vídeo recebido no WhatsApp]"
              : "[Mensagem recebida no WhatsApp]");
    const fromMe = message.key?.fromMe === true;
    const alreadyRecorded = getDb()
      .prepare(
        "SELECT contact_id FROM crm_messages WHERE provider='evolution' AND account=? AND external_id=?",
      )
      .get(payload.instance, externalId);
    // Echoes of a CRM send must not create another customer/opportunity under the ingress owner.
    if (alreadyRecorded) continue;
    const existing = findCrmContactByPhone(phone);
    if (fromMe && !existing) continue;
    const contact =
      existing ||
      ingestCrmLead({
        provider: "evolution-contact",
        externalId: `${payload.instance}:${phone}`,
        name: trim(message.pushName, 120) || phone,
        phone,
        title: "Atendimento WhatsApp",
        interest: "Contato recebido pelo WhatsApp",
        origin: "WhatsApp",
        ownerId: owner,
        unitId: unit,
      }).contact;
    const timestamp = Number(message.messageTimestamp);
    const at =
      Number.isFinite(timestamp) && timestamp > 0 && timestamp < Date.now() / 1000 + 86_400
        ? new Date(timestamp * 1000).toISOString()
        : iso();
    recordCrmMessage({
      contactId: contact.id,
      provider: "evolution",
      account: payload.instance,
      externalId,
      from: fromMe ? "vendedora" : "cliente",
      text,
      at,
      status: fromMe ? "sent" : "received",
      channel: "whatsapp",
    });
  }
}
let draining = false;
export async function drainCrmIntegrationEvents() {
  if (draining) return;
  draining = true;
  try {
    const db = schema();
    const stale = new Date(Date.now() - 120_000).toISOString();
    db.prepare(
      "UPDATE crm_webhook_events SET state='pending' WHERE state='processing' AND updated_at<?",
    ).run(stale);
    const rows = db
      .prepare(
        "SELECT * FROM crm_webhook_events WHERE state='pending' AND available_at<=? ORDER BY created_at LIMIT 10",
      )
      .all(Date.now());
    for (const row of rows) {
      const attempts = Number(row["attempts"]) + 1;
      db.prepare(
        "UPDATE crm_webhook_events SET state='processing',attempts=?,updated_at=? WHERE id=?",
      ).run(attempts, iso(), String(row["id"]));
      try {
        await processEvent(row["provider"] as Provider, unseal(String(row["encrypted"])));
        db.prepare(
          "UPDATE crm_webhook_events SET state='done',error_code=NULL,updated_at=? WHERE id=?",
        ).run(iso(), String(row["id"]));
      } catch {
        db.prepare(
          "UPDATE crm_webhook_events SET state=?,error_code='processing_failed',available_at=?,updated_at=? WHERE id=?",
        ).run(
          attempts >= 5 ? "error" : "pending",
          Date.now() + Math.min(15 * 60_000, 15_000 * 2 ** attempts),
          iso(),
          String(row["id"]),
        );
      }
    }
  } catch {
    /* Durable events remain available; status and reprocessing are visible to administrators. */
  } finally {
    draining = false;
  }
}
let interval: ReturnType<typeof setInterval> | undefined;
export function startCrmIntegrationWorker() {
  if (interval || process.env["CRM_DISABLE_WORKER"] === "1") return;
  interval = setInterval(() => {
    void drainCrmIntegrationEvents();
  }, 15_000);
  interval.unref?.();
  void drainCrmIntegrationEvents();
}
export function listCrmIntegrationEvents(actor: SiteUser) {
  admin(actor);
  return schema()
    .prepare(
      "SELECT id,provider,state,attempts,created_at createdAt,updated_at updatedAt,error_code errorCode FROM crm_webhook_events ORDER BY created_at DESC LIMIT 30",
    )
    .all()
    .map((row) => ({
      id: String(row["id"]),
      provider: String(row["provider"]),
      state: String(row["state"]),
      attempts: Number(row["attempts"]),
      createdAt: String(row["createdAt"]),
      updatedAt: String(row["updatedAt"]),
      errorCode: row["errorCode"] ? String(row["errorCode"]) : null,
    }));
}
export function retryCrmIntegrationEvent(actor: SiteUser, id: string) {
  const user = admin(actor);
  const result = schema()
    .prepare(
      "UPDATE crm_webhook_events SET state='pending',attempts=0,available_at=?,updated_at=? WHERE id=? AND state IN ('error','pending')",
    )
    .run(Date.now(), iso(), id);
  if (!Number(result.changes)) throw new Error("Evento não encontrado ou já processado.");
  audit(user.id, "crm:integrations:retry", id);
  void drainCrmIntegrationEvents();
  return { ok: true };
}
