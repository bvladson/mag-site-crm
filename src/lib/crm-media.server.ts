import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { dataDirectory, getDb, audit } from "./local-db.server.ts";
import { ensureCrmSchema, requireCrmContact } from "./crm.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";
import type { CrmAttachment } from "./crm.ts";

export const CRM_MEDIA_MAX_BYTES = 7 * 1024 * 1024;
type Row = Record<string, any>;
const initialized = new WeakSet<object>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function ensureCrmMediaSchema() {
  const db = ensureCrmSchema();
  if (initialized.has(db)) return db;
  db.exec(`CREATE TABLE IF NOT EXISTS crm_media (
    id TEXT PRIMARY KEY, contact_id TEXT NOT NULL REFERENCES crm_contacts(id), message_id TEXT REFERENCES crm_messages(id), consumed_message_id TEXT REFERENCES crm_messages(id),
    uploaded_by TEXT REFERENCES users(id), external_key TEXT UNIQUE, name TEXT NOT NULL, mime_type TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('image','audio','document')), size INTEGER NOT NULL, sha256 TEXT NOT NULL,
    storage_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS crm_media_message ON crm_media(message_id);
    CREATE INDEX IF NOT EXISTS crm_media_contact ON crm_media(contact_id);`);
  if (
    !db
      .prepare("SELECT 1 FROM pragma_table_info('crm_media') WHERE name='consumed_message_id'")
      .get()
  )
    db.exec(
      "ALTER TABLE crm_media ADD COLUMN consumed_message_id TEXT REFERENCES crm_messages(id)",
    );
  initialized.add(db);
  return db;
}
const safeName = (input: string) => {
  const name = String(input || "arquivo")
    .replace(/\\/g, "/")
    .split("/")
    .at(-1)!
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 180);
  return name && name !== "." && name !== ".." ? name : "arquivo";
};
function identify(bytes: Buffer, filename: string, claimed: string) {
  const prefix = bytes.subarray(0, 16),
    extension = filename.split(".").at(-1)?.toLowerCase();
  let mimeType: string;
  let kind: CrmAttachment["kind"];
  if (prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mimeType = "image/png";
    kind = "image";
  } else if (prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    mimeType = "image/jpeg";
    kind = "image";
  } else if (["GIF87a", "GIF89a"].includes(prefix.subarray(0, 6).toString("ascii"))) {
    mimeType = "image/gif";
    kind = "image";
  } else if (
    prefix.subarray(0, 4).toString("ascii") === "RIFF" &&
    prefix.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    mimeType = "image/webp";
    kind = "image";
  } else if (prefix.subarray(0, 4).toString("ascii") === "OggS") {
    mimeType = "audio/ogg";
    kind = "audio";
  } else if (
    prefix.subarray(0, 3).toString("ascii") === "ID3" ||
    (prefix[0] === 0xff && (prefix[1]! & 0xe0) === 0xe0)
  ) {
    mimeType = "audio/mpeg";
    kind = "audio";
  } else if (
    prefix.subarray(0, 4).toString("ascii") === "RIFF" &&
    prefix.subarray(8, 12).toString("ascii") === "WAVE"
  ) {
    mimeType = "audio/wav";
    kind = "audio";
  } else if (
    prefix.subarray(4, 8).toString("ascii") === "ftyp" &&
    ["m4a", "mp4"].includes(extension || "") &&
    /^(audio\/|application\/octet-stream$|$)/.test(claimed)
  ) {
    mimeType = "audio/mp4";
    kind = "audio";
  } else if (prefix.subarray(0, 5).toString("ascii") === "%PDF-") {
    mimeType = "application/pdf";
    kind = "document";
  } else if (
    prefix.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])) &&
    ["docx", "xlsx", "pptx"].includes(extension || "")
  ) {
    mimeType = (
      {
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      } as Record<string, string>
    )[extension!]!;
    kind = "document";
  } else if (
    prefix.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225])) &&
    ["doc", "xls", "ppt"].includes(extension || "")
  ) {
    mimeType = (
      {
        doc: "application/msword",
        xls: "application/vnd.ms-excel",
        ppt: "application/vnd.ms-powerpoint",
      } as Record<string, string>
    )[extension!]!;
    kind = "document";
  } else if (extension === "txt" && !bytes.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("Arquivo de texto inválido");
    }
    mimeType = "text/plain";
    kind = "document";
  } else
    throw new Error(
      "Tipo de arquivo não suportado. Use imagem, áudio, PDF ou documento de escritório.",
    );
  const canonical =
    (
      {
        "image/jpg": "image/jpeg",
        "audio/mp3": "audio/mpeg",
        "audio/x-wav": "audio/wav",
        "audio/x-m4a": "audio/mp4",
        "application/ogg": "audio/ogg",
      } as Record<string, string>
    )[claimed] || claimed;
  if (canonical && canonical !== "application/octet-stream" && canonical !== mimeType)
    throw new Error("O conteúdo do arquivo não corresponde ao tipo informado");
  return { mimeType, kind };
}
const metadata = (row: Row): CrmAttachment => ({
  id: row["id"],
  name: row["name"],
  mimeType: row["mime_type"],
  size: Number(row["size"]),
  kind: row["kind"],
  status: "ready",
  downloadUrl: `/api/interno/crm/anexos/${row["id"]}`,
});
function mediaRoot() {
  const directory = join(dataDirectory(), "crm-media");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink()) throw new Error("Diretório de anexos inválido");
  return realpathSync(directory);
}
function filePath(storageId: string) {
  if (!uuid.test(storageId)) throw new Error("Identificador de arquivo inválido");
  const root = mediaRoot(),
    path = resolve(root, storageId);
  if (!path.startsWith(root + sep)) throw new Error("Caminho de arquivo inválido");
  return path;
}
interface MediaInput {
  contactId: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}
function save(
  input: MediaInput & {
    messageId?: string | undefined;
    actorId?: string | undefined;
    externalKey?: string | undefined;
  },
): CrmAttachment {
  const db = ensureCrmMediaSchema();
  const contact = db.prepare("SELECT id FROM crm_contacts WHERE id=?").get(input.contactId);
  if (!contact) throw new Error("Contato não encontrado");
  const bytes = Buffer.from(input.bytes);
  if (!bytes.length || bytes.length > CRM_MEDIA_MAX_BYTES)
    throw new Error("O arquivo deve ter entre 1 byte e 7 MiB");
  const name = safeName(input.name),
    claimed = String(input.mimeType || "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
  const format = identify(bytes, name, claimed),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const externalKey = input.externalKey?.trim().slice(0, 500) || null;
  if (input.messageId) {
    const message = db
      .prepare("SELECT contact_id,sender FROM crm_messages WHERE id=?")
      .get(input.messageId);
    if (!message || message["contact_id"] !== input.contactId)
      throw new Error("Anexo e mensagem pertencem a atendimentos diferentes");
    if (message["sender"] === "vendedora") {
      const attached = db
        .prepare("SELECT * FROM crm_media WHERE message_id=? ORDER BY created_at,id LIMIT 1")
        .get(input.messageId) as Row | undefined;
      if (attached) return metadata(attached); // A later provider echo must not duplicate an already attached outgoing file.
    }
  }
  if (externalKey) {
    const previous = db.prepare("SELECT * FROM crm_media WHERE external_key=?").get(externalKey) as
      Row | undefined;
    if (previous) {
      if (
        previous["contact_id"] !== input.contactId ||
        previous["message_id"] !== input.messageId ||
        previous["sha256"] !== sha256
      )
        throw new Error("Identificador de anexo já utilizado para outro conteúdo");
      return metadata(previous);
    }
  }
  const id = randomUUID(),
    storageId = randomUUID(),
    path = filePath(storageId),
    temp = `${path}.tmp`;
  try {
    writeFileSync(temp, bytes, { flag: "wx", mode: 0o600 });
    renameSync(temp, path);
    db.prepare(
      "INSERT INTO crm_media(id,contact_id,message_id,uploaded_by,external_key,name,mime_type,kind,size,sha256,storage_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      input.contactId,
      input.messageId || null,
      input.actorId || null,
      externalKey,
      name,
      format.mimeType,
      format.kind,
      bytes.length,
      sha256,
      storageId,
      new Date().toISOString(),
    );
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    if (existsSync(path)) unlinkSync(path);
    throw error;
  }
  return metadata(db.prepare("SELECT * FROM crm_media WHERE id=?").get(id) as Row);
}
export function stageCrmMedia(actor: SiteUser, input: MediaInput) {
  actor = requireActiveUser(actor, ["admin", "comercial"]);
  requireCrmContact(actor, input.contactId);
  const attachment = save({ ...input, actorId: actor.id });
  audit(actor.id, "crm:media:uploaded", attachment.id);
  return attachment;
}
/** Trusted server download only, after validating provider/authentication and the media URL origin. */
export function saveIncomingCrmMedia(
  input: MediaInput & { messageId: string; externalKey: string },
) {
  return save(input);
}
function authorizedRow(actor: SiteUser, id: string) {
  if (!uuid.test(id)) throw new Error("Anexo não encontrado");
  const row = ensureCrmMediaSchema().prepare("SELECT * FROM crm_media WHERE id=?").get(id) as
    Row | undefined;
  if (!row) throw new Error("Anexo não encontrado");
  requireCrmContact(actor, row["contact_id"]);
  if (!row["message_id"] && row["uploaded_by"] !== actor.id && !actor.roles.includes("admin"))
    throw new Error("Forbidden: anexo em preparação por outra pessoa");
  return row;
}
function readBytes(row: Row) {
  const path = filePath(row["storage_id"]);
  if (!existsSync(path) || lstatSync(path).isSymbolicLink())
    throw new Error("Arquivo do anexo indisponível");
  const bytes = readFileSync(path);
  if (
    bytes.length !== Number(row["size"]) ||
    createHash("sha256").update(bytes).digest("hex") !== row["sha256"]
  )
    throw new Error("Arquivo do anexo inválido");
  return bytes;
}
export function getCrmMediaForSend(actor: SiteUser, id: string) {
  actor = requireActiveUser(actor, ["admin", "comercial"]);
  const row = authorizedRow(actor, id);
  if (row["message_id"] || row["consumed_message_id"])
    throw new Error(
      "Este anexo já pertence a uma mensagem. Envie um novo arquivo para outro envio.",
    );
  return { ...metadata(row), contactId: String(row["contact_id"]), bytes: readBytes(row) };
}
export function bindCrmMediaToMessage(actor: SiteUser, ids: string[], messageId: string) {
  actor = requireActiveUser(actor, ["admin", "comercial"]);
  if (ids.length !== 1) throw new Error("Envie um anexo por mensagem");
  const db = ensureCrmMediaSchema(),
    message = db.prepare("SELECT contact_id,sender FROM crm_messages WHERE id=?").get(messageId);
  if (!message) throw new Error("Mensagem não encontrada");
  if (message["sender"] !== "vendedora")
    throw new Error("Anexos preparados só podem ser vinculados ao envio da vendedora");
  requireCrmContact(actor, String(message["contact_id"]));
  const rows = ids.map((id) => authorizedRow(actor, id));
  for (const row of rows) {
    if (
      row["contact_id"] !== message["contact_id"] ||
      (row["message_id"] && row["message_id"] !== messageId) ||
      (row["consumed_message_id"] && row["consumed_message_id"] !== messageId)
    )
      throw new Error("Anexo já utilizado ou de outro atendimento");
  }
  const name = `crm_media_bind_${randomUUID().replaceAll("-", "")}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    for (const row of rows) {
      const existing = db
        .prepare(
          "SELECT id FROM crm_media WHERE message_id=? AND id<>? ORDER BY created_at,id LIMIT 1",
        )
        .get(messageId, row["id"]);
      if (existing)
        db.prepare(
          "UPDATE crm_media SET consumed_message_id=? WHERE id=? AND message_id IS NULL",
        ).run(messageId, row["id"]);
      else db.prepare("UPDATE crm_media SET message_id=? WHERE id=?").run(messageId, row["id"]);
    }
    db.exec(`RELEASE SAVEPOINT ${name}`);
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name}`);
    throw error;
  }
  return rows.map((row) => metadata(row));
}
export function readCrmMedia(
  actor: SiteUser,
  id: string,
  input: { range?: string | undefined } = {},
) {
  actor = requireActiveUser(actor, ["admin", "comercial"]);
  const row = authorizedRow(actor, id),
    bytes = readBytes(row);
  const inline = row["kind"] === "image" || row["kind"] === "audio";
  const headers: Record<string, string> = {
    "Content-Type": row["mime_type"],
    "Content-Length": String(bytes.length),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="arquivo"; filename*=UTF-8''${encodeURIComponent(row["name"]).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Accept-Ranges": "bytes",
  };
  if (!input.range) return { body: bytes, status: 200, headers };
  const match = /^bytes=(\d*)-(\d*)$/.exec(input.range);
  let start = 0,
    end = bytes.length - 1;
  if (match && (match[1] || match[2])) {
    if (!match[1]) start = Math.max(0, bytes.length - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
  } else start = -1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= bytes.length
  )
    return {
      body: Buffer.alloc(0),
      status: 416,
      headers: { ...headers, "Content-Length": "0", "Content-Range": `bytes */${bytes.length}` },
    };
  const body = bytes.subarray(start, end + 1);
  return {
    body,
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(body.length),
      "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
    },
  };
}
