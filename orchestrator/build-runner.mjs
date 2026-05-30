/**
 * build-runner.mjs — npm install / build / test with captured exit codes (SPEC.md §8.3).
 *
 * Each step returns { pass, code, output } so the phase can decide: a non-zero build or
 * test never auto-completes — it routes to status=failed (SPEC §11), no auto-retry.
 */

const result = (r) => ({ pass: r.code === 0, code: r.code, output: `${r.stdout}${r.stderr}` });

/** @param {{run: Function}} deps */
export function createBuildRunner({ run }) {
  return {
    install: async (cwd) => result(await run('npm', ['install'], { cwd })),
    build: async (cwd) => result(await run('npm', ['run', 'build'], { cwd })),
    test: async (cwd) => result(await run('npm', ['test'], { cwd })),
  };
}
