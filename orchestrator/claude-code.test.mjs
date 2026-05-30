import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createClaudeCode } from './claude-code.mjs';

function fakeRun(result = { code: 0, stdout: '', stderr: '' }) {
  const calls = [];
  const fn = async (cmd, args, opts) => { calls.push({ cmd, args, opts }); return result; };
  fn.calls = calls;
  return fn;
}

test('builds the SPEC §9.3 invocation with all required flags (fallback mode)', async () => {
  const run = fakeRun();
  const cc = createClaudeCode({ run });
  await cc.runSession('/tmp/repo', { sessionId: 'card-1-phase1', promptFile: 'prompts/scaffold.md' });
  const { cmd, args } = run.calls[0];
  assert.equal(cmd, 'claude');
  const joined = args.join(' ');
  assert.match(joined, /--session-id card-1-phase1/);
  assert.match(joined, /--working-dir \/tmp\/repo/);
  assert.match(joined, /--prompt-file prompts\/scaffold\.md/);
  assert.match(joined, /--no-interactive/);
});

test('returns the raw run result without throwing on non-zero exit (fallback mode)', async () => {
  const run = fakeRun({ code: 1, stdout: '', stderr: 'session expired' });
  const r = await createClaudeCode({ run }).runSession('/r', { sessionId: 's', promptFile: 'p' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /session expired/);
});

test('reuses the same session id passed by the caller (fallback mode)', async () => {
  const run = fakeRun();
  const cc = createClaudeCode({ run });
  await cc.runSession('/r', { sessionId: 'card-1-phase1', promptFile: 'prompts/scaffold.md' });
  await cc.runSession('/r', { sessionId: 'card-1-phase1', promptFile: 'prompts/refine.md' });
  assert.ok(run.calls.every((c) => c.args.join(' ').includes('card-1-phase1')));
});

test('Bedrock mode parses <file> blocks and writes them to disk', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
  const promptFile = path.join(tmp, 'prompt.md');
  fs.writeFileSync(promptFile, 'Create a hello world CLI');
  const cc = createClaudeCode({
    modelId: 'fake-model',
    client: {
      async send() {
        return {
          output: {
            message: {
              content: [{ text: '<file path="src/index.js">\nconsole.log("hello");\n</file>\n\nSummary: done.' }],
            },
          },
        };
      },
    },
  });
  await cc.runSession(tmp, { sessionId: 's', promptFile });
  const written = fs.readFileSync(path.join(tmp, 'src', 'index.js'), 'utf8');
  assert.equal(written, 'console.log("hello");\n');
  assert.ok(fs.existsSync(path.join(tmp, 'AI_NOTES.md')));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Bedrock mode writes AI_NOTES.md from response if no file block covers it', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
  const promptFile = path.join(tmp, 'prompt.md');
  fs.writeFileSync(promptFile, 'do nothing');
  const cc = createClaudeCode({
    modelId: 'fake-model',
    client: {
      async send() {
        return {
          output: {
            message: {
              content: [{ text: 'Summary: no files needed.' }],
            },
          },
        };
      },
    },
  });
  await cc.runSession(tmp, { sessionId: 's', promptFile });
  const notes = fs.readFileSync(path.join(tmp, 'AI_NOTES.md'), 'utf8');
  assert.match(notes, /Summary: no files needed/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
