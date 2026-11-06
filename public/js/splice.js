// Diagrama de empalmes de una caja (CTO / NAP / CEO): cables que llegan, cables que salen, splitters y fusiones
import { api } from './api.js';
import { strandColor } from './catalog.js';
import { h, s, btn, can, guard, toast, modal, haversineKm } from './ui.js';

const BW = 210, ROW = 16, HEAD = 24, GAP = 16, W = 820;
const near = (pt, box) => box.lat != null && pt && haversineKm(pt[0], pt[1], box.lat, box.lng) * 1000 < 10;

export function attachedTo(box, elements) {
  const cables = elements.filter((e) => e.kind === 'cable');
  const incoming = cables.filter((c) => c.id === box.parent_id || Number(c.props?.destino_id) === box.id || near(c.path?.[c.path.length - 1], box));
  const inIds = new Set(incoming.map((c) => c.id));
  const outgoing = cables.filter((c) => !inIds.has(c.id) && (c.parent_id === box.id || near(c.path?.[0], box)));
  const splitters = box.kind === 'splitter' ? [box] : elements.filter((e) => e.kind === 'splitter' && (e.parent_id === box.id || near([e.lat, e.lng], box)) && e.id !== box.id);
  return { incoming, outgoing, splitters };
}

export function openSplice(box, elements, { onChanged } = {}) {
  const host = h('div', { class: 'splice-wrap' });
  const info = h('div', { class: 'muted small', style: { marginTop: '8px' } });
  const m = modal({ title: `Empalmes · ${box.name}`, wide: true, body: h('div', null, h('p', { class: 'muted small', style: { marginTop: 0 } },
    can('update') ? 'Clic en un hilo (o entrada/salida de splitter) y luego en otro para fusionarlos. Clic en una fusión para quitarla.' : 'Vista de consulta.'), host, info), actions: [btn('Cerrar', { onClick: () => m.close() })] });
  let pending = null;

  function render() {
    const { incoming, outgoing, splitters } = attachedTo(box, elements);
    const fus = Array.isArray(box.props?.fusiones) ? box.props.fusiones : [];
    const ep = new Map();   // id → {x,y,dir,color}
    const nodes = [];
    const strandsOf = (c) => Math.min(Number(c.props?.fibras_total) || 12, 144);
    const block = (c, x, side, y0) => {
      const n = strandsOf(c), hgt = HEAD + n * ROW + 6;
      const g = s('g', { transform: `translate(${x} ${y0})` });
      g.append(s('rect', { width: BW, height: hgt, rx: 8, fill: '#101c33', stroke: '#2b3b5e' }),
        s('text', { x: 10, y: 16, 'font-weight': 700 }, `${c.name.length > 28 ? c.name.slice(0, 27) + '…' : c.name} · ${n}F`));
      for (let i = 1; i <= n; i++) {
        const [cn, col] = strandColor(i), y = HEAD + (i - 1) * ROW + ROW / 2, id = `c${c.id}.${i}`;
        const used = fus.some((f) => f.a === id || f.b === id);
        const ex = side === 'L' ? BW : 0;
        ep.set(id, { x: x + ex, y: y0 + y, dir: side === 'L' ? 1 : -1, color: col });
        const grp = s('g', { class: 'st', transform: `translate(0 ${y - ROW / 2})` }, s('title', null, `Hilo ${i} · ${cn} · tubo ${Math.ceil(i / 12)}`));
        const label = s('text', { x: side === 'L' ? 8 : BW - 8, y: ROW - 4, 'text-anchor': side === 'L' ? 'start' : 'end', fill: '#94a3b8' }, String(i));
        const sw = s('rect', { class: 'sw', x: side === 'L' ? BW - 46 : 6, y: 2, width: 40, height: ROW - 4, rx: 3, fill: col, opacity: used ? 1 : 0.45, stroke: pending === id ? '#fff' : '#0a1322', 'stroke-width': pending === id ? 2.5 : 1 });
        grp.append(s('rect', { width: BW, height: ROW, fill: 'transparent' }), label, sw);
        grp.addEventListener('click', () => pick(id));
        g.append(grp);
      }
      nodes.push(g);
      return hgt;
    };
    let yl = 10; for (const c of incoming) yl += block(c, 10, 'L', yl) + GAP;
    let yr = 10; for (const c of outgoing) yr += block(c, W - BW - 10, 'R', yr) + GAP;
    // splitters en el centro
    let ys = 10; const cx = W / 2;
    for (const sp of splitters) {
      const k = Math.max(2, Math.min(64, Number(String(sp.props?.relacion || '1:8').split(':')[1]) || 8));
      const hgt = Math.max(70, k * 14 + 30);
      const g = s('g', { transform: `translate(${cx - 50} ${ys})` });
      g.append(s('rect', { width: 100, height: hgt, rx: 8, fill: '#1a1230', stroke: '#6b3fa0' }), s('text', { x: 50, y: 16, 'text-anchor': 'middle', 'font-weight': 700 }, sp.name.length > 14 ? sp.name.slice(0, 13) + '…' : sp.name),
        s('text', { x: 50, y: hgt - 8, 'text-anchor': 'middle', fill: '#a78bfa' }, sp.props?.relacion || `1:${k}`));
      const inId = `s${sp.id}.in`;
      ep.set(inId, { x: cx - 50, y: ys + hgt / 2, dir: -1, color: '#e2e8f0' });
      const mk = (id, px, py, label, d) => {
        const cc = s('g', { class: 'st', 'data-nopan': '' }, s('title', null, label), s('circle', { class: 'sw', cx: px, cy: py, r: 5.5, fill: '#e2e8f0', opacity: fus.some((f) => f.a === id || f.b === id) ? 1 : 0.45, stroke: pending === id ? '#fff' : '#0a1322', 'stroke-width': pending === id ? 2.5 : 1 }));
        cc.addEventListener('click', () => pick(id));
        g.append(cc);
        ep.set(id, { x: cx - 50 + px, y: ys + py, dir: d, color: '#e2e8f0' });
      };
      mk(inId, 0, hgt / 2, 'Entrada', -1);
      for (let o = 1; o <= k; o++) mk(`s${sp.id}.o${o}`, 100, 22 + ((hgt - 34) / Math.max(k - 1, 1)) * (o - 1), `Salida ${o}`, 1);
      nodes.push(g);
      ys += hgt + GAP;
    }
    const H = Math.max(yl, yr, ys, 120) + 10;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    const lines = s('g');
    for (const f of fus) {
      const a = ep.get(f.a), b = ep.get(f.b);
      if (!a || !b) continue;
      const d = `M ${a.x} ${a.y} C ${a.x + a.dir * 70} ${a.y}, ${b.x + b.dir * 70} ${b.y}, ${b.x} ${b.y}`;
      const p = s('path', { d, class: 'fus', stroke: a.color === '#e2e8f0' ? b.color : a.color });
      p.append(s('title', null, can('update') ? 'Clic para quitar esta fusión' : 'Fusión'));
      p.addEventListener('click', async () => { if (can('update')) { await save(fus.filter((x) => x !== f)); } });
      lines.append(p);
    }
    svg.append(lines, ...nodes);
    host.replaceChildren(svg);
    info.textContent = `${incoming.length} cable(s) llegan · ${outgoing.length} salen · ${splitters.length} splitter(s) · ${fus.length} fusión(es)`;
    if (!incoming.length && !outgoing.length && !splitters.length) host.replaceChildren(h('p', { class: 'muted', style: { padding: '16px' } }, 'Esta caja aún no tiene cables ni splitters conectados. Trace un cable que empiece o termine sobre ella (en «Cable de fibra» haga clic en la caja) o indique «Nace de» en un cable o splitter.'));
  }

  async function pick(id) {
    if (!can('update')) return;
    const fus = Array.isArray(box.props?.fusiones) ? box.props.fusiones : [];
    if (fus.some((f) => f.a === id || f.b === id)) { toast('Ese punto ya está fusionado; quite la fusión primero', 'warn'); return; }
    if (!pending) { pending = id; render(); return; }
    if (pending === id) { pending = null; render(); return; }
    const a = pending; pending = null;
    await save([...fus, { a, b: id }]);
  }

  async function save(fusiones) {
    const props = { ...box.props, fusiones };
    const updated = await guard(() => api.patch(`/api/fiber/${box.id}`, { props }));
    if (updated) { box.props = updated.props; onChanged?.(updated); }
    render();
  }

  render();
}
