import { createServerFn } from "@tanstack/react-start";

/** Saúde do sistema: só administrador, somente leitura (saude.server). */
export const getSystemHealth = createServerFn({ method: "GET" }).handler(async () => {
  const { authorize } = await import("./local-auth.server");
  const { readSystemHealth } = await import("./saude.server");
  return readSystemHealth(authorize(["admin"]));
});
