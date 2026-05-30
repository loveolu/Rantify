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
