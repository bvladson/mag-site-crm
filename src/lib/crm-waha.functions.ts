import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
const admin = async () => (await import("./local-auth.server")).authorize(["admin"]);
const user = async () => (await import("./local-auth.server")).authorize(["admin", "comercial"]);
export const getWahaContactContext = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ contactId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) =>
    (await import("./crm-waha.server")).readWahaContactContext(await user(), data.contactId),
  );
export const bindWahaContactOpportunity = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ contactId: z.string().uuid(), opportunityId: z.string().uuid() })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) =>
    (await import("./crm-waha.server")).bindWahaContactOpportunity(await user(), data),
  );
export const getWahaSettings = createServerFn({ method: "GET" }).handler(async () =>
  (await import("./crm-waha.server")).readWahaSettings(await admin()),
);
export const saveWahaSettings = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        revision: z.number().int().nonnegative(),
        enabled: z.boolean(),
        baseUrl: z.string().trim().min(1).max(500),
        session: z
          .string()
          .trim()
          .min(1)
          .max(54)
          .regex(/^[a-zA-Z0-9_-]+$/),
        ownerId: z.union([z.literal(""), z.string().uuid()]),
        expectedPhone: z.string().max(30).optional(),
        apiKey: z.string().max(4000).optional(),
        hmacKey: z.string().max(500).optional(),
        clearSecrets: z
          .array(z.enum(["apiKey", "hmacKey"]))
          .max(2)
          .default([]),
        allowFullHistoryImport: z.boolean().optional(),
        allowAdminReplies: z.boolean().optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) =>
    (await import("./crm-waha.server")).saveWahaSettings(await admin(), data),
  );
export const getWahaConnection = createServerFn({ method: "GET" }).handler(async () =>
  (await import("./crm-waha.server")).readWahaConnection(await user()),
);
export const controlWahaSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ action: z.enum(["start", "restart", "qr", "configure", "status"]) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) =>
    (await import("./crm-waha.server")).controlWahaSession(await admin(), data),
  );
export const sendWahaMessage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        contactId: z.string().uuid(),
        text: z.string().trim().max(4000).optional(),
        attachmentIds: z.array(z.string().uuid()).max(1).optional(),
        clientMessageId: z.string().uuid(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) =>
    (await import("./crm-waha.server")).sendWahaMessage(await user(), data),
  );
export const syncWahaHistory = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        chatId: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) =>
    (await import("./crm-waha.server")).syncWahaHistory(await admin(), data),
  );
/** History of the selected conversation only (responsible seller or administrator). */
export const syncWahaContactHistory = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ contactId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) =>
    (await import("./crm-waha.server")).syncWahaContactHistory(await user(), data.contactId),
  );
export const retryWahaEvent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data }) =>
    (await import("./crm-waha.server")).retryWahaEvent(await admin(), data.id),
  );
