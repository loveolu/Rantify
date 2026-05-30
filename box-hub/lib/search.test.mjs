import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicate, listCardsByStatus, listCardsWithMetadata } from './search.mjs';

function clientReturning(entries) {
  return { calls: [], search: { searchForContent: async (q) => { return { entries }; } } };
}

// Mirror the real Box `searchForContent` response shape: metadata is wrapped at
// metadata.extraData.<scope>.<template>.extraData, with $-prefixed system fields
// (which our code must strip). Tests previously used a flat shape that didn't match
// what Box actually returns, which masked a real bug in `instanceOf`.
const card = (cardId, status, theme, daysAgo = 0) => ({
  id: cardId, type: 'file', name: 'spec.md',
  metadata: { extraData: { enterprise: { devtool_build_card: { extraData: {
    $id: 'm-' + cardId, $type: 'devtool_build_card', $parent: 'file_' + cardId,
    $scope: 'enterprise_1', $template: 'devtool_build_card', $version: 0,
    card_id: cardId, status, theme, pain_score: 0.5,
  } } } } },
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
  assert.deepEqual(out[0], { fileId: 'a', cardId: 'a' });
});

test('listCardsByStatus returns only cards in the requested status', async () => {
  const client = clientReturning([
    card('a', 'ready-for-build', 'testing-ci'),
    card('b', 'building', 'testing-ci'),
  ]);
  const out = await listCardsByStatus(client, 'ready-for-build');
  assert.deepEqual(out.map((r) => r.cardId), ['a']);
});

test('listCardsWithMetadata returns user fields stripped of $-prefixed system fields', async () => {
  const client = clientReturning([card('a', 'inbox', 'testing-ci')]);
  const out = await listCardsWithMetadata(client);
  assert.equal(out.length, 1);
  assert.equal(out[0].fileId, 'a');
  assert.equal(out[0].cardId, 'a');
  assert.deepEqual(out[0].metadata, { card_id: 'a', status: 'inbox', theme: 'testing-ci', pain_score: 0.5 });
});

test('entries without a template instance are filtered out', async () => {
  const client = clientReturning([
    { id: 'x', type: 'file', name: 'other.md' }, // no metadata at all
    { id: 'y', type: 'file', name: 'other.md', metadata: { extraData: {} } }, // no template
    card('a', 'inbox', 'testing-ci'),
  ]);
  const out = await listCardsWithMetadata(client);
  assert.deepEqual(out.map((r) => r.cardId), ['a']);
});

test('empty search results yield an empty array', async () => {
  assert.deepEqual(await findDuplicate(clientReturning([]), { theme: 't', withinDays: 7 }), []);
});

test('searchForContent is called with the metadata template field so Box returns the payload', async () => {
  let received;
  const client = { search: { searchForContent: async (q) => { received = q; return { entries: [] }; } } };
  await listCardsWithMetadata(client, 'root');
  assert.ok(received.fields?.includes('metadata.enterprise.devtool_build_card'),
    `expected fields to include the metadata path; got ${JSON.stringify(received.fields)}`);
});
