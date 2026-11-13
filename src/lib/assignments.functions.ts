import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
const id = z.string().uuid();
async function actor() {
  const { authorize } = await import("./local-auth.server");
  return authorize(["admin", "comercial"]);
}
export const getLeadDistribution = createServerFn({ method: "GET" }).handler(async () => {
  const user = await actor();
  const { readDistribution } = await import("./assignments.server");
  return readDistribution(user);
});
export const getAssignedLeads = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({ status: z.string().max(40).optional(), search: z.string().max(100).optional() })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const user = await actor();
    const { readAssignedLeads } = await import("./assignments.server");
    return readAssignedLeads(user, data);
  });
export const setLeadAssignment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        leadId: id,
        ownerId: id.nullable(),
        unitId: id.nullable(),
        revision: z.number().int().min(0),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await actor();
    const { assignLead } = await import("./assignments.server");
    return assignLead(user, data);
  });
export const setLeadDistribution = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        mode: z.enum(["manual", "unidade", "rodizio"]),
        revision: z.number().int().min(1),
        consultants: z
          .array(z.object({ userId: id, unitId: id.nullable(), enabled: z.boolean() }))
          .max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await actor();
    const { saveDistribution } = await import("./assignments.server");
    return saveDistribution(user, data);
  });
export const getLeadAssignment = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ leadId: id }).parse(d))
  .handler(async ({ data }) => {
    const user = await actor();
    const { readLeadAssignment } = await import("./assignments.server");
    return readLeadAssignment(user, data.leadId);
  });
