/**
 * cluster.mjs — keyword clustering of scored posts (SPEC.md §6.4; Idea Miner Requirement 3).
 * A post may belong to both clusters; posts matching no pattern are excluded. Clusters below
 * the unique-author / subreddit-count thresholds are dropped; if none survive, throws.
 */

/**
 * @typedef {Object} Cluster
 * @property {string} name @property {import('./scorer.mjs').ScoredPost[]} posts
 * @property {number} uniqueAuthors @property {number} subredditCount
 */

const PATTERNS = {
  'flaky-tests': /flaky|intermittent|randomly fails|non-deterministic/i,
  'slow-ci': /slow ci|ci takes|ci minutes|pipeline takes/i,
};

function assignToClusters(posts) {
  const map = new Map(Object.keys(PATTERNS).map((name) => [name, []]));
  for (const post of posts) {
    for (const [name, re] of Object.entries(PATTERNS)) {
      if (re.test(post.body ?? '')) map.get(name).push(post);
    }
  }
  return map;
}

function buildCluster(name, posts) {
  return {
    name,
    posts,
    uniqueAuthors: new Set(posts.map((p) => p.author)).size,
    subredditCount: new Set(posts.map((p) => p.subreddit)).size,
  };
}

function meetsThresholds(c, config) {
  return c.uniqueAuthors >= config.min_unique_authors && c.subredditCount >= config.min_subreddit_count;
}

/**
 * @param {import('./scorer.mjs').ScoredPost[]} scoredPosts
 * @param {{min_unique_authors:number, min_subreddit_count:number}} config
 * @returns {Cluster[]}
 */
export function cluster(scoredPosts, config) {
  const assigned = assignToClusters(scoredPosts);
  const built = [...assigned.entries()]
    .filter(([, posts]) => posts.length > 0)
    .map(([name, posts]) => buildCluster(name, posts));
  const surviving = built.filter((c) => meetsThresholds(c, config));
  if (surviving.length === 0) {
    console.error('[idea-miner] no clusters met thresholds (unique authors / subreddit count) — aborting run');
    throw new Error('no clusters met the configured thresholds');
  }
  return surviving;
}
