import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { discountPolicyInput } from "./discounts";
const quote = z.object({ id: z.string().uuid() });
async function user(roles: ("admin" | "comercial" | "gerente")[]) {
  const { authorize } = await import("./local-auth.server");
  return authorize(roles);
}
export const getDiscountPolicy = createServerFn({ method: "GET" }).handler(async () => {
  await user(["admin", "gerente"]);
  const { readDiscountPolicy } = await import("./discounts.server");
  return readDiscountPolicy();
});
export const setDiscountPolicy = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => discountPolicyInput.parse(d))
  .handler(async ({ data }) => {
    const u = await user(["admin"]);
    const { saveDiscountPolicy } = await import("./discounts.server");
    return saveDiscountPolicy(u, data);
  });
export const getDiscountQueue = createServerFn({ method: "GET" }).handler(async () => {
  const u = await user(["admin", "gerente"]);
  const { discountQueue } = await import("./discounts.server");
  return discountQueue(u);
});
export const getQuoteDiscount = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => quote.parse(d))
  .handler(async ({ data }) => {
    const u = await user(["admin", "comercial", "gerente"]);
    const { discountStatus } = await import("./discounts.server");
    return discountStatus(u, data.id);
  });
export const requestQuoteDiscount = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => quote.parse(d))
  .handler(async ({ data }) => {
    const u = await user(["admin", "comercial", "gerente"]);
    const { requestDiscountApproval } = await import("./discounts.server");
    return requestDiscountApproval(u, data.id);
  });
export const decideQuoteDiscount = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["aprovado", "recusado"]),
        reason: z.string().trim().min(1).max(1000),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data }) => {
    const u = await user(["admin", "gerente"]);
    const { decideDiscount } = await import("./discounts.server");
    return decideDiscount(u, data.id, data.decision, data.reason);
  });
