// Inventario de equipos, conexiones, historial y usuarios
import { api, qs } from '../api.js';
import { STATUS, DEVICE_TYPE, LOGICAL } from '../catalog.js';
import {
  h, btn, badge, icon, clear, can, guard, toast, confirmBox, formModal, openPanel, closePanel, emptyState, go, fmt, debounce, download, csvCell, state, ROLE_LABEL, projectChip,
} from '../ui.js';
import { deviceForm, templatesManager, deviceCard, connectionForm, connectionCard, auditRow, entityLabel } from './../shared.js';

// ---------- Inventario ----------
export async function inventoryView(root, query = {}) {
  clear(root);
  const [devices, nodes] = await Promise.all([api.get('/api/devices'), api.get('/api/nodes')]);
  const nm = new Map(nodes.map((n) => [n.id, n]));
  const rackNames = new Map((await api.get('/api/racks')).map((r) => [r.id, r.name]));
  const q = h('input', { type: 'search', placeholder: 'Buscar por nombre, IP, MAC, modelo, número de serie o nodo…', style: { minWidth: '320px' } });
  const fNode = h('select', null, h('option', { value: '' }, 'Todos los nodos'), nodes.map((n) => h('option', { value: n.id }, n.name)));
  const fType = h('select', null, h('option', { value: '' }, 'Todos los tipos'), Object.entries(DEVICE_TYPE).map(([k, o]) => h('option', { value: k }, o.label)));
  const fStatus = h('select', null, h('option', { value: '' }, 'Todos los estados'), Object.entries(STATUS).map(([k, o]) => h('option', { value: k }, o.label)));
  const tbody = h('tbody');
  const count = h('span', { class: 'muted' });
  let current = [];
  const render = () => {
    const t = q.value.trim().toLowerCase();
    current = devices.filter((d) => (!fNode.value || String(d.node_id) === fNode.value) && (!fType.value || d.type === fType.value) && (!fStatus.value || d.status === fStatus.value)
      && (!t || [d.name, d.ip, d.mac, d.model, d.brand, d.serial, nm.get(d.node_id)?.name].join(' ').toLowerCase().includes(t)));
    clear(tbody);
    count.textContent = `${current.length} de ${devices.length} equipos`;
    for (const d of current) {
      tbody.append(h('tr', { 'data-id': d.id, onclick: () => open(d.id) },
        h('td', null, h('strong', null, d.name), ' ', projectChip(d.project_id)), h('td', null, DEVICE_TYPE[d.type]?.label || d.type), h('td', null, [d.brand, d.model].filter(Boolean).join(' ')), h('td', null, d.serial),
        h('td', null, h('code', null, d.ip || '—')), h('td', null, d.mac), h('td', null, nm.get(d.node_id)?.name || '—'),
        h('td', null, d.rack_id ? `${rackNames.get(d.rack_id) || 'Rack'} · U${d.rack_u}` : d.location || '—'), h('td', null, badge(d.status))));
    }
    if (!current.length) tbody.append(h('tr', null, h('td', { colspan: 9 }, emptyState('Sin resultados.'))));
  };
  async function open(id) {
    const full = await guard(() => api.get(`/api/devices/${id}/full`));
    if (!full) return;
    tbody.querySelectorAll('tr').forEach((r) => r.classList.toggle('sel', r.dataset.id === String(id)));
    openPanel(full.name, deviceCard(full, { onChanged: async () => { closePanel(true); go(location.hash); } }), { subtitle: nm.get(full.node_id)?.name });
  }
  const exportCsv = () => {
    const cols = ['Nombre', 'Tipo', 'Marca', 'Modelo', 'Serie', 'IP', 'MAC', 'Firmware', 'Nodo', 'Rack', 'U', 'Instalación', 'Estado'];
    const lines = [cols.map(csvCell).join(',')];
    for (const d of current) lines.push([d.name, DEVICE_TYPE[d.type]?.label, d.brand, d.model, d.serial, d.ip, d.mac, d.firmware, nm.get(d.node_id)?.name, rackNames.get(d.rack_id), d.rack_u, d.installed_at, STATUS[d.status]?.label].map(csvCell).join(','));
    download(`inventario-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\r\n'));
  };
  [q, fNode, fType, fStatus].forEach((el) => el.addEventListener('input', debounce(render, 120)));
  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h2', null, 'Inventario de equipos'), count, h('span', { class: 'grow' }),
      btn('Exportar CSV', { ic: 'download', onClick: exportCsv }),
      btn('Plantillas', { ic: 'rack', title: 'Plantillas de equipos personalizadas', onClick: () => templatesManager() }),
      can('write') ? btn('Nuevo equipo', { ic: 'plus', kind: 'primary', onClick: async () => { if (await deviceForm()) go(location.hash); } }) : null),
    h('div', { class: 'filters' }, q, fNode, fType, fStatus),
    h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Nombre', 'Tipo', 'Marca / modelo', 'N.º de serie', 'IP', 'MAC', 'Nodo', 'Ubicación', 'Estado'].map((c) => h('th', null, c)))), tbody))));
  render();
  if (query.device) open(Number(query.device));
}

// ---------- Conexiones ----------
export async function connectionsView(root, query = {}) {
  clear(root);
  const [conns, nodes] = await Promise.all([api.get('/api/connections'), api.get('/api/nodes')]);
  const q = h('input', { type: 'search', placeholder: 'Buscar equipo, puerto, cable, VLAN o red…', style: { minWidth: '280px' } });
  const fLayer = h('select', null, h('option', { value: '' }, 'Física y lógica'), h('option', { value: 'physical' }, 'Solo físicas'), h('option', { value: 'logical' }, 'Solo lógicas'));
  const fNode = h('select', null, h('option', { value: '' }, 'Todos los nodos'), nodes.map((n) => h('option', { value: n.id }, n.name)));
  const fStatus = h('select', null, h('option', { value: '' }, 'Todos los estados'), Object.entries(STATUS).map(([k, o]) => h('option', { value: k }, o.label)));
  const tbody = h('tbody'), count = h('span', { class: 'muted' });
  const end = (c, s) => h('div', null, h('strong', null, c[`${s}_device_name`]), c[`${s}_port_name`] ? h('span', { class: 'chip', style: { marginLeft: '6px' } }, c[`${s}_port_name`]) : null, h('div', { class: 'muted small' }, c[`${s}_node_name`] || ''));
  const render = () => {
    const t = q.value.trim().toLowerCase();
    const list = conns.filter((c) => (!fLayer.value || c.layer === fLayer.value) && (!fStatus.value || c.status === fStatus.value)
      && (!fNode.value || String(c.a_node_id) === fNode.value || String(c.b_node_id) === fNode.value)
      && (!t || [c.a_device_name, c.b_device_name, c.a_port_name, c.b_port_name, c.cable_id, c.vlan, c.network, c.conn_type, c.medium].join(' ').toLowerCase().includes(t)));
    clear(tbody);
    count.textContent = `${list.length} conexiones`;
    for (const c of list) {
      tbody.append(h('tr', { 'data-id': c.id, onclick: () => open(c) },
        h('td', null, h('span', { class: `chip ${c.layer === 'logical' ? 'violet' : 'blue'}` }, c.layer === 'logical' ? 'Lógica' : 'Física')),
        h('td', null, end(c, 'a')), h('td', null, end(c, 'b')), h('td', null, [LOGICAL[c.conn_type] || c.conn_type, c.vlan && `VLAN ${c.vlan}`, c.network].filter(Boolean).join(' · ')),
        h('td', null, c.medium), h('td', null, c.cable_id), h('td', null, c.speed), h('td', null, badge(c.status))));
    }
    if (!list.length) tbody.append(h('tr', null, h('td', { colspan: 8 }, emptyState('Sin conexiones para el filtro actual.'))));
  };
  function open(c) {
    tbody.querySelectorAll('tr').forEach((r) => r.classList.toggle('sel', r.dataset.id === String(c.id)));
    openPanel(`Conexión #${c.id}`, connectionCard(c, { onChanged: () => { closePanel(true); go(location.hash); } }), { subtitle: `${c.a_device_name} ⇄ ${c.b_device_name}` });
  }
  [q, fLayer, fNode, fStatus].forEach((el) => el.addEventListener('input', debounce(render, 120)));
  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h2', null, 'Conexiones físicas y lógicas'), count, h('span', { class: 'grow' }),
      can('write') ? btn('Nueva conexión', { ic: 'plus', kind: 'primary', onClick: async () => { if (await connectionForm()) go(location.hash); } }) : null),
    h('div', { class: 'filters' }, q, fLayer, fNode, fStatus),
    h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Capa', 'Origen', 'Destino', 'Tipo / VLAN / red', 'Medio', 'Cable', 'Velocidad', 'Estado'].map((c) => h('th', null, c)))), tbody))));
  render();
  if (query.conn) { const c = conns.find((x) => x.id === Number(query.conn)); if (c) open(c); }
}

// ---------- Historial ----------
export async function historyView(root) {
  clear(root);
  const types = ['', 'nodes', 'racks', 'devices', 'connections', 'fiber', 'antennas', 'radiolinks', 'users'];
  const fType = h('select', null, types.map((t) => h('option', { value: t }, t ? entityLabel(t) : 'Todos los elementos')));
  const user = h('input', { type: 'search', placeholder: 'Filtrar por usuario…' });
  const list = h('ul', { class: 'audit' });
  const more = h('div', { style: { textAlign: 'center', marginTop: '14px' } });
  let offset = 0;
  const PAGE = 50;
  async function load(reset) {
    if (reset) { offset = 0; clear(list); }
    const rows = await guard(() => api.get(`/api/audit${qs({ entity_type: fType.value, username: user.value.trim(), limit: PAGE, offset })}`)) || [];
    rows.forEach((r) => list.append(auditRow(r)));
    offset += rows.length;
    clear(more);
    if (!list.children.length) list.append(h('li', { class: 'muted' }, 'Sin registros.'));
    if (rows.length === PAGE) more.append(btn('Cargar más', { onClick: () => load(false) }));
  }
  fType.addEventListener('change', () => load(true));
  user.addEventListener('input', debounce(() => load(true), 300));
  root.append(h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('h2', null, 'Historial de modificaciones')),
    h('div', { class: 'filters' }, fType, user), h('div', { class: 'box' }, list, more)));
  load(true);
}

// ---------- Usuarios ----------
export async function usersView(root) {
  clear(root);
  const tbody = h('tbody');
  async function render() {
    const users = await guard(() => api.get('/api/users')) || [];
    clear(tbody);
    for (const u of users) {
      const roleSel = h('select', { disabled: u.id === state.user.id, onchange: async (e) => { if (await guard(() => api.patch(`/api/users/${u.id}`, { role: e.target.value }))) toast('Rol actualizado'); render(); } },
        Object.entries(ROLE_LABEL).map(([k, l]) => h('option', { value: k, selected: k === u.role }, l)));
      tbody.append(h('tr', { style: { cursor: 'default' } }, h('td', null, h('strong', null, u.username)), h('td', null, u.name), h('td', null, roleSel),
        h('td', null, u.active ? badge('operativo') : badge('fuera_de_servicio')), h('td', null, fmt.date(u.created_at)),
        h('td', null, h('div', { class: 'row gap' },
          btn('Contraseña', { ic: 'key', onClick: async () => {
            const v = await formModal({ title: `Nueva contraseña · ${u.username}`, fields: [{ name: 'password', label: 'Contraseña (mínimo 10 caracteres)', type: 'password', required: true }] });
            if (v && await guard(() => api.patch(`/api/users/${u.id}`, { password: v.password }))) toast('Contraseña actualizada');
          } }),
          u.id !== state.user.id ? btn(u.active ? 'Desactivar' : 'Activar', { onClick: async () => { await guard(() => api.patch(`/api/users/${u.id}`, { active: !u.active })); render(); } }) : null,
          u.id !== state.user.id ? btn('', { ic: 'trash', kind: 'danger', title: 'Eliminar usuario', onClick: async () => { if (await confirmBox(`¿Eliminar al usuario «${u.username}»?`) && await guard(() => api.del(`/api/users/${u.id}`))) render(); } }) : null))));
    }
  }
  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h2', null, 'Usuarios y permisos'), h('span', { class: 'grow' }),
      btn('Nuevo usuario', { ic: 'plus', kind: 'primary', onClick: async () => {
        const v = await formModal({ title: 'Nuevo usuario', fields: [
          { name: 'username', label: 'Usuario', required: true }, { name: 'name', label: 'Nombre completo' },
          { name: 'role', label: 'Rol', type: 'select', options: Object.entries(ROLE_LABEL) },
          { name: 'password', label: 'Contraseña inicial (mínimo 10 caracteres)', type: 'password', required: true }] });
        if (v && await guard(() => api.post('/api/users', v))) { toast('Usuario creado'); render(); }
      } })),
    h('div', { class: 'box', style: { marginBottom: '14px' } },
      h('div', null, h('b', null, 'Roles: '), 'Administrador (control total) · Ingeniero de red (nodos, equipos, conexiones, fibra y radioenlaces) · Técnico (consulta y actualiza datos existentes, sube fotografías) · Solo lectura (visualización).')),
    h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Usuario', 'Nombre', 'Rol', 'Estado', 'Alta', ''].map((c) => h('th', null, c)))), tbody))));
  render();
}
