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

test('diff returns git diff stdout for the secret scan', async () => {
  const run = fakeRun({ 'git diff': { code: 0, stdout: '+secret', stderr: '' } });
  const out = await createGitHub({ run, ...cfg }).diff('/tmp/repo');
  assert.equal(out, '+secret');
});

test('a non-zero git exit throws (callers treat it as phase failure)', async () => {
  const run = fakeRun({ 'git push': { code: 1, stdout: '', stderr: 'rejected' } });
  await assert.rejects(createGitHub({ run, ...cfg }).push('/tmp/repo'), /rejected/);
});
