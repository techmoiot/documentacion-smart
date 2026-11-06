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
    run('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)', u, u, hashPassword('ClavePrueba123'), r);
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
