// CRUD de entidades con validación de dominio e historial de cambios
import express from 'express';
import { all, get, run, tx } from '../db.js';
import { require_ } from '../auth.js';
import { audit } from '../audit.js';
import { ENTITIES, sanitize } from '../schema-meta.js';
import { HttpError, bad, conflict, notFound, wrap, intParam, ph } from '../http.js';

export const router = express.Router();

// ---------- Consultas enriquecidas ----------
const CONN_SELECT = `
  SELECT c.*,
    da.name AS a_device_name, da.node_id AS a_node_id, na.name AS a_node_name, da.rack_id AS a_rack_id, pa.name AS a_port_name, pa.kind AS a_port_kind,
    db_.name AS b_device_name, db_.node_id AS b_node_id, nb.name AS b_node_name, db_.rack_id AS b_rack_id, pb.name AS b_port_name, pb.kind AS b_port_kind
  FROM connections c
  JOIN devices da ON da.id = c.a_device_id
  JOIN devices db_ ON db_.id = c.b_device_id
  LEFT JOIN nodes na ON na.id = da.node_id
  LEFT JOIN nodes nb ON nb.id = db_.node_id
  LEFT JOIN ports pa ON pa.id = c.a_port_id
  LEFT JOIN ports pb ON pb.id = c.b_port_id`;

export const connectionById = (id) => get(`${CONN_SELECT} WHERE c.id = ?`, id);

function row(entity, id) {
  const r = get(`SELECT * FROM ${ENTITIES[entity].table} WHERE id = ?`, id);
  if (!r) throw notFound(ENTITIES[entity].label[0].toUpperCase() + ENTITIES[entity].label.slice(1));
  return r;
}
const exists = (table, id, label) => {
  if (id != null && !get(`SELECT 1 AS x FROM ${table} WHERE id = ?`, id)) throw bad(`${label} inexistente (id ${id})`);
};

function withJson(def, r) {
  if (!r || !def.json) return r;
  for (const [key, shape] of Object.entries(def.json)) {
    if (typeof r[key] === 'string') {
      try { r[key] = JSON.parse(r[key]); } catch { r[key] = shape === 'path' ? null : {}; }
    }
  }
  return r;
}

/** Mantiene los trazados de cables al mover (lat/lng) o eliminar (null) un poste. */
function syncPolePaths(poleId, lat, lng) {
  for (const f of all('SELECT id, path FROM fiber_elements WHERE path IS NOT NULL')) {
    let path;
    try { path = JSON.parse(f.path); } catch { continue; }
    let touched = false;
    for (const pt of path) {
      if (pt[2] === poleId) { if (lat == null) pt[2] = null; else { pt[0] = lat; pt[1] = lng; } touched = true; }
    }
    if (touched) run('UPDATE fiber_elements SET path = ? WHERE id = ?', JSON.stringify(path), f.id);
  }
}

// ---------- Validaciones de dominio ----------
function validateRackPlacement(data, current) {
  const merged = { ...current, ...data };
  if (merged.rack_id == null) {
    data.rack_u = null;
    return;
  }
  const rack = get('SELECT * FROM racks WHERE id = ?', merged.rack_id);
  if (!rack) throw bad('Rack inexistente');
  if (merged.rack_u == null) throw bad('Indique la posición U dentro del rack');
  const bottom = merged.rack_u, top = merged.rack_u + (merged.u_height || 1) - 1;
  if (bottom < 1 || top > rack.units) throw bad(`El equipo no cabe: el rack tiene ${rack.units} U (ocuparía U${bottom}–U${top})`);
  const side = merged.rack_side || 'front';
  const others = all('SELECT id, name, rack_u, u_height, rack_side FROM devices WHERE rack_id = ? AND id <> ?', rack.id, current?.id ?? -1);
  for (const o of others) {
    const os = o.rack_side || 'front';
    if (side !== 'both' && os !== 'both' && side !== os) continue; // frente y atrás son independientes
    const ob = o.rack_u, ot = o.rack_u + o.u_height - 1;
    if (bottom <= ot && top >= ob) throw conflict(`La posición se solapa con "${o.name}" (U${ob}–U${ot}, ${os === 'both' ? 'frente y atrás' : os === 'rear' ? 'atrás' : 'frente'})`);
  }
  data.node_id = rack.node_id; // el equipo pertenece al nodo del rack
}

function validateConnection(data, current) {
  const m = { layer: 'physical', ...current, ...data };
  exists('devices', m.a_device_id, 'Equipo de origen');
  exists('devices', m.b_device_id, 'Equipo de destino');
  if (m.layer === 'physical') {
    if (m.a_device_id === m.b_device_id) throw bad('Una conexión física debe unir dos equipos distintos');
    if (!m.a_port_id || !m.b_port_id) throw bad('Una conexión física requiere puerto de origen y de destino');
  }
  for (const [pk, dk, lbl] of [['a_port_id', 'a_device_id', 'origen'], ['b_port_id', 'b_device_id', 'destino']]) {
    if (m[pk] != null) {
      const p = get('SELECT device_id FROM ports WHERE id = ?', m[pk]);
      if (!p) throw bad(`Puerto de ${lbl} inexistente`);
      if (p.device_id !== m[dk]) throw bad(`El puerto de ${lbl} no pertenece al equipo seleccionado`);
    }
  }
  if (m.layer === 'physical' && m.a_port_id === m.b_port_id) throw bad('Los dos extremos no pueden ser el mismo puerto');
}

function validateFiber(data, current) {
  const m = { ...current, ...data };
  exists('fiber_elements', m.parent_id, 'Elemento padre');
  exists('nodes', m.node_id, 'Nodo');
  exists('devices', m.device_id, 'Equipo');
  exists('ports', m.port_id, 'Puerto');
  if (current && m.parent_id != null) {
    if (m.parent_id === current.id) throw bad('Un elemento no puede ser su propio padre');
    const loop = get(
      `WITH RECURSIVE d(id) AS (SELECT id FROM fiber_elements WHERE parent_id = ? UNION SELECT f.id FROM fiber_elements f JOIN d ON f.parent_id = d.id)
       SELECT 1 AS x FROM d WHERE id = ?`, current.id, m.parent_id);
    if (loop) throw bad('El cambio crearía un ciclo en el árbol de fibra');
  }
}

function validateRadiolink(data, current) {
  const m = { ...current, ...data };
  exists('antennas', m.a_antenna_id, 'Antena de origen');
  exists('antennas', m.b_antenna_id, 'Antena de destino');
  if (m.a_antenna_id === m.b_antenna_id) throw bad('Las antenas de origen y destino deben ser distintas');
}

function validate(entity, data, current) {
  switch (entity) {
    case 'poles':
      if (data.lat != null && Math.abs(data.lat) > 90) throw bad('Latitud fuera de rango');
      if (data.lng != null && Math.abs(data.lng) > 180) throw bad('Longitud fuera de rango');
      break;
    case 'nodes':
      if (data.lat != null && (data.lat < -90 || data.lat > 90)) throw bad('Latitud fuera de rango');
      if (data.lng != null && (data.lng < -180 || data.lng > 180)) throw bad('Longitud fuera de rango');
      break;
    case 'racks': {
      exists('nodes', data.node_id ?? current?.node_id, 'Nodo');
      if (current && data.units != null) {
        const top = get('SELECT MAX(rack_u + u_height - 1) AS t FROM devices WHERE rack_id = ?', current.id)?.t || 0;
        if (data.units < top) throw conflict(`No se puede reducir a ${data.units} U: hay equipos hasta U${top}`);
      }
      break;
    }
    case 'devices':
      exists('nodes', data.node_id, 'Nodo');
      validateRackPlacement(data, current);
      break;
    case 'connections': validateConnection(data, current); break;
    case 'fiber': validateFiber(data, current); break;
    case 'antennas':
      exists('nodes', data.node_id ?? current?.node_id, 'Nodo');
      exists('devices', data.device_id, 'Equipo');
      break;
    case 'radiolinks': validateRadiolink(data, current); break;
    default: break;
  }
}

function friendlyDbError(e) {
  const msg = String(e?.message || '');
  if (/UNIQUE constraint failed: nodes\.code/.test(msg)) return conflict('Ya existe un nodo con ese código');
  if (/UNIQUE constraint failed: ports\.device_id, ports\.name/.test(msg)) return conflict('Ya existe un puerto con ese nombre en el equipo');
  if (/UNIQUE constraint failed|constraint failed: .*uq_conn/.test(msg) || /uq_conn_phys/.test(msg)) return conflict('Uno de los puertos ya tiene un cable físico conectado');
  if (/FOREIGN KEY/.test(msg)) return bad('Referencia a un registro inexistente');
  if (/CHECK constraint/.test(msg)) return bad('Valor fuera de los límites permitidos');
  return e;
}

// ---------- Rutas CRUD genéricas ----------
function mount(entity, path = entity) {
  const def = ENTITIES[entity];

  router.get(`/${path}`, wrap((req, res) => {
    const where = [], params = [];
    for (const f of def.filters) {
      if (req.query[f] !== undefined && req.query[f] !== '') { where.push(`${f} = ?`); params.push(req.query[f]); }
    }
    const rows = entity === 'connections'
      ? all(`${CONN_SELECT} ${where.length ? 'WHERE ' + where.map((w) => 'c.' + w).join(' AND ') : ''} ORDER BY c.id`, ...params)
      : all(`SELECT * FROM ${def.table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${def.order}`, ...params);
    res.json(rows.map((r) => withJson(def, r)));
  }));

  router.get(`/${path}/:id`, wrap((req, res) => {
    const id = intParam(req.params.id);
    const r = entity === 'connections' ? connectionById(id) : row(entity, id);
    if (!r) throw notFound(def.label);
    res.json(withJson(def, r));
  }));

  router.post(`/${path}`, require_('write'), wrap((req, res) => {
    const { data, errors } = sanitize(entity, req.body || {}, false);
    if (errors.length) throw bad(errors.join('; '));
    let id;
    try {
      tx(() => {
        validate(entity, data, null);
        if (entity === 'devices') data.u_height = data.u_height || 1;
        const cols = Object.keys(data);
        const r = run(`INSERT INTO ${def.table} (${cols.join(',')}) VALUES (${ph(cols)})`, ...cols.map((c) => data[c]));
        id = Number(r.lastInsertRowid);
        if (entity === 'devices') createPortGroups(id, req.body.port_groups);
        if (entity === 'poles' && !data.code) run('UPDATE poles SET code = ? WHERE id = ?', `P-${String(id).padStart(4, '0')}`, id);
      });
    } catch (e) { throw e instanceof HttpError ? e : friendlyDbError(e); }
    const created = entity === 'connections' ? connectionById(id) : row(entity, id);
    audit(req.user, 'crear', entity, id, `Creó ${def.label} «${created[def.nameField] ?? id}»`, null, created);
    res.status(201).json(withJson(def, created));
  }));

  router.patch(`/${path}/:id`, require_('update'), wrap((req, res) => {
    const id = intParam(req.params.id);
    const current = entity === 'connections' ? connectionById(id) : row(entity, id);
    if (!current) throw notFound(def.label);
    const { data, errors } = sanitize(entity, req.body || {}, true);
    if (errors.length) throw bad(errors.join('; '));

    // Los técnicos solo actualizan datos: no pueden reubicar ni reestructurar.
    if (req.user.role === 'technician') {
      const structural = ['lat', 'lng', 'path', 'node_id', 'rack_id', 'rack_u', 'u_height', 'rack_side', 'a_device_id', 'b_device_id', 'a_port_id', 'b_port_id', 'parent_id', 'a_antenna_id', 'b_antenna_id', 'layer', 'kind', 'units'];
      if (structural.some((k) => k in data && data[k] !== current[k])) {
        throw new HttpError(403, 'Su rol permite actualizar datos, no modificar la estructura (ubicación o conexiones)');
      }
    }
    if (!Object.keys(data).length) return res.json(withJson(def, current));
    try {
      tx(() => {
        validate(entity, data, current);
        const cols = Object.keys(data);
        run(`UPDATE ${def.table} SET ${cols.map((c) => `${c} = ?`).join(',')}, updated_at = datetime('now') WHERE id = ?`, ...cols.map((c) => data[c]), id);
        if (entity === 'poles' && ('lat' in data || 'lng' in data)) syncPolePaths(id, data.lat ?? current.lat, data.lng ?? current.lng);
      });
    } catch (e) { throw e instanceof HttpError ? e : friendlyDbError(e); }
    const updated = entity === 'connections' ? connectionById(id) : row(entity, id);
    audit(req.user, 'modificar', entity, id, `Modificó ${def.label} «${updated[def.nameField] ?? id}»`, changed(current, updated, true), changed(current, updated, false));
    res.json(withJson(def, updated));
  }));

  router.delete(`/${path}/:id`, require_('write'), wrap((req, res) => {
    const id = intParam(req.params.id);
    const current = row(entity, id);
    try { tx(() => { if (entity === 'poles') syncPolePaths(id, null, null); run(`DELETE FROM ${def.table} WHERE id = ?`, id); }); } catch (e) { throw friendlyDbError(e); }
    audit(req.user, 'eliminar', entity, id, `Eliminó ${def.label} «${current[def.nameField] ?? id}»`, current, null);
    res.json({ ok: true });
  }));
}

/** Devuelve solo los campos que cambiaron (before/after) para el historial. */
function changed(a, b, useA) {
  const out = {};
  for (const k of Object.keys(b)) {
    if (k === 'updated_at') continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = useA ? a[k] : b[k];
  }
  return out;
}

for (const e of Object.keys(ENTITIES)) mount(e);

// ---------- Puertos ----------
export function createPortGroups(deviceId, groups) {
  if (!Array.isArray(groups)) return;
  let total = 0;
  for (const g of groups) {
    const count = Number(g.count), start = g.start == null ? 1 : Number(g.start);
    if (!Number.isInteger(count) || count < 1 || count > 192) throw bad('Cantidad de puertos inválida (1–192)');
    if (!Number.isInteger(start)) throw bad('Número inicial de puertos inválido');
    const kind = String(g.kind || 'rj45');
    const prefix = String(g.prefix ?? '').slice(0, 24);
    const base = get('SELECT COALESCE(MAX(idx), 0) AS m FROM ports WHERE device_id = ?', deviceId).m;
    for (let i = 0; i < count; i++) {
      const name = `${prefix}${start + i}`;
      run('INSERT INTO ports (device_id, name, kind, idx, speed) VALUES (?,?,?,?,?)', deviceId, name, kind, base + i + 1, String(g.speed || ''));
    }
    total += count;
    if (total > 400) throw bad('Demasiados puertos para un equipo');
  }
}

router.post('/devices/:id/ports', require_('write'), wrap((req, res) => {
  const id = intParam(req.params.id);
  const dev = row('devices', id);
  try { tx(() => createPortGroups(id, [req.body])); } catch (e) { throw e instanceof HttpError ? e : friendlyDbError(e); }
  audit(req.user, 'modificar', 'devices', id, `Agregó ${req.body.count} puerto(s) a «${dev.name}»`);
  res.status(201).json(all('SELECT * FROM ports WHERE device_id = ? ORDER BY idx', id));
}));

router.patch('/ports/:id', require_('update'), wrap((req, res) => {
  const id = intParam(req.params.id);
  const p = get('SELECT * FROM ports WHERE id = ?', id);
  if (!p) throw notFound('Puerto');
  const label = req.body.label != null ? String(req.body.label).slice(0, 120) : p.label;
  const speed = req.body.speed != null ? String(req.body.speed).slice(0, 40) : p.speed;
  run('UPDATE ports SET label = ?, speed = ? WHERE id = ?', label, speed, id);
  audit(req.user, 'modificar', 'devices', p.device_id, `Actualizó puerto ${p.name}`, { label: p.label, speed: p.speed }, { label, speed });
  res.json(get('SELECT * FROM ports WHERE id = ?', id));
}));

router.delete('/ports/:id', require_('write'), wrap((req, res) => {
  const id = intParam(req.params.id);
  const p = get('SELECT * FROM ports WHERE id = ?', id);
  if (!p) throw notFound('Puerto');
  run('DELETE FROM ports WHERE id = ?', id);
  audit(req.user, 'modificar', 'devices', p.device_id, `Eliminó puerto ${p.name}`);
  res.json({ ok: true });
}));

// ---------- Detalle de equipo y rack (con puertos y conexiones) ----------
function portsWithLinks(deviceIds) {
  if (!deviceIds.length) return new Map();
  const ports = all(`SELECT * FROM ports WHERE device_id IN (${ph(deviceIds)}) ORDER BY device_id, idx`, ...deviceIds);
  const conns = all(`${CONN_SELECT} WHERE c.layer = 'physical' AND (c.a_device_id IN (${ph(deviceIds)}) OR c.b_device_id IN (${ph(deviceIds)}))`, ...deviceIds, ...deviceIds);
  const byPort = new Map();
  for (const c of conns) {
    if (c.a_port_id) byPort.set(c.a_port_id, { conn: c, side: 'a' });
    if (c.b_port_id) byPort.set(c.b_port_id, { conn: c, side: 'b' });
  }
  const out = new Map();
  for (const p of ports) {
    const l = byPort.get(p.id);
    let link = null;
    if (l) {
      const c = l.conn, a = l.side === 'a';
      link = {
        conn_id: c.id, status: c.status, cable_id: c.cable_id, medium: c.medium, speed: c.speed,
        remote_device_id: a ? c.b_device_id : c.a_device_id,
        remote_device_name: a ? c.b_device_name : c.a_device_name,
        remote_port_id: a ? c.b_port_id : c.a_port_id,
        remote_port_name: a ? c.b_port_name : c.a_port_name,
        remote_node_id: a ? c.b_node_id : c.a_node_id,
        remote_node_name: a ? c.b_node_name : c.a_node_name,
        remote_rack_id: a ? c.b_rack_id : c.a_rack_id,
      };
    }
    if (!out.has(p.device_id)) out.set(p.device_id, []);
    out.get(p.device_id).push({ ...p, link });
  }
  return out;
}

router.get('/devices/:id/full', wrap((req, res) => {
  const id = intParam(req.params.id);
  const dev = row('devices', id);
  const node = dev.node_id ? get('SELECT id, name, code FROM nodes WHERE id = ?', dev.node_id) : null;
  const rack = dev.rack_id ? get('SELECT id, name, units FROM racks WHERE id = ?', dev.rack_id) : null;
  const logical = all(`${CONN_SELECT} WHERE c.layer = 'logical' AND (c.a_device_id = ? OR c.b_device_id = ?)`, id, id);
  res.json({ ...dev, node, rack, ports: portsWithLinks([id]).get(id) || [], logical });
}));

router.get('/racks/:id/full', wrap((req, res) => {
  const id = intParam(req.params.id);
  const rack = row('racks', id);
  const devices = all('SELECT * FROM devices WHERE rack_id = ? ORDER BY rack_u', id);
  const ports = portsWithLinks(devices.map((d) => d.id));
  res.json({ ...rack, devices: devices.map((d) => ({ ...d, ports: ports.get(d.id) || [] })) });
}));

router.get('/nodes/:id/full', wrap((req, res) => {
  const id = intParam(req.params.id);
  const node = row('nodes', id);
  const racks = all('SELECT * FROM racks WHERE node_id = ? ORDER BY name', id);
  const devices = all(
    `SELECT d.*, (SELECT COUNT(*) FROM ports p WHERE p.device_id = d.id) AS port_count,
            (SELECT COUNT(*) FROM connections c WHERE c.layer='physical' AND (c.a_device_id = d.id OR c.b_device_id = d.id)) AS conn_count
     FROM devices d WHERE d.node_id = ? ORDER BY d.name`, id);
  const antennas = all('SELECT * FROM antennas WHERE node_id = ? ORDER BY name', id);
  res.json({ ...node, racks, devices, antennas });
}));

/** Conexiones relacionadas con un nodo (para topología). */
router.get('/nodes/:id/connections', wrap((req, res) => {
  const id = intParam(req.params.id);
  row('nodes', id);
  res.json(all(`${CONN_SELECT} WHERE da.node_id = ? OR db_.node_id = ? ORDER BY c.id`, id, id));
}));
