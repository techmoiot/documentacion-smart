// Lectura de KMZ/KML sin dependencias: ZIP mínimo (zlib) + tokenizador XML tolerante
import zlib from 'node:zlib';

const MAX_UNZIPPED = 200 * 1024 * 1024;

/** Devuelve el texto KML a partir de un KMZ (ZIP) o un KML plano. */
export function readKmlText(buf) {
  if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) return unzipKml(buf);
  return buf.toString('utf8');
}

function unzipKml(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('El archivo KMZ está dañado (no es un ZIP válido)');
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || off === 0xffffffff) throw new Error('KMZ en formato ZIP64 no soportado; expórtelo de nuevo o conviértalo a KML');
  const entries = [];
  for (let i = 0; i < total && off + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32), lho = buf.readUInt32LE(off + 42);
    entries.push({ name: buf.toString('utf8', off + 46, off + 46 + nlen), method, csize, lho });
    off += 46 + nlen + elen + clen;
  }
  const kmls = entries.filter((e) => /\.kml$/i.test(e.name) && !e.name.endsWith('/'));
  const pick = kmls.find((e) => /(^|\/)doc\.kml$/i.test(e.name)) || kmls[0];
  if (!pick) throw new Error('El KMZ no contiene ningún archivo .kml');
  if (buf.readUInt32LE(pick.lho) !== 0x04034b50) throw new Error('El archivo KMZ está dañado');
  const start = pick.lho + 30 + buf.readUInt16LE(pick.lho + 26) + buf.readUInt16LE(pick.lho + 28);
  const data = buf.subarray(start, start + pick.csize);
  if (pick.method === 0) return data.toString('utf8');
  if (pick.method !== 8) throw new Error('Método de compresión del KMZ no soportado');
  try { return zlib.inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED }).toString('utf8'); } catch { throw new Error('No se pudo descomprimir el KMZ (dañado o demasiado grande)'); }
}

const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const stripHtml = (s) => decode(s.replace(/<br\s*\/?>/gi, ' · ').replace(/<\/(tr|p|div)>/gi, ' · ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').replace(/( · )+/g, ' · ').trim();

function parseCoords(text) {
  const out = [];
  for (const tok of text.trim().split(/\s+/)) {
    if (!tok) continue;
    const [lng, lat] = tok.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) out.push([lat, lng]);
  }
  return out;
}

/** Devuelve { features: [{folder, name, description, geom, coords, data}], docName } */
export function parseKml(xml, { maxFeatures = 300000 } = {}) {
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  const stack = [];           // { tag, text, attrs, name }
  const folders = [];         // nombres de carpeta abiertos
  const folderTags = [];      // índices en stack
  let pm = null, geomType = null, geoms = [], docName = '', cur = null;
  const features = [];
  const local = (t) => t.replace(/^.*:/, '');
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) { if (stack.length) stack[stack.length - 1].text += m[1]; continue; }
    if (m[6] !== undefined) { if (stack.length) stack[stack.length - 1].text += decode(m[6]); continue; }
    if (m[3] === undefined) continue;
    const tag = local(m[3]), closing = m[2] === '/', selfClose = m[5] === '/';
    if (!closing) {
      const attrs = {};
      for (const a of (m[4] || '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[local(a[1])] = decode(a[2] ?? a[3] ?? '');
      if (tag === 'Folder' || tag === 'Document') { folders.push({ name: null, doc: tag === 'Document' }); folderTags.push(stack.length); }
      if (tag === 'Placemark') { pm = { name: '', description: '', data: {} }; geoms = []; }
      if (tag === 'Point' || tag === 'LineString' || tag === 'LinearRing') geomType = tag;
      if (tag === 'Polygon') geomType = 'Polygon';
      if (!selfClose) stack.push({ tag, text: '', attrs });
      if (stack.length > 200) throw new Error('KML demasiado anidado');
      if (!selfClose) continue;
    }
    // cierre (o auto-cierre)
    const node = selfClose && !closing ? { tag, text: '', attrs: {} } : stack.pop();
    if (!node) continue;
    const parent = stack[stack.length - 1]?.tag;
    const text = node.text.trim();
    if (node.tag === 'name') {
      if (parent === 'Placemark' && pm) pm.name = text;
      else if ((parent === 'Folder' || parent === 'Document') && folders.length && folders[folders.length - 1].name === null) {
        folders[folders.length - 1].name = text;
        if (parent === 'Document' && !docName) docName = text;
      }
    } else if (node.tag === 'description' && parent === 'Placemark' && pm) pm.description = stripHtml(text).slice(0, 600);
    else if (node.tag === 'value' && parent === 'Data' && pm) { const k = stack[stack.length - 1].attrs.name; if (k) pm.data[k] = text.slice(0, 200); }
    else if (node.tag === 'SimpleData' && pm) { if (node.attrs.name) pm.data[node.attrs.name] = text.slice(0, 200); }
    else if (node.tag === 'coordinates' && pm) {
      const coords = parseCoords(text);
      const inPolygon = stack.some((s) => s.tag === 'Polygon');
      const kind = inPolygon ? 'Polygon' : stack.some((s) => s.tag === 'Point') ? 'Point' : 'LineString';
      if (coords.length) geoms.push({ geom: kind, coords });
    } else if (node.tag === 'Placemark' && pm) {
      const folder = folders.filter((f) => !f.doc).map((f) => f.name).filter(Boolean).join(' / ');
      for (const g of geoms) {
        if (features.length >= maxFeatures) throw new Error(`El archivo tiene más de ${maxFeatures} elementos`);
        features.push({ folder, name: pm.name, description: pm.description, geom: g.geom, coords: g.geom === 'Point' ? [g.coords[0]] : g.coords, data: pm.data });
      }
      pm = null; geoms = [];
    } else if (node.tag === 'Folder' || node.tag === 'Document') { folders.pop(); folderTags.pop(); }
    cur = null;
  }
  void geomType; void cur;
  return { features, docName };
}
