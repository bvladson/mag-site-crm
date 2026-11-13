import { createServerFn } from "@tanstack/react-start";
import { unitSchema } from "./units";

export const getPublicUnits = createServerFn({ method: "GET" }).handler(async () => {
  const { listUnitsPublic } = await import("./units.server");
  return listUnitsPublic();
});
export const getAdminUnits = createServerFn({ method: "GET" }).handler(async () => {
  const { authorize } = await import("./local-auth.server");
  const { listUnitsAdmin } = await import("./units.server");
  return listUnitsAdmin(authorize(["admin"]));
});
export const saveAdminUnit = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => unitSchema.parse(d))
  .handler(async ({ data }) => {
    const { authorize } = await import("./local-auth.server");
    const { saveUnit } = await import("./units.server");
    return saveUnit(authorize(["admin"]), data);
  });
