// Utilidades HTTP compartidas
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (msg) => new HttpError(400, msg);
export const notFound = (what = 'Recurso') => new HttpError(404, `${what} no encontrado`);
export const conflict = (msg) => new HttpError(409, msg);

/** Envuelve un handler para capturar errores síncronos y pasarlos a Express. */
export const wrap = (fn) => (req, res, next) => {
  try { fn(req, res, next); } catch (e) { next(e); }
};

export const ph = (arr) => arr.map(() => '?').join(',');

export function intParam(v, name = 'id') {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw bad(`Parámetro "${name}" inválido`);
  return n;
}
