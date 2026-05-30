/**
 * index.mjs — the one module A and C import. Re-exports RealBoxClient (drop-in for the
 * filesystem mock) and the webhook server so the live wiring is in one place.
 */
export { RealBoxClient } from './box-client-real.mjs';
export { createWebhookServer } from './webhook/server.mjs';
export { createRegistry } from './webhook/registry.mjs';
