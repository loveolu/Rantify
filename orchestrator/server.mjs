/**
 * server.mjs — HTTP server routing webhooks + OAuth (SPEC.md §7.2, §8.2).
 *
 * Routes:
 *   POST /webhooks/box       — Box webhook (HMAC-verified)
 *   GET  /auth/github/login  — GitHub OAuth initiation
 *   GET  /auth/github/callback — GitHub OAuth callback
 *   GET  /healthz            — Health check
 */

import http from 'node:http';
import { verifyBoxSignature } from './hmac.mjs';

/**
 * @param {{config: {boxWebhookPrimaryKey:string, boxWebhookSecondaryKey:string},
 *          onEvent: (fileId: string) => void|Promise<void>,
 *          githubOAuth?: {matchesLogin:(url:string)=>boolean, matchesCallback:(url:string)=>boolean,
 *            loginHandler:(req,res)=>void, callbackHandler:(req,res)=>Promise<void>}}} deps
 * @returns {import('node:http').Server}
 */
export function createWebhookServer({ config, onEvent, githubOAuth }) {
  return http.createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }

    if (req.url === '/webhooks/box') {
      if (req.method !== 'POST') { res.writeHead(405).end('method not allowed'); return; }

      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const ok = verifyBoxSignature(
          rawBody, req.headers, config.boxWebhookPrimaryKey, config.boxWebhookSecondaryKey,
        );
        if (!ok) { res.writeHead(401).end('invalid signature'); return; }

        let fileId;
        try { fileId = JSON.parse(rawBody)?.source?.id; } catch { res.writeHead(400).end('bad json'); return; }
        if (!fileId) { res.writeHead(400).end('missing source.id'); return; }

        res.writeHead(200).end('ok');
        Promise.resolve(onEvent(fileId)).catch((err) => console.error('[webhook] handler error:', err));
      });
      return;
    }

    if (githubOAuth) {
      if (githubOAuth.matchesLogin(req.url)) return githubOAuth.loginHandler(req, res);
      if (githubOAuth.matchesCallback(req.url)) return void githubOAuth.callbackHandler(req, res);
    }

    res.writeHead(404).end('not found');
  });
}
