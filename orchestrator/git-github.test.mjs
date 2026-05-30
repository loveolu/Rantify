import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHub } from './git-github.mjs';

/** records every run() call and returns canned results keyed by a substring match */
function fakeRun(canned = {}) {
  const calls = [];
  const fn = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const key = Object.keys(canned).find((k) => [cmd, ...args].join(' ').includes(k));
    return canned[key] ?? { code: 0, stdout: '', stderr: '' };
  };
  fn.calls = calls;
  return fn;
}

const cfg = { token: 'ghp_tok', org: 'acme', visibility: 'private' };

test('init runs git init in the repo dir', async () => {
  const run = fakeRun();
  await createGitHub({ run, ...cfg }).init('/tmp/repo');
  const c = run.calls[0];
  assert.equal(c.cmd, 'git');
  assert.deepEqual(c.args, ['init']);
  assert.equal(c.opts.cwd, '/tmp/repo');
});

test('commitAll stages and commits with the message', async () => {
  const run = fakeRun();
  await createGitHub({ run, ...cfg }).commitAll('/tmp/repo', 'chore: add spec');
  assert.deepEqual(run.calls.map((c) => [c.cmd, ...c.args]), [
    ['git', 'add', '-A'],
    ['git', 'commit', '-m', 'chore: add spec'],
  ]);
});

test('createRepo calls gh with org/slug + visibility and returns the url', async () => {
  const run = fakeRun();
  const gh = createGitHub({ run, ...cfg });
  const url = await gh.createRepo('flaky-helper');
  const c = run.calls[0];
  assert.equal(c.cmd, 'gh');
  assert.ok(c.args.includes('acme/flaky-helper'));
  assert.ok(c.args.includes('--private'));
  assert.equal(url, 'https://github.com/acme/flaky-helper');
});

test('gh commands receive the token via GH_TOKEN in env', async () => {
  const run = fakeRun();
  await createGitHub({ run, ...cfg }).createRepo('x');
  assert.equal(run.calls[0].opts.env.GH_TOKEN, 'ghp_tok');
});

test('createPr returns the PR url printed by gh', async () => {
  const run = fakeRun({ 'pr create': { code: 0, stdout: 'https://github.com/acme/x/pull/7\n', stderr: '' } });
  const url = await createGitHub({ run, ...cfg }).createPr('/tmp/repo', { title: 'AI Scaffold: x', bodyFile: 'PR_BODY.md' });
  assert.equal(url, 'https://github.com/acme/x/pull/7');
});

test('stagedDiff stages everything then diffs --cached (so untracked files are included)', async () => {
  const run = fakeRun({ 'diff --cached': { code: 0, stdout: '+new file content', stderr: '' } });
  const out = await createGitHub({ run, ...cfg }).stagedDiff('/tmp/repo');
  const cmds = run.calls.map((c) => [c.cmd, ...c.args].join(' '));
  assert.deepEqual(cmds, ['git add -A', 'git diff --cached']);
  assert.equal(out, '+new file content');
});

test('prComments returns reviewer comments via gh, empty string when none', async () => {
  const run = fakeRun({ 'pr view': { code: 0, stdout: 'reviewer: tighten the README\n', stderr: '' } });
  const out = await createGitHub({ run, ...cfg }).prComments('/tmp/repo');
  assert.match(out, /tighten the README/);
});

test('prComments tolerates a gh failure (returns empty, never throws)', async () => {
  const run = fakeRun({ 'pr view': { code: 1, stdout: '', stderr: 'no PR' } });
  const out = await createGitHub({ run, ...cfg }).prComments('/tmp/repo');
  assert.equal(out, '');
});

test('a non-zero git exit throws (callers treat it as phase failure)', async () => {
  const run = fakeRun({ 'git push': { code: 1, stdout: '', stderr: 'rejected' } });
  await assert.rejects(createGitHub({ run, ...cfg }).push('/tmp/repo'), /rejected/);
});

test('createRepo with email uses user login and token', async () => {
  const run = fakeRun();
  const getToken = () => ({ token: 'ghp_user', login: 'alice' });
  const gh = createGitHub({ run, ...cfg, getToken });
  const url = await gh.createRepo('my-tool', 'alice@x.com');
  const c = run.calls[0];
  assert.ok(c.args.includes('alice/my-tool'));
  assert.equal(c.opts.env.GH_TOKEN, 'ghp_user');
  assert.equal(url, 'https://github.com/alice/my-tool');
});

test('createRepo without email falls back to org', async () => {
  const run = fakeRun();
  const getToken = () => ({ token: 'u', login: 'alice' });
  const gh = createGitHub({ run, ...cfg, getToken });
  const url = await gh.createRepo('tool');
  const c = run.calls[0];
  assert.ok(c.args.includes('acme/tool'));
  assert.equal(c.opts.env.GH_TOKEN, 'ghp_tok');
});

test('addRemoteAndPush with email embeds user token in remote URL', async () => {
  const run = fakeRun();
  const getToken = () => ({ token: 'ghp_user', login: 'alice' });
  const gh = createGitHub({ run, ...cfg, getToken });
  await gh.addRemoteAndPush('/r', 'https://github.com/alice/tool', 'alice@x.com');
  const remote = run.calls.find((c) => c.args[0] === 'remote');
  assert.match(remote.args[3], /x-access-token:ghp_user/);
  assert.match(remote.args[3], /github\.com\/alice\/tool/);
});

test('createPr with email uses user token', async () => {
  const run = fakeRun({ 'pr create': { code: 0, stdout: 'https://github.com/alice/tool/pull/1\n', stderr: '' } });
  const getToken = () => ({ token: 'ghp_user', login: 'alice' });
  const gh = createGitHub({ run, ...cfg, getToken });
  await gh.createPr('/r', { title: 'PR', bodyFile: 'b.md' }, 'alice@x.com');
  assert.equal(run.calls[0].opts.env.GH_TOKEN, 'ghp_user');
});

test('createRepo with an org target creates under the org using the user token', async () => {
  const run = fakeRun();
  const getToken = () => ({ token: 'ghp_user', login: 'alice', target: { kind: 'org', org: 'globex' } });
  const url = await createGitHub({ run, ...cfg, getToken }).createRepo('tool', 'alice@x.com');
  const c = run.calls[0];
  assert.ok(c.args.includes('globex/tool'));
  assert.equal(c.opts.env.GH_TOKEN, 'ghp_user');
  assert.equal(url, 'https://github.com/globex/tool');
});

test('createRepo with a repo target returns the existing url and never calls gh repo create', async () => {
  const run = fakeRun();
  const getToken = () => ({ token: 'ghp_user', login: 'alice', target: { kind: 'repo', owner: 'globex', repo: 'flaky' } });
  const url = await createGitHub({ run, ...cfg, getToken }).createRepo('ignored-slug', 'alice@x.com');
  assert.equal(url, 'https://github.com/globex/flaky');
  assert.equal(run.calls.length, 0); // no gh invocation — we clone instead
});

test('cloneExisting clones the target over an authed URL and returns the public url', async () => {
  const run = fakeRun();
  const getToken = () => ({ token: 'ghp_user', login: 'alice', target: { kind: 'repo', owner: 'globex', repo: 'flaky' } });
  const url = await createGitHub({ run, ...cfg, getToken }).cloneExisting('/tmp/repo', 'alice@x.com');
  const c = run.calls[0];
  assert.equal(c.cmd, 'git');
  assert.equal(c.args[0], 'clone');
  assert.match(c.args[1], /x-access-token:ghp_user@github\.com\/globex\/flaky/);
  assert.equal(c.args[2], '/tmp/repo');
  assert.equal(url, 'https://github.com/globex/flaky');
});

test('cloneExisting refuses a non-repo target', async () => {
  const run = fakeRun();
  const getToken = () => ({ token: 'u', login: 'alice', target: { kind: 'org', org: 'globex' } });
  await assert.rejects(createGitHub({ run, ...cfg, getToken }).cloneExisting('/r', 'alice@x.com'), /repo target/);
});

test('resolveTarget defaults to personal for a connected user with no target', () => {
  const getToken = () => ({ token: 'u', login: 'alice' });
  const t = createGitHub({ run: fakeRun(), ...cfg, getToken }).resolveTarget('alice@x.com');
  assert.equal(t.kind, 'personal');
  assert.equal(t.login, 'alice');
});

test('addRemoteAndPush preserves the org owner from the url (not the user login)', async () => {
  const run = fakeRun();
  const getToken = () => ({ token: 'ghp_user', login: 'alice', target: { kind: 'org', org: 'globex' } });
  const gh = createGitHub({ run, ...cfg, getToken });
  await gh.addRemoteAndPush('/r', 'https://github.com/globex/tool', 'alice@x.com');
  const remote = run.calls.find((c) => c.args[0] === 'remote');
  assert.match(remote.args[3], /x-access-token:ghp_user@github\.com\/globex\/tool/);
});
