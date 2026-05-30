/**
 * scraper.mjs — Apify Reddit scraper (SPEC.md §6.2; Idea Miner Requirement 1).
 * Throws (and makes no HTTP call) if APIFY_TOKEN is unset; throws on non-2xx, network
 * failure, or zero results — the pipeline aborts rather than writing a partial card.
 */

const ENDPOINT = 'https://api.apify.com/v2/acts/apify~reddit-scraper/run-sync-get-dataset-items';

/** @typedef {import('./scorer.mjs').Post} Post */

export function buildApifyPayload(config) {
  return {
    subreddits: config.subreddits,
    searchPhrases: config.keywords,
    maxItems: config.max_posts_per_run,
    type: 'posts',
  };
}

/** @returns {Post} */
export function mapItem(item) {
  return {
    id: item.id,
    author: item.author,
    subreddit: item.subreddit,
    score: item.score,
    created_utc: item.created_utc,
    permalink: item.permalink,
    body: item.selftext ?? item.body ?? '',
  };
}

export function dedup(posts) {
  const seen = new Set();
  const out = [];
  for (const p of posts) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

export const cap = (posts, max) => posts.slice(0, Math.max(0, max));

/**
 * @param {object} config
 * @param {{fetchImpl?: typeof fetch}} [deps]
 * @returns {Promise<Post[]>}
 */
export async function scrape(config, { fetchImpl = globalThis.fetch } = {}) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN is required to scrape Reddit (SPEC §13) — aborting, no request made');

  const url = `${ENDPOINT}?token=${encodeURIComponent(token)}`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildApifyPayload(config)),
    });
  } catch (err) {
    console.error('[idea-miner] Apify request failed:', err.message);
    throw new Error(`Apify request failed: ${err.message}`);
  }
  if (!res.ok) {
    console.error(`[idea-miner] Apify returned HTTP ${res.status}`);
    throw new Error(`Apify returned HTTP ${res.status}`);
  }

  const items = await res.json();
  if (!Array.isArray(items) || items.length === 0) {
    console.error('[idea-miner] Apify returned zero results — aborting run');
    throw new Error('Apify returned zero results');
  }

  return cap(dedup(items.map(mapItem)), config.max_posts_per_run);
}
