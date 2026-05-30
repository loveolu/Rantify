const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(body || res.statusText);
  return body ? JSON.parse(body) : null;
}
