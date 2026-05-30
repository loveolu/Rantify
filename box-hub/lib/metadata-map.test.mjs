import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toInstanceValues, toContractMetadata, toPatchOps } from './metadata-map.mjs';

const full = {
  status: 'inbox', theme: 'testing-ci', pain_score: 0.82, card_id: 'c1',
  builder_session_id: null, repo_url: null, pr_url: null, box_task_id: null,
  creator_email: null,
};

test('toInstanceValues omits null fields (Box cannot store null)', () => {
  const v = toInstanceValues(full);
  assert.deepEqual(v, { status: 'inbox', theme: 'testing-ci', pain_score: 0.82, card_id: 'c1' });
  assert.ok(!('repo_url' in v));
});

test('toContractMetadata fills absent builder fields as null', () => {
  const m = toContractMetadata({ status: 'building', theme: 'testing-ci', pain_score: 0.82, card_id: 'c1' });
  assert.equal(m.status, 'building');
  assert.equal(m.builder_session_id, null);
  assert.equal(m.repo_url, null);
  assert.equal(m.pr_url, null);
  assert.equal(m.box_task_id, null);
  assert.equal(m.creator_email, null);
});

test('round-trips a fully-populated instance', () => {
  const populated = { status: 'building', theme: 'testing-ci', pain_score: 0.5, card_id: 'c1', builder_session_id: 'c1-phase1', repo_url: 'r', pr_url: 'p', box_task_id: 't', creator_email: 'user@x.com' };
  assert.deepEqual(toContractMetadata(toInstanceValues(populated)), populated);
});

test('toPatchOps emits replace for set values and remove for nulls', () => {
  const ops = toPatchOps({ status: 'building', repo_url: null });
  assert.deepEqual(ops.find((o) => o.path === '/status'), { op: 'replace', path: '/status', value: 'building' });
  assert.deepEqual(ops.find((o) => o.path === '/repo_url'), { op: 'remove', path: '/repo_url' });
});

test('toPatchOps ignores keys not in the partial', () => {
  const ops = toPatchOps({ status: 'completed' });
  assert.equal(ops.length, 1);
});
