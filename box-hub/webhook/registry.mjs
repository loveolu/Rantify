/**
 * registry.mjs — in-process handler registry backing RealBoxClient.onWebhook().
 * The webhook server dispatches verified events here; the orchestrator subscribes via the
 * contract's onWebhook (returns an unsubscribe, exactly like the mock).
 */

export function createRegistry() {
  const handlers = new Set();
  return {
    register(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async dispatch(event) {
      for (const handler of handlers) {
        try {
          await handler(event);
        } catch (err) {
          // Box retries on non-2xx and Person C's guards handle at-least-once; never let one
          // handler's failure block the others or the 200 response.
          console.error('[box-hub] webhook handler error:', err);
        }
      }
    },
  };
}
