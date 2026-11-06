// Catálogos y definición de campos editables por entidad (única fuente de verdad del servidor)

export const STATUSES = ['operativo', 'degradado', 'fuera_de_servicio', 'pendiente'];
export const NODE_TYPES = ['principal', 'distribucion', 'torre', 'repetidor', 'nap', 'cliente', 'otro'];
export const DEVICE_TYPES = ['router', 'switch', 'olt', 'odf', 'patch_panel', 'organizer', 'ups', 'pdu', 'server', 'radio', 'onu', 'other'];
export const PORT_KINDS = ['rj45', 'sfp', 'sfp+', 'sfp28', 'qsfp+', 'pon', 'fiber', 'console', 'mgmt', 'power', 'usb', 'other'];
export const FIBER_KINDS = ['olt', 'pon', 'odf', 'cable', 'splitter', 'nap', 'closure', 'client'];
export const POLE_MATERIALS = ['concreto', 'madera', 'metal', 'otro'];
export const LOGICAL_TYPES = ['vlan', 'interfaz_virtual', 'troncal', 'red_ip', 'bridge', 'vpn', 'otro'];

const text = (v) => (v == null ? '' : String(v).trim());
const num = (v) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);
const int = (v) => (v === '' || v == null ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);
const date = (v) => (v === '' || v == null ? null : /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : NaN);
const oneOf = (list) => (v) => (list.includes(v) ? v : NaN);

export const ENTITIES = {
  nodes: {
    table: 'nodes', label: 'nodo', nameField: 'name',
    fields: {
      code: text, name: text, type: oneOf(NODE_TYPES), lat: num, lng: num, location: text, address: text,
      description: text, status: oneOf(STATUSES), installed_at: date, responsible: text,
    },
    required: ['code', 'name'],
    filters: ['type', 'status'],
    order: 'name',
  },
  racks: {
    table: 'racks', label: 'rack', nameField: 'name',
    fields: { node_id: int, name: text, units: int, notes: text },
    required: ['node_id', 'name'],
    filters: ['node_id'],
    order: 'name',
  },
  devices: {
    table: 'devices', label: 'equipo', nameField: 'name',
    fields: {
      node_id: int, rack_id: int, rack_u: int, u_height: int, name: text, type: oneOf(DEVICE_TYPES), brand: text,
      model: text, serial: text, ip: text, mac: text, firmware: text, location: text, status: oneOf(STATUSES),
      installed_at: date, notes: text,
    },
    required: ['name'],
    filters: ['node_id', 'rack_id', 'type', 'status'],
    order: 'name',
  },
  connections: {
    table: 'connections', label: 'conexión', nameField: 'id',
    fields: {
      layer: oneOf(['physical', 'logical']), a_device_id: int, a_port_id: int, b_device_id: int, b_port_id: int,
      conn_type: text, medium: text, cable_id: text, speed: text, vlan: text, network: text,
      status: oneOf(STATUSES), notes: text,
    },
    required: ['a_device_id', 'b_device_id'],
    filters: ['layer', 'a_device_id', 'b_device_id', 'status'],
    order: 'id',
  },
  fiber: {
    table: 'fiber_elements', label: 'elemento de fibra', nameField: 'name',
    fields: {
      kind: oneOf(FIBER_KINDS), name: text, code: text, parent_id: int, node_id: int, device_id: int, port_id: int,
      lat: num, lng: num, status: oneOf(STATUSES), notes: text,
    },
    required: ['kind', 'name'],
    filters: ['kind', 'parent_id', 'node_id', 'status'],
    order: 'id',
    json: { props: 'object', path: 'path' },
  },
  poles: {
    table: 'poles', label: 'poste', nameField: 'code',
    fields: { code: text, name: text, lat: num, lng: num, material: oneOf(POLE_MATERIALS), height_m: num, owner: text, status: oneOf(STATUSES), notes: text },
    required: ['lat', 'lng'],
    filters: ['material', 'status', 'owner'],
    order: 'id',
  },
  antennas: {
    table: 'antennas', label: 'antena', nameField: 'name',
    fields: {
      node_id: int, device_id: int, name: text, brand: text, model: text, ip: text, lat: num, lng: num,
      height_m: num, azimuth: num, freq_mhz: num, channel_width: text, tx_power_dbm: num, gain_dbi: num,
      polarization: text, capacity: text, role: text, status: oneOf(STATUSES), notes: text,
    },
    required: ['node_id', 'name'],
    filters: ['node_id', 'status'],
    order: 'name',
  },
  radiolinks: {
    table: 'radiolinks', label: 'radioenlace', nameField: 'name',
    fields: {
      name: text, link_type: oneOf(['PTP', 'PTMP']), a_antenna_id: int, b_antenna_id: int, freq_mhz: num,
      rssi_dbm: num, capacity: text, availability: text, installed_at: date, status: oneOf(STATUSES), notes: text,
    },
    required: ['name', 'a_antenna_id', 'b_antenna_id'],
    filters: ['link_type', 'status'],
    order: 'name',
  },
};

/** Valida y normaliza el cuerpo. Devuelve { data, errors }. partial=true para PATCH. */
export function sanitize(entity, body, partial) {
  const def = ENTITIES[entity];
  const data = {};
  const errors = [];
  for (const [key, fn] of Object.entries(def.fields)) {
    if (!(key in body)) continue;
    const v = fn(body[key]);
    if (typeof v === 'number' && Number.isNaN(v)) errors.push(`Valor inválido en "${key}"`);
    else data[key] = v;
  }
  for (const [key, shape] of Object.entries(def.json || {})) {
    if (body[key] === undefined) continue;
    let p = body[key];
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch { errors.push(`"${key}" no es JSON válido`); continue; } }
    if (shape === 'path') {
      if (p === null) { data[key] = null; continue; }
      const path = normalizePath(p);
      if (!path) errors.push('Trazado inválido: use una lista de puntos [lat, lng, poste?] (máx. 5000)');
      else data[key] = JSON.stringify(path);
    } else if (p && typeof p === 'object' && !Array.isArray(p)) data[key] = JSON.stringify(p);
    else errors.push(`"${key}" debe ser un objeto`);
  }
  if (!partial) {
    for (const r of def.required) {
      if (data[r] == null || data[r] === '') errors.push(`El campo "${r}" es obligatorio`);
    }
  }
  return { data, errors };
}

/** Valida un trazado: [[lat, lng, poleId|null], ...]. Devuelve null si no es válido. */
export function normalizePath(p) {
  if (!Array.isArray(p) || p.length > 5000) return null;
  const out = [];
  for (const pt of p) {
    if (!Array.isArray(pt) || pt.length < 2) return null;
    const lat = Number(pt[0]), lng = Number(pt[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const pid = pt[2] == null ? null : Number(pt[2]);
    if (pid !== null && !Number.isInteger(pid)) return null;
    out.push([Math.round(lat * 1e7) / 1e7, Math.round(lng * 1e7) / 1e7, pid]);
  }
  return out;
}
