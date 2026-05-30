# DevTool Discovery & Build Loop — Engineering Specification

- **Version:** 1.0
- **Status:** Approved for hackathon implementation
- **Owner:** _(set this)_
- **Last updated:** _(set this)_
- **Canonical location:** `specs/devtool-loop/SPEC.md`

> This document is the **single source of truth** for the system. If all code and
> runtime state were lost, the system must be fully regenerable from this spec, the
> Build Card data model (§5), the prompt files in `prompts/`, and the content stored
> in Box. Any deviation made in code must be recorded in the Decisions Log (§13),
> not made silently.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Scope & Non-Goals](#2-scope--non-goals)
3. [Users & Personas](#3-users--personas)
4. [Architecture Overview](#4-architecture-overview)
5. [Data Model: DevTool Build Card](#5-data-model-devtool-build-card)
6. [Component: Idea Miner](#6-component-idea-miner)
7. [Component: Box Content Hub](#7-component-box-content-hub)
8. [Component: AI Builder Orchestrator](#8-component-ai-builder-orchestrator)
9. [Component: Claude Code Integration](#9-component-claude-code-integration)
10. [Inter-Component Contracts](#10-inter-component-contracts)
11. [Error Handling & Failure Modes](#11-error-handling--failure-modes)
12. [Non-Functional Requirements](#12-non-functional-requirements)
13. [Configuration & Secrets Reference](#13-configuration--secrets-reference)
14. [Implementation Phases](#14-implementation-phases)
15. [Decisions Log & Open Questions](#15-decisions-log--open-questions)
16. [Glossary](#16-glossary)

---

## 1. Problem Statement

### 1.1 Context

Staff and senior engineers at 50–200-person B2B SaaS companies routinely identify
internal tooling gaps — most commonly around flaky tests and slow CI pipelines. The
current path from "noticing a pain" to "having a working tool" is manual, lossy, and
untraceable: an engineer sees complaints on Slack or a forum, writes a spec from
memory, and scaffolds a repo if they find the time. Evidence is rarely captured,
specs are informal, and the link between "why we built this" and "what we built" is lost.

### 1.2 The Three Gaps This System Closes

| Gap | Today | With this system |
|-----|-------|------------------|
| **Discovery** | Gut feel, anecdotes | Structured scrape of public developer forums, scored against real signal |
| **Spec authoring** | Informal, untraceable | Auto-generated Build Cards linked directly to source complaints |
| **Implementation** | Manual coding or generic LLM prompting | Claude Code sessions driven by a formal spec, with explicit human approval gates |

### 1.3 What This System Is Not

It is not a feedback-analytics product, a CI tool, or a code-review bot. It is a
**traceable pipeline**: _pain observed in public_ → _spec stored in Box_ → _scaffolded
repo ready for human review_.

---

## 2. Scope & Non-Goals

### 2.1 In Scope (Hackathon)

- End-to-end demo for **one domain**: flaky tests / slow CI for backend engineers.
- Automatic generation of ≥1 Build Card in Box from real Reddit data via Apify.
- On `status=ready-for-build`:
  - Create or clone a Git repo.
  - Run a Claude Code session to scaffold a minimal dev tool (e.g., a flaky-test triage CLI).
  - Create a Box task and a GitHub PR for human review.
- On human approval (`status=building-approved`):
  - Resume the **same** Claude Code session (by session ID — not a fresh prompt).
  - Improve tests and README.
  - Mark Build Card `status=completed`; write a build summary to Box.

### 2.2 Explicitly Out of Scope

- Authentication, billing, multi-tenancy.
- Production infrastructure (Kubernetes, autoscaling, multi-region). A single container is fine.
- Domains beyond testing/CI — the design must be extensible, but only one domain is implemented.
- Box Automate no-code flows — use programmable webhooks instead (see §7).
- Any UI beyond a CLI and Box's native file browser.

---

## 3. Users & Personas

### 3.1 Primary — Staff / Senior Backend Engineer

- Identifies 2–3 tooling problems per quarter worth a small internal tool.
- Needs evidence from real developers, not intuition.
- Wants to go from "pain identified" → "scaffolded repo" with minimal manual overhead.
- **Current cost:** writing a spec then context-switching into scaffolding takes 3–5 hours for something that should take 30 minutes.

### 3.2 Secondary — Platform / Dev-Ex PM

- Wants full traceability: every tool links back to the evidence that motivated it.
- Wants a lightweight approval gate before AI-generated code is merged.

### 3.3 Secondary — Engineering Manager

- Wants a mandatory human gate before any AI-generated code reaches a main branch.
- Does not want surprise repos or surprise dependencies.

---

## 4. Architecture Overview

### 4.1 Components

```
┌────────────────────────────────────────────────────────────────────────────┐
│  IDEA MINER                                                                  │
│  Apify Reddit Actor → complaint scorer → cluster → LLM Build-Card gen → Box  │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ writes {uuid}/spec.md + metadata (status=inbox)
                                ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  BOX CONTENT HUB                                                             │
│  /DevTool-Loop/BuildCards/{Inbox|Ready-for-Build|In-Progress|Completed}/     │
│  Metadata template: devtool_build_card                                       │
│  Webhooks on ITEM.MOVED and METADATA_INSTANCE.UPDATED                        │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ HMAC-signed webhook → POST /webhooks/box
                                ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  AI BUILDER ORCHESTRATOR  (container; Lambda+sidecar or long-running)        │
│  • verifies webhook signature   • drives Build Card lifecycle                │
│  • manages GitHub repos         • runs Claude Code (scaffold / refine)       │
│  • runs tests + secret scan     • updates Box metadata & tasks               │
└──────────┬───────────────────────────────────────────┬───────────────────────┘
           │ git push / gh pr create                    │ Box SDK
           ▼                                             ▼
     GITHUB REPO                                   BOX (task, metadata, logs)
     (generated dev tool)                          (spec.md, build summary)
```

### 4.2 State Machine (Build Card `status`)

```
        ┌─────────┐   human moves /        ┌────────────────┐
        │  inbox  │── sets ready-for-build →│ ready-for-build │
        └─────────┘                        └───────┬─────────┘
             ▲                                     │ webhook → orchestrator Phase 1
             │ (human can reject anytime)          ▼
             │                              ┌──────────────┐  Claude Code scaffold,
             │                              │   building   │  PR + Box task created
             │                              └──────┬───────┘
             │                                     │ human approves
             │                                     ▼
             │                          ┌────────────────────┐  webhook → Phase 2
             │                          │ building-approved  │
             │                          └─────────┬──────────┘
             │                                    │ Claude Code refine, push
             │                                    ▼
             │                              ┌─────────────┐
             │                              │  completed  │  (terminal)
             │                              └─────────────┘
             │
             └──────────── failed (terminal, from any state) ──────────────
```

`status` transitions are the **only** triggers in the system. Every transition is
guarded for idempotency (§8.4).

### 4.3 Happy-Path Sequence

```
1.  Idea Miner scrapes Reddit for "flaky tests" / "slow CI" complaints.
2.  Complaints scored, clustered; LLM writes a Build Card.
3.  Card written to Box /BuildCards/Inbox/{uuid}/spec.md, status=inbox.
4.  Human reviews in Box, sets metadata status=ready-for-build.
5.  Box fires webhook → Orchestrator.
6.  Orchestrator (Phase 1):
      a. verify signature
      b. guard: status must be ready-for-build → set status=building
      c. fetch spec.md from Box
      d. create GitHub repo, commit spec.md to specs/devtool-loop/spec.md
      e. start Claude Code session ({uuid}-phase1), run scaffold prompt
      f. npm install && npm run build && npm test
      g. secret scan on diff
      h. git push; gh pr create
      i. create Box task; write REVIEW_NOTES.md to Box
      j. write builder.session_id / repo_url / pr_url to spec + metadata
7.  Human reviews PR; sets metadata status=building-approved.
8.  Box fires webhook → Orchestrator.
9.  Orchestrator (Phase 2):
      a. guard: status must be building-approved → keep building-approved
      b. fetch REVIEW_NOTES.md + PR comments
      c. resume Claude Code session ({uuid}-phase1) with refine prompt
      d. npm run build && npm test; secret scan
      e. git push
      f. set status=completed
      g. write build_summary.md to Box /Logs/
```

---

## 5. Data Model: DevTool Build Card

Build Cards are the authoritative spec artifact. Each is a `spec.md` file in Box with
YAML front-matter plus a Markdown body.

### 5.1 Box Folder Layout

```
/DevTool-Loop/
  BuildCards/
    Inbox/
      {uuid}/spec.md
    Ready-for-Build/
      {uuid}/spec.md
    In-Progress/
      {uuid}/
        spec.md
        REVIEW_NOTES.md          ← written by orchestrator after Phase 1
    Completed/
      {uuid}/
        spec.md
        build_summary.md
  Logs/
    {uuid}-build-{ISO8601}.log
```

Each card lives in its own `{uuid}/` directory so filenames never collide when a card
moves between status folders, and so webhook payloads are unambiguous.

### 5.2 `spec.md` Schema (annotated)

```yaml
---
# ─── Identity (set once by Idea Miner; never changes) ───────────────────────
id: "550e8400-e29b-41d4-a716-446655440000"   # UUID v4
schema_version: "1"                           # bump when fields are added
created_at: "2025-07-01T10:00:00Z"            # ISO 8601 UTC
updated_at: "2025-07-02T09:00:00Z"            # last write by any component

# ─── Classification ─────────────────────────────────────────────────────────
title: "Flaky test triage helper for GitHub Actions monorepos"
theme: "testing-ci"                           # controlled vocab (see config/themes.json)
status: "inbox"                               # see §4.2 state machine

# ─── Target user ─────────────────────────────────────────────────────────────
persona:
  role: "backend-dev"                         # backend-dev | frontend-dev | infra-eng
  org_size: "50-200"
  stack_context: "Node.js monorepo, GitHub Actions, ~800 test suite"

# ─── Evidence (the whole point of the system) ───────────────────────────────
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
    - "gh-flaky ignore <test-pattern>   # appends to .flaky-ignore"
  tech_constraints:
    language: "TypeScript"
    runtime: "Node 20"
    distribution: "npm package + single binary via pkg"
    storage: "no DB; caches API responses to .flaky-cache/ (gitignored)"
    auth: "reads GITHUB_TOKEN from env; never persisted"

signal_strength:
  score: 0.82                                 # 0.0–1.0
  explanation: >
    High unique-author count (12), multi-subreddit spread (3), all complaints
    within 60 days, strong stack overlap with target persona.

links:
  reddit_threads:
    - "https://reddit.com/r/programming/..."
    - "https://reddit.com/r/devops/..."

# ─── Builder block (written ONLY by the Orchestrator; null until set) ────────
builder:
  session_id: null                            # Claude Code session id
  repo_url: null
  pr_url: null
  box_task_id: null
  phase: null                                 # scaffold | refine
  last_run_at: null
  tests_pass: null                            # bool
  build_pass: null                            # bool
---

# [Title]

## Problem Summary
[Expanded pain description — written by the Idea Miner LLM pass.]

## Proposed Tool
[Expanded tool description, key UX, constraints.]

## Acceptance Criteria
- [ ] `gh-flaky scan` exits 0 on a valid repo and produces output.
- [ ] `gh-flaky scan` exits non-zero with a human-readable error on an invalid token.
- [ ] Report output is deterministic given identical API responses.
- [ ] Unit tests cover the happy path and ≥2 error cases.
- [ ] README covers: what it does, install, one worked example, known limitations.
```

**Acceptance Criteria are mandatory.** They are what tells Claude Code "done" means
something concrete. A Build Card without them is invalid and must be rejected by the
Idea Miner's validation step (§6, Step 4).

### 5.3 Box Metadata Template: `devtool_build_card`

Applied to every `spec.md`. It mirrors the critical front-matter fields so that Box
search and webhook routing work without parsing the file body.

| Field | Type | Values / Notes |
|-------|------|----------------|
| `status` | enum | `inbox`, `ready-for-build`, `building`, `building-approved`, `completed`, `failed` |
| `theme` | string | `testing-ci` (extensible) |
| `pain_score` | float | 0.0–1.0, mirrors `signal_strength.score` |
| `card_id` | string | UUID; must equal front-matter `id` |
| `builder_session_id` | string | set by Orchestrator; null initially |
| `repo_url` | string | set by Orchestrator; null initially |
| `pr_url` | string | set by Orchestrator; null initially |

**Sync invariant:** front-matter and metadata must agree. The Orchestrator is the sole
writer of the `builder:` block and the corresponding metadata fields; the Idea Miner
writes everything else. On conflict, the front-matter file is canonical and the
metadata is corrected to match.

---

## 6. Component: Idea Miner

**Responsibility:** Scrape Reddit → score → cluster → generate Build Card → upload to Box.

### 6.1 Inputs

Config file `config/idea-miner.json` (schema in §13):

```json
{
  "subreddits": ["programming", "devops", "ExperiencedDevs", "SoftwareEngineering"],
  "keywords": [
    "flaky test", "flaky tests", "flaky spec",
    "slow ci", "ci is slow", "ci takes",
    "intermittent test", "test randomly fails", "rerun pipeline",
    "tests fail on main", "pipeline broken"
  ],
  "theme": "testing-ci",
  "window_days": 60,
  "min_unique_authors": 5,
  "min_subreddit_count": 2,
  "max_posts_per_run": 50
}
```

### 6.2 Step 1 — Scrape (Apify)

Use the `apify/reddit-scraper` actor. For each keyword, search across configured
subreddits. Capture per item: `id`, `author`, `subreddit`, `score`, `created_utc`,
`permalink`, `selftext`/`body`. Deduplicate by `id`. Cap results at `max_posts_per_run`.

```
POST https://api.apify.com/v2/acts/apify~reddit-scraper/run-sync-get-dataset-items
  ?token={APIFY_TOKEN}
Body: { "searches": keywords, "subreddits": subreddits,
        "maxItems": max_posts_per_run, "sort": "new" }
```

### 6.3 Step 2 — Score

```
base_score   = log1p(upvotes)               # dampen virality
keyword_boost = 0
  +0.20 if body matches /hours|days|blocked|prod|deploy/i
  +0.10 if body matches /monorepo|github actions|ci minutes/i
  +0.15 if created within last 30 days
final_score  = base_score * (1 + keyword_boost)

DROP if final_score < 1.0 OR age > window_days
```

### 6.4 Step 3 — Cluster (hackathon: keyword-based)

```
flaky-tests : body matches /flaky|intermittent|randomly fails|non-deterministic/i
slow-ci     : body matches /slow ci|ci takes|ci minutes|pipeline takes/i
(an item may belong to both)

DROP cluster if unique_authors < min_unique_authors
            OR subreddit_count < min_subreddit_count
```

> Post-hackathon: swap keyword clustering for sentence embeddings
> (`all-MiniLM-L6-v2` via SageMaker or local ONNX). The interface is unchanged; only
> the clustering implementation changes.

### 6.5 Step 4 — Generate Build Card (LLM)

Call Claude (Anthropic API for hackathon; Bedrock for prod) with a strict prompt:

```
SYSTEM:
You are a technical product manager. Given developer complaints, produce a
DevTool Build Card in the EXACT YAML+Markdown format provided. Return ONLY the
file content — no preamble, no code fences, no commentary.

USER:
Theme: {theme}
Complaint count: {n}   Unique authors: {unique_authors}
Subreddits: {subreddit_list}
Complaints (paraphrase; strip usernames and any PII):
{complaint_texts}

Schema (reproduce exactly, filling all fields):
{paste §5.2}
```

**Validate** the response against the schema:
- All required fields present and correctly typed.
- `Acceptance Criteria` section is non-empty.
- `id` is a valid UUID; `status` is `inbox`.

On validation failure, retry once with the error appended. If it still fails, write a
`status=failed` card containing the raw LLM output for human inspection.

### 6.6 Step 5 — Upload to Box

```
1. Create folder /DevTool-Loop/BuildCards/Inbox/{uuid}/
2. Upload spec.md
3. Apply devtool_build_card metadata:
     status=inbox, theme, pain_score=signal_strength.score, card_id=uuid
4. Log the Box file id
```

**De-duplication:** before creating a card, query Box for existing cards with the same
`theme` and `created_at > now - 7d`. If a near-duplicate exists (same theme, overlapping
reddit_threads), skip and log `duplicate suppressed`.

### 6.7 Failure handling

- Apify failure → log, abort run, write no partial card.
- Box upload failure → retry 3× exponential backoff → fall back to local
  `failed-cards/{uuid}.md` and alert.

---

## 7. Component: Box Content Hub

**Responsibility:** authoritative storage of Build Cards; emit status-change events;
hold human review artifacts and approval tasks.

### 7.1 Box App & Scopes

Create a Box Platform app (Server Authentication, JWT or Client Credentials) with scopes:
`root_readwrite`, `manage_webhooks`, `manage_enterprise_properties` (for metadata
templates), `manage_tasks` (if available in plan).

### 7.2 Webhooks

Register webhooks on the `/DevTool-Loop/BuildCards/` folder:

| Event | Meaning |
|-------|---------|
| `METADATA_INSTANCE.UPDATED` | `devtool_build_card.status` changed (primary trigger) |
| `ITEM.MOVED` | A card was moved into a status subfolder (secondary; treated as a status hint, then verified against metadata) |

- Target: `POST https://{orchestrator-host}/webhooks/box`
- Box signs every payload with HMAC-SHA256 (primary + secondary keys). The Orchestrator
  **must** verify against `BOX_WEBHOOK_PRIMARY_KEY` / `BOX_WEBHOOK_SECONDARY_KEY` and
  reject mismatches with `401`.

> Box Automate is intentionally **not** used: it is a no-code UI tool, not reproducible
> from this spec. Webhooks are programmable and version-controllable.

### 7.3 Box Tasks (Approval Gate)

After Phase 1, the Orchestrator creates a Box task on `spec.md`:

```
Message:
  Review AI scaffold for: {title}
  Repo: {repo_url}
  PR:   {pr_url}

  APPROVE → set metadata status=building-approved
  REJECT  → set metadata status=failed and add a comment with the reason

Due: +3 business days   Assignee: {reviewer group}
```

The task ID is written to `builder.box_task_id` and metadata `box_task_id`. The task is a
**UI affordance only** — the canonical approval signal is the metadata status change
(`building-approved`), per Decision #4 (§15).

---

## 8. Component: AI Builder Orchestrator

**Responsibility:** validate events; drive the lifecycle; manage GitHub; run Claude Code;
run tests and secret scans; update Box.

### 8.1 Runtime

A container (run as Lambda + sidecar, or a small always-on service) with:
`git`, `gh` (GitHub CLI), `node` 20, `npm`, the Claude Code CLI (authenticated), and the
Box Node SDK. All secrets via environment variables (§13).

### 8.2 Endpoint `POST /webhooks/box`

```
1. Verify Box-Signature (HMAC-SHA256) → 401 on mismatch.
2. Parse event; extract box_file_id and trigger type.
3. Fetch the file's devtool_build_card metadata from Box
     (do NOT trust the webhook body as source of truth).
4. Route by metadata.status:
     ready-for-build    → Phase 1
     building-approved  → Phase 2
     other              → log + 200 (no-op)
```

### 8.3 Phase 1 — Scaffold

```
guard: metadata.status == ready-for-build, else 200 no-op
set    metadata.status = building
download spec.md → /tmp/{uuid}/spec.md

if builder.repo_url is null:
    git init /tmp/{uuid}/repo
    mkdir -p specs/devtool-loop
    cp spec.md specs/devtool-loop/spec.md
    write package.json with "devtool_build_card_id": "{uuid}"
    git add . && git commit -m "chore: add Build Card spec"
    gh repo create {GITHUB_ORG}/{slug} --{GITHUB_REPO_VISIBILITY}
    git remote add origin {repo_url}; git push -u origin main
    set builder.repo_url + metadata.repo_url

claude --session-id {uuid}-phase1 \
       --working-dir /tmp/{uuid}/repo \
       --prompt-file prompts/scaffold.md \
       --no-interactive
set builder.session_id + metadata.builder_session_id

cd repo: npm install && npm run build && npm test   # capture exit codes
secret_scan(diff)                                   # §12.5
git add . && git commit -m "feat: AI scaffold (phase 1)"
git push origin HEAD
gh pr create --title "AI Scaffold: {title}" --body-file PR_BODY.md
set builder.pr_url + metadata.pr_url

create Box task (§7.3); write REVIEW_NOTES.md to Box In-Progress/{uuid}/
set builder.phase=scaffold, last_run_at, tests_pass, build_pass
```

Any failed step → `status=failed`, write failure log to `/Logs/`, abort.

### 8.4 Phase 2 — Refine

```
guard: metadata.status == building-approved, else 200 no-op
download REVIEW_NOTES.md and fetch PR review comments → write into repo REVIEW_NOTES.md

claude --session-id {uuid}-phase1 \        # SAME id → resumes context
       --working-dir /tmp/{uuid}/repo \
       --prompt-file prompts/refine.md \
       --no-interactive

npm run build && npm test; secret_scan(diff)
git add . && git commit -m "feat: AI refine (phase 2)"; git push origin HEAD
set metadata.status=completed
write build_summary.md → Box /Logs/{uuid}-build-{ISO8601}.md
move card folder → /BuildCards/Completed/{uuid}/
```

### 8.5 Idempotency

Box delivers webhooks at-least-once; duplicates are guaranteed. Every transition is a
**conditional update**:

- `building` only from `ready-for-build`.
- `completed` only from `building-approved`.

If the guard fails (replay or concurrent event), the handler returns `200` without
re-running. This prevents double-scaffolding and double-billing of Claude Code sessions.

---

## 9. Component: Claude Code Integration

### 9.1 Session Management

Sessions are keyed by `{uuid}-phase1`. The **same** session id is used for both scaffold
and refine so Claude retains context. The id is persisted to Box (front-matter + metadata)
immediately after the session starts. If a resume fails because the session expired, the
Orchestrator starts a fresh session and re-injects `spec.md`, `PLAN.md`, and `AI_NOTES.md`
as context, noting the fallback in `REVIEW_NOTES.md` (Decision #3, §15).

### 9.2 Prompt files

The exact prompts live in `prompts/scaffold.md` and `prompts/refine.md` (shipped with this
spec). They are version-controlled and are part of the reproducibility guarantee. Do not
inline-edit prompts in code; change the files.

### 9.3 Invocation contract

```
claude --session-id <id> --working-dir <repo> --prompt-file <path> --no-interactive
```

- `--no-interactive`: the session must never block for human input.
- Claude writes `PLAN.md`, `AI_NOTES.md`, source, tests, and `README.md` to the repo.
- The Orchestrator reads `AI_NOTES.md` and `PLAN.md` after the run to build review
  artifacts.
- On non-zero exit, capture stderr, write to `/Logs/`, set `status=failed`, **do not
  auto-retry**.

---

## 10. Inter-Component Contracts

### 10.1 Idea Miner → Box
- Writes `/BuildCards/Inbox/{uuid}/spec.md` + metadata.
- Never sets any `builder:` field.
- Never moves files out of `Inbox/` (a human action).

### 10.2 Box → Orchestrator (webhook payload of interest)
```json
{
  "trigger": "METADATA_INSTANCE.UPDATED",
  "source": { "id": "<box_file_id>", "type": "file" },
  "additional_info": {
    "metadata_instance": {
      "template_key": "devtool_build_card",
      "data": { "status": "ready-for-build", "card_id": "<uuid>" }
    }
  }
}
```
The Orchestrator re-fetches the full file + metadata; it never trusts the payload alone.

### 10.3 Orchestrator → Claude Code
Subprocess invocation per §9.3.

### 10.4 Orchestrator → GitHub
All operations via `gh` CLI authenticated with `GITHUB_TOKEN`, in org `GITHUB_ORG`.
PR body is generated into `PR_BODY.md`:
```markdown
## AI-Generated Scaffold
**Build Card:** {box_file_url}
**Theme:** {theme}   **Signal score:** {pain_score}

### What was generated
{contents of AI_NOTES.md}

### Test results
```
{npm test output}
```

### Reviewer checklist
- [ ] CLI flags match spec
- [ ] No hardcoded secrets
- [ ] README is accurate
- [ ] Tests cover the acceptance criteria in spec.md
```

---

## 11. Error Handling & Failure Modes

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Apify returns 0 results | result count | log, abort run, no card written |
| LLM produces invalid Build Card YAML | schema validation | retry once; else `status=failed` card w/ raw output |
| Box upload fails | SDK HTTP error | retry 3× backoff; fallback local file + alert |
| Duplicate card (same theme < 7d) | Box query | skip + log "duplicate suppressed" |
| Webhook signature invalid | HMAC check | `401` + log |
| Webhook delivered twice | idempotency guard | `200` no-op |
| Claude Code non-zero exit | exit code | log to Box; `status=failed`; no auto-retry |
| `npm run build` fails | exit code | `status=failed`; no auto-retry |
| Tests fail after scaffold | `npm test` exit | never auto-complete; require human review |
| GitHub push fails | `gh` exit | retry once; else `status=failed` |
| Phase-2 session expired | Claude Code error | new session + re-inject context; note in REVIEW_NOTES.md |
| Secret detected in diff | secret scan | block push; `status=failed`; alert |

The original system had no error handling at all; the rows above are the minimum set for
even a demo, since Apify rate limits, Box webhook replays, and session expiry are all
near-certain to occur.

---

## 12. Non-Functional Requirements

### 12.1 Traceability (required)
- Every Build Card links to the Reddit threads it summarized.
- Every repo commits `specs/devtool-loop/spec.md` in its first commit.
- Every repo's `package.json` carries `"devtool_build_card_id": "{uuid}"`.

### 12.2 Reproducibility (required)
Given a Box Build Card + the prompt files, re-running the Orchestrator on the same spec
produces a functionally equivalent scaffold (same CLI flags, same structure, passing
tests). Byte-equality is not required; acceptance-criteria satisfaction is.

### 12.3 Human Control (required)
- No commit reaches a main branch without a human approving the GitHub PR.
- No deployment steps at any phase (hackathon scope).
- A human can abort at any time via `status=failed`.

### 12.4 Demo Performance (required)
Full loop (Idea Miner → Build Card → scaffold → PR + Box task) completes in **< 5 minutes**
on hackathon-scale data (1 card, ≤ 50 Reddit posts). Consequences:
- Apify capped at 50 posts/run.
- Scaffold budget ≤ 400 source lines (enforced in `prompts/scaffold.md`).
- Demo uses polling, not webhooks (Phase 2 of §14).

### 12.5 Secrets (required)
- No secrets in code or committed files; all via env vars (§13).
- Before every `git push`, the Orchestrator greps the diff for common secret patterns:
  `GITHUB_TOKEN`, `ghp_`, `sk-`, `xoxb-`, `AKIA`, `-----BEGIN`. A match blocks the push.

---

## 13. Configuration & Secrets Reference

### 13.1 Environment Variables

| Variable | Component | Purpose |
|----------|-----------|---------|
| `APIFY_TOKEN` | Idea Miner | Apify API auth |
| `ANTHROPIC_API_KEY` | Idea Miner, Orchestrator | LLM + Claude Code |
| `BOX_CLIENT_ID` | all | Box app auth |
| `BOX_CLIENT_SECRET` | all | Box app auth |
| `BOX_ENTERPRISE_ID` | all | Box enterprise |
| `BOX_WEBHOOK_PRIMARY_KEY` | Orchestrator | webhook HMAC |
| `BOX_WEBHOOK_SECONDARY_KEY` | Orchestrator | webhook HMAC |
| `GITHUB_TOKEN` | Orchestrator | repo/PR creation |
| `GITHUB_ORG` | Orchestrator | target org for repos |
| `GITHUB_REPO_VISIBILITY` | Orchestrator | `private` (default) or `public` |
| `ORCHESTRATOR_HOST` | Box config | webhook target base URL |

### 13.2 Config Files (committed, no secrets)
- `config/idea-miner.json` — scrape config (§6.1; example shipped in repo).
- `config/themes.json` — controlled theme vocabulary.

---

## 14. Implementation Phases

### Phase 0 — Foundation
- [ ] Commit this `SPEC.md` and `prompts/` to `specs/devtool-loop/`.
- [ ] Create Box app + scopes (§7.1).
- [ ] Create `devtool_build_card` metadata template (§5.3).
- [ ] Create folder structure (§5.1).
- [ ] Hand-author one Build Card, upload to `Inbox/`, verify metadata applies and a
      status change is visible.

### Phase 1 — Idea Miner MVP
- [ ] `idea-miner/index.{js,py}`: Apify scrape (1–2 subs, 2–3 keywords).
- [ ] Scoring (§6.3), hard-coded `testing-ci` cluster (§6.4).
- [ ] LLM Build Card generation + validation (§6.5).
- [ ] Upload + metadata + de-dup (§6.6).
- [ ] **Exit:** running the miner produces a valid `spec.md` in Box Inbox with metadata.

### Phase 2 — AI Builder MVP (polling)
- [ ] `orchestrator/poller.{js,py}`: poll Box every 30s for `status=ready-for-build`.
- [ ] On hit: create GitHub repo, run Claude Code scaffold, build+test+secret-scan.
- [ ] Create Box task + PR; update metadata.
- [ ] **Exit:** moving a card to `Ready-for-Build` yields a repo, a PR, and a Box task in < 5 min.

### Phase 3 — Human-in-Loop + Resume
- [ ] Poller also watches `status=building-approved`.
- [ ] On hit: resume session with refine prompt; build+test; push.
- [ ] Mark `status=completed`; write build summary; move folder to `Completed/`.
- [ ] **Exit:** approving a card yields an updated PR and `status=completed` in < 5 min.

### Stretch
- Replace polling with Box webhooks (`ngrok` for demo endpoint).
- Embedding-based clustering over 10+ threads.
- Implement the real `gh-flaky` logic, not just a skeleton.
- Per-push secret scan hardening + SARIF report.

---

## 15. Decisions Log & Open Questions

| # | Question | Status | Decision / Notes |
|---|----------|--------|-----------------|
| 1 | Which Apify actor for Reddit? | **Decided** | `apify/reddit-scraper`; fall back to direct Reddit API if rate-limited |
| 2 | Bedrock vs Anthropic API for card generation? | **Open** | Anthropic API for hackathon; Bedrock for prod to avoid cross-provider auth |
| 3 | Does `--session-id` survive process restarts? | **Open** | Test it. Fallback: re-inject spec + PLAN + AI_NOTES on resume |
| 4 | Box task completion vs metadata change as approval signal? | **Decided** | Metadata `building-approved` is canonical; task is UI only |
| 5 | Generated repo public or private? | **Decided** | Private default; `GITHUB_REPO_VISIBILITY` env var |
| 6 | What if generated code doesn't compile? | **Decided** | Run `npm run build` after tests; non-zero → `status=failed`, no auto-retry |
| 7 | Coordinated rate limits across Apify/Reddit/Claude/Box? | **Open** | Fine at hackathon scale; document limits before scaling |

---

## 16. Glossary

- **Build Card** — the authoritative spec for one tool to build (`spec.md` in Box).
- **Idea Miner** — the service that scrapes/scores/clusters complaints and writes Build Cards.
- **Orchestrator** — the service that turns a `ready-for-build` card into a scaffolded repo + PR.
- **Session** — a Claude Code conversation keyed by id; reused across scaffold and refine.
- **Approval gate** — the human step (`status → building-approved`) that unblocks Phase 2.
- **Theme** — a controlled-vocabulary domain label (e.g., `testing-ci`).

---

_This spec is authoritative. Record any deviation in §15 rather than changing behavior
silently in code._
