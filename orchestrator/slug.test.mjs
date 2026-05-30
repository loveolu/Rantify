import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugFromTitle } from './slug.mjs';

test('lowercases and hyphenates a title', () => {
  assert.equal(slugFromTitle('Flaky Test Triage Helper'), 'flaky-test-triage-helper');
});

test('strips punctuation and collapses separators', () => {
  assert.equal(slugFromTitle('gh-flaky: CI/CD!! report  tool'), 'gh-flaky-ci-cd-report-tool');
});

test('trims leading/trailing hyphens', () => {
  assert.equal(slugFromTitle('  --Hello--  '), 'hello');
});

test('caps length to keep repo names reasonable', () => {
  const slug = slugFromTitle('word '.repeat(60));
  assert.ok(slug.length <= 60, `slug too long: ${slug.length}`);
  assert.doesNotMatch(slug, /-$/);
});

test('falls back to a default for an empty/symbol-only title', () => {
  assert.equal(slugFromTitle('!!!'), 'devtool');
  assert.equal(slugFromTitle(''), 'devtool');
});
