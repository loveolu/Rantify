/**
 * github-oauth.mjs — GitHub OAuth login/callback HTTP handlers.
 *
 * GET /auth/github/login?email=user@example.com
 *   → redirects to GitHub authorization page with state=email
 *
 * GET /auth/github/callback?code=xxx&state=user@example.com
 *   → exchanges code for token, stores it keyed by email, redirects to success page
 */

import https from 'node:https';
import { URL, URLSearchParams } from 'node:url';

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

const SCOPES = 'repo';

/**
 * @param {{clientId:string, clientSecret:string, tokenStore:ReturnType<typeof import('./token-store.mjs').createTokenStore>, redirectUri?:string}} deps
 */
export function createGitHubOAuth({ clientId, clientSecret, tokenStore, redirectUri }) {
  const state = new Set();

  function loginHandler(req, res) {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const email = u.searchParams.get('email');
    if (!email) {
      res.writeHead(400).end('Missing ?email= parameter');
      return;
    }
    state.add(email);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPES,
      state: email,
    });
    res.writeHead(302, { Location: `${GITHUB_AUTHORIZE}?${params}` }).end();
  }

  async function callbackHandler(req, res) {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const code = u.searchParams.get('code');
    const email = u.searchParams.get('state');
    if (!code || !email || !state.has(email)) {
      res.writeHead(400).end('Invalid OAuth callback parameters');
      return;
    }
    state.delete(email);

    try {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }).toString();

      const tokenRes = await fetchToken(body);
      if (!tokenRes.access_token) {
        res.writeHead(400).end(`OAuth error: ${tokenRes.error_description ?? 'no access_token'}`);
        return;
      }

      const login = await fetchUserLogin(tokenRes.access_token);
      tokenStore.set(email, { token: tokenRes.access_token, login });
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!DOCTYPE html>
<html><body><h1>GitHub connected</h1>
<p>Account: <strong>${login}</strong></p>
<p>Email: <strong>${email}</strong></p>
<p>You can close this window and return to the DevTool app.</p>
</body></html>`);
    } catch (err) {
      res.writeHead(500).end(`OAuth failed: ${err.message}`);
    }
  }

  return {
    loginHandler,
    callbackHandler,
    matchesLogin(url) { return url === '/auth/github/login'; },
    matchesCallback(url) { return url === '/auth/github/callback'; },
  };
}

function fetchToken(body) {
  return new Promise((resolve, reject) => {
    const req = https.request(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`token response: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchUserLogin(token) {
  return new Promise((resolve, reject) => {
    const req = https.request('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'devtool-loop-orchestrator',
        Accept: 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).login); } catch { reject(new Error(`user response: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
