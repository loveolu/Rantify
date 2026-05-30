const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';
const inflight = new Map();

function key(path, opts) {
  const body = opts.body || '';
  return `${opts.method || 'GET'}:${path}:${body}`;
}

export async function api(path, opts = {}) {
  const k = key(path, opts);
  const existing = inflight.get(k);
  if (existing) return existing;

  const promise = (async () => {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    });
    const body = await res.text();
    if (!res.ok) throw new Error(body || res.statusText);
    return body ? JSON.parse(body) : null;
  })();

  inflight.set(k, promise);
  try { return await promise; } finally { inflight.delete(k); }
}

/** Move a card to a new status. Calls PUT /api/cards/:fileId with { status }. */
export async function moveCard(fileId, status) {
  return api(`/api/cards/${fileId}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}
