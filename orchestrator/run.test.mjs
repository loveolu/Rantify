import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './run.mjs';

test('captures stdout and exit code 0 on success', async () => {
  const r = await run(process.execPath, ['-e', 'process.stdout.write("hello")']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), 'hello');
  assert.equal(r.stderr, '');
});

test('captures stderr and non-zero exit code on failure', async () => {
  const r = await run(process.execPath, ['-e', 'process.stderr.write("boom"); process.exit(2)']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /boom/);
});

test('runs in the given cwd', async () => {
  const r = await run(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], { cwd: process.cwd() });
  assert.equal(r.stdout.trim(), process.cwd());
});

test('rejects when the binary does not exist', async () => {
  await assert.rejects(run('definitely-not-a-real-binary-xyz', []));
});
