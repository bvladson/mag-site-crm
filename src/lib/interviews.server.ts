import { randomUUID } from "node:crypto";
import { getDb, audit, transaction } from "./local-db.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";
import { getUnit, listUnitsPublic, validateUnitId } from "./units.server.ts";
import { interviewInput, interviewInstant, type Interview } from "./interviews.ts";
import { APPLICATION_STAGES } from "./recruitment.ts";

const guard = (actor: SiteUser | null) => requireActiveUser(actor, ["admin", "dho"]);
function schema() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS interviews (
    id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES job_applications(id),
    interviewer_id TEXT NOT NULL REFERENCES users(id), unit_id TEXT, online INTEGER NOT NULL,
    location TEXT NOT NULL, meeting_url TEXT NOT NULL, starts_at TEXT NOT NULL, duration INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('agendada','realizada','faltou','cancelada')), rating INTEGER,
    notes TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS interviews_start ON interviews(starts_at,status);`);
  return db;
}

export function interviewOptionsCore(actor: SiteUser | null) {
  guard(actor);
  const db = schema();
  const candidates = db
    .prepare(
      "SELECT id,protocolo,json_extract(data,'$.nome') name,json_extract(data,'$.job_title') job,status FROM job_applications ORDER BY created_at DESC LIMIT 1000",
    )
    .all()
    .map((r) => ({
      id: String(r["id"]),
      name: String(r["name"] || r["protocolo"]),
      protocol: String(r["protocolo"]),
      job: String(r["job"] || "Banco de talentos"),
      status: String(r["status"]),
    }));
  const interviewers = db
    .prepare(
      "SELECT id,email,display_name FROM users WHERE disabled=0 AND EXISTS(SELECT 1 FROM json_each(users.roles) WHERE value IN ('admin','dho')) ORDER BY email",
    )
    .all()
    .map((r) => ({ id: String(r["id"]), name: String(r["display_name"] || r["email"]) }));
  return { candidates, interviewers, units: listUnitsPublic() };
}

export function listInterviewsCore(actor: SiteUser | null, applicationId?: string): Interview[] {
  guard(actor);
  const db = schema();
  const rows = db
    .prepare(
      `SELECT i.*, json_extract(a.data,'$.nome') candidate, a.protocolo,
    json_extract(a.data,'$.job_title') job, u.display_name, u.email FROM interviews i
    JOIN job_applications a ON a.id=i.application_id JOIN users u ON u.id=i.interviewer_id
    ${applicationId ? "WHERE i.application_id=?" : ""} ORDER BY CASE i.status WHEN 'agendada' THEN 0 ELSE 1 END,
    CASE WHEN i.status='agendada' THEN i.starts_at END ASC, i.starts_at DESC LIMIT 1000`,
    )
    .all(...(applicationId ? [applicationId] : []));
  return rows.map((r) => ({
    id: String(r["id"]),
    revision: Number(r["revision"]),
    applicationId: String(r["application_id"]),
    candidate: String(r["candidate"] || r["protocolo"]),
    protocol: String(r["protocolo"]),
    job: String(r["job"] || "Banco de talentos"),
    interviewerId: String(r["interviewer_id"]),
    interviewer: String(r["display_name"] || r["email"]),
    unitId: r["unit_id"] ? String(r["unit_id"]) : null,
    unitName: r["unit_id"]
      ? (getUnit(String(r["unit_id"]))?.name ?? "Unidade arquivada")
      : "Online",
    online: !!r["online"],
    location: String(r["location"]),
    meetingUrl: String(r["meeting_url"]),
    startsAt: String(r["starts_at"]),
    duration: Number(r["duration"]),
    status: r["status"] as Interview["status"],
    rating: r["rating"] == null ? null : Number(r["rating"]),
    notes: String(r["notes"]),
  }));
}

export function saveInterviewCore(actor: SiteUser | null, input: unknown, now = Date.now()) {
  const user = guard(actor);
  const data = interviewInput.parse(input);
  const db = schema();
  listUnitsPublic(); // Inicializa o cadastro antes de abrir a transação.
  return transaction(() => {
    const old = data.id
      ? db.prepare("SELECT * FROM interviews WHERE id=?").get(data.id)
      : undefined;
    if (data.id && !old) throw new Error("Entrevista não encontrada");
    if (old ? Number(old["revision"]) !== data.revision : data.revision !== 0)
      throw new Error("Esta entrevista foi alterada. Recarregue antes de salvar.");
    if (old && old["application_id"] !== data.applicationId)
      throw new Error("O candidato da entrevista não pode ser substituído");
    if (!db.prepare("SELECT id FROM job_applications WHERE id=?").get(data.applicationId))
      throw new Error("Candidatura não encontrada");
    const interviewer = db
      .prepare(
        "SELECT id FROM users WHERE id=? AND disabled=0 AND EXISTS(SELECT 1 FROM json_each(users.roles) WHERE value IN ('admin','dho'))",
      )
      .get(data.interviewerId);
    if (!interviewer)
      throw new Error("Selecione um entrevistador ativo do DHO ou da Administração");
    const startsAt = interviewInstant(data.startsAt);
    const changedTime =
      !old ||
      old["starts_at"] !== startsAt ||
      Number(old["duration"]) !== data.duration ||
      old["unit_id"] !== data.unitId ||
      old["interviewer_id"] !== data.interviewerId;
    if (data.status === "agendada" && changedTime && Date.parse(startsAt) < now)
      throw new Error("Escolha um horário futuro para agendar");
    if (data.status === "realizada" && Date.parse(startsAt) > now)
      throw new Error("Uma entrevista futura ainda não pode ser concluída");
    if (data.unitId && (changedTime || data.status === "agendada")) validateUnitId(data.unitId);
    const location =
      data.location || (data.online ? "Reunião online" : getUnit(data.unitId!)?.name || "");
    if (data.status === "agendada") {
      const end = new Date(Date.parse(startsAt) + data.duration * 60_000).toISOString();
      const conflicts = db
        .prepare(
          `SELECT id FROM interviews WHERE status='agendada' AND id<>?
        AND starts_at<? AND datetime(starts_at, '+' || duration || ' minutes') > datetime(?)
        AND (interviewer_id=? OR application_id=? OR (unit_id IS NOT NULL AND unit_id=? AND location=?)) LIMIT 1`,
        )
        .get(
          data.id ?? "",
          end,
          startsAt,
          data.interviewerId,
          data.applicationId,
          data.unitId,
          location,
        );
      if (conflicts)
        throw new Error(
          "Conflito de horário: candidato, entrevistador ou local já tem uma entrevista neste intervalo",
        );
    }
    const id = data.id ?? randomUUID();
    const revision = (old ? Number(old["revision"]) : 0) + 1;
    const time = new Date(now).toISOString();
    db.prepare(
      `INSERT INTO interviews(id,application_id,interviewer_id,unit_id,online,location,meeting_url,starts_at,duration,status,rating,notes,revision,created_at,updated_at,updated_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET interviewer_id=excluded.interviewer_id,unit_id=excluded.unit_id,online=excluded.online,
      location=excluded.location,meeting_url=excluded.meeting_url,starts_at=excluded.starts_at,duration=excluded.duration,status=excluded.status,
      rating=excluded.rating,notes=excluded.notes,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
    ).run(
      id,
      data.applicationId,
      data.interviewerId,
      data.unitId,
      Number(data.online),
      location,
      data.meetingUrl,
      startsAt,
      data.duration,
      data.status,
      data.rating,
      data.notes,
      revision,
      time,
      time,
      user.id,
    );
    if (data.status === "agendada")
      db.prepare(
        "UPDATE job_applications SET status='entrevista',updated_at=? WHERE id=? AND status IN ('novo','em análise','contato realizado')",
      ).run(time, data.applicationId);
    audit(user.id, old ? "interview:update" : "interview:create", id, {
      application_id: data.applicationId,
      interviewer_id: data.interviewerId,
      status: data.status,
      revision,
    });
    return { id, revision };
  });
}

/** Mover no funil altera somente status; notas e consentimentos permanecem nos campos originais. */
export function moveApplicationCore(actor: SiteUser | null, id: string, from: string, to: string) {
  const user = guard(actor);
  if (!APPLICATION_STAGES.includes(to as (typeof APPLICATION_STAGES)[number]))
    throw new Error("Etapa inválida");
  return transaction(() => {
    const row = getDb().prepare("SELECT status FROM job_applications WHERE id=?").get(id);
    if (!row) throw new Error("Candidatura não encontrada");
    if (row["status"] !== from)
      throw new Error("Esta candidatura mudou de etapa. Atualize a lista.");
    if (from === to) return { ok: true };
    getDb()
      .prepare("UPDATE job_applications SET status=?,updated_at=? WHERE id=?")
      .run(to, new Date().toISOString(), id);
    audit(user.id, "application:stage", id, { from, to });
    return { ok: true };
  });
}
