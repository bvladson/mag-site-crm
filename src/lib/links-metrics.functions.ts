import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
const period = (input: unknown) =>
  z
    .object({ days: z.union([z.literal(30), z.literal(90)]).default(30) })
    .strict()
    .parse(input);
export const getMarketingMetrics = createServerFn({ method: "GET" })
  .inputValidator(period)
  .handler(async ({ data }) => {
    const { authorize } = await import("./local-auth.server");
    const { readMarketingMetrics } = await import("./links-metrics.server");
    return readMarketingMetrics(await authorize(["admin"]), data.days);
  });
export const getCommercialMetrics = createServerFn({ method: "GET" })
  .inputValidator(period)
  .handler(async ({ data }) => {
    const { authorize } = await import("./local-auth.server");
    const { readCommercialMetrics } = await import("./links-metrics.server");
    return readCommercialMetrics(await authorize(["admin", "comercial"]), data.days);
  });
