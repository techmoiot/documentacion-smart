// Componentes compartidos entre vistas: formularios de entidades, fichas, archivos, historial e impacto
import { api, qs } from './api.js';
import { STATUS, NODE_TYPE, DEVICE_TYPE, PORT_KIND, LOGICAL, TEMPLATES } from './catalog.js';
import {
  h, btn, badge, props, icon, fmt, can, toast, guard, modal, formModal, confirmBox, clear, emptyState, go, state,
} from './ui.js';

const statusOptions = () => Object.entries(STATUS).map(([v, o]) => [v, o.label]);

// ---------- Nodo ----------
export async function nodeForm(node = null) {
  const v = await formModal({
    title: node ? `Editar nodo · ${node.name}` : 'Nuevo nodo / sitio',
    values: node || { type: 'distribucion', status: 'operativo' },
    wide: true,
    fields: [
      { name: 'name', label: 'Nombre del nodo', required: true, maxlength: 80 },
      { name: 'code', label: 'Código de identificación', required: true, maxlength: 30 },
      { name: 'type', label: 'Tipo de nodo', type: 'select', options: Object.entries(NODE_TYPE).map(([k, o]) => [k, o.label]) },
      { name: 'status', label: 'Estado operativo', type: 'select', options: statusOptions() },
      { name: 'lat', label: 'Latitud (GPS)', type: 'number', step: 'any', min: -90, max: 90, placeholder: '14.634900' },
      { name: 'lng', label: 'Longitud (GPS)', type: 'number', step: 'any', min: -180, max: 180, placeholder: '-90.506900' },
      { name: 'height_m', label: 'Altura de la torre / estructura (m)', type: 'number', step: 'any', min: 0 },
      { name: 'structure', label: 'Tipo de estructura', placeholder: 'Autosoportada, venteada, monopolo…', maxlength: 60 },
      { name: 'location', label: 'Ubicación geográfica (municipio, zona)' },
      { name: 'address', label: 'Dirección o referencia' },
      { name: 'installed_at', label: 'Fecha de instalación', type: 'date' },
      { name: 'responsible', label: 'Responsable técnico' },
      { name: 'description', label: 'Descripción técnica', type: 'textarea' },
    ],
  });
  if (!v) return null;
  return guard(() => (node ? api.patch(`/api/nodes/${node.id}`, v) : api.post('/api/nodes', v)));
}

// ---------- Selector de puertos por tipo (editor de grupos) ----------
function portGroupsEditor() {
  const rows = h('div', { class: 'pg-rows' });
  const kinds = Object.entries(PORT_KIND).map(([k, o]) => [k, o.label]);
  const addRow = (g = { kind: 'rj45', prefix: 'ether', count: 8, speed: '1G', start: 1 }) => {
    const sel = h('select', null, kinds.map(([k, l]) => h('option', { value: k, selected: k === g.kind }, l)));
    const prefix = h('input', { type: 'text', placeholder: 'Prefijo (ether, SFP+…)', maxlength: 24 }); prefix.value = g.prefix ?? '';
    const start = h('input', { type: 'number', min: 0, max: 999, title: 'Primer número' }); start.value = g.start ?? 1;
    const count = h('input', { type: 'number', min: 1, max: 192, title: 'Cantidad' }); count.value = g.count ?? 1;
    const speed = h('input', { type: 'text', placeholder: 'Velocidad', maxlength: 20 }); speed.value = g.speed ?? '';
    const row = h('div', { class: 'pg-row' }, sel, prefix, h('label', { class: 'mini' }, 'desde', start), h('label', { class: 'mini' }, 'cant.', count), speed,
      h('button', { class: 'icon-btn', type: 'button', title: 'Quitar grupo', onclick: () => row.remove() }, icon('trash', 14)));
    row._get = () => ({ kind: sel.value, prefix: prefix.value, start: Number(start.value), count: Number(count.value), speed: speed.value });
    rows.append(row);
  };
  const el = h('div', { class: 'pg' }, rows, h('button', { class: 'btn small', type: 'button', onclick: () => addRow() }, icon('plus', 14), ' Grupo de puertos'),
    h('small', { class: 'muted' }, 'Ej.: ether × 24, SFP+ × 4. Los nombres se generan como prefijo + número.'));
  return {
    el,
    set: (groups) => { clear(rows); groups.forEach(addRow); },
    get: () => [...rows.children].map((r) => r._get()).filter((g) => g.count > 0),
  };
}

// ---------- Equipo ----------
export async function deviceForm({ device = null, node_id = null, rack_id = null, rack_u = null } = {}) {
  const [nodes, racks] = await Promise.all([api.get('/api/nodes'), api.get('/api/racks')]);
  const pg = portGroupsEditor();
  const isNew = !device;
  const rackOptions = (nid) => [['', '— Sin rack —'], ...racks.filter((r) => String(r.node_id) === String(nid)).map((r) => [r.id, `${r.name} (${r.units}U)`])];
  const values = device || { type: 'other', status: 'operativo', u_height: 1, node_id, rack_id, rack_u };
  const fields = [];
  if (isNew) {
    fields.push({
      name: 'template', label: 'Plantilla de equipo', type: 'select', span: 2,
      options: [['', '— Equipo personalizado —'], ...TEMPLATES.map((t) => [t.id, t.label])],
      hint: 'Rellena tipo, marca, modelo, altura en U y puertos. Todo es editable.',
      onChange: (sel, inputs) => {
        const t = TEMPLATES.find((x) => x.id === sel.value);
        if (!t) return;
        inputs.type.el.value = t.type; inputs.brand.el.value = t.brand; inputs.model.el.value = t.model; inputs.u_height.el.value = t.u;
        if (!inputs.name.el.value) inputs.name.el.value = t.label;
        pg.set(t.groups);
      },
    });
  }
  fields.push(
    { name: 'name', label: 'Nombre', required: true, maxlength: 80 },
    { name: 'type', label: 'Tipo', type: 'select', options: Object.entries(DEVICE_TYPE).map(([k, o]) => [k, o.label]) },
    { name: 'brand', label: 'Marca' }, { name: 'model', label: 'Modelo' },
    { name: 'serial', label: 'Número de serie' }, { name: 'ip', label: 'Dirección IP' },
    { name: 'mac', label: 'Dirección MAC' }, { name: 'firmware', label: 'Firmware / sistema operativo' },
    { name: 'status', label: 'Estado', type: 'select', options: statusOptions() },
    { name: 'installed_at', label: 'Fecha de instalación', type: 'date' },
    { name: 'section1', type: 'section', label: 'Ubicación' },
    {
      name: 'node_id', label: 'Nodo asociado', type: 'select', options: [['', '— Sin nodo —'], ...nodes.map((n) => [n.id, `${n.code} · ${n.name}`])],
      onChange: (sel, inputs) => {
        const r = inputs.rack_id.el; clear(r);
        for (const [val, l] of rackOptions(sel.value)) r.append(h('option', { value: val }, l));
      },
    },
    { name: 'rack_id', label: 'Rack', type: 'select', options: rackOptions(values.node_id) },
    { name: 'rack_u', label: 'Posición U (unidad inferior que ocupa)', type: 'number', min: 1, max: 60 },
    { name: 'u_height', label: 'Altura (U)', type: 'number', min: 1, max: 20, required: true },
    { name: 'location', label: 'Ubicación física (si no está en rack)', span: 2 },
    { name: 'notes', label: 'Notas técnicas', type: 'textarea' },
  );
  if (isNew) fields.push({ name: 'port_groups', label: 'Puertos del equipo', type: 'custom', render: () => { pg.set([]); return pg; } });
  const v = await formModal({ title: isNew ? 'Nuevo equipo' : `Editar equipo · ${device.name}`, fields, values, wide: true });
  if (!v) return null;
  const body = { ...v };
  delete body.template; delete body.section1;
  body.node_id = body.node_id === '' ? null : Number(body.node_id);
  body.rack_id = body.rack_id === '' ? null : Number(body.rack_id);
  body.rack_u = body.rack_id ? Number(body.rack_u) || null : null;
  body.u_height = Number(body.u_height) || 1;
  if (!isNew) delete body.port_groups;
  return guard(() => (isNew ? api.post('/api/devices', body) : api.patch(`/api/devices/${device.id}`, body)));
}

export async function addPortsForm(device) {
  const v = await formModal({
    title: `Agregar puertos · ${device.name}`,
    fields: [
      { name: 'kind', label: 'Tipo de puerto', type: 'select', options: Object.entries(PORT_KIND).map(([k, o]) => [k, o.label]) },
      { name: 'prefix', label: 'Prefijo del nombre', placeholder: 'ether, SFP+, PON…' },
      { name: 'start', label: 'Primer número', type: 'number', default: 1 },
      { name: 'count', label: 'Cantidad', type: 'number', min: 1, max: 192, required: true, default: 1 },
      { name: 'speed', label: 'Velocidad' },
    ],
  });
  if (!v) return null;
  return guard(() => api.post(`/api/devices/${device.id}/ports`, { ...v, start: Number(v.start), count: Number(v.count) }));
}

// ---------- Rack ----------
export async function rackForm(nodeId, rack = null) {
  const v = await formModal({
    title: rack ? `Editar rack · ${rack.name}` : 'Nuevo rack',
    values: rack || { units: 42 },
    fields: [
      { name: 'name', label: 'Nombre del rack', required: true, maxlength: 60 },
      { name: 'units', label: 'Unidades (U)', type: 'number', min: 1, max: 60, required: true },
      { name: 'notes', label: 'Notas', type: 'textarea' },
    ],
  });
  if (!v) return null;
  v.units = Number(v.units);
  return guard(() => (rack ? api.patch(`/api/racks/${rack.id}`, v) : api.post('/api/racks', { ...v, node_id: nodeId })));
}

// ---------- Conexiones ----------
function endpointPicker(title, devices, nodes, initial, currentConnId) {
  const nodeSel = h('select', null, h('option', { value: '' }, 'Todos los nodos'), nodes.map((n) => h('option', { value: n.id }, n.name)));
  const devSel = h('select', { required: true });
  const portSel = h('select');
  const info = h('small', { class: 'muted' });
  const fill = () => {
    const keep = devSel.value;
    clear(devSel);
    devSel.append(h('option', { value: '' }, '— Equipo —'));
    for (const d of devices.filter((x) => !nodeSel.value || String(x.node_id) === nodeSel.value)) {
      devSel.append(h('option', { value: d.id, selected: String(d.id) === keep }, `${d.name}`));
    }
  };
  const loadPorts = async (selectedPort) => {
    clear(portSel);
    portSel.append(h('option', { value: '' }, '— Puerto (opcional en lógicas) —'));
    if (!devSel.value) return;
    const dev = await guard(() => api.get(`/api/devices/${devSel.value}/full`));
    if (!dev) return;
    for (const p of dev.ports) {
      const used = p.link && p.link.conn_id !== currentConnId;
      portSel.append(h('option', { value: p.id, selected: String(p.id) === String(selectedPort), disabled: used },
        `${p.name} · ${PORT_KIND[p.kind]?.label || p.kind}${used ? ` (en uso → ${p.link.remote_device_name}:${p.link.remote_port_name})` : ''}`));
    }
    info.textContent = dev.node ? `Nodo: ${dev.node.name}${dev.rack ? ` · ${dev.rack.name} U${dev.rack_u}` : ''}` : 'Sin nodo asignado';
  };
  if (initial.device_id) {
    const d = devices.find((x) => x.id === initial.device_id);
    if (d?.node_id) nodeSel.value = d.node_id;
  }
  fill();
  if (initial.device_id) { devSel.value = initial.device_id; loadPorts(initial.port_id); }
  nodeSel.addEventListener('change', () => { fill(); loadPorts(); });
  devSel.addEventListener('change', () => loadPorts());
  const el = h('fieldset', { class: 'endpoint' }, h('legend', null, title), nodeSel, devSel, portSel, info);
  return {
    el, get: () => ({ device_id: devSel.value ? Number(devSel.value) : null, port_id: portSel.value ? Number(portSel.value) : null }),
    lock() { nodeSel.disabled = devSel.disabled = true; },
  };
}

export async function connectionForm({ conn = null, preset = {} } = {}) {
  const [devices, nodes] = await Promise.all([api.get('/api/devices'), api.get('/api/nodes')]);
  const A = endpointPicker('Origen', devices, nodes, { device_id: conn?.a_device_id ?? preset.a_device_id, port_id: conn?.a_port_id ?? preset.a_port_id }, conn?.id);
  const B = endpointPicker('Destino', devices, nodes, { device_id: conn?.b_device_id ?? preset.b_device_id, port_id: conn?.b_port_id ?? preset.b_port_id }, conn?.id);
  if (preset.lockA) A.lock();
  const v = await formModal({
    title: conn ? `Editar conexión #${conn.id}` : 'Nueva conexión', wide: true,
    values: conn || { layer: preset.layer || 'physical', status: 'operativo' },
    fields: [
      { name: 'layer', label: 'Capa', type: 'select', options: [['physical', 'Física (cable / fibra)'], ['logical', 'Lógica (VLAN, interfaz virtual, troncal, red IP…)']] },
      { name: 'conn_type', label: 'Tipo de conexión', hint: 'Ej.: uplink, troncal, PON, gestión, VLAN, red IP' },
      { name: 'ends', type: 'custom', label: '', render: () => ({ el: h('div', { class: 'endpoints' }, A.el, B.el), get: () => ({ a: A.get(), b: B.get() }) }) },
      { name: 'medium', label: 'Medio físico', placeholder: 'UTP Cat6, fibra OM3 LC, patch cord SC/APC…' },
      { name: 'cable_id', label: 'Identificador del cable' },
      { name: 'speed', label: 'Velocidad / capacidad', placeholder: '1G, 10G, GPON…' },
      { name: 'status', label: 'Estado', type: 'select', options: statusOptions() },
      { name: 'vlan', label: 'VLAN(s)', hint: 'Solo conexiones lógicas, ej. 100,200' },
      { name: 'network', label: 'Red IP', hint: 'Ej. 10.10.0.0/24' },
      { name: 'notes', label: 'Observaciones', type: 'textarea' },
    ],
  });
  if (!v) return null;
  const { ends, ...rest } = v;
  const body = { ...rest, a_device_id: ends.a.device_id, a_port_id: ends.a.port_id, b_device_id: ends.b.device_id, b_port_id: ends.b.port_id };
  return guard(() => (conn ? api.patch(`/api/connections/${conn.id}`, body) : api.post('/api/connections', body)));
}

const endLabel = (c, side) => {
  const n = c[`${side}_node_name`], d = c[`${side}_device_name`], p = c[`${side}_port_name`];
  return [n, d, p && `puerto ${p}`].filter(Boolean).join(' › ');
};

/** Ficha de una conexión (ambos extremos). */
export function connectionCard(c, { onChanged, onFocus } = {}) {
  const end = (side, label) => {
    const rackId = c[`${side}_rack_id`], nodeId = c[`${side}_node_id`], devId = c[`${side}_device_id`];
    return h('div', { class: 'end-card' },
      h('div', { class: 'muted small' }, label),
      h('div', { class: 'end-main' }, h('strong', null, c[`${side}_device_name`]), c[`${side}_port_name`] ? h('span', { class: 'chip' }, c[`${side}_port_name`]) : h('span', { class: 'muted small' }, 'sin puerto')),
      h('div', { class: 'muted small' }, c[`${side}_node_name`] || 'Sin nodo'),
      nodeId && rackId ? h('a', { class: 'link small', href: `#/nodo/${nodeId}/rack/${rackId}?device=${devId}${c[`${side}_port_id`] ? `&port=${c[`${side}_port_id`]}` : ''}` }, 'Ver en el rack →') : null);
  };
  const logical = c.layer === 'logical';
  return h('div', { class: 'conn-card' },
    h('div', { class: 'row gap' }, h('span', { class: `chip ${logical ? 'violet' : 'blue'}` }, logical ? 'Lógica' : 'Física'), badge(c.status)),
    end('a', 'Origen'), h('div', { class: 'conn-arrow' }, '⇅'), end('b', 'Destino'),
    props([
      ['Tipo de conexión', c.conn_type], ['Medio físico', c.medium], ['Identificador del cable', c.cable_id], ['Velocidad / capacidad', c.speed],
      logical ? ['VLAN', c.vlan] : null, logical ? ['Red IP', c.network] : null, ['Observaciones', c.notes],
    ]),
    h('div', { class: 'row gap wrap' },
      onFocus ? btn('Resaltar', { ic: 'target', onClick: onFocus }) : null,
      can('update') ? btn('Editar', { ic: 'edit', onClick: async () => { if (await connectionForm({ conn: c })) onChanged?.(); } }) : null,
      can('write') ? btn('Eliminar', { ic: 'trash', kind: 'danger', onClick: async () => {
        if (!(await confirmBox(`¿Eliminar la conexión ${endLabel(c, 'a')} ⇄ ${endLabel(c, 'b')}?`))) return;
        if (await guard(() => api.del(`/api/connections/${c.id}`))) { toast('Conexión eliminada'); onChanged?.(); }
      } }) : null));
}

// ---------- Archivos y fotografías ----------
export function filesWidget(entityType, entityId) {
  const root = h('div', { class: 'files' });
  const render = async () => {
    const files = await guard(() => api.get(`/api/files${qs({ entity_type: entityType, entity_id: entityId })}`)) || [];
    clear(root);
    const photos = files.filter((f) => f.kind === 'photo'), docs = files.filter((f) => f.kind !== 'photo');
    if (can('update')) {
      const input = h('input', { type: 'file', multiple: true, class: 'hidden', accept: 'image/*,.pdf,.txt,.csv,.md,.json,.log,.rsc,.cfg,.conf,.docx,.xlsx,.pptx,.zip,.backup' });
      input.addEventListener('change', async () => {
        for (const f of input.files) {
          await guard(async () => { await api.upload(`/api/files${qs({ entity_type: entityType, entity_id: entityId, name: f.name })}`, f); toast(`Subido: ${f.name}`); });
        }
        render();
      });
      root.append(h('div', { class: 'row gap' }, btn('Subir fotos / archivos', { ic: 'upload', onClick: () => input.click() }), input));
    }
    root.append(photos.length
      ? h('div', { class: 'gallery' }, photos.map((f) => h('figure', null,
        h('img', { src: `/files/${f.id}`, alt: f.original_name, loading: 'lazy', onclick: () => lightbox(f) }),
        h('figcaption', null, h('span', null, f.original_name), can('write') ? h('button', { class: 'icon-btn tiny', type: 'button', title: 'Eliminar', onclick: async () => {
          if (await confirmBox(`¿Eliminar «${f.original_name}»?`) && await guard(() => api.del(`/api/files/${f.id}`))) render();
        } }, icon('trash', 12)) : null))))
      : h('p', { class: 'muted small' }, 'Sin fotografías.'));
    if (docs.length) {
      root.append(h('ul', { class: 'doclist' }, docs.map((f) => h('li', null,
        h('a', { href: `/files/${f.id}?download=1`, class: 'link' }, f.original_name), h('span', { class: 'muted small' }, ` · ${(f.size / 1024).toFixed(0)} KB · ${fmt.date(f.created_at)}`),
        can('write') ? h('button', { class: 'icon-btn tiny', type: 'button', title: 'Eliminar', onclick: async () => {
          if (await confirmBox(`¿Eliminar «${f.original_name}»?`) && await guard(() => api.del(`/api/files/${f.id}`))) render();
        } }, icon('trash', 12)) : null))));
    }
  };
  render();
  return root;
}

function lightbox(f) {
  modal({ title: f.original_name, wide: true, body: h('img', { class: 'lightbox', src: `/files/${f.id}`, alt: f.original_name }) });
}

// ---------- Historial ----------
const ENTITY_LABEL = { nodes: 'Nodo', racks: 'Rack', devices: 'Equipo', connections: 'Conexión', fiber: 'Fibra', antennas: 'Antena', radiolinks: 'Radioenlace', poles: 'Poste', users: 'Usuario' };
export const entityLabel = (t) => ENTITY_LABEL[t] || t;

export function auditRow(a) {
  const diff = a.before || a.after ? Object.keys({ ...(a.before || {}), ...(a.after || {}) }).filter((k) => !['created_at', 'updated_at', 'props'].includes(k)).slice(0, 12) : [];
  const det = diff.length && a.action === 'modificar'
    ? h('details', { class: 'diff' }, h('summary', null, `${diff.length} campo(s)`), h('ul', null, diff.map((k) => h('li', null, h('code', null, k), ': ', h('del', null, fmt.val(a.before?.[k])), ' → ', h('ins', null, fmt.val(a.after?.[k]))))))
    : null;
  return h('li', { class: 'audit-item' },
    h('div', { class: 'row gap wrap' }, h('span', { class: `chip act-${a.action}` }, a.action.replace('_', ' ')), h('strong', null, a.username), h('span', { class: 'muted small' }, fmt.dt(a.at))),
    h('div', null, `${entityLabel(a.entity_type)}: ${a.summary}`), det);
}

export function historyList(entityType, entityId, limit = 30) {
  const root = h('div', { class: 'history' });
  api.get(`/api/audit${qs({ entity_type: entityType, entity_id: entityId, limit })}`).then((rows) => {
    root.append(rows.length ? h('ul', { class: 'audit' }, rows.map(auditRow)) : h('p', { class: 'muted small' }, 'Sin cambios registrados.'));
  }).catch((e) => root.append(h('p', { class: 'muted' }, e.message)));
  return root;
}

// ---------- Impacto de una falla ----------
export async function showImpact(type, id) {
  const r = await guard(() => api.get(`/api/impact/${type}/${id}`));
  if (!r) return;
  const section = (title, items, render) => items.length ? h('section', { class: 'impact-sec' }, h('h4', null, `${title} (${items.length})`), h('ul', null, items.map(render))) : null;
  const body = h('div', { class: 'impact' },
    h('p', { class: 'muted' }, 'Dependencias directas que se verían afectadas si falla este elemento.'),
    h('div', { class: 'impact-sum' },
      h('div', null, h('b', null, r.devices.length), ' equipos'), h('div', null, h('b', null, r.connections.length), ' conexiones'),
      h('div', null, h('b', null, r.radiolinks.length), ' radioenlaces'), h('div', null, h('b', null, r.clients), ' clientes FTTH'),
      h('div', null, h('b', null, r.nodes.length), ' otros nodos')),
    section('Equipos relacionados', r.devices, (d) => h('li', null, h('strong', null, d.name), ` · ${d.node || 'sin nodo'} `, h('span', { class: 'muted small' }, d.via))),
    section('Conexiones', r.connections, (c) => h('li', null, `${c.a_device_name}:${c.a_port_name || '—'} ⇄ ${c.b_device_name}:${c.b_port_name || '—'} `, h('span', { class: 'chip' }, c.layer === 'logical' ? 'lógica' : 'física'), ' ', badge(c.status))),
    section('Radioenlaces', r.radiolinks, (l) => h('li', null, h('strong', null, l.name), ` · ${l.a_node} → ${l.b_node} `, h('span', { class: 'chip' }, l.link_type), ' ', badge(l.status))),
    section('Fibra óptica', r.fiber, (f) => h('li', null, h('span', { class: 'chip' }, f.kind), ' ', f.name, f.code ? h('span', { class: 'muted small' }, ` · ${f.code}`) : null)),
    section('Otros nodos involucrados', r.nodes, (n) => h('li', null, h('a', { class: 'link', href: `#/nodo/${n.id}` }, `${n.code} · ${n.name}`), ' ', badge(n.status))));
  if (!r.devices.length && !r.connections.length && !r.radiolinks.length && !r.fiber.length) body.append(h('p', null, 'No se encontraron dependencias registradas.'));
  modal({ title: `Impacto de falla · ${r.target.name}`, wide: true, body });
}

// ---------- Ficha de equipo (panel) ----------
export function deviceCard(d, { onChanged, onFocus } = {}) {
  const dt = DEVICE_TYPE[d.type] || DEVICE_TYPE.other;
  const ports = d.ports || [];
  const used = ports.filter((p) => p.link).length;
  const root = h('div', { class: 'card-stack' },
    h('div', { class: 'row gap wrap' }, h('span', { class: 'chip', style: { '--c': dt.color } }, dt.label), badge(d.status)),
    props([
      ['Marca / modelo', [d.brand, d.model].filter(Boolean).join(' ')], ['Número de serie', d.serial], ['Dirección IP', d.ip], ['Dirección MAC', d.mac],
      ['Firmware / SO', d.firmware], ['Nodo', d.node ? h('a', { class: 'link', href: `#/nodo/${d.node.id}` }, `${d.node.name}`) : d.node_id ? h('a', { class: 'link', href: `#/nodo/${d.node_id}` }, 'Ver nodo') : null],
      ['Rack / posición', d.rack ? `${d.rack.name} · U${d.rack_u}${d.u_height > 1 ? `–U${d.rack_u + d.u_height - 1}` : ''}` : d.rack_id ? `U${d.rack_u}` : d.location || 'Sin rack'],
      ['Instalación', fmt.date(d.installed_at)], ['Puertos', ports.length ? `${used} en uso / ${ports.length}` : 'Sin puertos'], ['Notas', d.notes],
    ]),
    h('div', { class: 'row gap wrap' },
      onFocus ? btn('Acercar', { ic: 'zoomIn', onClick: onFocus }) : null,
      btn('Impacto de falla', { ic: 'alert', onClick: () => showImpact('device', d.id) }),
      can('update') ? btn('Editar', { ic: 'edit', onClick: async () => { if (await deviceForm({ device: d })) onChanged?.(); } }) : null,
      can('write') ? btn('+ Puertos', { ic: 'plus', onClick: async () => { if (await addPortsForm(d)) onChanged?.(); } }) : null,
      can('write') && d.rack_id ? btn('Retirar del rack', { onClick: async () => {
        if (!(await confirmBox(`¿Retirar «${d.name}» del rack? Seguirá en el inventario.`, { okLabel: 'Retirar', danger: false }))) return;
        if (await guard(() => api.patch(`/api/devices/${d.id}`, { rack_id: null }))) { toast('Equipo retirado del rack'); onChanged?.(); }
      } }) : null,
      can('write') ? btn('Eliminar', { ic: 'trash', kind: 'danger', onClick: async () => {
        if (!(await confirmBox(`¿Eliminar «${d.name}» y todas sus conexiones? Esta acción no se puede deshacer.`))) return;
        if (await guard(() => api.del(`/api/devices/${d.id}`))) { toast('Equipo eliminado'); onChanged?.(true); }
      } }) : null),
    h('h4', null, 'Fotografías y documentos'), filesWidget('device', d.id),
    h('h4', null, 'Historial'), historyList('devices', d.id, 15));
  if (d.logical?.length) {
    root.insertBefore(h('div', null, h('h4', null, 'Relaciones lógicas'), h('ul', { class: 'simple' }, d.logical.map((c) => h('li', null,
      `${LOGICAL[c.conn_type] || c.conn_type || 'Lógica'}: `, `${c.a_device_name}${c.a_port_name ? ':' + c.a_port_name : ''} ⇄ ${c.b_device_name}${c.b_port_name ? ':' + c.b_port_name : ''}`,
      c.vlan ? ` · VLAN ${c.vlan}` : '', c.network ? ` · ${c.network}` : '')))), root.children[3]);
  }
  return root;
}

export { emptyState, go, state };
