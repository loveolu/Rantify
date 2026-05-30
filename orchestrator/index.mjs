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

const REPO_ROOT = path.join(import.meta.dirname, '..');
const DEFAULT_PROMPTS = path.join(REPO_ROOT, 'specs', 'devtool-loop', 'prompts');

/**
 * @param {{box:any, config:any, run?:Function, workRoot:string, promptsDir?:string}} o
 */
export function createOrchestrator({ box, config, run = realRun, workRoot, promptsDir = DEFAULT_PROMPTS }) {
  const gh = createGitHub({ run, token: config.githubToken, org: config.githubOrg, visibility: config.githubRepoVisibility });
  const cc = createClaudeCode({ run, apiKey: config.anthropicApiKey });
  const build = createBuildRunner({ run });

  const phase1 = (fileId, meta) => phase1Scaffold(fileId, meta, { box, gh, cc, build, workRoot, scaffoldPromptPath: path.join(promptsDir, 'scaffold.md') });
  const phase2 = (fileId, meta) => phase2Refine(fileId, meta, { box, gh, cc, build, workRoot, refinePromptPath: path.join(promptsDir, 'refine.md') });
  const onCard = (fileId) => handleCard(fileId, { box, phase1, phase2 });

  return { onCard, phase1, phase2 };
}

async function main() {
  const config = loadConfig(process.env);
  const run = config.stubExternals ? makeStubRun() : realRun;
  const workRoot = process.env.ORCH_WORK_ROOT ?? path.join(REPO_ROOT, '.orch-work');

  // ── Box client: swap this import to Person B's RealBoxClient to go live ──
  const { FileSystemBoxClient } = await import('../contracts/box-client-mock.mjs');
  const box = new FileSystemBoxClient();

  const { onCard } = createOrchestrator({ box, config, run, workRoot });

  if (typeof box.onWebhook === 'function') box.onWebhook((event) => onCard(event.source.id));
  const poller = createPoller({ box, onCard });
  poller.start(30_000);

  const port = Number(process.env.PORT ?? 8080);
  createWebhookServer({ config, onEvent: onCard }).listen(port, () =>
    console.log(`[orchestrator] webhook server on :${port}, poller every 30s, stub=${config.stubExternals}`));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('index.mjs')) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
