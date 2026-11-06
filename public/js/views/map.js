// Mapa geográfico de infraestructura (Leaflet)
import { api } from '../api.js';
import { STATUS, NODE_TYPE, cableColor } from '../catalog.js';
import { h, btn, icon, clear, go, state, haversineKm, fmtKm, badge } from '../ui.js';
import { showImpact } from '../shared.js';
import { showLinkModal } from './radio.js';

const L = window.L;
const sc = (st) => STATUS[st]?.color || '#94a3b8';

export async function mapView(root, query = {}) {
  clear(root);
  const data = await api.get('/api/map');
  const dark = localStorage.getItem('sd_map_dark') !== '0';

  const ctl = h('div', { class: 'map-ctl' });
  const mapEl = h('div', { id: 'map' });
  const wrap = h('div', { class: `map-wrap ${dark ? 'map-dark' : ''}` }, mapEl, ctl);
  root.append(h('div', { class: 'page fill' }, wrap));

  const map = L.map(mapEl, { zoomControl: true, preferCanvas: false }).setView([14.6349, -90.5069], 11);
  L.tileLayer(state.meta.tileUrl, { maxZoom: 19, attribution: state.meta.tileAttribution, referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);

  const layers = { nodes: L.layerGroup().addTo(map), links: L.layerGroup().addTo(map), fiber: L.layerGroup().addTo(map), naps: L.layerGroup().addTo(map), poles: L.layerGroup(), clients: L.layerGroup(), nodeLinks: L.layerGroup().addTo(map), measure: L.layerGroup().addTo(map) };
  const typeVisible = Object.fromEntries(Object.keys(NODE_TYPE).map((k) => [k, true]));
  const markers = new Map();

  // ---------- Medición de distancias ----------
  let measuring = false, pts = [];
  const measureBox = h('div', { class: 'measure-box hidden' });
  wrap.append(measureBox);
  const addPoint = (ll, label) => {
    pts.push({ ll, label });
    layers.measure.clearLayers();
    pts.forEach((p) => L.circleMarker(p.ll, { radius: 5, color: '#38bdf8', fillColor: '#0a1322', fillOpacity: 1 }).addTo(layers.measure));
    if (pts.length > 1) L.polyline(pts.map((p) => p.ll), { color: '#38bdf8', weight: 3, dashArray: '2 6' }).addTo(layers.measure);
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += haversineKm(pts[i - 1].ll.lat, pts[i - 1].ll.lng, pts[i].ll.lat, pts[i].ll.lng);
    clear(measureBox);
    measureBox.classList.remove('hidden');
    measureBox.append(h('div', { class: 'row gap' }, h('strong', null, pts.length > 1 ? `Distancia: ${fmtKm(total)}` : 'Seleccione el siguiente punto'),
      h('span', { class: 'muted small' }, pts.map((p) => p.label).filter(Boolean).join(' → ')), btn('Limpiar', { onClick: stopMeasure })));
  };
  function stopMeasure() { pts = []; layers.measure.clearLayers(); measureBox.classList.add('hidden'); }
  map.on('click', (e) => { if (measuring) addPoint(e.latlng, ''); });

  // ---------- Nodos ----------
  const nodeIcon = (n) => {
    const nt = NODE_TYPE[n.type] || NODE_TYPE.otro;
    const el = h('div', { class: 'nmark', style: { '--st': sc(n.status), '--ty': nt.color } }, h('span', null, nt.glyph));
    return L.divIcon({ html: el, className: '', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -16] });
  };
  const popupFor = (n) => {
    const nt = NODE_TYPE[n.type] || NODE_TYPE.otro;
    return h('div', null, h('h4', null, n.name),
      h('div', { class: 'row gap' }, h('span', { class: 'chip', style: { '--c': nt.color } }, nt.label), badge(n.status)),
      h('div', { class: 'muted small', style: { margin: '6px 0' } }, `${n.code} · ${n.device_count} equipos · ${n.antenna_count} antenas`),
      n.address ? h('div', { class: 'small' }, n.address) : null,
      h('div', { class: 'row gap wrap', style: { marginTop: '10px' } },
        btn('Abrir nodo', { kind: 'primary', onClick: () => go(`#/nodo/${n.id}`) }), btn('Equipos', { onClick: () => go(`#/nodo/${n.id}/equipos`) }), btn('Impacto', { ic: 'alert', onClick: () => showImpact('node', n.id) })));
  };
  const placed = data.nodes.filter((n) => n.lat != null && n.lng != null);
  for (const n of placed) {
    const m = L.marker([n.lat, n.lng], { icon: nodeIcon(n), title: n.name, riseOnHover: true }).bindPopup(popupFor(n), { minWidth: 240 });
    m.on('click', () => { if (measuring) { m.closePopup(); addPoint(L.latLng(n.lat, n.lng), n.name); } });
    m.addTo(layers.nodes);
    markers.set(n.id, { m, n });
  }

  // ---------- Radioenlaces ----------
  const arrowIcon = (color, deg) => L.divIcon({ html: h('div', { class: 'amark', style: { '--c': color, transform: `rotate(${deg}deg)` } }), className: '', iconSize: [12, 12], iconAnchor: [6, 6] });
  for (const r of data.radiolinks) {
    if (r.a_lat == null || r.b_lat == null) continue;
    const col = sc(r.status);
    const dist = haversineKm(r.a_lat, r.a_lng, r.b_lat, r.b_lng);
    const line = L.polyline([[r.a_lat, r.a_lng], [r.b_lat, r.b_lng]], {
      color: col, weight: r.link_type === 'PTMP' ? 2.5 : 4, opacity: 0.9, dashArray: r.status === 'pendiente' ? '2 8' : '10 8', className: r.status === 'operativo' || r.status === 'degradado' ? 'rl-flow' : '',
    }).bindTooltip(`${r.name} · ${r.link_type} · ${fmtKm(dist)}`, { sticky: true });
    line.on('click', () => { if (measuring) return; showLinkModal(r.id, { onChanged: () => go(location.hash) }); });
    line.addTo(layers.links);
    const f = 0.6, lat = r.a_lat + (r.b_lat - r.a_lat) * f, lng = r.a_lng + (r.b_lng - r.a_lng) * f;
    const dx = (r.b_lng - r.a_lng) * Math.cos(((r.a_lat + r.b_lat) / 2) * Math.PI / 180), dy = r.b_lat - r.a_lat;
    L.marker([lat, lng], { icon: arrowIcon(col, (Math.atan2(dx, dy) * 180) / Math.PI), interactive: false, keyboard: false }).addTo(layers.links);
  }

  // ---------- Fibra ----------
  const byId = new Map(data.fiber.map((f) => [f.id, f]));
  const coordOf = (f) => (f.lat != null && f.lng != null ? [f.lat, f.lng] : null);
  const nearestWithCoord = (f) => { let c = byId.get(f.parent_id); while (c && !coordOf(c)) c = byId.get(c.parent_id); return c; };
  for (const f of data.fiber) {
    if (f.kind === 'cable' && f.path && f.path.length > 1) {
      const fib = Number(f.props?.fibras_total) || 0;
      L.polyline(f.path.map((q) => [q[0], q[1]]), { color: f.status === 'operativo' ? cableColor(fib) : sc(f.status), weight: 3.5, opacity: 0.9 })
        .bindTooltip(`${f.name}${fib ? ` · ${fib} hilos` : ''}`, { sticky: true }).on('click', () => { if (!measuring) go(`#/planta?sel=${f.id}`); }).addTo(layers.fiber);
      continue;
    }
    const p = coordOf(f);
    if (!p) continue;
    const up = nearestWithCoord(f);
    if (up && coordOf(up) && (coordOf(up)[0] !== p[0] || coordOf(up)[1] !== p[1]) && f.kind !== 'client') {
      L.polyline([coordOf(up), p], { color: f.status === 'operativo' ? '#38bdf8' : sc(f.status), weight: f.kind === 'cable' ? 4 : 2.5, opacity: 0.85 }).bindTooltip(`Fibra → ${f.name}`, { sticky: true }).addTo(layers.fiber);
    } else if (up && f.kind === 'client') {
      L.polyline([coordOf(up), p], { color: '#e2e8f0', weight: 1, opacity: 0.5 }).addTo(layers.clients);
    }
    const mk = (r, col, grp) => L.circleMarker(p, { radius: r, color: '#0a1322', weight: 1.5, fillColor: col, fillOpacity: 1 }).bindTooltip(f.name).on('click', () => { if (!measuring) go(`#/fibra?sel=${f.id}`); }).addTo(grp);
    if (f.kind === 'nap') mk(6, '#22c55e', layers.naps);
    else if (f.kind === 'splitter' || f.kind === 'closure') mk(5, '#ec4899', layers.naps);
    else if (f.kind === 'client') mk(3.5, '#e2e8f0', layers.clients);
  }

  for (const p of data.poles || []) {
    L.circleMarker([p.lat, p.lng], { radius: 3.5, color: '#0a1322', weight: 1, fillColor: '#e2e8f0', fillOpacity: 1 }).bindTooltip(`Poste ${p.code}`)
      .on('click', () => { if (!measuring) go(`#/planta?pole=${p.id}`); }).addTo(layers.poles);
  }

  // ---------- Enlaces físicos entre nodos ----------
  for (const nl of data.nodeLinks) {
    const a = markers.get(nl.a_node_id)?.n, b = markers.get(nl.b_node_id)?.n;
    if (!a || !b) continue;
    L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: sc(nl.status), weight: 3, opacity: 0.8 })
      .bindTooltip(`${nl.a_device_name} ⇄ ${nl.b_device_name}${nl.medium ? ' · ' + nl.medium : ''}`, { sticky: true }).addTo(layers.nodeLinks);
  }

  // ---------- Panel de capas y filtros ----------
  const chk = (label, checked, onChange, color) => {
    const i = h('input', { type: 'checkbox', checked, onchange: () => onChange(i.checked) });
    return h('label', null, i, color ? h('span', { class: 'dotc', style: { background: color } }) : null, label);
  };
  const toggleLayer = (g) => (on) => { if (on) g.addTo(map); else map.removeLayer(g); };
  const refreshNodes = () => {
    for (const { m, n } of markers.values()) {
      if (typeVisible[n.type]) layers.nodes.addLayer(m); else layers.nodes.removeLayer(m);
    }
  };
  const measureBtn = btn('Medir distancia', { ic: 'ruler', onClick: () => {
    measuring = !measuring; measureBtn.classList.toggle('on', measuring);
    map.getContainer().style.cursor = measuring ? 'crosshair' : '';
    if (!measuring) stopMeasure(); else addHint();
  } });
  const addHint = () => { measureBox.classList.remove('hidden'); clear(measureBox); measureBox.append(h('span', null, 'Haga clic en el mapa o sobre nodos para medir distancias.')); };
  ctl.append(
    h('div', { class: 'row gap', style: { justifyContent: 'space-between' } }, h('strong', null, 'Infraestructura'), h('span', { class: 'muted small' }, `${placed.length} nodos`)),
    h('h5', null, 'Capas'),
    chk('Nodos y sitios', true, toggleLayer(layers.nodes)), chk('Radioenlaces', true, toggleLayer(layers.links), '#a78bfa'), chk('Recorridos de fibra', true, toggleLayer(layers.fiber), '#38bdf8'),
    chk('NAP y splitters', true, toggleLayer(layers.naps), '#22c55e'), chk('Postes', false, toggleLayer(layers.poles), '#e2e8f0'), chk('Clientes FTTH', false, toggleLayer(layers.clients), '#e2e8f0'), chk('Enlaces entre nodos', true, toggleLayer(layers.nodeLinks), '#94a3b8'),
    h('h5', null, 'Tipo de nodo'),
    ...Object.entries(NODE_TYPE).map(([k, o]) => chk(o.label, true, (on) => { typeVisible[k] = on; refreshNodes(); }, o.color)),
    h('h5', null, 'Estado de enlaces'), ...Object.values(STATUS).map((o) => h('div', { class: 'small', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span', { class: 'dotc', style: { background: o.color } }), o.label)),
    h('h5', null, 'Herramientas'),
    h('div', { class: 'row gap wrap' }, measureBtn,
      btn('Ajustar', { ic: 'fit', onClick: fit }),
      btn(dark ? 'Mapa claro' : 'Mapa oscuro', { onClick: () => { localStorage.setItem('sd_map_dark', dark ? '0' : '1'); go(location.hash); } })));

  function fit() {
    const all = [...placed.map((n) => [n.lat, n.lng])];
    if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.25), { maxZoom: 15 });
  }
  fit();
  setTimeout(() => map.invalidateSize(), 60);

  if (query.node && markers.has(Number(query.node))) {
    const { m, n } = markers.get(Number(query.node));
    map.setView([n.lat, n.lng], 15); m.openPopup();
  } else if (query.fiber) {
    const f = byId.get(Number(query.fiber));
    if (f && coordOf(f)) map.setView(coordOf(f), 16);
  }
}
