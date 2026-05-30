/**
 * uploader.mjs — upload a Build Card to Box with de-dup + backoff (SPEC.md §6.6; Req 5).
 *
 * De-dups via findDuplicate before writing; uploads with exponential backoff (1s/2s/4s,
 * capped 8s); on exhausted retries writes failed-cards/{cardId}.md and absorbs the error
 * (never throws). Touches ONLY findDuplicate and uploadCard on the BoxClient.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

/** @typedef {import('../contracts/box-client.mjs').CardMetadata} CardMetadata */

export function extractFrontMatter(specMarkdown) {
  const parts = String(specMarkdown).split(/^---\s*$/m);
  const fm = yaml.load(parts[1] ?? '') ?? {};
  return { id: fm.id, theme: fm.theme, signal_strength: fm.signal_strength ?? {} };
}

export function buildMetadata(frontMatter) {
  return {
    status: 'inbox',
    theme: frontMatter.theme,
    pain_score: frontMatter.signal_strength?.score,
    card_id: frontMatter.id,
    builder_session_id: null,
    repo_url: null,
    pr_url: null,
  };
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run fn with `maxRetries` retries; delay before retry N = min(base*2^(N-1), 8000). */
export async function withExponentialBackoff(fn, maxRetries, baseDelayMs, sleep = defaultSleep) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), 8000));
    try { return await fn(); } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

function writeFailedCard(failedDir, cardId, specMarkdown) {
  fs.mkdirSync(failedDir, { recursive: true });
  const dest = path.join(failedDir, `${cardId}.md`);
  fs.writeFileSync(dest, specMarkdown);
  console.error(`[idea-miner] upload failed; wrote fallback ${dest}`);
}

/**
 * @param {string} specMarkdown
 * @param {{findDuplicate:Function, uploadCard:Function}} boxClient
 * @param {{sleep?:Function, failedDir?:string}} [deps]
 * @returns {Promise<{fileId:string,cardId:string}|'duplicate'|'failed'>}
 */
export async function upload(specMarkdown, boxClient, { sleep = defaultSleep, failedDir = 'failed-cards' } = {}) {
  const fm = extractFrontMatter(specMarkdown);

  const dupes = await boxClient.findDuplicate({ theme: fm.theme, withinDays: 7 });
  if (Array.isArray(dupes) && dupes.length > 0) {
    console.log(`[idea-miner] duplicate suppressed (theme=${fm.theme}): ${dupes.map((d) => d.cardId).join(', ')}`);
    return 'duplicate';
  }

  const metadata = buildMetadata(fm);
  try {
    const ref = await withExponentialBackoff(
      () => boxClient.uploadCard({ cardId: fm.id, specMarkdown, metadata }), 3, 1000, sleep,
    );
    console.log(`[idea-miner] uploaded card fileId=${ref.fileId} cardId=${ref.cardId}`);
    return ref;
  } catch (err) {
    console.error(`[idea-miner] upload exhausted retries for ${fm.id}: ${err.message}`);
    writeFailedCard(failedDir, fm.id, specMarkdown);
    return 'failed';
  }
}
