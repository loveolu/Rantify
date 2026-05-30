/**
 * webhook-plan.mjs — idempotency decision for webhook registration (SPEC.md §7.2). Pure.
 * A webhook is "equivalent" if it targets the same item, posts to the same address, and
 * covers the same trigger set (order-independent).
 */

const sameTriggers = (a = [], b = []) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** @returns {boolean} true if no equivalent webhook exists and one should be created. */
export function needsWebhook(existing, { target, address, triggers }) {
  return !existing.some((w) =>
    w.target?.id === target.id &&
    w.address === address &&
    sameTriggers(w.triggers, triggers));
}

/**
 * Box only accepts public HTTPS webhook targets — localhost/private/http addresses are
 * rejected with 400. Returns false for those so local-dev setup can skip registration
 * (the orchestrator's poller covers change detection instead). Pure.
 * @returns {boolean}
 */
export function isPublicWebhookAddress(address) {
  let u;
  try { u = new URL(address); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)) return false;
  if (host.endsWith('.local')) return false;
  return true;
}
