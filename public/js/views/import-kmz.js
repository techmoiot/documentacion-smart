// Asistente de importación KMZ/KML (migración desde OZmap u otras plataformas)
import { api } from '../api.js';
import { h, btn, modal, guard, toast, clear } from '../ui.js';

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
    const go_ = btn('Importar', { kind: 'primary', onClick: async () => {
      go_.disabled = true;
      const mapping = Object.fromEntries(Object.entries(selects).map(([k, s]) => [k, s.value]));
      const r = await guard(() => api.post('/api/import/kmz/commit', { token: prev.token, mapping }));
      if (!r) { go_.disabled = false; return; }
      clear(body);
      body.append(h('h4', null, 'Importación terminada'), h('ul', null,
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
      h('div', { class: 'row gap', style: { justifyContent: 'flex-end' } }, btn('Cancelar', { onClick: () => m.close() }), go_), result);
  }

  input.addEventListener('change', () => { if (input.files[0]) upload(input.files[0]); });
  body.append(h('p', null, 'Suba un archivo .kmz o .kml exportado de OZmap (o de Google Earth, QGIS, etc.). Verá una vista previa antes de importar.'), input, status);
}
