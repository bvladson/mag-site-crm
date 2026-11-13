import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const id = z.string().uuid();
const revision = z.number().int().min(1);
const origin = z.enum([
  "Anúncio Meta",
  "Anúncio Google",
  "Site",
  "Indicação",
  "WhatsApp",
  "Desconhecida",
]);
const contact = z
  .object({
    name: z.string().trim().min(1).max(200),
    company: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().max(255).optional(),
    city: z.string().trim().max(120).optional(),
    ownerId: id.optional(),
    unitId: id.nullable().optional(),
  })
  .strict();
async function actor() {
  const { authorize } = await import("./local-auth.server");
  return authorize(["admin", "comercial"]);
}

export const getCrmBootstrap = createServerFn({ method: "GET" }).handler(async () => {
  const { getCrmBootstrap: run } = await import("./crm.server");
  return run(await actor());
});
export const getCrmContact = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id }).strict().parse(input))
  .handler(async ({ data }) => (await import("./crm.server")).getCrmContactDetail(await actor(), data.id));
export const getCrmOpportunity = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id }).strict().parse(input))
  .handler(async ({ data }) => (await import("./crm.server")).requireCrmOpportunity(await actor(), data.id));
export const getCrmContactsPage = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ search: z.string().trim().max(200).optional(), searchMode: z.enum(["contacts", "all"]).optional(), before: z.string().max(512).optional(), limit: z.number().int().min(1).max(100).optional(), ownerId: id.optional(), unitId: id.optional(), attentionOnly: z.boolean().optional(), view: z.enum(["todas", "responder", "aguardando", "retornos", "proposta"]).optional() }).strict().parse(input))
  .handler(async ({ data }) => (await import("./crm.server")).listCrmContactsPage(await actor(), data));
export const getCrmTasksPage = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ opportunityId: id.optional(), status: z.enum(["pending", "done"]).optional(), after: z.string().max(512).optional(), limit: z.number().int().min(1).max(100).optional() }).strict().parse(input))
  .handler(async ({ data }) => (await import("./crm.server")).listCrmTasksPage(await actor(), data));
export const getCrmConversationPage = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z
      .object({
        contactId: id,
        before: z.string().max(512).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { listCrmMessagesPage } = await import("./crm.server");
    return listCrmMessagesPage(await actor(), data);
  });
export const getOpportunityDetail = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id }).strict().parse(input))
  .handler(async ({ data }) => {
    const { getOpportunityDetail: run } = await import("./crm.server");
    return run(await actor(), data.id);
  });
export const markConversationRead = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ contactId: id }).strict().parse(input))
  .handler(async ({ data }) => {
    const { markCrmRead } = await import("./crm.server");
    return markCrmRead(await actor(), data.contactId);
  });
export const createContact = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => contact.parse(input))
  .handler(async ({ data }) => {
    const { createContact: run } = await import("./crm.server");
    return run(await actor(), data);
  });
export const updateContact = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => contact.extend({ id, revision }).strict().parse(input))
  .handler(async ({ data }) => {
    const { updateContact: run } = await import("./crm.server");
    return run(await actor(), data);
  });
export const createOpportunity = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        contactId: id.optional(),
        newContact: contact.optional(),
        title: z.string().trim().min(1).max(240),
        interest: z.string().trim().max(3000).optional(),
        origin,
        ownerId: id.optional(),
        unitId: id.nullable().optional(),
      })
      .strict()
      .refine(
        (value) => Boolean(value.contactId) !== Boolean(value.newContact),
        "Selecione ou cadastre um contato",
      )
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { createOpportunity: run } = await import("./crm.server");
    return run(await actor(), data);
  });
export const updateOpportunity = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        id,
        revision,
        title: z.string().trim().min(1).max(240).optional(),
        interest: z.string().trim().max(3000).optional(),
        notes: z.string().trim().max(5000).optional(),
        awaitingReply: z.boolean().optional(),
        estimatedValueCents: z.number().int().min(0).max(100_000_000_000).optional(),
        ownerId: id.optional(),
        unitId: id.nullable().optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { updateOpportunity: run } = await import("./crm.server");
    return run(await actor(), data);
  });
export const moveOpportunity = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        id,
        revision,
        stage: z.enum(["novo", "conversando", "orcamento", "fechado", "perdido"]),
        lossReason: z.enum(["Preço", "Prazo", "Sem estoque", "Desistiu", "Outro"]).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { moveOpportunity: run } = await import("./crm.server");
    return run(await actor(), data);
  });
export const scheduleTask = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        opportunityId: id,
        label: z.string().trim().min(1).max(240),
        due: z.string().datetime({ offset: true }),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { scheduleTask: run } = await import("./crm.server");
    return run(await actor(), data);
  });
export const completeTask = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id }).strict().parse(input))
  .handler(async ({ data }) => {
    const { completeTask: run } = await import("./crm.server");
    return run(await actor(), data);
  });
export const importSiteLead = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ sourceKind: z.enum(["quote", "contact"]), sourceId: id })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { importSiteLead: run } = await import("./crm.server");
    return run(await actor(), data);
  });
export const linkQuote = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ opportunityId: id, quoteId: id, confirmMismatch: z.boolean().optional(), justification: z.string().trim().max(1000).optional(), confirmationToken: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const { linkQuote: run } = await import("./crm.server");
    return run(await actor(), data);
  });
export const previewCrmQuoteLink = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ opportunityId: id, quoteId: id }).strict().parse(input))
  .handler(async ({ data }) => (await import("./crm.server")).previewCrmQuoteLink(await actor(), data));
export const createQuoteForOpportunity = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ opportunityId: id }).strict().parse(input))
  .handler(async ({ data }) => {
    const user = await actor();
    const { createQuoteForOpportunity: run, requireCrmOpportunity } = await import("./crm.server");
    requireCrmOpportunity(user, data.opportunityId);
    const { indiceInterno } = await import("./produtos-internos.server");
    const products = (await indiceInterno({ todos: true })).itens.map((p) => ({
      id: p.id,
      sku: p.sku,
      nome: p.nome,
      unidade: p.unidade,
      slug: p.slug,
    }));
    return run(user, data, products);
  });
