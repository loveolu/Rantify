/**
 * claude-code.mjs — drive the Claude Code CLI (SPEC.md §9).
 *
 * Same session id is used for scaffold and refine so Claude retains context (§9.1); the
 * caller owns the id (`{cardId}-phase1`). Returns the raw run result and does NOT throw on
 * non-zero exit — §9.3 requires the caller to capture stderr, set status=failed, and (for
 * refine) attempt the session-expiry fallback. No auto-retry here.
 */

/**
 * @param {{run: Function, apiKey: string}} deps
 */
export function createClaudeCode({ run, apiKey }) {
  const env = { ...process.env, ANTHROPIC_API_KEY: apiKey };

  return {
    /**
     * @param {string} cwd
     * @param {{sessionId: string, promptFile: string}} a
     * @returns {Promise<{code:number, stdout:string, stderr:string}>}
     */
    runSession(cwd, { sessionId, promptFile }) {
      return run('claude', [
        '--session-id', sessionId,
        '--working-dir', cwd,
        '--prompt-file', promptFile,
        '--no-interactive',
      ], { cwd, env });
    },
  };
}
