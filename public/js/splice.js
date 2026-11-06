// Diagrama de empalmes de una caja (CTO / NAP / CEO / mufa): cables que llegan y salen, splitters dentro de la caja y fusiones
import { api } from './api.js';
import { strandColor } from './catalog.js';
import { h, s, btn, can, guard, toast, modal, formModal, confirmBox, haversineKm } from './ui.js';

const BW = 210, ROW = 16, HEAD = 24, GAP = 16, W = 820;
const RATIOS = ['1:2', '1:4', '1:8', '1:16', '1:32', '1:64'];
const near = (pt, box) => box.lat != null && pt && haversineKm(pt[0], pt[1], box.lat, box.lng) * 1000 < 10;
const parseId = (id) => { const m = /^(c|s)(\d+)\.(in|o?\d+)$/.exec(id); return m ? { kind: m[1], el: Number(m[2]), part: m[3] } : null; };
const groupOf = (id) => { const p = parseId(id); return p.kind === 'c' ? `c${p.el}` : p.part === 'in' ? `si${p.el}` : `so${p.el}`; };
const idxOf = (id) => { const p = parseId(id); return p.part === 'in' ? 1 : Number(String(p.part).replace('o', '')); };

export function attachedTo(box, elements) {
  const cables = elements.filter((e) => e.kind === 'cable');
  const incoming = cables.filter((c) => c.id === box.parent_id || Number(c.props?.destino_id) === box.id || near(c.path?.[c.path.length - 1], box));
  const inIds = new Set(incoming.map((c) => c.id));
  const outgoing = cables.filter((c) => !inIds.has(c.id) && (c.parent_id === box.id || near(c.path?.[0], box)));
  const splitters = box.kind === 'splitter' ? [box] : elements.filter((e) => e.kind === 'splitter' && (e.parent_id === box.id || near([e.lat, e.lng], box)) && e.id !== box.id);
  return { incoming, outgoing, splitters };
}
const ratioN = (sp) => Math.max(2, Math.min(64, Number(String(sp.props?.relacion || '1:8').split(':')[1]) || 8));
const strandsOf = (c) => Math.min(Number(c.props?.fibras_total) || 12, 144);

/** Grupos de puntos fusionables, en orden: hilos de cada cable y salidas/entrada de cada splitter. */
function groupsOf(att) {
  const g = [];
  for (const c of [...att.incoming, ...att.outgoing]) g.push({ key: `c${c.id}`, label: `${c.name} (${strandsOf(c)}F)`, ids: Array.from({ length: strandsOf(c) }, (_, i) => `c${c.id}.${i + 1}`) });
  for (const sp of att.splitters) {
    g.push({ key: `si${sp.id}`, label: `${sp.name} · entrada`, ids: [`s${sp.id}.in`] });
    g.push({ key: `so${sp.id}`, label: `${sp.name} · salidas (${ratioN(sp)})`, ids: Array.from({ length: ratioN(sp) }, (_, i) => `s${sp.id}.o${i + 1}`) });
  }
  return g;
}

export function openSplice(box, elements, { onChanged, addSplitter = false } = {}) {
  const host = h('div', { class: 'splice-wrap' });
  const info = h('div', { class: 'muted small', style: { marginTop: '8px' } });
  const tools = h('div', { class: 'row gap wrap', style: { marginBottom: '10px' } });
  const help = h('p', { class: 'muted small', style: { margin: '0 0 8px' } });
  const m = modal({ title: `Empalmes · ${box.name}`, wide: true, onClose: () => document.removeEventListener('keydown', onKey, true), body: h('div', null, tools, help, host, info), actions: [btn('Cerrar', { onClick: () => m.close() })] });
  let pending = null;   // { gk, a, b } rango seleccionado dentro de un grupo

  const fusions = () => (Array.isArray(box.props?.fusiones) ? box.props.fusiones : []);
  const usedSet = (list = fusions()) => new Set(list.flatMap((f) => [f.a, f.b]));
  const inRange = (id) => pending && groupOf(id) === pending.gk && idxOf(id) >= Math.min(pending.a, pending.b) && idxOf(id) <= Math.max(pending.a, pending.b);

  async function saveFus(list, msg) {
    const props = { ...box.props, fusiones: list };
    const updated = await guard(() => api.patch(`/api/fiber/${box.id}`, { props }));
    if (updated) { box.props = updated.props; onChanged?.(updated); if (msg) toast(msg); }
    render();
  }

  /** Fusiona A[a0..a0+n-1] con B[b0..]; omite los puntos ya usados. */
  async function fuseBatch(A, a0, n, B, b0) {
    const list = [...fusions()]; const used = usedSet(list);
    let ok = 0, skip = 0;
    for (let k = 0; k < n; k++) {
      const x = A.ids[a0 - 1 + k], y = B.ids[b0 - 1 + k];
      if (!x || !y) { skip += n - k; break; }
      if (used.has(x) || used.has(y)) { skip++; continue; }
      list.push({ a: x, b: y }); used.add(x); used.add(y); ok++;
    }
    if (!ok) { toast('No se creó ninguna fusión (puntos ocupados o fuera de rango)', 'warn'); return; }
    await saveFus(list, `${ok} fusión(es) creadas${skip ? ` · ${skip} omitidas` : ''}`);
  }

  function render() {
    const att = attachedTo(box, elements);
    const { incoming, outgoing, splitters } = att;
    const fus = fusions(), used = usedSet(fus);
    const ep = new Map(), nodes = [];
    const block = (c, x, side, y0) => {
      const n = strandsOf(c), hgt = HEAD + n * ROW + 6;
      const g = s('g', { transform: `translate(${x} ${y0})` });
      g.append(s('rect', { width: BW, height: hgt, rx: 8, fill: '#101c33', stroke: '#2b3b5e' }), s('text', { x: 10, y: 16, 'font-weight': 700 }, `${c.name.length > 28 ? c.name.slice(0, 27) + '…' : c.name} · ${n}F`));
      for (let i = 1; i <= n; i++) {
        const [cn, col] = strandColor(i), y = HEAD + (i - 1) * ROW + ROW / 2, id = `c${c.id}.${i}`;
        ep.set(id, { x: x + (side === 'L' ? BW : 0), y: y0 + y, dir: side === 'L' ? 1 : -1, color: col });
        const sel = inRange(id);
        const grp = s('g', { class: 'st', transform: `translate(0 ${y - ROW / 2})` }, s('title', null, `Hilo ${i} · ${cn} · tubo ${Math.ceil(i / 12)}`));
        grp.append(s('rect', { width: BW, height: ROW, fill: sel ? '#ffffff18' : 'transparent' }),
          s('text', { x: side === 'L' ? 8 : BW - 8, y: ROW - 4, 'text-anchor': side === 'L' ? 'start' : 'end', fill: '#94a3b8' }, String(i)),
          s('rect', { class: 'sw', x: side === 'L' ? BW - 46 : 6, y: 2, width: 40, height: ROW - 4, rx: 3, fill: col, opacity: used.has(id) || sel ? 1 : 0.45, stroke: sel ? '#fff' : '#0a1322', 'stroke-width': sel ? 2.5 : 1 }));
        grp.addEventListener('click', (ev) => pick(id, ev.shiftKey));
        g.append(grp);
      }
      nodes.push(g);
      return hgt;
    };
    let yl = 10; for (const c of incoming) yl += block(c, 10, 'L', yl) + GAP;
    let yr = 10; for (const c of outgoing) yr += block(c, W - BW - 10, 'R', yr) + GAP;
    let ys = 10; const cx = W / 2;
    for (const sp of splitters) {
      const k = ratioN(sp), hgt = Math.max(80, k * 14 + 34);
      const g = s('g', { transform: `translate(${cx - 50} ${ys})` });
      g.append(s('polygon', { points: `0,${hgt / 2} 100,6 100,${hgt - 6}`, fill: '#1a1230', stroke: '#8b5cf6', 'stroke-width': 1.5 }),
        s('text', { x: 4, y: hgt + 12, 'font-weight': 700 }, `${sp.name.length > 16 ? sp.name.slice(0, 15) + '…' : sp.name} · ${sp.props?.relacion || `1:${k}`}`));
      const inId = `s${sp.id}.in`, sin = pending && pending.gk === `si${sp.id}`;
      ep.set(inId, { x: cx - 50, y: ys + hgt / 2, dir: -1, color: '#e2e8f0' });
      const mk = (id, px, py, label, d) => {
        const sel = inRange(id) || (id === inId && sin);
        const cc = s('g', { class: 'st', 'data-nopan': '' }, s('title', null, label), s('circle', { class: 'sw', cx: px, cy: py, r: 5.5, fill: '#e2e8f0', opacity: used.has(id) || sel ? 1 : 0.45, stroke: sel ? '#facc15' : '#0a1322', 'stroke-width': sel ? 2.5 : 1 }));
        cc.addEventListener('click', (ev) => pick(id, ev.shiftKey));
        g.append(cc); ep.set(id, { x: cx - 50 + px, y: ys + py, dir: d, color: '#e2e8f0' });
      };
      mk(inId, 0, hgt / 2, 'Entrada del splitter', -1);
      for (let o = 1; o <= k; o++) mk(`s${sp.id}.o${o}`, 100, 16 + ((hgt - 32) / Math.max(k - 1, 1)) * (o - 1), `Salida ${o}`, 1);
      if (can('write') && sp.id !== box.id) {
        const x = s('g', { class: 'st', 'data-nopan': '' }, s('title', null, 'Quitar este splitter de la caja'), s('text', { x: 82, y: hgt + 12, fill: '#f87171' }, '✕ quitar'));
        x.addEventListener('click', () => removeSplitter(sp));
        g.append(x);
      }
      nodes.push(g);
      ys += hgt + GAP + 8;
    }
    const H = Math.max(yl, yr, ys, 120) + 10;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    const lines = s('g');
    for (const f of fus) {
      const a = ep.get(f.a), b = ep.get(f.b);
      if (!a || !b) continue;
      const p = s('path', { d: `M ${a.x} ${a.y} C ${a.x + a.dir * 70} ${a.y}, ${b.x + b.dir * 70} ${b.y}, ${b.x} ${b.y}`, class: 'fus', stroke: a.color === '#e2e8f0' ? b.color : a.color });
      p.append(s('title', null, can('update') ? 'Clic para quitar esta fusión' : 'Fusión'));
      p.addEventListener('click', () => { if (can('update')) saveFus(fus.filter((x) => x !== f), 'Fusión quitada'); });
      lines.append(p);
    }
    svg.append(lines, ...nodes);
    host.replaceChildren(svg);
    info.textContent = `${incoming.length} cable(s) llegan · ${outgoing.length} salen · ${splitters.length} splitter(s) · ${fus.length} fusión(es)`;
    if (!incoming.length && !outgoing.length && !splitters.length) host.replaceChildren(h('p', { class: 'muted', style: { padding: '16px' } }, 'Esta caja aún no tiene cables ni splitters. Agregue un splitter con el botón de arriba, o trace un cable que empiece o termine sobre ella.'));
    help.textContent = can('update')
      ? (pending ? `Seleccionó ${Math.abs(pending.b - pending.a) + 1} punto(s). Clic en el primer punto de destino para fusionarlos en orden (Shift+clic amplía el rango; Esc cancela).`
        : 'Clic en un hilo y luego en otro para fusionar. Para varios a la vez: clic en el primero, Shift+clic en el último del rango y clic en el hilo de destino; o use «Fusión en lote». Clic en una fusión la quita.')
      : 'Vista de consulta.';
    tools.replaceChildren(
      can('write') ? btn('Agregar splitter', { ic: 'plus', kind: 'primary', onClick: () => createSplitter() }) : null,
      can('update') ? btn('Fusión en lote…', { ic: 'edit', onClick: () => batchDialog(att) }) : null,
      can('update') && fus.length ? btn('Quitar todas las fusiones', { ic: 'trash', onClick: async () => { if (await confirmBox(`¿Quitar las ${fus.length} fusiones de esta caja?`)) saveFus([], 'Fusiones quitadas'); } }) : null);
  }

  function onKey(ev) { if (ev.key === 'Escape' && pending) { pending = null; render(); ev.stopImmediatePropagation(); } }

  async function pick(id, shift) {
    if (!can('update')) return;
    const gk = groupOf(id), idx = idxOf(id);
    if (!pending) { if (usedSet().has(id)) { toast('Ese punto ya está fusionado; quite la fusión primero', 'warn'); return; } pending = { gk, a: idx, b: idx }; render(); return; }
    if (gk === pending.gk) {
      if (shift) { pending.b = idx; render(); return; }
      if (inRange(id)) { pending = null; render(); return; }
      pending = { gk, a: idx, b: idx }; render(); return;
    }
    // destino en otro grupo: fusiona el rango en orden
    const att = attachedTo(box, elements), groups = groupsOf(att);
    const A = groups.find((x) => x.key === pending.gk), B = groups.find((x) => x.key === gk);
    const lo = Math.min(pending.a, pending.b), n = Math.abs(pending.b - pending.a) + 1;
    pending = null;
    await fuseBatch(A, lo, n, B, idx);
  }

  async function batchDialog(att) {
    const groups = groupsOf(att);
    if (groups.length < 2) { toast('Se necesitan al menos dos cables o un cable y un splitter', 'warn'); return; }
    const opts = groups.map((g) => [g.key, g.label]);
    const v = await formModal({ title: 'Fusión en lote (hilo a hilo)', wide: true, submitLabel: 'Fusionar', values: { from_g: groups[0].key, to_g: groups[1].key, from_i: 1, to_i: 1, count: Math.min(groups[0].ids.length, groups[1].ids.length) }, fields: [
      { name: 'from_g', label: 'Origen (cable o splitter)', type: 'select', options: opts },
      { name: 'from_i', label: 'Desde el hilo / salida', type: 'number', min: 1, max: 144, required: true },
      { name: 'to_g', label: 'Destino (cable o splitter)', type: 'select', options: opts },
      { name: 'to_i', label: 'Desde el hilo / entrada', type: 'number', min: 1, max: 144, required: true },
      { name: 'count', label: 'Cantidad de fusiones', type: 'number', min: 1, max: 144, required: true, hint: 'Se une origen+1 con destino+1, en orden. Los puntos ya fusionados se omiten.', span: 2 },
    ] });
    if (!v) return;
    if (v.from_g === v.to_g) { toast('Origen y destino deben ser distintos', 'warn'); return; }
    await fuseBatch(groups.find((g) => g.key === v.from_g), Number(v.from_i), Number(v.count), groups.find((g) => g.key === v.to_g), Number(v.to_i));
  }

  async function createSplitter() {
    const n = elements.filter((e) => e.kind === 'splitter' && e.parent_id === box.id).length + 1;
    const v = await formModal({ title: `Nuevo splitter dentro de «${box.name}»`, submitLabel: 'Agregar', values: { name: `Splitter ${n}`, relacion: '1:8', status: 'operativo' }, fields: [
      { name: 'name', label: 'Nombre', required: true, maxlength: 80 },
      { name: 'relacion', label: 'Relación de división', type: 'select', options: RATIOS.map((r) => [r, r]) },
      { name: 'tipo', label: 'Tipo', type: 'select', options: [['PLC', 'PLC (balanceado)'], ['FBT', 'FBT'], ['desbalanceado', 'Desbalanceado']] },
      { name: 'perdida_db', label: 'Pérdida de inserción (dB, opcional)', type: 'number', step: 'any' },
    ] });
    if (!v) return;
    const props = { relacion: v.relacion, caja_id: box.id };
    if (v.tipo) props.tipo = v.tipo;
    if (v.perdida_db !== '' && v.perdida_db != null) props.perdida_db = Number(v.perdida_db);
    const created = await guard(() => api.post('/api/fiber', { kind: 'splitter', name: v.name, status: 'operativo', parent_id: box.id, node_id: box.node_id ?? null, props }));
    if (created) { elements.push({ ...created, lat: null, lng: null, own_lat: null, own_lng: null }); onChanged?.(created); toast('Splitter agregado a la caja'); render(); }
  }

  async function removeSplitter(sp) {
    if (!(await confirmBox(`¿Quitar el splitter «${sp.name}» de la caja? Se eliminan también sus fusiones y lo que cuelga de él.`))) return;
    if (!(await guard(() => api.del(`/api/fiber/${sp.id}`)))) return;
    const i = elements.findIndex((e) => e.id === sp.id); if (i >= 0) elements.splice(i, 1);
    const clean = fusions().filter((f) => !f.a.startsWith(`s${sp.id}.`) && !f.b.startsWith(`s${sp.id}.`));
    await saveFus(clean, 'Splitter quitado');
  }

  document.addEventListener('keydown', onKey, true);
  render();
  if (addSplitter) createSplitter();
}
