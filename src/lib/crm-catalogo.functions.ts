import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Catálogo no Atendimento: rascunho por oportunidade e pedidos do cliente (crm-catalogo.server). Omie só leitura. */
const id = z.string().uuid();
async function actor() {
  const { authorize } = await import("./local-auth.server");
  return authorize(["admin", "comercial"]);
}
async function produtos() {
  const { indiceInterno } = await import("./produtos-internos.server");
  return (await indiceInterno({ todos: true })).itens.map((p) => ({ id: p.id, sku: p.sku, nome: p.nome, unidade: p.unidade, slug: p.slug }));
}

export const getOpportunityDraft = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ opportunityId: id }).strict().parse(input))
  .handler(async ({ data }) => (await import("./crm-catalogo.server")).lerRascunho(await actor(), data.opportunityId));

export const saveOpportunityDraft = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        opportunityId: id,
        revision: z.number().int().min(0),
        itens: z.array(z.object({ produtoId: z.string().regex(/^\d{1,20}$/), quantidade: z.number().positive().max(100_000) }).strict()).max(199),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await actor();
    return (await import("./crm-catalogo.server")).salvarRascunho(user, data, await produtos());
  });

export const createQuoteFromDraft = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ opportunityId: id, revision: z.number().int().min(1) }).strict().parse(input))
  .handler(async ({ data }) => {
    const user = await actor();
    return (await import("./crm-catalogo.server")).gerarOrcamentoDoRascunho(user, data, await produtos());
  });

export const getContactOrders = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ contactId: id }).strict().parse(input))
  .handler(async ({ data }) => (await import("./crm-catalogo.server")).pedidosDoContato(await actor(), data.contactId));
