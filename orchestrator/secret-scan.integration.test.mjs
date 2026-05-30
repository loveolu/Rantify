/**
 * Real-git regression test for the finding: the secret scan must catch secrets in
 * NEWLY-CREATED (untracked) files — exactly what Claude scaffolds. `git diff HEAD` misses
 * those; `stagedDiff` (git add -A && git diff --cached) catches them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './run.mjs';
import { createGitHub } from './git-github.mjs';
import { scanDiff } from './secret-scan.mjs';

test('a secret in an untracked scaffold file is caught by the staged scan', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gitsec-'));
  await run('git', ['init', '-b', 'main'], { cwd: repo });
  await run('git', ['config', 'user.email', 't@t'], { cwd: repo });
  await run('git', ['config', 'user.name', 't'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), '# x');
  await run('git', ['add', '-A'], { cwd: repo });
  await run('git', ['commit', '-m', 'init'], { cwd: repo });

  // Claude "scaffolds" a brand-new, untracked source file containing a secret.
  fs.writeFileSync(path.join(repo, 'src.js'), 'const token = "ghp_AAAAAAAAAAAAAAAAAAAA";\n');

  const gh = createGitHub({ run, token: 't', org: 'o', visibility: 'private' });
  const findings = scanDiff(await gh.stagedDiff(repo));
  assert.ok(findings.some((f) => f.pattern === 'ghp_'), 'staged scan must see the untracked file');

  fs.rmSync(repo, { recursive: true, force: true });
});
