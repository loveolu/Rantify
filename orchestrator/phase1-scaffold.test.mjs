import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileSystemBoxClient } from '../contracts/box-client-mock.mjs';
import { phase1Scaffold } from './phase1-scaffold.mjs';

const CARD_ID = '550e8400-e29b-41d4-a716-446655440000';
const sampleSpec = fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'sample-spec.md'), 'utf8');

function fakeGh({ diff = '' } = {}) {
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  return {
    calls,
    init: rec('init'),
    commitAll: rec('commitAll'),
    addRemoteAndPush: rec('addRemoteAndPush'),
    push: rec('push'),
    async createRepo(slug) { calls.push(['createRepo', slug]); return `https://github.com/acme/${slug}`; },
    async createPr(cwd, o) { calls.push(['createPr', cwd, o]); return 'https://github.com/acme/x/pull/1'; },
    async stagedDiff() { return diff; },
  };
}
const fakeCc = (result = { code: 0, stdout: '', stderr: '' }) => {
  const calls = [];
  return { calls, async runSession(cwd, a) { calls.push([cwd, a]); return result; } };
};
const fakeBuild = (pass = true) => ({
  install: async () => ({ pass: true, code: 0, output: '' }),
  build: async () => ({ pass, code: pass ? 0 : 1, output: pass ? 'built' : 'build broke' }),
  test: async () => ({ pass, code: pass ? 0 : 1, output: 'Tests: 5 passed' }),
});

async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-p1-'));
  const box = new FileSystemBoxClient({ root: path.join(root, 'box') });
  const { fileId } = await box.uploadCard({
    cardId: CARD_ID, specMarkdown: sampleSpec,
    metadata: { status: 'inbox', theme: 'testing-ci', pain_score: 0.82, card_id: CARD_ID,
      builder_session_id: null, repo_url: null, pr_url: null, box_task_id: null },
  });
  await box.setMetadata(fileId, { status: 'ready-for-build' });
  const meta = await box.getMetadata(fileId);
  return { root, box, fileId, meta, workRoot: path.join(root, 'work') };
}

const deps = (over) => ({
  gh: fakeGh(), cc: fakeCc(), build: fakeBuild(), scaffoldPromptPath: 'prompts/scaffold.md',
  now: () => new Date('2026-05-30T12:00:00Z'), ...over,
});

test('happy path leaves status=building with all builder fields set', async () => {
  const { box, fileId, meta, workRoot } = await setup();
  const d = deps({ workRoot });
  await phase1Scaffold(fileId, meta, { box, ...d });
  const m = await box.getMetadata(fileId);
  assert.equal(m.status, 'building');
  assert.equal(m.builder_session_id, `${CARD_ID}-phase1`);
  assert.match(m.repo_url, /github\.com\/acme\//);
  assert.match(m.pr_url, /pull\/1/);
  assert.ok(m.box_task_id);
});

test('creates the repo with a slug derived from the spec title', async () => {
  const { box, fileId, meta, workRoot } = await setup();
  const gh = fakeGh();
  await phase1Scaffold(fileId, meta, { box, ...deps({ workRoot, gh }) });
  const createRepo = gh.calls.find((c) => c[0] === 'createRepo');
  assert.match(createRepo[1], /flaky-test-triage-helper/);
});

test('runs Claude Code with the {cardId}-phase1 session and scaffold prompt', async () => {
  const { box, fileId, meta, workRoot } = await setup();
  const cc = fakeCc();
  await phase1Scaffold(fileId, meta, { box, ...deps({ workRoot, cc }) });
  assert.equal(cc.calls[0][1].sessionId, `${CARD_ID}-phase1`);
  assert.match(cc.calls[0][1].promptFile, /scaffold\.md/);
});

test('commits spec.md + package.json carrying the card id (traceability §12.1)', async () => {
  const { box, fileId, meta, workRoot } = await setup();
  await phase1Scaffold(fileId, meta, { box, ...deps({ workRoot }) });
  const repoDir = path.join(workRoot, CARD_ID, 'repo');
  assert.ok(fs.existsSync(path.join(repoDir, 'specs', 'devtool-loop', 'spec.md')));
  const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
  assert.equal(pkg.devtool_build_card_id, CARD_ID);
});

test('writes REVIEW_NOTES.md and creates a Box approval task carrying the repo URL', async () => {
  const { box, fileId, meta, workRoot, root } = await setup();
  await phase1Scaffold(fileId, meta, { box, ...deps({ workRoot }) });
  assert.ok(fs.existsSync(path.join(root, 'box', 'cards', CARD_ID, 'REVIEW_NOTES.md')));
  const task = JSON.parse(fs.readFileSync(path.join(root, 'box', 'cards', CARD_ID, 'task.json'), 'utf8'));
  assert.match(task.message, /Repo: https:\/\/github\.com\/acme\//); // #2: not an empty Repo: line
});

test('a build failure aborts to status=failed and never opens a PR (§11)', async () => {
  const { box, fileId, meta, workRoot } = await setup();
  const gh = fakeGh();
  await phase1Scaffold(fileId, meta, { box, ...deps({ workRoot, gh, build: fakeBuild(false) }) });
  const m = await box.getMetadata(fileId);
  assert.equal(m.status, 'failed');
  assert.equal(gh.calls.find((c) => c[0] === 'createPr'), undefined);
});

test('a detected secret blocks the push and fails the card (§12.5)', async () => {
  const { box, fileId, meta, workRoot } = await setup();
  const gh = fakeGh({ diff: 'token=ghp_AAAAAAAAAAAAAAAAAAAA' });
  await phase1Scaffold(fileId, meta, { box, ...deps({ workRoot, gh }) });
  const m = await box.getMetadata(fileId);
  assert.equal(m.status, 'failed');
  assert.equal(gh.calls.find((c) => c[0] === 'push'), undefined);
});

test('a non-zero Claude exit fails the card, no PR (§9.3)', async () => {
  const { box, fileId, meta, workRoot } = await setup();
  const gh = fakeGh();
  const cc = fakeCc({ code: 1, stdout: '', stderr: 'claude crashed' });
  await phase1Scaffold(fileId, meta, { box, ...deps({ workRoot, gh, cc }) });
  assert.equal((await box.getMetadata(fileId)).status, 'failed');
  assert.equal(gh.calls.find((c) => c[0] === 'createPr'), undefined);
});
