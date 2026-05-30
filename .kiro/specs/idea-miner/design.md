# Design Document — Idea Miner

## Overview

The Idea Miner is a five-stage Node.js (ESM, Node 20.11+) pipeline that automatically
discovers developer pain points on Reddit and converts them into structured Build Cards
stored in Box. It is Person A's component of the DevTool Discovery & Build Loop system
(SPEC.md §6).

The pipeline runs as a single command (`node idea-miner/index.mjs`) and executes these
stages in strict sequence:

```
scrape → score → cluster → generate → upload
```

Each stage is a pure module with a single exported function. Stages communicate only
through return values — no shared mutable state. All secrets are read from environment
variables; all configuration is loaded from JSON files at startup.

### Key Design Decisions

- **Sequential, fail-fast**: Each stage either returns a value or throws. The pipeline
  runner catches all throws, logs them, and exits non-zero. No partial writes to Box.
- **Deterministic scoring**: The scoring formula uses only `Math.log1p` and fixed boost
  constants, so identical inputs always produce identical scores (Requirement 2.6).
- **Contract isolation**: The uploader only calls `findDuplicate()` and `uploadCard()`.
  No other BoxClient methods are touched (Requirement 5.8).
- **LLM guard-rail**: The generator enforces the §5.2 schema via `validateCard()` and
  retries once. A Failed_Card is written rather than crashing the pipeline.
- **Mock-first**: The pipeline imports `FileSystemBoxClient` from
  `contracts/box-client-mock.mjs`. Swapping to the real client is a one-line change.


---

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  idea-miner/index.mjs  (Pipeline Runner)                            │
│                                                                     │
│  startup: validate env vars → load configs → instantiate BoxClient  │
│                                                                     │
│  ┌──────────┐   Post[]   ┌──────────┐  ScoredPost[]  ┌──────────┐  │
│  │ scraper  │──────────▶│  scorer  │───────────────▶│ cluster  │  │
│  │  .mjs    │           │  .mjs    │                │  .mjs    │  │
│  └──────────┘           └──────────┘                └──────────┘  │
│       │                                                  │         │
│  Apify API                                          Cluster[]      │
│  (HTTP POST)                                             │         │
│                                                          ▼         │
│                                                   ┌──────────┐     │
│                                                   │generator │     │
│                                                   │  .mjs    │     │
│                                                   └──────────┘     │
│                                                        │           │
│                                                  Anthropic API     │
│                                                  (HTTPS POST)      │
│                                                        │           │
│                                                   string (spec.md) │
│                                                        │           │
│                                                        ▼           │
│                                                   ┌──────────┐     │
│                                                   │uploader  │     │
│                                                   │  .mjs    │     │
│                                                   └──────────┘     │
│                                                        │           │
│                                              BoxClient contract     │
│                                         findDuplicate / uploadCard  │
│                                                        │           │
│                                              CardRef | 'duplicate'  │
└─────────────────────────────────────────────────────────────────────┘

External dependencies:
  Apify Reddit Scraper  ←  scraper.mjs
  Anthropic Claude API  ←  generator.mjs
  Box (mock or real)    ←  uploader.mjs via contracts/box-client-mock.mjs
```

### Data Flow Summary

| Stage     | Input                        | Output                        |
|-----------|------------------------------|-------------------------------|
| scraper   | config (subreddits/keywords) | `Post[]`                      |
| scorer    | `Post[]`, config             | `ScoredPost[]`                |
| cluster   | `ScoredPost[]`, config       | `Cluster[]`                   |
| generator | `Cluster`, config, themes    | `string` (spec.md content)    |
| uploader  | `string`, BoxClient          | `CardRef \| 'duplicate'`      |


---

## File Layout

```
idea-miner/
├── index.mjs        # Pipeline entry point (Requirement 6)
├── scraper.mjs      # Apify Reddit scraper (Requirement 1)
├── scorer.mjs       # Post scoring and filtering (Requirement 2)
├── cluster.mjs      # Keyword clustering (Requirement 3)
├── generator.mjs    # LLM Build Card generation (Requirement 4)
└── uploader.mjs     # Box upload with de-dup (Requirement 5)

config/
├── idea-miner.json  # Subreddits, keywords, thresholds, window
└── themes.json      # Valid theme ids for schema validation

contracts/
├── box-client.mjs       # Frozen BoxClient abstract contract
└── box-client-mock.mjs  # FileSystemBoxClient (filesystem fake)

fixtures/
└── sample-spec.md   # Reference Build Card shape

failed-cards/        # Created at runtime; gitignored
└── {cardId}.md      # Fallback when all upload retries fail
```

---

## Data Models

All types are expressed as JSDoc `@typedef` comments in the respective modules.

### `Post` — raw Reddit post from Apify

```js
/**
 * @typedef {Object} Post
 * @property {string} id           - Reddit post id (unique key for dedup)
 * @property {string} author       - Reddit username
 * @property {string} subreddit    - Subreddit name (without r/)
 * @property {number} score        - Upvote count (may be negative)
 * @property {number} created_utc  - Unix timestamp (seconds)
 * @property {string} permalink    - Relative Reddit URL
 * @property {string} body         - Post body text (selftext or body field)
 */
```

### `ScoredPost` — post after scoring

```js
/**
 * @typedef {Object} ScoredPost
 * @property {string} id
 * @property {string} author
 * @property {string} subreddit
 * @property {number} score        - Original upvote count
 * @property {number} created_utc
 * @property {string} permalink
 * @property {string} body
 * @property {number} base_score   - log1p(max(0, score))
 * @property {number} keyword_boost - Sum of applicable boosts (0.0–0.45)
 * @property {number} final_score  - base_score * (1 + keyword_boost)
 */
```

### `Cluster` — named group of scored posts

```js
/**
 * @typedef {Object} Cluster
 * @property {string}       name           - e.g. "flaky-tests" or "slow-ci"
 * @property {ScoredPost[]} posts          - All posts assigned to this cluster
 * @property {number}       uniqueAuthors  - Count of distinct author values
 * @property {number}       subredditCount - Count of distinct subreddit values
 */
```

### `CardMetadata` — Box metadata template fields (from contract)

```js
/**
 * @typedef {Object} CardMetadata
 * @property {'inbox'|'failed'}  status              - Always "inbox" (or "failed")
 * @property {string}            theme               - e.g. "testing-ci"
 * @property {number}            pain_score          - signal_strength.score [0.0–1.0]
 * @property {string}            card_id             - UUID; equals front-matter id
 * @property {null}              builder_session_id  - Always null (set by Orchestrator)
 * @property {null}              repo_url            - Always null (set by Orchestrator)
 * @property {null}              pr_url              - Always null (set by Orchestrator)
 */
```

### `ValidationResult` — output of `validateCard()`

```js
/**
 * @typedef {Object} ValidationResult
 * @property {boolean}  valid   - true if all required fields pass
 * @property {string[]} errors  - List of human-readable error messages (empty if valid)
 */
```


---

## Components and Interfaces

### `scraper.mjs`

```js
/**
 * Fetch Reddit posts via the Apify reddit-scraper actor.
 *
 * @param {object} config - Parsed config/idea-miner.json
 * @param {string[]} config.subreddits
 * @param {string[]} config.keywords
 * @param {number}   config.max_posts_per_run
 * @returns {Promise<Post[]>} Deduplicated posts, capped at max_posts_per_run
 * @throws {Error} If APIFY_TOKEN is missing, config is invalid, HTTP fails, or zero results
 */
export async function scrape(config) { ... }
```

**Internal helpers** (not exported):
- `buildApifyPayload(config)` — constructs the actor input JSON
- `dedup(posts)` — removes duplicate `id` values, preserving first occurrence
- `cap(posts, max)` — slices to `max_posts_per_run`

**Apify request shape:**

```
POST https://api.apify.com/v2/acts/apify~reddit-scraper/run-sync-get-dataset-items
     ?token={APIFY_TOKEN}
Content-Type: application/json

{
  "subreddits": ["programming", "devops", ...],
  "searchPhrases": ["flaky test", "slow ci", ...],
  "maxItems": <max_posts_per_run>,
  "type": "posts"
}
```

Response: JSON array of items. Each item is mapped to a `Post` by reading:
- `id` → `id`
- `author` → `author`
- `subreddit` → `subreddit`
- `score` → `score`
- `created_utc` → `created_utc`
- `permalink` → `permalink`
- `selftext ?? body ?? ''` → `body`

---

### `scorer.mjs`

```js
/**
 * Score and filter posts.
 *
 * @param {Post[]} posts
 * @param {object} config - Parsed config/idea-miner.json
 * @param {number} config.window_days
 * @returns {ScoredPost[]} Posts that pass both score and age filters
 */
export function score(posts, config) { ... }
```

**Internal helpers** (not exported):
- `computeBaseScore(upvotes)` — `Math.log1p(Math.max(0, upvotes))`
- `computeKeywordBoost(body, created_utc)` — sums applicable boosts
- `isValidTimestamp(created_utc)` — returns false if missing or non-numeric

---

### `cluster.mjs`

```js
/**
 * Group scored posts into named clusters and drop under-represented ones.
 *
 * @param {ScoredPost[]} scoredPosts
 * @param {object} config - Parsed config/idea-miner.json
 * @param {number} config.min_unique_authors
 * @param {number} config.min_subreddit_count
 * @returns {Cluster[]} Clusters that pass both threshold filters
 * @throws {Error} If all clusters are dropped (no clusters survive)
 */
export function cluster(scoredPosts, config) { ... }
```

**Cluster patterns** (compiled once at module load):

```js
const PATTERNS = {
  'flaky-tests': /flaky|intermittent|randomly fails|non-deterministic/i,
  'slow-ci':     /slow ci|ci takes|ci minutes|pipeline takes/i,
};
```

**Internal helpers** (not exported):
- `assignToClusters(posts)` — returns `Map<string, ScoredPost[]>`
- `buildCluster(name, posts)` — computes `uniqueAuthors` and `subredditCount`
- `meetsThresholds(cluster, config)` — checks both threshold conditions

---

### `generator.mjs`

```js
/**
 * Generate a Build Card spec.md string from a cluster using the Anthropic Claude API.
 *
 * @param {Cluster} cluster
 * @param {object}  config  - Parsed config/idea-miner.json
 * @param {object}  themes  - Parsed config/themes.json
 * @returns {Promise<string>} YAML+Markdown spec.md content
 */
export async function generate(cluster, config, themes) { ... }

/**
 * Validate a Build Card string against the §5.2 schema.
 *
 * @param {string} text   - Raw spec.md content
 * @param {object} themes - Parsed config/themes.json
 * @returns {ValidationResult}
 */
export function validateCard(text, themes) { ... }
```

**Internal helpers** (not exported):
- `buildSystemPrompt()` — returns the strict formatting instruction string
- `buildUserPrompt(cluster, config, schemaTemplate, errorMsg?)` — constructs the user turn
- `callClaude(systemPrompt, userPrompt)` — wraps the Anthropic API call
- `injectFailedStatus(rawText, errorMsg)` — produces a Failed_Card string

---

### `uploader.mjs`

```js
/**
 * De-duplicate and upload a Build Card to Box.
 *
 * @param {string}    specMarkdown - Full YAML+Markdown spec.md content
 * @param {BoxClient} boxClient    - Instance of FileSystemBoxClient or real BoxClient
 * @returns {Promise<CardRef | 'duplicate'>}
 * @throws {Error} Only if all retries fail AND local fallback write also fails
 */
export async function upload(specMarkdown, boxClient) { ... }
```

**Internal helpers** (not exported):
- `extractFrontMatter(specMarkdown)` — parses YAML front-matter, returns `{ id, theme, signal_strength }`
- `buildMetadata(frontMatter)` — constructs `CardMetadata` with `builder.*` fields as `null`
- `withExponentialBackoff(fn, maxRetries, baseDelayMs)` — generic retry wrapper
- `writeFailedCard(cardId, specMarkdown)` — writes to `failed-cards/{cardId}.md`


---

### `index.mjs`

```js
/**
 * Pipeline entry point. Validates env vars, loads configs, runs all five stages.
 * Exits 0 on success, non-zero on any unhandled error.
 */

// Startup sequence:
// 1. Validate APIFY_TOKEN and ANTHROPIC_API_KEY — exit 1 if missing
// 2. Load config/idea-miner.json — exit 1 if missing or malformed
// 3. Load config/themes.json    — exit 1 if missing or malformed
// 4. Instantiate FileSystemBoxClient from contracts/box-client-mock.mjs
// 5. await scrape(config)
// 6. score(posts, config)
// 7. cluster(scoredPosts, config)
// 8. for each cluster: await generate(cluster, config, themes)
// 9. for each specMarkdown: await upload(specMarkdown, boxClient)
// 10. process.exit(0)
```

The pipeline iterates over all surviving clusters (step 8–9), generating and uploading
one card per cluster. If any step throws, the top-level `try/catch` logs the error and
calls `process.exit(1)`.

---

## Key Algorithms

### Scoring Formula (scorer.mjs)

```
upvotes_clamped = max(0, post.score)
base_score      = Math.log1p(upvotes_clamped)

keyword_boost   = 0
if /hours|days|blocked|prod|deploy/i.test(post.body)       keyword_boost += 0.20
if /monorepo|github actions|ci minutes/i.test(post.body)   keyword_boost += 0.10
if (now - post.created_utc * 1000) < 30 * 86_400_000       keyword_boost += 0.15

final_score = base_score * (1 + keyword_boost)

DROP if final_score < 1.0
DROP if (now - post.created_utc * 1000) > window_days * 86_400_000
DROP if created_utc is missing or not a valid number
```

The maximum possible `keyword_boost` is `0.45` (all three boosts apply). A post with
1 upvote (`base_score ≈ 0.693`) can never reach `final_score ≥ 1.0` even with all
boosts (`0.693 * 1.45 ≈ 1.005`), so the minimum meaningful upvote count is ~1.

### Cluster Regex Patterns (cluster.mjs)

```
flaky-tests: /flaky|intermittent|randomly fails|non-deterministic/i
slow-ci:     /slow ci|ci takes|ci minutes|pipeline takes/i
```

Both patterns are tested against `post.body`. A post can match both and will appear in
both clusters. Posts matching neither are silently excluded.

### Exponential Backoff (uploader.mjs)

```
attempt 1: immediate
attempt 2: wait 1000 ms  (1s)
attempt 3: wait 2000 ms  (2s)
attempt 4: wait 4000 ms  (4s)

delay(attempt) = min(baseDelay * 2^(attempt-1), 8000)
  where baseDelay = 1000, attempt is 1-indexed retry number
```

Total attempts: 4 (1 initial + 3 retries). If all 4 fail, write to
`failed-cards/{cardId}.md`.

### LLM Retry Logic (generator.mjs)

```
attempt 1: call Claude with system + user prompt
  → if valid: return spec.md string
  → if invalid (validation error OR transport error):
      append error message to user prompt, go to attempt 2

attempt 2: call Claude with augmented prompt
  → if valid: return spec.md string
  → if invalid (validation error OR transport error):
      produce Failed_Card (inject status: "failed" as first YAML field,
      preserve raw LLM output or error message as body)
```

The Failed_Card is still uploaded to Box (with `status: "failed"`) so the run is
recorded and reviewable.


---

## External API Integration

### Apify Reddit Scraper

**Endpoint:**
```
POST https://api.apify.com/v2/acts/apify~reddit-scraper/run-sync-get-dataset-items?token={APIFY_TOKEN}
```

**Request body:**
```json
{
  "subreddits": ["programming", "devops", "ExperiencedDevs", "SoftwareEngineering"],
  "searchPhrases": ["flaky test", "slow ci", "..."],
  "maxItems": 50,
  "type": "posts"
}
```

**Response:** JSON array. Each element is mapped to a `Post`. The scraper reads
`selftext` first, falls back to `body`, then falls back to `''` for the `body` field.

**Error handling:** Any non-2xx HTTP status or network exception causes the scraper to
throw, which propagates to the pipeline runner and exits non-zero. No partial results
are used.

### Anthropic Claude API

**Model:** `claude-3-5-haiku-20241022` (configurable via `config/idea-miner.json`
`model` field; defaults to haiku for cost efficiency).

**System prompt (fixed):**
```
You are a technical product researcher. Your task is to generate a Build Card spec.md
file in YAML front-matter + Markdown format. You MUST return ONLY the file content —
no preamble, no code fences, no commentary, no explanation. The output must be a valid
YAML front-matter block (delimited by ---) followed by Markdown sections.
```

**User prompt structure:**
```
Theme: {config.theme}
Cluster: {cluster.name}
Unique authors: {cluster.uniqueAuthors}
Subreddits: {cluster.posts.map(p => p.subreddit).join(', ')}
Post count: {cluster.posts.length}

Complaints (paraphrased, PII stripped):
{cluster.posts.slice(0, 5).map(p => `- ${paraphrase(p.body)}`).join('\n')}

Generate a Build Card matching this exact schema template:
{schemaTemplate}

[If retry: Previous attempt failed validation with these errors:
{validationErrors}
Please fix all listed errors.]
```

The `schemaTemplate` is the full YAML+Markdown structure from `fixtures/sample-spec.md`
with placeholder values, included verbatim in the prompt.

**API call shape (using Anthropic SDK or raw fetch):**
```json
{
  "model": "claude-3-5-haiku-20241022",
  "max_tokens": 4096,
  "system": "<system prompt>",
  "messages": [{ "role": "user", "content": "<user prompt>" }]
}
```


---

## Error Handling Strategy

Each module has a defined error posture: either it **propagates** (throws, letting the
pipeline runner handle it) or it **absorbs** (handles internally and continues).

| Module        | Error condition                              | Posture     | Outcome                                      |
|---------------|----------------------------------------------|-------------|----------------------------------------------|
| `index.mjs`   | Missing env var at startup                   | Propagate   | Log + exit 1 before any network call         |
| `index.mjs`   | Missing/malformed config JSON                | Propagate   | Log + exit 1 before any network call         |
| `index.mjs`   | Any unhandled throw from sub-module          | Absorb      | Log error message + exit 1                   |
| `scraper.mjs` | Missing `APIFY_TOKEN`                        | Propagate   | Throw before HTTP call                       |
| `scraper.mjs` | HTTP error / network failure                 | Propagate   | Throw; pipeline aborts, no card written      |
| `scraper.mjs` | Zero results from Apify                      | Propagate   | Log + throw; pipeline aborts                 |
| `scorer.mjs`  | Missing/invalid `created_utc`                | Absorb      | Drop post silently                           |
| `scorer.mjs`  | Negative upvotes                             | Absorb      | Clamp to 0, continue scoring                 |
| `cluster.mjs` | Post matches no pattern                      | Absorb      | Silently exclude from all clusters           |
| `cluster.mjs` | All clusters dropped                         | Propagate   | Log + throw; pipeline aborts                 |
| `generator.mjs` | Missing `ANTHROPIC_API_KEY`               | Propagate   | Throw before API call                        |
| `generator.mjs` | Validation error on attempt 1             | Absorb      | Retry with error appended to prompt          |
| `generator.mjs` | Transport error on attempt 1              | Absorb      | Treat as validation error; retry             |
| `generator.mjs` | Validation/transport error on attempt 2   | Absorb      | Produce Failed_Card; continue to upload      |
| `uploader.mjs`  | `uploadCard()` throws                     | Absorb      | Retry with exponential backoff (3 retries)   |
| `uploader.mjs`  | All retries exhausted                     | Absorb      | Write `failed-cards/{cardId}.md`; log error  |
| `uploader.mjs`  | `findDuplicate()` returns results         | Absorb      | Log "duplicate suppressed"; return early     |

**Principle:** The pipeline never writes a partial card to Box. Either a complete card
(valid or failed) is uploaded, or nothing is uploaded. The only exception is the local
`failed-cards/` fallback, which is a last-resort safety net.


---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid
executions of a system — essentially, a formal statement about what the system should
do. Properties serve as the bridge between human-readable specifications and
machine-verifiable correctness guarantees.*

### Property Reflection

Before listing properties, redundancies were eliminated:

- Properties 2.3 (drop if score < 1.0) and 2.4 (drop if age > window_days) are
  independent filters. Both are kept because they test different dimensions.
- Properties 3.4 (drop cluster if authors < min) and 3.5 (drop cluster if subreddits <
  min) are independent threshold checks. Both are kept.
- Properties 4.8 and 4.9 overlap (builder fields null + status inbox). They are merged
  into a single "structural invariant" property.
- Properties 5.3 and 5.4 (metadata shape + no builder fields) are merged into a single
  "metadata correctness" property.
- Properties 2.3 and 2.4 are combined into a single "filtering" property since both
  describe the same output invariant (surviving posts satisfy both conditions).

---

### Property 1: Post field extraction is complete

*For any* Apify response item, the extracted `Post` object must contain exactly the
fields `id`, `author`, `subreddit`, `score`, `created_utc`, `permalink`, and `body`,
with `body` derived from `selftext ?? body ?? ''`.

**Validates: Requirements 1.3**

---

### Property 2: Deduplication produces unique post ids

*For any* list of posts (including lists with duplicate `id` values), the output of
`scrape()` must contain each `id` at most once.

**Validates: Requirements 1.4**

---

### Property 3: Post count is capped at max_posts_per_run

*For any* list of posts and any `max_posts_per_run` value `n`, the output of `scrape()`
must have length ≤ `n`.

**Validates: Requirements 1.5**

---

### Property 4: Scoring formula is deterministic

*For any* two posts with identical `score` (upvotes) and identical `body` content, the
computed `final_score` values must be equal.

**Validates: Requirements 2.6**

---

### Property 5: Negative upvotes are clamped to zero

*For any* post with a negative `score` field, `base_score` must equal `Math.log1p(0)`,
i.e., `0`.

**Validates: Requirements 2.1**

---

### Property 6: Keyword boost formula is correct

*For any* post body, the `keyword_boost` must equal the sum of all applicable boosts:
`+0.20` if the urgency pattern matches, `+0.10` if the stack pattern matches, `+0.15`
if `created_utc` is within the last 30 days. The `final_score` must equal
`base_score * (1 + keyword_boost)`.

**Validates: Requirements 2.2**

---

### Property 7: Low-signal and stale posts are filtered

*For any* list of posts, every post in the output of `score()` must satisfy both:
`final_score >= 1.0` AND `age_days <= window_days`. No post failing either condition
may appear in the output.

**Validates: Requirements 2.3, 2.4**

---

### Property 8: Cluster membership follows regex patterns

*For any* scored post whose `body` matches `/flaky|intermittent|randomly fails|non-deterministic/i`,
that post must appear in the `flaky-tests` cluster. *For any* scored post whose `body`
matches `/slow ci|ci takes|ci minutes|pipeline takes/i`, that post must appear in the
`slow-ci` cluster. *For any* post matching both patterns, it must appear in both
clusters.

**Validates: Requirements 3.1, 3.2, 3.3**

---

### Property 9: Posts matching no pattern are excluded from all clusters

*For any* scored post whose `body` matches neither cluster pattern, that post must not
appear in any cluster in the output of `cluster()`.

**Validates: Requirements 3.8**

---

### Property 10: Under-represented clusters are dropped

*For any* cluster in the output of `cluster()`, the cluster must have
`uniqueAuthors >= min_unique_authors` AND `subredditCount >= min_subreddit_count`.
No cluster failing either threshold may appear in the output.

**Validates: Requirements 3.4, 3.5**

---

### Property 11: Schema validator correctly identifies valid and invalid cards

*For any* spec.md string that contains all required YAML front-matter fields with
correct types and a non-empty `## Acceptance Criteria` section with at least one
checklist item, `validateCard()` must return `{ valid: true, errors: [] }`. *For any*
spec.md string missing any required field or with an incorrect type, `validateCard()`
must return `{ valid: false, errors: [...] }` with at least one error message.

**Validates: Requirements 4.3, 4.4**

---

### Property 12: Generated card structural invariant

*For any* cluster input, the Build Card produced by `generate()` (whether valid or a
Failed_Card) must have `status` equal to `"inbox"` (or `"failed"` for Failed_Cards)
and all `builder.*` fields set to `null`. The generator must never set any `builder.*`
field to a non-null value.

**Validates: Requirements 4.8, 4.9**

---

### Property 13: Upload metadata is correctly derived from the Build Card

*For any* valid Build Card string, the `metadata` object passed to `uploadCard()` must
satisfy: `status === "inbox"`, `theme === frontMatter.theme`,
`pain_score === frontMatter.signal_strength.score`, `card_id === frontMatter.id`, and
`builder_session_id === null`, `repo_url === null`, `pr_url === null`.

**Validates: Requirements 5.3, 5.4**

---

### Property 14: Exponential backoff delays follow the correct sequence

*For any* sequence of `uploadCard()` failures, the delays between retry attempts must
follow: attempt 2 waits 1000 ms, attempt 3 waits 2000 ms, attempt 4 waits 4000 ms
(capped at 8000 ms). No delay may exceed 8000 ms.

**Validates: Requirements 5.6**


---

## Testing Strategy

### Dual Testing Approach

The test suite uses both **unit/example-based tests** and **property-based tests**
(PBT). They are complementary:

- Unit tests cover specific examples, error conditions, and integration wiring.
- Property tests verify universal invariants across many generated inputs.

### Property-Based Testing Library

Use **[fast-check](https://github.com/dubzzz/fast-check)** (Node.js, ESM-compatible).
Each property test runs a minimum of **100 iterations**.

Tag format for each property test:
```
// Feature: idea-miner, Property {N}: {property_text}
```

### Property Tests (one test per property)

| Property | Module          | fast-check arbitraries                                      |
|----------|-----------------|-------------------------------------------------------------|
| P1       | scraper.mjs     | `fc.record({ id, author, subreddit, score, ... })`          |
| P2       | scraper.mjs     | `fc.array(fc.record({ id: fc.string() }))` with duplicates  |
| P3       | scraper.mjs     | `fc.array(post)`, `fc.integer({ min: 0, max: 200 })`        |
| P4       | scorer.mjs      | `fc.integer()`, `fc.string()` (body)                        |
| P5       | scorer.mjs      | `fc.integer({ max: -1 })` (negative upvotes)                |
| P6       | scorer.mjs      | `fc.string()` (body), `fc.integer()` (created_utc)          |
| P7       | scorer.mjs      | `fc.array(post)`, `fc.integer({ min: 1 })` (window_days)    |
| P8       | cluster.mjs     | `fc.array(scoredPost)` with bodies matching patterns        |
| P9       | cluster.mjs     | `fc.array(scoredPost)` with bodies not matching any pattern |
| P10      | cluster.mjs     | `fc.array(scoredPost)`, `fc.integer` thresholds             |
| P11      | generator.mjs   | `fc.record(...)` (valid/invalid spec.md front-matter)       |
| P12      | generator.mjs   | `fc.record(cluster)` with mocked Claude responses           |
| P13      | uploader.mjs    | `fc.string()` (valid spec.md), mocked BoxClient             |
| P14      | uploader.mjs    | `fc.integer({ min: 1, max: 4 })` (failure count)            |

### Unit / Example Tests

| Requirement | Test description                                                    |
|-------------|---------------------------------------------------------------------|
| 1.1         | Missing config file throws with filename in message                 |
| 1.1         | Malformed JSON config throws with filename in message               |
| 1.2         | Apify request URL includes correct endpoint and token param         |
| 1.6         | HTTP 500 from Apify causes pipeline abort, no Box write             |
| 1.7         | Missing APIFY_TOKEN throws before any HTTP call                     |
| 1.8         | Zero Apify results causes pipeline abort                            |
| 2.7         | Post with missing created_utc is dropped                            |
| 2.7         | Post with non-numeric created_utc is dropped                        |
| 3.7         | All clusters below threshold → log message, no card written         |
| 4.2         | System prompt contains no-preamble instruction                      |
| 4.5         | Validation error on attempt 1 → retry with error appended          |
| 4.6         | Validation error on attempt 2 → Failed_Card with status: "failed"  |
| 4.7         | Missing ANTHROPIC_API_KEY throws before any API call                |
| 4.10        | Transport error on attempt 1 → retry; on attempt 2 → Failed_Card   |
| 5.1         | findDuplicate() is called before uploadCard()                       |
| 5.2         | findDuplicate() returns results → uploadCard() not called           |
| 5.5         | Successful upload logs fileId and cardId                            |
| 5.7         | All retries fail → file written to failed-cards/{cardId}.md         |
| 5.8         | No BoxClient methods other than findDuplicate/uploadCard are called |
| 6.1         | `node idea-miner/index.mjs` runs all five stages in sequence        |
| 6.4         | Unhandled error in any stage → exit code 1                          |
| 6.5         | Successful run → exit code 0                                        |
| 6.8         | Missing APIFY_TOKEN at startup → exit 1 before any network call     |
| 6.8         | Missing ANTHROPIC_API_KEY at startup → exit 1 before any API call   |
| 6.9         | Log output never contains the value of APIFY_TOKEN or ANTHROPIC_API_KEY |

### Test File Layout

```
idea-miner/
└── __tests__/
    ├── scraper.test.mjs
    ├── scorer.test.mjs
    ├── cluster.test.mjs
    ├── generator.test.mjs
    ├── uploader.test.mjs
    └── index.integration.test.mjs
```

Use Node's built-in `node:test` runner (Node 20.11+) or **Vitest** (ESM-native).
Run with `--run` flag for single-pass execution (no watch mode).


---

## Requirement Traceability

| Requirement | Design element                                                                 |
|-------------|--------------------------------------------------------------------------------|
| 1.1         | `index.mjs` startup: load config before instantiating scraper; throw on error  |
| 1.2         | `scraper.mjs`: Apify endpoint URL + `?token=` query param construction         |
| 1.3         | `scraper.mjs`: field mapping from Apify item to `Post` type                    |
| 1.4         | `scraper.mjs`: `dedup()` helper; Property 2                                    |
| 1.5         | `scraper.mjs`: `cap()` helper; Property 3                                      |
| 1.6         | `scraper.mjs`: propagate HTTP errors; error handling table                     |
| 1.7         | `index.mjs` startup: env var validation before any network call                |
| 1.8         | `scraper.mjs`: throw on zero results; error handling table                     |
| 2.1         | `scorer.mjs`: `computeBaseScore()` with `Math.max(0, upvotes)`; Property 5     |
| 2.2         | `scorer.mjs`: `computeKeywordBoost()` with three boost constants; Property 6   |
| 2.3         | `scorer.mjs`: filter `final_score < 1.0`; Property 7                          |
| 2.4         | `scorer.mjs`: filter `age > window_days`; Property 7                          |
| 2.5         | `scorer.mjs`: return value is only surviving posts                             |
| 2.6         | `scorer.mjs`: pure functions, no side effects; Property 4                      |
| 2.7         | `scorer.mjs`: `isValidTimestamp()` guard; drop post if invalid                 |
| 3.1         | `cluster.mjs`: `PATTERNS['flaky-tests']` regex; Property 8                    |
| 3.2         | `cluster.mjs`: `PATTERNS['slow-ci']` regex; Property 8                        |
| 3.3         | `cluster.mjs`: test both patterns per post; Property 8                         |
| 3.4         | `cluster.mjs`: `meetsThresholds()` checks `uniqueAuthors`; Property 10        |
| 3.5         | `cluster.mjs`: `meetsThresholds()` checks `subredditCount`; Property 10       |
| 3.6         | `cluster.mjs`: return value is only surviving clusters                         |
| 3.7         | `cluster.mjs`: throw if no clusters survive; error handling table              |
| 3.8         | `cluster.mjs`: posts not matching any pattern excluded; Property 9             |
| 3.9         | `cluster.mjs`: threshold evaluation before forwarding (sequential logic)       |
| 4.1         | `generator.mjs`: `buildUserPrompt()` includes all required cluster fields      |
| 4.2         | `generator.mjs`: `buildSystemPrompt()` includes no-preamble instruction        |
| 4.3         | `generator.mjs`: `validateCard()` checks all §5.2 required fields; Property 11|
| 4.4         | `generator.mjs`: `validateCard()` checks `## Acceptance Criteria`; Property 11|
| 4.5         | `generator.mjs`: retry logic with error appended to prompt                     |
| 4.6         | `generator.mjs`: `injectFailedStatus()` produces Failed_Card                  |
| 4.7         | `index.mjs` startup: `ANTHROPIC_API_KEY` validation                           |
| 4.8         | `generator.mjs`: never writes `builder.*` fields; Property 12                 |
| 4.9         | `generator.mjs`: structural invariant on status and builder block; Property 12 |
| 4.10        | `generator.mjs`: transport errors treated as validation errors                 |
| 5.1         | `uploader.mjs`: `findDuplicate()` called before `uploadCard()`                 |
| 5.2         | `uploader.mjs`: early return with "duplicate suppressed" log                   |
| 5.3         | `uploader.mjs`: `buildMetadata()` derives fields from front-matter; Property 13|
| 5.4         | `uploader.mjs`: `buildMetadata()` sets builder fields to null; Property 13     |
| 5.5         | `uploader.mjs`: log `fileId` and `cardId` on success                          |
| 5.6         | `uploader.mjs`: `withExponentialBackoff()` with 3 retries; Property 14        |
| 5.7         | `uploader.mjs`: `writeFailedCard()` fallback to `failed-cards/`               |
| 5.8         | `uploader.mjs`: only `findDuplicate` and `uploadCard` called on BoxClient      |
| 6.1         | `index.mjs`: sequential pipeline execution                                     |
| 6.2         | `index.mjs`: load both config files at startup, pass to sub-modules            |
| 6.3         | `index.mjs`: import `FileSystemBoxClient` from `contracts/box-client-mock.mjs` |
| 6.4         | `index.mjs`: top-level `try/catch` → log + `process.exit(1)`                  |
| 6.5         | `index.mjs`: `process.exit(0)` after successful upload or duplicate suppressed |
| 6.6         | `index.mjs`: ESM `import`/`export` throughout; `"type": "module"` in package  |
| 6.7         | `generator.mjs`: schema template from `fixtures/sample-spec.md` in prompt     |
| 6.8         | `index.mjs`: env var validation at startup, before any external call           |
| 6.9         | All modules: reference env vars by name only in log output                     |
