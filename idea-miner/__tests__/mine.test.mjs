import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileSystemBoxClient } from '../../contracts/box-client-mock.mjs';
import { mineFromQuery, subjectTerms, groupBySubject } from '../mine.mjs';

const config = { window_days: 365, max_posts_per_run: 50 };
const themes = [{ id: 'product-feedback' }];
const nowSec = () => Math.floor(Date.now() / 1000);

const validSpec = (id, theme = 'product-feedback') => `---
id: "${id}"
schema_version: "1"
theme: ${theme}
status: "inbox"
signal_strength:
  score: 0.6
---

# Card
## Acceptance Criteria
- [ ] do the thing
`;

test('subjectTerms drops stopwords and short tokens', () => {
  assert.deepEqual(subjectTerms('feedback about Notion AI'), ['Notion']);
});

test('groupBySubject counts unique authors and subreddits', () => {
  const g = groupBySubject('Notion', [
    { author: 'a', subreddit: 'r1' }, { author: 'a', subreddit: 'r2' }, { author: 'b', subreddit: 'r1' },
  ]);
  assert.equal(g.uniqueAuthors, 2);
  assert.equal(g.subredditCount, 2);
});

test('mineFromQuery runs interpret -> scrape -> score -> generate -> upload and writes an inbox card', async () => {
  const box = new FileSystemBoxClient({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'mine-test-')) });
  const cardId = randomUUID();

  const ref = await mineFromQuery(
    { query: 'feedback about Notion AI', subreddit: 'r/productivity', creatorEmail: 'me@x.com' },
    {
      boxClient: box, config, themes,
      interpretImpl: async () => ({ subject: 'Notion AI', searchPhrases: ['notion ai'], theme: 'product-feedback', subreddit: 'productivity' }),
      scrapeImpl: async (cfg) => {
        assert.deepEqual(cfg.searchPhrases, ['notion ai']);
        assert.equal(cfg.subreddit, 'productivity');
        return [{ id: 'p1', author: 'u1', subreddit: 'productivity', score: 50, created_utc: nowSec(), permalink: '/r/productivity/p1', body: 'Notion AI is slow' }];
      },
      generateImpl: async (group, cfg) => {
        assert.equal(cfg.theme, 'product-feedback');
        assert.equal(cfg.subject, 'Notion AI');
        assert.ok(group.posts.length >= 1);
        return validSpec(cardId);
      },
    },
  );

  assert.ok(ref.fileId && ref.cardId, 'returns a card ref');
  const meta = await box.getMetadata(ref.fileId);
  assert.equal(meta.status, 'inbox');
  assert.equal(meta.theme, 'product-feedback');
  assert.equal(meta.creator_email, 'me@x.com');
});

test('mineFromQuery throws when no posts survive scoring', async () => {
  const box = new FileSystemBoxClient({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'mine-empty-')) });
  await assert.rejects(
    mineFromQuery({ query: 'x' }, {
      boxClient: box, config, themes,
      interpretImpl: async () => ({ subject: 'x', searchPhrases: ['x'], theme: 'product-feedback' }),
      scrapeImpl: async () => [], // nothing scraped
      generateImpl: async () => validSpec(randomUUID()),
    }),
    /no usable feedback/,
  );
});

test('mineFromQuery requires a query', async () => {
  await assert.rejects(mineFromQuery({ query: '' }, { boxClient: {}, config, themes }), /query is required/);
});

test('mineFromQuery fails loudly (no broken upload) when generation returns a failed card', async () => {
  const failedSpec = '---\nstatus: "failed"\nid: "00000000-0000-4000-8000-000000000000"\nerror: "model output failed schema validation"\n---\n# Failed Card\n';
  let uploaded = false;
  await assert.rejects(
    mineFromQuery({ query: 'x' }, {
      boxClient: { uploadCard: async () => { uploaded = true; return { fileId: 'f', cardId: 'c' }; }, findDuplicate: async () => [] },
      config, themes,
      interpretImpl: async () => ({ subject: 'x', searchPhrases: ['x'], theme: 'product-feedback' }),
      scrapeImpl: async () => [{ id: 'p1', author: 'u1', subreddit: 's', score: 10, created_utc: nowSec(), permalink: '/p1', body: 'feedback' }],
      generateImpl: async () => failedSpec,
    }),
    /could not generate a valid spec/,
  );
  assert.equal(uploaded, false, 'must not upload a failed card');
});
