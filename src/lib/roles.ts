export const PANEL_ROLES = ["admin", "comercial", "gerente", "dho"] as const;
export type Role = (typeof PANEL_ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  comercial: "Comercial",
  gerente: "Gerente",
  dho: "DHO",
};
