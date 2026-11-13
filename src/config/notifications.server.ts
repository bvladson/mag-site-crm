/**
 * Destinatários das notificações internas (server-only).
 * Podem ser substituídos por variáveis de ambiente.
 */
export function notificationConfig() {
  return {
    COMMERCIAL_EMAIL: process.env["COMMERCIAL_NOTIFICATION_EMAIL"] || "comercial@magmoveiscorporativos.com.br",
    DHO_EMAIL: process.env["DHO_NOTIFICATION_EMAIL"] || "dho@magmoveiscorporativos.com.br",
    /** Remetente verificado no provedor. Sem valor = e-mails não são enviados (lead continua salvo). */
    EMAIL_FROM: process.env["EMAIL_FROM"] || "",
    /** URL pública do painel; só gera link "Abrir no painel" quando definida. */
    PANEL_URL: process.env["PANEL_BASE_URL"] || "",
  };
}
