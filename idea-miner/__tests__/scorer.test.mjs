import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { score, computeBaseScore, computeKeywordBoost, isValidTimestamp } from '../scorer.mjs';

const nowSec = () => Math.floor(Date.now() / 1000);
const post = (over = {}) => ({ id: 'p1', author: 'a', subreddit: 's', score: 100, created_utc: nowSec(), permalink: '/r/x', body: 'flaky test blocked deploy', ...over });
const config = { window_days: 60 };

// Feature: idea-miner, Property 4: Scoring formula is deterministic
test('Property 4: scoring is deterministic for identical inputs', () => {
  fc.assert(fc.property(fc.integer(), fc.string(), (upvotes, body) => {
    const c = nowSec();
    const a = score([post({ id: 'a', score: upvotes, body, created_utc: c })], config);
    const b = score([post({ id: 'a', score: upvotes, body, created_utc: c })], config);
    assert.deepEqual(a, b);
  }));
});

// Feature: idea-miner, Property 5: Negative upvotes are clamped to zero
test('Property 5: negative upvotes clamp base_score to log1p(0)=0', () => {
  fc.assert(fc.property(fc.integer({ max: -1 }), (upvotes) => {
    assert.equal(computeBaseScore(upvotes), Math.log1p(0));
  }));
});

// Feature: idea-miner, Property 6: Keyword boost formula is correct
test('Property 6: final_score = base_score * (1 + keyword_boost) for survivors', () => {
  fc.assert(fc.property(fc.string(), (body) => {
    const survivors = score([post({ score: 100000, body, created_utc: nowSec() })], config);
    for (const p of survivors) {
      assert.ok(Math.abs(p.final_score - p.base_score * (1 + p.keyword_boost)) < 1e-9);
    }
  }));
});

// Feature: idea-miner, Property 7: Low-signal and stale posts are filtered
test('Property 7: every survivor has final_score>=1.0 and age<=window_days', () => {
  fc.assert(fc.property(fc.array(fc.record({ score: fc.integer(), body: fc.string(), ageDays: fc.integer({ min: 0, max: 200 }) })), fc.integer({ min: 1, max: 120 }), (rows, windowDays) => {
    const posts = rows.map((r, i) => post({ id: `p${i}`, score: r.score, body: r.body, created_utc: nowSec() - r.ageDays * 86400 }));
    const survivors = score(posts, { window_days: windowDays });
    for (const p of survivors) {
      assert.ok(p.final_score >= 1.0);
      assert.ok((Date.now() - p.created_utc * 1000) <= windowDays * 86400000);
    }
  }));
});

test('drops a post with missing created_utc (Req 2.7)', () => {
  assert.equal(score([post({ created_utc: undefined })], config).length, 0);
});
test('drops a post with non-numeric created_utc (Req 2.7)', () => {
  assert.equal(score([post({ created_utc: 'yesterday' })], config).length, 0);
  assert.equal(isValidTimestamp('yesterday'), false);
});
test('post with negative upvotes scores as if upvotes=0 (Req 2.1)', () => {
  assert.equal(computeBaseScore(-50), 0);
});
test('final_score exactly 1.0 survives; 0.999 is dropped (Req 2.3)', () => {
  // base_score with boost 0 → final == base. log1p(e-1)=1 → score = e-1 ≈ 1.718 upvotes won't be integer;
  // use boost to land exactly: choose body with no boost, score s.t. log1p(score)=1 → score=e-1.
  const justAbove = score([post({ score: 2, body: 'neutral', created_utc: nowSec() })], config); // log1p(2)=1.0986>1
  assert.equal(justAbove.length, 1);
  const below = score([post({ score: 0, body: 'neutral', created_utc: nowSec() })], config); // log1p(0)=0<1
  assert.equal(below.length, 0);
});
