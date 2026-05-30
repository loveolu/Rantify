# idea-miner/ — Idea Miner (Person A)

Scrapes Reddit, scores + clusters developer complaints, generates a Build Card via Claude,
and uploads it to Box as an `inbox` card. Implements SPEC.md §6. Pipeline:

```
scrape (Apify) → score → cluster → generate (Claude) → upload (Box)
```

## Run offline (no Apify / Anthropic / real Box)

```bash
node idea-miner/verify-pipeline.mjs        # full pipeline, stubbed externals → card in mock Box + de-dup
node --test idea-miner/__tests__/*.test.mjs # unit + property tests (fast-check)
```

## Run for real

```bash
export APIFY_TOKEN=...        # Reddit scrape
export ANTHROPIC_API_KEY=...  # Build Card generation
node idea-miner/index.mjs
```

Writes to the Box **mock** by default. To target real Box, swap the one import in
`index.mjs` from `contracts/box-client-mock.mjs` to `box-hub/index.mjs`'s `RealBoxClient`.

## Modules (build order)

| Module | Purpose | SPEC |
|---|---|---|
| `scorer.mjs` | `log1p` base + keyword boost; drop low-signal/stale | §6.3 |
| `cluster.mjs` | keyword clusters (flaky-tests / slow-ci); threshold filter | §6.4 |
| `scraper.mjs` | Apify Reddit scrape, dedup + cap (`fetch` injectable) | §6.2 |
| `generator.mjs` | Claude call + §5.2 schema validation, retry-once, Failed_Card | §6.5 |
| `uploader.mjs` | de-dup → upload with 1s/2s/4s backoff → `failed-cards/` fallback | §6.6 |
| `index.mjs` | pipeline wiring, env/config validation, exit codes | §6 |

## Testing notes

- `node:test` + `fast-check` (Properties 1–14 from `.kiro/specs/idea-miner/design.md`).
- External calls (Apify, Anthropic) are injected, never hit in tests.
- **Improvement over the Kiro spec:** `js-yaml` is used for robust front-matter parsing
  (the design called for YAML parsing but named no parser), and the generator targets the
  current Haiku model with prompt caching on the schema-bearing system prompt.
