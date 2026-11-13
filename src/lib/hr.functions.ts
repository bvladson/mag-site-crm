import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { WORK_MODELS } from "@/config/careers";

/**
 * Painel de RH (vagas). Só Admin e DHO — conferido no servidor a cada chamada; perfil comercial não acessa.
 * Toda gravação vai para a auditoria (job:create, job:update, job:status:<estado>).
 */
const HR = ["admin", "dho"] as const;
async function guard() {
  const { authorize } = await import("./local-auth.server");
  return authorize([...HR]);
}

export const JOB_STATUS = ["rascunho", "publicada", "encerrada"] as const;
const text = (max: number) => z.string().trim().max(max).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined));

const jobInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(3, "Informe o título").max(120),
  slug: z.string().trim().max(80).optional(),
  area: text(80), location: text(120),
  work_model: z.enum(WORK_MODELS).optional().or(z.literal("").transform(() => undefined)),
  contract_type: text(60), schedule: text(120), summary: text(300), description: text(6000),
  responsibilities: text(4000), requirements: text(4000), differentials: text(4000),
  status: z.enum(JOB_STATUS), opened_at: day, closes_at: day,
  priority: z.number().int().min(0).max(999),
});

export const listJobsAdmin = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { listJobsWithCounts } = await import("./careers.server");
  return listJobsWithCounts().map((job) => ({
    id: job.id, slug: job.slug, title: job.title, area: job.area, location: job.location, status: job.status, open: job.open,
    opened_at: job.opened_at, closes_at: job.closes_at, closed_at: job.closed_at, priority: job.priority, applications: job.applications,
  }));
});

export const getJobAdmin = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    const { getJob, isOpen } = await import("./careers.server");
    const job = getJob(data.id);
    return { ...job, open: isOpen(job) };
  });

export const saveJobAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => jobInput.parse(d))
  .handler(async ({ data }) => {
    const user = await guard();
    const { saveJob } = await import("./careers.server");
    return saveJob(data, user.id);
  });
