/**
 * server.mjs — POST /webhooks/box (SPEC.md §8.2).
 *
 * Reads the RAW body (HMAC must run on the exact bytes Box sent, not re-serialized JSON),
 * verifies the signature (401 on mismatch), extracts source.id (the Box file id), and
 * hands it to onEvent. It never trusts the payload's status — that re-fetch happens in the
 * lifecycle core. Responds 200 the moment the event is accepted; the work runs async.
 */

import http from 'node:http';
import { verifyBoxSignature } from './hmac.mjs';

/**
 * @param {{config: {boxWebhookPrimaryKey:string, boxWebhookSecondaryKey:string},
 *          onEvent: (fileId: string) => void|Promise<void>}} deps
 * @returns {import('node:http').Server}
 */
export function createWebhookServer({ config, onEvent }) {
  return http.createServer((req, res) => {
    if (req.url !== '/webhooks/box') {
      res.writeHead(404).end('not found');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end('method not allowed');
      return;
    }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const ok = verifyBoxSignature(
        rawBody, req.headers, config.boxWebhookPrimaryKey, config.boxWebhookSecondaryKey,
      );
      if (!ok) {
        res.writeHead(401).end('invalid signature');
        return;
      }

      let fileId;
      try {
        fileId = JSON.parse(rawBody)?.source?.id;
      } catch {
        res.writeHead(400).end('bad json');
        return;
      }
      if (!fileId) {
        res.writeHead(400).end('missing source.id');
        return;
      }

      res.writeHead(200).end('ok');
      // Fire-and-forget: Box only needs the 200; failures are recorded on the card.
      Promise.resolve(onEvent(fileId)).catch((err) =>
        console.error('[webhook] handler error:', err));
    });
  });
}
