// Seguimiento de la fibra: ruta desde el nodo hasta un punto, o desde un punto hasta todos sus finales,
// con longitud y pérdida óptica estimada (presupuesto de potencia)
import { FIBER_KIND } from './catalog.js';
import { h, haversineKm } from './ui.js';

export const DB_PER_KM = 0.35;      // atenuación típica a 1310/1490 nm (G.652D)
export const DB_JUNCTION = 0.1;     // pérdida estimada por empalme/conector en cajas
const SPLIT_LOSS = { '1:2': 3.7, '1:4': 7.2, '1:8': 10.5, '1:16': 13.8, '1:32': 17.1, '1:64': 20.5 };

export const pathLenM = (path) => { let t = 0; for (let i = 1; i < path.length; i++) t += haversineKm(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]) * 1000; return t; };
export const cableLenM = (e) => Number(e.props?.longitud_m) || (e.path?.length > 1 ? pathLenM(e.path) : Number(e.props?.distancia_m) || 0);

/** Pérdida estimada (dB) que aporta un elemento al presupuesto óptico. */
export function lossOf(e) {
  if (e.kind === 'cable') return (cableLenM(e) / 1000) * DB_PER_KM;
  if (e.kind === 'splitter') return Number(e.props?.perdida_db) || SPLIT_LOSS[String(e.props?.relacion || '').trim()] || 0;
  if (e.kind === 'closure' || e.kind === 'nap' || e.kind === 'odf') return DB_JUNCTION;
  return 0;
}

/** Cadena desde la raíz (OLT / nodo) hasta el elemento. */
export function chainTo(el, byId) {
  const out = [];
  for (let c = el, n = 0; c && n < 300; c = byId.get(c.parent_id), n++) out.unshift(c);
  return out;
}

/** Todo lo que cuelga del elemento (en profundidad), con su nivel. */
export function subtreeOf(el, elements) {
  const kids = new Map();
  for (const e of elements) if (e.parent_id != null) (kids.get(e.parent_id) || kids.set(e.parent_id, []).get(e.parent_id)).push(e);
  const out = [];
  const walk = (e, depth) => { if (out.length > 600) return; out.push({ e, depth }); for (const k of kids.get(e.id) || []) walk(k, depth + 1); };
  walk(el, 0);
  return out;
}

export const posOf = (e) => (e.lat != null && e.lng != null ? [e.lat, e.lng] : e.path?.length ? [e.path[0][0], e.path[0][1]] : null);

/** Tarjeta con el recorrido y el presupuesto de potencia. */
export function traceCard(rows, { title } = {}) {
  // rows: [{ e, depth?, cumLoss, cumLen }]
  const tx = rows.map((r) => Number(r.e.props?.potencia_tx_dbm)).find((v) => Number.isFinite(v));
  const last = rows[rows.length - 1];
  const leaves = rows.filter((r) => r.leaf);
  const summary = h('div', { class: 'trace-sum' },
    h('div', null, h('b', null, `${(last.cumLen / 1000).toFixed(2)} km`), h('span', { class: 'muted small' }, ' de fibra')),
    h('div', null, h('b', null, `${last.cumLoss.toFixed(1)} dB`), h('span', { class: 'muted small' }, ' de pérdida estimada')),
    tx != null ? h('div', null, h('b', null, `${(tx - last.cumLoss).toFixed(1)} dBm`), h('span', { class: 'muted small' }, ` Rx estimado (TX ${tx} dBm)`)) : null,
    leaves.length ? h('div', null, h('b', null, String(leaves.filter((r) => r.e.kind === 'client').length)), h('span', { class: 'muted small' }, ' clientes al final')) : null);
  const table = h('table', { class: 't trace' }, h('thead', null, h('tr', null, ['#', 'Elemento', 'Tramo', 'Pérdida', 'Acum.'].map((c) => h('th', null, c)))),
    h('tbody', null, rows.map((r, i) => h('tr', { class: r.e.kind === 'client' ? 'end' : '' },
      h('td', null, String(i + 1)),
      h('td', { style: { paddingLeft: `${8 + (r.depth || 0) * 12}px` } }, h('span', { class: 'chip', style: { '--c': FIBER_KIND[r.e.kind]?.color } }, FIBER_KIND[r.e.kind]?.label.split(' /')[0] || r.e.kind), ' ', r.e.name),
      h('td', null, r.e.kind === 'cable' ? `${Math.round(cableLenM(r.e))} m${r.e.props?.fibras_total ? ` · ${r.e.props.fibras_total}F` : ''}` : r.e.kind === 'splitter' ? (r.e.props?.relacion || '') : ''),
      h('td', null, r.own ? `${r.own.toFixed(2)} dB` : ''), h('td', null, `${r.cumLoss.toFixed(1)} dB`)))));
  return h('div', null, title ? h('h4', { style: { marginTop: 0 } }, title) : null, summary, h('div', { class: 'table-wrap', style: { maxHeight: '45vh' } }, table),
    h('p', { class: 'muted small' }, `Estimación: ${DB_PER_KM} dB/km, splitters según su relación y ${DB_JUNCTION} dB por caja/ODF. Ajuste «Pérdida de inserción» en cada splitter para afinar.`));
}

/** Filas de la ruta hacia un elemento (desde el nodo). */
export function upRows(el, byId) {
  let cumLen = 0, cumLoss = 0;
  return chainTo(el, byId).map((e) => {
    const own = lossOf(e); cumLoss += own; if (e.kind === 'cable') cumLen += cableLenM(e);
    return { e, own, cumLoss, cumLen };
  });
}

/** Filas del árbol hacia abajo (hasta los finales), con pérdida acumulada por rama. */
export function downRows(el, elements) {
  const sub = subtreeOf(el, elements);
  const stack = []; // acumulados por profundidad
  const hasKid = new Set(elements.map((e) => e.parent_id));
  return sub.map(({ e, depth }) => {
    const prev = depth ? stack[depth - 1] : { loss: 0, len: 0 };
    const own = lossOf(e);
    const acc = { loss: prev.loss + own, len: prev.len + (e.kind === 'cable' ? cableLenM(e) : 0) };
    stack[depth] = acc;
    return { e, depth, own, cumLoss: acc.loss, cumLen: acc.len, leaf: !hasKid.has(e.id) };
  });
}
