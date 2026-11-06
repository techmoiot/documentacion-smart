// Proyectos: alcance de datos por usuario y por selección activa
import { AsyncLocalStorage } from 'node:async_hooks';
import { all, get } from './db.js';
import { HttpError, notFound } from './http.js';

const als = new AsyncLocalStorage();

/** Proyectos a los que el usuario tiene acceso (admin: todos). */
export function accessibleProjects(user) {
  if (!user) return [];
  const rows = user.role === 'admin'
    ? all('SELECT id FROM projects ORDER BY id')
    : all('SELECT project_id AS id FROM project_members WHERE user_id = ? ORDER BY project_id', user.id);
  return rows.map((r) => r.id);
}

/** Middleware: calcula req.scope a partir de la cabecera X-Project ("all" o ids separados por coma). */
export function scopeMiddleware(req, _res, next) {
  const accessible = accessibleProjects(req.user);
  const hdr = String(req.get('x-project') || 'all').trim();
  let selected = accessible;
  if (hdr && hdr !== 'all') {
    const want = hdr.split(',').map(Number).filter((n) => Number.isInteger(n) && accessible.includes(n));
    if (want.length) selected = want;
  }
  const target = Number(req.get('x-project-target'));
  req.scope = {
    accessible, selected,
    active: selected.length === 1 && accessible.length > 0 && hdr !== 'all' ? selected[0] : null,
    target: Number.isInteger(target) && accessible.includes(target) ? target : null,
  };
  als.run(req, next);
}

export const scope = () => als.getStore()?.scope || { accessible: [], selected: [], active: null, target: null };
export const isAdminCtx = () => als.getStore()?.user?.role === 'admin';

const inSql = (col, ids) => (ids.length ? { sql: `${col} IN (${ids.map(() => '?').join(',')})`, params: ids } : { sql: '0', params: [] });
/** Filtro SQL por los proyectos seleccionados (vista actual). */
export const selectedFilter = (col = 'project_id') => inSql(col, scope().selected);
/** Filtro SQL por todos los proyectos accesibles (detalles, historial de una entidad). */
export const accessibleFilter = (col = 'project_id') => inSql(col, scope().accessible);

export const visible = (projectId) => projectId != null && scope().accessible.includes(projectId);
export function assertVisible(row, what) {
  if (row && !visible(row.project_id)) throw notFound(what);
  return row;
}

/** Proyecto para un elemento nuevo: explícito → seleccionado → único accesible. */
export function pickProject(explicit) {
  const sc = scope();
  const e = Number(explicit);
  if (Number.isInteger(e) && e > 0) {
    if (!sc.accessible.includes(e)) throw new HttpError(403, 'No tiene acceso a ese proyecto');
    return e;
  }
  if (sc.target) return sc.target;
  if (sc.active) return sc.active;
  if (sc.accessible.length === 1) return sc.accessible[0];
  if (!sc.accessible.length) throw new HttpError(403, 'No tiene proyectos asignados; pida acceso a un administrador');
  throw new HttpError(400, 'Elija el proyecto en el que desea crear este elemento', 'project_required');
}

export const projectOf = (table, id) => (id == null ? null : get(`SELECT project_id FROM ${table} WHERE id = ?`, id)?.project_id ?? null);
