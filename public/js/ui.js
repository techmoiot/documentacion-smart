// Utilidades de interfaz: DOM seguro, modales, formularios, panel lateral, zoom/desplazamiento
import { STATUS } from './catalog.js';

export const state = { user: null, meta: null };

export const can = (action) => {
  const lvl = { viewer: 1, technician: 2, engineer: 3, admin: 4 };
  const need = { read: 1, update: 2, write: 3, admin: 4 };
  return !!state.user && lvl[state.user.role] >= need[action];
};

export const ROLE_LABEL = { admin: 'Administrador', engineer: 'Ingeniero de red', technician: 'Técnico', viewer: 'Solo lectura' };

// ---------- DOM ----------
const SVG_NS = 'http://www.w3.org/2000/svg';

function applyProps(el, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
}
function appendKids(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  applyProps(el, props);
  appendKids(el, kids);
  return el;
}
export function s(tag, props, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props);
  appendKids(el, kids);
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

/** Icono SVG a partir de constantes (nunca de datos del usuario). */
export function icon(name, size = 16) {
  const paths = {
    plus: 'M12 5v14M5 12h14', edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5', x: 'M6 6l12 12M18 6L6 18', zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M8 11h6M11 8v6',
    zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M8 11h6', fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14', rack: 'M5 3h14v18H5zM5 8h14M5 13h14M5 18h14', fiber: 'M4 18c4 0 4-12 8-12s4 12 8 12',
    radio: 'M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M7.5 7.5a6 6 0 0 0 0 9M16.5 7.5a6 6 0 0 1 0 9M4.5 4.5a10 10 0 0 0 0 15M19.5 4.5a10 10 0 0 1 0 15',
    box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8', link: 'M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1',
    history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2', users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M17 3a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.5',
    home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', alert: 'M12 3l10 18H2zM12 10v5M12 18v.5', ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
    topo: 'M12 5a2 2 0 1 0 0 .01M5 19a2 2 0 1 0 0 .01M19 19a2 2 0 1 0 0 .01M12 7v4M12 11l-6 6M12 11l6 6', upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
    download: 'M12 4v12M7 11l5 5 5-5M4 20h16', chevron: 'M9 6l6 6-6 6', out: 'M15 4h5v16h-5M10 8l-4 4 4 4M6 12h10', key: 'M14 10a4 4 0 1 1-1.5-3.1L21 15v3h-3v-2h-2v-2h-2l-1.6-1.6',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', target: 'M12 12m-8 0a8 8 0 1 0 16 0 8 8 0 1 0-16 0M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  };
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', paths[name] || paths.box);
  svg.append(p);
  return svg;
}

export function btn(label, opts = {}) {
  const { ic, kind = '', onClick, title, disabled } = opts;
  return h('button', { class: `btn ${kind}`.trim(), type: 'button', title, disabled, onclick: onClick }, ic ? icon(ic, 15) : null, label ? h('span', null, label) : null);
}

export function badge(status) {
  const st = STATUS[status] || { label: status || '—', color: '#94a3b8' };
  return h('span', { class: 'badge', style: { '--c': st.color } }, st.label);
}

export const fmt = {
  date: (v) => (v ? String(v).slice(0, 10) : '—'),
  dt: (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '—'),
  val: (v, unit = '') => (v == null || v === '' ? '—' : `${v}${unit ? ' ' + unit : ''}`),
};

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`);

// ---------- Avisos ----------
export function toast(msg, kind = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: `toast ${kind}` }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3000);
}

export async function guard(fn) {
  try { return await fn(); } catch (e) { toast(e.message || 'Error inesperado', 'err'); return undefined; }
}

// ---------- Modales ----------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const overlay = h('div', { class: 'overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' }, h('h3', null, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: close }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-foot' }, actions) : null);
  overlay.append(box);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  return { close, el: box };
}

export function confirmBox(message, { okLabel = 'Eliminar', danger = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = modal({
      title: 'Confirmar', body: h('p', null, message), onClose: () => finish(false),
      actions: [btn('Cancelar', { onClick: () => { finish(false); m.close(); } }), btn(okLabel, { kind: danger ? 'danger' : 'primary', onClick: () => { finish(true); m.close(); } })],
    });
  });
}

/**
 * Formulario modal genérico.
 * fields: [{name,label,type:'text|number|date|select|textarea|checkbox|custom',options,required,hint,span,step,render}]
 * Devuelve una promesa con los valores o null si se cancela.
 */
export function formModal({ title, fields, values = {}, submitLabel = 'Guardar', wide = false }) {
  return new Promise((resolve) => {
    const inputs = {};
    const grid = h('div', { class: 'form-grid' });
    for (const f of fields) {
      if (f.type === 'section') { grid.append(h('div', { class: 'form-section span2' }, f.label)); continue; }
      let input;
      const val = values[f.name] ?? f.default ?? '';
      if (f.type === 'custom') {
        const c = f.render(values);
        inputs[f.name] = c;
        grid.append(h('div', { class: 'field span2' }, f.label ? h('label', null, f.label) : null, c.el));
        continue;
      }
      if (f.type === 'select') {
        input = h('select', { name: f.name }, (f.options || []).map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l)));
      } else if (f.type === 'textarea') {
        input = h('textarea', { name: f.name, rows: f.rows || 3 }); input.value = val;
      } else if (f.type === 'checkbox') {
        input = h('input', { type: 'checkbox', name: f.name, checked: !!val });
      } else {
        input = h('input', { type: f.type || 'text', name: f.name, step: f.step, min: f.min, max: f.max, placeholder: f.placeholder || '', maxlength: f.maxlength });
        input.value = val;
      }
      if (f.required) input.required = true;
      if (f.disabled) input.disabled = true;
      if (f.onChange) input.addEventListener('change', () => f.onChange(input, inputs));
      inputs[f.name] = { el: input, get: () => (input.type === 'checkbox' ? input.checked : input.value) };
      grid.append(h('div', { class: `field ${f.span === 2 || f.type === 'textarea' ? 'span2' : ''}` },
        h('label', null, f.label, f.required ? h('span', { class: 'req' }, ' *') : null), input, f.hint ? h('small', null, f.hint) : null));
    }
    const err = h('div', { class: 'form-error', role: 'alert' });
    const form = h('form', { novalidate: false }, grid, err);
    let finished = false;
    const finish = (v) => { if (!finished) { finished = true; resolve(v); } };
    const m = modal({
      title, wide, body: form, onClose: () => finish(null),
      actions: [btn('Cancelar', { onClick: () => { finish(null); m.close(); } }), btn(submitLabel, { kind: 'primary', onClick: () => form.requestSubmit() })],
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        if (f.type === 'section') continue;
        out[f.name] = inputs[f.name].get();
      }
      finish(out);
      m.close();
    });
    setTimeout(() => form.querySelector('input:not([disabled]),select,textarea')?.focus(), 30);
  });
}

// ---------- Panel contextual lateral ----------
let panelEl = null;
export function mountPanel(root) {
  panelEl = h('aside', { class: 'panel hidden', id: 'panel', 'aria-live': 'polite' });
  root.append(panelEl);
}
let panelOnClose = null;
export function openPanel(title, content, { onClose, subtitle } = {}) {
  panelOnClose = onClose || null;
  clear(panelEl);
  panelEl.append(
    h('div', { class: 'panel-head' },
      h('div', null, h('h3', null, title), subtitle ? h('div', { class: 'muted small' }, subtitle) : null),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar panel', onclick: () => closePanel() }, icon('x'))),
    h('div', { class: 'panel-body' }, content));
  panelEl.classList.remove('hidden');
  document.body.classList.add('panel-open');
}
export function closePanel(silent = false) {
  if (!panelEl) return;
  panelEl.classList.add('hidden');
  document.body.classList.remove('panel-open');
  clear(panelEl);
  const cb = panelOnClose; panelOnClose = null;
  if (!silent) cb?.();
}

/** Lista de pares clave/valor. */
export function props(rows) {
  return h('dl', { class: 'props' }, rows.filter(Boolean).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v == null || v === '' ? '—' : v)]));
}

export function emptyState(text, action) {
  return h('div', { class: 'empty' }, h('p', null, text), action || null);
}

// ---------- Zoom y desplazamiento para SVG ----------
export function panZoom(svg, { min = 0.2, max = 8 } = {}) {
  const vp = s('g', { class: 'viewport' });
  svg.append(vp);
  let k = 1, tx = 0, ty = 0;
  const apply = () => vp.setAttribute('transform', `translate(${tx} ${ty}) scale(${k})`);
  const pt = (e) => {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const zoomAt = (px, py, factor) => {
    const nk = Math.min(max, Math.max(min, k * factor));
    tx = px - (px - tx) * (nk / k);
    ty = py - (py - ty) * (nk / k);
    k = nk; apply();
  };
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = pt(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest?.('[data-nopan]')) return;
    drag = { x: e.clientX, y: e.clientY, tx, ty, moved: false };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('panning');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    tx = drag.tx + dx; ty = drag.ty + dy; apply();
  });
  const end = (e) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    svg.classList.remove('panning');
    try { svg.releasePointerCapture(e.pointerId); } catch { /* ya liberado */ }
    svg.dataset.justPanned = moved ? '1' : '';
    setTimeout(() => { svg.dataset.justPanned = ''; }, 0);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  const ctrl = {
    vp,
    get scale() { return k; },
    zoomIn: () => { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.3); },
    zoomOut: () => { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.3); },
    reset: () => { k = 1; tx = 0; ty = 0; apply(); },
    /** Ajusta una caja {x,y,w,h} (coordenadas del contenido) a la vista. */
    fit(box, pad = 20, maxK = 3) {
      const r = svg.getBoundingClientRect();
      if (!r.width || !box.w || !box.h) return;
      k = Math.min(maxK, Math.max(min, Math.min((r.width - pad * 2) / box.w, (r.height - pad * 2) / box.h)));
      tx = (r.width - box.w * k) / 2 - box.x * k;
      ty = (r.height - box.h * k) / 2 - box.y * k;
      apply();
    },
    /** Centra un punto del contenido con una escala dada. */
    focus(x, y, scale) {
      const r = svg.getBoundingClientRect();
      k = Math.min(max, Math.max(min, scale ?? k));
      tx = r.width / 2 - x * k; ty = r.height / 2 - y * k; apply();
    },
    justPanned: () => svg.dataset.justPanned === '1',
  };
  return ctrl;
}

export function zoomToolbar(ctrl, extra = []) {
  return h('div', { class: 'zoombar' },
    h('button', { class: 'icon-btn', type: 'button', title: 'Acercar', onclick: ctrl.zoomIn }, icon('zoomIn')),
    h('button', { class: 'icon-btn', type: 'button', title: 'Alejar', onclick: ctrl.zoomOut }, icon('zoomOut')),
    h('button', { class: 'icon-btn', type: 'button', title: 'Restablecer', onclick: () => (ctrl.refit ? ctrl.refit() : ctrl.reset()) }, icon('fit')),
    ...extra);
}

export function download(filename, text, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const csvCell = (v) => {
  let t = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; // evita inyección de fórmulas al abrir en hojas de cálculo
  return `"${t.replace(/"/g, '""')}"`;
};

export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/** Navega cambiando el hash. */
export const go = (hash) => { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; };
