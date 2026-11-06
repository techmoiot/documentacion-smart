// Autenticación y administración de usuarios
import express from 'express';
import { all, get, run } from '../db.js';
import {
  hashPassword, verifyPassword, createSession, destroySession, getToken, setSessionCookie,
  clearSessionCookie, requireAuth, require_, loginThrottle, listUsers,
} from '../auth.js';
import { audit } from '../audit.js';
import { wrap, bad, notFound, conflict, intParam, HttpError } from '../http.js';

export const router = express.Router();
const DUMMY_HASH = hashPassword('contraseña-ficticia-para-igualar-tiempos');
const ROLES = ['admin', 'engineer', 'technician', 'viewer'];

function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 10) throw bad('La contraseña debe tener al menos 10 caracteres');
  if (p.length > 200) throw bad('Contraseña demasiado larga');
}

router.post('/auth/login', wrap((req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const th = loginThrottle(`${req.ip}|${username.toLowerCase()}`);
  if (th.blocked) throw new HttpError(429, 'Demasiados intentos fallidos. Espere unos minutos.');
  const u = get('SELECT * FROM users WHERE username = ? AND active = 1', username);
  // Verificación siempre ejecutada para no revelar si el usuario existe por tiempos de respuesta
  const ok = u ? verifyPassword(password, u.password_hash) : (verifyPassword(password, DUMMY_HASH), false);
  if (!ok) { th.fail(); throw new HttpError(401, 'Usuario o contraseña incorrectos'); }
  th.ok();
  const { token, expires } = createSession(u.id);
  setSessionCookie(res, token, expires);
  audit({ id: u.id, username: u.username }, 'inicio_sesion', 'users', u.id, `Inicio de sesión de ${u.username}`);
  res.json({ id: u.id, username: u.username, name: u.name, role: u.role });
}));

router.post('/auth/logout', wrap((req, res) => {
  destroySession(getToken(req));
  clearSessionCookie(res);
  res.json({ ok: true });
}));

router.get('/auth/me', wrap((req, res) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  res.json(req.user);
}));

router.post('/auth/password', requireAuth, wrap((req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(String(req.body?.current || ''), u.password_hash)) throw new HttpError(403, 'La contraseña actual no es correcta');
  checkPassword(req.body?.next);
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(req.body.next), u.id);
  run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', u.id, 'none');
  const { token, expires } = createSession(u.id);
  setSessionCookie(res, token, expires);
  audit(req.user, 'modificar', 'users', u.id, 'Cambió su contraseña');
  res.json({ ok: true });
}));

// ----- Administración (solo admin) -----
router.get('/users', require_('admin'), wrap((_req, res) => res.json(listUsers())));

router.post('/users', require_('admin'), wrap((req, res) => {
  const username = String(req.body?.username || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw bad('Usuario inválido (3–40 caracteres: letras, números, . _ -)');
  const role = req.body?.role;
  if (!ROLES.includes(role)) throw bad('Rol inválido');
  checkPassword(req.body?.password);
  if (get('SELECT 1 AS x FROM users WHERE username = ?', username)) throw conflict('Ya existe ese usuario');
  const r = run('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)', username, String(req.body?.name || '').trim().slice(0, 80), hashPassword(req.body.password), role);
  const newId = Number(r.lastInsertRowid);
  for (const pid of [...new Set((Array.isArray(req.body?.project_ids) ? req.body.project_ids : []).map(Number))]) {
    if (get('SELECT 1 AS x FROM projects WHERE id = ?', pid)) run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?,?)', pid, newId);
  }
  audit(req.user, 'crear', 'users', newId, `Creó usuario «${username}» (${role})`);
  res.status(201).json(listUsers().find((u) => u.id === Number(r.lastInsertRowid)));
}));

router.patch('/users/:id', require_('admin'), wrap((req, res) => {
  const id = intParam(req.params.id);
  const u = get('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw notFound('Usuario');
  const role = req.body?.role ?? u.role;
  const active = req.body?.active === undefined ? u.active : req.body.active ? 1 : 0;
  if (!ROLES.includes(role)) throw bad('Rol inválido');
  // Evita dejar el sistema sin administradores activos
  if (u.role === 'admin' && (role !== 'admin' || !active)) {
    const n = get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", id).n;
    if (n === 0) throw conflict('Debe existir al menos un administrador activo');
  }
  run('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?', String(req.body?.name ?? u.name).trim().slice(0, 80), role, active, id);
  if (req.body?.password) {
    checkPassword(req.body.password);
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(req.body.password), id);
  }
  if (!active || req.body?.password) run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(req.user, 'modificar', 'users', id, `Modificó usuario «${u.username}»`, { role: u.role, active: u.active }, { role, active });
  res.json(listUsers().find((x) => x.id === id));
}));

router.delete('/users/:id', require_('admin'), wrap((req, res) => {
  const id = intParam(req.params.id);
  if (id === req.user.id) throw conflict('No puede eliminar su propio usuario');
  const u = get('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw notFound('Usuario');
  if (u.role === 'admin' && get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", id).n === 0) throw conflict('Debe existir al menos un administrador activo');
  run('DELETE FROM users WHERE id = ?', id);
  audit(req.user, 'eliminar', 'users', id, `Eliminó usuario «${u.username}»`);
  res.json({ ok: true });
}));
