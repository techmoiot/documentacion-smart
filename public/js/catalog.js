// Catálogos de la interfaz: etiquetas, colores y plantillas de equipos (ajustables al crear el equipo)

export const STATUS = {
  operativo: { label: 'Operativo', color: '#22c55e' },
  degradado: { label: 'Degradado', color: '#f59e0b' },
  fuera_de_servicio: { label: 'Fuera de servicio', color: '#ef4444' },
  pendiente: { label: 'Pendiente de instalación', color: '#94a3b8' },
};

export const NODE_TYPE = {
  principal: { label: 'Nodo principal', color: '#38bdf8', glyph: 'P' },
  distribucion: { label: 'Nodo de distribución', color: '#a78bfa', glyph: 'D' },
  torre: { label: 'Torre', color: '#fb923c', glyph: 'T' },
  repetidor: { label: 'Repetidor', color: '#f472b6', glyph: 'R' },
  nap: { label: 'Punto de distribución / NAP', color: '#34d399', glyph: 'N' },
  cliente: { label: 'Sitio de cliente', color: '#cbd5e1', glyph: 'C' },
  otro: { label: 'Otro', color: '#94a3b8', glyph: '·' },
};

export const DEVICE_TYPE = {
  router: { label: 'Router', color: '#3b82f6' },
  switch: { label: 'Switch', color: '#14b8a6' },
  olt: { label: 'OLT', color: '#a855f7' },
  odf: { label: 'ODF', color: '#f59e0b' },
  patch_panel: { label: 'Patch panel', color: '#64748b' },
  organizer: { label: 'Organizador de cableado', color: '#475569' },
  ups: { label: 'UPS', color: '#eab308' },
  pdu: { label: 'PDU', color: '#ca8a04' },
  server: { label: 'Servidor', color: '#6366f1' },
  radio: { label: 'Equipo de radio', color: '#ec4899' },
  onu: { label: 'ONU / terminal', color: '#10b981' },
  other: { label: 'Otro', color: '#94a3b8' },
};

export const PORT_KIND = {
  rj45: { label: 'RJ45', color: '#38bdf8' },
  sfp: { label: 'SFP', color: '#f59e0b' },
  'sfp+': { label: 'SFP+', color: '#fb923c' },
  sfp28: { label: 'SFP28', color: '#f97316' },
  'qsfp+': { label: 'QSFP+', color: '#ef4444' },
  pon: { label: 'PON', color: '#a855f7' },
  fiber: { label: 'Fibra (ODF)', color: '#eab308' },
  console: { label: 'Consola', color: '#94a3b8' },
  mgmt: { label: 'Gestión', color: '#22d3ee' },
  power: { label: 'Alimentación', color: '#facc15' },
  usb: { label: 'USB', color: '#94a3b8' },
  other: { label: 'Otro', color: '#94a3b8' },
};

export const FIBER_KIND = {
  olt: { label: 'OLT', color: '#a855f7' },
  pon: { label: 'Puerto PON', color: '#3b82f6' },
  odf: { label: 'ODF', color: '#f59e0b' },
  cable: { label: 'Cable', color: '#38bdf8' },
  splitter: { label: 'Splitter', color: '#ec4899' },
  nap: { label: 'Caja NAP', color: '#22c55e' },
  closure: { label: 'Caja de distribución / empalme', color: '#fb923c' },
  client: { label: 'Cliente / terminación', color: '#e2e8f0' },
};

// Qué puede colgar de cada elemento de fibra
export const FIBER_CHILDREN = {
  olt: ['pon'], pon: ['odf', 'splitter', 'cable'], odf: ['cable', 'splitter'],
  cable: ['splitter', 'nap', 'closure', 'cable', 'odf'], splitter: ['nap', 'splitter', 'cable', 'closure'],
  closure: ['splitter', 'nap', 'cable'], nap: ['client', 'splitter'], client: [],
};

// Campos técnicos específicos por tipo de elemento de fibra (se guardan en "props")
export const FIBER_PROPS = {
  olt: [['tarjeta', 'Tarjeta de servicio / slot', 'text']],
  pon: [['potencia_tx_dbm', 'Potencia TX (dBm)', 'number'], ['clientes_max', 'Clientes máx.', 'number']],
  odf: [['bandeja', 'Bandeja / posición', 'text'], ['hilo', 'Hilo / puerto ODF', 'text']],
  cable: [
    ['tipo_cable', 'Tipo de cable', 'text'], ['fibras_total', 'Número de fibras', 'number'], ['fibras_usadas', 'Fibras usadas', 'number'],
    ['hilos_asignados', 'Hilos asignados', 'text'], ['capacidad', 'Capacidad', 'text'], ['atenuacion_db', 'Atenuación (dB)', 'number'],
    ['distancia_m', 'Distancia (m)', 'number'],
  ],
  splitter: [['relacion', 'Relación (1:8, 1:16…)', 'text'], ['perdida_db', 'Pérdida de inserción (dB)', 'number'], ['hilo_entrada', 'Hilo de entrada', 'text']],
  closure: [['capacidad', 'Capacidad (bandejas)', 'text'], ['hilos', 'Hilos empalmados', 'text']],
  nap: [['puertos', 'Puertos', 'number'], ['puertos_usados', 'Puertos usados', 'number'], ['distancia_m', 'Distancia desde splitter (m)', 'number'], ['atenuacion_db', 'Atenuación (dB)', 'number']],
  client: [['onu_serial', 'Serie ONU', 'text'], ['plan', 'Plan', 'text'], ['potencia_rx_dbm', 'Potencia RX (dBm)', 'number'], ['direccion', 'Dirección', 'text'], ['puerto_nap', 'Puerto en NAP', 'text']],
};

export const LOGICAL = {
  vlan: 'VLAN', interfaz_virtual: 'Interfaz virtual', troncal: 'Enlace troncal', red_ip: 'Red IP', bridge: 'Bridge', vpn: 'VPN / túnel', otro: 'Otro',
};

const g = (kind, prefix, count, speed = '', start = 1) => ({ kind, prefix, count, speed, start });

// Plantillas orientativas: ajuste puertos y U al equipo real antes de guardar.
export const TEMPLATES = [
  { id: 'ccr2004', label: 'MikroTik CCR2004-1G-12S+2XS', type: 'router', brand: 'MikroTik', model: 'CCR2004-1G-12S+2XS', u: 1, groups: [g('rj45', 'ether', 1, '1G'), g('sfp+', 'SFP+', 12, '10G'), g('sfp28', 'SFP28-', 2, '25G'), g('console', 'console', 1)] },
  { id: 'ccr2116', label: 'MikroTik CCR2116-12G-4S+', type: 'router', brand: 'MikroTik', model: 'CCR2116-12G-4S+', u: 1, groups: [g('rj45', 'ether', 12, '1G'), g('sfp+', 'SFP+', 4, '10G'), g('console', 'console', 1)] },
  { id: 'rb5009', label: 'MikroTik RB5009UG+S+IN', type: 'router', brand: 'MikroTik', model: 'RB5009UG+S+IN', u: 1, groups: [g('rj45', 'ether', 8, '1G'), g('sfp+', 'SFP+', 1, '10G')] },
  { id: 'router-gen', label: 'Router genérico', type: 'router', brand: '', model: '', u: 1, groups: [g('rj45', 'ether', 8, '1G'), g('sfp+', 'SFP+', 2, '10G')] },
  { id: 'crs326', label: 'MikroTik CRS326-24G-2S+RM', type: 'switch', brand: 'MikroTik', model: 'CRS326-24G-2S+RM', u: 1, groups: [g('rj45', 'ether', 24, '1G'), g('sfp+', 'SFP+', 2, '10G')] },
  { id: 'crs354', label: 'MikroTik CRS354-48G-4S+2Q+RM', type: 'switch', brand: 'MikroTik', model: 'CRS354-48G-4S+2Q+RM', u: 1, groups: [g('rj45', 'ether', 48, '1G'), g('sfp+', 'SFP+', 4, '10G'), g('qsfp+', 'QSFP+', 2, '40G')] },
  { id: 'crs309', label: 'MikroTik CRS309-1G-8S+IN', type: 'switch', brand: 'MikroTik', model: 'CRS309-1G-8S+IN', u: 1, groups: [g('rj45', 'ether', 1, '1G'), g('sfp+', 'SFP+', 8, '10G')] },
  { id: 'sw24', label: 'Switch 24 puertos + 4 SFP', type: 'switch', brand: '', model: '', u: 1, groups: [g('rj45', 'Gi', 24, '1G'), g('sfp', 'SFP', 4, '1G')] },
  { id: 'sw48', label: 'Switch 48 puertos + 4 SFP+', type: 'switch', brand: '', model: '', u: 1, groups: [g('rj45', 'Gi', 48, '1G'), g('sfp+', 'SFP+', 4, '10G')] },
  { id: 'olt-c320', label: 'OLT ZTE ZXA10 C320 (ajustable)', type: 'olt', brand: 'ZTE', model: 'ZXA10 C320', u: 2, groups: [g('sfp+', 'XGE', 4, '10G'), g('pon', 'PON', 16, 'GPON'), g('mgmt', 'MGMT', 1)] },
  { id: 'olt-8', label: 'OLT genérica 8 PON', type: 'olt', brand: '', model: '', u: 1, groups: [g('sfp+', 'XGE', 2, '10G'), g('pon', 'PON', 8, 'GPON'), g('mgmt', 'MGMT', 1)] },
  { id: 'odf12', label: 'ODF 12 fibras', type: 'odf', brand: '', model: 'ODF 12F', u: 1, groups: [g('fiber', 'F', 12)] },
  { id: 'odf24', label: 'ODF 24 fibras', type: 'odf', brand: '', model: 'ODF 24F', u: 1, groups: [g('fiber', 'F', 24)] },
  { id: 'odf48', label: 'ODF 48 fibras', type: 'odf', brand: '', model: 'ODF 48F', u: 2, groups: [g('fiber', 'F', 48)] },
  { id: 'pp24', label: 'Patch panel 24 puertos', type: 'patch_panel', brand: '', model: 'Cat6 24p', u: 1, groups: [g('rj45', 'PP', 24, '1G')] },
  { id: 'pp48', label: 'Patch panel 48 puertos', type: 'patch_panel', brand: '', model: 'Cat6 48p', u: 2, groups: [g('rj45', 'PP', 48, '1G')] },
  { id: 'org1', label: 'Organizador de cableado 1U', type: 'organizer', brand: '', model: '', u: 1, groups: [] },
  { id: 'org2', label: 'Organizador de cableado 2U', type: 'organizer', brand: '', model: '', u: 2, groups: [] },
  { id: 'ups2', label: 'UPS rack 2U', type: 'ups', brand: '', model: '', u: 2, groups: [g('power', 'OUT', 6)] },
  { id: 'ups3', label: 'UPS rack 3U', type: 'ups', brand: '', model: '', u: 3, groups: [g('power', 'OUT', 8)] },
  { id: 'pdu', label: 'PDU 8 salidas', type: 'pdu', brand: '', model: '', u: 1, groups: [g('power', 'OUT', 8)] },
  { id: 'srv1', label: 'Servidor 1U', type: 'server', brand: '', model: '', u: 1, groups: [g('rj45', 'eth', 2, '1G'), g('mgmt', 'iDRAC', 1)] },
  { id: 'srv2', label: 'Servidor 2U', type: 'server', brand: '', model: '', u: 2, groups: [g('rj45', 'eth', 4, '1G'), g('sfp+', 'SFP+', 2, '10G'), g('mgmt', 'iDRAC', 1)] },
  { id: 'radio', label: 'Equipo de radio (PoE)', type: 'radio', brand: '', model: '', u: 1, groups: [g('rj45', 'LAN', 2, '1G')] },
  { id: 'otro', label: 'Otro equipo (sin puertos)', type: 'other', brand: '', model: '', u: 1, groups: [] },
];

export const POLE_MATERIAL = { concreto: 'Concreto', madera: 'Madera', metal: 'Metal', otro: 'Otro' };

// Código de colores TIA-598 (fibras y tubos), 12 colores que se repiten
export const FIBER_COLORS = [
  ['Azul', '#2563eb'], ['Naranja', '#f97316'], ['Verde', '#22c55e'], ['Marrón', '#92400e'], ['Gris', '#9ca3af'], ['Blanco', '#f8fafc'],
  ['Rojo', '#ef4444'], ['Negro', '#111827'], ['Amarillo', '#eab308'], ['Violeta', '#8b5cf6'], ['Rosa', '#f472b6'], ['Aqua', '#22d3ee'],
];
export const strandColor = (n) => FIBER_COLORS[(n - 1) % 12];
export const tubeOf = (n) => Math.ceil(n / 12);
export const STRAND_STATE = { libre: 'Libre', usada: 'Usada', reservada: 'Reservada', danada: 'Dañada' };

// Color del cable según su capacidad (hilos)
export const cableColor = (fibers) => (fibers > 96 ? '#e879f9' : fibers > 48 ? '#a78bfa' : fibers > 12 ? '#60a5fa' : '#22d3ee');
