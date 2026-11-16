import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, consumeRateLimit, dataDirectory, getDb, transaction } from "./local-db.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";
import {
  defaultSiteContent,
  siteContentSchema,
  visibleSiteContent,
  SITE_IMAGE_FILE,
  SITE_STATIC_LOGO,
  type PublicSiteContent,
  type SiteContent,
  type SiteContentAdmin,
} from "./site-content.ts";

const initialized = new WeakSet<object>();
const revisionSchema = z.number().int().min(0).safe();

function schema() {
  const db = getDb();
  if (initialized.has(db)) return db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_content_draft (
      id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=0),
      content TEXT NOT NULL CHECK(json_valid(content)), updated_at TEXT NOT NULL, updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS site_content_publications (
      id TEXT PRIMARY KEY, version INTEGER NOT NULL UNIQUE CHECK(version>0),
      content TEXT NOT NULL CHECK(json_valid(content)), published_at TEXT NOT NULL, published_by TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS site_content_publications_no_update BEFORE UPDATE ON site_content_publications
      BEGIN SELECT RAISE(ABORT, 'Publicações são imutáveis'); END;
    CREATE TRIGGER IF NOT EXISTS site_content_publications_no_delete BEFORE DELETE ON site_content_publications
      BEGIN SELECT RAISE(ABORT, 'Publicações são imutáveis'); END;
    CREATE TABLE IF NOT EXISTS site_content_images (
      file TEXT PRIMARY KEY, created_at TEXT NOT NULL, created_by TEXT NOT NULL,
      bytes INTEGER NOT NULL CHECK(bytes>0), width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0)
    );
  `);
  db.prepare("INSERT OR IGNORE INTO site_content_draft(id,revision,content,updated_at) VALUES (1,0,?,?)")
    .run(JSON.stringify(defaultSiteContent()), new Date().toISOString());
  initialized.add(db);
  return db;
}

function admin(actor: SiteUser | null) {
  return requireActiveUser(actor, ["admin"]);
}

function assertRevision(revision: number) {
  revisionSchema.parse(revision);
  const row = schema().prepare("SELECT revision FROM site_content_draft WHERE id=1").get();
  if (Number(row?.["revision"]) !== revision)
    throw new Error("O rascunho foi alterado em outra aba. Recarregue a página antes de continuar.");
}

function imageReferences(content: SiteContent) {
  return [
    content.general.logo,
    content.general.favicon,
    content.seo.image,
    content.home.hero.desktopImage,
    content.home.hero.mobileImage,
    ...content.home.sections.map((section) => section.image),
    ...content.home.banners.flatMap((banner) => [banner.image, banner.mobileImage]),
  ].filter((reference): reference is string => Boolean(reference) && reference !== SITE_STATIC_LOGO);
}

function validateImages(content: SiteContent) {
  const db = schema();
  for (const reference of new Set(imageReferences(content))) {
    const file = reference.slice("/site-images/".length);
    if (!reference.startsWith("/site-images/") || !SITE_IMAGE_FILE.test(file)
      || !db.prepare("SELECT 1 FROM site_content_images WHERE file=?").get(file))
      throw new Error("Uma das imagens não está cadastrada. Envie a imagem pelo editor do site.");
    try { readFileSync(join(dataDirectory(), "site-uploads", file)); }
    catch { throw new Error("Uma das imagens não está disponível. Envie a imagem novamente."); }
  }
}

/** The public document contains only visible sections and currently active campaigns. */
function publicContent(content: SiteContent, at: Date) {
  const visible = visibleSiteContent(content, at);
  visible.home.sections = visible.home.sections.filter((section) => section.enabled);
  if (!visible.home.sections.some((section) => section.id === "banners")) visible.home.banners = [];
  if (!visible.home.sections.some((section) => section.id === "stats")) visible.home.stats = [];
  if (!visible.home.sections.some((section) => section.id === "manifesto")) visible.home.editorial.manifestoSupport = "";
  if (!visible.home.sections.some((section) => section.id === "process")) visible.home.editorial.processSteps = [];
  if (!visible.announcement.enabled) visible.announcement = { enabled: false, text: "", href: "", label: "" };
  return visible;
}

export function readSiteContentAdmin(actor: SiteUser | null): SiteContentAdmin {
  admin(actor);
  const db = schema();
  const draft = db.prepare("SELECT revision,content FROM site_content_draft WHERE id=1").get()!;
  const rows = db.prepare(`SELECT p.id,p.version,p.published_at,u.display_name
    FROM site_content_publications p LEFT JOIN users u ON u.id=p.published_by
    ORDER BY p.version DESC LIMIT 100`).all();
  return {
    draft: { revision: Number(draft["revision"]), content: siteContentSchema.parse(JSON.parse(String(draft["content"]))) },
    publications: rows.map((row) => ({
      id: String(row["id"]), version: Number(row["version"]),
      publishedAt: String(row["published_at"]), publishedBy: String(row["display_name"] || "Administrador"),
    })),
    publishedVersion: rows.length ? Number(rows[0]!["version"]) : null,
  };
}

export function saveSiteContentDraftCore(actor: SiteUser | null, revision: number, input: unknown) {
  const user = admin(actor);
  const content = siteContentSchema.parse(input);
  schema();
  return transaction(() => {
    admin(user);
    assertRevision(revision);
    validateImages(content);
    const nextRevision = revision + 1;
    getDb().prepare("UPDATE site_content_draft SET revision=?,content=?,updated_at=?,updated_by=? WHERE id=1")
      .run(nextRevision, JSON.stringify(content), new Date().toISOString(), user.id);
    audit(user.id, "site-content:draft:save", "1", { revision: nextRevision, sections: content.home.sections.length, banners: content.home.banners.length });
    return { revision: nextRevision };
  });
}

export function publishSiteContentCore(actor: SiteUser | null, revision: number) {
  const user = admin(actor);
  schema();
  return transaction(() => {
    admin(user);
    assertRevision(revision);
    const draft = getDb().prepare("SELECT content FROM site_content_draft WHERE id=1").get()!;
    const content = siteContentSchema.parse(JSON.parse(String(draft["content"])));
    validateImages(content);
    const version = Number(getDb().prepare("SELECT COALESCE(MAX(version),0)+1 AS version FROM site_content_publications").get()!["version"]);
    const id = randomUUID();
    getDb().prepare("INSERT INTO site_content_publications(id,version,content,published_at,published_by) VALUES (?,?,?,?,?)")
      .run(id, version, JSON.stringify(content), new Date().toISOString(), user.id);
    audit(user.id, "site-content:publish", id, { version, revision, sections: content.home.sections.length, banners: content.home.banners.length });
    return { version };
  });
}

export function restoreSiteContentCore(actor: SiteUser | null, revision: number, publicationId: string) {
  const user = admin(actor);
  z.string().uuid().parse(publicationId);
  schema();
  return transaction(() => {
    admin(user);
    assertRevision(revision);
    const snapshot = getDb().prepare("SELECT content,version FROM site_content_publications WHERE id=?").get(publicationId);
    if (!snapshot) throw new Error("Publicação não encontrada.");
    const content = siteContentSchema.parse(JSON.parse(String(snapshot["content"])));
    const nextRevision = revision + 1;
    getDb().prepare("UPDATE site_content_draft SET revision=?,content=?,updated_at=?,updated_by=? WHERE id=1")
      .run(nextRevision, JSON.stringify(content), new Date().toISOString(), user.id);
    audit(user.id, "site-content:draft:restore", publicationId, { revision: nextRevision, version: Number(snapshot["version"]) });
    return { revision: nextRevision };
  });
}

export function readPublicSiteContent(at: Date = new Date()): PublicSiteContent {
  const row = schema().prepare("SELECT version,content,published_at FROM site_content_publications ORDER BY version DESC LIMIT 1").get();
  if (!row) return { version: null, publishedAt: null, content: publicContent(defaultSiteContent(), at) };
  const content = siteContentSchema.parse(JSON.parse(String(row["content"])));
  return { version: Number(row["version"]), publishedAt: String(row["published_at"]), content: publicContent(content, at) };
}

export function readPublicSiteImage(file: string, at: Date = new Date()): Buffer | null {
  if (!SITE_IMAGE_FILE.test(file)) return null;
  const content = readPublicSiteContent(at).content;
  if (!imageReferences(content).some((reference) => reference === `/site-images/${file}`)) return null;
  if (!schema().prepare("SELECT 1 FROM site_content_images WHERE file=?").get(file)) return null;
  try { return readFileSync(join(dataDirectory(), "site-uploads", file)); }
  catch { return null; }
}

export function readAdminSiteImage(actor: SiteUser | null, file: string): Buffer | null {
  admin(actor);
  if (!SITE_IMAGE_FILE.test(file) || !schema().prepare("SELECT 1 FROM site_content_images WHERE file=?").get(file)) return null;
  try { return readFileSync(join(dataDirectory(), "site-uploads", file)); }
  catch { return null; }
}

export async function uploadSiteImageCore(actor: SiteUser | null, base64: string) {
  const user = admin(actor);
  if (!consumeRateLimit(`site-content:upload:${user.id}`, 30, 600))
    throw new Error("Limite de imagens atingido. Aguarde alguns minutos.");
  z.string().max(2_900_000).parse(base64);
  const encoded = base64.replace(/^data:image\/(?:jpeg|png|webp);base64,/, "");
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0)
    throw new Error("Imagem inválida. Use JPG, PNG ou WebP.");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > 2 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 2 MB.");
  let sharp: typeof import("sharp").default;
  try { sharp = createRequire(resolve(process.cwd(), "scripts/package.json"))("sharp"); }
  catch { sharp = createRequire(resolve(process.cwd(), "package.json"))("sharp"); }
  let output: { data: Buffer; info: { width: number; height: number } };
  try {
    const decoder = sharp(bytes, { limitInputPixels: 36_000_000, failOn: "warning", animated: false });
    const metadata = await decoder.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages ?? 1) > 1)
      throw new Error("Formato inválido");
    output = await decoder.rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
  } catch { throw new Error("Não foi possível abrir a imagem. Use JPG, PNG ou WebP válido, sem animação."); }
  // Decoding yields control; revoked or disabled accounts must not create a file or row.
  admin(user);
  schema();
  const file = `${randomUUID()}.webp`;
  const directory = join(dataDirectory(), "site-uploads");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, file);
  writeFileSync(path, output.data, { mode: 0o600, flag: "wx" });
  try {
    transaction(() => {
      admin(user);
      getDb().prepare("INSERT INTO site_content_images(file,created_at,created_by,bytes,width,height) VALUES (?,?,?,?,?,?)")
        .run(file, new Date().toISOString(), user.id, output.data.length, output.info.width, output.info.height);
      audit(user.id, "site-content:image:upload", file, { bytes: output.data.length, width: output.info.width, height: output.info.height });
    });
  } catch (error) { unlinkSync(path); throw error; }
  return { image: `/site-images/${file}`, previewUrl: `/api/internal/site-images/${file}` };
}
