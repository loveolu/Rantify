# idea-miner/ — Idea Miner (Person A)

Scrapes Reddit, scores + clusters developer complaints, generates a Build Card via Claude
on **Amazon Bedrock**, and uploads it to Box as an `inbox` card. Implements SPEC.md §6. Pipeline:

```
scrape (Apify) → score → cluster → generate (Claude) → upload (Box)
```

### Query-driven feedback mining (Rantify)

`mine.mjs` exposes `mineFromQuery({ query, subreddit?, creatorEmail? }, deps)` — the user-facing
flow behind the dashboard's `POST /api/mine`. Instead of fixed dev-pain clusters it takes a
free-text subject (a company or feature) and an optional subreddit:

```
interpret (Bedrock) → scrape (Apify, subreddit-scoped) → score → group → generate (Bedrock) → upload (Box, inbox)
```

The interpreter expands the request into Reddit search phrases + a theme; the generator writes
an implementation spec (problem + solution-as-instructions + acceptance criteria) under the
`product-feedback` theme. The card lands in `Inbox/` and rides the same build loop.

## Run offline (no Apify / Bedrock / real Box)

```bash
node idea-miner/verify-pipeline.mjs        # full pipeline, stubbed externals → card in mock Box + de-dup
node --test idea-miner/__tests__/*.test.mjs # unit + property tests (fast-check)
```

## Run for real

```bash
export APIFY_TOKEN=...                    # Reddit scrape
export AWS_REGION=us-east-1               # Bedrock region
export AWS_ACCESS_KEY_ID=...              # standard AWS credential chain
export AWS_SECRET_ACCESS_KEY=...
# optional: export BEDROCK_MODEL_ID=...   # overrides config/idea-miner.json bedrock_model_id
node idea-miner/index.mjs
```

Bedrock model defaults to `anthropic.claude-3-5-haiku-20241022-v1:0` (set in
`config/idea-miner.json`). Your IAM principal needs `bedrock:InvokeModel` on that model.

Writes to the Box **mock** by default. To target real Box, swap the one import in
`index.mjs` from `contracts/box-client-mock.mjs` to `box-hub/index.mjs`'s `RealBoxClient`.

## Modules (build order)

| Module | Purpose | SPEC |
|---|---|---|
| `bedrock.mjs` | shared Amazon Bedrock (Claude) client; injectable `send` | §13 |
| `interpreter.mjs` | free-text query → `{ subject, searchPhrases, theme, subreddit? }` via Bedrock | §6.1 |
| `scorer.mjs` | `log1p` base + keyword boost (+ optional subject relevance); drop low-signal/stale | §6.3 |
| `cluster.mjs` | keyword clusters (flaky-tests / slow-ci); threshold filter | §6.4 |
| `scraper.mjs` | Apify Reddit scrape, subreddit-scoped, dedup + cap (`fetch` injectable) | §6.2 |
| `generator.mjs` | Bedrock Claude call + §5.2 schema validation, retry-once, Failed_Card | §6.5 |
| `uploader.mjs` | de-dup → upload with 1s/2s/4s backoff → `failed-cards/` fallback | §6.6 |
| `mine.mjs` | `mineFromQuery()` — query-driven interpret→scrape→score→group→generate→upload | §6 |
| `index.mjs` | pipeline wiring, env/config validation, exit codes | §6 |

## Testing notes

- `node:test` + `fast-check` (Properties 1–14 from `.kiro/specs/idea-miner/design.md`).
- External calls (Apify, Bedrock) are injected, never hit in tests.
- **Improvement over the Kiro spec:** `js-yaml` for robust front-matter parsing, and
  Amazon Bedrock (`@aws-sdk/client-bedrock-runtime`) instead of the direct Anthropic API.
