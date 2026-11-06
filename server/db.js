// Capa de base de datos (SQLite nativo de Node, sin dependencias nativas)
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_FILE = path.join(DATA_DIR, 'smartdoc.db');
export const db = new DatabaseSync(DB_FILE);

db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','engineer','technician','viewer')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'distribucion',
  lat REAL, lng REAL,
  location TEXT DEFAULT '',
  address TEXT DEFAULT '',
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'operativo',
  installed_at TEXT,
  responsible TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS racks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 42 CHECK (units BETWEEN 1 AND 60),
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
  rack_id INTEGER REFERENCES racks(id) ON DELETE SET NULL,
  rack_u INTEGER,
  u_height INTEGER NOT NULL DEFAULT 1 CHECK (u_height BETWEEN 1 AND 20),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  brand TEXT DEFAULT '',
  model TEXT DEFAULT '',
  serial TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  mac TEXT DEFAULT '',
  firmware TEXT DEFAULT '',
  location TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'operativo',
  installed_at TEXT,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_devices_node ON devices(node_id);
CREATE INDEX IF NOT EXISTS idx_devices_rack ON devices(rack_id);

CREATE TABLE IF NOT EXISTS ports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'rj45',
  idx INTEGER NOT NULL DEFAULT 0,
  speed TEXT DEFAULT '',
  label TEXT DEFAULT '',
  UNIQUE (device_id, name)
);
CREATE INDEX IF NOT EXISTS idx_ports_device ON ports(device_id);

CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  layer TEXT NOT NULL DEFAULT 'physical' CHECK (layer IN ('physical','logical')),
  a_device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  a_port_id INTEGER REFERENCES ports(id) ON DELETE SET NULL,
  b_device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  b_port_id INTEGER REFERENCES ports(id) ON DELETE SET NULL,
  conn_type TEXT DEFAULT '',
  medium TEXT DEFAULT '',
  cable_id TEXT DEFAULT '',
  speed TEXT DEFAULT '',
  vlan TEXT DEFAULT '',
  network TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'operativo',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conn_a ON connections(a_device_id);
CREATE INDEX IF NOT EXISTS idx_conn_b ON connections(b_device_id);
-- Un puerto físico solo admite un cable
CREATE UNIQUE INDEX IF NOT EXISTS uq_conn_phys_a ON connections(a_port_id) WHERE layer='physical' AND a_port_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_conn_phys_b ON connections(b_port_id) WHERE layer='physical' AND b_port_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fiber_elements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT DEFAULT '',
  parent_id INTEGER REFERENCES fiber_elements(id) ON DELETE CASCADE,
  node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  port_id INTEGER REFERENCES ports(id) ON DELETE SET NULL,
  lat REAL, lng REAL,
  status TEXT NOT NULL DEFAULT 'operativo',
  props TEXT NOT NULL DEFAULT '{}',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fiber_parent ON fiber_elements(parent_id);

CREATE TABLE IF NOT EXISTS poles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL DEFAULT '',
  name TEXT DEFAULT '',
  lat REAL NOT NULL, lng REAL NOT NULL,
  material TEXT NOT NULL DEFAULT 'concreto',
  height_m REAL,
  owner TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'operativo',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_poles_pos ON poles(lat, lng);

CREATE TABLE IF NOT EXISTS antennas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  brand TEXT DEFAULT '',
  model TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  lat REAL, lng REAL,
  height_m REAL,
  azimuth REAL,
  freq_mhz REAL,
  channel_width TEXT DEFAULT '',
  tx_power_dbm REAL,
  gain_dbi REAL,
  polarization TEXT DEFAULT '',
  capacity TEXT DEFAULT '',
  role TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'operativo',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_antennas_node ON antennas(node_id);

CREATE TABLE IF NOT EXISTS radiolinks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'PTP' CHECK (link_type IN ('PTP','PTMP')),
  a_antenna_id INTEGER NOT NULL REFERENCES antennas(id) ON DELETE CASCADE,
  b_antenna_id INTEGER NOT NULL REFERENCES antennas(id) ON DELETE CASCADE,
  freq_mhz REAL,
  rssi_dbm REAL,
  capacity TEXT DEFAULT '',
  availability TEXT DEFAULT '',
  installed_at TEXT,
  status TEXT NOT NULL DEFAULT 'operativo',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (a_antenna_id <> b_antenna_id)
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'photo',
  stored_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  caption TEXT DEFAULT '',
  uploaded_by TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_files_entity ON files(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER,
  username TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  summary TEXT DEFAULT '',
  before TEXT,
  after TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
`;
db.exec(SCHEMA);

// Migraciones incrementales: agregue nuevas sentencias SQL AL FINAL de la lista (nunca edite las anteriores).
// `document update` reinicia el servicio y las migraciones pendientes se aplican al arrancar.
const MIGRATIONS = [
  // 1: trazado geográfico de cables de fibra (planta externa): JSON [[lat,lng,poleId|null], ...]
  'ALTER TABLE fiber_elements ADD COLUMN path TEXT',
  // 2-3: datos de torre / estructura en los nodos
  'ALTER TABLE nodes ADD COLUMN height_m REAL',
  "ALTER TABLE nodes ADD COLUMN structure TEXT DEFAULT ''",
  // 4: lado del rack en que se monta el equipo (front | rear | both)
  "ALTER TABLE devices ADD COLUMN rack_side TEXT NOT NULL DEFAULT 'front'",
  // 5: plantillas de equipo personalizadas
  `CREATE TABLE IF NOT EXISTS device_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'other',
    brand TEXT DEFAULT '', model TEXT DEFAULT '', u INTEGER NOT NULL DEFAULT 1, groups TEXT NOT NULL DEFAULT '[]',
    created_by TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  // 6: proyectos (cada proyecto aísla sus datos y se comparte por usuario)
  `CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '', color TEXT DEFAULT '#38bdf8', created_by TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS project_members (project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (project_id, user_id));
  INSERT INTO projects (name, description, created_by) VALUES ('General', 'Proyecto inicial (datos existentes)', 'sistema');
  ALTER TABLE nodes ADD COLUMN project_id INTEGER REFERENCES projects(id);
  UPDATE nodes SET project_id = 1;
  CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
  ALTER TABLE racks ADD COLUMN project_id INTEGER REFERENCES projects(id);
  UPDATE racks SET project_id = 1;
  CREATE INDEX IF NOT EXISTS idx_racks_project ON racks(project_id);
  ALTER TABLE devices ADD COLUMN project_id INTEGER REFERENCES projects(id);
  UPDATE devices SET project_id = 1;
  CREATE INDEX IF NOT EXISTS idx_devices_project ON devices(project_id);
  ALTER TABLE antennas ADD COLUMN project_id INTEGER REFERENCES projects(id);
  UPDATE antennas SET project_id = 1;
  CREATE INDEX IF NOT EXISTS idx_antennas_project ON antennas(project_id);
  ALTER TABLE radiolinks ADD COLUMN project_id INTEGER REFERENCES projects(id);
  UPDATE radiolinks SET project_id = 1;
  CREATE INDEX IF NOT EXISTS idx_radiolinks_project ON radiolinks(project_id);
  ALTER TABLE connections ADD COLUMN project_id INTEGER REFERENCES projects(id);
  UPDATE connections SET project_id = 1;
  CREATE INDEX IF NOT EXISTS idx_connections_project ON connections(project_id);
  ALTER TABLE poles ADD COLUMN project_id INTEGER REFERENCES projects(id);
  UPDATE poles SET project_id = 1;
  CREATE INDEX IF NOT EXISTS idx_poles_project ON poles(project_id);
  ALTER TABLE fiber_elements ADD COLUMN project_id INTEGER REFERENCES projects(id);
  UPDATE fiber_elements SET project_id = 1;
  CREATE INDEX IF NOT EXISTS idx_fiber_elements_project ON fiber_elements(project_id);
  ALTER TABLE audit_log ADD COLUMN project_id INTEGER;
  UPDATE audit_log SET project_id = 1 WHERE entity_type IN ('nodes','racks','devices','connections','fiber','antennas','radiolinks','poles');
  INSERT INTO project_members (project_id, user_id) SELECT 1, id FROM users WHERE role <> 'admin';`,
];
{
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[i]); db.exec(`PRAGMA user_version = ${i + 1}`); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}

/** Ejecuta fn dentro de una transacción. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ya revertida */ }
    throw e;
  }
}

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
