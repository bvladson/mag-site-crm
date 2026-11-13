import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

export const login = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => z.object({ email: z.string().trim().email().max(255), password: z.string().min(1).max(256), code: z.string().trim().max(40).optional() }).strict().parse(input))
  .handler(async ({ data }) => {
    const { enforceRateLimit } = await import('./security.server');
    await enforceRateLimit('login-ip', 20, 900);
    await enforceRateLimit('login-account', 10, 900, data.email.toLowerCase());
    const { authenticate } = await import('./local-auth-core.server');
    const { startSession } = await import('./local-auth.server');
    const user = await authenticate(data.email, data.password);
    if (!user || !user.roles.length) throw new Error('E-mail ou senha incorretos.');
    const { verifyMfaLogin } = await import('./mfa.server');
    if (!verifyMfaLogin(user, data.code)) return { ok: false as const, challenge: 'mfa' as const };
    startSession(user.id, true);
    return { ok: true as const, challenge: null };
  });

export const logout = createServerFn({ method: 'POST' }).handler(async () => {
  const { endSession } = await import('./local-auth.server');
  endSession();
  return { ok: true };
});

export const getCurrentUser = createServerFn({ method: 'GET' }).handler(async () => {
  const { currentUser } = await import('./local-auth.server');
  return currentUser();
});

export const updateMyPassword = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => z.object({ currentPassword: z.string().min(1).max(256), password: z.string().min(12).max(256) }).parse(input))
  .handler(async ({ data }) => {
    const { authorize, endSession } = await import('./local-auth.server');
    const user = authorize();
    const { enforceRateLimit } = await import('./security.server');
    await enforceRateLimit('password', 5, 900, user.id);
    const { changePassword } = await import('./local-auth-core.server');
    await changePassword(user, data.currentPassword, data.password);
    endSession();
    return { ok: true };
  });
