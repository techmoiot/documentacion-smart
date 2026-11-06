// Importación de KMZ/KML (p. ej. migración desde OZmap): postes, cables, cajas, splitters y clientes
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { all, get, run, tx } from '../db.js';
import { require_ } from '../auth.js';
import { audit } from '../audit.js';
import { wrap, bad, conflict } from '../http.js';
import { scope, pickProject } from '../scope.js';
import { readKmlText, parseKml } from '../kml.js';

export const router = express.Router();

const POINT_KINDS = ['pole', 'nap', 'closure', 'splitter', 'client', 'ignore'];
const LINE_KINDS = ['cable', 'ignore'];
const cache = new Map(); // token → { uid, features, ts }
const TTL = 15 * 60 * 1000;
const prune = () => { const now = Date.now(); for (const [k, v] of cache) if (now - v.ts > TTL) cache.delete(k); };

function suggest(folder, geom) {
  if (geom === 'Polygon') return 'ignore';
  if (geom === 'LineString') return /limite|límite|zona|area|área|boundary/i.test(folder) ? 'ignore' : 'cable';
  const t = folder.toLowerCase();
  if (/poste|pole|pilar/.test(t)) return 'pole';
  if (/splitter|divisor|\bspl\b/.test(t)) return 'splitter';
  if (/\bceo\b|\bcdo\b|empalme|splice|closure|fosc|mufa|manga/.test(t)) return 'closure';
  if (/\bcto\b|\bnap\b|caja|terminal|\bbox\b|\bhub\b/.test(t)) return 'nap';
  if (/client|customer|abonado|usuario|\bonu\b|\bont\b/.test(t)) return 'client';
  return 'ignore';
}

const M_LAT = 111320;
const dist = (a, b) => Math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LAT * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180));
const CELL = 0.00006; // ≈ 6.7 m
const cellKey = (lat, lng) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
class Grid {
  constructor() { this.m = new Map(); }
  add(item) { const k = cellKey(item.lat, item.lng); (this.m.get(k) || this.m.set(k, []).get(k)).push(item); }
  near(lat, lng, radius) {
    const cx = Math.floor(lat / CELL), cy = Math.floor(lng / CELL);
    let best = null, bd = radius;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const it of this.m.get(`${cx + dx}:${cy + dy}`) || []) { const d = dist([lat, lng], [it.lat, it.lng]); if (d <= bd) { bd = d; best = it; } }
    }
    return best;
  }
}

function summarize(features) {
  const groups = new Map();
  for (const f of features) {
    const key = `${f.folder}|${f.geom}`;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { key, folder: f.folder || '(sin carpeta)', geom: f.geom, count: 0, samples: [], suggested: suggest(f.folder, f.geom) });
    g.count++;
    if (g.samples.length < 3 && f.name) g.samples.push(f.name);
  }
  return [...groups.values()].sort((a, b) => a.folder.localeCompare(b.folder));
}

router.post('/import/kmz/preview', require_('write'), express.raw({ type: () => true, limit: '80mb' }), wrap((req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Archivo vacío');
  let parsed;
  try { parsed = parseKml(readKmlText(req.body)); } catch (e) { throw bad(e.message || 'No se pudo leer el archivo'); }
  if (!parsed.features.length) throw bad('El archivo no contiene elementos con coordenadas');
  prune();
  const token = crypto.randomBytes(16).toString('hex');
  cache.set(token, { uid: req.user.id, features: parsed.features, docName: parsed.docName || '', name: path.basename(String(req.query.name || 'archivo.kmz')).slice(0, 100), ts: Date.now() });
  res.json({ token, name: parsed.docName, suggestedProject: (parsed.docName || path.basename(String(req.query.name || 'Proyecto'), path.extname(String(req.query.name || '')))).trim().slice(0, 80), total: parsed.features.length, groups: summarize(parsed.features) });
}));

const fibersOf = (txt) => {
  const m = /\b(\d{1,3})\s*(?:f\b|fo\b|fibras?|hilos?|fibers?|cores?|f(?=[\s_-]|$))/i.exec(txt);
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= 864 ? n : 0;
};

router.post('/import/kmz/commit', require_('write'), wrap((req, res) => {
  prune();
  const job = cache.get(String(req.body?.token || ''));
  if (!job || job.uid !== req.user.id) throw bad('La vista previa expiró; suba el archivo de nuevo');
  const mapping = req.body?.mapping && typeof req.body.mapping === 'object' ? req.body.mapping : {};
  const kindOf = (f) => {
    const k = mapping[`${f.folder}|${f.geom}`];
    if (f.geom === 'Point') return POINT_KINDS.includes(k) ? k : 'ignore';
    if (f.geom === 'LineString') return LINE_KINDS.includes(k) ? k : 'ignore';
    return 'ignore';
  };
  // Proyecto de destino: uno nuevo (por nombre) o uno existente
  let projectId;
  const newName = String(req.body?.new_project || '').trim().slice(0, 80);
  if (newName) {
    if (get('SELECT 1 AS x FROM projects WHERE name = ? COLLATE NOCASE', newName)) throw conflict('Ya existe un proyecto con ese nombre; elíjalo de la lista');
    projectId = Number(run('INSERT INTO projects (name, description, created_by) VALUES (?,?,?)', newName, `Importado de ${job.name}`, req.user.username).lastInsertRowid);
    if (req.user.role !== 'admin') run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?,?)', projectId, req.user.id);
    scope().accessible.push(projectId);
  } else projectId = pickProject(req.body?.project_id);
  const r = { project: projectId, poles: 0, polesExisting: 0, naps: 0, closures: 0, splitters: 0, clients: 0, cables: 0, skipped: 0, duplicates: 0, linkedVertices: 0 };

  tx(() => {
    const grid = new Grid();
    const codes = new Set();
    for (const p of all('SELECT id, code, lat, lng FROM poles WHERE project_id = ?', projectId)) { grid.add({ id: p.id, lat: p.lat, lng: p.lng }); codes.add(p.code); }
    const existing = new Map(); // `${kind}|${name}` → [[lat,lng]]
    for (const e of all('SELECT kind, name, lat, lng, path FROM fiber_elements WHERE project_id = ?', projectId)) {
      let pt = e.lat != null ? [e.lat, e.lng] : null;
      if (!pt && e.path) { try { const p = JSON.parse(e.path); pt = p?.[0]; } catch { /* sin trazado */ } }
      if (pt) { const k = `${e.kind}|${e.name}`; (existing.get(k) || existing.set(k, []).get(k)).push(pt); }
    }
    const isDup = (kind, name, pt) => (existing.get(`${kind}|${name}`) || []).some((q) => dist(pt, q) < 2);
    const remember = (kind, name, pt) => { const k = `${kind}|${name}`; (existing.get(k) || existing.set(k, []).get(k)).push(pt); };

    const feats = job.features.map((f) => ({ f, kind: kindOf(f) }));
    // 1) postes primero, para poder anclar cables y cajas
    for (const { f, kind } of feats) {
      if (kind !== 'pole') continue;
      const [lat, lng] = f.coords[0];
      if (grid.near(lat, lng, 1)) { r.polesExisting++; continue; }
      let code = String(f.name || '').trim().slice(0, 40);
      if (!code || codes.has(code)) code = '';
      const id = Number(run('INSERT INTO poles (code, name, lat, lng, notes, project_id) VALUES (?,?,?,?,?,?)', code, '', lat, lng, String(f.description || '').slice(0, 500), projectId).lastInsertRowid);
      if (!code) { code = `P-${String(id).padStart(4, '0')}`; run('UPDATE poles SET code = ? WHERE id = ?', code, id); }
      codes.add(code); grid.add({ id, lat, lng }); r.poles++;
    }
    // 2) cajas, splitters, clientes y cables
    const ins = (kind, name, lat, lng, pathJson, props, notes) =>
      run('INSERT INTO fiber_elements (kind, name, lat, lng, path, props, notes, project_id) VALUES (?,?,?,?,?,?,?,?)', kind, name, lat, lng, pathJson, JSON.stringify(props), notes, projectId);
    for (const { f, kind } of feats) {
      if (kind === 'ignore') { r.skipped++; continue; }
      if (kind === 'pole') continue;
      const name = String(f.name || '').trim().slice(0, 80) || (kind === 'cable' ? 'Cable importado' : 'Elemento importado');
      const notes = String(f.description || '').slice(0, 500);
      if (kind === 'cable') {
        if (f.coords.length < 2) { r.skipped++; continue; }
        const pts = f.coords.slice(0, 5000);
        if (isDup('cable', name, pts[0])) { r.duplicates++; continue; }
        const pth = pts.map(([lat, lng]) => { const p = grid.near(lat, lng, 3); if (p) { r.linkedVertices++; return [p.lat, p.lng, p.id]; } return [Math.round(lat * 1e7) / 1e7, Math.round(lng * 1e7) / 1e7, null]; });
        let len = 0; for (let i = 1; i < pth.length; i++) len += dist(pth[i - 1], pth[i]);
        const props = { longitud_m: Math.round(len), importado: job.name };
        const fib = fibersOf(`${name} ${f.folder}`) || fibersOf(f.description);
        if (fib) props.fibras_total = fib;
        ins('cable', name, null, null, JSON.stringify(pth), props, notes);
        remember('cable', name, pts[0]); r.cables++;
      } else {
        const [lat, lng] = f.coords[0];
        if (isDup(kind, name, [lat, lng])) { r.duplicates++; continue; }
        const near = grid.near(lat, lng, 4);
        const props = { importado: job.name };
        if (near) props.poste_id = near.id;
        ins(kind, name, lat, lng, null, props, notes);
        remember(kind, name, [lat, lng]);
        r[{ nap: 'naps', closure: 'closures', splitter: 'splitters', client: 'clients' }[kind]]++;
      }
    }
  });

  cache.delete(String(req.body.token));
  const summary = `Importó «${job.name}»: ${r.poles} postes, ${r.cables} cables, ${r.naps} NAP, ${r.closures} cajas de empalme, ${r.splitters} splitters, ${r.clients} clientes`;
  audit(req.user, 'crear', 'poles', null, summary, null, null, projectId);
  res.json(r);
}));
