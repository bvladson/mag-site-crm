import { randomUUID } from "node:crypto";
import { audit, getDb, transaction } from "./local-db.server.ts";
import { WORK_MODELS, type PublicJob, type WorkModel } from "@/config/careers";

/**
 * Vagas (RH/DHO). Estados: rascunho (só no painel) → publicada (no site enquanto estiver no prazo) → encerrada
 * (a URL continua, com aviso de encerrada, sem formulário e sem indexação). Vaga que já foi publicada não volta a
 * rascunho nem troca de slug: o endereço fica estável para quem guardou ou compartilhou o link.
 */
export const JOB_STATUS = ["rascunho", "publicada", "encerrada"] as const;
export type JobStatus = (typeof JOB_STATUS)[number];
export type JobRow = {
  id: string; slug: string; title: string; area: string | null; location: string | null; work_model: string | null;
  contract_type: string | null; schedule: string | null; summary: string | null; description: string | null;
  responsibilities: string | null; requirements: string | null; differentials: string | null; status: JobStatus;
  opened_at: string | null; closes_at: string | null; closed_at: string | null; priority: number; created_at: string; updated_at: string;
};
export type JobInput = {
  id?: string | undefined; title: string; slug?: string | undefined; area?: string | undefined; location?: string | undefined;
  work_model?: WorkModel | undefined; contract_type?: string | undefined; schedule?: string | undefined; summary?: string | undefined;
  description?: string | undefined; responsibilities?: string | undefined; requirements?: string | undefined; differentials?: string | undefined;
  status: JobStatus; opened_at?: string | undefined; closes_at?: string | undefined; priority: number;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const empty = (value: string | undefined | null) => (value && value.trim() ? value.trim() : null);
/** Um item por linha; marcadores digitados ("-", "•", "*") são retirados. */
const lines = (text: string | null) => (text ?? "").split("\n").map((line) => line.replace(/^[\s•*-]+/, "").trim()).filter(Boolean);
/** Data do formulário (dia de Fortaleza) → instante. Abertura: início do dia; encerramento: fim do dia. */
const dayStartIso = (day: string) => new Date(`${day}T00:00:00-03:00`).toISOString();
const dayEndIso = (day: string) => new Date(`${day}T23:59:59-03:00`).toISOString();

export function slugifyTitle(text: string) {
  const base = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base.slice(0, 70).replace(/-+$/g, "") || "vaga";
}

export function isOpen(job: Pick<JobRow, "status" | "closes_at">, now = new Date()) {
  return job.status === "publicada" && (!job.closes_at || job.closes_at > now.toISOString());
}

function toPublic(row: JobRow, now = new Date()): PublicJob {
  return {
    slug: row.slug, title: row.title, area: row.area, location: row.location,
    workModel: (WORK_MODELS as readonly string[]).includes(row.work_model ?? "") ? (row.work_model as WorkModel) : null,
    contractType: row.contract_type, schedule: row.schedule, summary: row.summary, description: row.description,
    responsibilities: lines(row.responsibilities), requirements: lines(row.requirements), differentials: lines(row.differentials),
    openedAt: row.opened_at, closesAt: row.closes_at, open: isOpen(row, now),
  };
}

const rows = (sql: string, ...params: (string | number | null)[]) => getDb().prepare(sql).all(...params) as unknown as JobRow[];
const one = (sql: string, ...params: (string | number | null)[]) => (getDb().prepare(sql).get(...params) as unknown as JobRow | undefined) ?? null;

/** Vagas abertas para o site: publicadas e dentro do prazo, pela prioridade e depois as mais recentes. */
export function listOpenJobs(now = new Date()): PublicJob[] {
  return rows(`SELECT * FROM jobs WHERE status='publicada' AND (closes_at IS NULL OR closes_at > ?)
    ORDER BY priority ASC, opened_at DESC, title ASC`, now.toISOString()).map((row) => toPublic(row, now));
}

/** Página pública: aberta ou encerrada (com aviso). Rascunho não existe para o público. */
export function findPublicJob(slug: string, now = new Date()): PublicJob | null {
  if (!SLUG.test(slug)) return null;
  const row = one("SELECT * FROM jobs WHERE slug=? AND status IN ('publicada','encerrada')", slug);
  return row ? toPublic(row, now) : null;
}

/** Vaga que ainda aceita candidatura (o servidor decide; o título nunca vem do navegador). */
export function findOpenJob(slug: string, now = new Date()): JobRow | null {
  if (!SLUG.test(slug)) return null;
  const row = one("SELECT * FROM jobs WHERE slug=?", slug);
  return row && isOpen(row, now) ? row : null;
}

export function listJobsWithCounts(now = new Date()) {
  const counts = new Map((getDb().prepare(`SELECT json_extract(data,'$.job_id') AS job, count(*) AS n FROM job_applications
    WHERE json_extract(data,'$.job_id') IS NOT NULL GROUP BY job`).all() as { job: string; n: number }[]).map((r) => [r.job, Number(r.n)]));
  return rows("SELECT * FROM jobs ORDER BY CASE status WHEN 'publicada' THEN 0 WHEN 'rascunho' THEN 1 ELSE 2 END, priority ASC, updated_at DESC")
    .map((row) => ({ ...row, applications: counts.get(row.id) ?? 0, open: isOpen(row, now) }));
}

export function getJob(id: string) {
  const row = one("SELECT * FROM jobs WHERE id=?", id);
  if (!row) throw new Error("Vaga não encontrada");
  return row;
}

function uniqueSlug(wanted: string, id: string | null) {
  let candidate = wanted;
  for (let n = 2; one("SELECT id FROM jobs WHERE slug=? AND id IS NOT ?", candidate, id); n += 1) candidate = `${wanted.slice(0, 66)}-${n}`;
  return candidate;
}

/** Cria ou altera uma vaga, com as regras de estado e de slug. Registra a ação na auditoria. */
export function saveJob(input: JobInput, actorId: string, now = new Date()) {
  return transaction(() => {
    const current = input.id ? getJob(input.id) : null;
    const wasPublished = Boolean(current?.opened_at);
    const requested = input.slug && input.slug.trim() ? input.slug.trim() : slugifyTitle(input.title);
    if (!SLUG.test(requested) || requested.length > 80) throw new Error("Endereço (slug) inválido: use letras minúsculas, números e hífens");
    let slug: string;
    if (current && wasPublished) {
      if (requested !== current.slug) throw new Error("Esta vaga já foi publicada: o endereço não muda, para não quebrar links já compartilhados");
      slug = current.slug;
    } else {
      slug = uniqueSlug(requested, current?.id ?? null);
    }
    if (current && wasPublished && input.status === "rascunho") {
      throw new Error("Vaga já publicada não volta a rascunho: use \"encerrada\" para tirá-la do ar (a URL é preservada)");
    }
    const closesAt = input.closes_at ? dayEndIso(input.closes_at) : null;
    if (input.status === "publicada" && closesAt && closesAt <= now.toISOString()) {
      throw new Error("A data de encerramento já passou: ajuste a data para publicar");
    }
    let openedAt = input.opened_at ? dayStartIso(input.opened_at) : current?.opened_at ?? null;
    let closedAt = current?.closed_at ?? null;
    if (input.status === "publicada") { openedAt = openedAt ?? now.toISOString(); closedAt = null; }
    if (input.status === "encerrada") closedAt = closedAt ?? now.toISOString();
    const values = {
      slug, title: input.title.trim(), area: empty(input.area), location: empty(input.location), work_model: input.work_model ?? null,
      contract_type: empty(input.contract_type), schedule: empty(input.schedule), summary: empty(input.summary),
      description: empty(input.description), responsibilities: empty(input.responsibilities), requirements: empty(input.requirements),
      differentials: empty(input.differentials), status: input.status, opened_at: openedAt, closes_at: closesAt, closed_at: closedAt,
      priority: input.priority,
    };
    const stamp = now.toISOString();
    const columns = Object.keys(values) as (keyof typeof values)[];
    const params = columns.map((column) => values[column]);
    let id: string;
    if (current) {
      id = current.id;
      getDb().prepare(`UPDATE jobs SET ${columns.map((column) => `${column}=?`).join(",")}, updated_at=? WHERE id=?`).run(...params, stamp, id);
      audit(actorId, current.status !== input.status ? `job:status:${input.status}` : "job:update", id);
    } else {
      id = randomUUID();
      getDb().prepare(`INSERT INTO jobs(id,${columns.join(",")},created_at,updated_at) VALUES (?,${columns.map(() => "?").join(",")},?,?)`)
        .run(id, ...params, stamp, stamp);
      audit(actorId, "job:create", id);
    }
    return { id, slug };
  });
}
