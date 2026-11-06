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
  const opts = { method, headers: { 'X-Requested-With': 'SmartDoc', 'X-Project': projectCtx.id }, credentials: 'same-origin', ...extra };
  if (extra.target) opts.headers['X-Project-Target'] = String(extra.target);
  delete opts.target; delete opts.retried;
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

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  patch: (url, body) => request('PATCH', url, body ?? {}),
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
