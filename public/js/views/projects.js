// Proyectos: crear, compartir con usuarios, fusionar y eliminar
import { api, projectCtx } from '../api.js';
import { h, btn, icon, clear, can, state, go, guard, toast, formModal, confirmBox, modal, emptyState } from '../ui.js';

export const PROJECT_COLORS = ['#38bdf8', '#22c55e', '#f59e0b', '#a78bfa', '#ec4899', '#f97316', '#14b8a6', '#ef4444'];

export async function reloadProjects() {
  state.projects = await api.get('/api/projects');
  if (projectCtx.id !== 'all' && !state.projects.some((p) => String(p.id) === projectCtx.id)) projectCtx.id = 'all';
  window.dispatchEvent(new CustomEvent('sd:projects'));
  return state.projects;
}

export function selectProject(id) {
  projectCtx.id = id;
  window.dispatchEvent(new CustomEvent('sd:projects'));
}

async function projectForm(p = null) {
  const v = await formModal({
    title: p ? `Editar proyecto · ${p.name}` : 'Nuevo proyecto', values: p || { color: PROJECT_COLORS[(state.projects?.length || 0) % PROJECT_COLORS.length] },
    fields: [
      { name: 'name', label: 'Nombre del proyecto', required: true, maxlength: 80, span: 2 },
      { name: 'description', label: 'Descripción', type: 'textarea', maxlength: 500 },
      { name: 'color', label: 'Color', type: 'select', options: PROJECT_COLORS.map((c, i) => [c, `Color ${i + 1}`]) },
    ],
  });
  if (!v) return null;
  return guard(() => (p ? api.patch(`/api/projects/${p.id}`, v) : api.post('/api/projects', v)));
}

async function shareDialog(p) {
  const users = (await guard(() => api.get('/api/users'))) || [];
  const members = new Set((p.members || []).map((m) => m.id));
  const boxes = users.filter((u) => u.role !== 'admin').map((u) => {
    const i = h('input', { type: 'checkbox', checked: members.has(u.id) });
    return { u, i, row: h('label', { class: 'row gap', style: { padding: '5px 2px', cursor: 'pointer' } }, i, h('span', null, h('strong', null, u.username), h('span', { class: 'muted small' }, ` · ${u.name || ''} · ${u.role}${u.active ? '' : ' · inactivo'}`))) };
  });
  const body = h('div', null,
    h('p', { class: 'muted small' }, 'Los administradores ven todos los proyectos. Marque quién más puede ver y trabajar en este proyecto (según su rol).'),
    boxes.length ? h('div', null, boxes.map((b) => b.row)) : h('p', { class: 'muted' }, 'No hay otros usuarios. Créelos en Usuarios.'));
  return new Promise((resolve) => {
    const m = modal({ title: `Compartir «${p.name}»`, body, onClose: () => resolve(false), actions: [
      btn('Cancelar', { onClick: () => { m.close(); } }),
      btn('Guardar', { kind: 'primary', onClick: async () => {
        const ok = await guard(() => api.put(`/api/projects/${p.id}/members`, { user_ids: boxes.filter((b) => b.i.checked).map((b) => b.u.id) }));
        if (ok) { toast('Acceso actualizado'); m.close(); resolve(true); }
      } })] });
  });
}

export async function projectsView(root) {
  clear(root);
  const projects = await reloadProjects();
  const isAdmin = state.user.role === 'admin';
  const page = h('div', { class: 'page' });
  const head = h('div', { class: 'page-head' }, h('h2', null, 'Proyectos'), h('span', { class: 'muted' }, `${projects.length} proyecto(s)`), h('span', { class: 'grow' }),
    projects.length > 1 ? btn('Ver todos juntos', { ic: 'map', onClick: () => { selectProject('all'); go('#/'); } }) : null,
    can('write') ? btn('Nuevo proyecto', { ic: 'plus', kind: 'primary', onClick: async () => { if (await projectForm()) go('#/proyectos'); } }) : null);
  page.append(head, h('p', { class: 'muted' }, 'Cada proyecto aísla sus nodos, racks, equipos, antenas, radioenlaces y planta externa. Elija el proyecto activo en la barra superior, o «Todos los proyectos» para verlos juntos.'));
  if (!projects.length) page.append(emptyState('No tiene proyectos asignados. Pida acceso a un administrador.'));
  const grid = h('div', { class: 'proj-grid' });
  for (const p of projects) {
    const c = p.counts;
    const active = projectCtx.id === String(p.id);
    const stat = (n, l) => (n ? h('span', { class: 'chip' }, `${n} ${l}`) : null);
    grid.append(h('div', { class: `card proj ${active ? 'active' : ''}`, style: { '--pc': p.color } },
      h('div', { class: 'row gap' }, h('span', { class: 'pdot' }), h('h3', { class: 'grow', style: { margin: 0 } }, p.name), active ? h('span', { class: 'chip' }, 'activo') : null),
      p.description ? h('p', { class: 'muted small' }, p.description) : null,
      h('div', { class: 'row gap wrap' }, stat(c.nodes, 'nodos'), stat(c.racks, 'racks'), stat(c.devices, 'equipos'), stat(c.antennas, 'antenas'), stat(c.radiolinks, 'radioenlaces'), stat(c.poles, 'postes'), stat(c.cables, 'cables'),
        Object.values(c).every((n) => !n) ? h('span', { class: 'muted small' }, 'Vacío') : null),
      isAdmin ? h('div', { class: 'muted small' }, `Acceso: administradores${p.members?.length ? ' + ' + p.members.map((m) => m.username).join(', ') : ''}`) : null,
      h('div', { class: 'row gap wrap', style: { marginTop: '10px' } },
        btn('Abrir', { kind: 'primary', onClick: () => { selectProject(String(p.id)); go('#/'); } }),
        can('write') ? btn('Editar', { ic: 'edit', onClick: async () => { if (await projectForm(p)) go('#/proyectos'); } }) : null,
        isAdmin ? btn('Compartir', { ic: 'users', onClick: async () => { if (await shareDialog(p)) go('#/proyectos'); } }) : null,
        isAdmin && projects.length > 1 ? btn('Fusionar en…', { onClick: async () => {
          const v = await formModal({ title: `Fusionar «${p.name}»`, fields: [{ name: 'into', label: 'Mover todo su contenido al proyecto', type: 'select', required: true, options: projects.filter((x) => x.id !== p.id).map((x) => [x.id, x.name]) }] });
          if (!v) return;
          if (!(await confirmBox(`Todo el contenido de «${p.name}» pasará al proyecto elegido y «${p.name}» dejará de existir.`, { okLabel: 'Fusionar', danger: true }))) return;
          if (await guard(() => api.post(`/api/projects/${p.id}/merge`, { into: Number(v.into) }))) { if (projectCtx.id === String(p.id)) selectProject('all'); toast('Proyectos fusionados'); go('#/proyectos'); }
        } }) : null,
        isAdmin && projects.length > 1 ? btn('', { ic: 'trash', title: 'Eliminar (solo si está vacío)', onClick: async () => {
          if (!(await confirmBox(`¿Eliminar el proyecto «${p.name}»?`))) return;
          if (await guard(() => api.del(`/api/projects/${p.id}`))) { if (projectCtx.id === String(p.id)) selectProject('all'); toast('Proyecto eliminado'); go('#/proyectos'); }
        } }) : null)));
  }
  page.append(grid);
  root.append(page);
}

/** Pregunta en qué proyecto crear cuando se está en la vista conjunta. */
export async function askProject() {
  const list = state.projects || [];
  if (!list.length) return null;
  const v = await formModal({ title: 'Proyecto de destino', submitLabel: 'Continuar', fields: [
    { name: 'project', label: 'Está viendo todos los proyectos. ¿En cuál desea crear este elemento?', type: 'select', required: true, span: 2, options: list.map((p) => [p.id, p.name]) }] });
  return v ? Number(v.project) : null;
}
