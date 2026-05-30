# Requirements Document

## Introduction

The Idea Miner is a Node.js (ESM, Node 20.11+) pipeline that forms Person A's component
of the DevTool Discovery & Build Loop system (SPEC.md §6). It runs as a standalone
script (`idea-miner/index.mjs`) and executes five sequential steps:

1. **Scrape** — fetch Reddit posts via the Apify `apify/reddit-scraper` actor using
   keywords and subreddits from `config/idea-miner.json`.
2. **Score** — apply a logarithmic scoring formula with keyword boosts; drop low-signal
   and stale posts.
3. **Cluster** — group surviving posts into named buckets by keyword regex; drop
   under-represented clusters.
4. **Generate Build Card** — call the Anthropic Claude API with a strict prompt; validate
   the YAML+Markdown output against the §5.2 schema; retry once on failure; write a
   `status=failed` card if still invalid.
5. **Upload to Box** — de-duplicate against recent cards of the same theme, then upload
   via `contracts/box-client.mjs` (`findDuplicate()` + `uploadCard()` only).

The pipeline builds and tests against `contracts/box-client-mock.mjs` (filesystem fake).
All secrets are supplied via environment variables. No `builder.*` fields are ever set
by this component.

---

## Glossary

- **Idea_Miner**: The Node.js pipeline described in this document (`idea-miner/index.mjs`
  and its sub-modules).
- **Reddit_Scraper**: The Apify `apify/reddit-scraper` actor used to fetch raw posts.
- **Post_Scorer**: The sub-module that applies the scoring formula and drops low-signal
  posts.
- **Cluster_Engine**: The sub-module that groups scored posts into named clusters and
  drops under-represented ones.
- **Build_Card_Generator**: The sub-module that calls the Anthropic Claude API, validates
  the response, and produces a `spec.md` string.
- **Box_Uploader**: The sub-module that calls `findDuplicate()` and `uploadCard()` on the
  Box client contract.
- **Box_Client**: The object imported from `contracts/box-client.mjs` (or its mock) that
  exposes `findDuplicate()` and `uploadCard()`.
- **Build_Card**: A YAML-front-matter + Markdown file (`spec.md`) conforming to the §5.2
  schema, representing a discovered developer pain point and a proposed tool.
- **Card_Metadata**: The `CardMetadata` object (defined in `contracts/box-client.mjs`)
  applied to every uploaded `spec.md`: `{ status, theme, pain_score, card_id, ... }`.
- **Schema_Validator**: The internal function that checks a Build Card string against the
  §5.2 required fields.
- **Config**: The JSON object loaded from `config/idea-miner.json` at startup.
- **Theme_Registry**: The JSON object loaded from `config/themes.json` at startup.
- **Cluster**: A named group of posts sharing a keyword pattern (e.g., `flaky-tests`,
  `slow-ci`).
- **Duplicate**: An existing non-failed card in Box with the same `theme` whose metadata
  file was last modified within the configured de-duplication window (7 days).
- **Failed_Card**: A Build Card uploaded with `status=failed`, containing raw LLM output,
  written when schema validation fails after one retry.
- **window_days**: The `window_days` field from Config; posts older than this are dropped.
- **min_unique_authors**: The `min_unique_authors` field from Config; clusters below this
  threshold are dropped.
- **min_subreddit_count**: The `min_subreddit_count` field from Config; clusters below
  this threshold are dropped.
- **APIFY_TOKEN**: Environment variable holding the Apify API authentication token.
- **ANTHROPIC_API_KEY**: Environment variable holding the Anthropic API key.

---

## Requirements

### Requirement 1: Reddit Scraper — Raw Post Collection

**User Story:** As a developer running the Idea Miner, I want the pipeline to fetch
relevant Reddit posts automatically, so that I have a structured set of real developer
complaints to analyze without manual browsing.

#### Acceptance Criteria

1. WHEN the Idea_Miner starts, THE Reddit_Scraper SHALL load `config/idea-miner.json`
   and use its `subreddits`, `keywords`, and `max_posts_per_run` fields to configure the
   Apify actor call. IF the config file is missing or cannot be parsed as valid JSON,
   THEN THE Reddit_Scraper SHALL throw an error naming the file and exit before making
   any network call.

2. WHEN the Reddit_Scraper calls the Apify actor, THE Reddit_Scraper SHALL send a
   `POST` request to
   `https://api.apify.com/v2/acts/apify~reddit-scraper/run-sync-get-dataset-items`
   with the `APIFY_TOKEN` environment variable as the `token` query parameter.

3. WHEN the Apify actor returns results, THE Reddit_Scraper SHALL capture the following
   fields for each item: `id`, `author`, `subreddit`, `score` (upvotes), `created_utc`,
   `permalink`, and `selftext` or `body`.

4. WHEN the Apify actor returns duplicate post `id` values across keyword searches, THE
   Reddit_Scraper SHALL deduplicate the result set so each post `id` appears at most once.

5. THE Reddit_Scraper SHALL cap the total collected posts at the `max_posts_per_run`
   value from Config before passing results to the Post_Scorer.

6. IF the Apify actor call returns an HTTP error or a network failure, THEN THE
   Reddit_Scraper SHALL log the error, abort the pipeline run, and write no partial card
   to Box.

7. IF the `APIFY_TOKEN` environment variable is not set, THEN THE Reddit_Scraper SHALL
   throw an error that names the missing variable and states that no network call was
   made, before making any network call.

8. IF the Apify actor returns zero results for all keyword searches, THEN THE
   Reddit_Scraper SHALL log a message indicating zero posts were collected and the
   pipeline SHALL abort without writing any card to Box.

---

### Requirement 2: Post Scorer — Scoring Formula and Filtering

**User Story:** As a developer running the Idea Miner, I want each collected post to
receive a relevance score and low-signal posts to be dropped, so that only posts with
genuine developer pain reach the clustering step.

#### Acceptance Criteria

1. WHEN the Post_Scorer receives a post, THE Post_Scorer SHALL compute
   `base_score = log1p(upvotes)` where `upvotes` is the post's `score` field. IF
   `upvotes` is negative, THE Post_Scorer SHALL treat it as `0` before computing
   `base_score`.

2. WHEN the Post_Scorer computes a post's score, THE Post_Scorer SHALL sum all
   applicable keyword boosts into a single `keyword_boost` value and apply
   `final_score = base_score * (1 + keyword_boost)`:
   - `+0.20` if the post body matches `/hours|days|blocked|prod|deploy/i`
   - `+0.10` if the post body matches `/monorepo|github actions|ci minutes/i`
   - `+0.15` if the post's `created_utc` is within the last 30 days

3. WHEN the Post_Scorer evaluates a post, THE Post_Scorer SHALL drop the post if its
   `final_score` is less than `1.0`.

4. WHEN the Post_Scorer evaluates a post, THE Post_Scorer SHALL drop the post if the
   post's age in days (derived from `created_utc`) exceeds `window_days` from Config.
   Criteria 3 and 4 are evaluated independently; a post is dropped if either condition
   is met.

5. WHEN the Post_Scorer finishes evaluating all posts, THE Post_Scorer SHALL pass only
   surviving posts (those not dropped by criteria 3 or 4) to the Cluster_Engine.

6. THE Post_Scorer SHALL produce identical `final_score` values for any two posts that
   have identical `upvotes` values and identical body content (deterministic scoring).

7. IF a post's `created_utc` field is missing or cannot be parsed as a valid Unix
   timestamp, THEN THE Post_Scorer SHALL drop the post and SHALL NOT apply the recency
   boost for that post.

---

### Requirement 3: Cluster Engine — Keyword Clustering and Threshold Filtering

**User Story:** As a developer running the Idea Miner, I want scored posts grouped into
named clusters and under-represented clusters dropped, so that only clusters with
sufficient real-world signal are forwarded to card generation.

#### Acceptance Criteria

1. WHEN the Cluster_Engine receives a scored post, THE Cluster_Engine SHALL assign it to
   the `flaky-tests` cluster if the post body matches
   `/flaky|intermittent|randomly fails|non-deterministic/i`.

2. WHEN the Cluster_Engine receives a scored post, THE Cluster_Engine SHALL assign it to
   the `slow-ci` cluster if the post body matches
   `/slow ci|ci takes|ci minutes|pipeline takes/i`.

3. WHEN a post matches both cluster patterns, THE Cluster_Engine SHALL include that post
   in both the `flaky-tests` cluster and the `slow-ci` cluster.

4. WHEN the Cluster_Engine evaluates a cluster, THE Cluster_Engine SHALL drop the cluster
   if the count of distinct `author` values within it is less than `min_unique_authors`
   from Config (default: 5).

5. WHEN the Cluster_Engine evaluates a cluster, THE Cluster_Engine SHALL drop the cluster
   if the count of distinct `subreddit` values within it is less than
   `min_subreddit_count` from Config (default: 2).

6. WHEN the Cluster_Engine finishes evaluating all clusters, THE Cluster_Engine SHALL
   pass only surviving clusters (those not dropped by criteria 4 or 5) to the
   Build_Card_Generator.

7. IF all clusters are dropped, THEN THE Cluster_Engine SHALL log a message indicating
   no clusters met the thresholds; no clusters SHALL be forwarded to the
   Build_Card_Generator, and no card SHALL be written to Box.

8. WHEN a post matches neither the `flaky-tests` nor the `slow-ci` cluster pattern, THE
   Cluster_Engine SHALL silently exclude that post from all clusters without logging an
   error.

9. WHEN all scored posts have been assigned to clusters, THE Cluster_Engine SHALL
   evaluate each cluster's thresholds (criteria 4 and 5) before forwarding any cluster
   to the Build_Card_Generator.

---

### Requirement 4: Build Card Generator — LLM Prompt, Schema Validation, and Retry Logic

**User Story:** As a developer running the Idea Miner, I want the pipeline to
automatically generate a well-structured Build Card from clustered complaints, so that
a human-reviewable spec is produced without manual writing.

#### Acceptance Criteria

1. WHEN the Build_Card_Generator receives a surviving cluster, THE Build_Card_Generator
   SHALL call the Anthropic Claude API using the `ANTHROPIC_API_KEY` environment variable,
   sending a prompt that includes: the theme, complaint count, unique author count,
   subreddit list, paraphrased complaint texts (with usernames and PII stripped), and the
   full §5.2 schema as a formatting template.

2. WHEN the Build_Card_Generator constructs the prompt, THE Build_Card_Generator SHALL
   instruct the model to return ONLY the YAML+Markdown file content with no preamble,
   no code fences, and no commentary.

3. WHEN the Build_Card_Generator receives a response from the Claude API, THE
   Schema_Validator SHALL verify that all of the following fields are present and
   correctly typed in the YAML front-matter:
   - `id` — a valid UUID v4 string
   - `schema_version` — the string `"1"`
   - `created_at` — an ISO 8601 UTC timestamp string; on initial generation `created_at`
     must equal `updated_at`
   - `updated_at` — an ISO 8601 UTC timestamp string
   - `title` — a non-empty string
   - `theme` — a string matching a `themes[].id` value in `config/themes.json`
   - `status` — exactly the string `"inbox"`
   - `persona.role`, `persona.org_size`, `persona.stack_context` — non-empty strings
   - `proof_of_pain.unique_authors` — a positive integer
   - `proof_of_pain.subreddit_count` — a positive integer
   - `proof_of_pain.timeframe_days` — a positive integer
   - `proof_of_pain.sample_complaints` — a non-empty array with at least one entry
     containing `text`, `source_url`, `reddit_score`, and `scraped_at`
   - `why_now` — a non-empty array of strings
   - `build_suggestion.summary` — a non-empty string
   - `build_suggestion.key_capabilities` — a non-empty array of strings
   - `build_suggestion.tech_constraints` — an object with at least `language` and
     `runtime` fields
   - `signal_strength.score` — a float in the range `[0.0, 1.0]`
   - `signal_strength.explanation` — a non-empty string
   - `builder` block — present with all sub-fields set to `null`

4. WHEN the Schema_Validator validates a Build Card, THE Schema_Validator SHALL verify
   that the Markdown body contains a non-empty `## Acceptance Criteria` section with at
   least one checklist item.

5. IF the Schema_Validator finds a validation error on the first attempt, THEN THE
   Build_Card_Generator SHALL retry the Claude API call exactly once, appending the
   validation error message to the prompt.

6. IF the Schema_Validator finds a validation error on the retry attempt, THEN THE
   Build_Card_Generator SHALL produce a Failed_Card: a `spec.md` string where the raw
   LLM output is preserved as-is and `status: "failed"` is injected as the first field
   in the YAML front-matter.

7. IF the `ANTHROPIC_API_KEY` environment variable is not set, THEN THE
   Build_Card_Generator SHALL throw an error that names the missing variable and states
   that no API call was made, before making any API call.

8. THE Build_Card_Generator SHALL never set any field under the `builder:` block to a
   non-null value; all `builder.*` fields in the generated card SHALL be `null`.

9. THE Build_Card_Generator SHALL produce a Build Card where `status` is `"inbox"` and
   the `builder` block contains only `null` values (structural invariant, independent of
   LLM non-determinism).

10. IF the Claude API call fails due to a transport error (network failure, rate limit
    response, or non-2xx HTTP status), THEN THE Build_Card_Generator SHALL treat the
    failure as a validation error on that attempt: if it is the first attempt, retry
    once; if it is the retry attempt, produce a Failed_Card with the error message as
    the raw content.

---

### Requirement 5: Box Uploader — De-duplication and Card Upload

**User Story:** As a developer running the Idea Miner, I want the pipeline to skip
uploading a card when a recent card for the same theme already exists, and otherwise
upload the card with the correct metadata, so that Box Inbox does not accumulate
redundant cards.

#### Acceptance Criteria

1. WHEN the Box_Uploader is about to upload a card, THE Box_Uploader SHALL call
   `Box_Client.findDuplicate({ theme, withinDays: 7 })` before calling `uploadCard()`.

2. IF `findDuplicate()` returns one or more results, THEN THE Box_Uploader SHALL skip
   the upload, log the message `"duplicate suppressed"` along with the matching card
   reference(s), and resolve without throwing an error.

3. WHEN the Box_Uploader uploads a card, THE Box_Uploader SHALL call
   `Box_Client.uploadCard({ cardId, specMarkdown, metadata })` where:
   - `cardId` equals the `id` field from the Build Card's YAML front-matter
   - `specMarkdown` is the full YAML+Markdown string of the Build Card
   - `metadata.status` is exactly `"inbox"`
   - `metadata.theme` matches the `theme` field from the Build Card front-matter
   - `metadata.pain_score` equals `signal_strength.score` from the Build Card front-matter
   - `metadata.card_id` equals `cardId`

4. THE Box_Uploader SHALL never set `metadata.builder_session_id`, `metadata.repo_url`,
   or `metadata.pr_url` to any non-null value.

5. WHEN `uploadCard()` returns successfully, THE Box_Uploader SHALL log the returned
   `fileId` and `cardId`.

6. IF `uploadCard()` throws an error, THEN THE Box_Uploader SHALL retry the call up to
   3 times (4 total attempts) with exponential backoff starting at 1 second, doubling
   each retry, capped at 8 seconds.

7. IF all 3 retry attempts fail, THEN THE Box_Uploader SHALL write the Build Card
   content to a local file at `failed-cards/{cardId}.md` and log an error message
   indicating the upload failure and the local fallback path.

8. THE Box_Uploader SHALL only call `findDuplicate()` and `uploadCard()` on the
   Box_Client; it SHALL NOT call any other method on the Box_Client contract.

---

### Requirement 6: Pipeline Runner — End-to-End Orchestration

**User Story:** As a developer, I want a single entry-point script that wires all five
pipeline steps together, so that running `node idea-miner/index.mjs` executes the full
Reddit-to-Box flow with a single command.

#### Acceptance Criteria

1. THE Idea_Miner SHALL expose a single entry-point at `idea-miner/index.mjs` that,
   when executed with `node idea-miner/index.mjs`, runs all five steps (scrape → score
   → cluster → generate → upload) in sequence.

2. WHEN the pipeline runs, THE Idea_Miner SHALL load `config/idea-miner.json` and
   `config/themes.json` at startup and pass the parsed config to each sub-module.

3. WHEN the pipeline runs, THE Idea_Miner SHALL instantiate the Box_Client by importing
   from `contracts/box-client-mock.mjs` (swappable to the real client via a single
   import change).

4. WHEN any pipeline step throws an unhandled error, THE Idea_Miner SHALL catch the
   error, log it with a human-readable message, and exit the process with a non-zero
   exit code.

5. WHEN the pipeline completes successfully (card uploaded or duplicate suppressed), THE
   Idea_Miner SHALL exit the process with exit code `0`.

6. WHEN the pipeline runs, THE Idea_Miner SHALL use ESM module syntax (`import`/`export`)
   throughout and SHALL be compatible with Node.js 20.11 or later.

7. WHEN the pipeline produces a Build Card, THE Idea_Miner SHALL ensure the card's
   YAML+Markdown structure matches the shape of `fixtures/sample-spec.md` (all top-level
   sections present: Identity, Classification, Target user, Evidence, What to build,
   Builder block, Problem Summary, Proposed Tool, Acceptance Criteria).

8. IF the `APIFY_TOKEN` or `ANTHROPIC_API_KEY` environment variables are absent at
   startup, THEN THE Idea_Miner SHALL log a descriptive error naming the missing
   variable(s) and exit with a non-zero exit code before making any external call.

9. THE Idea_Miner SHALL never commit or log the values of `APIFY_TOKEN` or
   `ANTHROPIC_API_KEY`; it SHALL reference them only by name in any log output.
