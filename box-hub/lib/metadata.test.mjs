import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMetadata, getCardMetadata, patchMetadata } from './metadata.mjs';

const TEMPLATE = 'devtool_build_card';
const full = {
  status: 'inbox', theme: 'testing-ci', pain_score: 0.82, card_id: 'c1',
  builder_session_id: null, repo_url: null, pr_url: null, box_task_id: null,
};

test('applyMetadata creates the instance with null fields omitted', async () => {
  let captured;
  const client = { fileMetadata: { createFileMetadataById: async (id, scope, tk, values) => { captured = { id, scope, tk, values }; return {}; } } };
  await applyMetadata(client, 'file_1', full);
  assert.equal(captured.scope, 'enterprise');
  assert.equal(captured.tk, TEMPLATE);
  assert.deepEqual(captured.values, { status: 'inbox', theme: 'testing-ci', pain_score: 0.82, card_id: 'c1' });
});

test('getCardMetadata maps instance values to contract form (absent → null)', async () => {
  const client = { fileMetadata: { getFileMetadataById: async () => ({ extraData: { status: 'building', theme: 'testing-ci', pain_score: 0.5, card_id: 'c1' } }) } };
  const m = await getCardMetadata(client, 'file_1');
  assert.equal(m.status, 'building');
  assert.equal(m.repo_url, null);
});

test('getCardMetadata also reads values exposed directly on the instance', async () => {
  const client = { fileMetadata: { getFileMetadataById: async () => ({ status: 'completed', theme: 't', pain_score: 1, card_id: 'c1', repo_url: 'r' }) } };
  const m = await getCardMetadata(client, 'file_1');
  assert.equal(m.status, 'completed');
  assert.equal(m.repo_url, 'r');
});

test('patchMetadata uses add for a previously-null field, replace for a set one', async () => {
  let ops;
  const client = {
    fileMetadata: {
      getFileMetadataById: async () => ({ extraData: { status: 'building', theme: 't', pain_score: 1, card_id: 'c1' } }),
      updateFileMetadataById: async (id, scope, tk, o) => { ops = o; return {}; },
    },
  };
  const merged = await patchMetadata(client, 'file_1', { status: 'building-approved', repo_url: 'https://x' });
  assert.deepEqual(ops.find((o) => o.path === '/status'), { op: 'replace', path: '/status', value: 'building-approved' });
  assert.deepEqual(ops.find((o) => o.path === '/repo_url'), { op: 'add', path: '/repo_url', value: 'https://x' });
  assert.equal(merged.status, 'building-approved');
  assert.equal(merged.repo_url, 'https://x');
});
