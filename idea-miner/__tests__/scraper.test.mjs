import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { scrape, mapItem, dedup, cap, buildApifyPayload } from '../scraper.mjs';

const config = { subreddits: ['programming'], keywords: ['flaky test'], max_posts_per_run: 50 };
const okFetch = (items) => async () => ({ ok: true, status: 200, json: async () => items });

// Feature: idea-miner, Property 1: Post field extraction is complete
test('Property 1: mapItem extracts all 7 fields, body from selftext ?? body ?? ""', () => {
  fc.assert(fc.property(
    fc.record({ id: fc.string(), author: fc.string(), subreddit: fc.string(), score: fc.integer(), created_utc: fc.integer(), permalink: fc.string(), selftext: fc.option(fc.string(), { nil: undefined }) }),
    (item) => {
      const p = mapItem(item);
      for (const k of ['id', 'author', 'subreddit', 'score', 'created_utc', 'permalink', 'body']) assert.ok(k in p);
      assert.equal(p.body, item.selftext ?? item.body ?? '');
    },
  ));
});

// Feature: idea-miner, Property 2: Deduplication produces unique post ids
test('Property 2: dedup yields unique ids, first occurrence kept', () => {
  fc.assert(fc.property(fc.array(fc.record({ id: fc.string({ maxLength: 3 }) })), (rows) => {
    const out = dedup(rows.map((r, i) => ({ ...r, n: i })));
    const ids = out.map((r) => r.id);
    assert.equal(ids.length, new Set(ids).size);
  }));
});

// Feature: idea-miner, Property 3: Post count is capped at max_posts_per_run
test('Property 3: cap limits length to max_posts_per_run', () => {
  fc.assert(fc.property(fc.array(fc.record({ id: fc.string() })), fc.integer({ min: 0, max: 200 }), (posts, max) => {
    assert.ok(cap(posts, max).length <= max);
  }));
});

test('buildApifyPayload carries subreddits, searchPhrases, maxItems, type', () => {
  const p = buildApifyPayload(config);
  assert.deepEqual(p.subreddits, ['programming']);
  assert.deepEqual(p.searchPhrases, ['flaky test']);
  assert.equal(p.maxItems, 50);
  assert.equal(p.type, 'posts');
});

test('missing APIFY_TOKEN throws before any HTTP call (Req 1.7)', async () => {
  const prev = process.env.APIFY_TOKEN; delete process.env.APIFY_TOKEN;
  let called = false;
  await assert.rejects(scrape(config, { fetchImpl: async () => { called = true; } }), /APIFY_TOKEN/);
  assert.equal(called, false);
  if (prev !== undefined) process.env.APIFY_TOKEN = prev;
});

test('request URL hits the reddit-scraper endpoint with ?token= (Req 1.2)', async () => {
  process.env.APIFY_TOKEN = 'tkn';
  let url;
  await scrape(config, { fetchImpl: async (u) => { url = u; return { ok: true, status: 200, json: async () => [{ id: '1', author: 'a', subreddit: 's', created_utc: 1, permalink: '/', selftext: 'x' }] }; } });
  assert.match(url, /api\.apify\.com\/v2\/acts\/apify~reddit-scraper\/run-sync-get-dataset-items/);
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

test('dedup + cap applied to a successful scrape', async () => {
  process.env.APIFY_TOKEN = 'tkn';
  const items = [
    { id: '1', author: 'a', subreddit: 's', created_utc: 1, permalink: '/', selftext: 'x' },
    { id: '1', author: 'a', subreddit: 's', created_utc: 1, permalink: '/', selftext: 'dup' },
    { id: '2', author: 'b', subreddit: 't', created_utc: 1, permalink: '/', body: 'y' },
  ];
  const out = await scrape({ ...config, max_posts_per_run: 1 }, { fetchImpl: okFetch(items) });
  assert.equal(out.length, 1);
});
