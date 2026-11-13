import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PANEL_ROLES } from "./roles";
const token = z.string().regex(/^[a-f0-9]{64}$/);
async function admin() {
  const { authorize } = await import("./local-auth.server");
  return authorize(["admin"]);
}
export const createPanelInvitation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(255),
        roles: z
          .array(z.enum(PANEL_ROLES))
          .min(1)
          .max(4),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data }) => {
    const actor = await admin(),
      { enforceRateLimit } = await import("./security.server");
    await enforceRateLimit("invite-create", 20, 3600, actor.id);
    const { createInvitation } = await import("./invitations.server");
    const invitation = createInvitation(actor, data);
    const emailConfigured = Boolean(process.env["RESEND_API_KEY"] && process.env["EMAIL_FROM"]);
    let emailSent = false;
    if (emailConfigured) {
      try {
        const { createResendProvider } = await import("./email/resend-provider.server");
        const result = await createResendProvider(process.env["EMAIL_FROM"]!).sendEmail({
          to: data.email, subject: "Seu acesso ao painel MAG",
          text: `Você recebeu um convite para o painel MAG. Defina sua senha pelo link de uso único, válido por 72 horas: ${invitation.url}`,
          html: `<p>Você recebeu um convite para o painel MAG.</p><p><a href="${invitation.url}">Definir minha senha</a></p><p>O link é de uso único e expira em 72 horas.</p>`,
        });
        emailSent = result.sent;
      } catch { /* O convite continua disponível para entrega manual. */ }
      const { audit } = await import("./local-db.server");
      audit(actor.id, "user:invite:email", invitation.id, { sent: emailSent });
    }
    return { ...invitation, emailSent, emailConfigured };
  });
export const getPanelInvitations = createServerFn({ method: "GET" }).handler(async () => {
  const { listInvitations } = await import("./invitations.server");
  return listInvitations(await admin());
});
export const revokePanelInvitation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data }) => {
    const { revokeInvitation } = await import("./invitations.server");
    return revokeInvitation(await admin(), data.id);
  });
export const getInvitationInfo = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token }).strict().parse(d))
  .handler(async ({ data }) => {
    const { setResponseHeader } = await import("@tanstack/react-start/server");
    setResponseHeader("Cache-Control", "private, no-store");
    setResponseHeader("Referrer-Policy", "no-referrer");
    const { enforceRateLimit } = await import("./security.server");
    await enforceRateLimit("invite-info", 30, 900);
    const { inspectInvitation } = await import("./invitations.server");
    return inspectInvitation(data.token);
  });
export const acceptPanelInvitation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token,
        password: z.string().min(12).max(256),
        name: z.string().trim().min(2).max(80),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { setResponseHeader } = await import("@tanstack/react-start/server");
    setResponseHeader("Cache-Control", "private, no-store");
    setResponseHeader("Referrer-Policy", "no-referrer");
    const { enforceRateLimit } = await import("./security.server");
    await enforceRateLimit("invite-accept-ip", 5, 900);
    await enforceRateLimit("invite-accept-token", 5, 900, data.token);
    const { acceptInvitation } = await import("./invitations.server");
    return acceptInvitation(data);
  });
