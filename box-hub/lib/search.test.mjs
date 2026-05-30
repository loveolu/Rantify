import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicate, listCardsByStatus } from './search.mjs';

function clientReturning(entries) {
  return { calls: [], search: { searchForContent: async (q) => { return { entries }; } } };
}
const card = (cardId, status, theme, daysAgo = 0) => ({
  id: `file_${cardId}`, type: 'file',
  metadata: { enterprise: { devtool_build_card: { card_id: cardId, status, theme, '$parent': 'x' } } },
  modified_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
});

test('findDuplicate returns matching-theme, non-failed cards within the window', async () => {
  const client = clientReturning([
    card('a', 'inbox', 'testing-ci', 1),
    card('b', 'failed', 'testing-ci', 1),     // excluded: failed
    card('c', 'inbox', 'testing-ci', 30),     // excluded: out of 7d window
  ]);
  const out = await findDuplicate(client, { theme: 'testing-ci', withinDays: 7 });
  const ids = out.map((r) => r.cardId);
  assert.deepEqual(ids, ['a']);
  assert.deepEqual(out[0], { fileId: 'file_a', cardId: 'a' });
});

test('listCardsByStatus returns only cards in the requested status', async () => {
  const client = clientReturning([
    card('a', 'ready-for-build', 'testing-ci'),
    card('b', 'building', 'testing-ci'),
  ]);
  const out = await listCardsByStatus(client, 'ready-for-build');
  assert.deepEqual(out.map((r) => r.cardId), ['a']);
});

test('empty search results yield an empty array', async () => {
  assert.deepEqual(await findDuplicate(clientReturning([]), { theme: 't', withinDays: 7 }), []);
});
