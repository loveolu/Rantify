import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileSystemBoxClient } from './box-client-mock.mjs';

function freshBox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'box-mock-test-'));
  return new FileSystemBoxClient({ root });
}

test('getArtifact reads back what uploadArtifact wrote to the card area', async () => {
  const box = freshBox();
  await box.uploadCard({ cardId: 'c1', specMarkdown: '# spec', metadata: { status: 'inbox', card_id: 'c1' } });
  await box.uploadArtifact({ cardId: 'c1', name: 'REVIEW_NOTES.md', content: '# notes\n- fix x', area: 'card' });
  assert.equal(await box.getArtifact({ cardId: 'c1', name: 'REVIEW_NOTES.md' }), '# notes\n- fix x');
});

test('getArtifact reads from the logs area', async () => {
  const box = freshBox();
  await box.uploadArtifact({ cardId: 'c2', name: 'c2-build.md', content: 'summary', area: 'logs' });
  assert.equal(await box.getArtifact({ cardId: 'c2', name: 'c2-build.md', area: 'logs' }), 'summary');
});

test('getArtifact rejects a missing artifact', async () => {
  const box = freshBox();
  await box.uploadCard({ cardId: 'c3', specMarkdown: '#', metadata: { status: 'inbox', card_id: 'c3' } });
  await assert.rejects(box.getArtifact({ cardId: 'c3', name: 'nope.md' }), /not found|ENOENT/i);
});
