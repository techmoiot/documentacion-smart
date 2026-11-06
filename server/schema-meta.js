// Catálogos y definición de campos editables por entidad (única fuente de verdad del servidor)

export const STATUSES = ['operativo', 'degradado', 'fuera_de_servicio', 'pendiente'];
export const NODE_TYPES = ['principal', 'distribucion', 'torre', 'repetidor', 'nap', 'cliente', 'otro'];
export const DEVICE_TYPES = ['router', 'switch', 'olt', 'odf', 'patch_panel', 'organizer', 'ups', 'pdu', 'server', 'radio', 'onu', 'other'];
export const PORT_KINDS = ['rj45', 'sfp', 'sfp+', 'sfp28', 'qsfp+', 'pon', 'fiber', 'console', 'mgmt', 'power', 'usb', 'other'];
export const FIBER_KINDS = ['olt', 'pon', 'odf', 'cable', 'splitter', 'nap', 'closure', 'client'];
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
    json: 'props',
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
  if (def.json && body[def.json] !== undefined) {
    let p = body[def.json];
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch { errors.push(`"${def.json}" no es JSON válido`); p = {}; } }
    if (p && typeof p === 'object' && !Array.isArray(p)) data[def.json] = JSON.stringify(p);
    else errors.push(`"${def.json}" debe ser un objeto`);
  }
  if (!partial) {
    for (const r of def.required) {
      if (data[r] == null || data[r] === '') errors.push(`El campo "${r}" es obligatorio`);
    }
  }
  return { data, errors };
}
