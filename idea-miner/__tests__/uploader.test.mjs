import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { upload, extractFrontMatter, buildMetadata, withExponentialBackoff } from '../uploader.mjs';

const specFor = (id, theme, score) => `---\nid: "${id}"\ntheme: "${theme}"\nsignal_strength:\n  score: ${score}\n---\n\n# x\n## Acceptance Criteria\n- [ ] ok\n`;
const noSleep = async () => {};

function fakeBox({ dupes = [], uploadResult = { fileId: 'file_1', cardId: 'c1' }, failTimes = 0 } = {}) {
  const calls = [];
  let fails = failTimes;
  return {
    calls,
    async findDuplicate(q) { calls.push(['findDuplicate', q]); return dupes; },
    async uploadCard(card) { calls.push(['uploadCard', card]); if (fails-- > 0) throw new Error('box 503'); return uploadResult; },
  };
}

// Feature: idea-miner, Property 13: Upload metadata is correctly derived from the Build Card
test('Property 13: metadata derives status/theme/pain_score/card_id, builder fields null', () => {
  const safeTheme = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,20}$/);
  fc.assert(fc.property(fc.uuid(), safeTheme, fc.float({ min: 0, max: 1, noNaN: true }), (id, theme, score) => {
    const fm = extractFrontMatter(specFor(id, theme, score));
    const m = buildMetadata(fm);
    assert.equal(m.status, 'inbox');
    assert.equal(m.theme, theme);
    assert.equal(m.pain_score, score);
    assert.equal(m.card_id, id);
    assert.equal(m.builder_session_id, null);
    assert.equal(m.repo_url, null);
    assert.equal(m.pr_url, null);
  }));
});

// Feature: idea-miner, Property 14: Exponential backoff delays follow the correct sequence
test('Property 14: backoff delays are 1000,2000,4000 capped at 8000', async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (failCount) => {
    const delays = [];
    const sleep = async (ms) => { delays.push(ms); };
    let fails = failCount;
    const fn = async () => { if (fails-- > 0) throw new Error('x'); return 'ok'; };
    try { await withExponentialBackoff(fn, 3, 1000, sleep); } catch { /* exhausted */ }
    assert.deepEqual(delays, [1000, 2000, 4000].slice(0, Math.min(failCount, 3)));
    assert.ok(delays.every((d) => d <= 8000));
  }));
});

test('findDuplicate is called before uploadCard (Req 5.1)', async () => {
  const box = fakeBox();
  await upload(specFor('11111111-1111-4111-8111-111111111111', 'testing-ci', 0.5), box, { sleep: noSleep });
  assert.equal(box.calls[0][0], 'findDuplicate');
  assert.ok(box.calls.some((c) => c[0] === 'uploadCard'));
});

test('a duplicate suppresses the upload (Req 5.2)', async () => {
  const box = fakeBox({ dupes: [{ fileId: 'f', cardId: 'c' }] });
  const r = await upload(specFor('11111111-1111-4111-8111-111111111111', 'testing-ci', 0.5), box, { sleep: noSleep });
  assert.equal(r, 'duplicate');
  assert.ok(!box.calls.some((c) => c[0] === 'uploadCard'));
});

test('success returns a CardRef (Req 5.5)', async () => {
  const box = fakeBox({ uploadResult: { fileId: 'file_9', cardId: 'c9' } });
  const r = await upload(specFor('11111111-1111-4111-8111-111111111111', 'testing-ci', 0.5), box, { sleep: noSleep });
  assert.deepEqual(r, { fileId: 'file_9', cardId: 'c9' });
});

test('all retries fail → writes failed-cards/{cardId}.md, does not throw (Req 5.7)', async () => {
  const failedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'failed-'));
  const box = fakeBox({ failTimes: 99 });
  const id = '22222222-2222-4222-8222-222222222222';
  const r = await upload(specFor(id, 'testing-ci', 0.5), box, { sleep: noSleep, failedDir });
  assert.notEqual(r, undefined);
  assert.ok(fs.existsSync(path.join(failedDir, `${id}.md`)));
  fs.rmSync(failedDir, { recursive: true, force: true });
});

test('only findDuplicate and uploadCard are called on the box client (Req 5.8)', async () => {
  const box = fakeBox();
  await upload(specFor('33333333-3333-4333-8333-333333333333', 'testing-ci', 0.5), box, { sleep: noSleep });
  assert.ok(box.calls.every((c) => c[0] === 'findDuplicate' || c[0] === 'uploadCard'));
});
