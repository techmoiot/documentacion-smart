import { run } from './db.js';

/** Registra un cambio en el historial. */
export function audit(user, action, entityType, entityId, summary, before = null, after = null) {
  run(
    `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, summary, before, after)
     VALUES (?,?,?,?,?,?,?,?)`,
    user?.id ?? null, user?.username ?? 'sistema', action, entityType, entityId ?? null,
    String(summary || '').slice(0, 300),
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null
  );
}
