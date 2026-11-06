// Mapas base seleccionables (calles, satélite, híbrido, relieve…) con recuerdo de la última elección
import { state } from './ui.js';

const L = window.L;
const RP = 'strict-origin-when-cross-origin';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const tl = (url, o) => L.tileLayer(url, { maxZoom: 20, referrerPolicy: RP, ...o });

export function addBaseMaps(map, { maxNative = 19 } = {}) {
  const m = state.meta;
  const sat = () => tl(m.satUrl, { maxNativeZoom: maxNative, attribution: m.satAttribution });
  const bases = {
    'Calles': tl(m.tileUrl, { maxNativeZoom: 19, attribution: m.tileAttribution }),
    'Satélite': sat(),
    'Híbrido (satélite + calles)': L.layerGroup([sat(), tl(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 19 }),
      tl(`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 19 })]),
    'Relieve (curvas de nivel)': tl('https://tile.opentopomap.org/{z}/{x}/{y}.png', { maxNativeZoom: 17, attribution: '© OpenTopoMap (CC-BY-SA) · © OpenStreetMap' }),
    'Topográfico (Esri)': tl(`${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 19, attribution: 'Esri, HERE, Garmin, USGS' }),
    'Oscuro': tl(m.tileUrl, { maxNativeZoom: 19, attribution: m.tileAttribution, className: 'tiles-dark' }),
  };
  let saved = 'Calles';
  try { saved = localStorage.getItem('sd_basemap') || saved; } catch { /* sin almacenamiento */ }
  (bases[saved] || bases.Calles).addTo(map);
  L.control.layers(bases, null, { position: 'topright', collapsed: true }).addTo(map);
  map.on('baselayerchange', (e) => { try { localStorage.setItem('sd_basemap', e.name); } catch { /* ignorar */ } });
}
