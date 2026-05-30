import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPoller } from './poller.mjs';

function fakeBox(byStatus) {
  return {
    async listCardsByStatus(status) {
      return (byStatus[status] ?? []).map((cardId) => ({ fileId: `file_${cardId}`, cardId }));
    },
  };
}

test('one tick dispatches every ready-for-build and building-approved card', async () => {
  const box = fakeBox({
    'ready-for-build': ['a'],
    'building-approved': ['b'],
  });
  const seen = [];
  const poller = createPoller({ box, onCard: (fileId) => seen.push(fileId) });
  await poller.tick();
  assert.deepEqual(seen.sort(), ['file_a', 'file_b']);
});

test('skips cards already in flight (no double-dispatch)', async () => {
  const box = fakeBox({ 'ready-for-build': ['a'], 'building-approved': [] });
  const seen = [];
  let release;
  const onCard = (fileId) => {
    seen.push(fileId);
    return new Promise((r) => { release = r; }); // stays pending
  };
  const poller = createPoller({ box, onCard });
  await poller.tick();          // dispatches file_a, still in flight
  await poller.tick();          // should skip it
  assert.deepEqual(seen, ['file_a']);
  release();
});

test('re-dispatches a card after its previous run settles', async () => {
  const box = fakeBox({ 'ready-for-build': ['a'], 'building-approved': [] });
  const seen = [];
  const poller = createPoller({ box, onCard: (fileId) => { seen.push(fileId); } });
  await poller.tick();
  await poller.tick();
  assert.deepEqual(seen, ['file_a', 'file_a']);
});

test('an error in onCard does not wedge the in-flight guard', async () => {
  const box = fakeBox({ 'ready-for-build': ['a'], 'building-approved': [] });
  let calls = 0;
  const poller = createPoller({ box, onCard: () => { calls++; throw new Error('boom'); } });
  await poller.tick();
  await poller.tick();
  assert.equal(calls, 2); // not stuck after the first throw
});

test('start returns a stop function', () => {
  const poller = createPoller({ box: fakeBox({}), onCard: () => {} });
  const stop = poller.start(10_000);
  assert.equal(typeof stop, 'function');
  stop();
});
