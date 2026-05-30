/**
 * in-flight.mjs — in-process de-duplication for the trigger boundary (SPEC.md §8.5).
 *
 * Box delivers webhooks at-least-once and the poller can race the webhook for the same
 * card. Both paths share ONE guarded onCard so a card already being processed is not
 * dispatched again concurrently — without this, two near-simultaneous deliveries both pass
 * the non-atomic read-then-write status guard and double-scaffold (double Claude billing).
 *
 * Scope/limit: this is single-process only. True cross-process at-least-once still needs a
 * conditional metadata update on the Box side (Person B). This closes the common case where
 * one orchestrator receives the duplicate.
 */

/**
 * @template {(key: string, ...rest: any[]) => any} F
 * @param {F} fn
 * @returns {(key: string, ...rest: any[]) => Promise<void>}
 */
export function guardConcurrent(fn) {
  const inFlight = new Set();
  return async function guarded(key, ...rest) {
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      await fn(key, ...rest);
    } finally {
      inFlight.delete(key);
    }
  };
}
