import { randomUUID } from "node:crypto";
import { getDb, transaction, audit } from "./local-db.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";
import { unitSchema, type Unit } from "./units.ts";
import { site } from "../config/site.ts";

const initialized = new WeakSet<object>();
type Row = Record<string, any>;
const fromRow = (r: Row): Unit => ({
  ...JSON.parse(String(r["content"])),
  id: String(r["id"]),
  active: Boolean(r["active"]),
  revision: Number(r["revision"]),
});
const digits = (s: unknown) => {
  const value = String(s ?? "").replace(/\D/g, "");
  return value.length === 10 || value.length === 11 ? `55${value}` : value;
};

function schema() {
  const db = getDb();
  if (initialized.has(db)) return db;
  db.exec(`CREATE TABLE IF NOT EXISTS site_units (
    id TEXT PRIMARY KEY, content TEXT NOT NULL CHECK(json_valid(content)), active INTEGER NOT NULL,
    revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT
  ); CREATE TABLE IF NOT EXISTS site_unit_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id TEXT NOT NULL REFERENCES site_units(id), revision INTEGER NOT NULL,
    content TEXT NOT NULL CHECK(json_valid(content)), changed_at TEXT NOT NULL, changed_by TEXT,
    UNIQUE(unit_id,revision)
  );`);
  if (!Number(db.prepare("SELECT count(*) AS n FROM site_units").get()?.["n"])) {
    let locations: Row[] = [];
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='link_tree_publications'").get()) {
      try {
        locations =
          JSON.parse(
            String(
              db
                .prepare("SELECT content FROM link_tree_publications ORDER BY version DESC LIMIT 1")
                .get()?.["content"] ?? "{}",
            ),
          ).items?.filter((i: Row) => i["type"] === "location" && i["address"]) ?? [];
      } catch {
        /* empty legacy tree */
      }
    }
    const definitions = [
      {
        key: "centro",
        fallbackId: "0d220520-ae9f-4cae-9901-e1b6c9c0b101",
        name: "Centro",
        address: "Av. Dom Manuel, 1180 - Centro, Fortaleza - CE, CEP 60060-091",
        whatsapp: "",
        phone: "558531220506",
        accent: "blue" as const,
      },
      {
        key: "br",
        fallbackId: "0d220520-ae9f-4cae-9901-e1b6c9c0b102",
        name: "BR-116",
        address: site.address,
        whatsapp: site.whatsapp,
        phone: "",
        accent: "red" as const,
      },
    ];
    transaction(() => {
      for (const d of definitions) {
        const existing = locations.find((i) =>
          d.key === "centro"
            ? /centro|dom manuel/i.test(`${i["title"]} ${i["address"]}`)
            : /br.?116|sargento|aerol/i.test(`${i["title"]} ${i["address"]}`),
        );
        const unit: Unit = unitSchema.parse({
          id: existing?.["id"] || d.fallbackId,
          name: d.name,
          address: existing?.["address"] || d.address,
          whatsapp: digits(existing?.["phone"] ?? d.whatsapp),
          phone: digits(existing?.["landline"] ?? d.phone),
          hours: existing?.["hours"] || "",
          mapUrl: existing?.["mapUrl"] || "",
          wazeUrl: existing?.["wazeUrl"] || "",
          accent: d.accent,
          active: existing ? Boolean(existing["active"]) : true,
          revision: 1,
        });
        const now = new Date().toISOString();
        db.prepare(
          "INSERT OR IGNORE INTO site_units(id,content,active,revision,created_at,updated_at) VALUES (?,?,?,?,?,?)",
        ).run(unit.id, JSON.stringify(unit), Number(unit.active), unit.revision, now, now);
        db.prepare(
          "INSERT OR IGNORE INTO site_unit_history(unit_id,revision,content,changed_at) VALUES (?,?,?,?)",
        ).run(unit.id, unit.revision, JSON.stringify(unit), now);
      }
    });
  }
  initialized.add(db);
  return db;
}

export function listUnitsPublic(): Unit[] {
  return schema()
    .prepare("SELECT * FROM site_units WHERE active=1 ORDER BY json_extract(content,'$.name')")
    .all()
    .map(fromRow);
}
export function listUnitsAdmin(actor: SiteUser | null): Unit[] {
  requireActiveUser(actor, ["admin"]);
  return schema()
    .prepare("SELECT * FROM site_units ORDER BY json_extract(content,'$.name')")
    .all()
    .map(fromRow);
}
export function getUnit(id: string, activeOnly = false): Unit | null {
  const row = schema().prepare("SELECT * FROM site_units WHERE id=?").get(id);
  return row && (!activeOnly || row["active"]) ? fromRow(row) : null;
}
export function validateUnitId(id: string, activeOnly = true): Unit {
  const unit = getUnit(id, activeOnly);
  if (!unit) throw new Error("Unidade não encontrada ou inativa");
  return unit;
}
export function saveUnit(actor: SiteUser | null, input: unknown): Unit {
  const user = requireActiveUser(actor, ["admin"]);
  const data = unitSchema.parse(input);
  schema();
  return transaction(() => {
    const old = getUnit(data.id);
    if ((old?.revision ?? 0) !== data.revision)
      throw new Error("A unidade mudou em outra aba. Recarregue antes de salvar.");
    const unit = { ...data, revision: data.revision + 1 };
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO site_units(id,content,active,revision,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET content=excluded.content,active=excluded.active,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
      )
      .run(unit.id, JSON.stringify(unit), Number(unit.active), unit.revision, now, now, user.id);
    getDb()
      .prepare(
        "INSERT INTO site_unit_history(unit_id,revision,content,changed_at,changed_by) VALUES (?,?,?,?,?)",
      )
      .run(unit.id, unit.revision, JSON.stringify(unit), now, user.id);
    audit(
      user.id,
      old ? (old.active && !unit.active ? "unit:deactivate" : "unit:update") : "unit:create",
      unit.id,
      { revision: unit.revision },
    );
    return unit;
  });
}
export function newUnit(): Unit {
  return {
    id: randomUUID(),
    name: "",
    address: "",
    whatsapp: "",
    phone: "",
    hours: "",
    mapUrl: "",
    wazeUrl: "",
    accent: "red",
    active: true,
    revision: 0,
  };
}
