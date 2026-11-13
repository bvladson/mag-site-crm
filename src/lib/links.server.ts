import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dataDirectory, getDb, transaction, audit, consumeRateLimit } from "./local-db.server.ts";
import { requireRoles, type SiteUser } from "./local-auth-core.server.ts";
import { getUnit } from "./units.server.ts";
import {
  emptyLinkTreeContent,
  isInLinkSchedule,
  linkTreeContentSchema,
  LINK_IMAGE_FILE,
  LINK_STATIC_LOGO,
  type LinkTreeContent,
  type LinkTreeItem,
  type LinkTreeAdmin,
  type PublicLinkTree,
} from "./links.ts";

const initialized = new WeakSet<object>();
/** Schema is lazy and isolated: this feature never touches catalog, Omie or another application's database. */
export function linksSchema() {
  const db = getDb();
  if (initialized.has(db)) return db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS link_tree_draft (
      id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=0),
      content TEXT NOT NULL CHECK(json_valid(content)), updated_at TEXT NOT NULL, updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS link_tree_publications (
      id TEXT PRIMARY KEY, version INTEGER NOT NULL UNIQUE CHECK(version>0), content TEXT NOT NULL CHECK(json_valid(content)),
      published_at TEXT NOT NULL, published_by TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS link_tree_publications_no_update BEFORE UPDATE ON link_tree_publications
      BEGIN SELECT RAISE(ABORT, 'Publicações são imutáveis'); END;
    CREATE TRIGGER IF NOT EXISTS link_tree_publications_no_delete BEFORE DELETE ON link_tree_publications
      BEGIN SELECT RAISE(ABORT, 'Publicações são imutáveis'); END;
    CREATE TABLE IF NOT EXISTS link_tree_images (
      file TEXT PRIMARY KEY, created_at TEXT NOT NULL, created_by TEXT NOT NULL,
      bytes INTEGER NOT NULL CHECK(bytes>0), width INTEGER NOT NULL, height INTEGER NOT NULL
    );
  `);
  db.prepare(
    "INSERT OR IGNORE INTO link_tree_draft(id,revision,content,updated_at) VALUES (1,0,?,?)",
  ).run(JSON.stringify(emptyLinkTreeContent()), new Date().toISOString());
  initialized.add(db);
  return db;
}

function admin(actor: SiteUser | null) {
  const user = requireRoles(actor, ["admin"]);
  const saved = getDb().prepare("SELECT roles FROM users WHERE id=? AND disabled=0").get(user.id);
  if (!saved || !(JSON.parse(String(saved["roles"])) as string[]).includes("admin"))
    throw new Error("Forbidden: sem permissão para esta área");
  return user;
}

function revisionValue(value: number) {
  return z.number().int().min(0).safe().parse(value);
}
function assertRevision(revision: number) {
  revisionValue(revision);
  const row = getDb().prepare("SELECT revision FROM link_tree_draft WHERE id=1").get();
  if (Number(row?.["revision"]) !== revision)
    throw new Error(
      "O rascunho foi alterado em outra aba. Recarregue a página antes de continuar.",
    );
}

function imageRefs(content: LinkTreeContent, publicOnly = false) {
  const backgroundImage =
    !publicOnly || content.background.mode === "image" ? content.background.image : null;
  return [
    content.logo,
    content.cover,
    backgroundImage,
    ...content.items.filter((item) => !publicOnly || item.active).map((item) => item.image),
    ...content.campaigns
      .filter((item) => !publicOnly || item.active)
      .flatMap((item) => [item.desktopImage, item.mobileImage]),
  ].filter((ref): ref is string => Boolean(ref) && ref !== LINK_STATIC_LOGO);
}

function validateImages(content: LinkTreeContent) {
  const db = getDb();
  for (const ref of imageRefs(content)) {
    const file = ref.slice("/link-images/".length);
    if (
      !LINK_IMAGE_FILE.test(file) ||
      !db.prepare("SELECT 1 FROM link_tree_images WHERE file=?").get(file)
    ) {
      throw new Error("Uma das imagens não está cadastrada. Envie a imagem pelo painel.");
    }
    try {
      readFileSync(join(dataDirectory(), "link-uploads", file));
    } catch {
      throw new Error("Uma das imagens não está disponível. Envie a imagem novamente.");
    }
  }
}

function validateCampaignIdentity(content: LinkTreeContent) {
  for (const campaign of content.campaigns) {
    const original = getDb()
      .prepare(
        `SELECT json_extract(item.value,'$.slug') AS slug FROM link_tree_publications p, json_each(p.content,'$.campaigns') item
      WHERE json_extract(item.value,'$.id')=? ORDER BY p.version LIMIT 1`,
      )
      .get(campaign.id);
    if (original && original["slug"] !== campaign.slug)
      throw new Error(
        "O identificador de uma campanha publicada é fixo para preservar sua atribuição. Duplique a campanha para usar outro identificador.",
      );
  }
}

function officialLocation(item: LinkTreeItem, publicOnly = false): LinkTreeItem | null {
  if (item.type !== "location") return item;
  const unit = getUnit(item.id);
  if (!unit) return item;
  if (publicOnly && !unit.active) return null;
  const accent = { red: "burgundy", blue: "ocean", green: "forest", amber: "amber" } as const;
  return {
    ...item,
    title: unit.name,
    address: unit.address,
    phone: unit.whatsapp,
    landline: unit.phone,
    hours: unit.hours,
    mapUrl: unit.mapUrl,
    wazeUrl: unit.wazeUrl,
    accent: accent[unit.accent],
  };
}

export function readLinkTreeAdmin(actor: SiteUser | null): LinkTreeAdmin {
  admin(actor);
  const db = linksSchema();
  const draft = db.prepare("SELECT revision,content FROM link_tree_draft WHERE id=1").get()!;
  const publications = db
    .prepare(
      `SELECT p.id,p.version,p.published_at,p.published_by,u.display_name
    FROM link_tree_publications p LEFT JOIN users u ON u.id=p.published_by ORDER BY p.version DESC LIMIT 100`,
    )
    .all();
  return {
    draft: {
      revision: Number(draft["revision"]),
      content: linkTreeContentSchema.parse(JSON.parse(String(draft["content"]))),
    },
    publications: publications.map((row) => ({
      id: String(row["id"]),
      version: Number(row["version"]),
      publishedAt: String(row["published_at"]),
      publishedBy: String(row["display_name"] || "Administrador"),
    })),
    publishedVersion: publications.length ? Number(publications[0]!["version"]) : null,
  };
}

export function saveLinkTreeDraftCore(actor: SiteUser | null, revision: number, input: unknown) {
  const user = admin(actor);
  const content = linkTreeContentSchema.parse(input);
  linksSchema();
  return transaction(() => {
    assertRevision(revision);
    validateImages(content);
    validateCampaignIdentity(content);
    const nextRevision = revision + 1;
    getDb()
      .prepare(
        "UPDATE link_tree_draft SET revision=?,content=?,updated_at=?,updated_by=? WHERE id=1",
      )
      .run(nextRevision, JSON.stringify(content), new Date().toISOString(), user.id);
    audit(user.id, "links:draft:save", "1", {
      revision: nextRevision,
      items: content.items.length,
    });
    return { revision: nextRevision };
  });
}

export function publishLinkTreeCore(actor: SiteUser | null, revision: number) {
  const user = admin(actor);
  linksSchema();
  return transaction(() => {
    assertRevision(revision);
    const draft = getDb().prepare("SELECT content FROM link_tree_draft WHERE id=1").get()!;
    const content = linkTreeContentSchema.parse(JSON.parse(String(draft["content"])));
    validateImages(content);
    validateCampaignIdentity(content);
    if (!content.items.some((item) => item.active && item.type !== "heading"))
      throw new Error("Ative pelo menos um link antes de publicar.");
    const version = Number(
      getDb()
        .prepare("SELECT COALESCE(MAX(version),0)+1 AS version FROM link_tree_publications")
        .get()!["version"],
    );
    const id = randomUUID();
    getDb()
      .prepare(
        "INSERT INTO link_tree_publications(id,version,content,published_at,published_by) VALUES (?,?,?,?,?)",
      )
      .run(id, version, JSON.stringify(content), new Date().toISOString(), user.id);
    audit(user.id, "links:publish", id, { version, revision, items: content.items.length });
    return { version };
  });
}

export function restoreLinkTreeCore(
  actor: SiteUser | null,
  revision: number,
  publicationId: string,
) {
  const user = admin(actor);
  z.string().uuid().parse(publicationId);
  linksSchema();
  return transaction(() => {
    assertRevision(revision);
    const snapshot = getDb()
      .prepare("SELECT content,version FROM link_tree_publications WHERE id=?")
      .get(publicationId);
    if (!snapshot) throw new Error("Publicação não encontrada.");
    const nextRevision = revision + 1;
    getDb()
      .prepare(
        "UPDATE link_tree_draft SET revision=?,content=?,updated_at=?,updated_by=? WHERE id=1",
      )
      .run(nextRevision, String(snapshot["content"]), new Date().toISOString(), user.id);
    audit(user.id, "links:draft:restore", publicationId, {
      revision: nextRevision,
      version: Number(snapshot["version"]),
    });
    return { revision: nextRevision };
  });
}

/** Reads the latest immutable publication only. Drafts, hidden blocks and editor identities never reach the visitor. */
export function readPublicLinkTree(at: Date = new Date()): PublicLinkTree | null {
  const row = linksSchema()
    .prepare(
      "SELECT version,content,published_at FROM link_tree_publications ORDER BY version DESC LIMIT 1",
    )
    .get();
  if (!row) return null;
  const content = linkTreeContentSchema.parse(JSON.parse(String(row["content"])));
  content.items = content.items
    .filter((item) => isInLinkSchedule(item, at))
    .sort((a, b) => a.position - b.position);
  content.items = content.items
    .map((item) => officialLocation(item, true))
    .filter((item): item is LinkTreeItem => Boolean(item));
  const locations = new Set(
    content.items.filter((item) => item.type === "location").map((item) => item.id),
  );
  content.items = content.items.filter(
    (item) => !item.locationId || item.type === "location" || locations.has(item.locationId),
  );
  content.campaigns = content.campaigns
    .filter(
      (item) => isInLinkSchedule(item, at) && (!item.locationId || locations.has(item.locationId)),
    )
    .sort((a, b) => a.position - b.position)
    .map((campaign) => ({ ...campaign, name: campaign.title, channel: "" }));
  // Keep the remembered photo in private drafts/history, but expose it only while used as the public background.
  if (content.background.mode !== "image") content.background.image = null;
  return { version: Number(row["version"]), publishedAt: String(row["published_at"]), content };
}

function uploadedFile(image: string) {
  const file = image.startsWith("/link-images/") ? image.slice(13) : image;
  return LINK_IMAGE_FILE.test(file) ? file : null;
}

/** Public reads recheck current references on every request; removed and unpublished images return 404. */
export function readPublicLinkImage(file: string, at: Date = new Date()): Buffer | null {
  if (!LINK_IMAGE_FILE.test(file)) return null;
  const content = readPublicLinkTree(at)?.content;
  if (!content || !imageRefs(content, true).some((ref) => uploadedFile(ref) === file)) return null;
  if (!getDb().prepare("SELECT 1 FROM link_tree_images WHERE file=?").get(file)) return null;
  try {
    return readFileSync(join(dataDirectory(), "link-uploads", file));
  } catch {
    return null;
  }
}

export function readAdminLinkImage(actor: SiteUser | null, file: string): Buffer | null {
  admin(actor);
  if (
    !LINK_IMAGE_FILE.test(file) ||
    !linksSchema().prepare("SELECT 1 FROM link_tree_images WHERE file=?").get(file)
  )
    return null;
  try {
    return readFileSync(join(dataDirectory(), "link-uploads", file));
  } catch {
    return null;
  }
}

export async function uploadLinkImageCore(actor: SiteUser | null, base64: string) {
  const user = admin(actor);
  if (!consumeRateLimit(`links:upload:${user.id}`, 30, 600))
    throw new Error("Limite de imagens atingido. Aguarde alguns minutos.");
  z.string().max(2_900_000).parse(base64);
  const encoded = base64.replace(/^data:image\/(?:jpeg|png|webp);base64,/, "");
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0)
    throw new Error("Imagem inválida. Use JPG, PNG ou WebP.");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > 2 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 2 MB.");
  // The runtime keeps native dependencies beside scripts; no native binary enters the browser/Vite bundle.
  let sharp: typeof import("sharp").default;
  try {
    sharp = createRequire(resolve(process.cwd(), "scripts/package.json"))("sharp");
  } catch {
    sharp = createRequire(resolve(process.cwd(), "package.json"))("sharp");
  }
  let output: { data: Buffer; info: { width: number; height: number } };
  try {
    const decoder = sharp(bytes, {
      limitInputPixels: 36_000_000,
      failOn: "warning",
      animated: false,
    });
    const metadata = await decoder.metadata();
    if (
      !metadata.format ||
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error("Formato inválido");
    output = await decoder
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new Error("Não foi possível abrir a imagem. Use JPG, PNG ou WebP válido, sem animação.");
  }
  linksSchema();
  const file = `${randomUUID()}.webp`;
  const dir = join(dataDirectory(), "link-uploads");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, file);
  writeFileSync(path, output.data, { mode: 0o600, flag: "wx" });
  try {
    transaction(() => {
      // Recheck rights after the asynchronous image decode.
      admin(user);
      getDb()
        .prepare(
          "INSERT INTO link_tree_images(file,created_at,created_by,bytes,width,height) VALUES (?,?,?,?,?,?)",
        )
        .run(
          file,
          new Date().toISOString(),
          user.id,
          output.data.length,
          output.info.width,
          output.info.height,
        );
      audit(user.id, "links:image:upload", file, {
        bytes: output.data.length,
        width: output.info.width,
        height: output.info.height,
      });
    });
  } catch (error) {
    unlinkSync(path);
    throw error;
  }
  return { image: `/link-images/${file}`, previewUrl: `/api/internal/link-images/${file}` };
}

/** CLI bootstrap is idempotent and publishes only when there has never been a publication or an edited draft. */
export function seedLinkTreeCore(actor: SiteUser | null, input: unknown) {
  const user = admin(actor);
  const content = linkTreeContentSchema.parse(input);
  linksSchema();
  return transaction(() => {
    const db = getDb();
    if (
      db.prepare("SELECT 1 FROM link_tree_publications LIMIT 1").get() ||
      Number(db.prepare("SELECT revision FROM link_tree_draft WHERE id=1").get()!["revision"]) > 0
    )
      return { seeded: false };
    validateImages(content);
    if (!content.items.some((item) => item.active && item.type !== "heading"))
      throw new Error("Cadastre um link ativo.");
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE link_tree_draft SET revision=1,content=?,updated_at=?,updated_by=? WHERE id=1",
    ).run(JSON.stringify(content), now, user.id);
    db.prepare(
      "INSERT INTO link_tree_publications(id,version,content,published_at,published_by) VALUES (?,1,?,?,?)",
    ).run(id, JSON.stringify(content), now, user.id);
    audit(user.id, "links:seed", id, { version: 1, revision: 1 });
    return { seeded: true };
  });
}
