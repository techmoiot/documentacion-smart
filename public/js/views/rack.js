// Editor gráfico de racks (vista frontal): equipos por U, puertos, cables y destinos
import { api } from '../api.js';
import { STATUS, DEVICE_TYPE, PORT_KIND } from '../catalog.js';
import {
  h, s, btn, badge, icon, props, clear, can, guard, toast, confirmBox, openPanel, closePanel, panZoom, zoomToolbar, emptyState, go,
} from '../ui.js';
import { deviceForm, rackForm, connectionForm, connectionCard, deviceCard } from '../shared.js';

const UH = 46, TOP = 16, NUM_W = 36, RAIL = 16, INNER = 720, LANE = 230, LABEL_W = 176, GAP = 12;
const X0 = NUM_W + RAIL, X1 = X0 + INNER, LANE_X = X1 + RAIL + 24;
const W = X1 + RAIL + LANE;

const statusColor = (st) => STATUS[st]?.color || '#94a3b8';

/** Calcula la posición de cada puerto dentro de la cara frontal del equipo (coordenadas relativas). */
function layoutPorts(d, heightPx) {
  const ports = d.ports || [];
  if (!ports.length) return [];
  const groups = [];
  for (const p of ports) {
    const last = groups[groups.length - 1];
    if (last && last.kind === p.kind) last.items.push(p); else groups.push({ kind: p.kind, items: [p] });
  }
  const rows = ports.length > 14 || d.u_height >= 2 ? 2 : 1;
  const ch = Math.min(24, (heightPx - 16) / rows - 4);
  const availW = INNER - LABEL_W - 24;
  const cols = groups.map((g) => Math.ceil(g.items.length / rows));
  const totalCols = cols.reduce((a, b) => a + b, 0);
  const pitch = Math.min(28, (availW - GAP * (groups.length - 1)) / totalCols);
  const cw = Math.max(5, pitch - 3);
  const blockH = rows * (ch + 4) - 4;
  const top = (heightPx - blockH) / 2;
  const out = [];
  let x = LABEL_W + 8;
  groups.forEach((g, gi) => {
    g.items.forEach((p, i) => {
      const col = Math.floor(i / rows), row = i % rows;
      out.push({ port: p, x: x + col * pitch, y: top + row * (ch + 4), w: cw, h: ch });
    });
    x += cols[gi] * pitch + GAP;
  });
  return out;
}

export async function rackView(root, node, rackId, query = {}) {
  clear(root);
  const racks = node.racks || [];
  const canWrite = can('write');
  const activeId = racks.find((r) => String(r.id) === String(rackId))?.id ?? racks[0]?.id;

  const toolbar = h('div', { class: 'toolbar' });
  const stage = h('div', { class: 'stage' });
  root.append(toolbar, stage);

  const chips = h('div', { class: 'chips' }, racks.map((r) => h('a', { class: `chip-tab ${r.id === activeId ? 'active' : ''}`, href: `#/nodo/${node.id}/rack/${r.id}` }, `${r.name} · ${r.units}U`)));
  toolbar.append(chips);
  if (canWrite) toolbar.append(btn('Nuevo rack', { ic: 'plus', onClick: async () => { const r = await rackForm(node.id); if (r) go(`#/nodo/${node.id}/rack/${r.id}`); } }));
  if (!activeId) {
    stage.append(emptyState('Este nodo aún no tiene racks.', canWrite ? btn('Crear el primer rack', { kind: 'primary', ic: 'plus', onClick: async () => { const r = await rackForm(node.id); if (r) go(`#/nodo/${node.id}/rack/${r.id}`); } }) : null));
    return;
  }

  let rack = null;
  let selDevice = null, selPort = null, selConn = null, showAll = false;
  let unmounted = [];
  let side = query.side === 'rear' ? 'rear' : 'front';   // lado visible del rack
  const onSide = (d) => (d.rack_side || 'front') === 'both' || (d.rack_side || 'front') === side;
  const applySide = () => { rack.devices = rack.all.filter(onSide); };

  const svg = s('svg', { class: 'canvas', role: 'img', 'aria-label': 'Vista frontal del rack' });
  const ctrl = panZoom(svg, { min: 0.3, max: 8 });
  const scene = s('g', { class: 'scene' });
  ctrl.vp.append(scene);
  const defs = s('defs', null,
    s('filter', { id: 'glow', x: '-30%', y: '-30%', width: '160%', height: '160%' }, s('feGaussianBlur', { stdDeviation: '3', result: 'b' }), s('feMerge', null, s('feMergeNode', { in: 'b' }), s('feMergeNode', { in: 'SourceGraphic' }))),
    s('linearGradient', { id: 'face', x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: '0', 'stop-color': '#2a3550' }), s('stop', { offset: '1', 'stop-color': '#1a2238' })));
  svg.prepend(defs);

  const legend = h('div', { class: 'legend' },
    h('span', null, h('i', { style: { background: '#22c55e' } }), 'Conectado'), h('span', null, h('i', { style: { background: '#0b1220', border: '1px solid #475569' } }), 'Libre'),
    h('span', null, h('i', { style: { background: '#f59e0b' } }), 'Degradado'), h('span', null, h('i', { style: { background: '#ef4444' } }), 'Fuera de servicio'),
    h('span', null, h('i', { style: { background: '#38bdf8' } }), 'Seleccionado'));
  const hint = h('div', { class: 'hint' }, canWrite ? 'Clic en un equipo o puerto · arrastre un equipo para moverlo · clic en una U vacía para agregar' : 'Clic en un equipo o puerto para ver su información');
  const hostBox = h('div', { class: 'svg-host' }, svg, legend, hint);
  stage.append(hostBox);

  const cablesBtn = h('button', { class: 'btn', type: 'button', onclick: () => { showAll = !showAll; cablesBtn.classList.toggle('on', showAll); draw(); } }, icon('link', 15), h('span', null, 'Ver todos los cables'));
  const unmountedBox = h('div', { class: 'unmounted' });
  stage.append(unmountedBox);

  async function load() {
    const [r, devs] = await Promise.all([api.get(`/api/racks/${activeId}/full`), api.get(`/api/devices?node_id=${node.id}`)]);
    rack = r; rack.all = r.devices; applySide();
    unmounted = devs.filter((d) => !d.rack_id);
    renderToolbarActions();
    renderUnmounted();
    draw();
  }

  function renderToolbarActions() {
    toolbar.querySelectorAll('.rk-actions').forEach((n) => n.remove());
    const box = h('div', { class: 'rk-actions row gap wrap' });
    if (canWrite) {
      box.append(
        btn('Agregar equipo', { ic: 'plus', kind: 'primary', onClick: () => addDevice(null) }),
        btn('', { ic: 'edit', title: 'Editar rack', onClick: async () => { if (await rackForm(node.id, rack)) { Object.assign(node.racks.find((x) => x.id === rack.id), await api.get(`/api/racks/${rack.id}`)); go(location.hash); } } }),
        btn('', { ic: 'trash', title: 'Eliminar rack', onClick: async () => {
          if (!(await confirmBox(`¿Eliminar el rack «${rack.name}»? Sus equipos no se borran: quedan sin rack en el inventario.`))) return;
          if (await guard(() => api.del(`/api/racks/${rack.id}`))) { toast('Rack eliminado'); go(`#/nodo/${node.id}/rack`); }
        } }));
    }
    const sideBtn = (key, label) => h('button', { class: `btn ${side === key ? 'on' : ''}`, type: 'button', title: key === 'front' ? 'Ver el frente del rack' : 'Ver la parte posterior del rack', onclick: () => setSide(key) }, label);
    box.append(h('div', { class: 'seg' }, sideBtn('front', 'Frente'), sideBtn('rear', 'Atrás')));
    const viewBtn = h('button', { class: 'btn', type: 'button', title: 'Alternar entre la zona ocupada y el rack completo', onclick: () => { fullView = !fullView; viewBtn.classList.toggle('on', fullView); fitAll(); } }, icon('rack', 15), h('span', null, 'Rack completo'));
    box.append(viewBtn, cablesBtn, zoomToolbar(Object.assign(ctrl, { refit: fitAll })));
    toolbar.append(box);
  }

  function setSide(key) {
    if (side === key) return;
    side = key; selDevice = null; selPort = null; selConn = null; closePanel(true);
    applySide(); renderToolbarActions(); svg.setAttribute('aria-label', side === 'rear' ? 'Vista posterior del rack' : 'Vista frontal del rack'); draw(); fitAll();
  }

  function renderUnmounted() {
    clear(unmountedBox);
    if (!unmounted.length) return;
    unmountedBox.append(h('h4', null, `Equipos de este nodo sin rack (${unmounted.length})`),
      h('div', { class: 'chips' }, unmounted.map((d) => h('button', { class: 'chip-tab', type: 'button', onclick: async () => {
        const full = await guard(() => api.get(`/api/devices/${d.id}/full`));
        if (full) openPanel(full.name, deviceCard(full, { onChanged: () => { closePanel(); load(); } }));
      } }, d.name))));
  }

  const slotY = (u) => TOP + (rack.units - u) * UH;
  const devTop = (d) => TOP + (rack.units - (d.rack_u + d.u_height - 1)) * UH;

  let fullView = false;
  function fitAll() {
    const totalH = TOP * 2 + rack.units * UH;
    if (fullView || !rack.devices.length) { ctrl.fit({ x: 0, y: 0, w: W, h: totalH }, 10, 1.6); return; }
    // Encuadre inicial: zona ocupada (+1 U de margen), para ver los equipos con detalle
    const minU = Math.max(1, Math.min(...rack.devices.map((d) => d.rack_u)) - 1);
    const maxU = Math.min(rack.units, Math.max(...rack.devices.map((d) => d.rack_u + d.u_height - 1)) + 1);
    const y = slotY(maxU), hh = (maxU - minU + 1) * UH;
    ctrl.fit({ x: 0, y, w: W, h: hh }, 10, 1.6);
  }

  // Mapa portId → posición absoluta en el rack
  let portPos = new Map();
  let linkIndex = []; // conexiones físicas visibles

  function draw() {
    clear(scene);
    portPos = new Map();
    const totalH = TOP * 2 + rack.units * UH;

    // Bastidor
    scene.append(
      s('text', { x: NUM_W + (INNER + RAIL * 2) / 2, y: 14, 'text-anchor': 'middle', class: 'unum', fill: side === 'rear' ? '#f59e0b' : '#64748b', 'font-weight': 700 }, side === 'rear' ? 'VISTA POSTERIOR (ATRÁS)' : 'VISTA FRONTAL'),
      s('rect', { x: NUM_W, y: 0, width: INNER + RAIL * 2, height: totalH, rx: 6, fill: side === 'rear' ? '#14110a' : '#0c1424', stroke: side === 'rear' ? '#78561a' : '#334155', 'stroke-width': 2 }),
      s('rect', { x: X0, y: TOP, width: INNER, height: rack.units * UH, fill: '#070d1a' }));

    const occupied = new Set();
    for (const d of rack.devices) for (let u = d.rack_u; u < d.rack_u + d.u_height; u++) occupied.add(u);

    // Numeración y ranuras vacías
    for (let u = 1; u <= rack.units; u++) {
      const y = slotY(u);
      scene.append(s('text', { x: NUM_W - 6, y: y + UH / 2 + 4, 'text-anchor': 'end', class: 'unum' }, String(u)));
      scene.append(s('line', { x1: X0, x2: X1, y1: y, y2: y, class: 'uline' }));
      for (const sx of [NUM_W + 8, X1 + 8]) scene.append(s('circle', { cx: sx, cy: y + UH / 2, r: 2.5, class: 'screw' }));
      if (!occupied.has(u)) {
        const slot = s('g', { class: 'slot', 'data-nopan': canWrite ? '' : null },
          s('rect', { x: X0, y: y + 1, width: INNER, height: UH - 2 }), s('text', { x: X0 + INNER / 2, y: y + UH / 2 + 5, 'text-anchor': 'middle' }, canWrite ? `+ U${u}` : ''));
        if (canWrite) slot.addEventListener('click', () => { if (!ctrl.justPanned()) addDevice(u); });
        scene.append(slot);
      }
    }

    // Equipos
    for (const d of rack.devices) drawDevice(d);

    // Cables
    drawCables();
  }

  function drawDevice(d) {
    const y = devTop(d), hpx = d.u_height * UH;
    const dt = DEVICE_TYPE[d.type] || DEVICE_TYPE.other;
    const isSel = selDevice === d.id;
    const g = s('g', { class: `dev ${isSel ? 'sel' : ''}`, 'data-dev': d.id, 'data-nopan': canWrite ? '' : null, transform: `translate(${X0} ${y})` });
    g.append(
      s('rect', { x: 1, y: 1, width: INNER - 2, height: hpx - 2, rx: 3, fill: 'url(#face)', class: 'face', stroke: isSel ? '#38bdf8' : '#3b4a6b', 'stroke-width': isSel ? 2.5 : 1 }),
      s('rect', { x: 1, y: 1, width: 6, height: hpx - 2, rx: 2, fill: dt.color }),
      s('text', { x: 16, y: hpx > UH ? 22 : 19, class: 'dname' }, d.name.length > 24 ? d.name.slice(0, 23) + '…' : d.name),
      s('text', { x: 16, y: hpx > UH ? 38 : 33, class: 'dmodel' }, [d.brand, d.model].filter(Boolean).join(' ').slice(0, 30) || dt.label),
      s('circle', { cx: INNER - 10, cy: 10, r: 3.5, fill: statusColor(d.status), class: 'led' }),
      s('title', null, `${d.name}${d.ip ? ' · ' + d.ip : ''} · U${d.rack_u}${d.u_height > 1 ? '–U' + (d.rack_u + d.u_height - 1) : ''}`));
    if (hpx > UH) g.append(s('text', { x: 16, y: 54, class: 'dmodel' }, d.ip || ''));
    else if (d.ip) g.append(s('text', { x: 16, y: hpx - 4, class: 'dip' }, d.ip));

    const lay = layoutPorts(d, hpx);
    for (const pl of lay) {
      const p = pl.port;
      const linked = !!p.link;
      const isPortSel = selPort === p.id;
      const isRemote = selConn && p.link && p.link.conn_id === selConn && !isPortSel;
      const kc = PORT_KIND[p.kind]?.color || '#94a3b8';
      const fill = linked ? statusColor(p.link.status) : '#0b1220';
      const pg = s('g', { class: `port ${linked ? 'linked' : 'free'} ${isPortSel ? 'sel' : ''} ${isRemote ? 'remote' : ''}`, 'data-port': p.id, tabindex: 0, role: 'button', 'aria-label': `Puerto ${p.name} de ${d.name}` });
      const shape = ['pon', 'fiber'].includes(p.kind)
        ? s('circle', { cx: pl.x + pl.w / 2, cy: pl.y + pl.h / 2, r: Math.min(pl.w, pl.h) / 2, fill, stroke: kc, 'stroke-width': 1.2 })
        : ['sfp', 'sfp+', 'sfp28', 'qsfp+'].includes(p.kind)
          ? s('rect', { x: pl.x, y: pl.y, width: pl.w, height: pl.h, rx: 1, fill, stroke: kc, 'stroke-width': 1.6 })
          : s('rect', { x: pl.x, y: pl.y, width: pl.w, height: pl.h, rx: 2, fill, stroke: linked ? '#e2e8f0' : kc, 'stroke-opacity': linked ? 0.35 : 0.7, 'stroke-width': 1 });
      const tip = `${p.name}${p.label ? ' · ' + p.label : ''}${p.speed ? ' · ' + p.speed : ''}${linked ? ` → ${p.link.remote_device_name} : ${p.link.remote_port_name || '—'}` : ' · libre'}`;
      pg.append(shape, s('title', null, tip));
      if (pl.w >= 13 && pl.h >= 11) {
        const num = (p.name.match(/(\d+)$/) || [])[1] ?? '';
        pg.append(s('text', { x: pl.x + pl.w / 2, y: pl.y + pl.h / 2 + 3, 'text-anchor': 'middle', class: 'pnum', fill: linked ? '#06210f' : '#94a3b8' }, num));
      }
      pg.addEventListener('click', (e) => { e.stopPropagation(); if (!ctrl.justPanned()) selectPort(p.id, d.id); });
      pg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPort(p.id, d.id); } });
      g.append(pg);
      portPos.set(p.id, { x: X0 + pl.x + pl.w / 2, y: y + pl.y + pl.h / 2, dev: d, port: p });
    }

    attachDrag(g, d);
    scene.append(g);
  }

  function drawCables() {
    const layer = s('g', { class: 'cables', fill: 'none' });
    const seen = new Set();
    const items = [];
    for (const d of rack.devices) for (const p of d.ports) if (p.link && !seen.has(p.link.conn_id)) {
      seen.add(p.link.conn_id);
      items.push({ id: p.link.conn_id, a: p.id, link: p.link, devA: d });
    }
    linkIndex = items;
    const draw1 = (it, selected, idx) => {
      const A = portPos.get(it.a), B = portPos.get(it.link.remote_port_id);
      const col = selected ? '#38bdf8' : statusColor(it.link.status);
      const lx = LANE_X - 14 + ((idx % 8) * 7);
      if (!A) return;
      let d;
      if (B) d = `M ${A.x} ${A.y} C ${lx} ${A.y}, ${lx} ${B.y}, ${B.x} ${B.y}`;
      else d = `M ${A.x} ${A.y} L ${LANE_X} ${A.y}`;
      const grp = s('g', { class: 'cable', 'data-nopan': '' });
      if (selected) grp.append(s('path', { d, stroke: col, 'stroke-width': 7, opacity: 0.25, filter: 'url(#glow)' }));
      grp.append(s('path', { d, stroke: col, 'stroke-width': selected ? 3 : 1.4, opacity: selected ? 1 : 0.5, 'stroke-linecap': 'round', 'stroke-dasharray': it.link.status === 'pendiente' ? '5 4' : null }));
      grp.append(s('path', { d, stroke: 'transparent', 'stroke-width': 10, class: 'hit' }));
      grp.append(s('circle', { cx: A.x, cy: A.y, r: selected ? 4 : 2.5, fill: col }));
      if (B) grp.append(s('circle', { cx: B.x, cy: B.y, r: selected ? 4 : 2.5, fill: col }));
      grp.addEventListener('click', (e) => { e.stopPropagation(); selectPort(it.a, A.dev.id); });
      layer.append(grp);
      if (selected && !B) {
        const label = `→ ${it.link.remote_device_name}${it.link.remote_port_name ? ' : ' + it.link.remote_port_name : ''}`;
        const sub = it.link.remote_node_name || '';
        const pill = s('g', { class: 'pill', 'data-nopan': '', transform: `translate(${LANE_X + 4} ${A.y - 17})` },
          s('rect', { width: LANE - 40, height: 34, rx: 6 }), s('text', { x: 8, y: 14 }, label.length > 30 ? label.slice(0, 29) + '…' : label), s('text', { x: 8, y: 27, class: 'sub' }, sub.slice(0, 32)));
        pill.addEventListener('click', (e) => { e.stopPropagation(); gotoRemote(it.link); });
        layer.append(pill);
      }
    };
    items.forEach((it, i) => { if (showAll && it.id !== selConn) draw1(it, false, i); });
    const sel = items.find((it) => it.id === selConn);
    if (sel) draw1(sel, true, items.indexOf(sel));
    scene.append(layer);
  }

  // ---------- Arrastrar para mover ----------
  function attachDrag(g, d) {
    let drag = null;
    const ghost = () => {
      let el = scene.querySelector('.ghost');
      if (!el) { el = s('rect', { class: 'ghost', x: X0, width: INNER, rx: 3 }); scene.append(el); }
      return el;
    };
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.port')) return;
      drag = { y: e.clientY, moved: false, u: d.rack_u };
      if (canWrite) g.setPointerCapture(e.pointerId);
    });
    g.addEventListener('pointermove', (e) => {
      if (!drag || !canWrite) return;
      const dy = (e.clientY - drag.y) / ctrl.scale;
      if (!drag.moved && Math.abs(dy) < 6) return;
      drag.moved = true;
      let nu = d.rack_u - Math.round(dy / UH);
      nu = Math.max(1, Math.min(rack.units - d.u_height + 1, nu));
      drag.u = nu;
      const bad = rack.devices.some((o) => o.id !== d.id && nu <= o.rack_u + o.u_height - 1 && nu + d.u_height - 1 >= o.rack_u);
      const gh = ghost();
      gh.setAttribute('y', TOP + (rack.units - (nu + d.u_height - 1)) * UH);
      gh.setAttribute('height', d.u_height * UH);
      gh.setAttribute('class', `ghost ${bad ? 'bad' : 'ok'}`);
      g.style.opacity = 0.5;
    });
    const finish = async (e) => {
      if (!drag) return;
      const dr = drag; drag = null;
      g.style.opacity = '';
      scene.querySelector('.ghost')?.remove();
      try { g.releasePointerCapture(e.pointerId); } catch { /* sin captura */ }
      if (!dr.moved) { if (!ctrl.justPanned()) selectDevice(d.id); return; }
      if (dr.u === d.rack_u) return;
      const res = await guard(() => api.patch(`/api/devices/${d.id}`, { rack_u: dr.u }));
      if (res) toast(`«${d.name}» movido a U${dr.u}`);
      await load();
    };
    g.addEventListener('pointerup', finish);
    g.addEventListener('pointercancel', () => { drag = null; g.style.opacity = ''; scene.querySelector('.ghost')?.remove(); });
  }

  // ---------- Selección y paneles ----------
  function setUrl() {
    const q = new URLSearchParams();
    if (selDevice) q.set('device', selDevice);
    if (selPort) q.set('port', selPort);
    history.replaceState(null, '', `#/nodo/${node.id}/rack/${activeId}${q.toString() ? '?' + q : ''}`);
  }

  async function selectDevice(id, { focus = false } = {}) {
    selDevice = id; selPort = null; selConn = null;
    setUrl(); draw();
    const d = rack.devices.find((x) => x.id === id);
    if (!d) return;
    if (focus) focusDevice(d);
    const full = await guard(() => api.get(`/api/devices/${id}/full`));
    if (!full) return;
    openPanel(full.name, deviceCard(full, {
      onChanged: async (removed) => { if (removed) { selDevice = null; closePanel(true); } await load(); if (!removed) selectDevice(id); },
      onFocus: () => focusDevice(d),
    }), { subtitle: `${rack.name} · U${d.rack_u}${d.u_height > 1 ? '–U' + (d.rack_u + d.u_height - 1) : ''}`, onClose: () => { selDevice = null; selPort = null; selConn = null; setUrl(); draw(); } });
  }

  async function selectPort(portId, deviceId, { focus = false } = {}) {
    const d = rack.devices.find((x) => x.id === deviceId);
    const p = d?.ports.find((x) => x.id === portId);
    if (!p) return;
    selDevice = deviceId; selPort = portId; selConn = p.link?.conn_id ?? null;
    setUrl(); draw();
    if (focus) { const pos = portPos.get(portId); if (pos) ctrl.focus(pos.x, pos.y, 3); }
    const body = h('div', { class: 'card-stack' });
    body.append(props([
      ['Equipo', d.name], ['Puerto', p.name], ['Tipo', PORT_KIND[p.kind]?.label || p.kind], ['Velocidad', p.speed], ['Etiqueta', p.label],
      ['Estado', p.link ? 'Conectado' : 'Libre'],
    ]));
    if (can('update')) {
      body.append(btn('Etiqueta / velocidad', { ic: 'edit', onClick: async () => {
        const { formModal } = await import('../ui.js');
        const v = await formModal({ title: `Puerto ${p.name}`, values: p, fields: [{ name: 'label', label: 'Etiqueta (descripción del puerto)', maxlength: 120 }, { name: 'speed', label: 'Velocidad', maxlength: 40 }] });
        if (v && await guard(() => api.patch(`/api/ports/${p.id}`, v))) { await load(); selectPort(portId, deviceId); }
      } }));
    }
    if (p.link) {
      const conn = await guard(() => api.get(`/api/connections/${p.link.conn_id}`));
      if (conn) {
        const remote = h('div', { class: 'dest-banner' },
          h('div', { class: 'muted small' }, 'Este puerto está conectado a'),
          h('div', { class: 'dest-main' }, h('strong', null, p.link.remote_device_name), h('span', { class: 'chip' }, p.link.remote_port_name || '—')),
          h('div', { class: 'muted small' }, p.link.remote_node_name || ''),
          btn('Ir al destino', { ic: 'target', kind: 'primary', onClick: () => gotoRemote(p.link) }));
        body.append(remote, connectionCard(conn, { onChanged: async () => { await load(); selectPort(portId, deviceId); } }));
      }
    } else if (can('write')) {
      body.append(emptyState('Puerto libre.', btn('Conectar este puerto…', { ic: 'link', kind: 'primary', onClick: async () => {
        if (await connectionForm({ preset: { a_device_id: deviceId, a_port_id: portId, lockA: true } })) { await load(); selectPort(portId, deviceId); }
      } })));
    }
    openPanel(`${d.name} · ${p.name}`, body, { subtitle: `${rack.name} · U${d.rack_u}`, onClose: () => { selPort = null; selConn = null; setUrl(); draw(); } });
  }

  function gotoRemote(link) {
    const rdAll = rack.all.find((x) => x.id === link.remote_device_id);
    if (rdAll && !onSide(rdAll)) setSide(rdAll.rack_side === 'rear' ? 'rear' : 'front');
    const rd = rack.devices.find((x) => x.id === link.remote_device_id);
    if (rd) { selectPort(link.remote_port_id, rd.id, { focus: true }); return; }
    if (link.remote_node_id && link.remote_rack_id) go(`#/nodo/${link.remote_node_id}/rack/${link.remote_rack_id}?device=${link.remote_device_id}&port=${link.remote_port_id || ''}`);
    else if (link.remote_node_id) go(`#/nodo/${link.remote_node_id}/equipos`);
    else toast('El equipo de destino no está montado en un rack', 'warn');
  }

  function focusDevice(d) {
    const y = devTop(d);
    ctrl.fit({ x: X0, y, w: INNER, h: d.u_height * UH }, 30, 6);
  }

  async function addDevice(u) {
    const created = await deviceForm({ node_id: node.id, rack_id: activeId, rack_u: u, rack_side: side });
    if (created) { toast('Equipo agregado'); await load(); selectDevice(created.id); }
  }

  await load();
  requestAnimationFrame(() => {
    fitAll();
    const dId = Number(query.device), pId = Number(query.port);
    const target = rack.all.find((d) => d.id === dId);
    if (target && !onSide(target)) setSide(target.rack_side);
    if (dId && rack.devices.some((d) => d.id === dId)) {
      if (pId) selectPort(pId, dId, { focus: true }); else selectDevice(dId, { focus: true });
    }
  });
}
