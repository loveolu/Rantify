/**
 * server.mjs — HTTP server routing webhooks + API + OAuth.
 *
 * Routes:
 *   POST /webhooks/box       — Box webhook (HMAC-verified)
 *   GET/POST /api/*          — Dashboard API (CORS-enabled)
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
 *            loginHandler:(req,res)=>void, callbackHandler:(req,res)=>Promise<void>},
 *          api?: (req:http.IncomingMessage, res:http.ServerResponse) => Promise<void>}} deps
 * @returns {import('node:http').Server}
 */
export function createWebhookServer({ config, onEvent, githubOAuth, api }) {
  return http.createServer((req, res) => {
    const url = req.url;

    if (url === '/healthz') { res.writeHead(200).end('ok'); return; }

    if (url.startsWith('/api/')) {
      return void Promise.resolve(api(req, res)).catch((err) => {
        console.error('[api] error:', err);
        if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: err.message })); }
      });
    }

    if (url === '/webhooks/box') {
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
      if (githubOAuth.matchesLogin(url)) return githubOAuth.loginHandler(req, res);
      if (githubOAuth.matchesCallback(url)) return void githubOAuth.callbackHandler(req, res);
    }

    res.writeHead(404).end('not found');
  });
}
