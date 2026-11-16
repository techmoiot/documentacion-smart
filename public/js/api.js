// Cliente de la API
export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

// Proyecto activo ('all' o id) y gancho para pedir el proyecto al crear en la vista conjunta
export const projectCtx = {
  get id() { try { return localStorage.getItem('sd_project') || 'all'; } catch { return 'all'; } },
  set id(v) { try { localStorage.setItem('sd_project', String(v)); } catch { /* sin almacenamiento */ } },
  ask: null,
};

async function request(method, url, body, extra = {}) {
  const opts = { method, headers: { 'X-Requested-With': 'SmartDoc', 'X-Project': extra.project ?? projectCtx.id }, credentials: 'same-origin', ...extra };
  if (extra.target) opts.headers['X-Project-Target'] = String(extra.target);
  delete opts.target; delete opts.retried; delete opts.project;
  if (body !== undefined && !extra.raw) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (extra.raw) { opts.body = extra.raw; opts.headers['Content-Type'] = 'application/octet-stream'; delete opts.raw; }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) {
    if (res.status === 400 && data?.code === 'project_required' && projectCtx.ask && !extra.retried) {
      const target = await projectCtx.ask();
      if (target) return request(method, url, body, { ...extra, target, retried: true });
    }
    if (res.status === 401 && !url.includes('/auth/')) window.dispatchEvent(new CustomEvent('sd:unauthorized'));
    throw new ApiError(res.status, data?.error || `Error ${res.status}`, data?.code);
  }
  return data;
}

// `extra.project`: sustituye el proyecto activo en esa llamada ('all' o ids separados por coma).
// `extra.target`: proyecto donde crear el elemento nuevo.
export const api = {
  get: (url, extra) => request('GET', url, undefined, extra),
  post: (url, body, extra) => request('POST', url, body ?? {}, extra),
  patch: (url, body, extra) => request('PATCH', url, body ?? {}, extra),
  put: (url, body) => request('PUT', url, body ?? {}),
  del: (url) => request('DELETE', url),
  upload: (url, file) => request('POST', url, undefined, { raw: file }),
};

export const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
