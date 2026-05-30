import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { validateCard, generate, buildSystemPrompt, injectFailedStatus } from '../generator.mjs';

process.env.ANTHROPIC_API_KEY ??= 'test-key'; // most tests use the injected callClaudeImpl

const sampleSpec = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'fixtures', 'sample-spec.md'), 'utf8');
const themes = [{ id: 'testing-ci' }, { id: 'observability' }];
const cluster = { name: 'flaky-tests', posts: [{ author: 'a', subreddit: 'r', permalink: '/p', body: 'flaky', reddit_score: 5 }], uniqueAuthors: 6, subredditCount: 3 };
const config = { theme: 'testing-ci' };
const frontMatter = (md) => yaml.load(md.split('---')[1]);

// Feature: idea-miner, Property 11: Schema validator correctly identifies valid and invalid cards
test('Property 11: the reference sample validates; targeted mutations fail', () => {
  assert.deepEqual(validateCard(sampleSpec, themes), { valid: true, errors: [] });

  const mutations = [
    sampleSpec.replace('status: "inbox"', 'status: "building"'),       // wrong status
    sampleSpec.replace(/theme: "testing-ci"/, 'theme: "nope"'),         // unknown theme
    sampleSpec.replace(/id: "550e8400-e29b-41d4-a716-446655440000"/, 'id: "not-a-uuid"'),
    sampleSpec.replace(/## Acceptance Criteria[\s\S]*$/, ''),           // no acceptance criteria
    sampleSpec.replace(/score: 0\.82/, 'score: 1.9'),                   // out of [0,1]
  ];
  for (const bad of mutations) {
    const r = validateCard(bad, themes);
    assert.equal(r.valid, false);
    assert.ok(r.errors.length >= 1);
  }
});

// Feature: idea-miner, Property 12: Generated card structural invariant
test('Property 12: generate output is inbox+null-builder (valid) or failed (garbage)', async () => {
  const valid = await generate(cluster, config, themes, { callClaudeImpl: async () => sampleSpec });
  const fmValid = frontMatter(valid);
  assert.equal(fmValid.status, 'inbox');
  assert.ok(Object.values(fmValid.builder).every((v) => v === null));

  const failed = await generate(cluster, config, themes, { callClaudeImpl: async () => 'total garbage not a card' });
  const fmFailed = frontMatter(failed);
  assert.equal(fmFailed.status, 'failed');
  assert.ok(Object.values(fmFailed.builder).every((v) => v === null));
});

test('system prompt forbids preamble / code fences (Req 4.2)', () => {
  assert.match(buildSystemPrompt(), /ONLY the file content|no preamble|no code fences/i);
});

test('invalid attempt 1 → retry with error appended to prompt (Req 4.5)', async () => {
  const prompts = [];
  let n = 0;
  await generate(cluster, config, themes, {
    callClaudeImpl: async (sys, user) => { prompts.push(user); return n++ === 0 ? 'garbage' : sampleSpec; },
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /error|invalid|failed validation/i);
});

test('invalid on both attempts → Failed_Card with status failed (Req 4.6)', async () => {
  const out = await generate(cluster, config, themes, { callClaudeImpl: async () => 'garbage' });
  assert.equal(frontMatter(out).status, 'failed');
});

test('missing ANTHROPIC_API_KEY throws before any API call (Req 4.7)', async () => {
  const prev = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  let called = false;
  await assert.rejects(generate(cluster, config, themes, { callClaudeImpl: async () => { called = true; return ''; } }), /ANTHROPIC_API_KEY/);
  assert.equal(called, false);
  if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
});

test('transport error on attempt 1 → retry; transport error on attempt 2 → Failed_Card (Req 4.10)', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  const out = await generate(cluster, config, themes, { callClaudeImpl: async () => { throw new Error('429 rate limited'); } });
  assert.equal(frontMatter(out).status, 'failed');
});

test('injectFailedStatus puts status:failed first and preserves raw output', () => {
  const card = injectFailedStatus('RAW MODEL TEXT', 'missing title');
  const fm = frontMatter(card);
  assert.equal(fm.status, 'failed');
  assert.match(card, /RAW MODEL TEXT/);
  assert.match(card, /missing title/);
});
