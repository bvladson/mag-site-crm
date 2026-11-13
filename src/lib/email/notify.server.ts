import { notificationConfig } from "@/config/notifications.server";
import { createResendProvider } from "./resend-provider.server";
import type { SendEmailInput } from "./email-provider";

/** Tenta notificar; nunca lança erro — o lead já está salvo e é a fonte da verdade. */
export async function notify(kind: "commercial" | "dho", msg: Omit<SendEmailInput, "to">) {
  const cfg = notificationConfig();
  const to = kind === "commercial" ? cfg.COMMERCIAL_EMAIL : cfg.DHO_EMAIL;
  try {
    const r = await createResendProvider(cfg.EMAIL_FROM).sendEmail({ ...msg, to });
    if (!r.sent) console.warn(`[notify:${kind}] não enviado: ${r.reason}`);
    return r;
  } catch (err) {
    console.error(`[notify:${kind}] erro`, err);
    return { sent: false as const, reason: "exception" };
  }
}

export const panelLink = (path: string) => {
  const base = notificationConfig().PANEL_URL;
  return base ? `${base.replace(/\/$/, "")}${path}` : undefined;
};
