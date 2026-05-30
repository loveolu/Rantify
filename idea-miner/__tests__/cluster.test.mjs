import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { cluster } from '../cluster.mjs';

const sp = (over = {}) => ({ id: 'p', author: 'a', subreddit: 's', score: 1, created_utc: 1, permalink: '/', body: '', base_score: 1, keyword_boost: 0, final_score: 1, ...over });
const loose = { min_unique_authors: 1, min_subreddit_count: 1 };

// Feature: idea-miner, Property 8: Cluster membership follows regex patterns
test('Property 8: posts join the cluster their body matches (both → both)', () => {
  const posts = [
    sp({ id: '1', author: 'a1', subreddit: 'r1', body: 'this test is flaky' }),
    sp({ id: '2', author: 'a2', subreddit: 'r2', body: 'our slow ci pipeline takes ages' }),
    sp({ id: '3', author: 'a3', subreddit: 'r3', body: 'flaky and slow ci both' }),
  ];
  const clusters = cluster(posts, loose);
  const byName = Object.fromEntries(clusters.map((c) => [c.name, c.posts.map((p) => p.id)]));
  assert.ok(byName['flaky-tests'].includes('1') && byName['flaky-tests'].includes('3'));
  assert.ok(byName['slow-ci'].includes('2') && byName['slow-ci'].includes('3'));
});

// Feature: idea-miner, Property 9: Posts matching no pattern are excluded from all clusters
test('Property 9: non-matching posts appear in no cluster', () => {
  fc.assert(fc.property(fc.array(fc.constantFrom('hello world', 'unrelated text', 'database tuning'), { minLength: 1 }), (bodies) => {
    const posts = bodies.map((b, i) => sp({ id: `p${i}`, author: `a${i}`, subreddit: `r${i}`, body: b }));
    let clusters;
    try { clusters = cluster(posts, loose); } catch { clusters = []; }
    for (const c of clusters) assert.equal(c.posts.length, 0);
  }));
});

// Feature: idea-miner, Property 10: Under-represented clusters are dropped
test('Property 10: every surviving cluster meets both thresholds', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 5 }), (minAuthors, minSubs) => {
    const posts = Array.from({ length: 8 }, (_, i) => sp({ id: `p${i}`, author: `a${i % 6}`, subreddit: `r${i % 4}`, body: 'flaky intermittent' }));
    let clusters;
    try { clusters = cluster(posts, { min_unique_authors: minAuthors, min_subreddit_count: minSubs }); } catch { clusters = []; }
    for (const c of clusters) {
      assert.ok(c.uniqueAuthors >= minAuthors);
      assert.ok(c.subredditCount >= minSubs);
    }
  }));
});

test('all clusters below threshold → throws (Req 3.7)', () => {
  const posts = [sp({ body: 'flaky', author: 'a', subreddit: 'r' })];
  assert.throws(() => cluster(posts, { min_unique_authors: 5, min_subreddit_count: 2 }));
});

test('post matching both patterns lands in both clusters (Req 3.3)', () => {
  const posts = [
    sp({ id: '1', author: 'a1', subreddit: 'r1', body: 'flaky non-deterministic and slow ci minutes' }),
    sp({ id: '2', author: 'a2', subreddit: 'r2', body: 'flaky randomly fails; pipeline takes forever slow ci' }),
  ];
  const clusters = cluster(posts, loose);
  assert.equal(clusters.length, 2);
});

test('post matching neither pattern is silently excluded (Req 3.8)', () => {
  const posts = [
    sp({ id: '1', author: 'a1', subreddit: 'r1', body: 'flaky tests intermittent' }),
    sp({ id: '2', author: 'a2', subreddit: 'r2', body: 'completely unrelated' }),
  ];
  const clusters = cluster(posts, loose);
  const allIds = clusters.flatMap((c) => c.posts.map((p) => p.id));
  assert.ok(!allIds.includes('2'));
});
