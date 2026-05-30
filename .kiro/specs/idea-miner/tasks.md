# Implementation Plan: Idea Miner

## Overview

Build the five-stage Reddit-to-Box pipeline as six independently-testable modules,
assembled in dependency order: scorer → cluster → scraper → generator → uploader →
index. Each module is implemented and tested before the next is started. All modules
use ESM syntax (`import`/`export`) and target Node.js 20.11+.

---

## Tasks

- [-] 0. Project setup — `idea-miner/package.json` and dev dependencies
  - Create `idea-miner/package.json` with `"type": "module"`, `"engines": { "node": ">=20.11" }`, and scripts:
    - `"test": "node --test idea-miner/__tests__/**/*.test.mjs"`
    - `"test:run": "node --test --test-reporter=spec idea-miner/__tests__/**/*.test.mjs"`
  - Add `fast-check` as a dev dependency (pinned version, e.g. `"fast-check": "3.22.0"`)
  - Create `idea-miner/__tests__/` directory (empty, ready for test files)
  - Create `failed-cards/` directory with a `.gitkeep` so the fallback path exists
  - Verify `node --version` is ≥ 20.11 in a startup check comment in `index.mjs`
  - _Requirements: 6.6_

- [ ] 1. Implement `idea-miner/scorer.mjs` — Post scoring and filtering
  - [~] 1.1 Create `idea-miner/scorer.mjs` with all exports and helpers
    - Add JSDoc `@typedef` for `Post` and `ScoredPost` (copy exact shapes from design §Data Models)
    - Implement internal helper `isValidTimestamp(created_utc)` — returns `false` if missing or non-numeric
    - Implement internal helper `computeBaseScore(upvotes)` — `Math.log1p(Math.max(0, upvotes))`
    - Implement internal helper `computeKeywordBoost(body, created_utc)`:
      - `+0.20` if `/hours|days|blocked|prod|deploy/i` matches `body`
      - `+0.10` if `/monorepo|github actions|ci minutes/i` matches `body`
      - `+0.15` if `created_utc` is valid AND `(Date.now() - created_utc * 1000) < 30 * 86_400_000`
    - Implement exported `score(posts, config)`:
      - Drop posts where `isValidTimestamp` returns false
      - Compute `base_score`, `keyword_boost`, `final_score` for each remaining post
      - Drop posts where `final_score < 1.0`
      - Drop posts where `(Date.now() - created_utc * 1000) > config.window_days * 86_400_000`
      - Return surviving `ScoredPost[]`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ]* 1.2 Write property-based and unit tests for `scorer.mjs`
    - Create `idea-miner/__tests__/scorer.test.mjs`
    - Use `node:test` + `fast-check`; import `score` from `../scorer.mjs`
    - **Property 4: Scoring formula is deterministic**
      - `fc.integer()` for upvotes, `fc.string()` for body — two posts with identical inputs must produce identical `final_score`
      - Tag: `// Feature: idea-miner, Property 4: Scoring formula is deterministic`
      - **Validates: Requirements 2.6**
    - **Property 5: Negative upvotes are clamped to zero**
      - `fc.integer({ max: -1 })` — `base_score` must equal `Math.log1p(0)` (i.e., `0`)
      - Tag: `// Feature: idea-miner, Property 5: Negative upvotes are clamped to zero`
      - **Validates: Requirements 2.1**
    - **Property 6: Keyword boost formula is correct**
      - `fc.string()` for body, `fc.integer()` for `created_utc` — `final_score` must equal `base_score * (1 + keyword_boost)`
      - Tag: `// Feature: idea-miner, Property 6: Keyword boost formula is correct`
      - **Validates: Requirements 2.2**
    - **Property 7: Low-signal and stale posts are filtered**
      - `fc.array(post)`, `fc.integer({ min: 1 })` for `window_days` — every post in output must have `final_score >= 1.0` AND `age_days <= window_days`
      - Tag: `// Feature: idea-miner, Property 7: Low-signal and stale posts are filtered`
      - **Validates: Requirements 2.3, 2.4**
    - Unit test: post with missing `created_utc` is dropped (Req 2.7)
    - Unit test: post with non-numeric `created_utc` is dropped (Req 2.7)
    - Unit test: post with negative upvotes scores as if upvotes = 0 (Req 2.1)
    - Unit test: post with `final_score` exactly `1.0` survives; post with `0.999` is dropped (Req 2.3)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7_

- [ ] 2. Implement `idea-miner/cluster.mjs` — Keyword clustering
  - [~] 2.1 Create `idea-miner/cluster.mjs` with all exports and helpers
    - Add JSDoc `@typedef` for `Cluster`
    - Compile cluster patterns once at module load:
      ```js
      const PATTERNS = {
        'flaky-tests': /flaky|intermittent|randomly fails|non-deterministic/i,
        'slow-ci':     /slow ci|ci takes|ci minutes|pipeline takes/i,
      };
      ```
    - Implement internal helper `assignToClusters(posts)` — returns `Map<string, ScoredPost[]>`; a post can appear in multiple clusters; posts matching no pattern are silently excluded
    - Implement internal helper `buildCluster(name, posts)` — computes `uniqueAuthors` (distinct `author` values) and `subredditCount` (distinct `subreddit` values)
    - Implement internal helper `meetsThresholds(cluster, config)` — returns `true` if `uniqueAuthors >= config.min_unique_authors` AND `subredditCount >= config.min_subreddit_count`
    - Implement exported `cluster(scoredPosts, config)`:
      - Assign posts to clusters via `assignToClusters`
      - Build each cluster via `buildCluster`
      - Filter via `meetsThresholds`
      - If no clusters survive, log a message and throw an `Error`
      - Return surviving `Cluster[]`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [ ]* 2.2 Write property-based and unit tests for `cluster.mjs`
    - Create `idea-miner/__tests__/cluster.test.mjs`
    - Use `node:test` + `fast-check`; import `cluster` from `../cluster.mjs`
    - **Property 8: Cluster membership follows regex patterns**
      - Generate `ScoredPost[]` with bodies that contain flaky/slow-ci keywords — assert posts appear in correct clusters; posts matching both appear in both
      - Tag: `// Feature: idea-miner, Property 8: Cluster membership follows regex patterns`
      - **Validates: Requirements 3.1, 3.2, 3.3**
    - **Property 9: Posts matching no pattern are excluded from all clusters**
      - Generate `ScoredPost[]` with bodies that match neither pattern — assert no post appears in any cluster output
      - Tag: `// Feature: idea-miner, Property 9: Posts matching no pattern are excluded from all clusters`
      - **Validates: Requirements 3.8**
    - **Property 10: Under-represented clusters are dropped**
      - `fc.array(scoredPost)`, `fc.integer` thresholds — every cluster in output must have `uniqueAuthors >= min_unique_authors` AND `subredditCount >= min_subreddit_count`
      - Tag: `// Feature: idea-miner, Property 10: Under-represented clusters are dropped`
      - **Validates: Requirements 3.4, 3.5**
    - Unit test: all clusters below threshold → function throws, no clusters returned (Req 3.7)
    - Unit test: post matching both patterns appears in both `flaky-tests` and `slow-ci` clusters (Req 3.3)
    - Unit test: post matching neither pattern is silently excluded (Req 3.8)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8_

- [~] 3. Checkpoint — scorer and cluster tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement `idea-miner/scraper.mjs` — Apify Reddit scraper
  - [~] 4.1 Create `idea-miner/scraper.mjs` with all exports and helpers
    - Add JSDoc `@typedef` for `Post`
    - Implement internal helper `buildApifyPayload(config)` — constructs actor input JSON with `subreddits`, `searchPhrases` (from `config.keywords`), `maxItems`, and `"type": "posts"`
    - Implement internal helper `dedup(posts)` — removes duplicate `id` values, preserving first occurrence
    - Implement internal helper `cap(posts, max)` — slices to `max_posts_per_run`
    - Implement exported `async scrape(config)`:
      - Throw if `APIFY_TOKEN` env var is not set (name the variable in the error message; make no HTTP call)
      - POST to `https://api.apify.com/v2/acts/apify~reddit-scraper/run-sync-get-dataset-items?token={APIFY_TOKEN}`
      - Map each Apify item to a `Post`: `id`, `author`, `subreddit`, `score`, `created_utc`, `permalink`, `body` (`selftext ?? body ?? ''`)
      - Throw on any non-2xx HTTP status or network failure (log error, abort pipeline)
      - Throw if zero results are returned (log message, abort pipeline)
      - Apply `dedup()` then `cap()` before returning
    - **Requires env var: `APIFY_TOKEN`**
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [ ]* 4.2 Write unit tests for `scraper.mjs` (mock `fetch`)
    - Create `idea-miner/__tests__/scraper.test.mjs`
    - Use `node:test`; mock `fetch` using `node:test` mock or a manual stub
    - **Property 1: Post field extraction is complete**
      - `fc.record({ id, author, subreddit, score, created_utc, permalink, selftext })` — extracted `Post` must contain all 7 fields; `body` derived from `selftext ?? body ?? ''`
      - Tag: `// Feature: idea-miner, Property 1: Post field extraction is complete`
      - **Validates: Requirements 1.3**
    - **Property 2: Deduplication produces unique post ids**
      - `fc.array(fc.record({ id: fc.string() }))` with injected duplicates — output must contain each `id` at most once
      - Tag: `// Feature: idea-miner, Property 2: Deduplication produces unique post ids`
      - **Validates: Requirements 1.4**
    - **Property 3: Post count is capped at max_posts_per_run**
      - `fc.array(post)`, `fc.integer({ min: 0, max: 200 })` for `max_posts_per_run` — output length must be ≤ `max_posts_per_run`
      - Tag: `// Feature: idea-miner, Property 3: Post count is capped at max_posts_per_run`
      - **Validates: Requirements 1.5**
    - Unit test: missing `APIFY_TOKEN` throws before any HTTP call (Req 1.7)
    - Unit test: Apify request URL includes correct endpoint and `?token=` param (Req 1.2)
    - Unit test: HTTP 500 from Apify causes throw, no partial results returned (Req 1.6)
    - Unit test: zero results from Apify causes throw with log message (Req 1.8)
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [ ] 5. Implement `idea-miner/generator.mjs` — LLM Build Card generation
  - [~] 5.1 Create `idea-miner/generator.mjs` with all exports and helpers
    - Add JSDoc `@typedef` for `ValidationResult`
    - Implement internal helper `buildSystemPrompt()` — returns the fixed system prompt string instructing the model to return ONLY file content with no preamble, no code fences, no commentary
    - Implement internal helper `buildUserPrompt(cluster, config, schemaTemplate, errorMsg?)` — constructs the user turn including theme, cluster name, unique authors, subreddits, post count, paraphrased complaints (PII stripped), schema template from `fixtures/sample-spec.md`, and optional validation error message on retry
    - Implement internal helper `callClaude(systemPrompt, userPrompt)` — calls Anthropic API at `https://api.anthropic.com/v1/messages` using `ANTHROPIC_API_KEY`; model `claude-3-5-haiku-20241022`; `max_tokens: 4096`; throws on non-2xx or network error
    - Implement internal helper `injectFailedStatus(rawText, errorMsg)` — produces a Failed_Card string: injects `status: "failed"` as the first YAML field, preserves raw LLM output or error message as body
    - Implement exported `validateCard(text, themes)`:
      - Parse YAML front-matter (between `---` delimiters)
      - Check all required fields from Req 4.3: `id` (UUID v4), `schema_version` (`"1"`), `created_at` (ISO 8601), `updated_at` (ISO 8601), `title` (non-empty string), `theme` (matches a `themes[].id`), `status` (`"inbox"`), `persona.role/org_size/stack_context` (non-empty strings), `proof_of_pain.unique_authors/subreddit_count/timeframe_days` (positive integers), `proof_of_pain.sample_complaints` (non-empty array with `text`, `source_url`, `reddit_score`, `scraped_at`), `why_now` (non-empty string array), `build_suggestion.summary` (non-empty string), `build_suggestion.key_capabilities` (non-empty string array), `build_suggestion.tech_constraints` (object with `language` and `runtime`), `signal_strength.score` (float in `[0.0, 1.0]`), `signal_strength.explanation` (non-empty string), `builder` block (all sub-fields `null`)
      - Check Markdown body contains `## Acceptance Criteria` with at least one `- [ ]` checklist item (Req 4.4)
      - Return `{ valid: boolean, errors: string[] }`
    - Implement exported `async generate(cluster, config, themes)`:
      - Throw if `ANTHROPIC_API_KEY` is not set (name the variable; make no API call)
      - Attempt 1: call Claude; validate response with `validateCard()`
      - If valid: return spec.md string
      - If invalid (validation error OR transport error): retry once with error appended to prompt
      - Attempt 2: call Claude; validate response
      - If valid: return spec.md string
      - If invalid: call `injectFailedStatus()` and return Failed_Card string
      - Never set any `builder.*` field to a non-null value
    - **Requires env var: `ANTHROPIC_API_KEY`**
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_

  - [ ]* 5.2 Write property-based and unit tests for `generator.mjs`
    - Create `idea-miner/__tests__/generator.test.mjs`
    - Use `node:test` + `fast-check`; mock `callClaude` (do not make real API calls)
    - **Property 11: Schema validator correctly identifies valid and invalid cards**
      - Generate valid spec.md strings (all required fields present and correctly typed) — `validateCard()` must return `{ valid: true, errors: [] }`
      - Generate spec.md strings with one required field missing or wrong type — `validateCard()` must return `{ valid: false, errors: [...] }` with at least one error
      - Tag: `// Feature: idea-miner, Property 11: Schema validator correctly identifies valid and invalid cards`
      - **Validates: Requirements 4.3, 4.4**
    - **Property 12: Generated card structural invariant**
      - Mock Claude to return arbitrary strings; assert that `generate()` output always has `status` equal to `"inbox"` (or `"failed"` for Failed_Cards) and all `builder.*` fields are `null`
      - Tag: `// Feature: idea-miner, Property 12: Generated card structural invariant`
      - **Validates: Requirements 4.8, 4.9**
    - Unit test: system prompt contains no-preamble instruction (Req 4.2)
    - Unit test: validation error on attempt 1 → retry with error appended to prompt (Req 4.5)
    - Unit test: validation error on attempt 2 → Failed_Card with `status: "failed"` (Req 4.6)
    - Unit test: missing `ANTHROPIC_API_KEY` throws before any API call (Req 4.7)
    - Unit test: transport error on attempt 1 → retry; transport error on attempt 2 → Failed_Card (Req 4.10)
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_

- [~] 6. Checkpoint — generator tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement `idea-miner/uploader.mjs` — Box upload with de-dup and backoff
  - [~] 7.1 Create `idea-miner/uploader.mjs` with all exports and helpers
    - Add JSDoc `@typedef` for `CardMetadata` (local copy matching contract shape)
    - Implement internal helper `extractFrontMatter(specMarkdown)` — parses YAML front-matter between `---` delimiters; returns `{ id, theme, signal_strength: { score } }`
    - Implement internal helper `buildMetadata(frontMatter)` — constructs `CardMetadata` with:
      - `status: "inbox"`, `theme: frontMatter.theme`, `pain_score: frontMatter.signal_strength.score`, `card_id: frontMatter.id`
      - `builder_session_id: null`, `repo_url: null`, `pr_url: null`
    - Implement internal helper `withExponentialBackoff(fn, maxRetries, baseDelayMs)` — generic retry wrapper:
      - 4 total attempts (1 initial + 3 retries)
      - Delay before retry N: `min(baseDelayMs * 2^(N-1), 8000)` ms (1s, 2s, 4s)
      - Throws after all attempts exhausted
    - Implement internal helper `writeFailedCard(cardId, specMarkdown)` — writes to `failed-cards/{cardId}.md`; logs error with path
    - Implement exported `async upload(specMarkdown, boxClient)`:
      - Extract front-matter via `extractFrontMatter`
      - Call `boxClient.findDuplicate({ theme, withinDays: 7 })` — if results returned, log `"duplicate suppressed"` with matching refs and return `'duplicate'`
      - Build metadata via `buildMetadata`
      - Call `boxClient.uploadCard({ cardId, specMarkdown, metadata })` wrapped in `withExponentialBackoff(fn, 3, 1000)`
      - On success: log `fileId` and `cardId`; return `CardRef`
      - If all retries fail: call `writeFailedCard`; log error; do NOT throw (absorb)
      - Only call `findDuplicate` and `uploadCard` on `boxClient` — no other methods
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [ ]* 7.2 Write property-based and unit tests for `uploader.mjs`
    - Create `idea-miner/__tests__/uploader.test.mjs`
    - Use `node:test` + `fast-check`; use `FileSystemBoxClient` mock from `contracts/box-client-mock.mjs` or a manual stub
    - **Property 13: Upload metadata is correctly derived from the Build Card**
      - `fc.string()` (valid spec.md with arbitrary `id`, `theme`, `signal_strength.score`) — assert `metadata.status === "inbox"`, `metadata.theme === frontMatter.theme`, `metadata.pain_score === frontMatter.signal_strength.score`, `metadata.card_id === frontMatter.id`, all `builder.*` fields are `null`
      - Tag: `// Feature: idea-miner, Property 13: Upload metadata is correctly derived from the Build Card`
      - **Validates: Requirements 5.3, 5.4**
    - **Property 14: Exponential backoff delays follow the correct sequence**
      - `fc.integer({ min: 1, max: 4 })` for failure count — assert delays are 1000 ms, 2000 ms, 4000 ms (capped at 8000 ms); no delay exceeds 8000 ms
      - Tag: `// Feature: idea-miner, Property 14: Exponential backoff delays follow the correct sequence`
      - **Validates: Requirements 5.6**
    - Unit test: `findDuplicate()` is called before `uploadCard()` (Req 5.1)
    - Unit test: `findDuplicate()` returns results → `uploadCard()` is never called (Req 5.2)
    - Unit test: successful upload logs `fileId` and `cardId` (Req 5.5)
    - Unit test: all retries fail → file written to `failed-cards/{cardId}.md` (Req 5.7)
    - Unit test: no BoxClient methods other than `findDuplicate`/`uploadCard` are called (Req 5.8)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

- [~] 8. Checkpoint — uploader tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement `idea-miner/index.mjs` — Pipeline entry point
  - [~] 9.1 Create `idea-miner/index.mjs` wiring all five modules
    - Import `scrape` from `./scraper.mjs`
    - Import `score` from `./scorer.mjs`
    - Import `cluster` from `./cluster.mjs`
    - Import `generate` from `./generator.mjs`
    - Import `upload` from `./uploader.mjs`
    - Import `FileSystemBoxClient` from `../contracts/box-client-mock.mjs`
    - Startup sequence (before any external call):
      1. Validate `APIFY_TOKEN` and `ANTHROPIC_API_KEY` — if either is missing, log a descriptive error naming the missing variable(s) and call `process.exit(1)`
      2. Load `config/idea-miner.json` — if missing or malformed JSON, log error with filename and call `process.exit(1)`
      3. Load `config/themes.json` — if missing or malformed JSON, log error with filename and call `process.exit(1)`
      4. Instantiate `new FileSystemBoxClient()`
    - Pipeline execution (inside top-level `try/catch`):
      5. `const posts = await scrape(config)`
      6. `const scoredPosts = score(posts, config)`
      7. `const clusters = cluster(scoredPosts, config)`
      8. For each cluster: `const specMarkdown = await generate(cluster, config, themes)`
      9. For each specMarkdown: `await upload(specMarkdown, boxClient)`
      10. `process.exit(0)`
    - Top-level `catch`: log error with human-readable message, call `process.exit(1)`
    - Never log the values of `APIFY_TOKEN` or `ANTHROPIC_API_KEY` — reference by name only
    - Use ESM `import`/`export` throughout; compatible with Node.js 20.11+
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

  - [ ]* 9.2 Write integration tests for `index.mjs`
    - Create `idea-miner/__tests__/index.integration.test.mjs`
    - Use `node:test`; mock all external calls (Apify, Anthropic) and use `FileSystemBoxClient` with a temp directory
    - Unit test: `node idea-miner/index.mjs` runs all five stages in sequence (Req 6.1)
    - Unit test: unhandled error in any stage → exit code 1 (Req 6.4)
    - Unit test: successful run → exit code 0 (Req 6.5)
    - Unit test: missing `APIFY_TOKEN` at startup → exit 1 before any network call (Req 6.8)
    - Unit test: missing `ANTHROPIC_API_KEY` at startup → exit 1 before any API call (Req 6.8)
    - Unit test: log output never contains the value of `APIFY_TOKEN` or `ANTHROPIC_API_KEY` (Req 6.9)
    - Unit test: missing config file throws with filename in message (Req 1.1)
    - Unit test: malformed JSON config throws with filename in message (Req 1.1)
    - _Requirements: 6.1, 6.4, 6.5, 6.8, 6.9, 1.1_

- [ ] 10. End-to-end smoke test against the mock
  - [~] 10.1 Run `node idea-miner/index.mjs` end-to-end with mock data
    - Set `APIFY_TOKEN=test-token` and `ANTHROPIC_API_KEY=test-key` in the environment
    - Stub the Apify HTTP call to return a fixture array of posts (at least 10 posts matching `flaky-tests` or `slow-ci` patterns, from ≥ 5 distinct authors and ≥ 2 subreddits)
    - Stub the Anthropic HTTP call to return a valid spec.md string matching `fixtures/sample-spec.md` shape
    - Verify that `FileSystemBoxClient` writes a card to `.box-mock/cards/{cardId}/spec.md`
    - Verify that `.box-mock/cards/{cardId}/metadata.json` contains `status: "inbox"` and correct `theme`, `pain_score`, `card_id`
    - Verify process exits with code `0`
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.7_

- [~] 11. Final checkpoint — all tests pass
  - Run `node --test idea-miner/__tests__/**/*.test.mjs` and confirm all tests pass.
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each major module
- Property tests validate universal correctness invariants (Properties 1–14 from design §Correctness Properties)
- Unit tests validate specific examples, error paths, and edge cases from design §Testing Strategy
- All test files use `node:test` (Node 20.11+ built-in) and `fast-check` for PBT
- External API calls (Apify, Anthropic) must be mocked in all tests — never make real network calls in the test suite
- `APIFY_TOKEN` and `ANTHROPIC_API_KEY` are required env vars for tasks 4.1, 5.1, 9.1, and 10.1
- The `FileSystemBoxClient` from `contracts/box-client-mock.mjs` is the test double for Box in all tests
- Build order (scorer → cluster → scraper → generator → uploader → index) ensures each module is independently testable before the next is started

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0"] },
    { "id": 1, "tasks": ["1.1"] },
    { "id": 2, "tasks": ["1.2", "2.1"] },
    { "id": 3, "tasks": ["2.2", "4.1"] },
    { "id": 4, "tasks": ["4.2", "5.1"] },
    { "id": 5, "tasks": ["5.2", "7.1"] },
    { "id": 6, "tasks": ["7.2", "9.1"] },
    { "id": 7, "tasks": ["9.2"] },
    { "id": 8, "tasks": ["10.1"] }
  ]
}
```
