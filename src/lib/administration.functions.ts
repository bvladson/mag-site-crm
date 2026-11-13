import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
const input = z
  .object({
    page: z.number().int().min(1).max(100000).default(1),
    action: z
      .string()
      .max(80)
      .regex(/^[a-zA-Z0-9_:.-]*$/)
      .default(""),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();
export const getAuditLog = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data }) => {
    const { authorize } = await import("./local-auth.server");
    const { listAuditLog } = await import("./administration.server");
    return listAuditLog(authorize(["admin"]), data);
  });
