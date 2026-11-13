import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getDb, audit, transaction } from './local-db.server.ts';
import { PANEL_ROLES } from './roles.ts';

export type { Role } from './roles.ts';
import type { Role } from './roles.ts';
export type SiteUser = { id: string; email: string; roles: Role[]; created_at: string };
const derive = promisify(scrypt);
export const SESSION_SECONDS = 8 * 60 * 60;

export function strongPassword(password: string) {
  return password.length >= 12 && password.length <= 256 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password);
}

export async function hashPassword(password: string) {
  if (!strongPassword(password)) throw new Error('Use uma senha de 12 a 256 caracteres, com maiúsculas, minúsculas e números.');
  const salt = randomBytes(24).toString('hex');
  const key = await derive(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, expected] = encoded.split(':');
  if (algorithm !== 'scrypt' || !salt || !expected || !/^[a-f0-9]{128}$/.test(expected)) return false;
  const actual = await derive(password, salt, 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

function publicUser(row: Record<string, any>): SiteUser {
  return { id: row['id'], email: row['email'], roles: JSON.parse(row['roles']), created_at: row['created_at'] };
}

export async function createUser(email: string, password: string, roles: Role[], actor: string | null = null, bootstrap = false) {
  email = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) throw new Error('E-mail inválido');
  if (!roles.length || roles.some(r => !PANEL_ROLES.includes(r))) throw new Error('Perfil inválido');
  const hash = await hashPassword(password);
  return transaction(() => {
    if (bootstrap && Number(getDb().prepare('SELECT count(*) AS n FROM users').get()?.['n']) !== 0) throw new Error('Administrador inicial já configurado');
    const id = randomUUID();
    try {
      getDb().prepare('INSERT INTO users(id,email,password_hash,roles,created_at) VALUES (?,?,?,?,?)')
        .run(id, email, hash, JSON.stringify([...new Set(roles)]), new Date().toISOString());
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error('Este e-mail já está cadastrado');
      throw error;
    }
    audit(actor, bootstrap ? 'user:bootstrap' : 'user:create', id);
    return { id };
  });
}

const dummyHash = `scrypt:${'0'.repeat(48)}:${'0'.repeat(128)}`;
export async function authenticate(email: string, password: string): Promise<SiteUser | null> {
  const row = getDb().prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE AND disabled=0').get(email.trim().toLowerCase());
  const valid = await verifyPassword(password, row ? String(row['password_hash']) : dummyHash);
  if (!row || !valid) return null;
  return publicUser(row);
}

/**
 * Login recusado vai para a auditoria (monitoramento de tentativas contra contas). Nunca guarda a senha nem o e-mail
 * digitado: só a conta, quando ela existe.
 */
export function recordFailedLogin(email: string) {
  const row = getDb().prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE').get(email.trim().toLowerCase());
  audit(null, 'auth:login:failed', row ? String(row['id']) : null, { conta: row ? 'existente' : 'inexistente' });
}

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function createSession(userId: string, now = Date.now(), mfaVerified = false) {
  const db = getDb();
  if (!mfaVerified && db.prepare("SELECT 1 FROM sqlite_master WHERE name='user_mfa'").get()
    && db.prepare('SELECT 1 FROM user_mfa WHERE user_id=? AND enabled=1').get(userId)) throw new Error('Verificação em duas etapas necessária');
  const token = randomBytes(32).toString('hex');
  transaction(() => {
    const db = getDb();
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
      .run(tokenHash(token), userId, now + SESSION_SECONDS * 1000, now);
    // Bound active sessions per account without storing the bearer token.
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 10)')
      .run(userId, userId);
    audit(userId, 'auth:login');
  });
  return token;
}

export function sessionUser(token: string | undefined, now = Date.now()): SiteUser | null {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = getDb().prepare(`SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
    WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`).get(tokenHash(token), now);
  return row ? publicUser(row) : null;
}

export function deleteSession(token: string | undefined) {
  if (token) getDb().prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
}

export function requireRoles(user: SiteUser | null, allowed: Role[]) {
  if (!user) throw new Error('Unauthorized: entre na sua conta');
  if (!user.roles.some(role => allowed.includes(role))) throw new Error('Forbidden: sem permissão para esta área');
  return user;
}

/** Fresh database roles for sensitive operations; never trust roles passed by a caller. */
export function requireActiveUser(user: SiteUser | null, allowed: Role[] = [...PANEL_ROLES]) {
  if (!user) throw new Error('Unauthorized: entre na sua conta');
  const row = getDb().prepare('SELECT id,email,roles,created_at FROM users WHERE id=? AND disabled=0').get(user.id);
  if (!row) throw new Error('Unauthorized: entre na sua conta');
  return requireRoles(publicUser(row), allowed);
}

export function listLocalUsers() {
  return getDb().prepare('SELECT id,email,roles,created_at,disabled FROM users ORDER BY created_at DESC LIMIT 500').all().map((r) => ({ ...publicUser(r), disabled: Boolean(r['disabled']) }));
}

export function changeRole(actor: SiteUser, id: string, role: Role, enabled: boolean) {
  requireRoles(actor, ['admin']);
  if (id === actor.id && role === 'admin' && !enabled) throw new Error('Você não pode remover o próprio acesso de admin');
  return transaction(() => {
    requireActiveUser(actor, ['admin']);
    const row = getDb().prepare('SELECT roles FROM users WHERE id=? AND disabled=0').get(id);
    if (!row) throw new Error('Usuário não encontrado');
    const roles = new Set<Role>(JSON.parse(String(row['roles'])));
    if (!enabled && role === 'admin' && roles.has('admin') && Number(getDb().prepare("SELECT count(*) n FROM users WHERE disabled=0 AND EXISTS(SELECT 1 FROM json_each(users.roles) WHERE value='admin')").get()?.['n']) <= 1) throw new Error('Deve existir pelo menos um administrador ativo');
    if (enabled) roles.add(role); else roles.delete(role);
    getDb().prepare('UPDATE users SET roles=? WHERE id=?').run(JSON.stringify([...roles]), id);
    getDb().prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    audit(actor.id, enabled ? `role:add:${role}` : `role:remove:${role}`, id);
    return { ok: true };
  });
}

export async function changePassword(user: SiteUser, currentPassword: string, password: string) {
  const authenticated = await authenticate(user.email, currentPassword);
  if (!authenticated) throw new Error('Senha atual incorreta');
  const hash = await hashPassword(password);
  transaction(() => {
    getDb().prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, user.id);
    getDb().prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    audit(user.id, 'user:password');
  });
}

/** Admin define uma senha provisória para outra pessoa; as sessões dela caem na hora. */
export async function resetPassword(actor: SiteUser, id: string, password: string) {
  requireRoles(actor, ['admin']);
  if (id === actor.id) throw new Error('Para trocar a própria senha, use Minha conta');
  const hash = await hashPassword(password);
  transaction(() => {
    const result = getDb().prepare('UPDATE users SET password_hash=? WHERE id=? AND disabled=0').run(hash, id);
    if (!result.changes) throw new Error('Usuário não encontrado');
    getDb().prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    audit(actor.id, 'user:password-reset', id);
  });
}

/** Desativa sem apagar: o histórico de auditoria continua apontando para a conta. */
export function disableUser(actor: SiteUser, id: string) {
  requireRoles(actor, ['admin']);
  if (id === actor.id) throw new Error('Você não pode desativar a própria conta');
  transaction(() => {
    requireActiveUser(actor, ['admin']);
    const target = getDb().prepare("SELECT roles FROM users WHERE id=? AND disabled=0").get(id);
    if (target && JSON.parse(String(target['roles'])).includes('admin') && Number(getDb().prepare("SELECT count(*) n FROM users WHERE disabled=0 AND EXISTS(SELECT 1 FROM json_each(users.roles) WHERE value='admin')").get()?.['n']) <= 1) throw new Error('Deve existir pelo menos um administrador ativo');
    const result = getDb().prepare('UPDATE users SET disabled=1 WHERE id=? AND disabled=0').run(id);
    if (!result.changes) throw new Error('Usuário não encontrado');
    getDb().prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    audit(actor.id, 'user:disable', id);
  });
}

export function reactivateUser(actor: SiteUser, id: string) {
  requireActiveUser(actor, ['admin']);
  return transaction(() => {
    requireActiveUser(actor, ['admin']);
    const result = getDb().prepare('UPDATE users SET disabled=0 WHERE id=? AND disabled=1').run(id);
    if (!result.changes) throw new Error('Usuário inativo não encontrado');
    getDb().prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    audit(actor.id, 'user:reactivate', id);
    return { ok: true };
  });
}
