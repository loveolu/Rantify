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

  /**
   * Resolve the build target for an email into a concrete shape the caller can branch on.
   * @returns {{kind:'personal'|'org'|'repo', owner?:string, repo?:string, login:string, token:string}|null}
   */
  function resolveTarget(email) {
    const user = userInfo(email);
    if (!user) return null;
    const target = user.target ?? { kind: 'personal' };
    return { ...target, login: user.login, token: user.token };
  }

  return {
    resolveTarget,

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
     * Create a NEW repo for the build. Honors the user's target:
     *   - org      → create under that organization (with the user's token)
     *   - personal → create under the user's login (or the configured org as a fallback)
     *   - repo     → no creation; returns the existing repo URL (caller should clone instead)
     * @param {string} slug
     * @param {string} [email]
     */
    async createRepo(slug, email) {
      const t = resolveTarget(email);
      if (t?.kind === 'repo') return `https://github.com/${t.owner}/${t.repo}`;

      let owner, userToken;
      if (t?.kind === 'org') { owner = t.org; userToken = t.token; }
      else if (t) { owner = t.login; userToken = t.token; }
      else if (org) { owner = org; userToken = undefined; }
      else throw new Error('No GitHub owner configured: set GITHUB_ORG env or connect via OAuth');

      await gh(undefined, ['repo', 'create', `${owner}/${slug}`, `--${visibility}`], userToken);
      return `https://github.com/${owner}/${slug}`;
    },

    /**
     * Clone an EXISTING target repo into `repoDir` over an authenticated HTTPS URL.
     * @param {string} repoDir absolute destination directory (must not already exist)
     * @param {string} email
     * @returns {Promise<string>} the public repo URL
     */
    async cloneExisting(repoDir, email) {
      const t = resolveTarget(email);
      if (t?.kind !== 'repo') throw new Error('cloneExisting requires a connected user with a repo target');
      const authed = `https://x-access-token:${t.token}@github.com/${t.owner}/${t.repo}`;
      await git(undefined, ['clone', authed, repoDir]);
      return `https://github.com/${t.owner}/${t.repo}`;
    },

    /** Create and switch to a new branch in an existing checkout. */
    checkoutBranch: (cwd, branch) => git(cwd, ['checkout', '-b', branch]),

    /** Push the current branch upstream (origin already set by clone). */
    pushBranch: (cwd, branch) => git(cwd, ['push', '-u', 'origin', branch]),

    /**
     * @param {string} cwd
     * @param {string} url repo URL returned by createRepo (correct owner already baked in)
     * @param {string} [email] — if set, embeds the user's token in the remote URL
     */
    async addRemoteAndPush(cwd, url, email) {
      const user = userInfo(email);
      const remoteUrl = user ? url.replace('https://', `https://x-access-token:${user.token}@`) : url;
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
