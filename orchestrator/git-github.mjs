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

    // Stage everything first so the diff includes NEW untracked files (Claude's scaffold
    // output); a plain `git diff` would miss them and let secrets slip past the §12.5 scan.
    async stagedDiff(cwd) {
      await git(cwd, ['add', '-A']);
      return (await git(cwd, ['diff', '--cached'])).stdout;
    },

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

    // Best-effort: missing PR / no comments must not fail the refine phase (SPEC §8.4).
    async prComments(cwd) {
      const r = await run('gh', ['pr', 'view', '--comments'], { cwd, env: ghEnv });
      return r.code === 0 ? r.stdout : '';
    },
  };
}
