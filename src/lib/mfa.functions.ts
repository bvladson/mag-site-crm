import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function guard() {
  const { authorize } = await import("./local-auth.server");
  return authorize();
}
async function sessionHash() {
  const { getCookie } = await import("@tanstack/react-start/server");
  const { SESSION_COOKIE } = await import("./local-auth.server");
  const { tokenHash } = await import("./local-auth-core.server");
  return tokenHash(getCookie(SESSION_COOKIE) ?? "");
}
const password = z.string().min(1).max(256),
  code = z.string().trim().min(6).max(40);
const confirmation = z.object({ password, code }).strict();
export const getMySecurity = createServerFn({ method: "GET" }).handler(async () => {
  const user = await guard(),
    { mfaStatus, ownSessions, teamMfaStatus } = await import("./mfa.server");
  return {
    ...mfaStatus(user),
    sessions: ownSessions(user, await sessionHash()),
    team: user.roles.includes("admin") ? teamMfaStatus(user) : null,
  };
});
export const startMyMfa = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password }).strict().parse(d))
  .handler(async ({ data }) => {
    const user = await guard();
    const { enforceRateLimit } = await import("./security.server");
    await enforceRateLimit("mfa-setup", 5, 900, user.id);
    const { beginMfaSetup } = await import("./mfa.server");
    const setup = await beginMfaSetup(user, data.password);
    const QRCode = (await import("qrcode")).default;
    return {
      ...setup,
      qr: await QRCode.toDataURL(setup.uri, { width: 240, margin: 2, errorCorrectionLevel: "M" }),
    };
  });
export const enableMyMfa = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ code }).strict().parse(d))
  .handler(async ({ data }) => {
    const { confirmMfaSetup } = await import("./mfa.server");
    return confirmMfaSetup(await guard(), data.code, await sessionHash());
  });
export const disableMyMfa = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => confirmation.parse(d))
  .handler(async ({ data }) => {
    const user = await guard();
    const { enforceRateLimit } = await import("./security.server");
    await enforceRateLimit("mfa-sensitive", 5, 900, user.id);
    const { disableMfa } = await import("./mfa.server");
    return disableMfa(user, data.password, data.code, await sessionHash());
  });
export const renewMyRecovery = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => confirmation.parse(d))
  .handler(async ({ data }) => {
    const user = await guard();
    const { enforceRateLimit } = await import("./security.server");
    await enforceRateLimit("mfa-sensitive", 5, 900, user.id);
    const { regenerateMfaRecovery } = await import("./mfa.server");
    return regenerateMfaRecovery(user, data.password, data.code);
  });
export const revokeMySession = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({ id: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { revokeSession } = await import("./mfa.server");
    return revokeSession(await guard(), data.id, await sessionHash());
  });
