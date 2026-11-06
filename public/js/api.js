// Cliente de la API
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function request(method, url, body, extra = {}) {
  const opts = { method, headers: { 'X-Requested-With': 'SmartDoc' }, credentials: 'same-origin', ...extra };
  if (body !== undefined && !extra.raw) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (extra.raw) { opts.body = extra.raw; opts.headers['Content-Type'] = 'application/octet-stream'; delete opts.raw; }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) {
    if (res.status === 401 && !url.includes('/auth/')) window.dispatchEvent(new CustomEvent('sd:unauthorized'));
    throw new ApiError(res.status, data?.error || `Error ${res.status}`);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  patch: (url, body) => request('PATCH', url, body ?? {}),
  del: (url) => request('DELETE', url),
  upload: (url, file) => request('POST', url, undefined, { raw: file }),
};

export const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
