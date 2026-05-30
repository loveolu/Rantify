# orchestrator/ — AI Builder Orchestrator (Person C)

Turns a `ready-for-build` Build Card into a scaffolded repo + PR + Box task, and on human
approval resumes the same Claude Code session, refines, and marks the card `completed`.

Implements SPEC.md §8–§9. Design: [`../docs/superpowers/specs/2026-05-30-orchestrator-design.md`](../docs/superpowers/specs/2026-05-30-orchestrator-design.md).

## Run it offline (no Box / GitHub / Claude)

```bash
node orchestrator/verify-orchestrator.mjs   # full lifecycle against the Box mock + stubbed externals
node --test orchestrator/*.test.mjs         # unit + integration tests
```

## Run it for real

```bash
ORCH_STUB_EXTERNALS=   # unset → real git/gh/claude/npm
PORT=8080 node orchestrator/index.mjs       # POST /webhooks/box + 30s poller
```

Requires the env vars in SPEC.md §13 (`GITHUB_TOKEN`, `GITHUB_ORG`, `BOX_WEBHOOK_*`,
`BEDROCK_MODEL_ID`, …) and `git`, `gh`, `node`, `npm` on PATH. AWS credentials
are resolved by the SDK (env vars, `~/.aws/credentials`, or IAM role).

## Map

| Concern | File |
|---|---|
| Trigger in (HMAC, 401) | `server.mjs`, `hmac.mjs` |
| Trigger in (demo poll) | `poller.mjs` |
| Route + idempotency guards | `lifecycle.mjs` |
| Phase 1 scaffold / Phase 2 refine | `phase1-scaffold.mjs`, `phase2-refine.mjs` |
| External tools (one `run()` seam) | `git-github.mjs`, `claude-code.mjs`, `build-runner.mjs`, `run.mjs` |
| Pure helpers | `slug.mjs`, `secret-scan.mjs`, `pr-body.mjs`, `review-notes.mjs` |
| Config / bootstrap | `config.mjs`, `index.mjs` |
| Offline test seam | `stub-run.mjs`, `verify-orchestrator.mjs` |

**Going live:** swap the one marked Box-client import in `index.mjs` from the mock to
Person B's `RealBoxClient`. Nothing else changes.
