/**
 * server.mjs — the real POST /webhooks/box (SPEC.md §7.2, §8.2, §10.2).
 *
 * Reads the RAW body (HMAC must run on the exact bytes Box sent), verifies the dual-key
 * signature (401 on mismatch), normalizes to the §10.2 WebhookEvent shape, and dispatches
 * to the registry. Returns 200 quickly; handlers run without blocking the response (Box
 * only needs the 200, and Person C owns idempotency).
 */

import http from 'node:http';
import { verifyBoxSignature } from '../lib/hmac.mjs';

function normalize(parsed) {
  return {
    trigger: parsed.trigger,
    source: parsed.source,
    additional_info: parsed.additional_info ?? parsed.additionalInfo,
  };
}

export function createWebhookServer({ config, registry, now = () => new Date() }) {
  return http.createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
    if (req.url !== '/webhooks/box') { res.writeHead(404).end('not found'); return; }
    if (req.method !== 'POST') { res.writeHead(405).end('method not allowed'); return; }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const ok = verifyBoxSignature({
        rawBody, headers: req.headers,
        primaryKey: config.boxWebhookPrimaryKey, secondaryKey: config.boxWebhookSecondaryKey,
        now: now(),
      });
      if (!ok) { res.writeHead(401).end('invalid signature'); return; }

      let event;
      try { event = normalize(JSON.parse(rawBody)); }
      catch { res.writeHead(400).end('bad json'); return; }

      res.writeHead(200).end('ok');
      Promise.resolve(registry.dispatch(event)).catch((err) => console.error('[box-hub] dispatch error:', err));
    });
  });
}
