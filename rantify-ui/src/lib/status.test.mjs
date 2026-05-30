import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isForwardMove } from './status.js';

test('same column is not a forward move', () => {
  assert.equal(isForwardMove('inbox', 'inbox'), false);
});

test('one step forward is allowed', () => {
  assert.equal(isForwardMove('inbox', 'ready-for-build'), true);
});

test('skip-forward is allowed', () => {
  assert.equal(isForwardMove('inbox', 'building'), true);
});

test('backward move is rejected', () => {
  assert.equal(isForwardMove('ready-for-build', 'inbox'), false);
});

test('moving to failed is rejected (orchestrator-only)', () => {
  assert.equal(isForwardMove('inbox', 'failed'), false);
});

test('moving from failed is rejected (terminal)', () => {
  assert.equal(isForwardMove('failed', 'completed'), false);
});

test('moving from completed is rejected (terminal)', () => {
  assert.equal(isForwardMove('completed', 'inbox'), false);
});
