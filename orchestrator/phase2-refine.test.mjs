import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileSystemBoxClient } from '../contracts/box-client-mock.mjs';
import { phase2Refine } from './phase2-refine.mjs';

const CARD_ID = '550e8400-e29b-41d4-a716-446655440000';
const sampleSpec = fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'sample-spec.md'), 'utf8');

function fakeGh({ diff = '', prComments = '' } = {}) {
  const calls = [];
  const rec = (n) => (...a) => { calls.push([n, ...a]); };
  return { calls, commitAll: rec('commitAll'), push: rec('push'), async stagedDiff() { return diff; }, async prComments() { return prComments; } };
}
function fakeCc(results = [{ code: 0, stdout: '', stderr: '' }]) {
  const calls = []; let i = 0;
  return { calls, async runSession(cwd, a) { calls.push([cwd, a]); return results[Math.min(i++, results.length - 1)]; } };
}
const fakeBuild = (pass = true) => ({
  build: async () => ({ pass, code: pass ? 0 : 1, output: pass ? 'built' : 'broke' }),
  test: async () => ({ pass, code: pass ? 0 : 1, output: 'Tests: 7 passed' }),
});

async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-p2-'));
  const box = new FileSystemBoxClient({ root: path.join(root, 'box') });
  const { fileId } = await box.uploadCard({
    cardId: CARD_ID, specMarkdown: sampleSpec,
    metadata: { status: 'inbox', theme: 'testing-ci', pain_score: 0.82, card_id: CARD_ID,
      builder_session_id: `${CARD_ID}-phase1`, repo_url: 'https://github.com/acme/x', pr_url: 'https://github.com/acme/x/pull/1', box_task_id: 'task_1' },
  });
  await box.uploadArtifact({ cardId: CARD_ID, name: 'REVIEW_NOTES.md', content: '# Review notes\n- add edge tests', area: 'card' });
  await box.setMetadata(fileId, { status: 'building-approved' });
  const meta = await box.getMetadata(fileId);
  const repoDir = path.join(root, 'work', CARD_ID, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'AI_NOTES.md'), 'scaffold notes');
  return { root, box, fileId, meta, workRoot: path.join(root, 'work'), repoDir };
}

const deps = (over) => ({ gh: fakeGh(), cc: fakeCc(), build: fakeBuild(), refinePromptPath: 'prompts/refine.md', now: () => new Date('2026-05-30T12:00:00Z'), ...over });

test('happy path completes the card and moves it to Completed', async () => {
  const { box, fileId, meta, workRoot } = await setup();
  await phase2Refine(fileId, meta, { box, ...deps({ workRoot }) });
  const m = await box.getMetadata(fileId);
  assert.equal(m.status, 'completed');
  assert.equal(m._folder, 'completed');
});

test('writes a build summary to /Logs/', async () => {
  const { box, fileId, meta, workRoot, root } = await setup();
  await phase2Refine(fileId, meta, { box, ...deps({ workRoot }) });
  const logs = fs.readdirSync(path.join(root, 'box', 'logs'));
  assert.ok(logs.some((f) => f.includes(CARD_ID) && f.endsWith('.md')), `logs: ${logs}`);
});

test('resumes the SAME session id with the refine prompt (§9.1)', async () => {
  const { box, fileId, meta, workRoot } = await setup();
  const cc = fakeCc();
  await phase2Refine(fileId, meta, { box, ...deps({ workRoot, cc }) });
  assert.equal(cc.calls[0][1].sessionId, `${CARD_ID}-phase1`);
  assert.match(cc.calls[0][1].promptFile, /refine\.md/);
});

test('drops the Box REVIEW_NOTES + PR comments into the repo before refining (§8.4)', async () => {
  const { box, fileId, meta, workRoot, repoDir } = await setup();
  let notesAtRunTime = null;
  const cc = { calls: [], async runSession() { notesAtRunTime = fs.readFileSync(path.join(repoDir, 'REVIEW_NOTES.md'), 'utf8'); return { code: 0 }; } };
  const gh = fakeGh({ prComments: 'reviewer: rename the flag' });
  await phase2Refine(fileId, meta, { box, ...deps({ workRoot, cc, gh }) });
  assert.match(notesAtRunTime, /add edge tests/);      // from the Box REVIEW_NOTES artifact
  assert.match(notesAtRunTime, /rename the flag/);      // from PR comments
});

test('moves the card BEFORE the terminal completed write (#3 — no completed→failed revert)', async () => {
  const { box, fileId, meta, workRoot } = await setup();
  const order = [];
  const origMove = box.moveCard.bind(box);
  const origSet = box.setMetadata.bind(box);
  box.moveCard = async (...a) => { order.push('move'); return origMove(...a); };
  box.setMetadata = async (id, patch) => { if (patch.status === 'completed') order.push('completed'); return origSet(id, patch); };
  await phase2Refine(fileId, meta, { box, ...deps({ workRoot }) });
  assert.deepEqual(order, ['move', 'completed'], 'move must precede the irreversible completed write');
});

test('build failure → status=failed, not completed (§11)', async () => {
  const { box, fileId, meta, workRoot } = await setup();
  await phase2Refine(fileId, meta, { box, ...deps({ workRoot, build: fakeBuild(false) }) });
  assert.equal((await box.getMetadata(fileId)).status, 'failed');
});

test('test failure never auto-completes (§11)', async () => {
  const { box, fileId, meta, workRoot } = await setup();
  const build = { build: async () => ({ pass: true, code: 0, output: 'ok' }), test: async () => ({ pass: false, code: 1, output: 'fail' }) };
  await phase2Refine(fileId, meta, { box, ...deps({ workRoot, build }) });
  assert.equal((await box.getMetadata(fileId)).status, 'failed');
});

test('a detected secret blocks the push and fails (§12.5)', async () => {
  const { box, fileId, meta, workRoot } = await setup();
  const gh = fakeGh({ diff: 'sk-ant-secret-here' });
  await phase2Refine(fileId, meta, { box, ...deps({ workRoot, gh }) });
  assert.equal((await box.getMetadata(fileId)).status, 'failed');
  assert.equal(gh.calls.find((c) => c[0] === 'push'), undefined);
});

test('session-expiry: fallback uses a FRESH session id, re-injects spec.md, then completes (§9.1)', async () => {
  const { box, fileId, meta, workRoot, repoDir } = await setup();
  const cc = fakeCc([{ code: 1, stderr: 'session expired' }, { code: 0 }]);
  await phase2Refine(fileId, meta, { box, ...deps({ workRoot, cc }) });
  assert.equal(cc.calls.length, 2);
  const [first, second] = cc.calls.map((c) => c[1].sessionId);
  assert.equal(first, `${CARD_ID}-phase1`, 'first attempt resumes the original session');
  assert.notEqual(second, first, 'fallback starts a fresh session');
  assert.ok(fs.existsSync(path.join(repoDir, 'specs', 'devtool-loop', 'spec.md')), 'context re-injected');
  assert.equal((await box.getMetadata(fileId)).status, 'completed');
});
