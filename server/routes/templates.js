// Plantillas de equipo personalizadas (reutilizables al crear equipos)
import express from 'express';
import { all, get, run } from '../db.js';
import { require_ } from '../auth.js';
import { audit } from '../audit.js';
import { wrap, bad, notFound, intParam } from '../http.js';
import { DEVICE_TYPES, PORT_KINDS } from '../schema-meta.js';

export const router = express.Router();
const parse = (r) => { let groups = []; try { groups = JSON.parse(r.groups); } catch { /* vacío */ } return { ...r, groups }; };

router.get('/device-templates', wrap((_req, res) => res.json(all('SELECT * FROM device_templates ORDER BY label COLLATE NOCASE').map(parse))));

router.post('/device-templates', require_('write'), wrap((req, res) => {
  const b = req.body || {};
  const label = String(b.label || '').trim().slice(0, 80);
  if (!label) throw bad('La plantilla necesita un nombre');
  const type = DEVICE_TYPES.includes(b.type) ? b.type : 'other';
  const u = Math.min(Math.max(parseInt(b.u, 10) || 1, 1), 20);
  if (!Array.isArray(b.groups) || b.groups.length > 40) throw bad('Grupos de puertos inválidos');
  const groups = b.groups.map((g) => ({
    kind: PORT_KINDS.includes(g?.kind) ? g.kind : 'other', prefix: String(g?.prefix ?? '').slice(0, 24),
    count: Math.min(Math.max(parseInt(g?.count, 10) || 0, 0), 192), start: Math.min(Math.max(parseInt(g?.start, 10) || 0, 0), 999), speed: String(g?.speed ?? '').slice(0, 20),
  })).filter((g) => g.count > 0);
  const existing = get('SELECT id FROM device_templates WHERE label = ? COLLATE NOCASE', label);
  const vals = [label, type, String(b.brand || '').slice(0, 60), String(b.model || '').slice(0, 80), u, JSON.stringify(groups)];
  let id;
  if (existing) { id = existing.id; run('UPDATE device_templates SET label=?, type=?, brand=?, model=?, u=?, groups=? WHERE id=?', ...vals, id); }
  else id = Number(run('INSERT INTO device_templates (label, type, brand, model, u, groups, created_by) VALUES (?,?,?,?,?,?,?)', ...vals, req.user.username).lastInsertRowid);
  audit(req.user, existing ? 'modificar' : 'crear', 'devices', null, `Plantilla de equipo «${label}»`);
  res.status(201).json(parse(get('SELECT * FROM device_templates WHERE id = ?', id)));
}));

router.delete('/device-templates/:id', require_('write'), wrap((req, res) => {
  const id = intParam(req.params.id);
  const t = get('SELECT label FROM device_templates WHERE id = ?', id);
  if (!t) throw notFound('Plantilla');
  run('DELETE FROM device_templates WHERE id = ?', id);
  audit(req.user, 'eliminar', 'devices', null, `Eliminó la plantilla de equipo «${t.label}»`);
  res.json({ ok: true });
}));
