import { getRequestHeader } from '@tanstack/react-start/server';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { consumeRateLimit } from './local-db.server.ts';

export function clientIp() {
  // Only the dedicated reverse proxy is trusted; it overwrites X-Real-IP.
  const ip = process.env['SITE_TRUST_PROXY'] === 'true' ? getRequestHeader('x-real-ip')?.trim() : undefined;
  return ip && isIP(ip) ? ip : 'unknown';
}

export async function enforceRateLimit(form: string, max: number, windowSeconds: number, identity?: string) {
  const digest = createHash('sha256').update(identity || clientIp()).digest('hex');
  if (!consumeRateLimit(`${form}:${digest}`, max, windowSeconds)) {
    throw new Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  }
}

/** Enabled only once the matching public widget has been configured. */
export async function verifyTurnstile(token: string | undefined) {
  if (process.env['TURNSTILE_ENABLED'] !== 'true') return true;
  const secret = process.env['TURNSTILE_SECRET_KEY'];
  if (!secret || !token) return false;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({ secret, response: token, ...(clientIp() !== 'unknown' ? { remoteip: clientIp() } : {}) }),
    });
    return response.ok && !!((await response.json()) as { success?: boolean }).success;
  } catch { return false; }
}

export const clean = (s: string | undefined) => s == null ? undefined : s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').trim() || undefined;
export const digits = (s: string) => s.replace(/\D/g, '');
