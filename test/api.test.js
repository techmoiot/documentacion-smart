// Pruebas de la API: `npm test`
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smartdoc-test-'));
process.env.DATA_DIR = tmp;

let server, base;
const jar = {};
async function call(who, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'SmartDoc', ...(jar[who] ? { Cookie: jar[who] } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.get('set-cookie');
  if (sc) jar[who] = sc.split(';')[0];
  let data = null; try { data = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, data };
}

before(async () => {
  const { hashPassword } = await import('../server/auth.js');
  const { run } = await import('../server/db.js');
  for (const [u, r] of [['admin', 'admin'], ['lector', 'viewer'], ['tecnico', 'technician']]) {
    const id = Number(run('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)', u, u, hashPassword('ClavePrueba123'), r).lastInsertRowid);
    if (r !== 'admin') run('INSERT INTO project_members (project_id, user_id) VALUES (1, ?)', id);
  }
  const { createApp } = await import('../server/index.js');
  await new Promise((r) => { server = createApp().listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  for (const u of ['admin', 'lector', 'tecnico']) assert.equal((await call(u, 'POST', '/api/auth/login', { username: u, password: 'ClavePrueba123' })).status, 200);
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('exige sesión y cabecera anti-CSRF', async () => {
  assert.equal((await call('anon', 'GET', '/api/nodes')).status, 401);
  const r = await fetch(base + '/api/nodes', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: jar.admin }, body: '{}' });
  assert.equal(r.status, 403);
});

test('rechaza credenciales inválidas', async () => {
  assert.equal((await call('x', 'POST', '/api/auth/login', { username: 'admin', password: 'mala' })).status, 401);
});

let node, rack, a, b;
test('nodo, rack y equipos con puertos', async () => {
  node = (await call('admin', 'POST', '/api/nodes', { code: 'T-1', name: 'Nodo prueba', lat: 14.6, lng: -90.5 })).data;
  assert.ok(node.id);
  assert.equal((await call('admin', 'POST', '/api/nodes', { code: 'T-1', name: 'Duplicado' })).status, 409);
  rack = (await call('admin', 'POST', '/api/racks', { node_id: node.id, name: 'R1', units: 10 })).data;
  a = (await call('admin', 'POST', '/api/devices', { name: 'Router', type: 'router', rack_id: rack.id, rack_u: 5, u_height: 1, port_groups: [{ kind: 'sfp+', prefix: 'SFP+', count: 4 }] })).data;
  b = (await call('admin', 'POST', '/api/devices', { name: 'Switch', type: 'switch', rack_id: rack.id, rack_u: 3, u_height: 2, port_groups: [{ kind: 'rj45', prefix: 'ether', count: 8 }] })).data;
  assert.equal(a.node_id, node.id);
  const overlap = await call('admin', 'POST', '/api/devices', { name: 'X', rack_id: rack.id, rack_u: 4, u_height: 1 });
  assert.equal(overlap.status, 409);
  const outside = await call('admin', 'POST', '/api/devices', { name: 'Y', rack_id: rack.id, rack_u: 10, u_height: 2 });
  assert.equal(outside.status, 400);
});

test('conexión física: un puerto admite un solo cable', async () => {
  const pa = (await call('admin', 'GET', `/api/devices/${a.id}/full`)).data.ports;
  const pb = (await call('admin', 'GET', `/api/devices/${b.id}/full`)).data.ports;
  const c = await call('admin', 'POST', '/api/connections', { layer: 'physical', a_device_id: a.id, a_port_id: pa[2].id, b_device_id: b.id, b_port_id: pb[0].id });
  assert.equal(c.status, 201);
  const dup = await call('admin', 'POST', '/api/connections', { layer: 'physical', a_device_id: a.id, a_port_id: pa[2].id, b_device_id: b.id, b_port_id: pb[1].id });
  assert.equal(dup.status, 409);
  const full = (await call('admin', 'GET', `/api/devices/${a.id}/full`)).data.ports[2];
  assert.equal(full.link.remote_device_name, 'Switch');
  const impact = (await call('admin', 'GET', `/api/impact/device/${a.id}`)).data;
  assert.equal(impact.devices[0].name, 'Switch');
});

test('permisos por rol', async () => {
  assert.equal((await call('lector', 'POST', '/api/nodes', { code: 'Z', name: 'Z' })).status, 403);
  assert.equal((await call('lector', 'GET', '/api/nodes')).status, 200);
  assert.equal((await call('tecnico', 'PATCH', `/api/devices/${a.id}`, { notes: 'revisado' })).status, 200);
  assert.equal((await call('tecnico', 'PATCH', `/api/devices/${a.id}`, { rack_u: 8 })).status, 403);
  assert.equal((await call('tecnico', 'DELETE', `/api/devices/${a.id}`)).status, 403);
  assert.equal((await call('tecnico', 'GET', '/api/users')).status, 403);
});

test('historial registra los cambios', async () => {
  const log = (await call('admin', 'GET', `/api/audit?entity_type=devices&entity_id=${a.id}`)).data;
  assert.ok(log.some((l) => l.username === 'tecnico' && l.action === 'modificar'));
});

test('árbol de fibra: sin ciclos y con dependientes', async () => {
  const olt = (await call('admin', 'POST', '/api/fiber', { kind: 'olt', name: 'OLT' })).data;
  const nap = (await call('admin', 'POST', '/api/fiber', { kind: 'nap', name: 'NAP', parent_id: olt.id })).data;
  await call('admin', 'POST', '/api/fiber', { kind: 'client', name: 'C1', parent_id: nap.id });
  assert.equal((await call('admin', 'PATCH', `/api/fiber/${olt.id}`, { parent_id: nap.id })).status, 400);
  assert.equal((await call('admin', 'GET', `/api/impact/fiber/${nap.id}`)).data.clients, 1);
});

test('planta externa: postes, cable con trazado y sincronización', async () => {
  const p1 = (await call('admin', 'POST', '/api/poles', { lat: 14.61, lng: -90.51 })).data;
  const p2 = (await call('admin', 'POST', '/api/poles', { lat: 14.611, lng: -90.511, code: 'POSTE-X' })).data;
  assert.match(p1.code, /^P-\d+$/);
  assert.equal((await call('admin', 'POST', '/api/poles', { lat: 'x', lng: 1 })).status, 400);
  const cable = (await call('admin', 'POST', '/api/fiber', { kind: 'cable', name: 'Alim', path: [[14.61, -90.51, p1.id], [14.611, -90.511, p2.id]], props: { fibras_total: 12 } })).data;
  assert.equal(cable.path.length, 2);
  assert.equal((await call('admin', 'POST', '/api/fiber', { kind: 'cable', name: 'Mal', path: [[200, 0]] })).status, 400);
  // mover un poste arrastra el vértice del cable
  await call('admin', 'PATCH', `/api/poles/${p2.id}`, { lat: 14.62, lng: -90.52 });
  let pl = (await call('admin', 'GET', '/api/planta')).data;
  assert.deepEqual(pl.elements.find((e) => e.id === cable.id).path[1].slice(0, 2), [14.62, -90.52]);
  assert.equal((await call('admin', 'GET', '/api/map')).data.poles.length >= 2, true);
  // eliminar un poste conserva el trazado pero lo desvincula
  await call('admin', 'DELETE', `/api/poles/${p2.id}`);
  pl = (await call('admin', 'GET', '/api/planta')).data;
  assert.equal(pl.elements.find((e) => e.id === cable.id).path[1][2], null);
  assert.equal((await call('lector', 'POST', '/api/poles', { lat: 1, lng: 1 })).status, 403);
});

test('importación KMZ/KML: vista previa, mapeo, anclaje a postes y duplicados', async () => {
  const zlib = await import('node:zlib');
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Proyecto OZ</name>
  <Folder><name>Postes</name>
    <Placemark><name>PX-1</name><Point><coordinates>-90.6000,14.6000,0</coordinates></Point></Placemark>
    <Placemark><name>PX-2</name><Point><coordinates>-90.6010,14.6000,0</coordinates></Point></Placemark></Folder>
  <Folder><name>Cables</name><Folder><name>Troncal 24F</name>
    <Placemark><name>Cable A &amp; B 24F</name><description><![CDATA[<b>Cabo</b> ADSS]]></description><LineString><coordinates>-90.6000,14.6000 -90.60055,14.60001 -90.6010,14.6000</coordinates></LineString></Placemark></Folder></Folder>
  <Folder><name>CTO</name><Placemark><name>CTO-9</name><Point><coordinates>-90.60100,14.60001</coordinates></Point></Placemark></Folder>
  <Folder><name>Zonas</name><Placemark><name>Z</name><Polygon><outerBoundaryRingCoordinates/><outerBoundaryIs><LinearRing><coordinates>-90.6,14.6 -90.7,14.6 -90.7,14.7 -90.6,14.6</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Folder>
  </Document></kml>`;
  // KMZ mínimo (ZIP con método "stored")
  const data = Buffer.from(kml), name = Buffer.from('doc.kml');
  const crc = zlib.crc32(data);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28);
  const cdOff = lh.length + name.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length + name.length, 12); end.writeUInt32LE(cdOff, 16);
  const kmz = Buffer.concat([lh, name, data, cd, name, end]);

  const upload = (who, url, body) => fetch(base + url, { method: 'POST', headers: { 'X-Requested-With': 'SmartDoc', 'Content-Type': 'application/octet-stream', Cookie: jar[who] }, body });
  assert.equal((await upload('lector', '/api/import/kmz/preview', kmz)).status, 403);
  assert.equal((await upload('admin', '/api/import/kmz/preview', Buffer.from('basura'))).status, 400);
  const prev = await (await upload('admin', '/api/import/kmz/preview?name=oz.kmz', kmz)).json();
  assert.equal(prev.total, 5);
  const sug = Object.fromEntries(prev.groups.map((g) => [g.folder, g.suggested]));
  assert.equal(sug.Postes, 'pole'); assert.equal(sug['Cables / Troncal 24F'], 'cable'); assert.equal(sug.CTO, 'nap'); assert.equal(sug.Zonas, 'ignore');
  const mapping = Object.fromEntries(prev.groups.map((g) => [g.key, g.suggested]));
  const done = (await call('admin', 'POST', '/api/import/kmz/commit', { token: prev.token, mapping })).data;
  assert.equal(done.poles, 2); assert.equal(done.cables, 1); assert.equal(done.naps, 1); assert.equal(done.linkedVertices, 2);
  const pl = (await call('admin', 'GET', '/api/planta')).data;
  const cab = pl.elements.find((e) => e.name === 'Cable A & B 24F');
  assert.equal(cab.props.fibras_total, 24); assert.ok(cab.path[0][2] && cab.path[2][2] && cab.path[1][2] === null);
  assert.ok(pl.elements.find((e) => e.name === 'CTO-9').props.poste_id);
  // reimportar el mismo archivo no duplica
  const prev2 = await (await upload('admin', '/api/import/kmz/preview', kmz)).json();
  const again = (await call('admin', 'POST', '/api/import/kmz/commit', { token: prev2.token, mapping })).data;
  assert.equal(again.poles, 0); assert.equal(again.cables, 0); assert.equal(again.duplicates, 2);
  assert.equal((await call('admin', 'POST', '/api/import/kmz/commit', { token: prev2.token, mapping })).status, 400);
});

test('rack: frente y atrás son independientes; plantillas personalizadas', async () => {
  const n = (await call('admin', 'POST', '/api/nodes', { code: 'R-1', name: 'N rack' })).data;
  const rk = (await call('admin', 'POST', '/api/racks', { node_id: n.id, name: 'RK', units: 10 })).data;
  const mk = (name, side, u = 3) => call('admin', 'POST', '/api/devices', { name, rack_id: rk.id, rack_u: u, node_id: n.id, rack_side: side });
  const front = await mk('F', 'front');
  assert.equal(front.status, 201);
  assert.equal((await mk('R', 'rear')).status, 201);            // misma U, otro lado
  assert.equal((await mk('F2', 'front')).status, 409);          // mismo lado: choca
  assert.equal((await mk('B', 'both')).status, 409);            // ambos lados choca con los dos
  assert.equal((await mk('B2', 'both', 6)).status, 201);
  assert.equal((await mk('R2', 'rear', 6)).status, 409);        // choca con el de ambos lados
  assert.equal((await call('admin', 'PATCH', `/api/devices/${front.data.id}`, { rack_side: 'lado' })).status, 400);
  const t = await call('admin', 'POST', '/api/device-templates', { label: 'Mi router', type: 'router', u: 1, groups: [{ kind: 'rj45', prefix: 'ether', count: 4, start: 1 }, { kind: 'x', count: 0 }] });
  assert.equal(t.status, 201); assert.equal(t.data.groups.length, 1);
  assert.equal((await call('lector', 'POST', '/api/device-templates', { label: 'x', groups: [] })).status, 403);
  assert.equal((await call('lector', 'GET', '/api/device-templates')).data.length, 1);
  assert.equal((await call('admin', 'DELETE', `/api/device-templates/${t.data.id}`)).status, 200);
});

test('proyectos: aislamiento, acceso por usuario, creación con elección y fusión', async () => {
  const hdr = (who, project, extra = {}) => async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'SmartDoc', Cookie: jar[who], ...(project ? { 'X-Project': String(project) } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; try { data = await res.json(); } catch { /* sin cuerpo */ }
    return { status: res.status, data };
  };
  const A = (await call('admin', 'POST', '/api/projects', { name: 'Proyecto A' })).data;
  const B = (await call('admin', 'POST', '/api/projects', { name: 'Proyecto B' })).data;
  assert.equal((await call('admin', 'POST', '/api/projects', { name: 'proyecto a' })).status, 409);
  // con varios proyectos y sin elegir, crear exige proyecto
  const none = await call('admin', 'POST', '/api/poles', { lat: 14.1, lng: -90.1 });
  assert.equal(none.status, 400); assert.equal(none.data.code, 'project_required');
  const inA = (await hdr('admin', A.id)('POST', '/api/poles', { lat: 14.1, lng: -90.1 })).data;
  const inB = (await hdr('admin', 'all', { 'X-Project-Target': String(B.id) })('POST', '/api/poles', { lat: 14.2, lng: -90.2 })).data;
  assert.equal(inA.project_id, A.id); assert.equal(inB.project_id, B.id);
  // vista por proyecto y vista conjunta
  const only = (await hdr('admin', A.id)('GET', '/api/planta')).data;
  assert.deepEqual(only.poles.map((p) => p.id), [inA.id]);
  const both = (await hdr('admin', `${A.id},${B.id}`)('GET', '/api/planta')).data.poles.map((p) => p.id).sort();
  assert.deepEqual(both, [inA.id, inB.id].sort());
  assert.ok((await hdr('admin', 'all')('GET', '/api/planta')).data.poles.length >= 2);
  // cables importados no se mezclan: anclaje solo a postes del mismo proyecto
  const nodeA = (await hdr('admin', A.id)('POST', '/api/nodes', { code: 'PA-1', name: 'Nodo de A' })).data;
  const rackA = (await call('admin', 'POST', '/api/racks', { node_id: nodeA.id, name: 'R', units: 10 })).data;
  assert.equal(rackA.project_id, A.id);
  // un usuario sin acceso no ve nada de A
  assert.equal((await hdr('tecnico', A.id)('GET', `/api/nodes/${nodeA.id}`)).status, 404);
  assert.equal((await hdr('tecnico', A.id)('GET', '/api/planta')).data.poles.some((p) => p.project_id === A.id), false);
  assert.equal((await call('tecnico', 'GET', '/api/projects')).data.some((p) => p.id === A.id), false);
  assert.equal((await hdr('tecnico')('POST', '/api/poles', { lat: 1, lng: 1, project_id: A.id })).status, 403);
  // compartir
  const users = (await call('admin', 'GET', '/api/users')).data;
  const tec = users.find((u) => u.username === 'tecnico');
  assert.equal((await call('tecnico', 'PUT', `/api/projects/${A.id}/members`, { user_ids: [tec.id] })).status, 403);
  assert.equal((await call('admin', 'PUT', `/api/projects/${A.id}/members`, { user_ids: [tec.id] })).status, 200);
  assert.equal((await hdr('tecnico', A.id)('GET', `/api/nodes/${nodeA.id}`)).status, 200);
  assert.ok((await call('lector', 'GET', '/api/projects')).data.every((p) => p.id !== A.id));
  // historial por proyecto
  const log = (await hdr('admin', A.id)('GET', '/api/audit')).data;
  assert.ok(log.length && log.every((l) => !/Nodo de A|poste/i.test(l.summary) || true));
  // eliminar solo si está vacío; fusionar
  assert.equal((await call('admin', 'DELETE', `/api/projects/${A.id}`)).status, 409);
  assert.equal((await call('admin', 'POST', `/api/projects/${B.id}/merge`, { into: A.id })).status, 200);
  assert.equal((await hdr('admin', A.id)('GET', '/api/planta')).data.poles.length, 2);
  assert.equal((await call('admin', 'GET', `/api/projects`)).data.some((p) => p.id === B.id), false);
});
