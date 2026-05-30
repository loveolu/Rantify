/**
 * config.mjs — read + validate environment configuration (SPEC.md §13).
 *
 * Pure: takes an env object (defaults to process.env) and returns a frozen config,
 * or throws listing every missing required variable. Required external creds are
 * relaxed when ORCH_STUB_EXTERNALS is set (test/CI; beyond-spec, see design §10).
 */

const TRUE_VALUES = new Set(['1', 'true', 'yes']);
const VISIBILITIES = new Set(['private', 'public']);

/** Vars required only when really talking to Box / Claude. */
const EXTERNAL_REQUIRED = [
  'BOX_WEBHOOK_PRIMARY_KEY',
  'BOX_WEBHOOK_SECONDARY_KEY',
  'BEDROCK_MODEL_ID',
];

/** Vars always required (currently none — GITHUB_ORG/GITHUB_TOKEN are optional fallbacks). */
const ALWAYS_REQUIRED = [];

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {Readonly<{githubToken:string, githubOrg:string, githubRepoVisibility:string,
 *   boxWebhookPrimaryKey:string, boxWebhookSecondaryKey:string, bedrockRegion:string,
 *   bedrockModelId:string, githubOAuthClientId:string, githubOAuthClientSecret:string,
 *   oauthRedirectUri:string, stubExternals:boolean}>}
 */
export function loadConfig(env = process.env) {
  const stubExternals = TRUE_VALUES.has(String(env.ORCH_STUB_EXTERNALS ?? '').toLowerCase());

  const required = stubExternals ? ALWAYS_REQUIRED : [...ALWAYS_REQUIRED, ...EXTERNAL_REQUIRED];
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env var(s): ${missing.join(', ')} (SPEC.md §13)`);
  }

  const githubRepoVisibility = env.GITHUB_REPO_VISIBILITY ?? 'private';
  if (!VISIBILITIES.has(githubRepoVisibility)) {
    throw new Error(`GITHUB_REPO_VISIBILITY must be 'private' or 'public', got '${githubRepoVisibility}'`);
  }

  return Object.freeze({
    githubToken: env.GITHUB_TOKEN ?? '',
    githubOrg: env.GITHUB_ORG,
    githubRepoVisibility,
    boxWebhookPrimaryKey: env.BOX_WEBHOOK_PRIMARY_KEY ?? '',
    boxWebhookSecondaryKey: env.BOX_WEBHOOK_SECONDARY_KEY ?? '',
    bedrockRegion: env.BEDROCK_REGION ?? env.AWS_REGION ?? '',
    bedrockModelId: env.BEDROCK_MODEL_ID ?? '',
    githubOAuthClientId: env.GITHUB_OAUTH_CLIENT_ID ?? '',
    githubOAuthClientSecret: env.GITHUB_OAUTH_CLIENT_SECRET ?? '',
    oauthRedirectUri: env.OAUTH_REDIRECT_URI ?? `${env.ORCHESTRATOR_HOST ?? 'http://localhost:8080'}/auth/github/callback`,
    stubExternals,
  });
}
