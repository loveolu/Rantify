/**
 * phase-common.mjs — shared helpers for the two lifecycle phases (SPEC.md §8.3/§8.4, §11).
 * Extracted so retry and failure semantics live in one place rather than being duplicated.
 */

/** A failure inside a phase; caught by the phase to route the card to status=failed. */
export class PhaseError extends Error {}

/**
 * Safely stringify any error — Box SDK's BoxApiError has a class-field bug where
 * .requestInfo is undefined, crashing toString()/toJSON(). Use this instead of
 * raw `console.error(err)` or template-literating an error.
 */
export function safeError(err) {
  if (!err) return '';
  if (err?.constructor?.name === 'BoxApiError') {
    const own = Object.getOwnPropertyNames(err);
    const info = {};
    for (const k of own) { try { info[k] = err[k]; } catch {} }
    return `BoxApiError: ${err.message || '(no message)'}\n${JSON.stringify(info, null, 2)}`;
  }
  return err.stack || String(err);
}

/** Run fn; on the first throw, run it exactly once more (SPEC §11 "retry once"). */
export async function withRetry(fn) {
  try { return await fn(); } catch { return await fn(); }
}

/**
 * Record a phase failure: mark the card failed and write a log to /Logs/ (SPEC §11).
 * Best-effort — a logging error must not mask the original failure.
 */
export async function fail(box, fileId, cardId, phase, err, now = () => new Date()) {
  try {
    await box.setMetadata(fileId, { status: 'failed' });
    await box.uploadArtifact({ cardId, area: 'logs',
      name: `${cardId}-${phase}-fail-${now().toISOString().replace(/[:.]/g, '-')}.log`,
      content: `Phase ${phase} failed at ${now().toISOString()}\n\n${safeError(err)}` });
  } catch (logErr) {
    console.error('[phase] failed to record failure:', safeError(logErr));
  }
}
