import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileSystemBoxClient } from '../../contracts/box-client-mock.mjs';
import { assertEnv, loadConfigs, runPipeline } from '../index.mjs';

const sampleSpec = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'fixtures', 'sample-spec.md'), 'utf8');
const config = { min_unique_authors: 5, min_subreddit_count: 2, window_days: 60, max_posts_per_run: 50 };
const themes = [{ id: 'testing-ci' }];

const nowSec = () => Math.floor(Date.now() / 1000);
const manyPosts = () => Array.from({ length: 10 }, (_, i) => ({
  id: `p${i}`, author: `author${i}`, subreddit: i % 2 ? 'devops' : 'programming',
  score: 200, created_utc: nowSec(), permalink: `/r/x/${i}`, body: 'our tests are flaky and intermittent, blocked deploy',
}));

function tempBox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'im-box-'));
  return { box: new FileSystemBoxClient({ root }), root };
}

test('runs all five stages in sequence and writes an inbox card (Req 6.1, 6.7)', async () => {
  const { box, root } = tempBox();
  const order = [];
  await runPipeline({
    config, themes, boxClient: box,
    scrapeImpl: async () => { order.push('scrape'); return manyPosts(); },
    generateImpl: async () => { order.push('generate'); return sampleSpec; },
  });
  assert.deepEqual(order.slice(0, 2), ['scrape', 'generate']);
  const inbox = await box.listCardsByStatus('inbox');
  assert.equal(inbox.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('an error in any stage rejects (Req 6.4)', async () => {
  const { box } = tempBox();
  await assert.rejects(runPipeline({ config, themes, boxClient: box, scrapeImpl: async () => { throw new Error('apify down'); } }), /apify down/);
});

test('a successful run resolves (Req 6.5)', async () => {
  const { box, root } = tempBox();
  const res = await runPipeline({ config, themes, boxClient: box, scrapeImpl: async () => manyPosts(), generateImpl: async () => sampleSpec });
  assert.ok(Array.isArray(res));
  fs.rmSync(root, { recursive: true, force: true });
});

test('assertEnv throws naming a missing APIFY_TOKEN (Req 6.8)', () => {
  assert.throws(() => assertEnv({ ANTHROPIC_API_KEY: 'k' }), /APIFY_TOKEN/);
});
test('assertEnv throws naming a missing ANTHROPIC_API_KEY (Req 6.8)', () => {
  assert.throws(() => assertEnv({ APIFY_TOKEN: 't' }), /ANTHROPIC_API_KEY/);
});
test('assertEnv passes when both present', () => {
  assert.doesNotThrow(() => assertEnv({ APIFY_TOKEN: 't', ANTHROPIC_API_KEY: 'k' }));
});

test('loadConfigs throws with the filename when a config is missing (Req 1.1)', () => {
  assert.throws(() => loadConfigs({ configPath: '/no/such/idea-miner.json', themesPath: '/no/such/themes.json' }), /idea-miner\.json/);
});

test('loadConfigs throws with the filename on malformed JSON (Req 1.1)', () => {
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-')), 'idea-miner.json');
  fs.writeFileSync(bad, '{ not json');
  assert.throws(() => loadConfigs({ configPath: bad, themesPath: bad }), /idea-miner\.json/);
});

test('loadConfigs reads the real repo configs', () => {
  const { config: c, themes: t } = loadConfigs();
  assert.equal(c.theme, 'testing-ci');
  assert.ok(t.some((x) => x.id === 'testing-ci'));
});
