// Topología de conexiones de un nodo: equipos como cajas, conexiones físicas (sólidas) y lógicas (punteadas)
import { api } from '../api.js';
import { STATUS, DEVICE_TYPE } from '../catalog.js';
import { h, s, btn, clear, openPanel, closePanel, panZoom, zoomToolbar, emptyState, guard, can, go } from '../ui.js';
import { connectionCard, deviceCard, connectionForm } from '../shared.js';

const BW = 196, BH = 52, COLW = 300, SLOT = 15, GAPY = 26;
const TIER = { router: 0, olt: 0, switch: 1, odf: 2, patch_panel: 2, server: 2, radio: 2, onu: 2, other: 2, ups: 3, pdu: 3, organizer: 3 };
const LOGICAL_COLOR = '#8b5cf6';

export async function topologyView(root, node, query = {}) {
  clear(root);
  const conns = await guard(() => api.get(`/api/nodes/${node.id}/connections`)) || [];
  const local = new Map(node.devices.map((d) => [d.id, d]));
  const opts = { physical: true, logical: true, orphans: false };

  const toolbar = h('div', { class: 'toolbar' });
  const svg = s('svg', { class: 'canvas', role: 'img', 'aria-label': 'Topología de conexiones del nodo' });
  const ctrl = panZoom(svg, { min: 0.2, max: 4 });
  const scene = s('g');
  ctrl.vp.append(scene);
  svg.prepend(s('defs', null, s('filter', { id: 'tglow' }, s('feGaussianBlur', { stdDeviation: 3 }))));
  const legend = h('div', { class: 'legend' },
    h('span', null, h('i', { style: { background: '#22c55e' } }), 'Física operativa'), h('span', null, h('i', { style: { background: LOGICAL_COLOR } }), 'Lógica (punteada)'),
    h('span', null, h('i', { style: { background: '#f59e0b' } }), 'Degradada'), h('span', null, h('i', { style: { background: '#ef4444' } }), 'Fuera de servicio'));
  const host = h('div', { class: 'svg-host tall' }, svg, legend);

  const toggle = (key, label) => {
    const b = h('button', { class: `btn ${opts[key] ? 'on' : ''}`, type: 'button', onclick: () => { opts[key] = !opts[key]; b.classList.toggle('on', opts[key]); draw(); } }, label);
    return b;
  };
  toolbar.append(toggle('physical', 'Físicas'), toggle('logical', 'Lógicas'), toggle('orphans', 'Equipos sin conexiones'));
  const actions = h('div', { class: 'row gap', style: { marginLeft: 'auto' } });
  if (can('write')) actions.append(btn('Nueva conexión', { ic: 'plus', kind: 'primary', onClick: async () => { if (await connectionForm()) reload(); } }));
  ctrl.refit = () => ctrl.fit(bbox, 30, 1.2);
  actions.append(zoomToolbar(ctrl));
  toolbar.append(actions);
  root.append(toolbar, host);

  let sel = null; // {type:'conn'|'dev', id}
  let bbox = { x: 0, y: 0, w: 800, h: 400 };
  let allConns = conns;

  async function reload() {
    allConns = await guard(() => api.get(`/api/nodes/${node.id}/connections`)) || [];
    draw();
  }

  function draw() {
    clear(scene);
    const list = allConns.filter((c) => (c.layer === 'physical' ? opts.physical : opts.logical));
    if (!list.length && !opts.orphans) {
      scene.append(s('text', { x: 40, y: 60, fill: '#8fa0bd', 'font-size': 14 }, 'Este nodo no tiene conexiones registradas para las capas seleccionadas.'));
      bbox = { x: 0, y: 0, w: 600, h: 120 };
      return;
    }
    const used = new Set();
    for (const c of list) { used.add(c.a_device_id); used.add(c.b_device_id); }
    const cols = [[], [], [], [], []];
    for (const d of node.devices) {
      if (!used.has(d.id) && !opts.orphans) continue;
      const t = TIER[d.type] ?? 2;
      cols[t].push({ id: d.id, name: d.name, sub: [d.brand, d.model].filter(Boolean).join(' ') || DEVICE_TYPE[d.type]?.label, type: d.type, status: d.status, ghost: false });
    }
    const ext = new Map();
    for (const c of list) {
      for (const side of ['a', 'b']) {
        const id = c[`${side}_device_id`];
        if (!local.has(id) && !ext.has(id)) ext.set(id, { id, name: c[`${side}_device_name`], sub: c[`${side}_node_name`] || 'otro nodo', type: 'other', status: 'operativo', ghost: true, nodeId: c[`${side}_node_id`] });
      }
    }
    cols[4] = [...ext.values()].sort((a, b) => a.sub.localeCompare(b.sub));
    const usedCols = cols.map((c, i) => (c.length ? i : -1)).filter((i) => i >= 0);
    const pos = new Map();
    usedCols.forEach((ci, k) => { cols[ci].sort((a, b) => a.name.localeCompare(b.name)); for (const n of cols[ci]) { n.col = k; n.x = 40 + k * COLW; pos.set(n.id, n); } });

    // Lado de salida de cada extremo y reparto de "ranuras" para que los cables no se amontonen
    const ends = new Map(); // `${devId}|${side}` -> [{c, end}]
    const edgeInfo = [];
    for (const c of list) {
      const A = pos.get(c.a_device_id), B = pos.get(c.b_device_id);
      if (!A || !B) continue;
      let sa, sb;
      if (A.col === B.col) { sa = 'R'; sb = 'R'; } else if (A.col < B.col) { sa = 'R'; sb = 'L'; } else { sa = 'L'; sb = 'R'; }
      const info = { c, A, B, sa, sb };
      edgeInfo.push(info);
      for (const [n, sd, end] of [[A, sa, 'a'], [B, sb, 'b']]) {
        const key = `${n.id}|${sd}`;
        if (!ends.has(key)) ends.set(key, []);
        ends.get(key).push({ info, end });
      }
    }
    for (const n of pos.values()) {
      const slots = Math.max(ends.get(`${n.id}|L`)?.length || 0, ends.get(`${n.id}|R`)?.length || 0);
      n.h = Math.max(BH, slots * SLOT + 16);
    }
    // Apila cada columna con alturas variables y centra respecto a la más alta
    const colH = usedCols.map((_, k) => { const ns = [...pos.values()].filter((n) => n.col === k); return ns.reduce((a, n) => a + n.h, 0) + (ns.length - 1) * GAPY; });
    const maxH = Math.max(...colH, BH);
    usedCols.forEach((_, k) => {
      let y = 40 + (maxH - colH[k]) / 2;
      for (const n of [...pos.values()].filter((x) => x.col === k)) { n.y = y; y += n.h + GAPY; }
    });
    // Ordena por la posición vertical del otro extremo y asigna ranuras
    for (const [key, arr] of ends) {
      const [id] = key.split('|');
      arr.sort((p, q) => {
        const oy = (e) => { const o = e.end === 'a' ? e.info.B : e.info.A; return o.y + o.h / 2; };
        return oy(p) - oy(q) || p.info.c.id - q.info.c.id;
      });
      const n = pos.get(Number(id));
      arr.forEach((e, i) => { e.info[`y${e.end}`] = n.y + n.h / 2 + (i - (arr.length - 1) / 2) * SLOT; });
    }

    const edges = s('g');
    edgeInfo.forEach((info, idx) => {
      const { c, A, B, sa, sb } = info;
      const x1 = sa === 'R' ? A.x + BW : A.x, y1 = info.ya, x2 = sb === 'R' ? B.x + BW : B.x, y2 = info.yb;
      let d, mid;
      if (A.col === B.col) {
        const bulge = 60 + (idx % 5) * 14;
        d = `M ${x1} ${y1} C ${x1 + bulge} ${y1}, ${x2 + bulge} ${y2}, ${x2} ${y2}`; mid = [x1 + bulge * 0.75, (y1 + y2) / 2];
      } else {
        const dx = Math.abs(x2 - x1) * 0.5, dir = sa === 'R' ? 1 : -1;
        d = `M ${x1} ${y1} C ${x1 + dir * dx} ${y1}, ${x2 - dir * dx} ${y2}, ${x2} ${y2}`; mid = [(x1 + x2) / 2, (y1 + y2) / 2];
      }
      const logical = c.layer === 'logical';
      const color = c.status !== 'operativo' && STATUS[c.status] ? STATUS[c.status].color : logical ? LOGICAL_COLOR : '#22c55e';
      const isSel = sel?.type === 'conn' && sel.id === c.id;
      const involves = sel?.type === 'dev' && (sel.id === c.a_device_id || sel.id === c.b_device_id);
      const dim = sel && !isSel && !involves;
      const g = s('g', { 'data-nopan': '', class: dim ? 'dim' : '' });
      g.append(s('path', { d, class: `edge ${logical ? 'logical' : ''} ${isSel ? 'sel' : ''}`, stroke: isSel ? '#38bdf8' : color, 'stroke-opacity': isSel || involves ? 1 : 0.85 }));
      g.append(s('path', { d, class: 'edge-hit' }));
      const outA = sa === 'R', outB = sb === 'R';
      if (c.a_port_name) g.append(s('text', { x: x1 + (outA ? 6 : -6), y: y1 - 3, class: 'edge-lbl', 'text-anchor': outA ? 'start' : 'end' }, c.a_port_name));
      if (c.b_port_name) g.append(s('text', { x: x2 + (outB ? 6 : -6), y: y2 - 3, class: 'edge-lbl', 'text-anchor': outB ? 'start' : 'end' }, c.b_port_name));
      if (isSel && (c.vlan || c.speed || c.cable_id)) g.append(s('text', { x: mid[0], y: mid[1] - 8, class: 'edge-lbl', 'text-anchor': 'middle', fill: '#e0f2fe' }, [c.cable_id, c.speed, c.vlan && `VLAN ${c.vlan}`].filter(Boolean).join(' · ')));
      g.addEventListener('click', (e) => { e.stopPropagation(); if (!ctrl.justPanned()) selectConn(c); });
      edges.append(g);
    });
    scene.append(edges);

    // Cajas
    for (const n of pos.values()) {
      const dt = DEVICE_TYPE[n.type] || DEVICE_TYPE.other;
      const isSel = sel?.type === 'dev' && sel.id === n.id;
      const connected = sel?.type === 'conn' ? (allConns.find((c) => c.id === sel.id && (c.a_device_id === n.id || c.b_device_id === n.id))) : null;
      const dim = sel && !isSel && !connected && !(sel.type === 'dev' && list.some((c) => (c.a_device_id === sel.id && c.b_device_id === n.id) || (c.b_device_id === sel.id && c.a_device_id === n.id)));
      const g = s('g', { class: `node-box ${isSel || connected ? 'sel' : ''} ${n.ghost ? 'ghostnode' : ''} ${dim ? 'dim' : ''}`, transform: `translate(${n.x} ${n.y})`, 'data-nopan': '' },
        s('rect', { class: 'bx', width: BW, height: n.h, rx: 9 }),
        s('rect', { width: 6, height: n.h, rx: 3, fill: n.ghost ? '#475569' : dt.color }),
        s('text', { class: 't1', x: 16, y: n.h / 2 - 3 }, n.name.length > 24 ? n.name.slice(0, 23) + '…' : n.name),
        s('text', { class: 't2', x: 16, y: n.h / 2 + 13 }, (n.ghost ? '↗ ' : '') + String(n.sub || '').slice(0, 30)),
        n.ghost ? null : s('circle', { cx: BW - 12, cy: 12, r: 4, fill: STATUS[n.status]?.color || '#94a3b8' }));
      g.addEventListener('click', (e) => { e.stopPropagation(); if (!ctrl.justPanned()) selectDev(n); });
      scene.append(g);
    }
    bbox = { x: 0, y: 0, w: usedCols.length * COLW + 60, h: maxH + 80 };
  }

  async function selectConn(c) {
    sel = { type: 'conn', id: c.id }; draw();
    const full = await guard(() => api.get(`/api/connections/${c.id}`));
    if (!full) return;
    openPanel(`Conexión #${c.id}`, connectionCard(full, { onChanged: () => { sel = null; closePanel(true); reload(); } }), { subtitle: `${full.a_device_name} ⇄ ${full.b_device_name}`, onClose: () => { sel = null; draw(); } });
  }

  async function selectDev(n) {
    sel = { type: 'dev', id: n.id }; draw();
    if (n.ghost) {
      openPanel(n.name, h('div', { class: 'card-stack' }, h('p', null, 'Equipo de otro nodo.'), n.nodeId ? h('a', { class: 'link', href: `#/nodo/${n.nodeId}/topologia` }, 'Abrir topología de ese nodo →') : null), { subtitle: n.sub, onClose: () => { sel = null; draw(); } });
      return;
    }
    const full = await guard(() => api.get(`/api/devices/${n.id}/full`));
    if (!full) return;
    openPanel(full.name, deviceCard(full, { onChanged: () => { closePanel(true); sel = null; go(location.hash); } }), { onClose: () => { sel = null; draw(); } });
  }

  svg.addEventListener('click', () => { if (!ctrl.justPanned() && sel) { sel = null; closePanel(true); draw(); } });
  draw();
  requestAnimationFrame(() => ctrl.fit(bbox, 30, 1.2));
}
