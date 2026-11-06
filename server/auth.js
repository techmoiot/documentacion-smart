// Autenticación: contraseñas con scrypt, sesiones en SQLite, cookie HttpOnly
import crypto from 'node:crypto';
import { get, run, all } from './db.js';
import { COOKIE_SECURE, SESSION_TTL_HOURS } from './config.js';

const COOKIE = 'sd_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_TTL_HOURS * 3600 * 1000;
  run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)', sha(token), userId, expires);
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  return { token, expires };
}

export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function getToken(req) {
  return parseCookies(req.headers.cookie)[COOKIE];
}

export function setSessionCookie(res, token, expires) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${new Date(expires).toUTCString()}`];
  if (COOKIE_SECURE) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Carga req.user si hay sesión válida. */
export function sessionMiddleware(req, _res, next) {
  const token = getToken(req);
  if (token) {
    const row = get(
      `SELECT u.id, u.username, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
      sha(token), Date.now()
    );
    if (row) req.user = row;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  next();
}

// Matriz de permisos
//   read   : consultar
//   update : modificar información existente (no crear ni borrar)
//   write  : crear / eliminar / mover estructura
//   admin  : usuarios y ajustes
const LEVEL = { viewer: 1, technician: 2, engineer: 3, admin: 4 };
const NEED = { read: 1, update: 2, write: 3, admin: 4 };

export function can(user, action) {
  return !!user && LEVEL[user.role] >= NEED[action];
}

export function require_(action) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (!can(req.user, action)) return res.status(403).json({ error: 'Permisos insuficientes para esta acción' });
    next();
  };
}

// Limitador sencillo de intentos de inicio de sesión (en memoria)
const attempts = new Map();
export function loginThrottle(key) {
  const now = Date.now();
  const rec = attempts.get(key) || { n: 0, first: now };
  if (now - rec.first > 15 * 60 * 1000) { rec.n = 0; rec.first = now; }
  attempts.set(key, rec);
  return {
    blocked: rec.n >= 8,
    fail() { rec.n++; },
    ok() { attempts.delete(key); },
  };
}

export function listUsers() {
  return all('SELECT id, username, name, role, active, created_at FROM users ORDER BY username');
}
