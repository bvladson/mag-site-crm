import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PublicJob } from "@/config/careers";

/** Vagas abertas (publicadas e no prazo) para /carreiras. Sem dados internos. */
export const listOpenJobs = createServerFn({ method: "GET" }).handler(async (): Promise<PublicJob[]> => {
  const { listOpenJobs: read } = await import("./careers.server");
  return read();
});

/** Página da vaga: aberta, ou encerrada (com aviso). Rascunho e slug desconhecido → null (404). */
export const getPublicJob = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.string().min(1).max(80).regex(/^[a-z0-9-]+$/).parse(d))
  .handler(async ({ data }): Promise<PublicJob | null> => {
    const { findPublicJob } = await import("./careers.server");
    return findPublicJob(data);
  });
