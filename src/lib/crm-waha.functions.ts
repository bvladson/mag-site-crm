import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
const admin = async () => (await import("./local-auth.server")).authorize(["admin"]);
const user = async () => (await import("./local-auth.server")).authorize(["admin", "comercial"]);
/** Browses existing WhatsApp conversations; no implicit history or lead import. */
export const getWahaContactCatalog = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z
      .object({
        lineId: z.string().uuid().optional(),
        search: z.string().trim().max(200).optional(),
        before: z.string().max(2048).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .strict()
      .parse(input ?? {}),
  )
  .handler(async ({ data }) =>
    (await import("./crm-waha.server")).readWahaContactCatalog(await user(), data),
  );
export const importWahaContact = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        lineId: z.string().uuid().optional(),
        chatId: z.string().max(200),
        selectionToken: z.string().min(1).max(4096),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) =>
    (await import("./crm-waha.server")).importWahaContact(await user(), data),
  );
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
/** Connector settings shared by every line (address, credentials, options and blocked numbers). */
export const saveWahaSettings = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        revision: z.number().int().nonnegative(),
        enabled: z.boolean(),
        baseUrl: z.string().trim().min(1).max(500),
        apiKey: z.string().max(4000).optional(),
        hmacKey: z.string().max(500).optional(),
        clearSecrets: z
          .array(z.enum(["apiKey", "hmacKey"]))
          .max(2)
          .default([]),
        allowFullHistoryImport: z.boolean().optional(),
        allowAdminReplies: z.boolean().optional(),
        blockedPhones: z.array(z.string().max(30)).max(20).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) =>
    (await import("./crm-waha.server")).saveWahaSettings(await admin(), data),
  );
/** Registers a seller's line (number) or edits its authorized number. */
export const saveWahaLine = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        revision: z.number().int().nonnegative().optional(),
        userId: z.string().uuid(),
        expectedPhone: z.string().max(30).default(""),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) =>
    (await import("./crm-waha.server")).saveWahaLine(await admin(), data),
  );
/** Disables (offboarding: disconnects first) or reactivates a line. Conversations stay in the CRM. */
export const setWahaLineStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        revision: z.number().int().nonnegative(),
        status: z.enum(["active", "disabled"]),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) =>
    (await import("./crm-waha.server")).setWahaLineStatus(await admin(), data),
  );
export const getWahaConnection = createServerFn({ method: "GET" }).handler(async () =>
  (await import("./crm-waha.server")).readWahaConnection(await user()),
);
export const getWahaOutbox = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ contactId: z.string().uuid().optional(), lineId: z.string().uuid().optional() }).strict().parse(input ?? {}))
  .handler(async ({ data }) => (await import("./crm-waha.server")).readWahaOutbox(await user(), data));
export const retryWahaRecovery = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ lineId: z.string().uuid().optional() }).strict().parse(input ?? {}))
  .handler(async ({ data }) => (await import("./crm-waha.server")).retryWahaRecovery(await user(), data));
/** Sellers connect, read the QR, reconnect and disconnect their own line; administrators any line. */
export const controlWahaSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        action: z.enum(["start", "restart", "qr", "configure", "status", "pause", "logout"]),
        lineId: z.string().uuid().optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) =>
    (await import("./crm-waha.server")).controlWahaSession(await user(), data),
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
        lineId: z.string().uuid().optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) =>
    (await import("./crm-waha.server")).syncWahaHistory(await admin(), data),
  );
/** History of the selected conversation only (the contact's seller or an administrator). */
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
