/**
 * scorer.mjs — score and filter Reddit posts (SPEC.md §6.3; Idea Miner Requirement 2).
 *
 *   base_score    = log1p(max(0, upvotes))          # dampen virality, clamp negatives
 *   keyword_boost = +0.20 hours|days|blocked|prod|deploy
 *                 + 0.10 monorepo|github actions|ci minutes
 *                 + 0.15 if created within the last 30 days
 *   final_score   = base_score * (1 + keyword_boost)
 *   DROP if final_score < 1.0 OR age > window_days OR timestamp invalid
 */

/**
 * @typedef {Object} Post
 * @property {string} id @property {string} author @property {string} subreddit
 * @property {number} score @property {number} created_utc @property {string} permalink @property {string} body
 */
/**
 * @typedef {Post & {base_score:number, keyword_boost:number, final_score:number}} ScoredPost
 */

const DAY_MS = 86_400_000;
const URGENCY = /hours|days|blocked|prod|deploy/i;
const STACK = /monorepo|github actions|ci minutes/i;

export function isValidTimestamp(created_utc) {
  return typeof created_utc === 'number' && Number.isFinite(created_utc);
}

export function computeBaseScore(upvotes) {
  return Math.log1p(Math.max(0, upvotes));
}

export function computeKeywordBoost(body, created_utc) {
  const text = body ?? '';
  let boost = 0;
  if (URGENCY.test(text)) boost += 0.20;
  if (STACK.test(text)) boost += 0.10;
  if (isValidTimestamp(created_utc) && (Date.now() - created_utc * 1000) < 30 * DAY_MS) boost += 0.15;
  return boost;
}

/**
 * @param {Post[]} posts
 * @param {{window_days:number}} config
 * @returns {ScoredPost[]}
 */
export function score(posts, config) {
  const windowMs = config.window_days * DAY_MS;
  const out = [];
  for (const p of posts) {
    if (!isValidTimestamp(p.created_utc)) continue;
    const ageMs = Date.now() - p.created_utc * 1000;
    if (ageMs > windowMs) continue;
    const base_score = computeBaseScore(p.score);
    const keyword_boost = computeKeywordBoost(p.body, p.created_utc);
    const final_score = base_score * (1 + keyword_boost);
    if (final_score < 1.0) continue;
    out.push({ ...p, base_score, keyword_boost, final_score });
  }
  return out;
}
