// Planta externa FTTH (estilo OZmap): postes, cables trazados sobre postes, cajas y clientes en el mapa
import { api } from '../api.js';
import { STATUS, FIBER_KIND, FIBER_PROPS, POLE_MATERIAL, cableColor } from '../catalog.js';
import { h, btn, clear, go, state, can, haversineKm, fmtKm, badge, props, openPanel, closePanel, formModal, confirmBox, guard, toast } from '../ui.js';
import { filesWidget, historyList, showImpact } from '../shared.js';
import { strandsEditor } from '../strands.js';

const L = window.L;
const sc = (st) => STATUS[st]?.color || '#94a3b8';
const PLACEABLE = ['nap', 'closure', 'splitter', 'client'];
const GLYPH = { nap: 'N', closure: 'E', splitter: 'S', client: 'C', olt: 'O', odf: 'D', pon: 'P' };
const pathLen = (path) => { let t = 0; for (let i = 1; i < path.length; i++) t += haversineKm(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]) * 1000; return t; };
const fmtM = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`);

export async function plantaView(root, query = {}) {
  clear(root);
  let data = await api.get('/api/planta');
  const editable = can('write');
  const sat = localStorage.getItem('sd_map_sat') === '1';

  const mapEl = h('div', { id: 'map' });
  const ctl = h('div', { class: 'tool-ctl' });
  const bar = h('div', { class: 'draw-bar hidden' });
  const wrap = h('div', { class: 'map-wrap' }, mapEl, ctl, bar);
  root.append(h('div', { class: 'page fill' }, wrap));

  const map = L.map(mapEl, { zoomControl: true, doubleClickZoom: false }).setView([14.6349, -90.5069], 16);
  const osm = L.tileLayer(state.meta.tileUrl, { maxZoom: 20, maxNativeZoom: 19, attribution: state.meta.tileAttribution, referrerPolicy: 'strict-origin-when-cross-origin' });
  const satL = L.tileLayer(state.meta.satUrl, { maxZoom: 20, maxNativeZoom: 19, attribution: state.meta.satAttribution, referrerPolicy: 'strict-origin-when-cross-origin' });
  (sat ? satL : osm).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);

  const G = { cables: L.layerGroup().addTo(map), poles: L.layerGroup().addTo(map), els: L.layerGroup().addTo(map), draft: L.layerGroup().addTo(map), edit: L.layerGroup().addTo(map) };
  let tool = 'select';        // select | pole | cable | nap | closure | splitter | client
  let draft = [];             // vértices del cable en trazado: {lat,lng,pole}
  let selected = null;        // {type:'pole'|'el', id}
  let editing = null;         // cable en edición de vértices
  const toolBtns = {};

  const poleById = () => new Map(data.poles.map((p) => [p.id, p]));
  const elById = () => new Map(data.elements.map((e) => [e.id, e]));

  async function reload() { data = await api.get('/api/planta'); draw(); }

  // ---------- Dibujo ----------
  function poleIcon(p, sel) {
    return L.divIcon({ html: h('div', { class: 'pmark', style: { '--st': sc(p.status), outline: sel ? '3px solid #22d3ee' : null } }), className: '', iconSize: [14, 14], iconAnchor: [7, 7] });
  }
  function elIcon(e, sel) {
    const k = FIBER_KIND[e.kind] || FIBER_KIND.nap;
    return L.divIcon({ html: h('div', { class: `emark ${e.kind === 'client' ? 'round' : ''}`, style: { '--c': k.color, outline: sel ? '3px solid #22d3ee' : null } }, GLYPH[e.kind] || '?'), className: '', iconSize: [24, 24], iconAnchor: [12, 12] });
  }
  function draw() {
    G.cables.clearLayers(); G.poles.clearLayers(); G.els.clearLayers();
    const count = { cables: 0, poles: data.poles.length, els: 0 };
    for (const e of data.elements) {
      if (e.kind === 'cable') {
        if (!e.path || e.path.length < 2) continue;
        count.cables++;
        const fib = Number(e.props?.fibras_total) || 0;
        const isSel = selected?.type === 'el' && selected.id === e.id;
        const col = e.status === 'operativo' ? cableColor(fib) : sc(e.status);
        const line = L.polyline(e.path.map((p) => [p[0], p[1]]), { color: col, weight: isSel ? 7 : 4, opacity: 0.95 });
        const len = e.props?.longitud_m ?? pathLen(e.path);
        line.bindTooltip(`${e.name}${fib ? ` · ${fib} hilos` : ''} · ${fmtM(len)}`, { sticky: true });
        line.on('click', (ev) => { L.DomEvent.stopPropagation(ev); if (tool === 'select') selectEl(e.id); else if (tool === 'cable' || PLACEABLE.includes(tool)) mapClick(ev); });
        line.addTo(G.cables);
      } else if (e.lat != null && e.lng != null && e.own_lat != null) {
        count.els++;
        const m = L.marker([e.lat, e.lng], { icon: elIcon(e, selected?.type === 'el' && selected.id === e.id), title: e.name, draggable: editable && tool === 'select' });
        m.bindTooltip(`${FIBER_KIND[e.kind]?.label || e.kind}: ${e.name}`);
        m.on('click', (ev) => { L.DomEvent.stopPropagation(ev); if (tool === 'cable') addVertex(e.lat, e.lng, null); else if (tool === 'select') selectEl(e.id); });
        m.on('dragend', async () => {
          const ll = m.getLatLng();
          await guard(() => api.patch(`/api/fiber/${e.id}`, { lat: ll.lat, lng: ll.lng }));
          toast('Posición actualizada'); reload();
        });
        m.addTo(G.els);
      }
    }
    for (const p of data.poles) {
      const m = L.marker([p.lat, p.lng], { icon: poleIcon(p, selected?.type === 'pole' && selected.id === p.id), title: p.code, draggable: editable && tool === 'select', zIndexOffset: -100 });
      m.bindTooltip(`Poste ${p.code}${p.name ? ' · ' + p.name : ''}`);
      m.on('click', (ev) => { L.DomEvent.stopPropagation(ev); if (tool === 'cable') addVertex(p.lat, p.lng, p.id); else if (tool === 'select') selectPole(p.id); });
      m.on('dragend', async () => {
        const ll = m.getLatLng();
        await guard(() => api.patch(`/api/poles/${p.id}`, { lat: ll.lat, lng: ll.lng }));
        toast('Poste reubicado; los cables que pasan por él lo siguen'); reload();
      });
      m.addTo(G.poles);
    }
    stats.textContent = `${count.poles} postes · ${count.cables} cables · ${count.els} cajas/clientes`;
    drawDraft();
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
    const parent = e.parent_id ? elById().get(e.parent_id) : null;
    if (parent) rows.push(['Depende de', h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); selectEl(parent.id); } }, parent.name)]);
    if (e.notes) rows.push(['Notas', e.notes]);
    const body = h('div', null, props(rows),
      h('div', { class: 'row gap wrap', style: { margin: '10px 0' } },
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

  // ---------- Herramientas ----------
  function setTool(t) {
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
    const msg = { pole: 'Haga clic en el mapa para colocar un poste.', cable: 'Haga clic en postes (se ajustan automáticamente) o en el mapa para trazar el cable. Doble clic o «Terminar» para finalizar.' }[tool]
      || `Haga clic en el mapa para colocar: ${FIBER_KIND[tool]?.label || ''}.`;
    bar.append(h('span', null, msg), btn('Salir', { onClick: () => setTool('select') }));
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
      const created = await guard(() => api.post('/api/poles', v));
      if (created) { toast(`Poste ${created.code} creado`); await reload(); }
      return;
    }
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
    const created = await guard(() => api.post('/api/fiber', body));
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
    const created = await guard(() => api.post('/api/fiber', body));
    if (created) { toast('Cable creado'); cancelDraft(); setTool('select'); await reload(); selectEl(created.id); }
  }

  // ---------- Edición de trazado existente ----------
  function startEditPath(cable) {
    closePanel(true);
    editing = { id: cable.id, name: cable.name, props: cable.props, pts: cable.path.map((p) => ({ lat: p[0], lng: p[1], pole: p[2] })) };
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
    if (await guard(() => api.patch(`/api/fiber/${ed.id}`, { path, props: pr }))) { toast('Trazado guardado'); cancelEdit(); await reload(); selectEl(ed.id); }
  }

  // ---------- Panel de herramientas ----------
  const stats = h('div', { class: 'muted small', style: { padding: '0 4px' } });
  const toolBtn = (key, label, ic) => (toolBtns[key] = btn(label, { ic, onClick: () => setTool(key) }));
  ctl.append(h('strong', { style: { padding: '2px 4px' } }, 'Planta externa'), stats);
  toolBtns.select = btn('Seleccionar / mover', { ic: 'map', onClick: () => setTool('select') });
  toolBtns.select.classList.add('on');
  ctl.append(toolBtns.select);
  if (editable) {
    ctl.append(h('h5', null, 'Dibujar'), toolBtn('pole', 'Poste', 'plus'), toolBtn('cable', 'Cable de fibra', 'fiber'));
    ctl.append(h('h5', null, 'Colocar'), ...PLACEABLE.map((k) => toolBtn(k, FIBER_KIND[k].label.split(' /')[0], 'plus')));
  } else ctl.append(h('p', { class: 'muted small' }, 'Su rol es de consulta: no puede editar la planta.'));
  const toggle = (label, g, on = true) => {
    const i = h('input', { type: 'checkbox', checked: on, onchange: () => (i.checked ? g.addTo(map) : map.removeLayer(g)) });
    return h('label', null, i, label);
  };
  ctl.append(h('h5', null, 'Capas'), toggle('Cables', G.cables), toggle('Postes', G.poles), toggle('Cajas y clientes', G.els),
    h('h5', null, 'Mapa base'),
    btn(sat ? 'Vista de calles' : 'Vista satelital', { onClick: () => { localStorage.setItem('sd_map_sat', sat ? '0' : '1'); go(location.hash); } }),
    btn('Ajustar a la planta', { ic: 'fit', onClick: fit }),
    h('h5', null, 'Leyenda'),
    ...[['≤12 hilos', cableColor(12)], ['13–48', cableColor(24)], ['49–96', cableColor(72)], ['>96', cableColor(144)]].map(([l, c]) => h('div', { class: 'small', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span', { class: 'dotc', style: { background: c } }), l)));

  function fit() {
    const pts = [...data.poles.map((p) => [p.lat, p.lng]), ...data.elements.filter((e) => e.own_lat != null).map((e) => [e.lat, e.lng]), ...data.elements.flatMap((e) => (e.path || []).map((p) => [p[0], p[1]]))];
    if (!pts.length) pts.push(...data.nodes.map((n) => [n.lat, n.lng]));
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 18 });
  }

  // Esc cancela
  const onKey = (ev) => {
    if (!document.body.contains(mapEl)) { document.removeEventListener('keydown', onKey); return; }
    if (ev.key === 'Escape') { if (editing) { cancelEdit(); draw(); } else if (tool !== 'select') setTool('select'); }
  };
  document.addEventListener('keydown', onKey);

  draw(); fit();
  setTimeout(() => map.invalidateSize(), 60);
  if (query.pole) { const p = poleById().get(Number(query.pole)); if (p) { map.setView([p.lat, p.lng], 19); selectPole(p.id); } }
  else if (query.sel) { const e = elById().get(Number(query.sel)); if (e) selectEl(e.id); }
}
