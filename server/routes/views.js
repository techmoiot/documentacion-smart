// Vistas agregadas: mapa, búsqueda global, análisis de impacto, estadísticas, historial, metadatos
import express from 'express';
import { all, get } from '../db.js';
import { require_ } from '../auth.js';
import { wrap, bad, notFound, intParam, ph } from '../http.js';
import { STATUSES, NODE_TYPES, DEVICE_TYPES, PORT_KINDS, FIBER_KINDS, LOGICAL_TYPES, POLE_MATERIALS } from '../schema-meta.js';
import { TILE_URL, TILE_ATTRIBUTION, SAT_TILE_URL, SAT_ATTRIBUTION } from '../config.js';
import { connectionById } from './crud.js';
import { readVersion } from '../version.js';
import { selectedFilter, accessibleFilter, visible, scope } from '../scope.js';

export const router = express.Router();

const VERSION = readVersion();
router.get('/meta', wrap((_req, res) => {
  res.json({
    statuses: STATUSES, nodeTypes: NODE_TYPES, deviceTypes: DEVICE_TYPES, portKinds: PORT_KINDS,
    fiberKinds: FIBER_KINDS, logicalTypes: LOGICAL_TYPES, tileUrl: TILE_URL, tileAttribution: TILE_ATTRIBUTION, satUrl: SAT_TILE_URL, satAttribution: SAT_ATTRIBUTION, poleMaterials: POLE_MATERIALS, version: VERSION,
  });
}));

router.get('/stats', wrap((_req, res) => {
  const f = selectedFilter();
  const c = (table, extra = '') => get(`SELECT COUNT(*) n FROM ${table} WHERE ${f.sql}${extra}`, ...f.params).n;
  res.json({
    nodes: c('nodes'), racks: c('racks'), devices: c('devices'),
    ports: get(`SELECT COUNT(*) n FROM ports WHERE device_id IN (SELECT id FROM devices WHERE ${f.sql})`, ...f.params).n,
    connections: c('connections'), antennas: c('antennas'), radiolinks: c('radiolinks'), fiberElements: c('fiber_elements'), poles: c('poles'),
    clients: c('fiber_elements', " AND kind = 'client'"),
    problems: all(
      `SELECT 'nodo' AS entity, 'nodes' AS type, id, name, status FROM nodes WHERE ${f.sql} AND status <> 'operativo'
       UNION ALL SELECT 'equipo', 'devices', id, name, status FROM devices WHERE ${f.sql} AND status NOT IN ('operativo','pendiente')
       UNION ALL SELECT 'radioenlace', 'radiolinks', id, name, status FROM radiolinks WHERE ${f.sql} AND status NOT IN ('operativo','pendiente')
       UNION ALL SELECT 'fibra', 'fiber', id, name, status FROM fiber_elements WHERE ${f.sql} AND status NOT IN ('operativo','pendiente')
       LIMIT 50`, ...f.params, ...f.params, ...f.params, ...f.params),
  });
}));

// Datos para el mapa geográfico
router.get('/map', wrap((_req, res) => {
  const f = (c) => selectedFilter(c);
  const nodes = all(
    `SELECT n.id, n.project_id, n.code, n.name, n.type, n.status, n.lat, n.lng, n.address,
       (SELECT COUNT(*) FROM devices d WHERE d.node_id = n.id) AS device_count,
       (SELECT COUNT(*) FROM antennas a WHERE a.node_id = n.id) AS antenna_count
     FROM nodes n WHERE ${f('n.project_id').sql}`, ...f('n.project_id').params);
  const radiolinks = all(
    `SELECT r.id, r.project_id, r.name, r.link_type, r.status, r.freq_mhz, r.rssi_dbm, r.capacity, r.a_antenna_id, r.b_antenna_id,
       aa.name AS a_name, ab.name AS b_name,
       COALESCE(aa.lat, na.lat) AS a_lat, COALESCE(aa.lng, na.lng) AS a_lng, aa.node_id AS a_node_id, na.name AS a_node_name,
       COALESCE(ab.lat, nb.lat) AS b_lat, COALESCE(ab.lng, nb.lng) AS b_lng, ab.node_id AS b_node_id, nb.name AS b_node_name
     FROM radiolinks r
     JOIN antennas aa ON aa.id = r.a_antenna_id JOIN nodes na ON na.id = aa.node_id
     JOIN antennas ab ON ab.id = r.b_antenna_id JOIN nodes nb ON nb.id = ab.node_id
     WHERE ${f('r.project_id').sql}`, ...f('r.project_id').params);
  // Fibra: cada elemento con coordenadas propias o las de su nodo
  const fiber = all(
    `SELECT f.id, f.project_id, f.kind, f.name, f.parent_id, f.status, f.props, f.path,
       COALESCE(f.lat, n.lat) AS lat, COALESCE(f.lng, n.lng) AS lng
     FROM fiber_elements f LEFT JOIN nodes n ON n.id = f.node_id WHERE ${f('f.project_id').sql}`, ...f('f.project_id').params);
  for (const e of fiber) {
    try { e.props = JSON.parse(e.props); } catch { e.props = {}; }
    try { e.path = e.path ? JSON.parse(e.path) : null; } catch { e.path = null; }
  }
  const poles = all(`SELECT id, project_id, code, lat, lng, material, status FROM poles WHERE ${f('project_id').sql}`, ...f('project_id').params);
  // Conexiones entre nodos (enlaces físicos que cruzan sitios)
  const nodeLinks = all(
    `SELECT c.id, c.status, c.medium, c.speed, c.cable_id, da.node_id AS a_node_id, db_.node_id AS b_node_id,
            da.name AS a_device_name, db_.name AS b_device_name
     FROM connections c JOIN devices da ON da.id = c.a_device_id JOIN devices db_ ON db_.id = c.b_device_id
     WHERE c.layer = 'physical' AND da.node_id IS NOT NULL AND db_.node_id IS NOT NULL AND da.node_id <> db_.node_id AND ${f('c.project_id').sql}`, ...f('c.project_id').params);
  res.json({ nodes, radiolinks, fiber, nodeLinks, poles });
}));

// Planta externa: postes + elementos de fibra georreferenciados con su trazado
router.get('/planta', wrap((_req, res) => {
  const pf = selectedFilter('project_id'), ff = selectedFilter('f.project_id');
  const poles = all(`SELECT * FROM poles WHERE ${pf.sql}`, ...pf.params);
  const elements = all(
    `SELECT f.id, f.project_id, f.kind, f.name, f.code, f.parent_id, f.node_id, f.device_id, f.status, f.props, f.path, f.notes,
       f.lat AS own_lat, f.lng AS own_lng, COALESCE(f.lat, n.lat) AS lat, COALESCE(f.lng, n.lng) AS lng
     FROM fiber_elements f LEFT JOIN nodes n ON n.id = f.node_id WHERE ${ff.sql}`, ...ff.params);
  for (const f of elements) {
    try { f.props = JSON.parse(f.props); } catch { f.props = {}; }
    try { f.path = f.path ? JSON.parse(f.path) : null; } catch { f.path = null; }
  }
  const nodes = all(`SELECT id, project_id, code, name, type, status, lat, lng FROM nodes WHERE lat IS NOT NULL AND ${pf.sql}`, ...pf.params);
  res.json({ poles, elements, nodes });
}));

// ---------- Búsqueda global ----------
router.get('/search', wrap((req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
  const L = "LIKE ? ESCAPE '\\'";
  const out = [];
  const pf = (c) => selectedFilter(c);
  for (const r of all(`SELECT id, code, name, type, status FROM nodes WHERE ${pf('project_id').sql} AND (name ${L} OR code ${L} OR address ${L} OR location ${L}) LIMIT 15`, ...pf('project_id').params, like, like, like, like))
    out.push({ type: 'nodo', id: r.id, title: r.name, sub: `${r.code} · ${r.type}`, status: r.status, href: `#/nodo/${r.id}` });
  for (const r of all(
    `SELECT d.id, d.name, d.brand, d.model, d.serial, d.ip, d.mac, d.status, d.node_id, d.rack_id, n.name AS node_name
     FROM devices d LEFT JOIN nodes n ON n.id = d.node_id
     WHERE ${pf('d.project_id').sql} AND (d.name ${L} OR d.ip ${L} OR d.model ${L} OR d.serial ${L} OR d.mac ${L} OR d.brand ${L} OR n.name ${L}) LIMIT 30`,
    ...pf('d.project_id').params, like, like, like, like, like, like, like))
    out.push({
      type: 'equipo', id: r.id, title: r.name,
      sub: [r.brand, r.model, r.ip, r.serial && `S/N ${r.serial}`, r.node_name].filter(Boolean).join(' · '),
      status: r.status,
      href: r.node_id && r.rack_id ? `#/nodo/${r.node_id}/rack/${r.rack_id}?device=${r.id}` : `#/inventario?device=${r.id}`,
    });
  for (const r of all(`SELECT a.id, a.name, a.ip, a.status, a.node_id, n.name AS node_name FROM antennas a JOIN nodes n ON n.id = a.node_id WHERE ${pf('a.project_id').sql} AND (a.name ${L} OR a.ip ${L} OR a.model ${L}) LIMIT 15`, ...pf('a.project_id').params, like, like, like))
    out.push({ type: 'antena', id: r.id, title: r.name, sub: [r.ip, r.node_name].filter(Boolean).join(' · '), status: r.status, href: `#/radioenlaces?antenna=${r.id}` });
  for (const r of all(`SELECT id, name, link_type, status FROM radiolinks WHERE ${pf('project_id').sql} AND name ${L} LIMIT 10`, ...pf('project_id').params, like))
    out.push({ type: 'radioenlace', id: r.id, title: r.name, sub: r.link_type, status: r.status, href: `#/radioenlaces?link=${r.id}` });
  for (const r of all(`SELECT id, code, name, owner, status FROM poles WHERE ${pf('project_id').sql} AND (code ${L} OR name ${L} OR owner ${L}) LIMIT 10`, ...pf('project_id').params, like, like, like))
    out.push({ type: 'poste', id: r.id, title: r.code, sub: [r.name, r.owner].filter(Boolean).join(' · '), status: r.status, href: `#/planta?pole=${r.id}` });
  for (const r of all(`SELECT id, kind, name, code, status FROM fiber_elements WHERE ${pf('project_id').sql} AND (name ${L} OR code ${L} OR props ${L}) LIMIT 20`, ...pf('project_id').params, like, like, like))
    out.push({ type: r.kind === 'client' ? 'cliente' : 'fibra', id: r.id, title: r.name, sub: [r.kind, r.code].filter(Boolean).join(' · '), status: r.status, href: `#/fibra?sel=${r.id}` });
  res.json(out.slice(0, 60));
}));

// ---------- Impacto de una falla ----------
function descendants(rootIds) {
  if (!rootIds.length) return [];
  return all(
    `WITH RECURSIVE d(id) AS (
       SELECT id FROM fiber_elements WHERE id IN (${ph(rootIds)})
       UNION SELECT f.id FROM fiber_elements f JOIN d ON f.parent_id = d.id)
     SELECT f.id, f.kind, f.name, f.code, f.status, f.parent_id, f.project_id FROM fiber_elements f WHERE f.id IN (SELECT id FROM d) ORDER BY f.id`, ...rootIds);
}

function impactOf(type, id) {
  const impact = { target: null, devices: [], connections: [], radiolinks: [], fiber: [], clients: 0, nodes: [] };
  let deviceIds = [], antennaIds = [], fiberRoots = [], nodeIds = [];

  if (type === 'device') {
    const d = get('SELECT id, name, node_id, project_id FROM devices WHERE id = ?', id);
    if (!d || !visible(d.project_id)) throw notFound('Equipo');
    impact.target = { type, id, name: d.name };
    deviceIds = [id];
    antennaIds = all('SELECT id FROM antennas WHERE device_id = ?', id).map((r) => r.id);
    fiberRoots = all('SELECT id FROM fiber_elements WHERE device_id = ?', id).map((r) => r.id);
  } else if (type === 'node') {
    const n = get('SELECT id, name, project_id FROM nodes WHERE id = ?', id);
    if (!n || !visible(n.project_id)) throw notFound('Nodo');
    impact.target = { type, id, name: n.name };
    deviceIds = all('SELECT id FROM devices WHERE node_id = ?', id).map((r) => r.id);
    antennaIds = all('SELECT id FROM antennas WHERE node_id = ?', id).map((r) => r.id);
    fiberRoots = all('SELECT id FROM fiber_elements WHERE node_id = ? AND (parent_id IS NULL OR parent_id NOT IN (SELECT id FROM fiber_elements WHERE node_id = ?))', id, id).map((r) => r.id);
    nodeIds = [id];
  } else if (type === 'fiber') {
    const f = get('SELECT id, name, project_id FROM fiber_elements WHERE id = ?', id);
    if (!f || !visible(f.project_id)) throw notFound('Elemento de fibra');
    impact.target = { type, id, name: f.name };
    fiberRoots = [id];
  } else if (type === 'radiolink') {
    const r = get('SELECT * FROM radiolinks WHERE id = ?', id);
    if (!r || !visible(r.project_id)) throw notFound('Radioenlace');
    impact.target = { type, id, name: r.name };
    antennaIds = [r.a_antenna_id, r.b_antenna_id];
  } else if (type === 'antenna') {
    const a = get('SELECT id, name, project_id FROM antennas WHERE id = ?', id);
    if (!a || !visible(a.project_id)) throw notFound('Antena');
    impact.target = { type, id, name: a.name };
    antennaIds = [id];
  } else throw bad('Tipo de objetivo inválido');

  const touched = new Set(nodeIds);

  // Conexiones y equipos vecinos (dependencias directas)
  if (deviceIds.length) {
    const own = new Set(deviceIds);
    const conns = all(
      `SELECT c.id FROM connections c WHERE c.a_device_id IN (${ph(deviceIds)}) OR c.b_device_id IN (${ph(deviceIds)})`, ...deviceIds, ...deviceIds);
    for (const { id: cid } of conns) {
      const c = connectionById(cid);
      if (!c) continue;
      impact.connections.push(c);
      for (const [did, dname, nid, nname, port] of [
        [c.a_device_id, c.a_device_name, c.a_node_id, c.a_node_name, c.a_port_name],
        [c.b_device_id, c.b_device_name, c.b_node_id, c.b_node_name, c.b_port_name]]) {
        if (!own.has(did) && !impact.devices.find((x) => x.id === did)) {
          impact.devices.push({ id: did, name: dname, node: nname, via: `${c.layer === 'logical' ? 'lógica' : 'física'} · puerto ${port || '—'}` });
        }
        if (nid) touched.add(nid);
      }
    }
  }

  // Radioenlaces de las antenas involucradas
  if (antennaIds.length) {
    const links = all(
      `SELECT r.id, r.project_id, r.name, r.link_type, r.status, aa.name AS a_name, ab.name AS b_name, na.id AS a_node_id, na.name AS a_node, nb.id AS b_node_id, nb.name AS b_node
       FROM radiolinks r JOIN antennas aa ON aa.id = r.a_antenna_id JOIN antennas ab ON ab.id = r.b_antenna_id
       JOIN nodes na ON na.id = aa.node_id JOIN nodes nb ON nb.id = ab.node_id
       WHERE r.a_antenna_id IN (${ph(antennaIds)}) OR r.b_antenna_id IN (${ph(antennaIds)})`, ...antennaIds, ...antennaIds);
    impact.radiolinks = links.filter((l) => visible(l.project_id));
    links.length = 0; links.push(...impact.radiolinks);
    for (const l of links) { touched.add(l.a_node_id); touched.add(l.b_node_id); }
    // Equipos asociados a las antenas
    const devs = all(`SELECT d.id, d.name, n.name AS node FROM antennas a JOIN devices d ON d.id = a.device_id LEFT JOIN nodes n ON n.id = d.node_id WHERE a.id IN (${ph(antennaIds)})`, ...antennaIds);
    for (const d of devs) if (!deviceIds.includes(d.id) && !impact.devices.find((x) => x.id === d.id)) impact.devices.push({ ...d, via: 'radio' });
  }

  // Fibra: todo lo que cuelga de los elementos afectados
  if (fiberRoots.length) {
    impact.fiber = descendants(fiberRoots).filter((f) => visible(f.project_id));
    impact.clients = impact.fiber.filter((f) => f.kind === 'client').length;
  }

  const target = nodeIds[0];
  impact.nodes = touched.size
    ? all(`SELECT id, code, name, status, project_id FROM nodes WHERE id IN (${ph([...touched])})`, ...touched).filter((n) => n.id !== target && visible(n.project_id))
    : [];
  return impact;
}

router.get('/impact/:type/:id', wrap((req, res) => {
  res.json(impactOf(req.params.type, intParam(req.params.id)));
}));

// ---------- Historial ----------
router.get('/audit', wrap((req, res) => {
  const where = [], params = [];
  if (req.query.entity_type) { where.push('entity_type = ?'); params.push(String(req.query.entity_type)); }
  if (req.query.entity_id) { where.push('entity_id = ?'); params.push(intParam(req.query.entity_id, 'entity_id')); }
  if (req.query.username) { where.push('username = ?'); params.push(String(req.query.username)); }
  // Historial de una entidad concreta: todos los proyectos accesibles; listado general: proyectos seleccionados
  const pf = req.query.entity_id ? accessibleFilter('project_id') : selectedFilter('project_id');
  where.push(req.user.role === 'admin' && !req.query.entity_id && scope().selected.length === scope().accessible.length ? `(${pf.sql} OR project_id IS NULL)` : pf.sql);
  params.push(...pf.params);
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = all(
    `SELECT id, at, username, action, entity_type, entity_id, summary, before, after FROM audit_log
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json(rows.map((r) => ({ ...r, before: r.before ? JSON.parse(r.before) : null, after: r.after ? JSON.parse(r.after) : null })));
}));

// Solo administradores pueden ver todo el historial por usuario; el resto accede por entidad.
router.get('/audit/users', require_('admin'), wrap((_req, res) => {
  res.json(all('SELECT DISTINCT username FROM audit_log ORDER BY username').map((r) => r.username));
}));
