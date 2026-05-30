/**
 * poller.mjs — the demo trigger path (SPEC.md §14 Phase 2/3).
 *
 * Every interval, list cards in the two actionable statuses and hand each to onCard
 * (the lifecycle core). An in-flight Set<cardId> prevents re-dispatching a card whose
 * previous run hasn't settled yet — without it, a Phase 1 taking longer than the poll
 * interval would be started again before its status flips to `building`.
 */

const TRIGGER_STATUSES = ['ready-for-build', 'building-approved'];

function safeError(err) {
  if (!err) return '';
  if (err?.constructor?.name === 'BoxApiError') {
    const own = Object.getOwnPropertyNames(err);
    const info = {};
    for (const k of own) try { info[k] = err[k]; } catch {}
    return `BoxApiError: ${err.message || '(no message)'}\n${JSON.stringify(info, null, 2)}`;
  }
  return err.stack || String(err);
}

/**
 * @param {{box: {listCardsByStatus: (s:string)=>Promise<{fileId:string,cardId:string}[]>},
 *          onCard: (fileId:string, cardId:string)=>void|Promise<void>}} deps
 */
export function createPoller({ box, onCard }) {
  const inFlight = new Set();

  async function tick() {
    for (const status of TRIGGER_STATUSES) {
      const cards = await box.listCardsByStatus(status);
      for (const { fileId, cardId } of cards) {
        if (inFlight.has(cardId)) continue;
        inFlight.add(cardId);
        Promise.resolve()
          .then(() => onCard(fileId, cardId))
          .catch((err) => console.error('[poller] onCard error:', safeError(err)))
          .finally(() => inFlight.delete(cardId));
      }
    }
  }

  function start(intervalMs = 30_000) {
    const timer = setInterval(() => {
      tick().catch((e) => console.error('[poller] tick error:', safeError(e)));
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { tick, start };
}
