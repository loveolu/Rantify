/**
 * git-github.mjs — git + GitHub (`gh`) operations for Phase 1/2 (SPEC.md §8.3, §10.4).
 *
 * Supports two modes:
 *   1. Org-level token — repo created under `org/slug` using the configured token
 *   2. Per-user token — if `getToken(email)` returns a user, the repo is created under
 *      the user's personal GitHub with their token. The `email` param on gh methods
 *      triggers this path.
 * Auth: GH_TOKEN in child env, never on command line, never persisted (SPEC §12.5).
 */

/**
 * @param {{run: Function, token: string, org: string, visibility: 'private'|'public',
 *          getToken?: (email:string) => {token:string, login:string}|undefined}} deps
 */
export function createGitHub({ run, token, org, visibility, getToken }) {
  function mkGhEnv(tokenOverride) {
    const t = tokenOverride ?? token;
    return { ...process.env, GH_TOKEN: t, GITHUB_TOKEN: t };
  }

  async function git(cwd, args) {
    const r = await run('git', args, { cwd });
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
    return r;
  }
  async function gh(cwd, args, tokenOverride) {
    const r = await run('gh', args, { cwd, env: mkGhEnv(tokenOverride) });
    if (r.code !== 0) throw new Error(`gh ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
    return r;
  }

  function userInfo(email) {
    if (!email || !getToken) return null;
    const entry = getToken(email);
    if (!entry?.token || !entry?.login) return null;
    return entry;
  }

  return {
    init: (cwd) => git(cwd, ['init']),

    async commitAll(cwd, message) {
      await git(cwd, ['add', '-A']);
      await git(cwd, ['commit', '-m', message]);
    },

    async stagedDiff(cwd) {
      await git(cwd, ['add', '-A']);
      return (await git(cwd, ['diff', '--cached'])).stdout;
    },

    /**
     * @param {string} slug
     * @param {string} [email] — if set, creates repo under the user's personal GitHub
     */
    async createRepo(slug, email) {
      const user = userInfo(email);
      if (!user && !org) throw new Error('No GitHub owner configured: set GITHUB_ORG env or connect via OAuth');
      const owner = user ? user.login : org;
      const userToken = user?.token;
      await gh(undefined, ['repo', 'create', `${owner}/${slug}`, `--${visibility}`], userToken);
      return `https://github.com/${owner}/${slug}`;
    },

    /**
     * @param {string} cwd
     * @param {string} url
     * @param {string} [email] — if set, embeds the user's token in the remote URL
     */
    async addRemoteAndPush(cwd, url, email) {
      const user = userInfo(email);
      const remoteUrl = user ? `https://x-access-token:${user.token}@github.com/${user.login}/${url.split('/').pop()}` : url;
      await git(cwd, ['remote', 'add', 'origin', remoteUrl]);
      await git(cwd, ['push', '-u', 'origin', 'main']);
    },

    push: (cwd) => git(cwd, ['push', 'origin', 'HEAD']),

    /**
     * @param {string} cwd
     * @param {{title:string, bodyFile:string}} a
     * @param {string} [email] — if set, uses the user's token for auth
     */
    async createPr(cwd, { title, bodyFile }, email) {
      const user = userInfo(email);
      const r = await gh(cwd, ['pr', 'create', '--title', title, '--body-file', bodyFile], user?.token);
      return r.stdout.trim();
    },

    /**
     * @param {string} cwd
     * @param {string} [email] — if set, uses the user's token for auth
     */
    async prComments(cwd, email) {
      const user = userInfo(email);
      const r = await run('gh', ['pr', 'view', '--comments'], { cwd, env: mkGhEnv(user?.token) });
      return r.code === 0 ? r.stdout : '';
    },
  };
}
