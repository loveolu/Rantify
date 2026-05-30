---
# ─── Identity (set once by Idea Miner; never changes) ───────────────────────
id: "550e8400-e29b-41d4-a716-446655440000"
schema_version: "1"
created_at: "2025-07-01T10:00:00Z"
updated_at: "2025-07-01T10:00:00Z"

# ─── Classification ─────────────────────────────────────────────────────────
title: "Flaky test triage helper for GitHub Actions monorepos"
theme: "testing-ci"
status: "inbox"

# ─── Target user ─────────────────────────────────────────────────────────────
persona:
  role: "backend-dev"
  org_size: "50-200"
  stack_context: "Node.js monorepo, GitHub Actions, ~800 test suite"

# ─── Evidence ────────────────────────────────────────────────────────────────
proof_of_pain:
  unique_authors: 12
  subreddit_count: 3
  timeframe_days: 60
  sample_complaints:
    - text: >
        Paraphrased: team spends ~2h every Friday re-running flaky Playwright
        tests before deploy; no way to tell reliably-flaky from actually-broken.
      source_url: "https://reddit.com/r/ExamplePermalink"
      reddit_score: 87
      scraped_at: "2025-06-28T08:00:00Z"

why_now:
  - "GitHub Actions monorepos are the dominant CI setup for teams this size"
  - "Three posts in the last 60 days from teams with near-identical stacks"
  - "No standard OSS tool tracks per-branch flakiness without a paid service"

# ─── What to build ───────────────────────────────────────────────────────────
build_suggestion:
  summary: >
    A CLI that reads GitHub Actions run history, finds tests that fail
    non-deterministically across identical code states, and outputs a ranked
    flakiness report per test file.
  key_capabilities:
    - "gh-flaky scan --repo owner/repo --branch main --window 30d"
    - "gh-flaky report --format json|table|csv"
    - "gh-flaky ignore <test-pattern>"
  tech_constraints:
    language: "TypeScript"
    runtime: "Node 20"
    distribution: "npm package + single binary via pkg"
    storage: "no DB; caches API responses to .flaky-cache/ (gitignored)"
    auth: "reads GITHUB_TOKEN from env; never persisted"

signal_strength:
  score: 0.82
  explanation: >
    High unique-author count (12), multi-subreddit spread (3), all complaints
    within 60 days, strong stack overlap with target persona.

links:
  reddit_threads:
    - "https://reddit.com/r/programming/..."
    - "https://reddit.com/r/devops/..."

# ─── Builder block (written ONLY by the Orchestrator; null until set) ────────
builder:
  session_id: null
  repo_url: null
  pr_url: null
  box_task_id: null
  phase: null
  last_run_at: null
  tests_pass: null
  build_pass: null
---

# Flaky test triage helper for GitHub Actions monorepos

## Problem Summary
Backend teams on Node.js monorepos with GitHub Actions burn hours every week
re-running flaky tests before deploy. They cannot reliably distinguish a test that
is flaky from a test that is genuinely broken, so they re-run blindly and lose
confidence in the suite.

## Proposed Tool
`gh-flaky`, a CLI that reads GitHub Actions run history, detects tests that fail
non-deterministically across identical code states, and emits a ranked flakiness
report. No database; it caches API responses locally and reads `GITHUB_TOKEN` from
the environment.

## Acceptance Criteria
- [ ] `gh-flaky scan` exits 0 on a valid repo and produces output.
- [ ] `gh-flaky scan` exits non-zero with a human-readable error on an invalid token.
- [ ] Report output is deterministic given identical API responses.
- [ ] Unit tests cover the happy path and ≥2 error cases.
- [ ] README covers: what it does, install, one worked example, known limitations.
