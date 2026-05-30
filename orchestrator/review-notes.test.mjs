import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewNotes } from './review-notes.mjs';

test('summarizes build/test status for the reviewer', () => {
  const md = buildReviewNotes({ title: 'gh-flaky', buildPass: true, testsPass: true });
  assert.match(md, /gh-flaky/);
  assert.match(md, /build.*pass/i);
  assert.match(md, /test.*pass/i);
});

test('flags failing build/tests prominently', () => {
  const md = buildReviewNotes({ title: 'x', buildPass: false, testsPass: false });
  assert.match(md, /fail/i);
});

test('includes AI notes when provided', () => {
  const md = buildReviewNotes({ title: 'x', buildPass: true, testsPass: true, aiNotes: 'left out the cache layer' });
  assert.match(md, /left out the cache layer/);
});

test('notes a session-resume fallback when flagged (SPEC §9.1)', () => {
  const md = buildReviewNotes({ title: 'x', buildPass: true, testsPass: true, sessionFallback: true });
  assert.match(md, /session/i);
  assert.match(md, /re-?inject|fallback/i);
});
