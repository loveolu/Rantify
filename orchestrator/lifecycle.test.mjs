import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleCard } from './lifecycle.mjs';

function fakeBox(status) {
  const calls = [];
  return {
    calls,
    async getMetadata(fileId) {
      calls.push(['getMetadata', fileId]);
      return { status, card_id: 'card-1' };
    },
  };
}

function spies() {
  const phase1Calls = [];
  const phase2Calls = [];
  return {
    phase1: async (fileId, meta) => { phase1Calls.push([fileId, meta]); },
    phase2: async (fileId, meta) => { phase2Calls.push([fileId, meta]); },
    phase1Calls,
    phase2Calls,
  };
}

test('routes ready-for-build to phase 1', async () => {
  const box = fakeBox('ready-for-build');
  const s = spies();
  const result = await handleCard('file_1', { box, phase1: s.phase1, phase2: s.phase2 });
  assert.equal(s.phase1Calls.length, 1);
  assert.equal(s.phase2Calls.length, 0);
  assert.equal(result.action, 'phase1');
});

test('routes building-approved to phase 2', async () => {
  const box = fakeBox('building-approved');
  const s = spies();
  const result = await handleCard('file_1', { box, phase1: s.phase1, phase2: s.phase2 });
  assert.equal(s.phase2Calls.length, 1);
  assert.equal(s.phase1Calls.length, 0);
  assert.equal(result.action, 'phase2');
});

test('re-fetches metadata (never trusts the trigger) — SPEC §8.2', async () => {
  const box = fakeBox('ready-for-build');
  const s = spies();
  await handleCard('file_xyz', { box, phase1: s.phase1, phase2: s.phase2 });
  assert.deepEqual(box.calls[0], ['getMetadata', 'file_xyz']);
});

for (const status of ['inbox', 'building', 'completed', 'failed']) {
  test(`no-op on status=${status} (idempotency guard, SPEC §8.5)`, async () => {
    const box = fakeBox(status);
    const s = spies();
    const result = await handleCard('file_1', { box, phase1: s.phase1, phase2: s.phase2 });
    assert.equal(s.phase1Calls.length, 0);
    assert.equal(s.phase2Calls.length, 0);
    assert.equal(result.action, 'noop');
  });
}

test('passes the re-fetched metadata into the phase', async () => {
  const box = fakeBox('ready-for-build');
  const s = spies();
  await handleCard('file_1', { box, phase1: s.phase1, phase2: s.phase2 });
  assert.equal(s.phase1Calls[0][1].card_id, 'card-1');
});
