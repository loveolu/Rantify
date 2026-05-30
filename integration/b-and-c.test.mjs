/**
 * b-and-c.test.mjs — INTEGRATION: Person C's real orchestrator driving Person B's real
 * RealBoxClient (not the mock, not a copy of the handler). Both are built to the frozen
 * contract; this proves they actually interoperate.
 *
 * Box is an in-memory fake under RealBoxClient; the orchestrator's externals (git/gh/claude/
 * npm) are stubbed via ORCH_STUB_EXTERNALS. The card is driven through the lifecycle by
 * calling the orchestrator's own onCard (the poller path — no webhook simulation needed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RealBoxClient } from '../box-hub/box-client-real.mjs';
import { createOrchestrator } from '../orchestrator/index.mjs';
import { loadConfig } from '../orchestrator/config.mjs';
import { makeStubRun } from '../orchestrator/stub-run.mjs';

const CARD_ID = '550e8400-e29b-41d4-a716-446655440000';
const sampleSpec = fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'sample-spec.md'), 'utf8');
const promptsDir = path.join(import.meta.dirname, '..', 'specs', 'devtool-loop', 'prompts');

/** Minimal in-memory Box backing the real SDK surface RealBoxClient uses. */
function fakeBox() {
  let seq = 1; const id = (p) => `${p}_${seq++}`;
  const folders = new Map([['0', { id: '0', name: 'root', parentId: null }]]);
  const files = new Map(); const meta = new Map();
  const kids = (pid) => [
    ...[...folders.values()].filter((f) => f.parentId === pid).map((f) => ({ id: f.id, name: f.name, type: 'folder' })),
    ...[...files.values()].filter((f) => f.parentId === pid).map((f) => ({ id: f.id, name: f.name, type: 'file' })),
  ];
  return {
    folders: {
      getFolderItems: async (fid) => ({ entries: kids(fid) }),
      createFolder: async ({ name, parent }) => { const fid = id('folder'); folders.set(fid, { id: fid, name, parentId: parent.id }); return { id: fid, name, type: 'folder' }; },
      updateFolderById: async (fid, b) => { folders.get(fid).parentId = b.parent.id; return { id: fid }; },
    },
    uploads: {
      uploadFile: async ({ attributes, file }) => { const fid = id('file'); files.set(fid, { id: fid, name: attributes.name, parentId: attributes.parent.id, content: file.toString('utf8'), modified_at: new Date().toISOString() }); return { entries: [{ id: fid }] }; },
      uploadFileVersion: async (fid, { file }) => { files.get(fid).content = file.toString('utf8'); return { entries: [{ id: fid }] }; },
    },
    downloads: { downloadFile: async (fid) => Buffer.from(files.get(fid).content, 'utf8') },
    fileMetadata: {
      createFileMetadataById: async (fid, _s, _t, v) => { meta.set(fid, { ...v }); },
      getFileMetadataById: async (fid) => ({ extraData: { ...(meta.get(fid) ?? {}) } }),
      updateFileMetadataById: async (fid, _s, _t, ops) => { const m = meta.get(fid) ?? {}; for (const o of ops) { const k = o.path.slice(1); if (o.op === 'remove') delete m[k]; else m[k] = o.value; } meta.set(fid, m); },
    },
    tasks: { createTask: async () => ({ id: id('task') }) },
    search: { searchForContent: async () => ({ entries: [...files.values()].filter((f) => meta.has(f.id)).map((f) => ({ id: f.id, type: 'file', modified_at: f.modified_at, metadata: { enterprise: { devtool_build_card: meta.get(f.id) } } })) }) },
  };
}

test('C orchestrator + B RealBoxClient: inbox → ready-for-build → building → approved → completed', async () => {
  const box = new RealBoxClient({ client: fakeBox() });
  const config = loadConfig({ GITHUB_ORG: 'acme', ORCH_STUB_EXTERNALS: '1' });
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-int-'));
  const { onCard } = createOrchestrator({ box, config, run: makeStubRun(), workRoot, promptsDir });

  // Person A's surface (real): upload an inbox card to B's client.
  const { fileId } = await box.uploadCard({
    cardId: CARD_ID, specMarkdown: sampleSpec,
    metadata: { status: 'inbox', theme: 'testing-ci', pain_score: 0.82, card_id: CARD_ID, builder_session_id: null, repo_url: null, pr_url: null, box_task_id: null },
  });

  // Human → ready-for-build; C's real Phase 1 runs against B's real client.
  await box.setMetadata(fileId, { status: 'ready-for-build' });
  await onCard(fileId);
  let m = await box.getMetadata(fileId);
  assert.equal(m.status, 'building', 'Phase 1 set building');
  assert.equal(m.builder_session_id, `${CARD_ID}-phase1`);
  assert.ok(m.repo_url && m.pr_url && m.box_task_id, 'builder fields written through B');
  assert.match(await box.getArtifact({ cardId: CARD_ID, name: 'REVIEW_NOTES.md' }), /Review notes/, 'C wrote REVIEW_NOTES into B');

  // Duplicate dispatch is a no-op (C idempotency through B's metadata).
  await onCard(fileId);
  assert.equal((await box.getMetadata(fileId)).status, 'building');

  // Human → building-approved; C's real Phase 2 reads REVIEW_NOTES via B.getArtifact, completes.
  await box.setMetadata(fileId, { status: 'building-approved' });
  await onCard(fileId);
  m = await box.getMetadata(fileId);
  assert.equal(m.status, 'completed', 'Phase 2 completed through B');

  // Poller surface also works against B.
  await box.uploadCard({ cardId: 'card-2', specMarkdown: sampleSpec, metadata: { status: 'inbox', theme: 'testing-ci', pain_score: 0.5, card_id: 'card-2', builder_session_id: null, repo_url: null, pr_url: null, box_task_id: null } });
  // (no ready-for-build set) → not listed
  assert.deepEqual((await box.listCardsByStatus('ready-for-build')).map((r) => r.cardId), []);

  fs.rmSync(workRoot, { recursive: true, force: true });
});
