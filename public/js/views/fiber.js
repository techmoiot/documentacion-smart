// Fibra óptica FTTH: árbol interactivo OLT → PON → ODF → cable → splitter → NAP → cliente
import { api } from '../api.js';
import { STATUS, FIBER_KIND, FIBER_CHILDREN, FIBER_PROPS } from '../catalog.js';
import {
  h, s, btn, badge, icon, props, clear, can, guard, toast, confirmBox, formModal, openPanel, closePanel, panZoom, zoomToolbar, emptyState, go, fmt, debounce, download, csvCell, projectChip,
} from '../ui.js';
import { filesWidget, historyList, showImpact } from '../shared.js';

const BW = 206, BH = 54, COLW = 280, ROWH = 68;
const sc = (st) => STATUS[st]?.color || '#94a3b8';

const UNITS = { potencia_tx_dbm: 'dBm', potencia_rx_dbm: 'dBm', atenuacion_db: 'dB', perdida_db: 'dB', distancia_m: 'm' };

function summaryLine(el) {
  const p = el.props || {};
  switch (el.kind) {
    case 'cable': return [p.fibras_total != null && `${p.fibras_total}F`, p.fibras_usadas != null && `${p.fibras_usadas} usadas`, p.atenuacion_db != null && `${p.atenuacion_db} dB`, p.distancia_m != null && `${p.distancia_m} m`].filter(Boolean).join(' · ') || el.code || 'Cable';
    case 'splitter': return [p.relacion, p.perdida_db != null && `${p.perdida_db} dB`].filter(Boolean).join(' · ') || 'Splitter';
    case 'nap': return p.puertos != null ? `${p.puertos_usados ?? 0}/${p.puertos} puertos` : el.code || 'NAP';
    case 'client': return p.plan || p.onu_serial || 'Cliente';
    default: return el.code || FIBER_KIND[el.kind]?.label;
  }
}

export async function fiberView(root, query = {}) {
  clear(root);
  let items = await api.get('/api/fiber');
  const nodes = await api.get('/api/nodes');

  const collapsed = new Set();
  let selId = null, bbox = { x: 0, y: 0, w: 600, h: 300 };
  let children = new Map(), byId = new Map(), roots = [];

  const svg = s('svg', { class: 'canvas', role: 'img', 'aria-label': 'Diagrama de fibra óptica FTTH' });
  const ctrl = panZoom(svg, { min: 0.15, max: 4 });
  const scene = s('g');
  ctrl.vp.append(scene);

  const search = h('input', { type: 'search', placeholder: 'Buscar elemento, cliente, ONU…', style: { width: '260px' } });
  const head = h('div', { class: 'page-head', style: { padding: '14px 22px 0' } }, h('h2', null, 'Fibra óptica FTTH'), h('span', { class: 'muted', id: 'fiber-count' }), h('span', { class: 'grow' }), search);
  if (can('write')) head.append(btn('Nuevo elemento raíz', { ic: 'plus', kind: 'primary', onClick: () => createElement(null) }));
  head.append(btn('Contraer clientes', { onClick: () => { for (const e of items) if (e.kind === 'nap') collapsed.add(e.id); redraw(true); } }), btn('Expandir todo', { onClick: () => { collapsed.clear(); redraw(true); } }), zoomToolbar(ctrl));
  const legend = h('div', { class: 'legend' }, Object.entries(FIBER_KIND).map(([k, o]) => h('span', null, h('i', { style: { background: o.color } }), o.label)));
  const host = h('div', { class: 'svg-host tall', style: { margin: '14px 22px 22px', height: 'calc(100vh - 150px)' } }, svg, legend);

  // ----- Vista de lista (por defecto) -----
  let mode = 'list';
  try { mode = localStorage.getItem('sd_fiber_view') === 'tree' ? 'tree' : 'list'; } catch { /* sin almacenamiento */ }
  const fKind = h('select', { style: { width: 'auto' } }, h('option', { value: '' }, 'Todos los tipos'), Object.entries(FIBER_KIND).map(([k, o]) => h('option', { value: k }, o.label)));
  const fStatus = h('select', { style: { width: 'auto' } }, h('option', { value: '' }, 'Todos los estados'), Object.entries(STATUS).map(([k, o]) => h('option', { value: k }, o.label)));
  const listCount = h('span', { class: 'muted' });
  const tbody = h('tbody');
  const listBar = h('div', { class: 'row gap wrap', style: { margin: '14px 22px 0' } }, fKind, fStatus, listCount, h('span', { class: 'grow' }),
    btn('Exportar CSV', { ic: 'download', onClick: () => exportCsv() }));
  const listHost = h('div', { class: 'table-wrap', style: { margin: '10px 22px 22px', maxHeight: 'calc(100vh - 215px)' } },
    h('table', { class: 't' }, h('thead', null, h('tr', null, ['Tipo', 'Nombre', 'Código', 'Depende de', 'Detalle', 'Nodo', 'Clientes', 'Estado'].map((c) => h('th', null, c)))), tbody));
  const modeBtn = (key, label, ic) => h('button', { class: `btn ${mode === key ? 'on' : ''}`, type: 'button', onclick: () => setMode(key) }, icon(ic, 15), h('span', null, label));
  const seg = h('div', { class: 'seg' });
  function setMode(m) {
    mode = m; try { localStorage.setItem('sd_fiber_view', m); } catch { /* ignorar */ }
    clear(seg); seg.append(modeBtn('list', 'Lista', 'rack'), modeBtn('tree', 'Árbol', 'fiber'));
    for (const c of head.children) if (c.classList.contains('zoombar') || (c.tagName === 'BUTTON' && /Contraer|Expandir/.test(c.textContent))) c.style.display = mode === 'tree' ? '' : 'none';
    host.style.display = mode === 'tree' ? '' : 'none'; listHost.style.display = listBar.style.display = mode === 'list' ? '' : 'none';
    if (mode === 'tree') requestAnimationFrame(() => ctrl.fit(bbox, 20, 1.2)); else renderList();
  }
  head.insertBefore(seg, search);
  root.append(head, listBar, listHost, host);

  function index() {
    byId = new Map(items.map((e) => [e.id, e]));
    children = new Map();
    for (const e of items) {
      const key = e.parent_id ?? 0;
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(e);
    }
    roots = children.get(0) || [];
    document.getElementById('fiber-count').textContent = `${items.length} elementos · ${items.filter((e) => e.kind === 'client').length} clientes`;
  }

  const clientCounts = () => {
    const memo = new Map();
    const count = (id) => { if (memo.has(id)) return memo.get(id); let n = 0; for (const c of children.get(id) || []) n += (c.kind === 'client' ? 1 : 0) + count(c.id); memo.set(id, n); return n; };
    return count;
  };
  const listRows = () => {
    const term = search.value.trim().toLowerCase();
    const flat = term || fKind.value || fStatus.value;
    const ok = (e) => (!fKind.value || e.kind === fKind.value) && (!fStatus.value || e.status === fStatus.value)
      && (!term || `${e.name} ${e.code} ${FIBER_KIND[e.kind]?.label} ${JSON.stringify(e.props)}`.toLowerCase().includes(term));
    if (flat) return items.filter(ok).map((e) => ({ e, depth: 0 }));
    const out = [];
    const walk = (e, depth) => { out.push({ e, depth }); for (const c of children.get(e.id) || []) walk(c, depth + 1); };
    roots.forEach((r) => walk(r, 0));
    return out;
  };
  function renderList() {
    if (mode !== 'list') return;
    const rows = listRows(), cc = clientCounts();
    clear(tbody);
    listCount.textContent = `${rows.length} de ${items.length} elementos`;
    for (const { e, depth } of rows) {
      const k = FIBER_KIND[e.kind] || FIBER_KIND.cable;
      const par = byId.get(e.parent_id);
      const n = e.kind === 'client' ? '' : cc(e.id);
      const tr = h('tr', { 'data-id': e.id, class: e.id === selId ? 'sel' : '', onclick: () => select(e.id) },
        h('td', null, h('span', { class: 'chip', style: { '--c': k.color } }, k.label.split(' /')[0])),
        h('td', { style: { paddingLeft: `${10 + Math.min(depth, 7) * 11}px` } }, depth ? h('span', { class: 'muted' }, '└ ') : null, h('strong', null, e.name), ' ', projectChip(e.project_id)),
        h('td', null, e.code), h('td', null, par ? par.name : '—'), h('td', { class: 'muted' }, summaryLine(e)),
        h('td', null, nodes.find((x) => x.id === e.node_id)?.name || ''), h('td', null, n ? String(n) : ''), h('td', null, badge(e.status)));
      tbody.append(tr);
    }
    if (!rows.length) tbody.append(h('tr', null, h('td', { colspan: 8 }, emptyState(items.length ? 'Sin resultados.' : 'Aún no hay elementos de fibra.'))));
  }
  function exportCsv() {
    const lines = [['Tipo', 'Nombre', 'Código', 'Depende de', 'Detalle', 'Nodo', 'Estado'].map(csvCell).join(',')];
    for (const { e } of listRows()) lines.push([FIBER_KIND[e.kind]?.label, e.name, e.code, byId.get(e.parent_id)?.name, summaryLine(e), nodes.find((x) => x.id === e.node_id)?.name, STATUS[e.status]?.label].map(csvCell).join(','));
    download(`fibra-ftth-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\r\n'));
  }
  [fKind, fStatus].forEach((el) => el.addEventListener('input', renderList));

  const descendants = (id) => {
    const out = [];
    const walk = (x) => { for (const c of children.get(x) || []) { out.push(c); walk(c.id); } };
    walk(id);
    return out;
  };
  const ancestors = (id) => {
    const out = [];
    let cur = byId.get(id);
    while (cur?.parent_id) { cur = byId.get(cur.parent_id); if (cur) out.unshift(cur); }
    return out;
  };

  function draw() {
    clear(scene);
    if (!items.length) {
      scene.append(s('text', { x: 40, y: 60, fill: '#8fa0bd', 'font-size': 14 }, 'Aún no hay elementos de fibra. Cree una OLT o un elemento raíz para comenzar.'));
      bbox = { x: 0, y: 0, w: 700, h: 120 }; return;
    }
    let leaf = 0;
    const vis = [];
    const place = (el, depth) => {
      const kids = collapsed.has(el.id) ? [] : (children.get(el.id) || []);
      el._x = 30 + depth * COLW;
      if (!kids.length) { el._y = 30 + leaf * ROWH; leaf++; } else { kids.forEach((k) => place(k, depth + 1)); el._y = (kids[0]._y + kids[kids.length - 1]._y) / 2; }
      vis.push(el);
    };
    roots.forEach((r) => place(r, 0));

    const hl = new Set();
    if (selId) { hl.add(selId); ancestors(selId).forEach((a) => hl.add(a.id)); descendants(selId).forEach((d) => hl.add(d.id)); }
    const term = search.value.trim().toLowerCase();

    const edgeLayer = s('g');
    for (const el of vis) {
      if (collapsed.has(el.id)) continue;
      for (const c of children.get(el.id) || []) {
        const x1 = el._x + BW, y1 = el._y + BH / 2, x2 = c._x, y2 = c._y + BH / 2, dx = (x2 - x1) * 0.5;
        const on = hl.has(el.id) && hl.has(c.id);
        edgeLayer.append(s('path', {
          d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, class: `fiber-edge ${on && selId ? 'hl' : ''} ${selId && !on ? 'dim' : ''}`,
          stroke: FIBER_KIND[c.kind]?.color || '#38bdf8', color: FIBER_KIND[c.kind]?.color, 'stroke-width': c.kind === 'cable' ? 3 : null,
        }));
      }
    }
    scene.append(edgeLayer);

    for (const el of vis) {
      const k = FIBER_KIND[el.kind] || FIBER_KIND.cable;
      const dim = selId && !hl.has(el.id);
      const match = term && `${el.name} ${el.code} ${JSON.stringify(el.props)}`.toLowerCase().includes(term);
      const g = s('g', { class: `node-box ${el.id === selId ? 'sel' : ''} ${dim ? 'dim' : ''}`, transform: `translate(${el._x} ${el._y})`, 'data-nopan': '' },
        s('rect', { class: 'bx', width: BW, height: BH, rx: 9, stroke: match ? '#facc15' : null, 'stroke-width': match ? 3 : null }),
        s('rect', { width: 6, height: BH, rx: 3, fill: k.color }),
        s('text', { class: 't2', x: 16, y: 15, fill: k.color }, k.label.toUpperCase()),
        s('text', { class: 't1', x: 16, y: 32 }, el.name.length > 26 ? el.name.slice(0, 25) + '…' : el.name),
        s('text', { class: 't2', x: 16, y: 46 }, summaryLine(el).slice(0, 34)),
        s('circle', { cx: BW - 12, cy: 12, r: 4, fill: sc(el.status) }));
      g.addEventListener('click', (e) => { e.stopPropagation(); if (!ctrl.justPanned()) select(el.id); });
      scene.append(g);
      const kids = children.get(el.id) || [];
      if (kids.length) {
        const n = descendants(el.id).length;
        const bx = el._x + BW + 4, by = el._y + BH / 2;
        const b = s('g', { 'data-nopan': '', style: 'cursor:pointer' },
          s('circle', { cx: bx + 9, cy: by, r: 10, class: 'collapse-badge' }),
          s('text', { x: bx + 9, y: by + 3.5, 'text-anchor': 'middle', class: 'collapse-txt' }, collapsed.has(el.id) ? `+${n > 99 ? '99+' : n}` : '−'),
          s('title', null, collapsed.has(el.id) ? `Mostrar ${n} elementos` : 'Contraer'));
        b.addEventListener('click', (e) => { e.stopPropagation(); if (collapsed.has(el.id)) collapsed.delete(el.id); else collapsed.add(el.id); draw(); });
        scene.append(b);
      }
    }
    const maxX = Math.max(...vis.map((e) => e._x)) + BW + 40, maxY = Math.max(...vis.map((e) => e._y)) + BH + 40;
    bbox = { x: 0, y: 0, w: maxX, h: maxY };
  }

  function redraw(refit = false) { index(); draw(); renderList(); if (refit) ctrl.fit(bbox, 20, 1.2); }
  ctrl.refit = () => ctrl.fit(bbox, 20, 1.2);

  async function reload() { items = await api.get('/api/fiber'); redraw(); if (selId && byId.has(selId)) select(selId, { keepView: true }); else { selId = null; closePanel(true); } }

  function select(id, { focus = false, keepView = false } = {}) {
    const el = byId.get(id);
    if (!el) return;
    selId = id;
    // expandir ancestros ocultos
    let changed = false;
    for (const a of ancestors(id)) if (collapsed.delete(a.id)) changed = true;
    draw();
    tbody.querySelectorAll('tr').forEach((r) => r.classList.toggle('sel', r.dataset.id === String(id)));
    if (focus && mode === 'tree') { const e = byId.get(id); ctrl.focus(e._x + BW / 2, e._y + BH / 2, 1.1); }
    showPanel(el);
    void changed; void keepView;
  }

  function showPanel(el) {
    const k = FIBER_KIND[el.kind];
    const desc = descendants(el.id);
    const naps = desc.filter((d) => d.kind === 'nap'), clients = desc.filter((d) => d.kind === 'client');
    const path = [...ancestors(el.id), el];
    const p = el.props || {};
    const fields = (FIBER_PROPS[el.kind] || []).map(([key, label]) => [label, p[key] != null && p[key] !== '' ? `${p[key]}${UNITS[key] ? ' ' + UNITS[key] : ''}` : null]);
    const extra = [];
    if (el.kind === 'cable' && p.fibras_total != null) extra.push(['Fibras disponibles', `${Math.max(0, Number(p.fibras_total) - Number(p.fibras_usadas || 0))} de ${p.fibras_total}`]);
    if (el.kind === 'nap' && p.puertos != null) extra.push(['Puertos disponibles', `${Math.max(0, Number(p.puertos) - Number(p.puertos_usados || 0))} de ${p.puertos}`]);
    const allowed = FIBER_CHILDREN[el.kind] || [];
    const body = h('div', { class: 'card-stack' },
      h('div', { class: 'row gap wrap' }, h('span', { class: 'chip', style: { '--c': k.color } }, k.label), badge(el.status)),
      h('div', null, h('div', { class: 'muted small' }, 'Ruta de fibra'), h('div', { class: 'row wrap', style: { gap: '4px', marginTop: '4px' } },
        path.flatMap((e, i) => [i ? h('span', { class: 'muted' }, '→') : null, h('a', { class: 'chip', style: { '--c': FIBER_KIND[e.kind]?.color, cursor: 'pointer' }, onclick: () => select(e.id, { focus: true }) }, e.name)]))),
      props([
        ['Código', el.code], ['Equipo vinculado', el.device_id ? h('a', { class: 'link', href: `#/inventario?device=${el.device_id}` }, 'Ver equipo') : null],
        ['Nodo', el.node_id ? h('a', { class: 'link', href: `#/nodo/${el.node_id}` }, nodes.find((n) => n.id === el.node_id)?.name || 'Ver nodo') : null],
        ['Coordenadas', el.lat != null ? `${el.lat}, ${el.lng}` : null], ...fields, ...extra, ['Observaciones', el.notes],
      ]),
      desc.length ? h('div', { class: 'box' },
        h('div', null, h('b', null, clients.length), ' clientes · ', h('b', null, naps.length), ' NAP · ', h('b', null, desc.length), ' elementos dependen de este tramo'),
        clients.length ? h('ul', { class: 'simple' }, clients.slice(0, 12).map((c) => h('li', null, h('a', { class: 'link', onclick: () => select(c.id, { focus: true }) }, c.name))), clients.length > 12 ? h('li', { class: 'muted' }, `… y ${clients.length - 12} más`) : null) : null) : null,
      h('div', { class: 'row gap wrap' },
        btn('Impacto de falla', { ic: 'alert', onClick: () => showImpact('fiber', el.id) }),
        el.lat != null || el.node_id ? btn('Ver en mapa', { ic: 'map', onClick: () => go(`#/mapa?fiber=${el.id}`) }) : null,
        can('write') && allowed.length ? btn('Agregar elemento', { ic: 'plus', kind: 'primary', onClick: () => createElement(el) }) : null,
        can('update') ? btn('Editar', { ic: 'edit', onClick: async () => { if (await elementForm(el)) reload(); } }) : null,
        can('write') ? btn('Eliminar', { ic: 'trash', kind: 'danger', onClick: async () => {
          if (!(await confirmBox(`¿Eliminar «${el.name}»${desc.length ? ` y los ${desc.length} elementos que dependen de él` : ''}?`))) return;
          if (await guard(() => api.del(`/api/fiber/${el.id}`))) { toast('Elemento eliminado'); selId = null; closePanel(true); reload(); }
        } }) : null),
      h('h4', null, 'Fotografías y documentos'), filesWidget('fiber', el.id), h('h4', null, 'Historial'), historyList('fiber', el.id, 10));
    openPanel(el.name, body, { subtitle: k.label, onClose: () => { selId = null; draw(); tbody.querySelectorAll('tr.sel').forEach((r) => r.classList.remove('sel')); } });
  }

  async function createElement(parent) {
    let kind;
    const allowed = parent ? FIBER_CHILDREN[parent.kind] : Object.keys(FIBER_KIND);
    if (allowed.length === 1) kind = allowed[0];
    else {
      const v = await formModal({ title: parent ? `Agregar bajo «${parent.name}»` : 'Nuevo elemento raíz', submitLabel: 'Continuar', fields: [{ name: 'kind', label: 'Tipo de elemento', type: 'select', options: allowed.map((k) => [k, FIBER_KIND[k].label]) }] });
      if (!v) return;
      kind = v.kind;
    }
    const created = await elementForm(null, { parent, kind });
    if (created) { selId = created.id; await reload(); select(created.id, { focus: true }); }
  }

  async function elementForm(el, { parent = null, kind = el?.kind } = {}) {
    const devices = await api.get('/api/devices');
    const propDefs = FIBER_PROPS[kind] || [];
    const vals = { ...(el || { status: 'operativo', parent_id: parent?.id ?? null, node_id: parent?.node_id ?? null }), ...Object.fromEntries(propDefs.map(([key]) => [`p_${key}`, el?.props?.[key] ?? ''])) };
    const portSel = h('select', { name: 'port_id' }, h('option', { value: '' }, '— Puerto (opcional) —'));
    const loadPorts = async (devId, keep) => {
      clear(portSel); portSel.append(h('option', { value: '' }, '— Puerto (opcional) —'));
      if (!devId) return;
      const d = await guard(() => api.get(`/api/devices/${devId}/full`));
      for (const pt of d?.ports || []) portSel.append(h('option', { value: pt.id, selected: String(pt.id) === String(keep) }, `${pt.name}${pt.link ? ' · en uso' : ''}`));
    };
    if (el?.device_id) await loadPorts(el.device_id, el.port_id);
    const fields = [
      { name: 'name', label: 'Nombre', required: true, maxlength: 80 }, { name: 'code', label: 'Código / identificador', maxlength: 40 },
      { name: 'status', label: 'Estado', type: 'select', options: Object.entries(STATUS).map(([k, o]) => [k, o.label]) },
      { name: 'node_id', label: 'Nodo (ubicación)', type: 'select', options: [['', '— Ninguno —'], ...nodes.map((n) => [n.id, n.name])] },
      { name: 'lat', label: 'Latitud', type: 'number', step: 'any' }, { name: 'lng', label: 'Longitud', type: 'number', step: 'any' },
    ];
    if (['olt', 'pon', 'odf'].includes(kind)) {
      fields.push({
        name: 'device_id', label: 'Equipo del inventario', type: 'select', options: [['', '— Ninguno —'], ...devices.map((d) => [d.id, d.name])],
        onChange: (sel) => loadPorts(sel.value),
      }, { name: 'port_id', type: 'custom', label: 'Puerto del equipo', render: () => ({ el: portSel, get: () => portSel.value }) });
    }
    if (propDefs.length) fields.push({ name: 'sec', type: 'section', label: `Características técnicas · ${FIBER_KIND[kind].label}` });
    for (const [key, label, type] of propDefs) fields.push({ name: `p_${key}`, label, type: type === 'number' ? 'number' : 'text', step: 'any' });
    fields.push({ name: 'notes', label: 'Observaciones', type: 'textarea' });
    const v = await formModal({ title: el ? `Editar · ${el.name}` : `Nuevo ${FIBER_KIND[kind].label.toLowerCase()}`, fields, values: vals, wide: true });
    if (!v) return null;
    const pr = { ...(el?.props || {}) };
    for (const [key, , type] of propDefs) {
      const raw = v[`p_${key}`];
      if (raw === '' || raw == null) delete pr[key]; else pr[key] = type === 'number' ? Number(raw) : raw;
    }
    const body = { name: v.name, code: v.code, status: v.status, node_id: v.node_id === '' ? null : Number(v.node_id), lat: v.lat, lng: v.lng, notes: v.notes, props: pr };
    if ('device_id' in v) { body.device_id = v.device_id === '' ? null : Number(v.device_id); body.port_id = v.port_id === '' || v.port_id == null ? null : Number(v.port_id); }
    if (!el) { body.kind = kind; body.parent_id = parent?.id ?? null; }
    return guard(() => (el ? api.patch(`/api/fiber/${el.id}`, body) : api.post('/api/fiber', body)));
  }

  svg.addEventListener('click', () => { if (!ctrl.justPanned() && selId) { selId = null; closePanel(true); draw(); } });
  search.addEventListener('input', debounce(() => { draw(); renderList(); }, 200));
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const term = search.value.trim().toLowerCase();
    const m = items.find((it) => `${it.name} ${it.code} ${JSON.stringify(it.props)}`.toLowerCase().includes(term));
    if (mode === 'tree') { if (m) select(m.id, { focus: true }); else toast('Sin coincidencias', 'warn'); }
  });

  index();
  setMode(mode);
  if (items.filter((e) => e.kind === 'client').length > 40) for (const e of items) if (e.kind === 'nap') collapsed.add(e.id);
  draw();
  requestAnimationFrame(() => {
    if (mode === 'tree') ctrl.fit(bbox, 20, 1.2);
    if (query.sel && byId.has(Number(query.sel))) select(Number(query.sel), { focus: true });
  });
  if (!items.length) host.append(h('div', { class: 'empty', style: { position: 'absolute', inset: 'auto 0 20% 0' } }, can('write') ? 'Use «Nuevo elemento raíz» para crear la primera OLT.' : ''));
}
