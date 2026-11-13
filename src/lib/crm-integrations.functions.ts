import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const user = async () => (await import("./local-auth.server")).authorize(["admin", "comercial"]);
const administrator = async () => (await import("./local-auth.server")).authorize(["admin"]);
export const getEvolutionConnection = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await user();
  return (await import("./crm-integrations.server")).readCrmConnection(actor);
});
export const getCrmConnection = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await user();
  const waha = await import("./crm-waha.server");
  if (waha.isWahaSelected()) return waha.readWahaConnection(actor);
  const connection = await (await import("./crm-integrations.server")).readCrmConnection(actor);
  return { ...connection, capabilities: { media: false, history: false } };
});
export const getCrmIntegrationSettings = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await administrator();
  return (await import("./crm-integrations.server")).readCrmIntegrationSettings(actor);
});
export const saveCrmIntegrationSettings = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        revision: z.number().int().nonnegative(),
        evolutionUrl: z.string().max(500),
        evolutionInstance: z.string().max(100),
        evolutionApiKey: z.string().max(2000).optional(),
        evolutionWebhookSecret: z.string().max(500).optional(),
        googleWebhookKey: z.string().max(500).optional(),
        metaVerifyToken: z.string().max(500).optional(),
        metaAppSecret: z.string().max(500).optional(),
        metaPageToken: z.string().max(4000).optional(),
        metaPageId: z.string().max(40),
        metaGraphVersion: z.string().max(10),
        defaultOwnerId: z.string().max(100),
        defaultUnitId: z.string().max(100),
        clearSecrets: z
          .array(
            z.enum([
              "evolutionApiKey",
              "evolutionWebhookSecret",
              "googleWebhookKey",
              "metaVerifyToken",
              "metaAppSecret",
              "metaPageToken",
            ]),
          )
          .max(6)
          .default([]),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const actor = await administrator();
    return (await import("./crm-integrations.server")).saveCrmIntegrationSettings(actor, data);
  });
export const sendCrmMessage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        contactId: z.string().uuid(),
        text: z.string().trim().max(4000).default(""),
        attachmentIds: z.array(z.string().uuid()).max(1).default([]),
        clientMessageId: z.string().uuid().optional(),
      })
      .strict()
      .refine(
        (input) => Boolean(input.text) || input.attachmentIds.length > 0,
        "Informe uma mensagem ou anexo",
      )
      .parse(input),
  )
  .handler(async ({ data }) => {
    const actor = await user();
    const waha = await import("./crm-waha.server");
    if (waha.isWahaSelected()) {
      if (!data.clientMessageId)
        throw new Error("Identificador de envio obrigatório para WhatsApp.");
      return waha.sendWahaMessage(actor, { ...data, clientMessageId: data.clientMessageId });
    }
    if (data.attachmentIds.length) throw new Error("Configure o WAHA para enviar anexos pelo CRM.");
    return (await import("./crm-integrations.server")).sendCrmText(actor, data);
  });
export const prepareCrmEvolutionWebhook = createServerFn({ method: "POST" }).handler(async () => {
  const actor = await administrator();
  return (await import("./crm-integrations.server")).prepareCrmEvolutionWebhook(actor);
});
export const connectCrmEvolution = createServerFn({ method: "POST" }).handler(async () => {
  const actor = await administrator();
  return (await import("./crm-integrations.server")).connectCrmEvolution(actor);
});
export const retryCrmIntegrationEvent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data }) => {
    const actor = await administrator();
    return (await import("./crm-integrations.server")).retryCrmIntegrationEvent(actor, data.id);
  });
