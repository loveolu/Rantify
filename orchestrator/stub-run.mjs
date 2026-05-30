/**
 * stub-run.mjs — a canned replacement for run() used when ORCH_STUB_EXTERNALS is set
 * (design §10, beyond-spec). It lets the full lifecycle run offline — no git, gh, claude,
 * or npm — so `verify-orchestrator.mjs` and CI exercise the real code paths (the wrappers
 * still call run() exactly as in production); only this seam returns fabricated results.
 *
 * The `claude` stub writes the artifacts a real scaffold would (PLAN/AI_NOTES + a source
 * file) so downstream steps have something to commit and read.
 */

import fs from 'node:fs';
import path from 'node:path';

/** @returns {(cmd:string, args:string[], opts?:{cwd?:string}) => Promise<{code:number,stdout:string,stderr:string}>} */
export function makeStubRun() {
  let prCounter = 0;
  return async function stubRun(cmd, args = [], opts = {}) {
    const line = [cmd, ...args].join(' ');
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });

    if (cmd === 'claude') {
      const cwd = opts.cwd ?? process.cwd();
      write(cwd, 'PLAN.md', '# Plan\n1. build CLI\n');
      write(cwd, 'AI_NOTES.md', '# AI notes\nBuilt a minimal CLI scaffold.\n');
      write(cwd, path.join('src', 'index.js'), '#!/usr/bin/env node\nconsole.log("scaffold");\n');
      return ok('claude: session complete');
    }
    if (cmd === 'gh' && line.includes('pr create')) return ok(`https://github.com/acme/x/pull/${++prCounter}`);
    if (cmd === 'git' && (line.includes('diff'))) return ok(''); // clean diff → no secrets
    // git init/add/commit/remote/push, gh repo create, npm install/build/test
    return ok(`${cmd} ok`);
  };
}

function write(cwd, rel, content) {
  const dest = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}
