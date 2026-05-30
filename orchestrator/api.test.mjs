import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileSystemBoxClient } from '../contracts/box-client-mock.mjs';
import { createApi } from './api.mjs';
import { createTokenStore } from './auth/token-store.mjs';

let server, base, box;
before(async () => {
  box = new FileSystemBoxClient({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'api-test-')) });
  server = http.createServer(createApi({ box, tokenStore: null }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('POST /api/cards creates an inbox card whose spec id EQUALS card_id (SPEC §5.3)', async () => {
  const created = await (await post('/api/cards', { theme: 'testing-ci', pain_score: 0.7, description: 'flaky' })).json();
  const spec = await (await fetch(`${base}/api/cards/${created.fileId}/spec`)).json();
  const specId = spec.content.match(/^id:\s*"?([0-9a-f-]+)"?/m)?.[1];
  assert.equal(specId, created.cardId, 'front-matter id must equal metadata card_id');
});

test('GET /api/cards returns the created cards with metadata', async () => {
  await post('/api/cards', { theme: 'testing-ci', pain_score: 0.5 });
  const list = await (await fetch(`${base}/api/cards`)).json();
  assert.ok(Array.isArray(list) && list.length >= 1);
  assert.ok(list.every((c) => c.card_id && c.status === 'inbox'));
});

test('unknown route → 404 JSON', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
});

test('POST /api/mine → 503 when mining is not configured', async () => {
  const res = await post('/api/mine', { query: 'anything' });
  assert.equal(res.status, 503);
});

test('POST /api/mine starts a background job that completes and shows in GET /api/mine', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mine-api-'));
  const mineBox = new FileSystemBoxClient({ root });
  const mine = async ({ query, creator_email }) => {
    const cardId = randomUUID();
    return mineBox.uploadCard({
      cardId,
      specMarkdown: `---\nid: "${cardId}"\nstatus: "inbox"\ntheme: product-feedback\n---\n# ${query}\n`,
      metadata: { status: 'inbox', theme: 'product-feedback', card_id: cardId, creator_email: creator_email ?? null, pain_score: 0.5 },
    });
  };
  const srv = http.createServer(createApi({ box: mineBox, tokenStore: null, mine }));
  await new Promise((r) => srv.listen(0, r));
  const b = `http://127.0.0.1:${srv.address().port}`;

  const started = await (await fetch(`${b}/api/mine`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'Notion AI', creator_email: 'me@x.com' }) })).json();
  assert.ok(started.jobId);
  assert.equal(started.status, 'mining');

  // Poll until the background job finishes.
  let job;
  for (let i = 0; i < 50 && (!job || job.status === 'mining'); i++) {
    const { jobs } = await (await fetch(`${b}/api/mine`)).json();
    job = jobs.find((j) => j.jobId === started.jobId);
    if (!job || job.status === 'mining') await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(job.status, 'done');
  assert.ok(job.fileId, 'completed job carries the card fileId');
  srv.close();
});

test('POST /api/mine → 400 when query is missing', async () => {
  const srv = http.createServer(createApi({ box, tokenStore: null, mine: async () => ({ fileId: 'x', cardId: 'y' }) }));
  await new Promise((r) => srv.listen(0, r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const res = await fetch(`${b}/api/mine`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
  assert.equal(res.status, 400);
  srv.close();
});

test('POST /api/auth/target updates a connected user and surfaces in /api/auth/status', async () => {
  const tokenStore = createTokenStore({ filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tok-')), 't.json') });
  tokenStore.set('dev@x.com', { token: 'ghp', login: 'dev' });
  const srv = http.createServer(createApi({ box, tokenStore }));
  await new Promise((r) => srv.listen(0, r));
  const b = `http://127.0.0.1:${srv.address().port}`;

  const ok = await fetch(`${b}/api/auth/target`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dev@x.com', target: 'repo:acme/tool' }) });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).target, 'repo:acme/tool');

  const { connections } = await (await fetch(`${b}/api/auth/status`)).json();
  assert.equal(connections.find((c) => c.email === 'dev@x.com').target, 'repo:acme/tool');

  const bad = await fetch(`${b}/api/auth/target`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dev@x.com', target: 'repo:nope' }) });
  assert.equal(bad.status, 400);

  const missing = await fetch(`${b}/api/auth/target`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ghost@x.com', target: 'org:acme' }) });
  assert.equal(missing.status, 404);
  srv.close();
});

test('PUT /api/cards/:fileId persists status even when the Box folder move fails (status lives in metadata)', async () => {
  // Reproduces the dashboard "move to Building fails" bug: moving into the In-Progress
  // subfolder can throw against real Box, but the card's status is metadata-driven and
  // must still be saved so the card lands in the target column.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'move-fail-'));
  const failBox = new FileSystemBoxClient({ root });
  failBox.moveCard = async () => { throw new Error('Box: could not relocate folder'); };
  const srv = http.createServer(createApi({ box: failBox, tokenStore: null }));
  await new Promise((r) => srv.listen(0, r));
  const b = `http://127.0.0.1:${srv.address().port}`;

  const created = await (await fetch(`${b}/api/cards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: 'move-test', pain_score: 0.5 }) })).json();

  const res = await fetch(`${b}/api/cards/${created.fileId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'building' }) });
  assert.equal(res.status, 200, 'a failed folder move must not fail the status change');
  assert.equal((await res.json()).status, 'building');

  const list = await (await fetch(`${b}/api/cards`)).json();
  assert.equal(list.find((c) => c.fileId === created.fileId).status, 'building', 'status must be persisted in metadata');
  srv.close();
});
