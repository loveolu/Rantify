/**
 * index.mjs — Idea Miner pipeline entry point (SPEC.md §6; Requirement 6).
 * Requires Node 20.11+ (import.meta.dirname). Wires scrape → score → cluster → generate →
 * upload. main() validates env + loads config before any external call, runs the pipeline,
 * and maps success/failure to exit code 0/1. Secrets are referenced by name only, never logged.
 */

import fs from 'node:fs';
import path from 'node:path';
import { scrape } from './scraper.mjs';
import { score } from './scorer.mjs';
import { cluster } from './cluster.mjs';
import { generate } from './generator.mjs';
import { upload } from './uploader.mjs';
import { FileSystemBoxClient } from '../contracts/box-client-mock.mjs';

const REPO_ROOT = path.join(import.meta.dirname, '..');
const REQUIRED_ENV = ['APIFY_TOKEN', 'AWS_REGION'];

/** Throw (naming every missing variable) before any network call. Never logs values. */
export function assertEnv(env = process.env) {
  const missing = REQUIRED_ENV.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing required env var(s): ${missing.join(', ')} (SPEC §13)`);
}

function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch { throw new Error(`config file not found: ${file}`); }
  try { return JSON.parse(raw); }
  catch (err) { throw new Error(`malformed JSON in ${file}: ${err.message}`); }
}

/** @returns {{config:object, themes:{id:string}[]}} */
export function loadConfigs({ configPath = path.join(REPO_ROOT, 'config', 'idea-miner.json'), themesPath = path.join(REPO_ROOT, 'config', 'themes.json') } = {}) {
  const config = readJson(configPath);
  const themesFile = readJson(themesPath);
  return { config, themes: themesFile.themes ?? themesFile };
}

/**
 * Run the pipeline. External stages are injectable so the suite never hits the network.
 * @returns {Promise<Array>} per-cluster upload results
 */
export async function runPipeline({ config, themes, boxClient, scrapeImpl = scrape, scoreImpl = score, clusterImpl = cluster, generateImpl = generate, uploadImpl = upload }) {
  const posts = await scrapeImpl(config);
  const scored = scoreImpl(posts, config);
  const clusters = clusterImpl(scored, config);
  const results = [];
  for (const c of clusters) {
    const specMarkdown = await generateImpl(c, config, themes);
    results.push(await uploadImpl(specMarkdown, boxClient));
  }
  return results;
}

async function main() {
  try {
    assertEnv(process.env);
    const { config, themes } = loadConfigs();
    const boxClient = new FileSystemBoxClient();
    const results = await runPipeline({ config, themes, boxClient });
    console.log(`[idea-miner] done — ${results.length} cluster(s) processed`);
    process.exit(0);
  } catch (err) {
    console.error(`[idea-miner] pipeline failed: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith(`idea-miner${path.sep}index.mjs`)) {
  main();
}
