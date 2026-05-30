import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeCode } from './claude-code.mjs';

function fakeRun(result = { code: 0, stdout: '', stderr: '' }) {
  const calls = [];
  const fn = async (cmd, args, opts) => { calls.push({ cmd, args, opts }); return result; };
  fn.calls = calls;
  return fn;
}

test('builds the SPEC §9.3 invocation with all required flags', async () => {
  const run = fakeRun();
  const cc = createClaudeCode({ run, apiKey: 'sk-ant-x' });
  await cc.runSession('/tmp/repo', { sessionId: 'card-1-phase1', promptFile: 'prompts/scaffold.md' });
  const { cmd, args } = run.calls[0];
  assert.equal(cmd, 'claude');
  const joined = args.join(' ');
  assert.match(joined, /--session-id card-1-phase1/);
  assert.match(joined, /--working-dir \/tmp\/repo/);
  assert.match(joined, /--prompt-file prompts\/scaffold\.md/);
  assert.match(joined, /--no-interactive/);
});

test('passes ANTHROPIC_API_KEY in the child env', async () => {
  const run = fakeRun();
  await createClaudeCode({ run, apiKey: 'sk-ant-x' }).runSession('/r', { sessionId: 's', promptFile: 'p' });
  assert.equal(run.calls[0].opts.env.ANTHROPIC_API_KEY, 'sk-ant-x');
});

test('returns the raw run result without throwing on non-zero exit (SPEC §9.3)', async () => {
  const run = fakeRun({ code: 1, stdout: '', stderr: 'session expired' });
  const r = await createClaudeCode({ run, apiKey: 'x' }).runSession('/r', { sessionId: 's', promptFile: 'p' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /session expired/);
});

test('reuses the same session id passed by the caller (scaffold + refine)', async () => {
  const run = fakeRun();
  const cc = createClaudeCode({ run, apiKey: 'x' });
  await cc.runSession('/r', { sessionId: 'card-1-phase1', promptFile: 'prompts/scaffold.md' });
  await cc.runSession('/r', { sessionId: 'card-1-phase1', promptFile: 'prompts/refine.md' });
  assert.ok(run.calls.every((c) => c.args.join(' ').includes('card-1-phase1')));
});
