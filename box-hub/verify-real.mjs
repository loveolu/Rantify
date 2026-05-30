/**
 * verify-real.mjs — the Person B acceptance check (TASKS.md): the verify-mock scenario run
 * against RealBoxClient instead of the filesystem mock, OFFLINE.
 *
 *   node box-hub/verify-real.mjs
 *
 * An in-memory Box backs the SDK; to mimic real Box, a status change is made to emit a
 * §10.2 webhook into the client's registry (the same registry the live POST /webhooks/box
 * server dispatches to). The orchestrator handler then drives the lifecycle exactly as in
 * contracts/verify-mock.mjs. Proves RealBoxClient is a drop-in for FileSystemBoxClient.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RealBoxClient } from './box-client-real.mjs';

const sampleSpec = fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'sample-spec.md'), 'utf8');
const CARD_ID = '550e8400-e29b-41d4-a716-446655440000';
const log = (...a) => console.log('  ', ...a);

// ---- in-memory Box (same shape as contract.test's fake) ----
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

const box = new RealBoxClient({ client: fakeBox() });

// Mimic real Box: a metadata status change emits a §10.2 webhook into the registry.
const origSet = box.setMetadata.bind(box);
box.setMetadata = async (fileId, patch) => {
  const prev = (await box.getMetadata(fileId)).status;
  const merged = await origSet(fileId, patch);
  if (patch.status && patch.status !== prev) {
    queueMicrotask(() => box.registry.dispatch({
      trigger: 'METADATA_INSTANCE.UPDATED', source: { id: fileId, type: 'file' },
      additional_info: { metadata_instance: { template_key: 'devtool_build_card', data: { status: merged.status, card_id: merged.card_id } } },
    }));
  }
  return merged;
};

// Orchestrator handler (same logic as contracts/verify-mock.mjs).
const seen = [];
box.onWebhook(async (event) => {
  const fileId = event.source.id;
  const m = await box.getMetadata(fileId);
  seen.push(m.status);
  if (m.status === 'ready-for-build') {
    await box.setMetadata(fileId, { status: 'building' });
    assert.ok((await box.getSpecMarkdown(fileId)).includes('Acceptance Criteria'));
    await box.setMetadata(fileId, { builder_session_id: `${m.card_id}-phase1`, repo_url: 'https://github.com/acme/gh-flaky', pr_url: 'https://github.com/acme/gh-flaky/pull/1' });
    await box.uploadArtifact({ cardId: m.card_id, name: 'REVIEW_NOTES.md', content: '# notes' });
    const { taskId } = await box.createTask({ fileId, message: `Review ${m.card_id}` });
    await box.setMetadata(fileId, { box_task_id: taskId });
    log('Phase 1 done: repo + PR + Box task');
  }
  if (m.status === 'building-approved') {
    await box.uploadArtifact({ cardId: m.card_id, name: `${m.card_id}-build.md`, content: '# summary', area: 'logs' });
    await box.moveCard(m.card_id, 'completed');
    await box.setMetadata(fileId, { status: 'completed' });
    log('Phase 2 done: completed + summary');
  }
});

console.log('1. Idea Miner uploads an inbox card (real client)');
const dupes = await box.findDuplicate({ theme: 'testing-ci', withinDays: 7 });
assert.equal(dupes.length, 0);
const ref = await box.uploadCard({ cardId: CARD_ID, specMarkdown: sampleSpec, metadata: { status: 'inbox', theme: 'testing-ci', pain_score: 0.82, card_id: CARD_ID, builder_session_id: null, repo_url: null, pr_url: null, box_task_id: null } });
assert.notEqual(ref.fileId, ref.cardId);
await assert.rejects(box.uploadCard({ cardId: 'x', specMarkdown: '', metadata: { status: 'building', card_id: 'x' } }), /status="inbox"/);

console.log('2. Human sets ready-for-build');
await box.setMetadata(ref.fileId, { status: 'ready-for-build' });
await new Promise((r) => setTimeout(r, 20));

console.log('3. Human approves');
await box.setMetadata(ref.fileId, { status: 'building-approved' });
await new Promise((r) => setTimeout(r, 20));

const final = await box.getMetadata(ref.fileId);
assert.equal(final.status, 'completed');
assert.equal(final.builder_session_id, `${CARD_ID}-phase1`);
assert.ok(final.pr_url && final.repo_url && final.box_task_id);
assert.deepEqual(seen, ['ready-for-build', 'building', 'building-approved', 'completed']);

console.log('\n✅ RealBoxClient passes the verify-mock scenario (offline drop-in for the mock).');
