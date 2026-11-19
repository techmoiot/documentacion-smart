// Planta externa FTTH (estilo OZmap): postes, cables trazados sobre postes, cajas y clientes en el mapa
import { api, projectCtx } from '../api.js';
import { STATUS, FIBER_KIND, FIBER_PROPS, POLE_MATERIAL, NODE_TYPE, cableColor } from '../catalog.js';
import { h, btn, clear, go, state, can, haversineKm, fmtKm, badge, props, openPanel, closePanel, formModal, confirmBox, guard, toast } from '../ui.js';
import { filesWidget, historyList, showImpact } from '../shared.js';
import { strandsEditor } from '../strands.js';
import { addBaseMaps } from '../basemaps.js';
import { importKmzWizard } from './import-kmz.js';
import { upRows, downRows, traceCard, posOf } from '../trace.js';
import { openSplice } from '../splice.js';
import { towerForm, antennaForm } from './radio.js';

const L = window.L;
const sc = (st) => STATUS[st]?.color || '#94a3b8';
const PLACEABLE = ['nap', 'closure', 'splitter', 'client'];
const GLYPH = { nap: 'N', closure: 'E', splitter: 'S', client: 'C', olt: 'O', odf: 'D', pon: 'P' };
const pathLen = (path) => { let t = 0; for (let i = 1; i < path.length; i++) t += haversineKm(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]) * 1000; return t; };
const fmtM = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`);

export async function plantaView(root, query = {}) {
  clear(root);
  const editable = can('write');

  // Proyectos visibles en este mapa (selección propia de la vista, se recuerda entre visitas;
  // por defecto parte de lo elegido en el selector global de la barra superior).
  const projects = state.projects || [];
  const allIds = projects.map((p) => p.id);
  const PKEY = 'sd_planta_projects';
  const initialShown = () => {
    try {
      const v = JSON.parse(localStorage.getItem(PKEY));
      if (Array.isArray(v)) { const ok = v.filter((id) => allIds.includes(id)); if (ok.length || !v.length) return ok; }
    } catch { /* sin almacenamiento */ }
    const g = projectCtx.id;
    const ids = g === 'all' ? allIds : String(g).split(',').map(Number).filter((id) => allIds.includes(id));
    return ids.length ? ids : allIds;
  };
  let shown = initialShown();
  const saveShown = () => { try { localStorage.setItem(PKEY, JSON.stringify(shown)); } catch { /* sin almacenamiento */ } };
  async function fetchData() {
    if (!shown.length) return { poles: [], elements: [], nodes: [] };
    return api.get('/api/planta', { project: shown.length === allIds.length ? 'all' : shown.join(',') });
  }
  let data = await fetchData();

  const mapEl = h('div', { id: 'map' });
  const ctl = h('div', { class: 'tool-ctl' });
  const bar = h('div', { class: 'draw-bar hidden' });
  const wrap = h('div', { class: 'map-wrap' }, mapEl, ctl, bar);
  root.append(h('div', { class: 'page fill' }, wrap));

  const map = L.map(mapEl, { zoomControl: true, doubleClickZoom: false }).setView([14.6349, -90.5069], 16);
  addBaseMaps(map, { maxNative: 19 });
  L.control.scale({ imperial: false }).addTo(map);

  const G = { cables: L.layerGroup().addTo(map), poles: L.layerGroup().addTo(map), els: L.layerGroup().addTo(map), towers: L.layerGroup(), rl: L.layerGroup(), trace: L.layerGroup().addTo(map), draft: L.layerGroup().addTo(map), edit: L.layerGroup().addTo(map) };
  let tool = 'select';        // select | pole | cable | nap | closure | splitter | client
  let draft = [];             // vértices del cable en trazado: {lat,lng,pole}
  let selected = null;        // {type:'pole'|'el', id}
  let editing = null;         // cable en edición de vértices
  const toolBtns = {};
  // Submódulos del mapa: «fibra» (postes, cables, cajas) y «torres» (sitios de radio y radioenlaces)
  let mode = query.mode === 'torres' || query.tower ? 'torres' : 'fibra';
  const layerOn = { cables: true, poles: true, els: true, towers: true, rl: true };
  let bgOn = true; // en «torres», mostrar la fibra de fondo
  const TOWER_TYPES = ['torre', 'repetidor'];
  const towers = () => data.nodes.filter((n) => TOWER_TYPES.includes(n.type));
  const towerById = () => new Map(data.nodes.map((n) => [n.id, n]));

  const poleById = () => new Map(data.poles.map((p) => [p.id, p]));
  const elById = () => new Map(data.elements.map((e) => [e.id, e]));

  let reloadSeq = 0;
  async function reload() {
    const n = ++reloadSeq;
    const d = await fetchData();
    if (n !== reloadSeq) return; // llegó una respuesta más nueva (se cambió la selección rápido)
    data = d; draw();
  }

  // Crear en el proyecto correcto: el único visible, o se pregunta cuando hay varios.
  async function pickTarget() { return shown.length === 1 ? shown[0] : (await projectCtx.ask?.()) || null; }
  function revealProject(target) {
    if (shown.includes(target)) return;
    shown = allIds.filter((id) => id === target || shown.includes(id)); saveShown(); renderProjList();
  }
  async function postNew(url, body) {
    const target = await pickTarget(); if (!target) return null;
    const created = await guard(() => api.post(url, body, { target }));
    if (created) revealProject(target);
    return created;
  }

  async function setShown(ids) {
    shown = allIds.filter((id) => ids.includes(id));
    saveShown(); renderProjList();
    closePanel(true); selected = null; clearTrace();
    if (draft.length) cancelDraft();
    if (editing) cancelEdit();
    await reload(); fit();
  }

  // ---------- Dibujo ----------
  function poleIcon(p, sel) {
    return L.divIcon({ html: h('div', { class: 'pmark', style: { '--st': sc(p.status), outline: sel ? '3px solid #22d3ee' : null } }), className: '', iconSize: [14, 14], iconAnchor: [7, 7] });
  }
  function elIcon(e, sel) {
    const k = FIBER_KIND[e.kind] || FIBER_KIND.nap;
    return L.divIcon({ html: h('div', { class: `emark ${e.kind === 'client' ? 'round' : ''}`, style: { '--c': k.color, outline: sel ? '3px solid #22d3ee' : null } }, GLYPH[e.kind] || '?'), className: '', iconSize: [24, 24], iconAnchor: [12, 12] });
  }
  function draw() {
    G.cables.clearLayers(); G.poles.clearLayers(); G.els.clearLayers(); G.towers.clearLayers(); G.rl.clearLayers();
    const fibraUI = mode === 'fibra';
    const count = { cables: 0, poles: data.poles.length, els: 0 };
    for (const e of data.elements) {
      if (e.kind === 'cable') {
        if (!e.path || e.path.length < 2) continue;
        count.cables++;
        const fib = Number(e.props?.fibras_total) || 0;
        const isSel = selected?.type === 'el' && selected.id === e.id;
        const col = e.status === 'operativo' ? cableColor(fib) : sc(e.status);
        const line = L.polyline(e.path.map((p) => [p[0], p[1]]), { color: col, weight: fibraUI ? (isSel ? 7 : 4) : 3, opacity: fibraUI ? 0.95 : 0.45, interactive: fibraUI });
        const len = e.props?.longitud_m ?? pathLen(e.path);
        line.bindTooltip(`${e.name}${fib ? ` · ${fib} hilos` : ''} · ${fmtM(len)}`, { sticky: true });
        line.on('click', (ev) => { L.DomEvent.stopPropagation(ev); if (tool === 'select') selectEl(e.id); else if (tool === 'cable' || PLACEABLE.includes(tool)) mapClick(ev); });
        line.addTo(G.cables);
      } else if (e.lat != null && e.lng != null && e.own_lat != null) {
        count.els++;
        const m = L.marker([e.lat, e.lng], { icon: elIcon(e, selected?.type === 'el' && selected.id === e.id), title: e.name, draggable: fibraUI && editable && tool === 'move', interactive: fibraUI, opacity: fibraUI ? 1 : 0.5 });
        m.bindTooltip(`${FIBER_KIND[e.kind]?.label || e.kind}: ${e.name}`);
        m.on('click', (ev) => { L.DomEvent.stopPropagation(ev); if (tool === 'cable') addVertex(e.lat, e.lng, null); else if (tool === 'select' || tool === 'move') selectEl(e.id); });
        m.on('dragend', () => { const ll = m.getLatLng(); moveItem({ type: 'el', id: e.id, name: e.name, from: [e.lat, e.lng], to: [ll.lat, ll.lng] }); });
        m.addTo(G.els);
      }
    }
    for (const p of data.poles) {
      const m = L.marker([p.lat, p.lng], { icon: poleIcon(p, selected?.type === 'pole' && selected.id === p.id), title: p.code, draggable: fibraUI && editable && tool === 'move', zIndexOffset: -100, interactive: fibraUI, opacity: fibraUI ? 1 : 0.5 });
      m.bindTooltip(`Poste ${p.code}${p.name ? ' · ' + p.name : ''}`);
      m.on('click', (ev) => { L.DomEvent.stopPropagation(ev); if (tool === 'cable') addVertex(p.lat, p.lng, p.id); else if (tool === 'select' || tool === 'move') selectPole(p.id); });
      m.on('dragend', () => { const ll = m.getLatLng(); moveItem({ type: 'pole', id: p.id, name: `poste ${p.code}`, from: [p.lat, p.lng], to: [ll.lat, ll.lng] }); });
      m.addTo(G.poles);
    }
    if (fibraUI) stats.textContent = `${count.poles} postes · ${count.cables} cables · ${count.els} cajas/clientes`;
    else { drawTowers(); stats.textContent = `${towers().length} torres · ${(data.antennas || []).length} antenas · ${(data.radiolinks || []).length} radioenlaces`; }
    drawDraft();
  }

  // ---------- Torres y radioenlaces ----------
  function towerIcon(n, sel) {
    const k = NODE_TYPE[n.type] || NODE_TYPE.otro;
    return L.divIcon({ html: h('div', { class: 'emark tower', style: { '--c': k.color, '--st': sc(n.status), outline: sel ? '3px solid #22d3ee' : null } }, k.glyph), className: '', iconSize: [28, 28], iconAnchor: [14, 14] });
  }
  function drawTowers() {
    const antCount = new Map();
    for (const a of data.antennas || []) antCount.set(a.node_id, (antCount.get(a.node_id) || 0) + 1);
    for (const r of data.radiolinks || []) {
      if (r.a_lat == null || r.b_lat == null) continue;
      const isSel = selected?.type === 'link' && selected.id === r.id;
      const line = L.polyline([[r.a_lat, r.a_lng], [r.b_lat, r.b_lng]], { color: sc(r.status), weight: isSel ? 6 : 3, opacity: 0.9, dashArray: r.link_type === 'PTMP' ? '7 7' : null });
      line.bindTooltip(`${r.name} · ${r.link_type}${r.freq_mhz ? ` · ${r.freq_mhz} MHz` : ''}`, { sticky: true });
      line.on('click', (ev) => { L.DomEvent.stopPropagation(ev); if (tool === 'select') selectLink(r.id); });
      line.addTo(G.rl);
    }
    for (const n of towers()) {
      const m = L.marker([n.lat, n.lng], { icon: towerIcon(n, selected?.type === 'tower' && selected.id === n.id), title: n.name, draggable: editable && tool === 'move', zIndexOffset: 200 });
      m.bindTooltip(`${(NODE_TYPE[n.type] || NODE_TYPE.otro).label}: ${n.name}${n.height_m ? ` · ${n.height_m} m` : ''} · ${antCount.get(n.id) || 0} antenas`);
      m.on('click', (ev) => { L.DomEvent.stopPropagation(ev); if (tool === 'select' || tool === 'move') selectTower(n.id); });
      m.on('dragend', () => { const ll = m.getLatLng(); moveItem({ type: 'node', id: n.id, name: n.name, from: [n.lat, n.lng], to: [ll.lat, ll.lng] }); });
      m.addTo(G.towers);
    }
  }
  function selectTower(id) {
    select({ type: 'tower', id });
    const n = towerById().get(id); if (!n) return;
    const k = NODE_TYPE[n.type] || NODE_TYPE.otro;
    const ants = (data.antennas || []).filter((a) => a.node_id === n.id);
    const antIds = new Set(ants.map((a) => a.id));
    const links = (data.radiolinks || []).filter((r) => antIds.has(r.a_antenna_id) || antIds.has(r.b_antenna_id));
    const refresh = async () => { await reload(); selectTower(n.id); };
    const body = h('div', null,
      h('div', { class: 'row gap wrap', style: { marginBottom: '8px' } }, h('span', { class: 'chip', style: { '--c': k.color } }, k.label), badge(n.status)),
      props([['Código', n.code], ['Estructura', n.structure], ['Altura', n.height_m != null ? `${n.height_m} m` : null], ['Coordenadas', `${n.lat.toFixed(6)}, ${n.lng.toFixed(6)}`], ['Ubicación', [n.location, n.address].filter(Boolean).join(' · ')], ['Responsable', n.responsible], ['Descripción', n.description]]),
      h('h4', null, `Antenas (${ants.length})`),
      ants.length ? h('ul', { class: 'plain' }, ants.map((a) => h('li', null, a.name, h('span', { class: 'muted small' }, ' ' + [a.role, a.height_m != null ? `${a.height_m} m` : null, a.azimuth != null ? `${a.azimuth}°` : null, a.freq_mhz ? `${a.freq_mhz} MHz` : null].filter(Boolean).join(' · ')))))
        : h('p', { class: 'muted small' }, 'Esta torre aún no tiene antenas.'),
      h('h4', null, `Radioenlaces (${links.length})`),
      links.length ? h('ul', { class: 'plain' }, links.map((r) => h('li', null, h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); selectLink(r.id); } }, r.name), h('span', { class: 'muted small' }, ` ${r.link_type}`)))) : h('p', { class: 'muted small' }, 'Sin radioenlaces.'),
      h('div', { class: 'row gap wrap', style: { margin: '10px 0' } },
        editable ? btn('Agregar antena', { ic: 'plus', kind: 'primary', onClick: async () => { if (await antennaForm(null, n.id)) { toast('Antena agregada'); await refresh(); } } }) : null,
        can('update') ? btn('Editar torre', { ic: 'edit', onClick: async () => { if (await towerForm(n)) { toast('Torre actualizada'); await refresh(); } } }) : null,
        btn('Radioenlaces', { ic: 'radio', onClick: () => go(`#/radioenlaces?site=${n.id}`) }),
        btn('Abrir nodo', { onClick: () => go(`#/nodo/${n.id}`) }),
        btn('Impacto', { ic: 'alert', onClick: () => showImpact('node', n.id) })),
      h('h4', null, 'Fotografías y archivos'), filesWidget('node', n.id),
      h('h4', null, 'Historial'), historyList('nodes', n.id, 10));
    openPanel(n.name, body, { onClose: () => { selected = null; draw(); }, subtitle: 'Torre / sitio de radio' });
    map.panTo([n.lat, n.lng]);
    setTimeout(() => map.invalidateSize(), 80);
  }
  function selectLink(id) {
    select({ type: 'link', id });
    const r = (data.radiolinks || []).find((x) => x.id === id); if (!r) return;
    const body = h('div', null,
      props([['Tipo', r.link_type], ['Estado', badge(r.status)], ['Extremo A', `${r.a_node_name} · ${r.a_name}`], ['Extremo B', `${r.b_node_name} · ${r.b_name}`], ['Frecuencia', r.freq_mhz ? `${r.freq_mhz} MHz` : null], ['RSSI', r.rssi_dbm != null ? `${r.rssi_dbm} dBm` : null], ['Capacidad', r.capacity],
        ['Distancia', fmtM(haversineKm(r.a_lat, r.a_lng, r.b_lat, r.b_lng) * 1000)]]),
      h('div', { class: 'row gap wrap', style: { margin: '10px 0' } }, btn('Abrir en Radioenlaces', { ic: 'radio', onClick: () => go(`#/radioenlaces?link=${r.id}`) })));
    openPanel(r.name, body, { onClose: () => { selected = null; draw(); }, subtitle: 'Radioenlace' });
    setTimeout(() => map.invalidateSize(), 80);
  }
  async function placeTower(ll) {
    const target = await pickTarget(); if (!target) return;
    const codes = new Set(data.nodes.map((x) => x.code));
    let i = towers().length + 1, code;
    do { code = `TORRE-${String(i++).padStart(2, '0')}`; } while (codes.has(code));
    const t = await towerForm(null, { target, values: { lat: Number(ll.lat.toFixed(6)), lng: Number(ll.lng.toFixed(6)), code } });
    if (!t) return;
    revealProject(target);
    toast(`Torre ${t.name} creada`);
    await reload(); selectTower(t.id);
  }

  // ---------- Deshacer / rehacer (movimientos y trazados) ----------
  const undoStack = [], redoStack = [];
  const undoBtn = btn('Deshacer', { ic: 'undo', title: 'Deshacer el último cambio (Ctrl+Z)', onClick: () => undo() });
  const redoBtn = btn('Rehacer', { ic: 'redo', title: 'Rehacer (Ctrl+Y)', onClick: () => redo() });
  function undoUI() {
    undoBtn.disabled = !undoStack.length; redoBtn.disabled = !redoStack.length;
    undoBtn.title = undoStack.length ? `Deshacer: ${undoStack[undoStack.length - 1].label} (Ctrl+Z)` : 'Nada que deshacer';
    redoBtn.title = redoStack.length ? `Rehacer: ${redoStack[redoStack.length - 1].label} (Ctrl+Y)` : 'Nada que rehacer';
  }
  async function applyChange(it, dir) {
    const v = dir === 'undo' ? it.from : it.to;
    if (it.type === 'path') {
      const cur = elById().get(it.id);
      const props = { ...(cur?.props || {}), longitud_m: Math.round(pathLen(v)) };
      return guard(() => api.patch(`/api/fiber/${it.id}`, { path: v, props }));
    }
    return guard(() => api.patch(it.type === 'pole' ? `/api/poles/${it.id}` : it.type === 'node' ? `/api/nodes/${it.id}` : `/api/fiber/${it.id}`, { lat: v[0], lng: v[1] }));
  }
  async function moveItem(it) {
    if (Math.abs(it.from[0] - it.to[0]) < 1e-9 && Math.abs(it.from[1] - it.to[1]) < 1e-9) return;
    it.label = `mover ${it.name}`;
    if (await applyChange(it, 'redo')) { undoStack.push(it); redoStack.length = 0; toast(`Movió ${it.name} · Ctrl+Z para deshacer`); }
    await reload(); undoUI();
  }
  async function undo() {
    const it = undoStack.pop(); if (!it) return;
    if (await applyChange(it, 'undo')) { redoStack.push(it); toast(`Deshecho: ${it.label}`); } else undoStack.push(it);
    await reload(); undoUI();
  }
  async function redo() {
    const it = redoStack.pop(); if (!it) return;
    if (await applyChange(it, 'redo')) { undoStack.push(it); toast(`Rehecho: ${it.label}`); } else redoStack.push(it);
    await reload(); undoUI();
  }

  // ---------- Selección y paneles ----------
  function select(sel) { selected = sel; draw(); }
  function selectPole(id) {
    select({ type: 'pole', id });
    const p = poleById().get(id); if (!p) return;
    const through = data.elements.filter((e) => e.kind === 'cable' && e.path?.some((pt) => pt[2] === id));
    const body = h('div', null,
      props([['Código', p.code], ['Nombre', p.name], ['Material', POLE_MATERIAL[p.material] || p.material], ['Altura', p.height_m != null ? `${p.height_m} m` : null], ['Propietario', p.owner], ['Estado', badge(p.status)], ['Coordenadas', `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`], ['Notas', p.notes]]),
      h('h4', null, `Cables en este poste (${through.length})`),
      through.length ? h('ul', { class: 'plain' }, through.map((c) => h('li', null, h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); selectEl(c.id); } }, c.name), h('span', { class: 'muted small' }, ` ${c.props?.fibras_total || '?'} hilos`)))) : h('p', { class: 'muted small' }, 'Ningún cable pasa por este poste.'),
      can('update') ? h('div', { class: 'row gap wrap', style: { margin: '10px 0' } },
        btn('Editar', { ic: 'edit', onClick: () => editPole(p) }),
        can('write') ? btn('Eliminar', { ic: 'trash', onClick: () => delPole(p, through.length) }) : null) : null,
      h('h4', null, 'Fotografías y archivos'), filesWidget('pole', p.id),
      h('h4', null, 'Historial'), historyList('poles', p.id, 10));
    openPanel(`Poste ${p.code}`, body, { onClose: () => { selected = null; draw(); }, subtitle: 'Planta externa' });
    map.panTo([p.lat, p.lng]);
    setTimeout(() => map.invalidateSize(), 80);
  }
  async function editPole(p) {
    const v = await formModal({ title: `Editar poste ${p.code}`, values: p, fields: poleFields() });
    if (!v) return;
    if (await guard(() => api.patch(`/api/poles/${p.id}`, v))) { toast('Poste actualizado'); await reload(); selectPole(p.id); }
  }
  async function delPole(p, n) {
    if (!(await confirmBox(`¿Eliminar el poste ${p.code}?${n ? ` ${n} cable(s) conservarán su trazado pero perderán el vínculo con el poste.` : ''}`))) return;
    if (await guard(() => api.del(`/api/poles/${p.id}`))) { closePanel(true); selected = null; toast('Poste eliminado'); reload(); }
  }
  const poleFields = () => [
    { name: 'code', label: 'Código', placeholder: 'Automático (P-0001)', maxlength: 30 },
    { name: 'name', label: 'Nombre / referencia', maxlength: 80 },
    { name: 'material', label: 'Material', type: 'select', options: Object.entries(POLE_MATERIAL), default: 'concreto' },
    { name: 'height_m', label: 'Altura (m)', type: 'number', step: '0.5', min: 0 },
    { name: 'owner', label: 'Propietario (empresa eléctrica, municipal…)', maxlength: 80 },
    { name: 'status', label: 'Estado', type: 'select', options: Object.entries(STATUS).map(([k, o]) => [k, o.label]), default: 'operativo' },
    { name: 'notes', label: 'Notas', type: 'textarea' },
  ];

  function selectEl(id) {
    select({ type: 'el', id });
    const e = elById().get(id); if (!e) return;
    const k = FIBER_KIND[e.kind] || {};
    const rows = [['Tipo', k.label], ['Código', e.code], ['Estado', badge(e.status)]];
    for (const [key, label] of FIBER_PROPS[e.kind] || []) if (e.props?.[key] != null && e.props[key] !== '') rows.push([label, String(e.props[key])]);
    if (e.kind === 'cable' && e.path) {
      rows.push(['Longitud trazada', fmtM(pathLen(e.path))], ['Postes recorridos', String(new Set(e.path.filter((p) => p[2] != null).map((p) => p[2])).size)]);
    } else if (e.lat != null) rows.push(['Coordenadas', `${e.lat.toFixed(6)}, ${e.lng.toFixed(6)}`]);
    if (['closure', 'nap'].includes(e.kind)) {
      const inside = data.elements.filter((x) => x.kind === 'splitter' && x.parent_id === e.id);
      if (inside.length) rows.push(['Splitters en la caja', inside.map((x) => `${x.name} (${x.props?.relacion || '?'})`).join(', ')]);
    }
    const parent = e.parent_id ? elById().get(e.parent_id) : null;
    if (parent) rows.push(['Depende de', h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); selectEl(parent.id); } }, parent.name)]);
    if (e.notes) rows.push(['Notas', e.notes]);
    const body = h('div', null, props(rows),
      h('div', { class: 'row gap wrap', style: { margin: '10px 0' } },
        btn('Ruta desde el nodo', { ic: 'fiber', kind: 'primary', title: 'Resalta el recorrido de la fibra desde el nodo/OLT hasta este elemento', onClick: () => showTrace(e, 'up') }),
        btn('Hasta el final', { ic: 'fiber', title: 'Resalta todo lo que cuelga de este elemento hasta los clientes', onClick: () => showTrace(e, 'down') }),
        ['closure', 'nap'].includes(e.kind) && can('write') ? btn('Agregar splitter', { ic: 'plus', title: 'Agrega un splitter dentro de esta caja', onClick: () => openSplice(e, data.elements, { onChanged: () => reload(), addSplitter: true }) }) : null,
        ['closure', 'nap', 'splitter'].includes(e.kind) ? btn('Diagrama de empalmes', { ic: 'edit', onClick: () => openSplice(e, data.elements, { onChanged: () => reload() }) }) : null,
        btn('Ver en árbol FTTH', { ic: 'fiber', onClick: () => go(`#/fibra?sel=${e.id}`) }),
        btn('Impacto', { ic: 'alert', onClick: () => showImpact('fiber', e.id) }),
        e.kind === 'cable' && editable ? btn('Editar trazado', { ic: 'edit', onClick: () => startEditPath(e) }) : null,
        can('update') ? btn('Editar datos', { ic: 'edit', onClick: () => editEl(e) }) : null,
        editable ? btn('Eliminar', { ic: 'trash', onClick: () => delEl(e) }) : null),
      e.kind === 'cable' ? h('div', null, h('h4', null, 'Hilos'), strandsEditor(e, () => {})) : null,
      h('h4', null, 'Fotografías y archivos'), filesWidget('fiber', e.id),
      h('h4', null, 'Historial'), historyList('fiber', e.id, 10));
    openPanel(e.name, body, { onClose: () => { if (!editing) { selected = null; draw(); } }, subtitle: k.label });
    setTimeout(() => map.invalidateSize(), 80);
  }
  async function editEl(e) {
    const extra = (FIBER_PROPS[e.kind] || []).map(([key, label, type]) => ({ name: `p_${key}`, label, type: type === 'number' ? 'number' : 'text', step: 'any' }));
    const values = { name: e.name, code: e.code, status: e.status, notes: e.notes };
    for (const [key] of FIBER_PROPS[e.kind] || []) values[`p_${key}`] = e.props?.[key] ?? '';
    const v = await formModal({ title: `Editar ${e.name}`, values, fields: [
      { name: 'name', label: 'Nombre', required: true, maxlength: 80 }, { name: 'code', label: 'Código', maxlength: 40 },
      { name: 'status', label: 'Estado', type: 'select', options: Object.entries(STATUS).map(([k, o]) => [k, o.label]) },
      ...extra, { name: 'notes', label: 'Notas', type: 'textarea' }] });
    if (!v) return;
    const pr = { ...e.props };
    for (const [key, , type] of FIBER_PROPS[e.kind] || []) {
      const raw = v[`p_${key}`];
      if (raw === '' || raw == null) delete pr[key]; else pr[key] = type === 'number' ? Number(raw) : raw;
    }
    const body = { name: v.name, code: v.code, status: v.status, notes: v.notes, props: pr };
    if (await guard(() => api.patch(`/api/fiber/${e.id}`, body))) { toast('Elemento actualizado'); await reload(); selectEl(e.id); }
  }
  async function delEl(e) {
    if (!(await confirmBox(`¿Eliminar «${e.name}»? Los elementos que dependen de él quedarán sin padre o se eliminarán según la configuración.`))) return;
    if (await guard(() => api.del(`/api/fiber/${e.id}`))) { closePanel(true); selected = null; toast('Elemento eliminado'); reload(); }
  }

  // ---------- Seguimiento de la fibra ----------
  function clearTrace() { G.trace.clearLayers(); }
  function showTrace(e, mode) {
    clearTrace();
    const byId = elById();
    const loops = data.odfLoops || [];
    const rows = mode === 'up' ? upRows(e, byId, loops) : downRows(e, data.elements, loops);
    const els = rows.filter((r) => !r.loop).map((r) => r.e);
    const bounds = [];
    for (const x of els) {
      if (x.kind === 'cable' && x.path?.length > 1) {
        const pts = x.path.map((p) => [p[0], p[1]]);
        L.polyline(pts, { color: '#facc15', weight: 11, opacity: 0.55, interactive: false }).addTo(G.trace);
        L.polyline(pts, { color: '#fff7b0', weight: 3, opacity: 1, dashArray: '2 10', className: 'rl-flow', interactive: false }).addTo(G.trace);
        bounds.push(...pts);
      } else {
        const p = posOf(x);
        if (p) { L.circleMarker(p, { radius: 14, color: '#facc15', weight: 3, fillColor: '#facc15', fillOpacity: 0.2, interactive: false }).addTo(G.trace); bounds.push(p); }
      }
      const par = x.parent_id != null ? byId.get(x.parent_id) : null;
      if (par && els.includes(par) && !(x.kind === 'cable' && x.path?.length > 1) && !(par.kind === 'cable' && par.path?.length > 1)) {
        const a = posOf(par), b = posOf(x);
        if (a && b && (a[0] !== b[0] || a[1] !== b[1])) L.polyline([a, b], { color: '#facc15', weight: 4, opacity: 0.8, dashArray: '6 8', interactive: false }).addTo(G.trace);
      }
    }
    if (bounds.length) map.fitBounds(L.latLngBounds(bounds).pad(0.2), { maxZoom: 19 });
    const title = mode === 'up' ? `Desde el nodo hasta «${e.name}»` : `Desde «${e.name}» hasta los finales`;
    openPanel(`Ruta de fibra`, h('div', null, traceCard(rows, { title }),
      h('div', { class: 'row gap wrap', style: { marginTop: '10px' } }, btn(mode === 'up' ? 'Ver hasta el final' : 'Ruta desde el nodo', { onClick: () => showTrace(e, mode === 'up' ? 'down' : 'up') }), btn('Quitar resaltado', { onClick: () => { clearTrace(); closePanel(true); selected = null; draw(); } }))),
      { subtitle: e.name, onClose: clearTrace });
    setTimeout(() => map.invalidateSize(), 80);
  }

  // ---------- Herramientas ----------
  function setTool(t) {
    clearTrace();
    if (editing) cancelEdit();
    if (draft.length) cancelDraft();
    tool = t;
    for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('on', k === t);
    map.getContainer().classList.toggle('drawing', t !== 'select');
    hint();
    draw();
  }
  function hint() {
    bar.classList.toggle('hidden', tool === 'select' && !editing);
    clear(bar);
    if (editing) return;
    const msg = { move: mode === 'torres' ? 'Modo mover: arrastre las torres para reubicarlas. Ctrl+Z deshace el último movimiento.' : 'Modo mover: arrastre postes, cajas o clientes para reubicarlos. Ctrl+Z deshace el último movimiento.', tower: 'Haga clic en el mapa donde está la torre: se abrirá el formulario con las coordenadas ya cargadas.', pole: 'Haga clic en el mapa para colocar un poste.', cable: 'Haga clic en postes (se ajustan automáticamente) o en el mapa para trazar el cable. Doble clic o «Terminar» para finalizar.' }[tool]
      || `Haga clic en el mapa para colocar: ${FIBER_KIND[tool]?.label || ''}.`;
    bar.append(...[h('span', null, msg), tool === 'move' ? btn('Deshacer', { ic: 'undo', onClick: () => undo() }) : null, btn(tool === 'move' ? 'Terminar de mover' : 'Salir', { onClick: () => setTool('select') })].filter(Boolean));
  }

  const snap = (ll) => {
    const pt = map.latLngToContainerPoint(ll);
    let best = null, bd = 18;
    for (const p of data.poles) {
      const d = pt.distanceTo(map.latLngToContainerPoint([p.lat, p.lng]));
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  async function mapClick(e) {
    const ll = e.latlng;
    if (tool === 'select') { if (selected) { selected = null; closePanel(true); draw(); } return; }
    if (tool === 'pole') {
      const v = await formModal({ title: 'Nuevo poste', fields: poleFields() });
      if (!v) return;
      v.lat = ll.lat; v.lng = ll.lng;
      const created = await postNew('/api/poles', v);
      if (created) { toast(`Poste ${created.code} creado`); await reload(); }
      return;
    }
    if (tool === 'tower') { placeTower(ll); return; }
    if (tool === 'cable') { const p = snap(ll); addVertex(p ? p.lat : ll.lat, p ? p.lng : ll.lng, p ? p.id : null); return; }
    if (PLACEABLE.includes(tool)) placeElement(tool, ll);
  }
  map.on('click', mapClick);
  map.on('dblclick', () => { if (tool === 'cable' && draft.length > 1) finishCable(); });
  map.on('mousemove', (e) => { if (tool === 'cable' && draft.length) drawDraft(e.latlng); });

  async function placeElement(kind, ll) {
    const k = FIBER_KIND[kind];
    const parents = data.elements.filter((x) => (x.kind !== 'client' || false)).map((x) => [x.id, `${FIBER_KIND[x.kind]?.label || x.kind} · ${x.name}`]);
    const extra = (FIBER_PROPS[kind] || []).map(([key, label, type]) => ({ name: `p_${key}`, label, type: type === 'number' ? 'number' : 'text', step: 'any' }));
    const near = snap(ll);
    const v = await formModal({ title: `Nuevo: ${k.label}`, values: { status: 'operativo' }, fields: [
      { name: 'name', label: 'Nombre', required: true, maxlength: 80 },
      { name: 'parent_id', label: 'Depende de (opcional)', type: 'select', options: [['', '— sin padre —'], ...parents] },
      { name: 'status', label: 'Estado', type: 'select', options: Object.entries(STATUS).map(([x, o]) => [x, o.label]) },
      ...extra] });
    if (!v) return;
    const pr = {};
    for (const [key, , type] of FIBER_PROPS[kind] || []) { const raw = v[`p_${key}`]; if (raw !== '' && raw != null) pr[key] = type === 'number' ? Number(raw) : raw; }
    if (near) pr.poste_id = near.id;
    const body = { kind, name: v.name, status: v.status, lat: near ? near.lat : ll.lat, lng: near ? near.lng : ll.lng, props: pr };
    if (v.parent_id) body.parent_id = Number(v.parent_id);
    const created = await postNew('/api/fiber', body);
    if (created) { toast(`${k.label} creado${near ? ' en poste ' + near.code : ''}`); await reload(); }
  }

  // ---------- Trazado de cable ----------
  function addVertex(lat, lng, pole) {
    if (tool !== 'cable') return;
    const last = draft[draft.length - 1];
    if (last && last.lat === lat && last.lng === lng) return;
    draft.push({ lat, lng, pole });
    drawDraft();
  }
  function cancelDraft() { draft = []; G.draft.clearLayers(); updateDraftBar(); }
  function drawDraft(cursor) {
    G.draft.clearLayers();
    if (!draft.length) return updateDraftBar();
    const pts = draft.map((d) => [d.lat, d.lng]);
    L.polyline(cursor ? [...pts, cursor] : pts, { color: '#facc15', weight: 4, dashArray: '8 6' }).addTo(G.draft);
    draft.forEach((d) => L.circleMarker([d.lat, d.lng], { radius: 5, color: '#422006', fillColor: d.pole ? '#22d3ee' : '#facc15', fillOpacity: 1, interactive: false }).addTo(G.draft));
    updateDraftBar();
  }
  function updateDraftBar() {
    if (tool !== 'cable') return;
    clear(bar);
    const len = pathLen(draft.map((d) => [d.lat, d.lng]));
    bar.append(
      h('strong', null, draft.length ? `${draft.length} puntos · ${fmtM(len)} · ${draft.filter((d) => d.pole).length} postes` : 'Trazar cable'),
      draft.length ? null : h('span', { class: 'muted small' }, 'Clic en postes o en el mapa'),
      btn('Deshacer', { onClick: () => { draft.pop(); drawDraft(); } }),
      btn('Terminar', { kind: 'primary', onClick: () => finishCable(), disabled: draft.length < 2 }),
      btn('Cancelar', { onClick: () => setTool('select') }));
    bar.classList.remove('hidden');
  }
  async function finishCable() {
    if (draft.length < 2) return;
    const path = draft.map((d) => [d.lat, d.lng, d.pole]);
    const cables = data.elements.filter((x) => x.kind !== 'client').map((x) => [x.id, `${FIBER_KIND[x.kind]?.label || x.kind} · ${x.name}`]);
    const v = await formModal({ title: `Nuevo cable · ${fmtM(pathLen(path))}`, values: { status: 'operativo', fibras_total: 12 }, fields: [
      { name: 'name', label: 'Nombre del cable', required: true, maxlength: 80, placeholder: 'Ej. Troncal Av. Central' },
      { name: 'parent_id', label: 'Nace de (OLT, splitter, caja, otro cable…)', type: 'select', options: [['', '— sin padre —'], ...cables] },
      { name: 'fibras_total', label: 'Número de hilos', type: 'number', min: 1, max: 864 },
      { name: 'tipo_cable', label: 'Tipo de cable', placeholder: 'ADSS, figura 8, canalizado…', maxlength: 60 },
      { name: 'status', label: 'Estado', type: 'select', options: Object.entries(STATUS).map(([k, o]) => [k, o.label]) }] });
    if (!v) return;
    const pr = { longitud_m: Math.round(pathLen(path)) };
    if (v.fibras_total) pr.fibras_total = Number(v.fibras_total);
    if (v.tipo_cable) pr.tipo_cable = v.tipo_cable;
    const body = { kind: 'cable', name: v.name, status: v.status, path, props: pr };
    if (v.parent_id) body.parent_id = Number(v.parent_id);
    const created = await postNew('/api/fiber', body);
    if (created) { toast('Cable creado'); cancelDraft(); setTool('select'); await reload(); selectEl(created.id); }
  }

  // ---------- Edición de trazado existente ----------
  function startEditPath(cable) {
    closePanel(true);
    editing = { id: cable.id, name: cable.name, props: cable.props, orig: cable.path.map((p) => [p[0], p[1], p[2]]), pts: cable.path.map((p) => ({ lat: p[0], lng: p[1], pole: p[2] })) };
    tool = 'select';
    renderEdit();
  }
  function renderEdit() {
    G.edit.clearLayers();
    const ed = editing; if (!ed) return;
    const line = L.polyline(ed.pts.map((p) => [p.lat, p.lng]), { color: '#facc15', weight: 5, dashArray: '8 6' }).addTo(G.edit);
    // insertar vértice al hacer clic sobre el segmento
    line.on('click', (ev) => {
      L.DomEvent.stopPropagation(ev);
      let bi = 1, bd = Infinity;
      const pt = map.latLngToContainerPoint(ev.latlng);
      for (let i = 1; i < ed.pts.length; i++) {
        const a = map.latLngToContainerPoint([ed.pts[i - 1].lat, ed.pts[i - 1].lng]), b = map.latLngToContainerPoint([ed.pts[i].lat, ed.pts[i].lng]);
        const d = L.LineUtil.pointToSegmentDistance(pt, a, b);
        if (d < bd) { bd = d; bi = i; }
      }
      const near = snap(ev.latlng);
      ed.pts.splice(bi, 0, near ? { lat: near.lat, lng: near.lng, pole: near.id } : { lat: ev.latlng.lat, lng: ev.latlng.lng, pole: null });
      renderEdit();
    });
    ed.pts.forEach((p, i) => {
      const m = L.marker([p.lat, p.lng], { draggable: true, icon: L.divIcon({ html: h('div', { class: 'vmark', style: { background: p.pole ? '#22d3ee' : '#facc15' } }), className: '', iconSize: [14, 14], iconAnchor: [7, 7] }), zIndexOffset: 500 });
      m.on('drag', () => { const ll = m.getLatLng(); p.lat = ll.lat; p.lng = ll.lng; line.setLatLngs(ed.pts.map((q) => [q.lat, q.lng])); });
      m.on('dragend', () => { const near = snap(m.getLatLng()); if (near) { p.lat = near.lat; p.lng = near.lng; p.pole = near.id; } else p.pole = null; renderEdit(); });
      m.on('contextmenu', () => { if (ed.pts.length > 2) { ed.pts.splice(i, 1); renderEdit(); } });
      m.on('dblclick', () => { if (ed.pts.length > 2) { ed.pts.splice(i, 1); renderEdit(); } });
      m.addTo(G.edit);
    });
    clear(bar);
    bar.classList.remove('hidden');
    bar.append(h('strong', null, `Editando ${ed.name} · ${fmtM(pathLen(ed.pts.map((p) => [p.lat, p.lng])))}`),
      h('span', { class: 'muted small' }, 'Arrastre puntos · clic en la línea añade uno · doble clic en un punto lo quita'),
      btn('Guardar trazado', { kind: 'primary', onClick: saveEdit }), btn('Cancelar', { onClick: () => { cancelEdit(); draw(); } }));
  }
  function cancelEdit() { editing = null; G.edit.clearLayers(); hint(); }
  async function saveEdit() {
    const ed = editing;
    const path = ed.pts.map((p) => [p.lat, p.lng, p.pole]);
    const pr = { ...ed.props, longitud_m: Math.round(pathLen(path)) };
    if (await guard(() => api.patch(`/api/fiber/${ed.id}`, { path, props: pr }))) {
      undoStack.push({ type: 'path', id: ed.id, from: ed.orig, to: path, label: `trazado de ${ed.name}` }); redoStack.length = 0; undoUI();
      toast('Trazado guardado · Ctrl+Z para deshacer'); cancelEdit(); await reload(); selectEl(ed.id);
    }
  }

  // ---------- Panel de herramientas ----------
  const stats = h('div', { class: 'muted small', style: { padding: '0 4px' } });
  ctl.append(h('strong', { style: { padding: '2px 4px' } }, 'Planta externa'), stats);
  const projBox = h('div', { class: 'proj-pick' });
  function renderProjList() {
    clear(projBox);
    if (!projects.length) { projBox.append(h('p', { class: 'muted small' }, 'No tiene proyectos asignados.')); return; }
    projBox.append(h('div', { class: 'row gap' }, btn('Todos', { onClick: () => setShown(allIds) }), btn('Ninguno', { onClick: () => setShown([]) })));
    for (const p of projects) {
      const i = h('input', { type: 'checkbox', checked: shown.includes(p.id), onchange: () => setShown(i.checked ? [...shown, p.id] : shown.filter((x) => x !== p.id)) });
      projBox.append(h('label', { title: p.name }, i, h('span', { class: 'dotc', style: { background: p.color } }), h('span', { class: 'pname' }, p.name)));
    }
  }
  const projHead = h('h5', null, 'Proyectos en el mapa');
  ctl.append(projHead, projBox);
  renderProjList();
  const toolBtn = (key, label, ic) => (toolBtns[key] = btn(label, { ic, onClick: () => setTool(key) }));
  const toggle = (label, key) => {
    const i = h('input', { type: 'checkbox', checked: layerOn[key], onchange: () => { layerOn[key] = i.checked; applyLayers(); } });
    return h('label', null, i, label);
  };
  const legendRow = (label, swatch) => h('div', { class: 'small', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, swatch, label);
  const dot = (c) => h('span', { class: 'dotc', style: { background: c } });
  const lineSw = (style) => h('span', { style: { width: '18px', flex: 'none', borderTop: `3px ${style} #94a3b8` } });

  function applyLayers() {
    const bg = mode === 'fibra' || bgOn;
    const vis = { cables: layerOn.cables && bg, poles: layerOn.poles && bg, els: layerOn.els && bg, towers: layerOn.towers && mode === 'torres', rl: layerOn.rl && mode === 'torres' };
    for (const [k, on] of Object.entries(vis)) { if (on) G[k].addTo(map); else map.removeLayer(G[k]); }
  }

  function renderTools() {
    clear(toolsBox);
    for (const k of Object.keys(toolBtns)) delete toolBtns[k];
    toolBtns.select = btn('Seleccionar', { ic: 'map', onClick: () => setTool('select') });
    toolBtns.select.classList.add('on');
    toolsBox.append(toolBtns.select);
    if (mode === 'torres') {
      if (editable) toolsBox.append(h('h5', null, 'Editar'), toolBtn('move', 'Mover torres', 'map'), h('div', { class: 'row gap' }, undoBtn, redoBtn), h('h5', null, 'Colocar'), toolBtn('tower', 'Torre / sitio', 'plus'));
      else toolsBox.append(h('p', { class: 'muted small' }, 'Su rol es de consulta: no puede editar las torres.'));
      const bg = h('input', { type: 'checkbox', checked: bgOn, onchange: () => { bgOn = bg.checked; applyLayers(); } });
      toolsBox.append(h('h5', null, 'Capas'), toggle('Torres y repetidores', 'towers'), toggle('Radioenlaces', 'rl'), h('label', null, bg, 'Fibra de fondo'),
        btn('Ajustar a las torres', { ic: 'fit', onClick: fit }),
        h('h5', null, 'Leyenda'),
        legendRow('Torre', dot(NODE_TYPE.torre.color)), legendRow('Repetidor', dot(NODE_TYPE.repetidor.color)),
        legendRow('Enlace PTP', lineSw('solid')), legendRow('Enlace PTMP', lineSw('dashed')),
        h('p', { class: 'muted small', style: { margin: '2px 4px' } }, 'El color del enlace es su estado.'));
      return;
    }
    if (editable) {
      toolsBox.append(h('h5', null, 'Editar'), toolBtn('move', 'Mover elementos', 'map'), h('div', { class: 'row gap' }, undoBtn, redoBtn));
      toolsBox.append(h('h5', null, 'Dibujar'), toolBtn('pole', 'Poste', 'plus'), toolBtn('cable', 'Cable de fibra', 'fiber'));
      toolsBox.append(h('h5', null, 'Colocar'), ...PLACEABLE.map((k) => toolBtn(k, FIBER_KIND[k].label.split(' /')[0], 'plus')));
    } else toolsBox.append(h('p', { class: 'muted small' }, 'Su rol es de consulta: no puede editar la planta.'));
    toolsBox.append(h('h5', null, 'Capas'), toggle('Cables', 'cables'), toggle('Postes', 'poles'), toggle('Cajas y clientes', 'els'),
      editable ? h('h5', null, 'Migración') : null,
      editable ? btn('Importar KMZ / KML', { ic: 'plus', onClick: () => importKmzWizard({ onDone: () => go(location.hash) }) }) : null,
      btn('Ajustar a la planta', { ic: 'fit', onClick: fit }),
      h('h5', null, 'Leyenda'),
      ...[['≤12 hilos', cableColor(12)], ['13–48', cableColor(24)], ['49–96', cableColor(72)], ['>96', cableColor(144)]].map(([l, c]) => legendRow(l, dot(c))));
  }

  const tabs = h('div', { class: 'chips', style: { padding: '2px 0' } });
  function renderTabs() {
    clear(tabs);
    for (const [k, l] of [['fibra', 'Fibra'], ['torres', 'Torres']]) tabs.append(h('button', { type: 'button', class: `chip-tab${mode === k ? ' active' : ''}`, onclick: () => setMode(k) }, l));
  }
  function setMode(m) {
    if (m === mode) return;
    mode = m; closePanel(true); selected = null;
    renderTabs(); renderTools(); applyLayers(); setTool('select'); fit();
  }
  const toolsBox = h('div', { class: 'tool-sec' });
  ctl.append(toolsBox);
  ctl.insertBefore(tabs, projHead);
  renderTabs(); renderTools(); applyLayers();

  function fit() {
    let pts = [];
    if (mode === 'torres') {
      pts = [...towers().map((n) => [n.lat, n.lng]), ...(data.radiolinks || []).flatMap((r) => [[r.a_lat, r.a_lng], [r.b_lat, r.b_lng]]).filter((p) => p[0] != null)];
    }
    if (!pts.length) {
      pts = [...data.poles.map((p) => [p.lat, p.lng]), ...data.elements.filter((e) => e.own_lat != null).map((e) => [e.lat, e.lng]), ...data.elements.flatMap((e) => (e.path || []).map((p) => [p[0], p[1]]))];
      if (!pts.length) pts.push(...data.nodes.map((n) => [n.lat, n.lng]));
    }
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: mode === 'torres' ? 16 : 18 });
  }


  // Esc cancela
  const onKey = (ev) => {
    if (!document.body.contains(mapEl)) { document.removeEventListener('keydown', onKey); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.querySelector('.overlay');
    if (!typing && editable && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); (ev.shiftKey ? redo : undo)(); return; }
    if (!typing && editable && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
    if (ev.key === 'Escape') { if (editing) { cancelEdit(); draw(); } else if (tool !== 'select') setTool('select'); }
  };
  document.addEventListener('keydown', onKey);

  undoUI();
  draw(); fit();
  setTimeout(() => map.invalidateSize(), 60);
  // Enlaces directos (#/planta?pole=… / ?sel=… / ?tower=…): si el elemento es de un proyecto oculto, se muestran todos.
  if (query.pole || query.sel || query.tower) {
    const find = () => (query.tower ? towerById().get(Number(query.tower)) : query.pole ? poleById().get(Number(query.pole)) : elById().get(Number(query.sel)));
    if (!find() && shown.length < allIds.length) { shown = allIds; renderProjList(); await reload(); }
    const it = find();
    if (it && query.tower) { map.setView([it.lat, it.lng], 17); selectTower(it.id); }
    else if (it && query.pole) { map.setView([it.lat, it.lng], 19); selectPole(it.id); }
    else if (it) selectEl(it.id);
  }
}
