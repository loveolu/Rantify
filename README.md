# Rantify — DevTool Discovery & Build Loop

> **Developer friction, turned into shipped software.**

Rantify is a **traceable, human-gated pipeline** that takes a real complaint — a feature
people keep asking for, or a pain mined from public developer forums — and carries it all
the way to a reviewed pull request:

```
pain observed (or requested)  →  spec stored in Box  →  scaffolded repo  →  human-reviewed PR  →  shipped tool
```

Nothing in that chain is a black box. Every tool links back to the evidence that motivated
it, every generated repo commits the exact spec it was built from, and no AI-written code
reaches a main branch without a human approving the PR.

The authoritative design lives in [`specs/devtool-loop/SPEC.md`](specs/devtool-loop/SPEC.md).
If all code and runtime state disappeared, the system should be regenerable from that spec,
the Build Card data model, the prompt files in `specs/devtool-loop/prompts/`, and the
content stored in Box.

---

## Table of contents

1. [The problem we're solving](#1-the-problem-were-solving)
2. [How the loop works](#2-how-the-loop-works)
3. [Architecture](#3-architecture)
4. [The Build Card](#4-the-build-card)
5. [Build Card lifecycle](#5-build-card-lifecycle)
6. [Contract-driven design](#6-contract-driven-design)
7. [Repository layout](#7-repository-layout)
8. [Getting started](#8-getting-started)
9. [HTTP API](#9-http-api)
10. [Testing](#10-testing)
11. [Configuration & secrets](#11-configuration--secrets)
12. [Guarantees this system makes](#12-guarantees-this-system-makes)
13. [Further reading](#13-further-reading)

---

## 1. The problem we're solving

The path from *"we keep hitting this pain"* to *"we have a working tool"* is manual, lossy,
and untraceable. An engineer notices a complaint, writes a spec from memory, and scaffolds a
repo if they ever find the time. Evidence is rarely captured, specs are informal, and the
link between **why** a tool was built and **what** was built is lost almost immediately.

Rantify closes three gaps:

| Gap | Today | With Rantify |
|-----|-------|--------------|
| **Discovery** | Gut feel, anecdotes | A request you type, or a structured scrape of public developer forums scored against real signal |
| **Spec authoring** | Informal, untraceable | Auto-generated **Build Cards** linked to the source complaints |
| **Implementation** | Manual coding or one-off LLM prompting | Claude Code sessions driven by a formal spec, behind an explicit human approval gate |

Rantify is **not** a feedback-analytics product, a CI tool, or a code-review bot. It is the
traceable pipeline that connects those concerns.

---

## 2. How the loop works

Pain enters the loop in one of three ways, and from there every item follows the same path.

**Ways in:**

- **Request it** — a user submits a one-sentence feature request through the Rantify web UI
  (`POST /api/mine`). Rantify interprets the request, mines Reddit for corroborating
  feedback, and drafts a Build Card.
- **Mine it** — the Idea Miner batch-scrapes developer forums for a target domain (the
  reference domain is *flaky tests / slow CI*), scores and clusters the complaints, and
  drafts Build Cards from clusters with enough signal.
- **Author it** — a Build Card is written directly (`POST /api/cards`, or by hand into Box).

**The path (happy path):**

1. A **Build Card** (`spec.md` — YAML front-matter + Markdown body) lands in Box at
   `status=inbox`.
2. A human reviews it and sets `status=ready-for-build`.
3. The **Orchestrator** picks it up (webhook or 30s poll): creates a GitHub repo, commits
   the spec, runs a **Claude Code** scaffold session, builds + tests + secret-scans, opens a
   **PR**, and files a **Box approval task**. Status → `building`.
4. A human reviews the PR and approves by setting `status=building-approved`.
5. The Orchestrator **resumes the same Claude Code session** (by session id — not a fresh
   prompt), refines tests and the README, pushes, and writes a build summary to Box.
   Status → `completed`.

A human can reject at any point by setting `status=failed`.

---

## 3. Architecture

Four parts: three backend components (one per SPEC section) plus a web app. The three
backend components are built independently against a **frozen `BoxClient` contract**, so each
can be developed and tested in full isolation with no live Box, GitHub, Reddit, or Claude.

```
┌────────────────────────────────────────────────────────────────────────────┐
│  RANTIFY UI  (rantify-ui/ — React + Vite)                                    │
│  Marketing site + product app: Kanban dashboard, submit form, integrations.  │
│  Talks to the Orchestrator's /api/* surface.                                 │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │  POST /api/mine, GET/PUT /api/cards, …
                                ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  IDEA MINER  (idea-miner/ — SPEC §6)                                         │
│  scrape (Apify) → score → cluster/group → generate (Claude on Bedrock)       │
│  → upload Build Card to Box (status=inbox)                                    │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │  writes {uuid}/spec.md + metadata
                                ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  BOX CONTENT HUB  (box-hub/ — SPEC §7)                                       │
│  Authoritative storage of Build Cards. Metadata template devtool_build_card. │
│  HMAC-verified webhooks on METADATA_INSTANCE.UPDATED + ITEM.MOVED.           │
│  Approval tasks, review artifacts, build logs.                               │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │  signed webhook → POST /webhooks/box (or 30s poll)
                                ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  AI BUILDER ORCHESTRATOR  (orchestrator/ — SPEC §8–§9)                       │
│  • verifies webhook signature   • drives the Build Card lifecycle            │
│  • manages GitHub repos/PRs      • runs Claude Code (scaffold / refine)       │
│  • runs build + tests + secret scan   • updates Box metadata & tasks          │
│  • serves the /api/* surface + GitHub OAuth for the UI                        │
└──────────┬───────────────────────────────────────────┬───────────────────────┘
           │ git push / gh pr create                    │ Box SDK
           ▼                                             ▼
     GITHUB REPO                                   BOX (task, metadata, logs,
     (the generated dev tool)                       spec.md, build summary)
```

| Component | Folder | Responsibility | Spec |
|-----------|--------|----------------|------|
| **Rantify UI** | `rantify-ui/` | Marketing site + Kanban product app over the orchestrator API | — |
| **Idea Miner** | `idea-miner/` | Reddit → score → cluster/group → LLM Build Card → Box | §6 |
| **Box Content Hub** | `box-hub/` | Authoritative storage, metadata template, signed webhooks, approval tasks | §5, §7 |
| **AI Builder Orchestrator** | `orchestrator/` | Lifecycle state machine, GitHub, Claude Code, tests, Box updates, HTTP API | §8–§9 |

The LLM throughout (both Build Card generation and Claude Code) runs **Claude on Amazon
Bedrock**. Reddit scraping is done via **Apify**.

---

## 4. The Build Card

The Build Card is the authoritative spec artifact and the unit of work for the whole system.
Each is a `spec.md` file in Box — **YAML front-matter** (machine-readable identity,
evidence, and build state) plus a **Markdown body** (problem summary, proposed tool, and
mandatory **acceptance criteria** that tell Claude Code what "done" means).

Key front-matter blocks (full schema in [SPEC §5.2](specs/devtool-loop/SPEC.md)):

- **Identity** — `id` (UUID), `schema_version`, timestamps.
- **Classification** — `title`, `theme` (controlled vocab, see `config/themes.json`),
  `status`.
- **`proof_of_pain`** — unique authors, subreddit spread, and sample complaints with source
  URLs. *This is the whole point of the system.*
- **`build_suggestion`** — what to build, key capabilities, tech constraints.
- **`signal_strength`** — a 0.0–1.0 score with an explanation.
- **`builder`** — written **only** by the Orchestrator: `session_id`, `repo_url`, `pr_url`,
  `box_task_id`, test/build results. `null` until a build runs.

A **Box metadata template** (`devtool_build_card`) mirrors the critical fields so search and
webhook routing work without parsing the file body. The front-matter file is canonical; on
conflict, metadata is corrected to match it.

Themes currently defined (`config/themes.json`): `testing-ci` (the reference dev-pain
domain) and `product-feedback` (free-text feature requests from the UI) are active;
`observability` is reserved.

---

## 5. Build Card lifecycle

`status` transitions are the **only** triggers in the system. Every transition is guarded for
idempotency, because Box delivers webhooks at-least-once.

```
 (mining)        inbox  ──human sets──▶  ready-for-build
    │              ▲                          │ orchestrator: Phase 1
    │ UI-only      │ human can reject         ▼
    ▼              │ anytime (→ failed)   building  ──PR + Box task created
 inbox ───────────┘                          │ human approves PR
                                             ▼
                                     building-approved
                                             │ orchestrator: Phase 2 (resume session)
                                             ▼
                                        completed  (terminal)

                  failed  (terminal, reachable from any state)
```

The human approval gate is the transition to `building-approved`. `mining` is a UI-only
state for an in-flight feedback-mining job — it is not a Box status. The full state machine
is in [SPEC §4.2](specs/devtool-loop/SPEC.md).

In the dashboard these map to friendlier labels: **Mining → Inbox → Ready → Building →
Approved → Shipped** (and **Failed**). See `rantify-ui/src/lib/status.js`.

---

## 6. Contract-driven design

The trick that lets the three backend components be built in parallel — and tested with no
external services — is the **frozen contract** in `contracts/box-client.mjs`:

- `contracts/box-client.mjs` is a frozen v1 interface for everything anyone needs from Box.
- `contracts/box-client-mock.mjs` is a filesystem-backed fake (`.box-mock/`). The Idea Miner
  and Orchestrator develop and test against it.
- `box-hub/` implements the **same** interface for real, against the Box SDK.

Because every component imports the same method signatures, going live is a **one-line swap**
in each component's bootstrap: mock → `RealBoxClient`. Run the whole pipeline end-to-end with
zero real Box / GitHub / Reddit / Claude:

```bash
node contracts/verify-mock.mjs
```

The rule: nobody mutates an existing signature in `box-client.mjs`; new needs add a method.
See [`TASKS.md`](TASKS.md) for the three-person parallel build split this enables.

---

## 7. Repository layout

```
.
├── README.md                      ← you are here
├── run.sh                         # dev: starts orchestrator (:8080) + Vite UI (:5173)
├── package.json                   # root scripts: test, verify:*, setup:phase0
├── .env.example                   # copy to .env; never commit secrets
│
├── specs/devtool-loop/
│   ├── SPEC.md                    # ← the authoritative specification
│   └── prompts/                   # scaffold.md + refine.md (Claude Code prompts; reproducibility-critical)
│
├── config/
│   ├── idea-miner.json            # scrape / score / cluster config
│   └── themes.json                # controlled theme vocabulary
│
├── contracts/                     # frozen BoxClient interface + filesystem mock + verify-mock
├── idea-miner/                    # Component A — scrape → score → cluster → generate → upload
├── box-hub/                       # Component B — real Box client, webhook server, provisioning scripts
├── orchestrator/                  # Component C — lifecycle, GitHub, Claude Code, tests, HTTP API
│   └── auth/                      # GitHub OAuth + per-user token/target store
├── integration/                   # cross-component integration tests + fake Box
├── fixtures/                      # sample spec + webhook payloads for tests
├── setup/                         # Phase 0 provisioning entrypoint
│
├── rantify-ui/                    # React + Vite web app (marketing site + product dashboard)
│
└── docs/                          # design specs, plans, redesign notes
```

Each component has its own README with a file-by-file map: see
[`idea-miner/README.md`](idea-miner/README.md), [`box-hub/README.md`](box-hub/README.md),
[`orchestrator/README.md`](orchestrator/README.md), and
[`contracts/README.md`](contracts/README.md).

---

## 8. Getting started

**Requirements:** Node ≥ 20.11 (the codebase uses `import.meta.dirname`). For live runs you
also need `git`, `gh` (GitHub CLI), and the Claude Code CLI on `PATH`.

### Run everything offline (no external services)

The fastest way to see the system work is the verify scripts — each runs a real code path
with externals stubbed:

```bash
node contracts/verify-mock.mjs          # whole pipeline against the Box mock
npm run verify:idea                     # Idea Miner: scrape→score→cluster→generate→upload + de-dup
npm run verify:orchestrator             # Orchestrator: full lifecycle against mock Box + stubbed git/gh/claude
npm run verify:box                      # Box Content Hub: verify-mock scenario against RealBoxClient
npm test                                # unit + integration + property tests across all components
```

### Run the full stack (UI + orchestrator)

```bash
# from the repo root
npm run dev            # → ./run.sh : orchestrator on :8080, Vite UI on :5173

# or start them separately (e.g. on Windows):
node orchestrator/index.mjs                 # API + webhook server + 30s poller on :8080
npm --prefix rantify-ui run dev             # Vite dev server on :5173 (VITE_API_URL → :8080)
```

By default the orchestrator boots with `ORCH_STUB_EXTERNALS` to avoid touching real
git/gh/claude. Unset it to go live.

### Go live

1. `cp .env.example .env` and fill in credentials (see [§11](#11-configuration--secrets)).
2. Provision Box once (idempotent): `npm run setup:phase0` — creates the metadata template,
   folder layout, and webhooks. (`node box-hub/setup/print-config.mjs` first confirms env
   presence without printing values.)
3. Point each component's Box import from the mock to `RealBoxClient`
   (`orchestrator/index.mjs` already does this; the Idea Miner has a one-line swap).
4. Start the orchestrator with the stub flag unset; connect a GitHub account via the
   Integrations page (OAuth) so builds can create repos as that user, an org, or an existing
   repo.

The implementation is staged in phases (Phase 0 → 3); the plan and exit criteria are in
[SPEC §14](specs/devtool-loop/SPEC.md).

---

## 9. HTTP API

The orchestrator serves the UI and webhooks on `PORT` (default `8080`):

| Method & path | Purpose |
|---|---|
| `GET /api/cards` | List all Build Cards with metadata |
| `POST /api/cards` | Create a Build Card directly (status `inbox`) |
| `GET /api/cards/:fileId` | One card's metadata + which review artifacts exist |
| `PUT /api/cards/:fileId` | Set `status` (drives the lifecycle; also moves the Box folder) |
| `GET /api/cards/:fileId/spec` | The `spec.md` Markdown |
| `GET /api/cards/:fileId/artifacts/:name` | Fetch `REVIEW_NOTES.md` / `build_summary.md` |
| `POST /api/mine` | Start a feedback-mining job from a free-text query (returns `202` + `jobId`) |
| `GET /api/mine` | Poll mining-job progress |
| `GET /api/auth/status` | Connected GitHub accounts + their build targets |
| `POST /api/auth/target` | Change a user's build target (personal / org / existing repo) |
| `POST /webhooks/box` | Box webhook intake (HMAC-verified; `401` on mismatch) |
| `GET /auth/github/...` | GitHub OAuth flow for per-user repo creation |

---

## 10. Testing

- **Runner:** Node's built-in `node:test`, plus `fast-check` for property tests.
- **No live calls:** Apify, Bedrock, Box, git, gh, and Claude Code are all injected behind
  seams and stubbed/faked in tests, so the full suite runs offline and in CI.
- **Layers:** per-module unit tests in each component, cross-component tests in
  `integration/` (with `integration/fake-box.mjs`), and the `verify:*` scripts as
  end-to-end smoke tests against the mock.

```bash
npm test                 # everything
node --test orchestrator/*.test.mjs        # one component
```

---

## 11. Configuration & secrets

All secrets are supplied via environment variables (`cp .env.example .env`); none are
committed. Committed config files (`config/idea-miner.json`, `config/themes.json`) carry no
secrets.

| Variable | Used by | Purpose |
|---|---|---|
| `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET` / `BOX_ENTERPRISE_ID` | all | Box app auth (Client Credentials Grant) |
| `BOX_WEBHOOK_PRIMARY_KEY` / `BOX_WEBHOOK_SECONDARY_KEY` | orchestrator | Webhook HMAC verification |
| `APIFY_TOKEN` | idea miner | Reddit scraping (mining is disabled without it) |
| `AWS_REGION` / `BEDROCK_REGION` + AWS credentials | idea miner, orchestrator | Claude on Amazon Bedrock |
| `BEDROCK_MODEL_ID` | idea miner, orchestrator | Override the default Bedrock model |
| `GITHUB_TOKEN` / `GITHUB_ORG` / `GITHUB_REPO_VISIBILITY` | orchestrator | Repo + PR creation target |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` / `OAUTH_REDIRECT_URI` | orchestrator | Per-user GitHub OAuth |
| `ORCHESTRATOR_HOST` | Box config | Webhook target + OAuth redirect base URL |
| `REVIEWER_EMAIL` | box hub | Human reviewer / collaborator on `/DevTool-Loop/` |

The full reference is [SPEC §13](specs/devtool-loop/SPEC.md).

---

## 12. Guarantees this system makes

- **Traceability** — every Build Card links to its source Reddit threads; every generated
  repo commits `specs/devtool-loop/spec.md` in its first commit and carries
  `"devtool_build_card_id"` in `package.json`.
- **Human control** — no AI-written code reaches a main branch without a human approving the
  GitHub PR, and a human can abort any card at any time (`status=failed`).
- **Reproducibility** — re-running the Orchestrator on the same Build Card produces a
  functionally equivalent scaffold (same CLI, same structure, passing tests — not byte
  equality).

The full set of non-functional requirements (including the < 5-minute demo budget and the
pre-push secret scan) is in [SPEC §12](specs/devtool-loop/SPEC.md).

---

## 13. Further reading

- [`specs/devtool-loop/SPEC.md`](specs/devtool-loop/SPEC.md) — the authoritative
  specification (problem, architecture, data model, contracts, phases, decisions log).
- [`specs/devtool-loop/prompts/`](specs/devtool-loop/prompts/) — the scaffold and refine
  prompts (version-controlled, part of the reproducibility guarantee).
- [`TASKS.md`](TASKS.md) — the contract-first, three-person parallel build split.
- Component READMEs: [`idea-miner/`](idea-miner/README.md),
  [`box-hub/`](box-hub/README.md), [`orchestrator/`](orchestrator/README.md),
  [`contracts/`](contracts/README.md).
- [`docs/`](docs/) — design specs and plans, including the
  [enterprise SaaS UI redesign plan](docs/redesign-enterprise-saas-plan.md).

---

_The spec is authoritative. Record any deviation in SPEC §15 rather than changing behavior
silently in code._
