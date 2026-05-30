/**
 * index.mjs — orchestrator bootstrap (SPEC.md §8.1).
 *
 * createOrchestrator() wires the lifecycle core to its phase functions and external-tool
 * wrappers over a single injected run() seam. main() loads config, picks the real or stub
 * run(), selects the Box client, and starts both triggers (webhook server + poller).
 *
 * Mock → real Box is the one-line swap on the marked import below (Person B's client).
 */

import path from 'node:path';
import { loadConfig } from './config.mjs';
import { run as realRun } from './run.mjs';
import { makeStubRun } from './stub-run.mjs';
import { createGitHub } from './git-github.mjs';
import { createClaudeCode } from './claude-code.mjs';
import { createBuildRunner } from './build-runner.mjs';
import { handleCard } from './lifecycle.mjs';
import { phase1Scaffold } from './phase1-scaffold.mjs';
import { phase2Refine } from './phase2-refine.mjs';
import { createWebhookServer } from './server.mjs';
import { createPoller } from './poller.mjs';
import { guardConcurrent } from './in-flight.mjs';
import { createTokenStore } from './auth/token-store.mjs';
import { createGitHubOAuth } from './auth/github-oauth.mjs';
import { createApi } from './api.mjs';

const REPO_ROOT = path.join(import.meta.dirname, '..');
const DEFAULT_PROMPTS = path.join(REPO_ROOT, 'specs', 'devtool-loop', 'prompts');

/**
 * @param {{box:any, config:any, run?:Function, workRoot:string, promptsDir?:string,
 *          tokenStore?:ReturnType<typeof createTokenStore>}} o
 */
export function createOrchestrator({ box, config, run = realRun, workRoot, promptsDir = DEFAULT_PROMPTS, tokenStore }) {
  const getToken = tokenStore ? (email) => tokenStore.get(email) : undefined;
  const gh = createGitHub({ run, token: config.githubToken, org: config.githubOrg, visibility: config.githubRepoVisibility, getToken });
  const cc = createClaudeCode({ run, modelId: config.bedrockModelId, region: config.bedrockRegion });
  const build = createBuildRunner({ run });

  const phase1 = (fileId, meta) => phase1Scaffold(fileId, meta, { box, gh, cc, build, workRoot, scaffoldPromptPath: path.join(promptsDir, 'scaffold.md') });
  const phase2 = (fileId, meta) => phase2Refine(fileId, meta, { box, gh, cc, build, workRoot, refinePromptPath: path.join(promptsDir, 'refine.md') });

  const onCard = guardConcurrent((fileId) => handleCard(fileId, { box, phase1, phase2 }));

  return { onCard, phase1, phase2 };
}

async function main() {
  const config = loadConfig(process.env);
  const run = config.stubExternals ? makeStubRun() : realRun;
  const workRoot = process.env.ORCH_WORK_ROOT ?? path.join(REPO_ROOT, '.orch-work');

  const { RealBoxClient } = await import('../box-hub/box-client-real.mjs');
  const box = new RealBoxClient();

  const tokenStore = createTokenStore();
  const { onCard } = createOrchestrator({ box, config, run, workRoot, tokenStore });

  let githubOAuth;
  if (config.githubOAuthClientId && config.githubOAuthClientSecret) {
    const oauth = createGitHubOAuth({
      clientId: config.githubOAuthClientId,
      clientSecret: config.githubOAuthClientSecret,
      tokenStore,
      redirectUri: config.oauthRedirectUri,
    });
    githubOAuth = oauth;
    console.log(`[orchestrator] GitHub OAuth enabled (redirect: ${config.oauthRedirectUri})`);
  }

  if (typeof box.onWebhook === 'function') box.onWebhook((event) => onCard(event.source.id));
  const poller = createPoller({ box, onCard });
  poller.start(30_000);

  const api = createApi({ box, tokenStore });
  const port = Number(process.env.PORT ?? 8080);
  createWebhookServer({ config, onEvent: onCard, githubOAuth, api }).listen(port, () =>
    console.log(`[orchestrator] webhook server on :${port}, poller every 30s, stub=${config.stubExternals}`));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('index.mjs')) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
