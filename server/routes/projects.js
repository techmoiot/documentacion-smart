// Proyectos: crear, compartir con usuarios, fusionar y eliminar
import express from 'express';
import { all, get, run, tx } from '../db.js';
import { require_ } from '../auth.js';
import { audit } from '../audit.js';
import { wrap, bad, notFound, conflict, intParam, ph } from '../http.js';
import { scope, visible } from '../scope.js';

export const router = express.Router();
const TABLES = ['nodes', 'racks', 'devices', 'antennas', 'radiolinks', 'connections', 'poles', 'fiber_elements'];
const COLOR = /^#[0-9a-fA-F]{6}$/;

function withCounts(p, isAdmin) {
  const c = (sql) => get(sql, p.id).n;
  return {
    ...p,
    counts: {
      nodes: c('SELECT COUNT(*) n FROM nodes WHERE project_id = ?'), racks: c('SELECT COUNT(*) n FROM racks WHERE project_id = ?'),
      devices: c('SELECT COUNT(*) n FROM devices WHERE project_id = ?'), antennas: c('SELECT COUNT(*) n FROM antennas WHERE project_id = ?'),
      radiolinks: c('SELECT COUNT(*) n FROM radiolinks WHERE project_id = ?'), poles: c('SELECT COUNT(*) n FROM poles WHERE project_id = ?'),
      cables: c("SELECT COUNT(*) n FROM fiber_elements WHERE kind = 'cable' AND project_id = ?"), fiber: c('SELECT COUNT(*) n FROM fiber_elements WHERE project_id = ?'),
    },
    ...(isAdmin ? { members: all('SELECT u.id, u.username, u.name, u.role FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY u.username', p.id) } : {}),
  };
}

const total = (p) => Object.values(p.counts).reduce((a, b) => a + b, 0);
const loadProject = (id) => {
  const p = get('SELECT * FROM projects WHERE id = ?', id);
  if (!p || !visible(p.id)) throw notFound('Proyecto');
  return p;
};

router.get('/projects', wrap((req, res) => {
  const ids = scope().accessible;
  const rows = ids.length ? all(`SELECT * FROM projects WHERE id IN (${ph(ids)}) ORDER BY name COLLATE NOCASE`, ...ids) : [];
  res.json(rows.map((p) => withCounts(p, req.user.role === 'admin')));
}));

function fields(b, partial) {
  const out = {};
  if (!partial || b.name !== undefined) {
    const name = String(b.name ?? '').trim().slice(0, 80);
    if (!name) throw bad('El proyecto necesita un nombre');
    out.name = name;
  }
  if (b.description !== undefined) out.description = String(b.description).trim().slice(0, 500);
  if (b.color !== undefined) { if (!COLOR.test(String(b.color))) throw bad('Color inválido'); out.color = String(b.color); }
  return out;
}

router.post('/projects', require_('write'), wrap((req, res) => {
  const d = fields(req.body || {}, false);
  if (get('SELECT 1 AS x FROM projects WHERE name = ? COLLATE NOCASE', d.name)) throw conflict('Ya existe un proyecto con ese nombre');
  let id;
  tx(() => {
    id = Number(run('INSERT INTO projects (name, description, color, created_by) VALUES (?,?,?,?)', d.name, d.description || '', d.color || '#38bdf8', req.user.username).lastInsertRowid);
    if (req.user.role !== 'admin') run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?,?)', id, req.user.id);
  });
  audit(req.user, 'crear', 'projects', id, `Creó el proyecto «${d.name}»`, null, null, id);
  req.scope.accessible.push(id);
  res.status(201).json(withCounts(get('SELECT * FROM projects WHERE id = ?', id), req.user.role === 'admin'));
}));

router.patch('/projects/:id', require_('write'), wrap((req, res) => {
  const p = loadProject(intParam(req.params.id));
  const d = fields(req.body || {}, true);
  if (d.name && get('SELECT 1 AS x FROM projects WHERE name = ? COLLATE NOCASE AND id <> ?', d.name, p.id)) throw conflict('Ya existe un proyecto con ese nombre');
  const cols = Object.keys(d);
  if (cols.length) run(`UPDATE projects SET ${cols.map((c) => `${c} = ?`).join(',')} WHERE id = ?`, ...cols.map((c) => d[c]), p.id);
  audit(req.user, 'modificar', 'projects', p.id, `Modificó el proyecto «${p.name}»`, null, null, p.id);
  res.json(withCounts(get('SELECT * FROM projects WHERE id = ?', p.id), req.user.role === 'admin'));
}));

// Compartir: reemplaza la lista de usuarios con acceso (solo administradores)
router.put('/projects/:id/members', require_('admin'), wrap((req, res) => {
  const p = loadProject(intParam(req.params.id));
  const ids = [...new Set((Array.isArray(req.body?.user_ids) ? req.body.user_ids : []).map(Number).filter(Number.isInteger))];
  const valid = ids.length ? all(`SELECT id FROM users WHERE id IN (${ph(ids)})`, ...ids).map((u) => u.id) : [];
  tx(() => {
    run('DELETE FROM project_members WHERE project_id = ?', p.id);
    for (const uid of valid) run('INSERT INTO project_members (project_id, user_id) VALUES (?,?)', p.id, uid);
  });
  audit(req.user, 'modificar', 'projects', p.id, `Actualizó los usuarios con acceso a «${p.name}» (${valid.length})`, null, null, p.id);
  res.json(withCounts(get('SELECT * FROM projects WHERE id = ?', p.id), true));
}));

// Fusionar: mueve todo el contenido a otro proyecto y elimina el de origen
router.post('/projects/:id/merge', require_('admin'), wrap((req, res) => {
  const p = loadProject(intParam(req.params.id));
  const into = loadProject(intParam(req.body?.into, 'into'));
  if (into.id === p.id) throw bad('Elija un proyecto de destino distinto');
  tx(() => {
    for (const t of TABLES) run(`UPDATE ${t} SET project_id = ? WHERE project_id = ?`, into.id, p.id);
    run('UPDATE audit_log SET project_id = ? WHERE project_id = ?', into.id, p.id);
    run('INSERT OR IGNORE INTO project_members (project_id, user_id) SELECT ?, user_id FROM project_members WHERE project_id = ?', into.id, p.id);
    run('DELETE FROM projects WHERE id = ?', p.id);
  });
  audit(req.user, 'modificar', 'projects', into.id, `Fusionó «${p.name}» dentro de «${into.name}»`, null, null, into.id);
  res.json({ ok: true, into: into.id });
}));

router.delete('/projects/:id', require_('admin'), wrap((req, res) => {
  const p = loadProject(intParam(req.params.id));
  if (get('SELECT COUNT(*) n FROM projects').n <= 1) throw conflict('Debe existir al menos un proyecto');
  const n = total(withCounts(p, false));
  if (n > 0) throw conflict(`El proyecto contiene ${n} elementos. Fusiónelo con otro proyecto o elimine su contenido primero.`);
  run('DELETE FROM projects WHERE id = ?', p.id);
  audit(req.user, 'eliminar', 'projects', p.id, `Eliminó el proyecto «${p.name}»`, null, null, null);
  res.json({ ok: true });
}));
