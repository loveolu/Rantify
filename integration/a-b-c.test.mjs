/**
 * a-b-c.test.mjs — FULL-SYSTEM INTEGRATION: Person A's Idea Miner pipeline writes a Build
 * Card into Person B's RealBoxClient, then Person C's orchestrator drives it to completed.
 * All three real components, interoperating only through the frozen contract. Apify/Anthropic
 * are stubbed (A), the Box SDK is the in-memory fake (B), git/gh/claude/npm are stubbed (C).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeBox } from './fake-box.mjs';
import { RealBoxClient } from '../box-hub/box-client-real.mjs';
import { runPipeline, loadConfigs } from '../idea-miner/index.mjs';
import { createOrchestrator } from '../orchestrator/index.mjs';
import { loadConfig as loadOrchConfig } from '../orchestrator/config.mjs';
import { makeStubRun } from '../orchestrator/stub-run.mjs';

const sampleSpec = fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'sample-spec.md'), 'utf8');
const CARD_ID = '550e8400-e29b-41d4-a716-446655440000';
const promptsDir = path.join(import.meta.dirname, '..', 'specs', 'devtool-loop', 'prompts');
const nowSec = () => Math.floor(Date.now() / 1000);
const posts = Array.from({ length: 12 }, (_, i) => ({
  id: `p${i}`, author: `dev_${i}`, subreddit: i % 3 === 0 ? 'devops' : (i % 3 === 1 ? 'programming' : 'ExperiencedDevs'),
  score: 150, created_utc: nowSec(), permalink: `/r/x/${i}`, body: 'flaky intermittent tests; slow ci pipeline takes forever, blocked deploy',
}));

test('A (Idea Miner) → B (RealBoxClient) → C (Orchestrator): pain → spec → scaffold → completed', async () => {
  const box = new RealBoxClient({ client: fakeBox() });
  const { config: minerConfig, themes } = loadConfigs();

  // ── A: mine an inbox card into B (Apify + Anthropic stubbed) ──
  await runPipeline({ config: minerConfig, themes, boxClient: box, scrapeImpl: async () => posts, generateImpl: async () => sampleSpec });
  const inbox = await box.listCardsByStatus('inbox');
  assert.equal(inbox.length, 1, 'A wrote one inbox card through B');
  const { fileId } = inbox[0];
  assert.equal((await box.getMetadata(fileId)).card_id, CARD_ID);

  // ── C: orchestrate the card to completion (git/gh/claude/npm stubbed) ──
  const orchConfig = loadOrchConfig({ GITHUB_ORG: 'acme', ORCH_STUB_EXTERNALS: '1' });
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abc-'));
  const { onCard } = createOrchestrator({ box, config: orchConfig, run: makeStubRun(), workRoot, promptsDir });

  await box.setMetadata(fileId, { status: 'ready-for-build' });
  await onCard(fileId);
  let m = await box.getMetadata(fileId);
  assert.equal(m.status, 'building', 'C Phase 1 ran against B');
  assert.ok(m.repo_url && m.pr_url && m.box_task_id);

  await box.setMetadata(fileId, { status: 'building-approved' });
  await onCard(fileId);
  m = await box.getMetadata(fileId);
  assert.equal(m.status, 'completed', 'C Phase 2 completed the card through B');

  fs.rmSync(workRoot, { recursive: true, force: true });
});
