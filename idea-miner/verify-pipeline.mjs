/**
 * verify-pipeline.mjs — run the whole Idea Miner pipeline OFFLINE (SPEC.md §6, §14 Phase 1).
 *
 *   node idea-miner/verify-pipeline.mjs
 *
 * No Apify, Anthropic, or real Box: the scrape + generate stages are stubbed, score/cluster/
 * upload are real, and the card lands in a temp FileSystemBoxClient. Asserts a schema-valid
 * inbox card with correct metadata, then a second run is de-dup suppressed (SPEC §6.6).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileSystemBoxClient } from '../contracts/box-client-mock.mjs';
import { runPipeline, loadConfigs } from './index.mjs';

const sampleSpec = fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'sample-spec.md'), 'utf8');
const { config, themes } = loadConfigs();
const log = (...a) => console.log('  ', ...a);
const nowSec = () => Math.floor(Date.now() / 1000);

const posts = Array.from({ length: 12 }, (_, i) => ({
  id: `p${i}`, author: `dev_${i}`, subreddit: i % 3 === 0 ? 'devops' : (i % 3 === 1 ? 'programming' : 'ExperiencedDevs'),
  score: 150, created_utc: nowSec(), permalink: `/r/x/${i}`,
  body: 'tests are flaky and intermittent; slow ci pipeline takes forever, blocked deploy',
}));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-im-'));
const box = new FileSystemBoxClient({ root });
const deps = { config, themes, boxClient: box, scrapeImpl: async () => posts, generateImpl: async () => sampleSpec };

console.log('1. Run pipeline: scrape → score → cluster → generate → upload');
const results = await runPipeline(deps);
log(`uploaded ${results.length} card(s)`);

const inbox = await box.listCardsByStatus('inbox');
assert.ok(inbox.length >= 1, 'at least one inbox card written');
const meta = await box.getMetadata(inbox[0].fileId);
assert.equal(meta.status, 'inbox');
assert.equal(meta.theme, 'testing-ci');
assert.equal(meta.card_id, '550e8400-e29b-41d4-a716-446655440000');
assert.ok(meta.pain_score > 0 && meta.pain_score <= 1);
log(`card metadata: status=${meta.status} theme=${meta.theme} pain_score=${meta.pain_score}`);

console.log('2. Re-run → de-dup suppresses the repeat (SPEC §6.6)');
const second = await runPipeline(deps);
assert.ok(second.includes('duplicate'), 'second run suppressed as duplicate');
log('duplicate suppressed');

fs.rmSync(root, { recursive: true, force: true });
console.log('\n✅ Idea Miner pipeline verified offline: complaints → scored → clustered → card in Box Inbox.');
