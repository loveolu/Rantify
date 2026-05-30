/**
 * git-github.mjs — git + GitHub (`gh`) operations for Phase 1/2 (SPEC.md §8.3, §10.4).
 *
 * Thin wrappers over the injected run() seam. Every git/gh step that fails (non-zero exit)
 * throws, so a phase aborts to `status=failed` (SPEC §11). `gh` auth is passed as GH_TOKEN
 * in the child env — never on the command line, never persisted (SPEC §12.5).
 */

/**
 * @param {{run: Function, token: string, org: string, visibility: 'private'|'public'}} deps
 */
export function createGitHub({ run, token, org, visibility }) {
  const ghEnv = { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token };

  async function git(cwd, args) {
    const r = await run('git', args, { cwd });
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
    return r;
  }
  async function gh(cwd, args) {
    const r = await run('gh', args, { cwd, env: ghEnv });
    if (r.code !== 0) throw new Error(`gh ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
    return r;
  }

  return {
    init: (cwd) => git(cwd, ['init']),

    async commitAll(cwd, message) {
      await git(cwd, ['add', '-A']);
      await git(cwd, ['commit', '-m', message]);
    },

    diff: async (cwd) => (await git(cwd, ['diff', 'HEAD'])).stdout,

    async createRepo(slug) {
      await gh(undefined, ['repo', 'create', `${org}/${slug}`, `--${visibility}`]);
      return `https://github.com/${org}/${slug}`;
    },

    async addRemoteAndPush(cwd, url) {
      await git(cwd, ['remote', 'add', 'origin', url]);
      await git(cwd, ['push', '-u', 'origin', 'main']);
    },

    push: (cwd) => git(cwd, ['push', 'origin', 'HEAD']),

    async createPr(cwd, { title, bodyFile }) {
      const r = await gh(cwd, ['pr', 'create', '--title', title, '--body-file', bodyFile]);
      return r.stdout.trim();
    },
  };
}
