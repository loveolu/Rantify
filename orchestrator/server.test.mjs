import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createWebhookServer } from './server.mjs';

const PRIMARY = 'primary-key';
const SECONDARY = 'secondary-key';
const config = { boxWebhookPrimaryKey: PRIMARY, boxWebhookSecondaryKey: SECONDARY };

let server;
let base;
let received;

before(async () => {
  received = [];
  server = createWebhookServer({ config, onEvent: (fileId) => received.push(fileId) });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function signedPost(body, key = PRIMARY, header = 'box-signature-primary') {
  const ts = '2026-05-30T12:00:00Z';
  const sig = createHmac('sha256', key).update(body).update(ts).digest('base64');
  return fetch(`${base}/webhooks/box`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'box-delivery-timestamp': ts, [header]: sig },
    body,
  });
}

const payload = JSON.stringify({
  trigger: 'METADATA_INSTANCE.UPDATED',
  source: { id: 'file_abc', type: 'file' },
});

test('200 and dispatches fileId on a valid signature', async () => {
  const res = await signedPost(payload);
  assert.equal(res.status, 200);
  assert.deepEqual(received, ['file_abc']);
});

test('401 on a bad signature, no dispatch', async () => {
  received.length = 0;
  const res = await signedPost(payload, 'wrong-key');
  assert.equal(res.status, 401);
  assert.equal(received.length, 0);
});

test('404 on an unknown path', async () => {
  const res = await fetch(`${base}/nope`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 404);
});

test('405 on GET to the webhook path', async () => {
  const res = await fetch(`${base}/webhooks/box`, { method: 'GET' });
  assert.equal(res.status, 405);
});
