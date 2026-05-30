/**
 * verify-mock.mjs — runs the whole pipeline against the mock, with NO real Box,
 * GitHub, Reddit, or Claude. Proves the frozen contract is internally consistent and
 * gives A / B / C a working reference for how their piece plugs in.
 *
 *   node contracts/verify-mock.mjs
 *
 * It walks: Idea Miner uploads a card -> human sets ready-for-build -> Orchestrator
 * receives the webhook, transitions building, creates a task -> human approves ->
 * Orchestrator refines and completes. Each "actor" below is the seam a real component
 * replaces.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileSystemBoxClient } from './box-client-mock.mjs';

const fixturesDir = path.join(import.meta.dirname, '..', 'fixtures');
const sampleSpec = fs.readFileSync(path.join(fixturesDir, 'sample-spec.md'), 'utf8');
const CARD_ID = '550e8400-e29b-41d4-a716-446655440000';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'box-mock-'));
const box = new FileSystemBoxClient({ root });
const log = (...a) => console.log('  ', ...a);

// --- Orchestrator (Person C) wires up its webhook handler up front ---
const seen = [];
box.onWebhook(async (event) => {
  // §8.2: never trust the payload — re-fetch metadata.
  const fileId = event.source.id;
  const meta = await box.getMetadata(fileId);
  seen.push(meta.status);

  if (meta.status === 'ready-for-build') {            // Phase 1 (§8.3)
    await box.setMetadata(fileId, { status: 'building' });
    const spec = await box.getSpecMarkdown(fileId);
    assert.ok(spec.includes('Acceptance Criteria'), 'spec.md should carry acceptance criteria');
    await box.setMetadata(fileId, {
      builder_session_id: `${meta.card_id}-phase1`,
      repo_url: 'https://github.com/acme/gh-flaky',
      pr_url: 'https://github.com/acme/gh-flaky/pull/1',
    });
    await box.uploadArtifact({ cardId: meta.card_id, name: 'REVIEW_NOTES.md', content: '# Review notes\n- scaffold ready' });
    const { taskId } = await box.createTask({ fileId, message: `Review AI scaffold for: ${meta.card_id}` });
    await box.setMetadata(fileId, { box_task_id: taskId });
    log('Phase 1 done: repo + PR + Box task created');
  }

  if (meta.status === 'building-approved') {           // Phase 2 (§8.4)
    await box.uploadArtifact({ cardId: meta.card_id, name: `${meta.card_id}-build.md`, content: '# build summary', area: 'logs' });
    await box.moveCard(meta.card_id, 'completed');
    await box.setMetadata(fileId, { status: 'completed' });
    log('Phase 2 done: refined, completed, summary written to /Logs/');
  }
});

// --- Idea Miner (Person A): de-dup, then upload an inbox card (§6.6) ---
console.log('1. Idea Miner uploads a Build Card');
const dupes = await box.findDuplicate({ theme: 'testing-ci', withinDays: 7 });
assert.equal(dupes.length, 0, 'no duplicates on a fresh store');
const ref = await box.uploadCard({
  cardId: CARD_ID,
  specMarkdown: sampleSpec,
  metadata: {
    status: 'inbox', theme: 'testing-ci', pain_score: 0.82, card_id: CARD_ID,
    builder_session_id: null, repo_url: null, pr_url: null, box_task_id: null,
  },
});
log(`uploaded card -> fileId=${ref.fileId}`);
assert.notEqual(ref.fileId, ref.cardId, 'fileId must differ from card_id (catches conflation bugs)');

// guard: Idea Miner may not write builder fields with a non-inbox status
await assert.rejects(
  box.uploadCard({ cardId: 'x', specMarkdown: '', metadata: { status: 'building', card_id: 'x' } }),
  /status="inbox"/, 'uploadCard must reject non-inbox status');

// --- Human action: set ready-for-build (§4.2) ---
console.log('2. Human sets status=ready-for-build');
await box.setMetadata(ref.fileId, { status: 'ready-for-build' });
await new Promise((r) => setTimeout(r, 10)); // let the async webhook handler run

// --- Human action: approve the PR ---
console.log('3. Human approves -> status=building-approved');
await box.setMetadata(ref.fileId, { status: 'building-approved' });
await new Promise((r) => setTimeout(r, 10));

// --- Assertions on the final state ---
const final = await box.getMetadata(ref.fileId);
assert.equal(final.status, 'completed', 'card should end completed');
assert.equal(final.builder_session_id, `${CARD_ID}-phase1`);
assert.ok(final.pr_url && final.repo_url && final.box_task_id, 'builder fields set by orchestrator');
assert.deepEqual(seen, ['ready-for-build', 'building', 'building-approved', 'completed'],
  'webhook fired on every status change');

fs.rmSync(root, { recursive: true, force: true });
console.log('\n✅ Contract verified end-to-end against the mock. A, B, C can build in parallel.');
