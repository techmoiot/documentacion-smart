// Editor de hilos de un cable: colores TIA-598, estado y asignación de cada hilo
import { api } from './api.js';
import { STRAND_STATE, strandColor, tubeOf, FIBER_COLORS } from './catalog.js';
import { h, can, formModal, guard, toast, btn, icon } from './ui.js';

/** el: elemento de fibra tipo "cable" (con props). onSaved(nuevoElemento) tras guardar. */
export function strandsEditor(el, onSaved) {
  const total = Number(el.props?.fibras_total) || 0;
  const root = h('div', { class: 'strands' });
  if (!total) {
    root.append(h('p', { class: 'muted small' }, 'Indique el número de fibras del cable (Editar → «Número de fibras») para documentar cada hilo.'));
    return root;
  }
  const data = { ...(el.props.hilos || {}) };
  const stateOf = (n) => data[n]?.e || 'libre';
  const counts = () => Object.fromEntries(Object.keys(STRAND_STATE).map((k) => [k, 0]));

  async function save() {
    const used = Object.values(data).filter((x) => x.e === 'usada').length;
    const props = { ...el.props, hilos: data, fibras_usadas: used };
    const updated = await guard(() => api.patch(`/api/fiber/${el.id}`, { props }));
    if (updated) { el.props = updated.props; onSaved?.(updated); }
  }

  async function edit(nums) {
    if (!can('update')) return;
    const first = data[nums[0]] || {};
    const v = await formModal({
      title: nums.length === 1 ? `Hilo ${nums[0]} · ${strandColor(nums[0])[0]} (tubo ${tubeOf(nums[0])})` : `Hilos ${nums[0]}–${nums[nums.length - 1]}`,
      values: { e: first.e || 'libre', a: first.a || '', n: first.n || '' },
      fields: [
        { name: 'e', label: 'Estado', type: 'select', options: Object.entries(STRAND_STATE) },
        { name: 'a', label: 'Asignado a (PON, splitter, cliente, enlace…)', maxlength: 120 },
        { name: 'n', label: 'Notas', maxlength: 200 },
      ],
    });
    if (!v) return;
    for (const n of nums) {
      if (v.e === 'libre' && !v.a && !v.n) delete data[n]; else data[n] = { e: v.e, a: v.a, n: v.n };
    }
    await save();
    render();
  }

  const grid = h('div', { class: 'strand-grid' });
  const summary = h('div', { class: 'muted small' });
  function render() {
    grid.replaceChildren();
    const c = counts();
    for (let n = 1; n <= total; n++) {
      const [cname, col] = strandColor(n);
      const st = stateOf(n);
      c[st]++;
      const d = data[n];
      const tip = `Hilo ${n} · ${cname} · tubo ${tubeOf(n)} (${strandColor(tubeOf(n))[0]})${d?.a ? ' → ' + d.a : ''} · ${STRAND_STATE[st]}`;
      grid.append(h('button', { type: 'button', class: `strand ${st}`, style: { '--col': col }, title: tip, 'aria-label': tip, onclick: () => edit([n]) }, h('span', null, String(n))));
    }
    summary.textContent = `${total} hilos · ${c.usada} usados · ${c.reservada} reservados · ${c.danada} dañados · ${c.libre} libres`;
  }
  render();
  const tools = h('div', { class: 'row gap wrap' });
  if (can('update')) {
    tools.append(btn('Asignar rango…', { ic: 'edit', onClick: async () => {
      const v = await formModal({ title: 'Asignar rango de hilos', fields: [
        { name: 'from', label: 'Desde el hilo', type: 'number', min: 1, max: total, required: true, default: 1 },
        { name: 'to', label: 'Hasta el hilo', type: 'number', min: 1, max: total, required: true, default: Math.min(total, 6) }] });
      if (!v) return;
      const a = Math.max(1, Math.min(total, Number(v.from))), b = Math.max(a, Math.min(total, Number(v.to)));
      edit(Array.from({ length: b - a + 1 }, (_, i) => a + i));
    } }));
  }
  root.append(summary, grid, tools, h('details', { class: 'muted small' }, h('summary', null, 'Código de colores (TIA-598)'),
    h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '6px' } }, FIBER_COLORS.map(([n, c], i) => h('span', { class: 'chip', style: { '--c': c } }, `${i + 1} ${n}`)))));
  return root;
}
