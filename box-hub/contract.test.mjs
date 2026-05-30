/**
 * contract.test.mjs — drive RealBoxClient through the full lifecycle against an in-memory
 * Box fake (no network), asserting the frozen-contract behaviors that verify-mock.mjs checks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RealBoxClient } from './box-client-real.mjs';

/** Read a ByteStream (Readable) — or tolerate a Buffer/string — into a UTF-8 string. */
async function readUpload(file) {
  if (file == null) return '';
  if (Buffer.isBuffer(file)) return file.toString('utf8');
  if (typeof file === 'string') return file;
  const chunks = [];
  for await (const c of file) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

/** Minimal in-memory Box: folders, files, file-metadata, tasks, search. */
function fakeBox() {
  let seq = 1;
  const id = (p) => `${p}_${seq++}`;
  const folders = new Map([['0', { id: '0', name: 'root', parentId: null }]]);
  const files = new Map();
  const meta = new Map();
  const childrenOf = (pid) => [
    ...[...folders.values()].filter((f) => f.parentId === pid).map((f) => ({ id: f.id, name: f.name, type: 'folder' })),
    ...[...files.values()].filter((f) => f.parentId === pid).map((f) => ({ id: f.id, name: f.name, type: 'file' })),
  ];
  return {
    _meta: meta, _files: files,
    folders: {
      getFolderItems: async (fid) => ({ entries: childrenOf(fid) }),
      createFolder: async ({ name, parent }) => { const fid = id('folder'); folders.set(fid, { id: fid, name, parentId: parent.id }); return { id: fid, name, type: 'folder' }; },
      updateFolderById: async (fid, body) => { folders.get(fid).parentId = body.parent.id; return { id: fid }; },
    },
    uploads: {
      uploadFile: async ({ attributes, file }) => { const fid = id('file'); files.set(fid, { id: fid, name: attributes.name, parentId: attributes.parent.id, content: await readUpload(file), modified_at: new Date().toISOString() }); return { entries: [{ id: fid }] }; },
      uploadFileVersion: async (fid, { file }) => { files.get(fid).content = await readUpload(file); return { entries: [{ id: fid }] }; },
    },
    downloads: { downloadFile: async (fid) => Buffer.from(files.get(fid).content, 'utf8') },
    fileMetadata: {
      createFileMetadataById: async (fid, _s, _t, values) => { meta.set(fid, { ...values }); },
      getFileMetadataById: async (fid) => ({ extraData: { ...(meta.get(fid) ?? {}) } }),
      updateFileMetadataById: async (fid, _s, _t, ops) => {
        const m = meta.get(fid) ?? {};
        for (const op of ops) { const k = op.path.slice(1); if (op.op === 'remove') delete m[k]; else m[k] = op.value; }
        meta.set(fid, m);
      },
    },
    tasks: { createTask: async () => ({ id: id('task') }) },
    search: {
      searchForContent: async () => ({
        entries: [...files.values()].filter((f) => meta.has(f.id)).map((f) => ({
          id: f.id, type: 'file', modified_at: f.modified_at,
          metadata: { enterprise: { devtool_build_card: meta.get(f.id) } },
        })),
      }),
    },
  };
}

const CARD_ID = '550e8400-e29b-41d4-a716-446655440000';
const inboxMeta = { status: 'inbox', theme: 'testing-ci', pain_score: 0.82, card_id: CARD_ID, builder_session_id: null, repo_url: null, pr_url: null, box_task_id: null };
const newClient = () => new RealBoxClient({ client: fakeBox() });

test('uploadCard rejects a non-inbox status (matches verify-mock assertion)', async () => {
  const box = newClient();
  await assert.rejects(box.uploadCard({ cardId: 'x', specMarkdown: '', metadata: { status: 'building', card_id: 'x' } }), /status="inbox"/);
});

test('uploadCard rejects a card_id / metadata mismatch', async () => {
  const box = newClient();
  await assert.rejects(box.uploadCard({ cardId: 'a', specMarkdown: '', metadata: { status: 'inbox', card_id: 'b' } }), /card_id/);
});

test('full lifecycle: upload → metadata → spec → artifact → task → move → list', async () => {
  const box = newClient();
  const ref = await box.uploadCard({ cardId: CARD_ID, specMarkdown: '# spec\nAcceptance Criteria', metadata: inboxMeta });
  assert.notEqual(ref.fileId, ref.cardId, 'fileId must differ from card_id');

  assert.equal((await box.getMetadata(ref.fileId)).status, 'inbox');
  assert.match(await box.getSpecMarkdown(ref.fileId), /Acceptance Criteria/);

  const merged = await box.setMetadata(ref.fileId, { status: 'building', builder_session_id: `${CARD_ID}-phase1` });
  assert.equal(merged.status, 'building');
  assert.equal(merged.builder_session_id, `${CARD_ID}-phase1`);

  await box.uploadArtifact({ cardId: CARD_ID, name: 'REVIEW_NOTES.md', content: '# notes', area: 'card' });
  assert.equal(await box.getArtifact({ cardId: CARD_ID, name: 'REVIEW_NOTES.md' }), '# notes');

  const { taskId } = await box.createTask({ fileId: ref.fileId, message: 'Review' });
  assert.ok(taskId);

  await box.setMetadata(ref.fileId, { status: 'ready-for-build' });
  assert.deepEqual((await box.listCardsByStatus('ready-for-build')).map((r) => r.cardId), [CARD_ID]);

  await box.moveCard(CARD_ID, 'completed');
  await box.uploadArtifact({ cardId: CARD_ID, name: `${CARD_ID}-build.md`, content: 'summary', area: 'logs' });
  assert.equal(await box.getArtifact({ cardId: CARD_ID, name: `${CARD_ID}-build.md`, area: 'logs' }), 'summary');
});

test('onWebhook registers a handler and returns an unsubscribe', async () => {
  const box = newClient();
  const seen = [];
  const off = box.onWebhook((e) => seen.push(e));
  await box.registry.dispatch({ trigger: 'X' });
  off();
  await box.registry.dispatch({ trigger: 'Y' });
  assert.deepEqual(seen.map((e) => e.trigger), ['X']);
});

test('findDuplicate finds a same-theme inbox card within the window', async () => {
  const box = newClient();
  await box.uploadCard({ cardId: CARD_ID, specMarkdown: '#', metadata: inboxMeta });
  const dupes = await box.findDuplicate({ theme: 'testing-ci', withinDays: 7 });
  assert.deepEqual(dupes.map((r) => r.cardId), [CARD_ID]);
});
