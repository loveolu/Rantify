import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from './registry.mjs';

test('dispatch delivers an event to every registered handler', async () => {
  const reg = createRegistry();
  const seen = [];
  reg.register((e) => seen.push(['a', e.trigger]));
  reg.register((e) => seen.push(['b', e.trigger]));
  await reg.dispatch({ trigger: 'X' });
  assert.deepEqual(seen, [['a', 'X'], ['b', 'X']]);
});

test('register returns an unsubscribe that stops delivery', async () => {
  const reg = createRegistry();
  const seen = [];
  const off = reg.register((e) => seen.push(e));
  off();
  await reg.dispatch({ trigger: 'X' });
  assert.equal(seen.length, 0);
});

test('a throwing handler does not block the others (at-least-once is C\'s job)', async () => {
  const reg = createRegistry();
  let reached = false;
  reg.register(() => { throw new Error('boom'); });
  reg.register(() => { reached = true; });
  await reg.dispatch({ trigger: 'X' });
  assert.equal(reached, true);
});
