/**
 * scraper.mjs — Apify Reddit scraper (SPEC.md §6.2; Idea Miner Requirement 1).
 *
 * Targets the `practicaltools/apify-reddit-api` actor — fast (~3s), cheap ($2/1k), and not
 * IP-blocked (it uses Reddit's API rather than proxy-scraping the public site, so it dodges
 * the 403 wall that blocks the proxy-based scrapers). Input is the actor's native keyword
 * search; output is mapped from its shape (username/upVotes/createdAt/url/parsedCommunityName)
 * into our Post type. mapItem stays tolerant of the generic author/score/created_utc/permalink
 * shape too. createdAt (ISO) → unix seconds because the scorer treats created_utc as seconds.
 *
 * Cost control: maxItems is PER search query, so we divide max_posts_per_run across the
 * keywords and cap() the deduped total — keeping a run near max_posts_per_run items billed.
 *
 * Throws (no HTTP) if APIFY_TOKEN is unset; throws on non-2xx, network failure, or zero
 * usable posts — the pipeline aborts rather than writing a partial card.
 */

const ENDPOINT = 'https://api.apify.com/v2/acts/practicaltools~apify-reddit-api/run-sync-get-dataset-items';

/** @typedef {import('./scorer.mjs').Post} Post */

/** window_days → the actor's coarse `time` bucket (the scorer applies the exact window after). */
export function timeFilter(windowDays) {
  if (windowDays <= 1) return 'day';
  if (windowDays <= 7) return 'week';
  if (windowDays <= 31) return 'month';
  if (windowDays <= 366) return 'year';
  return 'all';
}

export function buildApifyPayload(config) {
  const keywords = config.keywords ?? [];
  // maxItems is per-query; spread the budget across keywords so total billed ≈ max_posts_per_run.
  const perQuery = Math.max(1, Math.ceil(config.max_posts_per_run / Math.max(1, keywords.length)));
  return {
    searches: keywords,
    searchPosts: true,
    sort: 'relevance',
    time: timeFilter(config.window_days ?? 365),
    maxItems: perQuery,
    skipComments: true,
  };
}

/** ISO string or unix-seconds number → unix seconds (NaN if unparseable, so it gets dropped). */
function toSeconds(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Math.floor(Date.parse(v) / 1000);
  return NaN;
}

/** @returns {Post} */
export function mapItem(item) {
  const community = item.parsedCommunityName
    ?? (typeof item.communityName === 'string' ? item.communityName.replace(/^r\//, '') : undefined)
    ?? item.subreddit;
  const bodyText = item.body ?? item.selftext ?? '';
  return {
    id: item.id ?? item.parsedId,
    author: item.username ?? item.author,
    subreddit: community,
    score: item.upVotes ?? item.score ?? 0,
    created_utc: toSeconds(item.createdAt ?? item.created_utc),
    permalink: item.url ?? item.permalink,
    // Fold the title in so keyword scoring/clustering sees title-only posts (common on Reddit).
    body: [item.title, bodyText].filter(Boolean).join('\n').trim(),
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

/** Keep only post items (the Lite actor can also emit comments/communities/users). */
const isPost = (item) => item.dataType === undefined || item.dataType === 'post';

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

  const posts = cap(dedup(items.filter(isPost).map(mapItem).filter((p) => p.id)), config.max_posts_per_run);
  if (posts.length === 0) {
    console.error('[idea-miner] Apify returned no post items — aborting run');
    throw new Error('Apify returned zero post results');
  }
  return posts;
}
