import { getCookie, setCookie, deleteCookie, setResponseHeader } from '@tanstack/react-start/server';
import { sessionUser, requireRoles, createSession, deleteSession, SESSION_SECONDS, type Role } from './local-auth-core.server.ts';
import { PANEL_ROLES } from './roles.ts';

export const SESSION_COOKIE = 'mag_site_session';
export function currentUser() {
  setResponseHeader('Cache-Control', 'private, no-store');
  return sessionUser(getCookie(SESSION_COOKIE));
}
export function authorize(roles: Role[] = [...PANEL_ROLES]) {
  return requireRoles(currentUser(), roles);
}
export function startSession(userId: string, mfaVerified = false) {
  deleteSession(getCookie(SESSION_COOKIE));
  setCookie(SESSION_COOKIE, createSession(userId, Date.now(), mfaVerified), {
    httpOnly: true, secure: process.env['COOKIE_SECURE'] === 'true' || process.env['NODE_ENV'] === 'production',
    sameSite: 'lax', path: '/', maxAge: SESSION_SECONDS,
  });
  setResponseHeader('Cache-Control', 'private, no-store');
}
export function endSession() {
  deleteSession(getCookie(SESSION_COOKIE));
  deleteCookie(SESSION_COOKIE, { path: '/' });
  setResponseHeader('Cache-Control', 'private, no-store');
}
