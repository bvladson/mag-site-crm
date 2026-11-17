/** API do funil (Etapa 4). Validação de entrada aqui; papéis, dono e funis liberados são conferidos no servidor. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const id = z.string().uuid();
const revision = z.number().int().min(1);
const color = z.enum(["info", "warning", "primary", "success", "muted", "foreground"]);
const scope = z.enum(["shared", "specialized", "personal"]);
const requiredField = z.enum(["value", "nextAction", "notes"]);
const lossReason = z.enum(["Preço", "Prazo", "Sem estoque", "Desistiu", "Outro"]);
const optionalInt = z.number().int().min(1).max(9999).nullable().optional();

async function seller() {
  const { authorize } = await import("./local-auth.server");
  const actor = await authorize(["admin", "comercial"]);
  (await import("./crm.server")).ensureCrmSchema();
  return actor;
}
async function admin() {
  const { authorize } = await import("./local-auth.server");
  const actor = await authorize(["admin"]);
  (await import("./crm.server")).ensureCrmSchema();
  return actor;
}

export const moveOpportunityStage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        id,
        revision,
        pipelineId: id.optional(),
        stageId: id,
        lossReason: lossReason.optional(),
        fields: z
          .object({
            estimatedValueCents: z.number().int().min(0).max(100_000_000_000).optional(),
            notes: z.string().max(5000).optional(),
            nextAction: z
              .object({ label: z.string().trim().min(1).max(240), due: z.string().datetime({ offset: true }) })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => (await import("./crm.server")).moveOpportunityStage(await seller(), data));

export const getFunilAdmin = createServerFn({ method: "GET" }).handler(async () =>
  (await import("./crm-funil.server")).listFunilAdmin(await admin()),
);

export const getFunilAsSeller = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ userId: id }).strict().parse(input))
  .handler(async ({ data }) => (await import("./crm-funil.server")).funilAsSeller(await admin(), data.userId));

export const createPipeline = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ name: z.string().trim().min(1).max(60), scope, duplicateOf: id.optional() }).strict().parse(input),
  )
  .handler(async ({ data }) => (await import("./crm-funil.server")).createPipeline(await admin(), data));

export const updatePipeline = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ id, revision, name: z.string().trim().min(1).max(60).optional(), scope: scope.optional(), isDefault: z.boolean().optional() })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => (await import("./crm-funil.server")).updatePipeline(await admin(), data));

export const saveStages = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        pipelineId: id,
        revision,
        stages: z
          .array(
            z
              .object({
                id: id.optional(),
                label: z.string().trim().min(1).max(40),
                color,
                kind: z.enum(["open", "won", "lost"]).optional(),
                probability: z.number().int().min(0).max(100).optional(),
                wipLimit: optionalInt,
                staleDays: optionalInt,
                requiredFields: z.array(requiredField).max(3).optional(),
              })
              .strict(),
          )
          .min(3)
          .max(12),
        moves: z.record(id, id).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => (await import("./crm-funil.server")).saveStages(await admin(), data));

export const archivePipeline = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id, revision, targetPipelineId: id }).strict().parse(input))
  .handler(async ({ data }) => (await import("./crm-funil.server")).archivePipeline(await admin(), data));

export const setPipelineAccess = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ pipelineId: id, userId: id, allowed: z.boolean(), targetPipelineId: id.optional() }).strict().parse(input),
  )
  .handler(async ({ data }) => (await import("./crm-funil.server")).setPipelineAccess(await admin(), data));

export const setDefaultPipeline = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ userId: id, pipelineId: id }).strict().parse(input))
  .handler(async ({ data }) => (await import("./crm-funil.server")).setDefaultPipeline(await admin(), data));
