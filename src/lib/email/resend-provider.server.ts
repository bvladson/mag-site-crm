import type { EmailProvider, SendEmailInput, SendEmailResult } from "./email-provider";

/**
 * Resend. Com LOVABLE_API_KEY presente (Lovable Cloud + conector) usa o gateway;
 * fora do Lovable (VPS) chama a API do Resend diretamente com RESEND_API_KEY.
 */
export function createResendProvider(from: string): EmailProvider {
  return {
    async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
      const key = process.env["RESEND_API_KEY"];
      if (!key) return { sent: false, reason: "RESEND_API_KEY ausente" };
      if (!from) return { sent: false, reason: "EMAIL_FROM ausente" };
      const lovableKey = process.env["LOVABLE_API_KEY"];
      const url = lovableKey ? "https://connector-gateway.lovable.dev/resend/emails" : "https://api.resend.com/emails";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (lovableKey) {
        headers["Authorization"] = `Bearer ${lovableKey}`;
        headers["X-Connection-Api-Key"] = key;
      } else {
        headers["Authorization"] = `Bearer ${key}`;
      }
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          from, to: Array.isArray(input.to) ? input.to : [input.to], subject: input.subject, html: input.html, text: input.text,
          ...(input.replyTo ? { reply_to: input.replyTo } : {}), ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { sent: false, reason: `Resend [${res.status}]: ${body.slice(0, 300)}` };
      }
      return { sent: true };
    },
  };
}
