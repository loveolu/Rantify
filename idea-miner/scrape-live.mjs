/**
 * scrape-live.mjs — LIVE smoke test for the Apify Reddit scraper ONLY (SPEC §6.2).
 *
 *   APIFY_TOKEN=apify_api_xxx node idea-miner/scrape-live.mjs
 *
 * Makes one real Apify call to practicaltools/apify-reddit-api using the keywords/subreddits
 * in config/idea-miner.json, then prints how many posts came back plus a few samples.
 * It does NOT score, cluster, generate, or upload — so it needs no AWS/Bedrock or Box creds.
 * Exits 0 if posts are returned, 1 on any failure (missing token, HTTP error, zero results).
 */

import path from 'node:path';
import { scrape } from './scraper.mjs';
import { loadConfigs } from './index.mjs';

// Auto-load repo-root .env so APIFY_TOKEN is picked up without a shell wrapper (cross-platform).
try { process.loadEnvFile(path.join(import.meta.dirname, '..', '.env')); } catch { /* no .env file — rely on the ambient environment */ }

if (!process.env.APIFY_TOKEN) {
  console.error('Set APIFY_TOKEN first, e.g.  APIFY_TOKEN=apify_api_xxx node idea-miner/scrape-live.mjs');
  process.exit(1);
}

try {
  const { config } = loadConfigs();
  console.log(`[scrape-live] keywords=${config.keywords.length} max_posts_per_run=${config.max_posts_per_run} window_days=${config.window_days}`);
  console.time('[scrape-live] apify call');
  const posts = await scrape(config);
  console.timeEnd('[scrape-live] apify call');

  console.log(`\n✅ Apify returned ${posts.length} usable post(s). Sample:\n`);
  for (const p of posts.slice(0, 5)) {
    const when = Number.isFinite(p.created_utc) ? new Date(p.created_utc * 1000).toISOString().slice(0, 10) : '??';
    console.log(`  r/${p.subreddit}  ↑${p.score}  ${when}  u/${p.author}`);
    console.log(`    ${String(p.body).replace(/\s+/g, ' ').slice(0, 100)}`);
  }
  process.exit(0);
} catch (err) {
  console.error(`\n❌ Live scrape failed: ${err.message}`);
  process.exit(1);
}
