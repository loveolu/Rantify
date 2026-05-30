import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrBody } from './pr-body.mjs';

const base = {
  boxFileUrl: 'https://app.box.com/file/123',
  theme: 'testing-ci',
  painScore: 0.82,
  aiNotes: 'Built a gh-flaky CLI with scan/report/ignore.',
  testOutput: 'Tests: 5 passed',
};

test('includes the Build Card link, theme and signal score (SPEC §10.4)', () => {
  const md = buildPrBody(base);
  assert.match(md, /https:\/\/app\.box\.com\/file\/123/);
  assert.match(md, /testing-ci/);
  assert.match(md, /0\.82/);
});

test('embeds the AI notes and test output', () => {
  const md = buildPrBody(base);
  assert.match(md, /gh-flaky CLI/);
  assert.match(md, /5 passed/);
});

test('renders the reviewer checklist', () => {
  const md = buildPrBody(base);
  assert.match(md, /- \[ \] No hardcoded secrets/);
  assert.match(md, /- \[ \] README is accurate/);
});

test('fences the test output as a code block', () => {
  const md = buildPrBody(base);
  assert.match(md, /```[\s\S]*Tests: 5 passed[\s\S]*```/);
});
