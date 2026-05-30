import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBuildRunner } from './build-runner.mjs';

function fakeRun(result = { code: 0, stdout: 'ok', stderr: '' }) {
  const calls = [];
  const fn = async (cmd, args, opts) => { calls.push({ cmd, args, opts }); return result; };
  fn.calls = calls;
  return fn;
}

test('install runs `npm install` in the repo dir', async () => {
  const run = fakeRun();
  await createBuildRunner({ run }).install('/tmp/repo');
  assert.deepEqual([run.calls[0].cmd, ...run.calls[0].args], ['npm', 'install']);
  assert.equal(run.calls[0].opts.cwd, '/tmp/repo');
});

test('build runs `npm run build`', async () => {
  const run = fakeRun();
  await createBuildRunner({ run }).build('/r');
  assert.deepEqual([run.calls[0].cmd, ...run.calls[0].args], ['npm', 'run', 'build']);
});

test('test runs `npm test`', async () => {
  const run = fakeRun();
  await createBuildRunner({ run }).test('/r');
  assert.deepEqual([run.calls[0].cmd, ...run.calls[0].args], ['npm', 'test']);
});

test('reports pass=true and combined output on success', async () => {
  const run = fakeRun({ code: 0, stdout: 'built', stderr: 'warn' });
  const r = await createBuildRunner({ run }).build('/r');
  assert.equal(r.pass, true);
  assert.match(r.output, /built/);
  assert.match(r.output, /warn/);
});

test('reports pass=false on a non-zero exit', async () => {
  const run = fakeRun({ code: 1, stdout: '', stderr: 'test failed' });
  const r = await createBuildRunner({ run }).test('/r');
  assert.equal(r.pass, false);
  assert.match(r.output, /test failed/);
});
