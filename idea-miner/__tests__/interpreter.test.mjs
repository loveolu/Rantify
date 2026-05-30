import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretQuery, extractJson, normalizeSubreddit, DEFAULT_THEME } from '../interpreter.mjs';

process.env.AWS_REGION ??= 'us-east-1'; // tests inject callBedrockImpl; this only satisfies assertBedrockEnv

const themes = [{ id: 'testing-ci' }, { id: 'product-feedback' }];

test('extractJson tolerates code fences and surrounding prose', () => {
  assert.deepEqual(extractJson('```json\n{"subject":"x"}\n```'), { subject: 'x' });
  assert.deepEqual(extractJson('Here you go: {"a":1} done'), { a: 1 });
  assert.equal(extractJson('no json here'), null);
});

test('normalizeSubreddit strips r/ and blanks', () => {
  assert.equal(normalizeSubreddit('r/Productivity'), 'Productivity');
  assert.equal(normalizeSubreddit('/r/devops'), 'devops');
  assert.equal(normalizeSubreddit('  '), undefined);
  assert.equal(normalizeSubreddit(undefined), undefined);
});

test('interpretQuery parses subject, phrases, and a valid theme', async () => {
  const out = await interpretQuery('feedback about Notion AI', { themes }, {
    callBedrockImpl: async () => JSON.stringify({ subject: 'Notion AI', searchPhrases: ['notion ai', 'notion ai sucks'], theme: 'product-feedback' }),
  });
  assert.equal(out.subject, 'Notion AI');
  assert.deepEqual(out.searchPhrases, ['notion ai', 'notion ai sucks']);
  assert.equal(out.theme, 'product-feedback');
});

test('interpretQuery clamps an unknown theme to the default', async () => {
  const out = await interpretQuery('x', { themes }, {
    callBedrockImpl: async () => JSON.stringify({ subject: 'x', searchPhrases: ['x'], theme: 'totally-made-up' }),
  });
  assert.equal(out.theme, DEFAULT_THEME);
});

test('interpretQuery falls back to the raw query when the model returns garbage', async () => {
  const out = await interpretQuery('Spotify shuffle complaints', { themes }, {
    callBedrockImpl: async () => 'not json at all',
  });
  assert.equal(out.subject, 'Spotify shuffle complaints');
  assert.deepEqual(out.searchPhrases, ['Spotify shuffle complaints']);
  assert.equal(out.theme, DEFAULT_THEME);
});

test('interpretQuery threads the normalized subreddit through', async () => {
  const out = await interpretQuery('x', { subreddit: 'r/spotify', themes }, {
    callBedrockImpl: async () => JSON.stringify({ subject: 'x', searchPhrases: ['x'], theme: 'product-feedback' }),
  });
  assert.equal(out.subreddit, 'spotify');
});

test('interpretQuery throws on empty query before any call', async () => {
  let called = false;
  await assert.rejects(interpretQuery('   ', { themes }, { callBedrockImpl: async () => { called = true; return '{}'; } }), /query/);
  assert.equal(called, false);
});
