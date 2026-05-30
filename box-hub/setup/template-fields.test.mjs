import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateFields } from './template-fields.mjs';

test('defines all SPEC §5.3 fields with correct keys', () => {
  const keys = templateFields().map((f) => f.key);
  assert.deepEqual(keys.sort(), ['box_task_id', 'builder_session_id', 'card_id', 'creator_email', 'pain_score', 'pr_url', 'repo_url', 'status', 'theme'].sort());
});

test('status is an enum with the six lifecycle states', () => {
  const status = templateFields().find((f) => f.key === 'status');
  assert.equal(status.type, 'enum');
  assert.deepEqual(status.options.map((o) => o.key), ['inbox', 'ready-for-build', 'building', 'building-approved', 'completed', 'failed']);
});

test('pain_score is a float; ids/urls are strings', () => {
  const byKey = Object.fromEntries(templateFields().map((f) => [f.key, f.type]));
  assert.equal(byKey.pain_score, 'float');
  assert.equal(byKey.card_id, 'string');
  assert.equal(byKey.repo_url, 'string');
});
