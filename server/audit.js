import { run, get } from './db.js';

const TABLE = { nodes: 'nodes', racks: 'racks', devices: 'devices', connections: 'connections', fiber: 'fiber_elements', antennas: 'antennas', radiolinks: 'radiolinks', poles: 'poles' };

/** Registra un cambio en el historial (con el proyecto de la entidad, si lo tiene). */
export function audit(user, action, entityType, entityId, summary, before = null, after = null, projectId = undefined) {
  let pid = projectId;
  if (pid === undefined) {
    pid = (after || before)?.project_id ?? null;
    if (pid == null && entityId != null && TABLE[entityType]) pid = get(`SELECT project_id FROM ${TABLE[entityType]} WHERE id = ?`, entityId)?.project_id ?? null;
  }
  run(
    `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, summary, before, after, project_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    user?.id ?? null, user?.username ?? 'sistema', action, entityType, entityId ?? null,
    String(summary || '').slice(0, 300),
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    pid ?? null
  );
}
