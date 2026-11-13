import { randomUUID } from "node:crypto";
import { getDb, audit } from "./local-db.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";
import {
  createContact,
  createOpportunity,
  ensureCrmSchema,
  findCrmContactByPhone,
  listCrmMessagesPage,
  recordCrmMessage,
  requireCrmContact,
  requireCrmOpportunity,
  updateContact,
} from "./crm.server.ts";
import type { Contact, Message } from "./crm.ts";
import { brPhoneVariants, samePhone } from "./br-phone.ts";

type Row = Record<string, any>;
const initialized = new WeakSet<object>();
const value = (input: unknown, max = 200) =>
  String(input ?? "")
    .trim()
    .slice(0, max);
const normalizePhone = (input: unknown) => {
  const digits = value(input, 40).replace(/\D/g, "");
  const phone = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  if (phone && !/^\d{10,15}$/.test(phone)) throw new Error("Telefone WhatsApp inválido");
  return phone;
};
let counter = 0;
function atomic<T>(work: () => T): T {
  const db = getDb(),
    name = `waha_store_${++counter}`;
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
export function ensureWhatsAppStoreSchema() {
  const db = ensureCrmSchema();
  if (initialized.has(db)) return db;
  db.exec(`CREATE TABLE IF NOT EXISTS crm_whatsapp_bindings (
    id TEXT PRIMARY KEY, session TEXT NOT NULL, chat_id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
    contact_id TEXT NOT NULL REFERENCES crm_contacts(id), opportunity_id TEXT REFERENCES crm_opportunities(id),
    phone TEXT NOT NULL DEFAULT '', triage_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(session,chat_id));
    CREATE TABLE IF NOT EXISTS crm_whatsapp_identities (
      session TEXT NOT NULL, address TEXT NOT NULL, binding_id TEXT NOT NULL REFERENCES crm_whatsapp_bindings(id),
      PRIMARY KEY(session,address));
    CREATE TABLE IF NOT EXISTS crm_whatsapp_history_checkpoints (
      session TEXT NOT NULL, chat_id TEXT NOT NULL, cursor TEXT, state TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(session,chat_id));`);
  initialized.add(db);
  return db;
}
function ownerActor(ownerId: string): SiteUser {
  if (!ownerId) throw new Error("Defina a vendedora responsável antes de processar o WhatsApp");
  const row = getDb()
    .prepare("SELECT id,email,roles,created_at FROM users WHERE id=? AND disabled=0")
    .get(ownerId) as Row | undefined;
  if (!row) throw new Error("Vendedora responsável indisponível");
  return requireActiveUser(
    {
      id: row["id"],
      email: row["email"],
      roles: JSON.parse(row["roles"]),
      created_at: row["created_at"],
    },
    ["admin", "comercial"],
  );
}
function chatAddress(input: string) {
  const address = value(input, 200).replace(/@s\.whatsapp\.net$/, "@c.us");
  if (!/^\d{5,30}@(c\.us|lid)$/.test(address))
    throw new Error("Endereço WhatsApp não suportado para atendimento individual");
  return address;
}
export interface IngestWahaMessageInput {
  session: string;
  externalId: string;
  chatId: string;
  phone?: string | undefined;
  name?: string | undefined;
  from: "cliente" | "vendedora";
  text: string;
  at?: string | undefined;
  status?: string | undefined;
  historical?: boolean | undefined;
  /** Arrived while the line was offline and was found after the reconnection (treated as live). */
  recovered?: boolean | undefined;
  ownerId: string;
  unitId?: string | null | undefined;
}
/** Trusted transport entry point. Invoke only after validating the WAHA webhook/session or an authorized sync. */
export function ingestWahaMessage(input: IngestWahaMessageInput): {
  message: Message;
  contactId: string;
  opportunityId: string | null;
  triageReason: string | null;
  duplicate: boolean;
  /** True when this message opened a new conversation in the CRM (new binding). */
  created: boolean;
} {
  const db = ensureWhatsAppStoreSchema();
  const actor = ownerActor(input.ownerId);
  const session = value(input.session, 160),
    externalId = value(input.externalId, 240),
    address = chatAddress(input.chatId);
  if (!session || !externalId)
    throw new Error("Sessão e identificador da mensagem são obrigatórios");
  const phone = normalizePhone(
    input.phone || (address.endsWith("@c.us") ? address.split("@")[0] : ""),
  );
  const at = input.at ? new Date(input.at) : new Date();
  if (!Number.isFinite(at.getTime())) throw new Error("Data da mensagem inválida");
  return atomic(() => {
    const recorded = db
      .prepare(
        "SELECT contact_id FROM crm_messages WHERE provider='waha' AND account=? AND external_id=?",
      )
      .get(session, externalId);
    if (recorded) {
      const contact = requireCrmContact(actor, String(recorded["contact_id"]));
      const binding = db
        .prepare(
          "SELECT opportunity_id,triage_reason FROM crm_whatsapp_bindings WHERE session=? AND contact_id=? ORDER BY created_at LIMIT 1",
        )
        .get(session, contact.id);
      const message = recordCrmMessage({
        contactId: contact.id,
        provider: "waha",
        account: session,
        externalId,
        from: input.from,
        text: input.text,
        at: at.toISOString(),
        status: input.status,
        historical: input.historical,
        suppressOpportunityUpdate: true,
      });
      return {
        message,
        contactId: contact.id,
        opportunityId: binding?.["opportunity_id"] ? String(binding["opportunity_id"]) : null,
        triageReason: binding?.["triage_reason"] ? String(binding["triage_reason"]) : null,
        duplicate: true,
        created: false,
      };
    }
    // Both Brazilian spellings (with/without the 9th digit) identify the same conversation.
    const identities = [
      ...new Set([address, ...brPhoneVariants(phone).map((item) => `${item}@c.us`)]),
    ];
    const found = identities
      .map((identity) =>
        db
          .prepare(
            "SELECT b.* FROM crm_whatsapp_identities i JOIN crm_whatsapp_bindings b ON b.id=i.binding_id WHERE i.session=? AND i.address=?",
          )
          .get(session, identity),
      )
      .filter(Boolean) as Row[];
    let binding = found[0];
    const created = !binding;
    if (binding && binding["owner_id"] !== actor.id)
      throw new Error(
        "O atendimento está vinculado a outra carteira; revise a configuração administrativa",
      );
    let triageReason: string | null =
      new Set(found.map((row) => row["id"])).size > 1 ? "identity_conflict" : null;
    let contact: Contact;
    if (binding) contact = requireCrmContact(actor, binding["contact_id"]);
    else {
      const existing = phone ? findCrmContactByPhone(phone, actor.id) : null;
      contact =
        existing ||
        createContact(actor, {
          name: value(input.name, 200) || (phone ? `Contato ${phone}` : "Contato WhatsApp"),
          phone,
          ownerId: actor.id,
          unitId: input.unitId || null,
        });
      const id = randomUUID(),
        now = new Date().toISOString();
      db.prepare(
        "INSERT INTO crm_whatsapp_bindings(id,session,chat_id,owner_id,contact_id,phone,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      ).run(id, session, address, actor.id, contact.id, phone, now, now);
      binding = db.prepare("SELECT * FROM crm_whatsapp_bindings WHERE id=?").get(id) as Row;
    }
    if (phone && contact.phone && !samePhone(contact.phone, phone))
      triageReason = "identity_conflict";
    if (phone && !contact.phone && !triageReason) {
      const match = findCrmContactByPhone(phone, actor.id);
      if (match && match.id !== contact.id) triageReason = "identity_conflict";
      else
        contact = updateContact(actor, {
          ...contact,
          id: contact.id,
          revision: contact.revision,
          phone,
        });
    }
    for (const identity of identities) {
      const previous = db
        .prepare("SELECT binding_id FROM crm_whatsapp_identities WHERE session=? AND address=?")
        .get(session, identity);
      if (previous && previous["binding_id"] !== binding!["id"]) {
        triageReason = "identity_conflict";
        continue;
      }
      db.prepare(
        "INSERT OR IGNORE INTO crm_whatsapp_identities(session,address,binding_id) VALUES(?,?,?)",
      ).run(session, identity, binding!["id"]);
    }
    if (!contact.phone && !triageReason) triageReason = "unresolved_identity";
    let opportunityId: string | null = binding!["opportunity_id"] || null;
    let createdOpportunity = false;
    const open = db
      .prepare(
        "SELECT id FROM crm_opportunities WHERE contact_id=? AND owner_id=? AND stage NOT IN ('fechado','perdido') ORDER BY created_at,id",
      )
      .all(contact.id, actor.id);
    if (!open.some((row) => row["id"] === opportunityId)) opportunityId = null;
    if (!opportunityId && open.length === 1) opportunityId = String(open[0]!["id"]);
    if (!opportunityId && open.length > 1) triageReason ||= "multiple_open_opportunities";
    if (
      !opportunityId &&
      !open.length &&
      input.from === "cliente" &&
      !input.historical &&
      !triageReason
    ) {
      opportunityId = createOpportunity(actor, {
        contactId: contact.id,
        title: "Atendimento WhatsApp",
        interest: input.recovered
          ? "Contato recebido pelo WhatsApp enquanto a linha estava desconectada"
          : "Contato recebido pelo WhatsApp",
        origin: "WhatsApp",
        unitId: input.unitId || contact.unitId,
      }).id;
      createdOpportunity = true;
    }
    db.prepare(
      "UPDATE crm_whatsapp_bindings SET opportunity_id=?,phone=?,triage_reason=?,updated_at=? WHERE id=?",
    ).run(opportunityId, contact.phone, triageReason, new Date().toISOString(), binding!["id"]);
    const message = recordCrmMessage({
      contactId: contact.id,
      provider: "waha",
      account: session,
      externalId,
      from: input.from,
      text: input.text,
      at: at.toISOString(),
      status: input.status,
      channel: "whatsapp",
      historical: input.historical,
      suppressOpportunityUpdate: true,
    });
    if (!input.historical && opportunityId && !triageReason) {
      const op = requireCrmOpportunity(actor, opportunityId);
      // Connector pages are newest first. An older incoming page may open the opportunity only
      // after a newer phone reply was already stored, so initialize it from the saved timeline.
      const latest = createdOpportunity
        ? db.prepare("SELECT sender,sent_at FROM crm_messages WHERE contact_id=? AND provider='waha' AND account=? AND sender IN ('cliente','vendedora') ORDER BY sent_at DESC,id DESC LIMIT 1").get(contact.id, session)
        : null;
      const newer = latest && String(latest["sent_at"]) > at.toISOString();
      const interactionAt = newer ? String(latest["sent_at"]) : at.toISOString();
      const awaitingReply = newer ? latest["sender"] === "cliente" : input.from === "cliente";
      if (createdOpportunity || interactionAt >= op.lastInteraction)
        db.prepare(
          "UPDATE crm_opportunities SET awaiting_reply=?,last_interaction=?,revision=revision+1,updated_at=? WHERE id=?",
        ).run(
          Number(awaitingReply),
          interactionAt,
          new Date().toISOString(),
          opportunityId,
        );
    }
    return {
      message,
      contactId: contact.id,
      opportunityId,
      triageReason,
      duplicate: false,
      created,
    };
  });
}
/** Admin/user selection binds context only; it never moves a stage or changes a proposal. */
export function bindWahaConversationOpportunity(
  actor: SiteUser,
  input: { session: string; chatId: string; opportunityId: string },
) {
  actor = requireActiveUser(actor, ["admin", "comercial"]);
  const db = ensureWhatsAppStoreSchema(),
    address = chatAddress(input.chatId);
  const binding = db
    .prepare("SELECT * FROM crm_whatsapp_bindings WHERE session=? AND chat_id=?")
    .get(input.session, address) as Row | undefined;
  if (!binding) throw new Error("Atendimento não encontrado");
  if (binding["triage_reason"] && binding["triage_reason"] !== "multiple_open_opportunities")
    throw new Error("Revise a identificação do contato antes de vincular uma oportunidade");
  const contact = requireCrmContact(actor, binding["contact_id"]),
    op = requireCrmOpportunity(actor, input.opportunityId);
  if (op.contactId !== contact.id || ["fechado", "perdido"].includes(op.stage))
    throw new Error("Escolha uma oportunidade aberta deste contato");
  db.prepare(
    "UPDATE crm_whatsapp_bindings SET opportunity_id=?,triage_reason=NULL,updated_at=? WHERE id=?",
  ).run(op.id, new Date().toISOString(), binding["id"]);
  audit(actor.id, "crm:waha:context", op.id);
  return { ok: true };
}
export function readWahaContactContext(
  actor: SiteUser,
  input: { session: string; contactId: string },
) {
  actor = requireActiveUser(actor, ["admin", "comercial"]);
  requireCrmContact(actor, input.contactId);
  const rows = ensureWhatsAppStoreSchema()
    .prepare(
      "SELECT opportunity_id,triage_reason FROM crm_whatsapp_bindings WHERE session=? AND contact_id=? ORDER BY updated_at DESC",
    )
    .all(input.session, input.contactId);
  if (!rows.length) return null;
  return {
    opportunityId: rows[0]?.["opportunity_id"] ? String(rows[0]["opportunity_id"]) : null,
    triageReason: rows.find((row) => row["triage_reason"])?.["triage_reason"]
      ? String(rows.find((row) => row["triage_reason"])!["triage_reason"])
      : null,
  };
}
export function bindWahaContactOpportunity(
  actor: SiteUser,
  input: { session: string; contactId: string; opportunityId: string },
) {
  actor = requireActiveUser(actor, ["admin", "comercial"]);
  requireCrmContact(actor, input.contactId);
  const db = ensureWhatsAppStoreSchema();
  const rows = db
    .prepare(
      "SELECT chat_id,triage_reason FROM crm_whatsapp_bindings WHERE session=? AND contact_id=?",
    )
    .all(input.session, input.contactId);
  if (!rows.length) throw new Error("Atendimento WhatsApp não encontrado");
  if (
    rows.some(
      (row) => row["triage_reason"] && row["triage_reason"] !== "multiple_open_opportunities",
    )
  )
    throw new Error("Revise a identificação do contato antes de vincular uma oportunidade");
  return atomic(() => {
    for (const row of rows)
      bindWahaConversationOpportunity(actor, {
        session: input.session,
        chatId: String(row["chat_id"]),
        opportunityId: input.opportunityId,
      });
    return { ok: true };
  });
}
export function readWahaHistoryCheckpoint(session: string, chatId: string) {
  const row = ensureWhatsAppStoreSchema()
    .prepare(
      "SELECT cursor,state,updated_at FROM crm_whatsapp_history_checkpoints WHERE session=? AND chat_id=?",
    )
    .get(session, chatAddress(chatId));
  return row
    ? {
        cursor: row["cursor"] ? String(row["cursor"]) : null,
        state: String(row["state"]),
        updatedAt: String(row["updated_at"]),
      }
    : null;
}
export function saveWahaHistoryCheckpoint(input: {
  session: string;
  chatId: string;
  cursor: string | null;
  state: "pending" | "done" | "error";
}) {
  ensureWhatsAppStoreSchema()
    .prepare(
      "INSERT INTO crm_whatsapp_history_checkpoints(session,chat_id,cursor,state,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(session,chat_id) DO UPDATE SET cursor=excluded.cursor,state=excluded.state,updated_at=excluded.updated_at",
    )
    .run(
      value(input.session, 160),
      chatAddress(input.chatId),
      input.cursor?.slice(0, 1000) || null,
      input.state,
      new Date().toISOString(),
    );
}
export { listCrmMessagesPage };
