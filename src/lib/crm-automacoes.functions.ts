import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Automações comerciais internas (crm-automacoes.server): só administrador. Nenhuma ação fala com o cliente. */
const id = z.string().uuid();
async function admin() {
  const { authorize } = await import("./local-auth.server");
  return authorize(["admin"]);
}
const rule = z
  .object({
    id: id.optional(),
    revision: z.number().int().min(1).optional(),
    name: z.string().max(80),
    trigger: z.string().max(40),
    delayAmount: z.number().int().min(0).max(365),
    delayUnit: z.string().max(10),
    origin: z.string().max(40),
    minValueCents: z.number().int().min(0).max(100_000_000_000),
    ownerScope: z.string().max(40),
    unitScope: z.string().max(40),
    action: z.string().max(40),
    taskLabel: z.string().max(120),
    businessHoursOnly: z.boolean(),
    businessDaysOnly: z.boolean(),
    dedupeHours: z.number().int().min(1).max(720),
  })
  .strict();

export const getAutomations = createServerFn({ method: "GET" }).handler(async () =>
  (await import("./crm-automacoes.server")).lerAutomacoes(await admin()),
);
export const saveAutomationSwitch = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ enabled: z.boolean(), revision: z.number().int().min(1) }).strict().parse(input))
  .handler(async ({ data }) => (await import("./crm-automacoes.server")).salvarInterruptor(await admin(), data));
export const saveAutomationRule = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => rule.parse(input))
  .handler(async ({ data }) => (await import("./crm-automacoes.server")).salvarRegra(await admin(), data));
export const setAutomationMode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id, revision: z.number().int().min(1), mode: z.enum(["desligada", "simulacao", "ativa"]) }).strict().parse(input))
  .handler(async ({ data }) => (await import("./crm-automacoes.server")).mudarModo(await admin(), data));
export const previewAutomationRule = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id }).strict().parse(input))
  .handler(async ({ data }) => (await import("./crm-automacoes.server")).simularRegra(await admin(), data.id));
export const runAutomationsNow = createServerFn({ method: "POST" }).handler(async () => {
  const user = await admin();
  const { executarAutomacoes } = await import("./crm-automacoes.server");
  const { audit } = await import("./local-db.server");
  const summary = executarAutomacoes({ origem: "manual" });
  audit(user.id, "crm:automation:run", summary.id, { criados: summary.created, simulados: summary.simulated, erros: summary.errors });
  return summary;
});
