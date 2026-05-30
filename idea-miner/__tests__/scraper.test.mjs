import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { scrape, mapItem, dedup, cap, buildApifyPayload } from '../scraper.mjs';

const config = { subreddits: ['programming', 'devops'], keywords: ['flaky test', 'slow ci'], max_posts_per_run: 50 };
// A post item in trudax/reddit-scraper-lite's output shape.
const litePost = (over = {}) => ({
  id: 't3_abc', parsedId: 'abc', url: 'https://www.reddit.com/r/programming/comments/abc/x/',
  username: 'devuser', title: 'CI is flaky', communityName: 'r/programming', parsedCommunityName: 'programming',
  body: 'our tests are flaky', upVotes: 12, createdAt: '2026-05-01T10:00:00.000Z', dataType: 'post', ...over,
});
const okFetch = (items) => async () => ({ ok: true, status: 200, json: async () => items });

// Feature: idea-miner, Property 1: Post field extraction is complete
test('Property 1: mapItem maps the Lite actor shape to all 7 Post fields; createdAt → unix seconds', () => {
  fc.assert(fc.property(
    fc.record({ id: fc.string({ minLength: 1 }), username: fc.string(), parsedCommunityName: fc.string(), upVotes: fc.integer(), createdAt: fc.date({ min: new Date('2000-01-01'), max: new Date('2030-01-01') }), url: fc.webUrl(), title: fc.string(), body: fc.string() }),
    (raw) => {
      const item = { ...raw, createdAt: raw.createdAt.toISOString(), dataType: 'post' };
      const p = mapItem(item);
      for (const k of ['id', 'author', 'subreddit', 'score', 'created_utc', 'permalink', 'body']) assert.ok(k in p);
      assert.equal(p.author, raw.username);
      assert.equal(p.subreddit, raw.parsedCommunityName);
      assert.equal(p.score, raw.upVotes);
      assert.equal(p.permalink, raw.url);
      assert.equal(p.created_utc, Math.floor(Date.parse(item.createdAt) / 1000));
      assert.equal(typeof p.created_utc, 'number');
    },
  ));
});

test('mapItem is tolerant of the generic actor shape too (author/score/created_utc/permalink)', () => {
  const p = mapItem({ id: 'x', author: 'a', subreddit: 's', score: 7, created_utc: 1700000000, permalink: '/r/s/x', body: 'b', dataType: 'post' });
  assert.equal(p.author, 'a'); assert.equal(p.score, 7); assert.equal(p.created_utc, 1700000000); assert.equal(p.subreddit, 's');
});

test('mapItem folds the title into body so keyword scoring/clustering sees it', () => {
  const p = mapItem(litePost({ title: 'slow ci pipeline', body: '' }));
  assert.match(p.body, /slow ci pipeline/);
});

// Feature: idea-miner, Property 2: Deduplication produces unique post ids
test('Property 2: dedup yields unique ids', () => {
  fc.assert(fc.property(fc.array(fc.record({ id: fc.string({ maxLength: 3 }) })), (rows) => {
    const ids = dedup(rows).map((r) => r.id);
    assert.equal(ids.length, new Set(ids).size);
  }));
});

// Feature: idea-miner, Property 3: Post count is capped at max_posts_per_run
test('Property 3: cap limits length to max_posts_per_run', () => {
  fc.assert(fc.property(fc.array(fc.record({ id: fc.string() })), fc.integer({ min: 0, max: 200 }), (posts, max) => {
    assert.ok(cap(posts, max).length <= max);
  }));
});

test('buildApifyPayload uses native keyword search and spreads maxItems across keywords', () => {
  const p = buildApifyPayload(config); // 2 keywords, max 50
  assert.deepEqual(p.searches, ['flaky test', 'slow ci']);
  assert.equal(p.searchPosts, true);
  assert.equal(p.sort, 'relevance');
  assert.equal(p.maxItems, 25); // ceil(50 / 2 keywords) — caps per-query billing
});

test('timeFilter maps window_days to the actor\'s coarse time bucket', () => {
  assert.equal(buildApifyPayload({ ...config, window_days: 5 }).time, 'week');
  assert.equal(buildApifyPayload({ ...config, window_days: 60 }).time, 'year');
});

test('buildApifyPayload prefers searchPhrases over static keywords', () => {
  const p = buildApifyPayload({ searchPhrases: ['notion ai', 'notion calendar'], max_posts_per_run: 50 });
  assert.deepEqual(p.searches, ['notion ai', 'notion calendar']);
});

test('buildApifyPayload scopes each search to a chosen subreddit (r/ stripped)', () => {
  const p = buildApifyPayload({ searchPhrases: ['notion ai'], subreddit: 'r/productivity', max_posts_per_run: 50 });
  assert.deepEqual(p.searches, ['notion ai subreddit:productivity']);
});

test('scrape post-filters results to the chosen subreddit (precision fix)', async () => {
  process.env.APIFY_TOKEN = 'tkn';
  const items = [
    litePost({ id: 't3_a', parsedCommunityName: 'productivity' }),
    litePost({ id: 't3_b', parsedCommunityName: 'Baking' }), // off-topic "flaky" pastry
  ];
  const out = await scrape({ searchPhrases: ['flaky'], subreddit: 'productivity', max_posts_per_run: 50 }, { fetchImpl: okFetch(items) });
  assert.equal(out.length, 1);
  assert.equal(out[0].subreddit, 'productivity');
});

test('missing APIFY_TOKEN throws before any HTTP call (Req 1.7)', async () => {
  const prev = process.env.APIFY_TOKEN; delete process.env.APIFY_TOKEN;
  let called = false;
  await assert.rejects(scrape(config, { fetchImpl: async () => { called = true; } }), /APIFY_TOKEN/);
  assert.equal(called, false);
  if (prev !== undefined) process.env.APIFY_TOKEN = prev;
});

test('request hits the practicaltools reddit-api endpoint with ?token= (Req 1.2)', async () => {
  process.env.APIFY_TOKEN = 'tkn';
  let url;
  await scrape(config, { fetchImpl: async (u) => { url = u; return { ok: true, status: 200, json: async () => [litePost()] }; } });
  assert.match(url, /api\.apify\.com\/v2\/acts\/practicaltools~apify-reddit-api\/run-sync-get-dataset-items/);
  assert.match(url, /token=tkn/);
});

test('HTTP 500 throws, no partial results (Req 1.6)', async () => {
  process.env.APIFY_TOKEN = 'tkn';
  await assert.rejects(scrape(config, { fetchImpl: async () => ({ ok: false, status: 500, json: async () => [] }) }), /500|Apify/);
});

test('zero results throws (Req 1.8)', async () => {
  process.env.APIFY_TOKEN = 'tkn';
  await assert.rejects(scrape(config, { fetchImpl: okFetch([]) }), /zero|no results|empty/i);
});

test('non-post dataType items (comments/communities) are filtered out', async () => {
  process.env.APIFY_TOKEN = 'tkn';
  const items = [
    litePost({ id: 't3_1' }),
    { id: 't1_c', dataType: 'comment', username: 'u', body: 'a comment' },
    { id: 't5_q', dataType: 'community', title: 'r/programming' },
  ];
  const out = await scrape(config, { fetchImpl: okFetch(items) });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 't3_1');
});

test('dedup + cap applied to a successful scrape', async () => {
  process.env.APIFY_TOKEN = 'tkn';
  const items = [litePost({ id: 't3_1' }), litePost({ id: 't3_1' }), litePost({ id: 't3_2' })];
  const out = await scrape({ ...config, max_posts_per_run: 1 }, { fetchImpl: okFetch(items) });
  assert.equal(out.length, 1);
});
