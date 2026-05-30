# AI Builder Orchestrator (Person C) — Design

- **Date:** 2026-05-30
- **Component:** AI Builder Orchestrator (SPEC.md §8–§9)
- **Status:** Approved for implementation
- **Derives from:** `specs/devtool-loop/SPEC.md` (§8, §9, §10, §11, §12.5, §13, §14), `TASKS.md` (Person C), `contracts/box-client.mjs`

> This is a component design, subordinate to `specs/devtool-loop/SPEC.md`. Where this
> document and the SPEC disagree, the SPEC wins. Additions made here that are **not** in
> the SPEC are marked **[beyond-spec]** with a rationale.

---

## 1. Goal

Turn a Build Card whose `status` becomes `ready-for-build` into a scaffolded GitHub repo
+ PR + Box approval task, and on human approval (`building-approved`) resume the **same**
Claude Code session, refine, and mark the card `completed`. Status changes are the only
triggers. Every transition is idempotency-guarded.

The orchestrator consumes the frozen `BoxClient` contract only — `getMetadata`,
`setMetadata`, `getSpecMarkdown`, `uploadArtifact`, `createTask`, `moveCard`,
`listCardsByStatus`, `onWebhook`. It is the **sole writer** of status transitions and
`builder.*` fields (SPEC §5.3 sync invariant).

## 2. Runtime & conventions

- **Node 20.11+ / ESM (`.mjs`)** — matches the frozen contract it imports. No build step
  for the orchestrator itself. (SPEC §14 allows `{js,py}`; JS chosen to share the contract.)
- **Real subprocesses** for `git`, `gh`, `node`, `npm`, and the Claude Code CLI, via one
  thin `run()` wrapper (SPEC §8.1). Secrets only via env vars (SPEC §13, §12.5).
- **Test runner:** `node --test` (built in, no new deps).
- Mock↔real Box swap is a one-line import change in `index.mjs`.

## 3. Module layout (`orchestrator/`)

Small, single-purpose files; pure logic separated from subprocess/IO so it unit-tests
without mocks.

| File | Purpose | Spec |
|---|---|---|
| `index.mjs` | Bootstrap: choose Box client, start server + poller, register handler | §8.1 |
| `config.mjs` | Read + validate env vars; fail fast on missing required ones | §13 |
| `run.mjs` | Thin `child_process` wrapper → `{code, stdout, stderr}`; the only subprocess seam | §8.1 |
| `hmac.mjs` | `verifyBoxSignature(rawBody, headers, primaryKey, secondaryKey)` → bool | §7.2, §8.2 |
| `server.mjs` | `POST /webhooks/box`: read raw body, verify HMAC (401 on fail), hand `fileId` to core | §8.2 |
| `poller.mjs` | Every 30s, `listCardsByStatus()` for the two trigger statuses; in-flight guard | §14 |
| `lifecycle.mjs` | **Shared core** `handleCard(fileId)`: re-fetch metadata, route, idempotency guards | §8.2, §8.5 |
| `phase1-scaffold.mjs` | Phase 1 sequence | §8.3 |
| `phase2-refine.mjs` | Phase 2 sequence | §8.4 |
| `git-github.mjs` | `initRepo`, `createRepo` (gh), `commit`, `push`, `createPr` (gh) over `run()` | §8.3, §10.4 |
| `claude-code.mjs` | `runScaffold` / `runRefine` → `claude --session-id … --prompt-file … --no-interactive` | §9.3 |
| `build-runner.mjs` | `install` / `build` / `test` → captured exit codes + output | §8.3 |
| `secret-scan.mjs` | `scanDiff(text)` → matched secret patterns (pure) | §12.5 |
| `slug.mjs` | `slugFromTitle(title)` → repo slug (pure) | §8.3 |
| `pr-body.mjs` | `buildPrBody({...})` → §10.4 PR markdown (pure) | §10.4 |
| `review-notes.mjs` | `buildReviewNotes({...})` → REVIEW_NOTES.md content (pure) | §8.3, §7.3 |
| `verify-orchestrator.mjs` | **[beyond-spec]** offline end-to-end harness vs Box mock | — |

## 4. Trigger & data flow

Two trigger sources feed one core (you approved building both):

```
 POST /webhooks/box ─┐
 poller (30s)        ─┼─▶ lifecycle.handleCard(fileId)
 mock onWebhook(dev) ─┘            │
                       meta = getMetadata(fileId)   # §8.2 never trust payload
                       route on meta.status:
                         ready-for-build   → phase1Scaffold
                         building-approved → phase2Refine
                         other             → log + 200 no-op
```

- **Webhook path** (SPEC §8.2): `server.mjs` reads the raw body, verifies the
  `Box-Signature` HMAC against `BOX_WEBHOOK_PRIMARY_KEY` / `BOX_WEBHOOK_SECONDARY_KEY`
  (either matches = ok), 401 on mismatch, extracts `source.id` (the Box file id), passes
  to `handleCard`. Returns 200 immediately on accepted events.
- **Poller path** (SPEC §14): `listCardsByStatus('ready-for-build')` and
  `('building-approved')` every 30s → `handleCard` per hit.
- **Dev path:** `box.onWebhook(handler)` from the mock fires the §10.2 payload in-process,
  so the full loop runs with no ngrok / real Box.

## 5. Phase 1 — Scaffold (SPEC §8.3)

```
guard: meta.status == 'ready-for-build'           else → 200 no-op (§8.5)
setMetadata(building)
spec = getSpecMarkdown(fileId)
if meta.repo_url == null:
    git init /tmp/{cardId}/repo
    write specs/devtool-loop/spec.md  (= the fetched spec)
    write package.json { "devtool_build_card_id": cardId }   (§12.1 traceability)
    git add . && commit "chore: add Build Card spec"
    gh repo create {GITHUB_ORG}/{slug} --{visibility}
    git remote add origin … && git push -u origin main
    setMetadata({ repo_url })
claude --session-id {cardId}-phase1 --prompt-file prompts/scaffold.md --no-interactive
setMetadata({ builder_session_id })
build-runner: install → build → test           (capture exit codes)
secret-scan(diff)                              (§12.5; match → fail)
git commit "feat: AI scaffold (phase 1)" && push
gh pr create --title "AI Scaffold: {title}" --body-file PR_BODY.md
setMetadata({ pr_url })
uploadArtifact(REVIEW_NOTES.md, area:'card')
createTask(fileId, §7.3 message)  → setMetadata({ box_task_id })
setMetadata({ phase:'scaffold', last_run_at, tests_pass, build_pass })
```

## 6. Phase 2 — Refine (SPEC §8.4)

```
guard: meta.status == 'building-approved'         else → 200 no-op (§8.5)
fetch REVIEW_NOTES.md + PR comments → write repo REVIEW_NOTES.md
claude --session-id {cardId}-phase1 …refine.md…   # SAME id resumes context (§9.1)
build-runner: build → test ; secret-scan(diff)
git commit "feat: AI refine (phase 2)" && push
setMetadata(completed)
uploadArtifact({cardId}-build-{ISO}.md, area:'logs')   (build summary)
moveCard(cardId, 'completed')
```

Session-expiry fallback (§9.1): if resume fails, start a fresh session, re-inject
`spec.md` / `PLAN.md` / `AI_NOTES.md`, note the fallback in `REVIEW_NOTES.md`.

## 7. Idempotency (SPEC §8.5)

Guards centralized in `lifecycle.mjs`:
- `building` only from `ready-for-build`.
- `completed` only from `building-approved`.

Box delivers at-least-once; a duplicate webhook/poll → guard fails → 200 no-op, no
re-run (prevents double-scaffolding / double Claude billing). The poller keeps an
in-flight `Set<cardId>` so a long Phase 1 isn't re-entered before the status flips.

## 8. Error handling (SPEC §11)

Any failing step inside a phase →
`setMetadata(failed)` → `uploadArtifact(failure log, area:'logs')` → abort, **no
auto-retry**. Covered rows: Claude non-zero exit, `npm build` fail, `npm test` fail,
secret detected, `gh` push fail (retry once first). The handler still returns 200 to Box
(the failure is recorded on the card, not surfaced as an HTTP error).

## 9. Testing strategy (TDD)

- **Pure units first** (`hmac`, `secret-scan`, `slug`, `pr-body`, `review-notes`, and the
  `lifecycle` routing/guards): unit tests, no mocks.
- **Phases**: integration tests against the **Box mock** with `ORCH_STUB_EXTERNALS=1`
  **[beyond-spec]** so `git`/`gh`/`claude`/`npm` short-circuit with canned outputs — the
  full loop runs offline. The real path (flag unset) is the default in production.
- **`verify-orchestrator.mjs`** **[beyond-spec]**: the §8 analogue of
  `contracts/verify-mock.mjs` — drives inbox → … → completed via the mock and asserts
  every transition + builder field, end-to-end, offline.

## 10. Beyond-spec additions (explicit)

1. **`ORCH_STUB_EXTERNALS` env var** — test/CI affordance; not in §13. Same code path,
   guarded by one flag; real subprocesses are the default.
2. **`verify-orchestrator.mjs`** — mirrors the repo's existing `verify-mock.mjs`
   convention; not required by the SPEC.
3. **Webhook *and* poller built together** — SPEC phases these (poller = demo §14,
   webhooks = stretch); building both up front per explicit decision.

## 11. Build order (each = one TDD cycle)

1. `config` + `run` + `index` skeleton
2. `hmac` + `server`
3. `lifecycle` core (routing + idempotency guards)
4. `poller`
5. pure builders: `slug`, `secret-scan`, `pr-body`, `review-notes`
6. `git-github`
7. `claude-code`
8. `build-runner`
9. `phase1-scaffold`
10. `phase2-refine`
11. `verify-orchestrator` harness

## 12. Definition of done (SPEC §14 Phase 2+3 exit)

Moving a card to `ready-for-build` yields a repo, PR, and Box task in < 5 min; approving
yields an updated PR and `status=completed`; duplicate webhooks are no-ops. Offline:
`node orchestrator/verify-orchestrator.mjs` walks the full lifecycle green.
