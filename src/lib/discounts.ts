import { z } from "zod";
export const discountPolicyInput = z
  .object({
    enabled: z.boolean(),
    consultor: z.number().min(0).max(100),
    gerente: z.number().min(0).max(100),
    diretoria: z.number().min(0).max(100),
    revision: z.number().int().min(0).safe(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.consultor > v.gerente || v.gerente > v.diretoria)
      c.addIssue({
        code: "custom",
        message: "Os limites devem ser crescentes: Consultor ≤ Gerente ≤ Diretoria",
      });
    if (
      [v.consultor, v.gerente, v.diretoria].some(
        (n) => Math.abs(n * 100 - Math.round(n * 100)) > 1e-7,
      )
    )
      c.addIssue({ code: "custom", message: "Use no máximo duas casas decimais nos percentuais" });
  });
export type DiscountPolicy = z.infer<typeof discountPolicyInput>;
/** Valores iniciais são exemplos editáveis; o bloqueio só é ativado ao salvar uma política confirmada. */
export const DEFAULT_DISCOUNT_POLICY: DiscountPolicy = {
  enabled: false,
  consultor: 5,
  gerente: 10,
  diretoria: 15,
  revision: 0,
};
export type DiscountAuthority = "livre" | "gerente" | "diretoria" | "bloqueado";
export function discountAuthority(
  basisPoints: number,
  policy: DiscountPolicy,
  ownerRoles: string[] = ["comercial"],
): DiscountAuthority {
  if (basisPoints > Math.round(policy.diretoria * 100)) return "bloqueado";
  const own = ownerRoles.includes("admin")
    ? policy.diretoria
    : ownerRoles.includes("gerente")
      ? policy.gerente
      : policy.consultor;
  if (basisPoints <= Math.round(own * 100)) return "livre";
  return basisPoints <= Math.round(policy.gerente * 100) ? "gerente" : "diretoria";
}
export function discountBasisPoints(discountCents: number, baseCents: number): number {
  if (baseCents <= 0) return discountCents > 0 ? 10_001 : 0;
  const value = BigInt(Math.max(0, Math.round(discountCents))) * 10_000n;
  const base = BigInt(Math.round(baseCents));
  return Number((value + base - 1n) / base);
}
export const DISCOUNT_LABELS: Record<DiscountAuthority, string> = {
  livre: "Dentro da alçada",
  gerente: "Requer Gerente",
  diretoria: "Requer Diretoria (Admin)",
  bloqueado: "Acima do limite máximo",
};
