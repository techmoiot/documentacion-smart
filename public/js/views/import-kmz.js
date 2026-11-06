// Asistente de importación KMZ/KML (migración desde OZmap u otras plataformas)
import { api } from '../api.js';
import { h, btn, modal, guard, toast, clear, state } from '../ui.js';
import { reloadProjects, selectProject } from './projects.js';

const POINT = [['pole', 'Poste'], ['nap', 'Caja NAP / CTO'], ['closure', 'Caja de empalme (CEO/CDO)'], ['splitter', 'Splitter'], ['client', 'Cliente'], ['ignore', '— Ignorar —']];
const LINE = [['cable', 'Cable de fibra'], ['ignore', '— Ignorar —']];
const GEOM = { Point: 'Puntos', LineString: 'Líneas', Polygon: 'Polígonos' };

export function importKmzWizard({ onDone } = {}) {
  const body = h('div');
  const m = modal({ title: 'Importar KMZ / KML', wide: true, body, actions: [] });
  const input = h('input', { type: 'file', accept: '.kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml' });
  const status = h('div', { class: 'muted small', style: { marginTop: '8px' } });

  async function upload(file) {
    status.textContent = `Leyendo ${file.name}…`;
    const prev = await guard(() => api.upload(`/api/import/kmz/preview?name=${encodeURIComponent(file.name)}`, file));
    if (!prev) { status.textContent = ''; return; }
    review(prev, file.name);
  }

  function review(prev, fname) {
    clear(body);
    const selects = {};
    const rows = prev.groups.map((g) => {
      const sel = h('select', null, (g.geom === 'Point' ? POINT : g.geom === 'LineString' ? LINE : [['ignore', '— Ignorar —']])
        .map(([v, l]) => h('option', { value: v, selected: v === g.suggested }, l)));
      if (g.geom === 'Polygon') sel.disabled = true;
      selects[g.key] = sel;
      return h('tr', null, h('td', null, g.folder), h('td', null, GEOM[g.geom] || g.geom), h('td', { class: 'num' }, String(g.count)),
        h('td', { class: 'muted small' }, g.samples.join(', ')), h('td', null, sel));
    });
    const result = h('div');
    // Proyecto de destino: nuevo (por defecto) o uno existente
    const projects = state.projects || [];
    const cur = projects.find((p) => String(p.id) === (localStorage.getItem('sd_project') || ''));
    const rNew = h('input', { type: 'radio', name: 'dest', checked: true }), rOld = h('input', { type: 'radio', name: 'dest', disabled: !projects.length });
    const nameIn = h('input', { type: 'text', maxlength: 80, placeholder: 'Nombre del nuevo proyecto' }); nameIn.value = prev.suggestedProject || fname.replace(/\.[^.]+$/, '');
    const oldSel = h('select', null, projects.map((p) => h('option', { value: p.id, selected: cur?.id === p.id }, p.name)));
    nameIn.addEventListener('focus', () => { rNew.checked = true; }); oldSel.addEventListener('focus', () => { rOld.checked = true; });
    const dest = h('div', { class: 'card-stack', style: { margin: '10px 0', padding: '10px 12px', border: '1px solid #26334f', borderRadius: '10px' } },
      h('strong', null, 'Proyecto de destino'),
      h('label', { class: 'row gap' }, rNew, h('span', null, 'Crear proyecto nuevo:'), nameIn),
      h('label', { class: 'row gap' }, rOld, h('span', null, 'Agregar a un proyecto existente:'), oldSel));
    const go_ = btn('Importar', { kind: 'primary', onClick: async () => {
      go_.disabled = true;
      const mapping = Object.fromEntries(Object.entries(selects).map(([k, s]) => [k, s.value]));
      const dst = rNew.checked ? { new_project: nameIn.value.trim() } : { project_id: Number(oldSel.value) };
      if (rNew.checked && !dst.new_project) { go_.disabled = false; toast('Escriba el nombre del proyecto', 'err'); return; }
      const r = await guard(() => api.post('/api/import/kmz/commit', { token: prev.token, mapping, ...dst }));
      if (!r) { go_.disabled = false; return; }
      await reloadProjects(); selectProject(String(r.project));
      clear(body);
      body.append(h('h4', null, 'Importación terminada'), h('ul', null,
        h('li', null, h('strong', null, `Proyecto «${(state.projects.find((p) => p.id === r.project) || {}).name || ''}» ahora activo`)),
        h('li', null, `${r.poles} postes nuevos${r.polesExisting ? ` (${r.polesExisting} ya existían)` : ''}`),
        h('li', null, `${r.cables} cables (${r.linkedVertices} vértices anclados a postes)`),
        h('li', null, `${r.naps} NAP/CTO, ${r.closures} cajas de empalme, ${r.splitters} splitters, ${r.clients} clientes`),
        h('li', null, `${r.duplicates} duplicados omitidos · ${r.skipped} elementos ignorados`)),
        h('p', { class: 'muted small' }, 'Los cables y cajas se importan sin jerarquía: desde Planta externa puede indicar de qué elemento nace cada uno (Editar datos).'),
        btn('Cerrar', { kind: 'primary', onClick: () => { m.close(); onDone?.(); } }));
      toast('Importación completada');
    } });
    body.append(
      h('p', null, `Archivo ${fname}${prev.name ? ` · proyecto «${prev.name}»` : ''}: ${prev.total} elementos. Indique qué es cada capa/carpeta:`),
      h('div', { class: 'table-wrap', style: { maxHeight: '48vh', overflow: 'auto' } },
        h('table', { class: 't' }, h('thead', null, h('tr', null, ['Carpeta / capa', 'Geometría', 'Cant.', 'Ejemplos', 'Importar como'].map((t) => h('th', null, t)))), h('tbody', null, rows))),
      h('p', { class: 'muted small' }, 'Los postes a menos de 1 m de uno existente se reutilizan; los vértices de cable a menos de 3 m de un poste se anclan a él; lo ya importado (mismo nombre y posición) se omite.'),
      dest,
      h('div', { class: 'row gap', style: { justifyContent: 'flex-end' } }, btn('Cancelar', { onClick: () => m.close() }), go_), result);
  }

  input.addEventListener('change', () => { if (input.files[0]) upload(input.files[0]); });
  body.append(h('p', null, 'Suba un archivo .kmz o .kml exportado de OZmap (o de Google Earth, QGIS, etc.). Verá una vista previa antes de importar.'), input, status);
}
