/**
 * run.mjs — the single subprocess seam (SPEC.md §8.1).
 *
 * Every git / gh / claude / npm call goes through here so the rest of the orchestrator
 * stays readable and the IO boundary is in one place. Resolves with captured output and
 * the exit code (it does NOT throw on non-zero exit — callers decide what a failure
 * means). Rejects only when the process can't be spawned at all.
 */

import { spawn } from 'node:child_process';

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string, env?: Record<string,string|undefined>}} [opts]
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function run(command, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}
