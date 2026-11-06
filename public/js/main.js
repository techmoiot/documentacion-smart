// Arranque de la aplicación: sesión, estructura, enrutado y búsqueda global
import { api } from './api.js';
import {
  h, icon, state, clear, mountPanel, closePanel, toast, guard, formModal, debounce, ROLE_LABEL, can,
} from './ui.js';
import { homeView, nodesView, nodeView } from './views/nodes.js';
import { mapView } from './views/map.js';
import { plantaView } from './views/planta.js';
import { fiberView } from './views/fiber.js';
import { radioView } from './views/radio.js';
import { inventoryView, connectionsView, historyView, usersView } from './views/lists.js';

const app = document.getElementById('app');

// ---------- Inicio de sesión ----------
function showLogin(message = '') {
  clear(app);
  document.body.classList.remove('panel-open');
  const err = h('div', { class: 'err-line', role: 'alert' }, message);
  const user = h('input', { type: 'text', name: 'username', autocomplete: 'username', required: true, autofocus: true });
  const pass = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const form = h('form', { class: 'login-box' },
    h('div', { class: 'logo-tile' }, h('img', { src: '/img/logo.png', alt: 'Techmo · For engineers, by engineers' })),
    h('div', { class: 'login-title' }, 'Smart Connection', h('small', null, 'Documentación de infraestructura de red')),
    h('div', null, h('label', null, 'Usuario'), user), h('div', null, h('label', null, 'Contraseña'), pass), err,
    h('button', { class: 'btn primary', type: 'submit', style: { justifyContent: 'center' } }, 'Ingresar'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      state.user = await api.post('/api/auth/login', { username: user.value.trim(), password: pass.value });
      await boot();
    } catch (ex) { err.textContent = ex.message; pass.value = ''; }
  });
  app.append(h('div', { class: 'login' }, form));
}

// ---------- Estructura ----------
const NAV = [
  ['#/', 'Inicio', 'home'], ['#/mapa', 'Mapa', 'map'], ['#/nodos', 'Nodos y racks', 'rack'], ['#/planta', 'Planta externa', 'fiber'], ['#/fibra', 'Fibra FTTH', 'fiber'], ['#/radioenlaces', 'Radioenlaces', 'radio'],
  ['#/conexiones', 'Conexiones', 'link'], ['#/inventario', 'Inventario', 'box'], ['#/historial', 'Historial', 'history'],
];
let mainEl = null;

function buildShell() {
  clear(app);
  const nav = h('nav', { class: 'nav', 'aria-label': 'Navegación principal' },
    h('div', { class: 'brand' }, h('div', { class: 'logo img' }, h('img', { src: '/img/logo.png', alt: 'Techmo' })), h('div', null, 'Smart Connection', h('small', null, 'Red documentada'))),
    NAV.map(([href, label, ic]) => h('a', { href, 'data-nav': href }, icon(ic, 17), h('span', null, label))),
    state.user.role === 'admin' ? h('a', { href: '#/usuarios', 'data-nav': '#/usuarios' }, icon('users', 17), h('span', null, 'Usuarios')) : null,
    h('div', { class: 'spacer' }),
    h('div', { class: 'muted small', style: { padding: '8px 14px' }, title: 'Versión instalada' }, `v${state.meta?.version || ''}`));

  // Búsqueda global
  const input = h('input', { type: 'search', placeholder: 'Buscar equipo, IP, serie, nodo, cliente…  ( / )', 'aria-label': 'Búsqueda global' });
  const results = h('div', { class: 'results hidden', role: 'listbox' });
  const doSearch = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { results.classList.add('hidden'); return; }
    const rows = await guard(() => api.get(`/api/search?q=${encodeURIComponent(q)}`)) || [];
    clear(results);
    if (!rows.length) results.append(h('div', { class: 'empty' }, 'Sin resultados'));
    for (const r of rows) {
      results.append(h('a', { href: r.href, onclick: () => { results.classList.add('hidden'); input.value = ''; } },
        h('span', { class: 't' }, r.type), h('span', null, h('div', null, r.title), h('div', { class: 'sub' }, r.sub)), h('span', { class: 'muted small' }, '')));
    }
    results.classList.remove('hidden');
  }, 220);
  input.addEventListener('input', doSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { results.classList.add('hidden'); input.blur(); }
    if (e.key === 'Enter') results.querySelector('a')?.click();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) results.classList.add('hidden'); });
  window.addEventListener('hashchange', () => results.classList.add('hidden'));
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) { e.preventDefault(); input.focus(); }
  });

  const userbox = h('div', { class: 'userbox' },
    h('span', { class: 'name' }, h('b', null, state.user.name || state.user.username), ' · ', ROLE_LABEL[state.user.role]),
    h('button', { class: 'icon-btn', type: 'button', title: 'Cambiar contraseña', onclick: changePassword }, icon('key')),
    h('button', { class: 'icon-btn', type: 'button', title: 'Cerrar sesión', onclick: async () => { await guard(() => api.post('/api/auth/logout')); state.user = null; showLogin(); } }, icon('out')));
  const top = h('header', { class: 'topbar' }, h('div', { class: 'crumbs', id: 'crumbs' }), h('div', { class: 'search' }, h('span', { class: 'ico' }, icon('search', 16)), input, results), userbox);
  mainEl = h('main', { id: 'main' });
  app.append(nav, top, mainEl);
  mountPanel(app);
}

async function changePassword() {
  const v = await formModal({ title: 'Cambiar contraseña', fields: [
    { name: 'current', label: 'Contraseña actual', type: 'password', required: true },
    { name: 'next', label: 'Nueva contraseña (mínimo 10 caracteres)', type: 'password', required: true }] });
  if (v && await guard(() => api.post('/api/auth/password', v))) toast('Contraseña actualizada');
}

// ---------- Enrutado ----------
const TITLES = { '': 'Inicio', mapa: 'Mapa geográfico', planta: 'Planta externa FTTH', nodos: 'Nodos y racks', nodo: 'Nodo', fibra: 'Fibra óptica FTTH', radioenlaces: 'Radioenlaces', conexiones: 'Conexiones', inventario: 'Inventario', historial: 'Historial', usuarios: 'Usuarios' };
let routeToken = 0;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qstr = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: Object.fromEntries(new URLSearchParams(qstr)) };
}

async function route() {
  if (!state.user) return;
  const token = ++routeToken;
  const { parts, query } = parseHash();
  const [section = '', a, b, c] = parts;
  closePanel(true);
  document.querySelectorAll('[data-nav]').forEach((el) => {
    const k = el.dataset.nav.replace('#/', '');
    el.classList.toggle('active', k === section || (k === 'nodos' && section === 'nodo') || (k === '' && section === ''));
  });
  document.getElementById('crumbs').replaceChildren(h('b', null, TITLES[section] || 'Smart Connection'));
  document.title = `${TITLES[section] || 'Documentación'} · Smart Connection`;
  const view = h('div', { style: { height: (section === 'mapa' || section === 'planta') ? '100%' : null } });
  mainEl.replaceChildren(view);
  mainEl.scrollTop = 0;
  try {
    switch (section) {
      case '': await homeView(view); break;
      case 'mapa': await mapView(view, query); break;
      case 'planta': await plantaView(view, query); break;
      case 'nodos': await nodesView(view); break;
      case 'nodo': await nodeView(view, Number(a), b, c, query); if (token === routeToken) { const n = view.querySelector('.page-head h2'); if (n) document.getElementById('crumbs').replaceChildren('Nodos › ', h('b', null, n.textContent)); } break;
      case 'fibra': await fiberView(view, query); break;
      case 'radioenlaces': await radioView(view, query); break;
      case 'conexiones': await connectionsView(view, query); break;
      case 'inventario': await inventoryView(view, query); break;
      case 'historial': await historyView(view); break;
      case 'usuarios': if (state.user.role !== 'admin') throw new Error('Solo los administradores pueden gestionar usuarios'); await usersView(view); break;
      default: view.append(h('div', { class: 'page' }, h('div', { class: 'empty' }, 'Página no encontrada. ', h('a', { class: 'link', href: '#/' }, 'Ir al inicio'))));
    }
  } catch (e) {
    if (token !== routeToken) return;
    console.error(e);
    clear(view);
    view.append(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('p', null, e.message || 'Error al cargar la vista'), h('a', { class: 'link', href: '#/' }, 'Volver al inicio'))));
  }
}

async function boot() {
  try { state.meta = state.meta || await api.get('/api/meta'); } catch { /* se reintenta tras login */ }
  if (!state.meta) state.meta = await api.get('/api/meta');
  buildShell();
  await route();
}

window.addEventListener('hashchange', route);
window.addEventListener('sd:unauthorized', () => { if (state.user) { state.user = null; showLogin('La sesión expiró. Ingrese nuevamente.'); } });

(async () => {
  try {
    state.user = await api.get('/api/auth/me');
    await boot();
  } catch {
    showLogin();
  }
})();

export { can };
