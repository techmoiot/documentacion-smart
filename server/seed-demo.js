// Datos de demostración (opcional): `document seed-demo`
// Sirve para conocer el sistema; los códigos empiezan con DEMO- para identificarlos y borrarlos.
import { get, run, tx } from './db.js';
import { createPortGroups } from './routes/crud.js';
import { audit } from './audit.js';

const PROJECT_TABLES = new Set(['nodes', 'racks', 'devices', 'antennas', 'radiolinks', 'connections', 'poles', 'fiber_elements']);
let demoProject = null;
const ins = (table, obj) => {
  if (PROJECT_TABLES.has(table)) obj = { ...obj, project_id: demoProject };
  const cols = Object.keys(obj);
  return Number(run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => obj[c])).lastInsertRowid);
};

export function seedDemo() {
  if (get('SELECT COUNT(*) AS n FROM nodes').n > 0) {
    console.log('La base ya contiene nodos: no se cargan datos de demostración.');
    return;
  }
  tx(() => {
    demoProject = Number(run("INSERT INTO projects (name, description, color, created_by) VALUES ('Demostración', 'Datos de ejemplo (DEMO-*)', '#a78bfa', 'sistema')").lastInsertRowid);
    const n1 = ins('nodes', { code: 'DEMO-N001', name: 'Nodo Central', type: 'principal', lat: 14.6349, lng: -90.5069, address: 'Ciudad de Guatemala (demo)', description: 'Nodo principal de demostración', status: 'operativo', installed_at: '2024-03-01', responsible: 'Ing. de red' });
    const n2 = ins('nodes', { code: 'DEMO-T001', name: 'Torre Cerro Alto', type: 'torre', lat: 14.5612, lng: -90.4421, address: 'Cerro Alto (demo)', description: 'Torre de 45 m con enlaces de backhaul', status: 'operativo', installed_at: '2024-05-12', responsible: 'Técnico de campo' });
    const n3 = ins('nodes', { code: 'DEMO-N002', name: 'Nodo Distribución Norte', type: 'distribucion', lat: 14.7011, lng: -90.4803, address: 'Zona norte (demo)', description: 'Distribución FTTH y sector inalámbrico', status: 'degradado', installed_at: '2024-08-20', responsible: 'Técnico de campo' });

    const rack = ins('racks', { node_id: n1, name: 'Rack A', units: 42 });

    const mk = (o, groups) => {
      const id = ins('devices', { status: 'operativo', node_id: n1, rack_id: rack, ...o });
      createPortGroups(id, groups);
      return id;
    };
    const ups = mk({ name: 'UPS Principal', type: 'ups', brand: 'APC', model: 'Smart-UPS 3000', rack_u: 1, u_height: 2, ip: '10.10.0.250' }, [{ kind: 'power', prefix: 'OUT', count: 4 }]);
    const srv = mk({ name: 'Servidor Monitoreo', type: 'server', brand: 'Dell', model: 'PowerEdge R250', rack_u: 4, u_height: 1, ip: '10.10.0.20', serial: 'DEMO-SRV-001' }, [{ kind: 'rj45', prefix: 'eth', count: 2, speed: '1G' }, { kind: 'mgmt', prefix: 'iDRAC', count: 1, start: 1 }]);
    const pp = mk({ name: 'Patch Panel 24', type: 'patch_panel', brand: 'Genérico', model: 'Cat6 24p', rack_u: 30, u_height: 1 }, [{ kind: 'rj45', prefix: 'PP', count: 24, speed: '1G' }]);
    const sw = mk({ name: 'SW-Distribucion-01', type: 'switch', brand: 'MikroTik', model: 'CRS326-24G-2S+RM', rack_u: 32, u_height: 1, ip: '10.10.0.2', mac: 'AA:BB:CC:00:00:02', firmware: 'RouterOS 7.14', serial: 'DEMO-SW-001', installed_at: '2024-03-02' }, [{ kind: 'rj45', prefix: 'ether', count: 24, speed: '1G' }, { kind: 'sfp+', prefix: 'SFP+', count: 2, speed: '10G' }]);
    const olt = mk({ name: 'OLT-ZTE-C320', type: 'olt', brand: 'ZTE', model: 'ZXA10 C320', rack_u: 34, u_height: 2, ip: '10.10.0.10', mac: 'AA:BB:CC:00:00:10', firmware: 'V2.1', serial: 'DEMO-OLT-001', installed_at: '2024-03-10' }, [{ kind: 'sfp+', prefix: 'XGE', count: 2, speed: '10G' }, { kind: 'pon', prefix: 'PON', count: 16, speed: 'GPON' }, { kind: 'mgmt', prefix: 'MGMT', count: 1, start: 1 }]);
    const odf = mk({ name: 'ODF-01', type: 'odf', brand: 'Genérico', model: 'ODF 24 fibras SC/APC', rack_u: 37, u_height: 1 }, [{ kind: 'fiber', prefix: 'F', count: 24 }]);
    const rtr = mk({ name: 'CCR2004-Core', type: 'router', brand: 'MikroTik', model: 'CCR2004-1G-12S+2XS', rack_u: 39, u_height: 1, ip: '10.10.0.1', mac: 'AA:BB:CC:00:00:01', firmware: 'RouterOS 7.14', serial: 'DEMO-RTR-001', installed_at: '2024-03-01' }, [{ kind: 'rj45', prefix: 'ether', count: 1, speed: '1G' }, { kind: 'sfp+', prefix: 'SFP+', count: 12, speed: '10G' }, { kind: 'sfp28', prefix: 'SFP28-', count: 2, speed: '25G' }, { kind: 'console', prefix: 'console', count: 1, start: 1 }]);
    mk({ name: 'Organizador 1U', type: 'organizer', rack_u: 41, u_height: 1 }, []);

    const port = (dev, name) => get('SELECT id FROM ports WHERE device_id = ? AND name = ?', dev, name).id;
    const phys = (a, ap, b, bp, extra = {}) => ins('connections', { layer: 'physical', a_device_id: a, a_port_id: port(a, ap), b_device_id: b, b_port_id: port(b, bp), medium: 'Fibra OM3 LC-LC', status: 'operativo', ...extra });
    phys(rtr, 'SFP+1', sw, 'SFP+1', { conn_type: 'troncal 10G', speed: '10G', cable_id: 'C-001' });
    phys(rtr, 'SFP+3', olt, 'XGE1', { conn_type: 'uplink OLT', speed: '10G', cable_id: 'C-002' });
    phys(rtr, 'ether1', sw, 'ether24', { conn_type: 'gestión', medium: 'UTP Cat6', speed: '1G', cable_id: 'C-003' });
    phys(sw, 'ether1', srv, 'eth1', { conn_type: 'servidor', medium: 'UTP Cat6', speed: '1G', cable_id: 'C-004' });
    phys(sw, 'ether2', pp, 'PP1', { conn_type: 'patch', medium: 'UTP Cat6', speed: '1G', cable_id: 'C-005' });
    phys(olt, 'PON1', odf, 'F1', { conn_type: 'PON', medium: 'Fibra SC/APC', speed: 'GPON', cable_id: 'F-001' });
    phys(olt, 'PON2', odf, 'F2', { conn_type: 'PON', medium: 'Fibra SC/APC', speed: 'GPON', cable_id: 'F-002', status: 'pendiente' });
    ins('connections', { layer: 'logical', a_device_id: rtr, a_port_id: port(rtr, 'SFP+1'), b_device_id: sw, b_port_id: port(sw, 'SFP+1'), conn_type: 'troncal', vlan: '100,200,300', network: '', status: 'operativo', notes: 'Troncal 802.1Q: gestión, clientes, voz' });
    ins('connections', { layer: 'logical', a_device_id: rtr, b_device_id: olt, conn_type: 'red_ip', vlan: '', network: '10.10.0.0/24', status: 'operativo', notes: 'Red de gestión' });

    // Radioenlaces
    const radioT = ins('devices', { node_id: n2, name: 'Radio Torre PTP', type: 'radio', brand: 'Ubiquiti', model: 'airFiber 5XHD', ip: '10.20.0.2', status: 'operativo' });
    const aA = ins('antennas', { node_id: n1, name: 'Antena A (Nodo Principal)', brand: 'Ubiquiti', model: 'airFiber 5XHD', ip: '10.20.0.1', height_m: 20, azimuth: 120, freq_mhz: 5800, channel_width: '40 MHz', tx_power_dbm: 25, gain_dbi: 34, polarization: 'Dual', capacity: '1 Gbps', role: 'PTP', status: 'operativo' });
    const aB = ins('antennas', { node_id: n2, device_id: radioT, name: 'Antena B (Torre)', brand: 'Ubiquiti', model: 'airFiber 5XHD', ip: '10.20.0.2', height_m: 42, azimuth: 300, freq_mhz: 5800, channel_width: '40 MHz', tx_power_dbm: 25, gain_dbi: 34, polarization: 'Dual', capacity: '1 Gbps', role: 'PTP', status: 'operativo' });
    const aS = ins('antennas', { node_id: n2, name: 'Sector Norte 120°', brand: 'Cambium', model: 'ePMP 3000', ip: '10.20.0.10', height_m: 40, azimuth: 10, freq_mhz: 5500, channel_width: '20 MHz', tx_power_dbm: 22, gain_dbi: 17, polarization: 'Dual', capacity: '300 Mbps', role: 'AP', status: 'operativo' });
    const aC = ins('antennas', { node_id: n3, name: 'CPE Nodo Norte', brand: 'Cambium', model: 'ePMP Force 300', ip: '10.20.0.11', height_m: 12, azimuth: 190, freq_mhz: 5500, channel_width: '20 MHz', tx_power_dbm: 20, gain_dbi: 25, polarization: 'Dual', capacity: '300 Mbps', role: 'CPE', status: 'operativo' });
    ins('radiolinks', { name: 'Central ⇄ Torre (backhaul)', link_type: 'PTP', a_antenna_id: aA, b_antenna_id: aB, freq_mhz: 5800, rssi_dbm: -52, capacity: '900 Mbps', availability: '99.95%', installed_at: '2024-05-15', status: 'operativo', notes: 'Línea de vista despejada, 12.8 km' });
    ins('radiolinks', { name: 'Torre → Norte (sector)', link_type: 'PTMP', a_antenna_id: aS, b_antenna_id: aC, freq_mhz: 5500, rssi_dbm: -71, capacity: '120 Mbps', availability: '99.2%', installed_at: '2024-08-25', status: 'degradado', notes: 'RSSI bajo por follaje' });

    // Fibra FTTH
    const f = (o) => ins('fiber_elements', { status: 'operativo', props: '{}', ...o });
    const fOlt = f({ kind: 'olt', name: 'OLT-ZTE-C320', device_id: olt, node_id: n1, props: JSON.stringify({ tarjeta: 'GTGH (slot 1)' }) });
    const fPon = f({ kind: 'pon', name: 'PON 1/1/1', parent_id: fOlt, node_id: n1, device_id: olt, port_id: port(olt, 'PON1'), props: JSON.stringify({ potencia_tx_dbm: 3.5 }) });
    const fOdf = f({ kind: 'odf', name: 'ODF-01 · F1', parent_id: fPon, node_id: n1, device_id: odf, port_id: port(odf, 'F1') });
    const fCab = f({ kind: 'cable', name: 'Troncal Central → Norte', code: 'CT-01', parent_id: fOdf, props: JSON.stringify({ tipo_cable: 'ADSS monomodo G.652D', fibras_total: 24, fibras_usadas: 6, hilos_asignados: '1-6', atenuacion_db: 4.2, distancia_m: 9800, capacidad: '24F' }) });
    const fSpl = f({ kind: 'splitter', name: 'Splitter 1:8 Norte', code: 'SP-N1', parent_id: fCab, node_id: n3, lat: 14.7011, lng: -90.4803, props: JSON.stringify({ relacion: '1:8', perdida_db: 10.5 }) });
    const fNap1 = f({ kind: 'nap', name: 'NAP-N1-01', code: 'NAP-N101', parent_id: fSpl, lat: 14.7055, lng: -90.4851, props: JSON.stringify({ puertos: 8, puertos_usados: 3, distancia_m: 650, atenuacion_db: 0.8 }) });
    const fNap2 = f({ kind: 'nap', name: 'NAP-N1-02', code: 'NAP-N102', parent_id: fSpl, lat: 14.7102, lng: -90.4760, props: JSON.stringify({ puertos: 8, puertos_usados: 2, distancia_m: 900, atenuacion_db: 1.1 }) });
    [['Cliente · Familia Pérez', fNap1, 14.7058, -90.4855], ['Cliente · Tienda La Esquina', fNap1, 14.7053, -90.4849], ['Cliente · Escuela Rural', fNap1, 14.7060, -90.4859], ['Cliente · Carlos Ruiz', fNap2, 14.7104, -90.4757], ['Cliente · Ana Morales', fNap2, 14.7099, -90.4763]]
      .forEach(([name, parent, lat, lng], i) => f({ kind: 'client', name, parent_id: parent, lat, lng, code: `DEMO-C${i + 1}`, props: JSON.stringify({ onu_serial: `ZTEG${1000 + i}`, plan: '100 Mbps', potencia_rx_dbm: -21.5 - i * 0.4 }) }));

    // Planta externa: postes y cables trazados sobre ellos (splitter → NAP)
    const route = (name, parent, from, to, n, fibers) => {
      const path = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, jitter = i === 0 || i === n ? 0 : Math.sin(i * 1.7) * 0.00012;
        const lat = from[0] + (to[0] - from[0]) * t + jitter, lng = from[1] + (to[1] - from[1]) * t - jitter;
        let pid = null;
        if (i > 0 && i < n) pid = ins('poles', { code: `DEMO-P${String(++poleSeq).padStart(3, '0')}`, lat, lng, material: i % 3 ? 'concreto' : 'madera', height_m: 9, owner: 'Empresa eléctrica (demo)', status: 'operativo' });
        path.push([lat, lng, pid]);
      }
      let m = 0;
      for (let i = 1; i < path.length; i++) m += Math.hypot((path[i][0] - path[i - 1][0]) * 111320, (path[i][1] - path[i - 1][1]) * 107000);
      f({ kind: 'cable', name, parent_id: parent, path: JSON.stringify(path), props: JSON.stringify({ tipo_cable: 'ADSS 12F', fibras_total: fibers, fibras_usadas: 2, longitud_m: Math.round(m), hilos: { 1: { e: 'usada', a: 'Splitter Norte' }, 2: { e: 'usada', a: 'NAP' }, 7: { e: 'reservada', a: '', n: 'Reserva' } } }) });
    };
    let poleSeq = 0;
    route('Alimentador NAP-N1-01', fSpl, [14.7011, -90.4803], [14.7055, -90.4851], 7, 12);
    route('Alimentador NAP-N1-02', fSpl, [14.7011, -90.4803], [14.7102, -90.4760], 9, 12);

    audit(null, 'crear', 'nodes', n1, 'Carga de datos de demostración');
  });
  console.log('Datos de demostración cargados (códigos DEMO-*).');
}
