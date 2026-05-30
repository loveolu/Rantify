import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileSystemBoxClient } from '../contracts/box-client-mock.mjs';
import { createApi } from './api.mjs';

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
