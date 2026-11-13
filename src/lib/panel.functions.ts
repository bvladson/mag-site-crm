import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const searchPanel = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ q: z.string().trim().min(2).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const { authorize } = await import("./local-auth.server");
    const { searchPanelCore } = await import("./panel.server");
    return searchPanelCore(authorize(), data.q);
  });

export const getPanelCounts = createServerFn({ method: "GET" }).handler(async () => {
  const { authorize } = await import("./local-auth.server");
  const { panelCountsCore } = await import("./panel.server");
  return panelCountsCore(authorize());
});
