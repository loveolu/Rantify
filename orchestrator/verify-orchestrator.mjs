/**
 * verify-orchestrator.mjs — drives the WHOLE Person C lifecycle offline (design §10).
 *
 *   node orchestrator/verify-orchestrator.mjs
 *
 * No real Box, GitHub, or Claude: the Box mock fires §10.2 webhooks in-process and
 * ORCH_STUB_EXTERNALS canned-runs git/gh/claude/npm. It walks
 * inbox → ready-for-build → building → (PR + task) → building-approved → completed,
 * asserting the orchestrator's transitions and builder fields at each step. This is the
 * §8 analogue of contracts/verify-mock.mjs and the component's definition-of-done check.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileSystemBoxClient } from '../contracts/box-client-mock.mjs';
import { loadConfig } from './config.mjs';
import { makeStubRun } from './stub-run.mjs';
import { createOrchestrator } from './index.mjs';

const CARD_ID = '550e8400-e29b-41d4-a716-446655440000';
const fixturesDir = path.join(import.meta.dirname, '..', 'fixtures');
const promptsDir = path.join(import.meta.dirname, '..', 'specs', 'devtool-loop', 'prompts');
const sampleSpec = fs.readFileSync(path.join(fixturesDir, 'sample-spec.md'), 'utf8');
const log = (...a) => console.log('  ', ...a);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-orch-'));
const box = new FileSystemBoxClient({ root: path.join(root, 'box') });
const config = loadConfig({ GITHUB_ORG: 'acme', ORCH_STUB_EXTERNALS: '1' });
const { onCard } = createOrchestrator({ box, config, run: makeStubRun(), workRoot: path.join(root, 'work'), promptsDir });

// Person C wires its handler to the in-process webhook (real Box → POST /webhooks/box).
box.onWebhook((event) => onCard(event.source.id));

async function waitForStatus(fileId, status, ms = 2000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((await box.getMetadata(fileId)).status === status) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for status=${status}`);
}

console.log('1. Idea Miner uploads an inbox Build Card');
const { fileId } = await box.uploadCard({
  cardId: CARD_ID, specMarkdown: sampleSpec,
  metadata: { status: 'inbox', theme: 'testing-ci', pain_score: 0.82, card_id: CARD_ID,
    builder_session_id: null, repo_url: null, pr_url: null, box_task_id: null },
});
log(`uploaded -> fileId=${fileId}`);

console.log('2. Human sets ready-for-build -> Orchestrator runs Phase 1');
await box.setMetadata(fileId, { status: 'ready-for-build' });
await waitForStatus(fileId, 'building');
let m = await box.getMetadata(fileId);
assert.equal(m.status, 'building', 'card should be building after Phase 1');
assert.equal(m.builder_session_id, `${CARD_ID}-phase1`, 'session id recorded');
assert.ok(m.repo_url, 'repo_url set');
assert.ok(m.pr_url, 'pr_url set');
assert.ok(m.box_task_id, 'Box approval task created');
assert.ok(fs.existsSync(path.join(root, 'box', 'cards', CARD_ID, 'REVIEW_NOTES.md')), 'REVIEW_NOTES.md written');
log(`Phase 1 done: repo=${m.repo_url} pr=${m.pr_url} task=${m.box_task_id}`);

console.log('3. Duplicate webhook for the same card is a no-op (idempotency §8.5)');
await onCard(fileId);
assert.equal((await box.getMetadata(fileId)).status, 'building', 'duplicate must not re-run / regress');
log('duplicate ignored');

console.log('4. Human approves -> Orchestrator runs Phase 2');
await box.setMetadata(fileId, { status: 'building-approved' });
await waitForStatus(fileId, 'completed');
m = await box.getMetadata(fileId);
assert.equal(m.status, 'completed', 'card should be completed after Phase 2');
assert.equal(m._folder, 'completed', 'card folder moved to Completed/');
const logs = fs.readdirSync(path.join(root, 'box', 'logs'));
assert.ok(logs.some((f) => f.includes(CARD_ID)), 'build summary written to /Logs/');
log(`Phase 2 done: status=completed, summary in /Logs/ (${logs.length} file)`);

fs.rmSync(root, { recursive: true, force: true });
console.log('\n✅ Orchestrator verified end-to-end offline: inbox → … → completed.');
