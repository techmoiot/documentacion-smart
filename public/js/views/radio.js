// Radioenlaces: antenas y enlaces como diagrama direccional, fichas y formularios
import { api } from '../api.js';
import { STATUS, NODE_TYPE } from '../catalog.js';
import {
  h, s, btn, badge, icon, props, clear, can, guard, toast, confirmBox, modal, formModal, openPanel, closePanel, panZoom, zoomToolbar, emptyState, go, fmt, haversineKm, fmtKm,
} from '../ui.js';
import { filesWidget, historyList, showImpact } from '../shared.js';

const statusOptions = () => Object.entries(STATUS).map(([v, o]) => [v, o.label]);
const sc = (st) => STATUS[st]?.color || '#94a3b8';

// ---------- Formularios ----------
export async function antennaForm(antenna = null, nodeId = null) {
  const nodes = await api.get('/api/nodes');
  const devices = await api.get('/api/devices');
  const v = await formModal({
    title: antenna ? `Editar antena · ${antenna.name}` : 'Nueva antena', wide: true,
    values: antenna || { node_id: nodeId, status: 'operativo', polarization: 'Dual' },
    fields: [
      { name: 'name', label: 'Nombre de la antena', required: true },
      { name: 'node_id', label: 'Nodo al que pertenece', type: 'select', required: true, options: nodes.map((n) => [n.id, `${n.code} · ${n.name}`]) },
      { name: 'brand', label: 'Marca' }, { name: 'model', label: 'Modelo' },
      { name: 'ip', label: 'Dirección IP' },
      { name: 'role', label: 'Función', type: 'select', options: [['', '—'], ['PTP', 'Punto a punto (PTP)'], ['AP', 'AP / sector (PTMP)'], ['CPE', 'CPE / cliente'], ['otro', 'Otro']] },
      { name: 'device_id', label: 'Equipo asociado (inventario)', type: 'select', span: 2, options: [['', '— Ninguno —'], ...devices.map((d) => [d.id, d.name])] },
      { name: 'lat', label: 'Latitud (si difiere del nodo)', type: 'number', step: 'any' }, { name: 'lng', label: 'Longitud', type: 'number', step: 'any' },
      { name: 'height_m', label: 'Altura de instalación (m)', type: 'number', step: 'any' }, { name: 'azimuth', label: 'Azimut (°)', type: 'number', step: 'any', min: 0, max: 360 },
      { name: 'freq_mhz', label: 'Frecuencia (MHz)', type: 'number', step: 'any' }, { name: 'channel_width', label: 'Ancho de canal', placeholder: '20 MHz' },
      { name: 'tx_power_dbm', label: 'Potencia TX (dBm)', type: 'number', step: 'any' }, { name: 'gain_dbi', label: 'Ganancia (dBi)', type: 'number', step: 'any' },
      { name: 'polarization', label: 'Polarización', type: 'select', options: [['', '—'], ['Horizontal', 'Horizontal'], ['Vertical', 'Vertical'], ['Dual', 'Dual (H+V)'], ['Circular', 'Circular']] },
      { name: 'capacity', label: 'Capacidad del enlace', placeholder: '300 Mbps' },
      { name: 'status', label: 'Estado operativo', type: 'select', options: statusOptions() },
      { name: 'notes', label: 'Observaciones', type: 'textarea' },
    ],
  });
  if (!v) return null;
  v.node_id = Number(v.node_id); v.device_id = v.device_id === '' ? null : Number(v.device_id);
  return guard(() => (antenna ? api.patch(`/api/antennas/${antenna.id}`, v) : api.post('/api/antennas', v)));
}

export const STRUCTURES = [['', '—'], ['Autosoportada', 'Torre autosoportada'], ['Venteada', 'Torre venteada (con retenidas)'], ['Monopolo', 'Monopolo'], ['Mástil', 'Mástil / poste'], ['Azotea', 'Azotea / edificio'], ['Otro', 'Otro']];

/** Alta / edición de una torre (es un nodo de tipo «torre» con altura y estructura). */
export async function towerForm(node = null) {
  const v = await formModal({
    title: node ? `Editar torre · ${node.name}` : 'Nueva torre', wide: true,
    values: node || { status: 'operativo', structure: 'Autosoportada' },
    fields: [
      { name: 'name', label: 'Nombre de la torre', required: true, maxlength: 80 },
      { name: 'code', label: 'Código', required: true, maxlength: 30, placeholder: 'TORRE-01' },
      { name: 'structure', label: 'Tipo de estructura', type: 'select', options: STRUCTURES },
      { name: 'height_m', label: 'Altura (m)', type: 'number', step: 'any', min: 0 },
      { name: 'lat', label: 'Latitud (GPS)', type: 'number', step: 'any', min: -90, max: 90 },
      { name: 'lng', label: 'Longitud (GPS)', type: 'number', step: 'any', min: -180, max: 180 },
      { name: 'location', label: 'Ubicación (municipio, zona)' }, { name: 'address', label: 'Dirección o referencia' },
      { name: 'status', label: 'Estado operativo', type: 'select', options: statusOptions() },
      { name: 'responsible', label: 'Responsable técnico' },
      { name: 'description', label: 'Descripción / observaciones', type: 'textarea' },
    ],
  });
  if (!v) return null;
  v.type = 'torre';
  return guard(() => (node ? api.patch(`/api/nodes/${node.id}`, v) : api.post('/api/nodes', v)));
}

export async function radiolinkForm(link = null) {
  const [ants, nodes] = await Promise.all([api.get('/api/antennas'), api.get('/api/nodes')]);
  const nm = new Map(nodes.map((n) => [n.id, n.name]));
  const opts = ants.map((a) => [a.id, `${nm.get(a.node_id) || '?'} · ${a.name}`]);
  const v = await formModal({
    title: link ? `Editar radioenlace · ${link.name}` : 'Nuevo radioenlace', wide: true,
    values: link || { link_type: 'PTP', status: 'operativo' },
    fields: [
      { name: 'name', label: 'Nombre del enlace', required: true, span: 2 },
      { name: 'link_type', label: 'Tipo', type: 'select', options: [['PTP', 'Punto a punto (PTP)'], ['PTMP', 'Punto multipunto (PTMP)']] },
      { name: 'status', label: 'Estado', type: 'select', options: statusOptions() },
      { name: 'a_antenna_id', label: 'Antena de origen', type: 'select', required: true, options: opts },
      { name: 'b_antenna_id', label: 'Antena de destino', type: 'select', required: true, options: opts },
      { name: 'freq_mhz', label: 'Frecuencia (MHz)', type: 'number', step: 'any' }, { name: 'rssi_dbm', label: 'Nivel de señal RSSI (dBm)', type: 'number', step: 'any' },
      { name: 'capacity', label: 'Capacidad del enlace' }, { name: 'availability', label: 'Disponibilidad', placeholder: '99.9%' },
      { name: 'installed_at', label: 'Fecha de instalación', type: 'date' },
      { name: 'notes', label: 'Observaciones técnicas', type: 'textarea' },
    ],
  });
  if (!v) return null;
  v.a_antenna_id = Number(v.a_antenna_id); v.b_antenna_id = Number(v.b_antenna_id);
  return guard(() => (link ? api.patch(`/api/radiolinks/${link.id}`, v) : api.post('/api/radiolinks', v)));
}

// ---------- Fichas ----------
export async function showLinkModal(id, { onChanged } = {}) {
  const [link, map] = await Promise.all([guard(() => api.get(`/api/radiolinks/${id}`)), api.get('/api/map')]);
  if (!link) return;
  const m = map.radiolinks.find((r) => r.id === id);
  const dist = m && m.a_lat != null && m.b_lat != null ? haversineKm(m.a_lat, m.a_lng, m.b_lat, m.b_lng) : null;
  let dlg;
  const refresh = () => { dlg.close(); onChanged?.(); };
  const body = h('div', { class: 'card-stack' },
    h('div', { class: 'row gap wrap' }, h('span', { class: 'chip', style: { '--c': '#0ea5e9' } }, link.link_type === 'PTP' ? 'Punto a punto' : 'Punto multipunto'), badge(link.status)),
    h('div', { class: 'row gap wrap', style: { justifyContent: 'space-between' } },
      h('div', { class: 'end-card', style: { flex: 1 } }, h('div', { class: 'muted small' }, 'Antena de origen'), h('strong', null, m?.a_name), h('div', { class: 'muted small' }, m?.a_node_name)),
      h('div', { style: { fontSize: '22px', color: sc(link.status) } }, '⇢'),
      h('div', { class: 'end-card', style: { flex: 1 } }, h('div', { class: 'muted small' }, 'Antena de destino'), h('strong', null, m?.b_name), h('div', { class: 'muted small' }, m?.b_node_name))),
    props([
      ['Distancia entre antenas', dist != null ? fmtKm(dist) : 'Sin coordenadas'], ['Frecuencia', fmt.val(link.freq_mhz, 'MHz')], ['Nivel de señal (RSSI)', fmt.val(link.rssi_dbm, 'dBm')],
      ['Capacidad del enlace', link.capacity], ['Disponibilidad', link.availability], ['Fecha de instalación', fmt.date(link.installed_at)], ['Observaciones técnicas', link.notes],
    ]),
    h('div', { class: 'row gap wrap' },
      btn('Impacto de falla', { ic: 'alert', onClick: () => showImpact('radiolink', id) }),
      can('update') ? btn('Editar', { ic: 'edit', onClick: async () => { if (await radiolinkForm(link)) refresh(); } }) : null,
      can('write') ? btn('Eliminar', { ic: 'trash', kind: 'danger', onClick: async () => {
        if (!(await confirmBox(`¿Eliminar el radioenlace «${link.name}»?`))) return;
        if (await guard(() => api.del(`/api/radiolinks/${id}`))) { toast('Radioenlace eliminado'); refresh(); }
      } }) : null),
    h('h4', null, 'Fotografías'), filesWidget('radiolink', id), h('h4', null, 'Historial'), historyList('radiolinks', id, 10));
  dlg = modal({ title: link.name, body, wide: true });
}

async function antennaPanel(a, links, nodeName, { onChanged }) {
  const mine = links.filter((l) => l.a_antenna_id === a.id || l.b_antenna_id === a.id);
  const body = h('div', { class: 'card-stack' },
    h('div', { class: 'row gap wrap' }, h('span', { class: 'chip' }, a.role || 'antena'), badge(a.status)),
    props([
      ['Nodo', h('a', { class: 'link', href: `#/nodo/${a.node_id}` }, nodeName)], ['Marca / modelo', [a.brand, a.model].filter(Boolean).join(' ')], ['Dirección IP', a.ip],
      ['Coordenadas GPS', a.lat != null ? `${a.lat}, ${a.lng}` : 'Las del nodo'], ['Altura de instalación', fmt.val(a.height_m, 'm')], ['Azimut', fmt.val(a.azimuth, '°')],
      ['Frecuencia de operación', fmt.val(a.freq_mhz, 'MHz')], ['Ancho de canal', a.channel_width], ['Potencia de transmisión', fmt.val(a.tx_power_dbm, 'dBm')],
      ['Ganancia', fmt.val(a.gain_dbi, 'dBi')], ['Polarización', a.polarization], ['Capacidad del enlace', a.capacity], ['Observaciones', a.notes],
    ]),
    h('h4', null, `Radioenlaces (${mine.length})`),
    mine.length ? h('ul', { class: 'simple' }, mine.map((l) => h('li', null, h('a', { class: 'link', onclick: () => showLinkModal(l.id, { onChanged }) }, l.name), ' ', badge(l.status)))) : h('p', { class: 'muted small' }, 'Sin enlaces.'),
    h('div', { class: 'row gap wrap' },
      btn('Impacto de falla', { ic: 'alert', onClick: () => showImpact('antenna', a.id) }),
      can('update') ? btn('Editar', { ic: 'edit', onClick: async () => { if (await antennaForm(a)) { closePanel(true); onChanged(); } } }) : null,
      can('write') ? btn('Eliminar', { ic: 'trash', kind: 'danger', onClick: async () => {
        if (!(await confirmBox(`¿Eliminar la antena «${a.name}» y sus radioenlaces?`))) return;
        if (await guard(() => api.del(`/api/antennas/${a.id}`))) { toast('Antena eliminada'); closePanel(true); onChanged(); }
      } }) : null),
    h('h4', null, 'Fotografías'), filesWidget('antenna', a.id), h('h4', null, 'Historial'), historyList('antennas', a.id, 10));
  openPanel(a.name, body, { subtitle: nodeName });
}

// ---------- Vista principal ----------
const CW = 214, ROW = 30, HEAD = 46, PAD = 8;

export async function radioView(root, query = {}) {
  clear(root);
  const [nodes, antennas, links] = await Promise.all([api.get('/api/nodes'), api.get('/api/antennas'), api.get('/api/radiolinks')]);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const antById = new Map(antennas.map((a) => [a.id, a]));

  const head = h('div', { class: 'page-head', style: { padding: '14px 22px 0' } }, h('h2', null, 'Radioenlaces'),
    h('span', { class: 'muted' }, `${links.length} enlaces · ${antennas.length} antenas`), h('span', { class: 'grow' }));
  if (can('write')) head.append(btn('Nueva torre', { ic: 'plus', onClick: async () => { const t = await towerForm(); if (t) go(`#/radioenlaces?site=${t.id}`); } }), btn('Nueva antena', { ic: 'plus', onClick: async () => { if (await antennaForm()) go(location.hash); } }), btn('Nuevo radioenlace', { ic: 'link', kind: 'primary', onClick: async () => { if (await radiolinkForm()) go(location.hash); } }));
  const svg = s('svg', { class: 'canvas', role: 'img', 'aria-label': 'Diagrama de radioenlaces' });
  const ctrl = panZoom(svg, { min: 0.2, max: 4 });
  head.append(zoomToolbar(ctrl));
  const legend = h('div', { class: 'legend' }, Object.entries(STATUS).map(([k, o]) => h('span', null, h('i', { style: { background: o.color } }), o.label)), h('span', null, '⇢ dirección origen → destino'));
  const host = h('div', { class: 'svg-host tall', style: { margin: '14px 22px 22px', height: 'calc(100vh - 150px)' } }, svg, legend);
  root.append(head, host);
  // Sitios: torres/repetidores (aunque aún no tengan antenas) y cualquier nodo con antenas
  const sites = nodes.filter((n) => n.type === 'torre' || n.type === 'repetidor' || antennas.some((a) => a.node_id === n.id)).map((n) => {
    const ants = antennas.filter((a) => a.node_id === n.id);
    return { node: n, ants, w: CW, h: HEAD + Math.max(ants.length, 1) * ROW + PAD, x: 0, y: 0 };
  });
  if (!sites.length) { host.append(h('div', { class: 'empty', style: { position: 'absolute', inset: '30% 0 auto' } }, 'Aún no hay torres ni antenas registradas.', can('write') ? h('div', { style: { marginTop: '10px' } }, btn('Crear la primera torre', { ic: 'plus', kind: 'primary', onClick: async () => { const t = await towerForm(); if (t) go(`#/radioenlaces?site=${t.id}`); } })) : null)); return; }
  // Proyección geográfica con separación de solapes
  const geo = sites.filter((x) => x.node.lat != null);
  if (geo.length) {
    const lats = geo.map((x) => x.node.lat), lngs = geo.map((x) => x.node.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const cos = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const spanX = Math.max((maxLng - minLng) * cos, 1e-6), spanY = Math.max(maxLat - minLat, 1e-6);
    const targetW = Math.max(900, geo.length * 280), targetH = Math.max(520, geo.length * 170);
    const k = Math.min(targetW / spanX, targetH / spanY);
    for (const x of geo) { x.x = 60 + (x.node.lng - minLng) * cos * k; x.y = 60 + (maxLat - x.node.lat) * k; }
  }
  sites.filter((x) => x.node.lat == null).forEach((x, i) => { x.x = 60 + i * (CW + 60); x.y = 60 + 700; });
  for (let it = 0; it < 250; it++) {
    let moved = false;
    for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
      const a = sites[i], b = sites[j], m = 44;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + m, oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + m;
      if (ox > 0 && oy > 0) {
        moved = true;
        if (ox < oy) { const d = ox / 2 * (a.x <= b.x ? 1 : -1); a.x -= d; b.x += d; } else { const d = oy / 2 * (a.y <= b.y ? 1 : -1); a.y -= d; b.y += d; }
      }
    }
    if (!moved) break;
  }
  const siteOf = new Map(sites.map((x) => [x.node.id, x]));
  const antRow = (a) => { const st = siteOf.get(a.node_id); return { st, i: st.ants.findIndex((x) => x.id === a.id) }; };

  const scene = s('g');
  ctrl.vp.append(scene);
  const markers = s('defs', null, Object.entries(STATUS).map(([k, o]) => s('marker', { id: `arr-${k}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' }, s('path', { d: 'M0 0 L10 5 L0 10 z', fill: o.color }))));
  svg.prepend(markers);

  let selAnt = null;
  const reload = () => go(location.hash);

  function draw() {
    clear(scene);
    const linkLayer = s('g'), chipLayer = s('g');
    for (const l of links) {
      const a = antById.get(l.a_antenna_id), b = antById.get(l.b_antenna_id);
      if (!a || !b) continue;
      const A = antRow(a), B = antRow(b);
      const ac = A.st.x + A.st.w / 2, bc = B.st.x + B.st.w / 2;
      const rightA = bc >= ac;
      const x1 = rightA ? A.st.x + A.st.w : A.st.x, y1 = A.st.y + HEAD + A.i * ROW + ROW / 2 - 2;
      const x2 = rightA ? B.st.x : B.st.x + B.st.w, y2 = B.st.y + HEAD + B.i * ROW + ROW / 2 - 2;
      const dx = Math.max(50, Math.abs(x2 - x1) * 0.4) * (rightA ? 1 : -1);
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      const involves = selAnt && (selAnt === a.id || selAnt === b.id);
      const dim = selAnt && !involves;
      const static_ = l.status === 'fuera_de_servicio' || l.status === 'pendiente';
      const grp = s('g', { class: dim ? 'dim' : '', 'data-nopan': '' });
      grp.append(
        s('path', { d, class: `rlink ${l.link_type === 'PTMP' ? 'ptmp' : ''} ${static_ ? '' : 'flow'}`, stroke: sc(l.status), 'marker-end': `url(#arr-${l.status})`, 'stroke-dasharray': l.status === 'pendiente' ? '2 6' : l.status === 'fuera_de_servicio' ? '10 8' : null, 'stroke-linecap': 'round' }),
        s('path', { d, class: 'edge-hit' }));
      grp.addEventListener('click', (e) => { e.stopPropagation(); if (!ctrl.justPanned()) showLinkModal(l.id, { onChanged: reload }); });
      linkLayer.append(grp);
      const dist = a.lat != null || A.st.node.lat != null ? (() => {
        const la = a.lat ?? A.st.node.lat, lo = a.lng ?? A.st.node.lng, lb = b.lat ?? B.st.node.lat, lob = b.lng ?? B.st.node.lng;
        return la != null && lb != null ? fmtKm(haversineKm(la, lo, lb, lob)) : null;
      })() : null;
      const label = [l.link_type, l.freq_mhz && `${l.freq_mhz} MHz`, l.rssi_dbm != null && `${l.rssi_dbm} dBm`, dist].filter(Boolean).join(' · ');
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const cw = label.length * 5.6 + 16;
      const chip = s('g', { class: `link-chip ${dim ? 'dim' : ''}`, transform: `translate(${mx - cw / 2} ${my - 11})`, 'data-nopan': '' },
        s('rect', { width: cw, height: 22, rx: 11, stroke: sc(l.status) }), s('text', { x: cw / 2, y: 15, 'text-anchor': 'middle' }, label));
      chip.addEventListener('click', (e) => { e.stopPropagation(); showLinkModal(l.id, { onChanged: reload }); });
      chipLayer.append(chip);
    }
    scene.append(linkLayer);
    for (const st of sites) {
      const nt = NODE_TYPE[st.node.type] || NODE_TYPE.otro;
      const g = s('g', { class: 'site', transform: `translate(${st.x} ${st.y})` });
      g.append(
        s('rect', { class: 'card', width: st.w, height: st.h, rx: 12 }), s('rect', { width: st.w, height: 5, rx: 2, fill: nt.color }),
        s('text', { class: 'sname', x: 14, y: 26 }, st.node.name.length > 24 ? st.node.name.slice(0, 23) + '…' : st.node.name),
        s('text', { class: 'stype', x: 14, y: 40 }, `${nt.label} · ${st.node.code}`));
      const head_ = s('rect', { x: 0, y: 5, width: st.w - 60, height: HEAD - 8, fill: 'transparent', 'data-nopan': '', style: 'cursor:pointer' }, s('title', null, 'Ver torre y sus antenas'));
      head_.addEventListener('click', (e) => { e.stopPropagation(); if (!ctrl.justPanned()) selectSite(st.node); });
      g.append(head_);
      if (!st.ants.length) {
        const er = s('g', { transform: `translate(8 ${HEAD})`, 'data-nopan': '', style: 'cursor:pointer' }, s('rect', { width: st.w - 16, height: ROW - 4, rx: 6, fill: 'none', stroke: '#2a3a5c', 'stroke-dasharray': '4 4' }), s('text', { x: 12, y: 16, fill: '#7d8ba8' }, can('write') ? '+ Agregar antenas' : 'Sin antenas'));
        er.addEventListener('click', (e) => { e.stopPropagation(); selectSite(st.node); });
        g.append(er);
      }
      st.ants.forEach((a, i) => {
        const row = s('g', { class: `ant ${selAnt === a.id ? 'sel' : ''}`, transform: `translate(8 ${HEAD + i * ROW})`, 'data-nopan': '' },
          s('rect', { width: st.w - 16, height: ROW - 4, rx: 6 }), s('circle', { cx: 13, cy: (ROW - 4) / 2, r: 4.5, fill: sc(a.status) }),
          s('text', { x: 26, y: 16 }, a.name.length > 23 ? a.name.slice(0, 22) + '…' : a.name), s('title', null, `${a.name}${a.ip ? ' · ' + a.ip : ''}`));
        row.addEventListener('click', (e) => { e.stopPropagation(); if (!ctrl.justPanned()) selectAntenna(a); });
        g.append(row);
      });
      g.append(s('a', { href: `#/nodo/${st.node.id}`, 'data-nopan': '' }, s('text', { x: st.w - 12, y: 26, 'text-anchor': 'end', fill: '#38bdf8', 'font-size': 11 }, 'abrir ›')));
      scene.append(g);
    }
    scene.append(chipLayer);
  }

  function selectAntenna(a) {
    selAnt = a.id; draw();
    antennaPanel(a, links, nodeById.get(a.node_id)?.name || '', { onChanged: reload });
    // al cerrar el panel se limpia la selección
    document.getElementById('panel')?.querySelector('.icon-btn')?.addEventListener('click', () => { selAnt = null; draw(); }, { once: true });
  }
  function selectSite(n) {
    selAnt = null; draw();
    siteFor(n);
  }
  function siteFor(n) {
    const ants = antennas.filter((a) => a.node_id === n.id);
    const body = h('div', { class: 'card-stack' },
      h('div', { class: 'row gap wrap' }, h('span', { class: 'chip', style: { '--c': (NODE_TYPE[n.type] || NODE_TYPE.otro).color } }, (NODE_TYPE[n.type] || NODE_TYPE.otro).label), badge(n.status)),
      props([['Código', n.code], ['Estructura', n.structure], ['Altura', fmt.val(n.height_m, 'm')], ['Coordenadas', n.lat != null ? `${n.lat}, ${n.lng}` : null], ['Ubicación', [n.location, n.address].filter(Boolean).join(' · ')], ['Responsable', n.responsible], ['Descripción', n.description]]),
      h('h4', null, `Antenas en esta torre (${ants.length})`),
      ants.length ? h('ul', { class: 'simple' }, ants.map((a) => h('li', null, h('a', { class: 'link', onclick: () => selectAntenna(a) }, a.name), ' ', h('span', { class: 'muted small' }, [a.role, a.height_m != null ? `${a.height_m} m` : null, a.azimuth != null ? `${a.azimuth}°` : null, a.freq_mhz ? `${a.freq_mhz} MHz` : null].filter(Boolean).join(' · ')), ' ', badge(a.status))))
        : h('p', { class: 'muted small' }, 'Esta torre aún no tiene antenas.'),
      h('div', { class: 'row gap wrap' },
        can('write') ? btn('Agregar antena', { ic: 'plus', kind: 'primary', onClick: async () => { if (await antennaForm(null, n.id)) go(`#/radioenlaces?site=${n.id}`); } }) : null,
        can('update') ? btn('Editar torre', { ic: 'edit', onClick: async () => { if (await towerForm(n)) go(`#/radioenlaces?site=${n.id}`); } }) : null,
        btn('Abrir nodo', { onClick: () => go(`#/nodo/${n.id}`) }),
        btn('Ver en mapa', { onClick: () => go(`#/mapa?node=${n.id}`) }),
        btn('Impacto', { ic: 'alert', onClick: () => showImpact('node', n.id) })),
      h('h4', null, 'Fotografías'), filesWidget('node', n.id));
    openPanel(n.name, body, { subtitle: 'Torre / sitio de radio' });
  }
  svg.addEventListener('click', () => { if (!ctrl.justPanned() && selAnt) { selAnt = null; closePanel(true); draw(); } });

  draw();
  const minX = Math.min(...sites.map((x) => x.x)), minY = Math.min(...sites.map((x) => x.y));
  const maxX = Math.max(...sites.map((x) => x.x + x.w)), maxY = Math.max(...sites.map((x) => x.y + x.h));
  const bbox = { x: minX - 30, y: minY - 30, w: maxX - minX + 60, h: maxY - minY + 60 };
  ctrl.refit = () => ctrl.fit(bbox, 20, 1.3);
  requestAnimationFrame(() => {
    ctrl.fit(bbox, 20, 1.3);
    if (query.link) showLinkModal(Number(query.link), { onChanged: reload });
    if (query.site) { const n = nodeById.get(Number(query.site)); if (n) siteFor(n); }
    if (query.antenna) { const a = antById.get(Number(query.antenna)); if (a) selectAntenna(a); }
  });
}
