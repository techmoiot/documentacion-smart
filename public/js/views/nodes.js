// Panel de inicio, listado de nodos y ficha de nodo
import { api } from '../api.js';
import { NODE_TYPE, DEVICE_TYPE, STATUS } from '../catalog.js';
import {
  h, btn, badge, icon, props, clear, can, guard, toast, confirmBox, openPanel, closePanel, emptyState, go, fmt, state,
} from '../ui.js';
import { nodeForm, deviceForm, deviceCard, filesWidget, historyList, showImpact, auditRow } from '../shared.js';
import { rackView } from './rack.js';
import { topologyView } from './topology.js';
import { antennaForm } from './radio.js';

// ---------- Inicio ----------
export async function homeView(root) {
  clear(root);
  const [st, audit] = await Promise.all([api.get('/api/stats'), api.get('/api/audit?limit=8')]);
  const stat = (n, label, href) => h('a', { class: 'stat', href }, h('b', null, n), h('span', null, label));
  const hrefFor = { nodo: (p) => `#/nodo/${p.id}`, equipo: (p) => `#/inventario?device=${p.id}`, radioenlace: (p) => `#/radioenlaces?link=${p.id}`, fibra: (p) => `#/fibra?sel=${p.id}` };
  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h2', null, 'Visión general de la red'), h('span', { class: 'muted' }, 'Topos · Smart Connection')),
    h('div', { class: 'stats' },
      stat(st.nodes, 'Nodos y sitios', '#/nodos'), stat(st.racks, 'Racks', '#/nodos'), stat(st.devices, 'Equipos', '#/inventario'), stat(st.ports, 'Puertos documentados', '#/inventario'),
      stat(st.connections, 'Conexiones', '#/conexiones'), stat(st.antennas, 'Antenas', '#/radioenlaces'), stat(st.radiolinks, 'Radioenlaces', '#/radioenlaces'),
      stat(st.fiberElements, 'Elementos de fibra', '#/fibra'), stat(st.clients, 'Clientes FTTH', '#/fibra')),
    h('div', { class: 'two-col' },
      h('div', { class: 'box' }, h('h4', { style: { marginTop: 0 } }, 'Elementos con atención requerida'),
        st.problems.length
          ? h('ul', { class: 'simple', style: { listStyle: 'none', padding: 0 } }, st.problems.map((p) => h('li', { style: { margin: '6px 0' } }, badge(p.status), ' ', h('span', { class: 'muted small' }, `${p.entity} · `), h('a', { class: 'link', href: (hrefFor[p.entity] || (() => '#/'))(p) }, p.name))))
          : h('p', { class: 'muted' }, 'Todo operativo: no hay elementos degradados ni fuera de servicio.')),
      h('div', { class: 'box' }, h('h4', { style: { marginTop: 0 } }, 'Últimos cambios'),
        audit.length ? h('ul', { class: 'audit' }, audit.map(auditRow)) : h('p', { class: 'muted' }, 'Sin actividad registrada.'),
        h('p', null, h('a', { class: 'link', href: '#/historial' }, 'Ver historial completo →'))))));
}

// ---------- Listado ----------
export async function nodesView(root) {
  clear(root);
  const nodes = await api.get('/api/map').then((m) => m.nodes);
  const q = h('input', { type: 'search', placeholder: 'Buscar nodo, código o dirección…' });
  const type = h('select', null, h('option', { value: '' }, 'Todos los tipos'), Object.entries(NODE_TYPE).map(([k, o]) => h('option', { value: k }, o.label)));
  const status = h('select', null, h('option', { value: '' }, 'Todos los estados'), Object.entries(STATUS).map(([k, o]) => h('option', { value: k }, o.label)));
  const cards = h('div', { class: 'cards' });
  const render = () => {
    clear(cards);
    const term = q.value.trim().toLowerCase();
    const list = nodes.filter((n) => (!type.value || n.type === type.value) && (!status.value || n.status === status.value)
      && (!term || `${n.name} ${n.code} ${n.address}`.toLowerCase().includes(term)));
    if (!list.length) { cards.append(emptyState('No hay nodos que coincidan.')); return; }
    for (const n of list) {
      const nt = NODE_TYPE[n.type] || NODE_TYPE.otro;
      cards.append(h('a', { class: 'card', href: `#/nodo/${n.id}`, style: { '--c': STATUS[n.status]?.color } },
        h('div', { class: 'row gap' }, h('span', { class: 'chip', style: { '--c': nt.color } }, nt.label), badge(n.status)),
        h('h3', { style: { marginTop: '8px' } }, n.name), h('div', { class: 'muted small' }, n.code),
        h('div', { class: 'muted small' }, n.address || (n.lat != null ? `${n.lat.toFixed(4)}, ${n.lng.toFixed(4)}` : 'Sin ubicación')),
        h('div', { class: 'meta' }, h('span', null, `${n.device_count} equipos`), h('span', null, `${n.antenna_count} antenas`))));
    }
  };
  [q, type, status].forEach((el) => el.addEventListener('input', render));
  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h2', null, 'Nodos y sitios'), h('span', { class: 'grow' }),
      can('write') ? btn('Nuevo nodo', { ic: 'plus', kind: 'primary', onClick: async () => { const n = await nodeForm(); if (n) go(`#/nodo/${n.id}`); } }) : null),
    h('div', { class: 'filters' }, q, type, status), cards));
  render();
}

// ---------- Ficha de nodo ----------
const TABS = [['resumen', 'Resumen', 'home'], ['rack', 'Racks', 'rack'], ['topologia', 'Topología', 'topo'], ['equipos', 'Equipos', 'box'], ['antenas', 'Antenas', 'radio'], ['archivos', 'Fotografías', 'eye'], ['historial', 'Historial', 'history']];

export async function nodeView(root, id, tab, sub, query) {
  clear(root);
  const node = await api.get(`/api/nodes/${id}/full`);
  const nt = NODE_TYPE[node.type] || NODE_TYPE.otro;
  const body = h('div');
  const active = tab || 'resumen';
  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', null, h('div', { class: 'row gap wrap' }, h('h2', null, node.name), badge(node.status), h('span', { class: 'chip', style: { '--c': nt.color } }, nt.label)), h('div', { class: 'muted' }, `${node.code}${node.location ? ' · ' + node.location : ''}`)),
      h('span', { class: 'grow' }),
      node.lat != null ? btn('Ver en mapa', { ic: 'map', onClick: () => go(`#/mapa?node=${node.id}`) }) : null,
      btn('Impacto de falla', { ic: 'alert', onClick: () => showImpact('node', node.id) }),
      can('update') ? btn('Editar', { ic: 'edit', onClick: async () => { if (await nodeForm(node)) go(location.hash); } }) : null,
      can('write') ? btn('Eliminar', { ic: 'trash', kind: 'danger', onClick: async () => {
        if (!(await confirmBox(`¿Eliminar el nodo «${node.name}»? Se eliminarán sus racks y antenas; los equipos quedarán sin nodo.`))) return;
        if (await guard(() => api.del(`/api/nodes/${node.id}`))) { toast('Nodo eliminado'); go('#/nodos'); }
      } }) : null),
    h('nav', { class: 'tabs', 'aria-label': 'Secciones del nodo' }, TABS.map(([k, label, ic]) => h('a', { href: `#/nodo/${node.id}/${k}`, class: k === active ? 'active' : '' }, icon(ic, 15), label))),
    body));

  switch (active) {
    case 'rack': await rackView(body, node, sub, query); break;
    case 'topologia': await topologyView(body, node, query); break;
    case 'equipos': devicesTab(body, node); break;
    case 'antenas': antennasTab(body, node); break;
    case 'archivos': body.append(h('div', { class: 'box' }, filesWidget('node', node.id))); break;
    case 'historial': body.append(h('div', { class: 'box' }, historyList('nodes', node.id, 100))); break;
    default: summaryTab(body, node);
  }
}

function summaryTab(body, node) {
  const used = node.devices.reduce((a, d) => a + (d.rack_id ? d.u_height : 0), 0);
  const cap = node.racks.reduce((a, r) => a + r.units, 0);
  body.append(h('div', { class: 'two-col' },
    h('div', { class: 'box' }, h('h4', { style: { marginTop: 0 } }, 'Ficha técnica'), props([
      ['Nombre', node.name], ['Código', node.code], ['Tipo', NODE_TYPE[node.type]?.label], ['Estado', badge(node.status)],
      ['Ubicación', node.location], ['Dirección / referencia', node.address],
      ['Coordenadas GPS', node.lat != null ? `${node.lat}, ${node.lng}` : null], ['Fecha de instalación', fmt.date(node.installed_at)], ['Responsable técnico', node.responsible],
      ['Descripción', node.description],
    ])),
    h('div', { class: 'box' }, h('h4', { style: { marginTop: 0 } }, 'Infraestructura'), props([
      ['Racks', node.racks.length ? node.racks.map((r) => h('a', { class: 'link', href: `#/nodo/${node.id}/rack/${r.id}`, style: { marginRight: '10px' } }, `${r.name} (${r.units}U)`)) : 'Sin racks'],
      ['Ocupación', cap ? `${used} U de ${cap} U (${Math.round((used / cap) * 100)} %)` : '—'], ['Equipos', node.devices.length],
      ['Antenas', node.antennas.length],
    ]), h('h4', null, 'Fotografías del sitio'), filesWidget('node', node.id))));
}

function devicesTab(body, node) {
  const rows = node.devices;
  const tbl = h('table', { class: 't' },
    h('thead', null, h('tr', null, ['Equipo', 'Tipo', 'Marca / modelo', 'IP', 'Ubicación', 'Puertos', 'Estado'].map((c) => h('th', null, c)))),
    h('tbody', null, rows.map((d) => h('tr', { onclick: async () => {
      const full = await guard(() => api.get(`/api/devices/${d.id}/full`));
      if (full) openPanel(full.name, deviceCard(full, { onChanged: () => { closePanel(true); go(location.hash); } }));
    } },
    h('td', null, h('strong', null, d.name)), h('td', null, DEVICE_TYPE[d.type]?.label || d.type), h('td', null, [d.brand, d.model].filter(Boolean).join(' ')), h('td', null, d.ip),
    h('td', null, d.rack_id ? `Rack · U${d.rack_u}` : d.location || '—'), h('td', null, `${d.conn_count} / ${d.port_count}`), h('td', null, badge(d.status))))));
  body.append(
    can('write') ? h('div', { class: 'page-head' }, btn('Nuevo equipo', { ic: 'plus', kind: 'primary', onClick: async () => { if (await deviceForm({ node_id: node.id })) go(location.hash); } })) : null,
    rows.length ? h('div', { class: 'table-wrap' }, tbl) : emptyState('Este nodo no tiene equipos registrados.'));
}

function antennasTab(body, node) {
  body.append(
    can('write') ? h('div', { class: 'page-head' }, btn('Nueva antena', { ic: 'plus', kind: 'primary', onClick: async () => { if (await antennaForm(null, node.id)) go(location.hash); } })) : null,
    node.antennas.length
      ? h('div', { class: 'cards' }, node.antennas.map((a) => h('a', { class: 'card', href: `#/radioenlaces?antenna=${a.id}`, style: { '--c': STATUS[a.status]?.color } },
        h('div', { class: 'row gap' }, h('span', { class: 'chip' }, a.role || 'antena'), badge(a.status)), h('h3', { style: { marginTop: '8px' } }, a.name),
        h('div', { class: 'muted small' }, [a.brand, a.model].filter(Boolean).join(' ')), h('div', { class: 'meta' }, h('span', null, a.ip || 'sin IP'), h('span', null, a.freq_mhz ? `${a.freq_mhz} MHz` : '')))))
      : emptyState('Este nodo no tiene antenas registradas.'));
}
