import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRegistry } from './registry.mjs';
import { createWebhookServer } from './server.mjs';

const PRIMARY = 'primary-key';
const config = { boxWebhookPrimaryKey: PRIMARY, boxWebhookSecondaryKey: '' };
let server, base, registry, seen;

before(async () => {
  seen = [];
  registry = createRegistry();
  registry.register((e) => seen.push(e));
  server = createWebhookServer({ config, registry });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function signedPost(body, key = PRIMARY) {
  const ts = new Date().toISOString();
  const sig = createHmac('sha256', key).update(body).update(ts).digest('base64');
  return fetch(`${base}/webhooks/box`, { method: 'POST', headers: { 'box-delivery-timestamp': ts, 'box-signature-primary': sig }, body });
}

const payload = JSON.stringify({
  trigger: 'METADATA_INSTANCE.UPDATED',
  source: { id: 'file_abc', type: 'file' },
  additional_info: { metadata_instance: { template_key: 'devtool_build_card', data: { status: 'ready-for-build', card_id: 'c1' } } },
});

test('200 and dispatches the normalized §10.2 event on a valid signature', async () => {
  const res = await signedPost(payload);
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].trigger, 'METADATA_INSTANCE.UPDATED');
  assert.equal(seen[0].source.id, 'file_abc');
  assert.equal(seen[0].additional_info.metadata_instance.data.card_id, 'c1');
});

test('401 on a bad signature, no dispatch', async () => {
  seen.length = 0;
  const res = await signedPost(payload, 'wrong');
  assert.equal(res.status, 401);
  assert.equal(seen.length, 0);
});

test('healthz returns 200', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
});

test('404 on an unknown path', async () => {
  const res = await fetch(`${base}/nope`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 404);
});
