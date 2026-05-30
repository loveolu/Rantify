# Three-Person Task Split — DevTool Discovery & Build Loop

Goal: three people build in parallel, **none blocked waiting on another**. The system
already has three components (SPEC.md §6, §7, §8), so the split is one component per
person. The thing that makes it *independent* rather than sequential is the **frozen
contract + runnable mock** in `contracts/` — everyone codes against that, not against
each other's half-finished code.

```
Person A ──writes cards──▶  ┌─────────────────────┐  ◀──reads/updates──── Person C
Idea Miner                  │  contracts/          │                       Orchestrator
(SPEC §6)                   │  box-client.mjs ◀────┼── Person B implements (SPEC §7)
                            │  + mock for A & C    │   for real (Box SDK)
                            └─────────────────────┘
```

## The contract is the whole trick

`contracts/box-client.mjs` is a frozen v1 interface. A and C develop against
`contracts/box-client-mock.mjs` (a filesystem fake) plus the fixtures in `fixtures/`.
B implements the same interface for real. Because all three import the **same method
signatures**, swapping mock → real Box is a one-line change in each component's bootstrap.

Run `node contracts/verify-mock.mjs` to see the entire pipeline execute with no real
Box / GitHub / Reddit / Claude. That script is the reference for how each piece plugs in.

**Rule:** nobody edits a method signature in `box-client.mjs` without telling the other
two. New need → add a method, never mutate an existing one.

---

## Person A — Idea Miner  (SPEC.md §6)

**Goal:** Reddit complaints → scored → clustered → LLM Build Card → uploaded as an
`inbox` card.

| | |
|---|---|
| **Owns** | `idea-miner/` (new folder), `config/idea-miner.json`, `config/themes.json` |
| **Consumes** | `contracts/box-client.mjs` — only `findDuplicate()` and `uploadCard()` |
| **Produces** | a valid `spec.md` + metadata in Box `Inbox/`, `status=inbox` |
| **External deps** | Apify (`APIFY_TOKEN`), Amazon Bedrock (`AWS_REGION` + AWS credentials) |

**Build against:** the mock. Your `uploadCard()` calls land in `.box-mock/`. Validate
your generated card matches `fixtures/sample-spec.md`'s shape (it's the §5.2 schema).

**Definition of done (SPEC §14 Phase 1 exit):** running the miner produces a
schema-valid `spec.md` in Box Inbox with metadata applied; de-dup suppresses a repeat
run within 7 days; invalid LLM output retries once then writes a `failed` card.

**Why you're not blocked:** you never touch real Box, GitHub, or Claude Code. You only
need the two write methods, which the mock already implements.

---

## Person B — Box Content Hub  (SPEC.md §7)

**Goal:** the real, authoritative Box: app + scopes, metadata template, folder layout,
HMAC-verified webhooks, approval tasks. **You implement the frozen contract for real.**

| | |
|---|---|
| **Owns** | `box-hub/` (new folder): real `BoxClient` impl + `POST /webhooks/box` server, Box app config / template / folder setup scripts |
| **Consumes** | `contracts/box-client.mjs` — you `implement` every method (Box Node SDK) |
| **Produces** | a drop-in replacement for the mock + a webhook endpoint that emits the §10.2 payload |
| **External deps** | Box app (`BOX_CLIENT_ID/SECRET/ENTERPRISE_ID`, webhook keys) |

**Build against:** the contract + `contracts/verify-mock.mjs` as your acceptance test —
point it at your real client (swap the import) and the same assertions must pass.
Set up: metadata template `devtool_build_card` (§5.3), folder layout (§5.1), webhooks on
`METADATA_INSTANCE.UPDATED` + `ITEM.MOVED` (§7.2), HMAC verify against both keys → 401.

**Definition of done (SPEC §14 Phase 0):** a hand-authored card uploaded to `Inbox/`
gets metadata applied and a status change is visible; a metadata change delivers a
signed webhook your endpoint verifies; `verify-mock.mjs` passes against your real client.

**Why you're not blocked:** the contract is frozen, so you know exactly which methods to
implement before A and C finish anything. You're the only one touching real Box.

---

## Person C — AI Builder Orchestrator  (SPEC.md §8–§9)

**Goal:** turn a `ready-for-build` card into a scaffolded repo + PR + Box task, then on
approval resume the Claude Code session and complete it.

| | |
|---|---|
| **Owns** | `orchestrator/` (new folder): webhook handler / poller, lifecycle state machine, GitHub (`gh`), Claude Code invocation, tests + secret scan |
| **Consumes** | `contracts/box-client.mjs` — the read/update + `onWebhook` methods |
| **Produces** | GitHub repo, PR, Box task, metadata transitions, build summary |
| **External deps** | GitHub (`GITHUB_TOKEN/ORG`), Claude Code CLI, `git`, `node`, `npm` |

**Build against:** the mock + `fixtures/webhook-ready-for-build.json` and
`webhook-building-approved.json`. Feed those to your handler; re-fetch metadata via
`getMetadata()` (never trust the payload, §8.2); enforce idempotency guards (§8.4:
`building` only from `ready-for-build`, `completed` only from `building-approved`).
The Claude Code call (§9.3) and `gh` calls can be stubbed locally until integration.

**Definition of done (SPEC §14 Phase 2+3 exit):** moving a card to `ready-for-build`
yields a repo, PR, and Box task in < 5 min; approving yields an updated PR and
`status=completed`; duplicate webhooks are no-ops.

**Why you're not blocked:** the mock's `onWebhook` fires the exact §10.2 payload on
every status change, so you can drive your full state machine with zero real Box.

---

## Integration (when the three meet)

1. **B finishes the real client first-ish** (it's everyone's dependency). Until then A & C
   use the mock — so B finishing late does **not** block them, only delays final integration.
2. Each component flips one import: `box-client-mock.mjs` → B's real client. No other change.
3. Run `verify-mock.mjs`'s scenario against real Box, then the real end-to-end loop (§4.3).

## Shared ground rules

- **Sync invariant (§5.3):** Orchestrator is the *sole* writer of `builder.*` / status
  transitions; Idea Miner writes everything else. The mock enforces the inbox-only rule.
- **No secrets in code** (§12.5) — all via env vars (§13).
- Don't edit `contracts/box-client.mjs` signatures unilaterally.
- `.box-mock/` is scratch state — gitignored, safe to delete anytime.

> Requires Node 20.11+ (uses `import.meta.dirname`).
