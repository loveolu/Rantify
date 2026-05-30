# Box Content Hub (Person B) — Design Spec

- **Component:** Box Content Hub — SPEC.md §7 (auth, metadata template, folders, webhooks, tasks)
- **Owner:** Person B
- **Status:** Draft for review
- **Created:** 2026-05-30
- **Parent spec:** [`specs/devtool-loop/SPEC.md`](../../../specs/devtool-loop/SPEC.md)
- **Contract:** [`contracts/box-client.mjs`](../../../contracts/box-client.mjs) (frozen v1 — do not mutate signatures)
- **Acceptance harness:** [`contracts/verify-mock.mjs`](../../../contracts/verify-mock.mjs)

> This document is the implementation spec for one component. It does not change the
> system SPEC; where they touch, SPEC.md is authoritative and any deviation is recorded
> in §10 (Open Questions) here and SPEC §15 there.

---

## 1. Goal & Definition of Done

Build `box-hub/` — the **real** implementation of the frozen `BoxClient` contract plus a
`POST /webhooks/box` server and the Box provisioning scripts (app config, metadata
template, folder layout, webhook registration).

**Done when (SPEC §14 Phase 0 + TASKS.md Person B):**

1. `RealBoxClient` implements **every** method of `contracts/box-client.mjs` against Box.
2. Provisioning scripts create the `devtool_build_card` metadata template (§5.3) and the
   `/DevTool-Loop/BuildCards/{Inbox,Ready-for-Build,In-Progress,Completed}` + `/Logs`
   folder layout (§5.1), idempotently.
3. The webhook server verifies Box's HMAC-SHA256 signature against **both** keys and
   returns `401` on mismatch; valid `METADATA_INSTANCE.UPDATED` / `ITEM.MOVED` events are
   routed to registered `onWebhook` handlers carrying the §10.2 payload shape.
4. `contracts/verify-mock.mjs` passes when its import is repointed from the mock to
   `RealBoxClient` (run against Box, or against the documented live-smoke harness).
5. Unit tests (node:test) cover HMAC verify (pass + dual-key + reject), metadata mapping,
   and the contract method behaviors with the SDK faked.

**Explicit non-goals (this component):** Idea Miner logic (Person A), orchestrator state
machine / GitHub / Claude Code (Person C), live ngrok delivery (deferred — verified via
synthetic signed payloads), production hosting.

---

## 2. Locked Technical Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Auth | **Client Credentials Grant (CCG)**, enterprise subject | Matches SPEC §13 env vars (`BOX_CLIENT_ID/SECRET/ENTERPRISE_ID`); no JWT keypair |
| SDK | **`box-typescript-sdk-gen`** | Box's current generated SDK; native CCG; actively maintained |
| Language | **Plain ESM `.mjs`** | `RealBoxClient extends BoxClient` with no build step; mirrors the zero-dep mock |
| HTTP server | **Node built-in `http`** | Zero-dep; trivial to keep the raw request body for HMAC |
| Tests | **`node:test`** | Built into Node 20; runs verify-mock-style assertions natively |
| Box env | **Ready-to-run** | No live creds yet: provisioning scripts + mockable unit tests; live smoke documented, deferred |
| Webhook delivery | **Synthetic signed payloads in tests** | Verifies HMAC + routing without ngrok; live delivery is a later swap |

`box-typescript-sdk-gen` is the **only** runtime dependency added to the repo.

---

## 3. Architecture (Approach B — service-decomposed behind a thin facade)

`RealBoxClient` is a thin facade that composes focused, independently testable modules.
Provisioning scripts reuse the same modules so folder/metadata logic is never duplicated.

```
box-hub/
  index.mjs                 # exports RealBoxClient; the one import C/A swap to
  box-client-real.mjs       # RealBoxClient facade: implements the 10 contract methods
  lib/
    auth.mjs                # CCG client singleton (getBoxClient())
    paths.mjs              # folder layout constants + path helpers (§5.1)
    folders.mjs             # ensureFolderTree, resolve/create folder, move folder
    metadata.mjs            # apply/get/update devtool_build_card instance (+ value mapping)
    files.mjs               # upload spec.md, upload artifact, download text body
    tasks.mjs               # create approval task (§7.3)
    search.mjs              # findDuplicate via metadata query; listCardsByStatus
    hmac.mjs                # dual-key HMAC-SHA256 verify (pure, no I/O)
  webhook/
    server.mjs              # http server: POST /webhooks/box, raw body, verify, dispatch
    registry.mjs            # in-process handler registry backing onWebhook()
  setup/
    create-template.mjs     # idempotent metadata template (§5.3)
    create-folders.mjs      # idempotent folder layout (§5.1)
    register-webhooks.mjs   # webhooks on METADATA_INSTANCE.UPDATED + ITEM.MOVED (§7.2)
    print-config.mjs        # echoes required env (no secret values) for diagnostics
  test/
    hmac.test.mjs
    metadata.test.mjs
    contract.test.mjs       # RealBoxClient methods with a faked SDK
    webhook-server.test.mjs
  README.md                 # setup order, env, how to run verify against real Box
```

**Data flow:**

```
Idea Miner ─uploadCard/findDuplicate─▶ RealBoxClient ─▶ box-typescript-sdk-gen ─▶ Box
Orchestrator ─get/setMetadata,getSpec,uploadArtifact,createTask,moveCard,list─▶ "
Box ──HMAC-signed POST /webhooks/box──▶ webhook/server.mjs ─verify(hmac)─▶ registry ─▶ onWebhook handler
```

The facade depends on `lib/*`; `lib/*` depend only on the SDK + node builtins;
`hmac.mjs` is pure (no SDK, no I/O) so it is trivially unit-tested.

---

## 4. Box-side Constants (single source in `lib/paths.mjs`)

```
ROOT folder name:        DevTool-Loop
  BuildCards/
    Inbox/               status=inbox            (Idea Miner writes here)
    Ready-for-Build/     status=ready-for-build
    In-Progress/         status=building | building-approved
    Completed/           status=completed
  Logs/                  build summaries / run logs

Metadata: scope="enterprise", templateKey="devtool_build_card"  (§5.3)
Card folder: BuildCards/<statusFolder>/<cardId>/spec.md
```

A `cardId → fileId` lookup is resolved on demand (search by `card_id` metadata or by path),
because the contract's orchestrator methods take a Box `fileId` while move/upload take a
`cardId`. **`fileId` is never assumed equal to `cardId`** (the mock enforces this; real Box
also differs).

---

## 5. Feature-by-Feature Implementation

Each feature lists: **Goal · Contract/SPEC mapping · Design · Key SDK calls · Edge cases ·
Tests · Done-when.** Build order is the numbering below (dependencies flow downward).

### F1 — CCG auth client (`lib/auth.mjs`)

- **Goal:** one authenticated `BoxClient` instance, lazily created, reused.
- **Mapping:** SPEC §7.1 scopes; §13 env vars.
- **Design:** `getBoxClient()` returns a memoized client built from
  `BOX_CLIENT_ID/SECRET/ENTERPRISE_ID`. Enterprise (service-account) subject so the app
  acts as itself, not a user.
- **Key SDK calls:**
  ```js
  import { BoxClient } from 'box-typescript-sdk-gen/client.generated';
  import { BoxCcgAuth, CcgConfig } from 'box-typescript-sdk-gen/box/ccgAuth.generated';
  const auth = new BoxCcgAuth({ config: new CcgConfig({
    clientId: env.BOX_CLIENT_ID, clientSecret: env.BOX_CLIENT_SECRET,
    enterpriseId: env.BOX_ENTERPRISE_ID }) });
  const client = new BoxClient({ auth });
  ```
- **Edge cases:** missing env → throw a clear error naming the variable (fail fast, no
  silent undefined). Never log secret values.
- **Tests:** env-missing throws; `getBoxClient()` returns the same instance twice (memoized).
  No live call in unit tests — auth is injected/faked elsewhere.
- **Done-when:** `node box-hub/setup/print-config.mjs` reports all required env present (or
  names the missing one) and, against real creds, `client.users.getUserMe()` succeeds.

### F2 — Folder layout provisioning (`lib/paths.mjs`, `lib/folders.mjs`, `setup/create-folders.mjs`)

- **Goal:** create the §5.1 tree idempotently; helpers to resolve/create/move card folders.
- **Mapping:** SPEC §5.1.
- **Design:** `ensureFolderTree()` walks the constant tree, creating any missing folder
  under its parent (root id `'0'`). `ensureCardFolder(cardId, status)` returns the folder id
  for `BuildCards/<statusFolder>/<cardId>/`, creating it if absent. `moveFolder(folderId,
  newParentId)` for `moveCard`.
- **Key SDK calls:** list children to find existing (`client.folders.getFolderItems`),
  `client.folders.createFolder({ name, parent: { id } })`,
  `client.folders.updateFolderById(id, { parent: { id: newParentId } })` for moves.
- **Edge cases:** folder already exists → reuse (idempotent, no duplicate); name collisions
  resolved by exact-name match within parent. Concurrent create → tolerate `409` by
  re-resolving.
- **Tests:** with a faked SDK, ensureFolderTree creates only missing nodes; second run is a
  no-op; ensureCardFolder returns existing id on repeat.
- **Done-when:** `node box-hub/setup/create-folders.mjs` is safe to run repeatedly and yields
  the exact §5.1 layout.

### F3 — Metadata template provisioning (`setup/create-template.mjs`)

- **Goal:** create the `devtool_build_card` enterprise template (§5.3) idempotently.
- **Mapping:** SPEC §5.3 field table.
- **Design:** create the template with fields:
  `status` (enum: inbox, ready-for-build, building, building-approved, completed, failed),
  `theme` (string), `pain_score` (float), `card_id` (string),
  `builder_session_id` (string), `repo_url` (string), `pr_url` (string), `box_task_id` (string).
- **Key SDK calls:** `client.metadataTemplates.createMetadataTemplate({ scope:'enterprise',
  templateKey:'devtool_build_card', displayName:'DevTool Build Card', fields:[...] })`.
- **Edge cases:** template exists → catch conflict, treat as success (optionally diff fields
  and warn if drift). Box has no native float beyond `float`; `pain_score` stored as float.
- **Tests:** field set matches §5.3 exactly (assert against a constant field map); re-run is
  a no-op (conflict swallowed).
- **Done-when:** template visible in Box admin with all 8 fields; re-running the script does
  not error.

### F4 — File ops (`lib/files.mjs`)

- **Goal:** upload `spec.md`, upload artifacts, download a file body as text.
- **Mapping:** contract `uploadCard` (spec.md write), `uploadArtifact`, `getSpecMarkdown`;
  SPEC §8.3.
- **Design:**
  - `uploadText({ parentId, name, content })` → new file (or new version if name exists).
  - `downloadText(fileId)` → string (read the download stream to a UTF-8 string).
- **Key SDK calls:** new file `client.uploads.uploadFile({ attributes:{ name, parent:{id} },
  file })`; existing `client.uploads.uploadFileVersion(fileId, {...})`; download
  `client.downloads.downloadFile(fileId)` → stream → string.
- **Edge cases:** re-upload of same name → upload a new version, don't duplicate. Content is
  UTF-8 text (Buffer.from(content)). Large files out of scope (spec.md is small).
- **Tests:** uploadText returns a fileId; downloadText round-trips content (faked SDK
  stream).
- **Done-when:** a `spec.md` uploaded via `uploadText` is downloadable byte-identical via
  `downloadText`.

### F5 — Metadata read/write + value mapping (`lib/metadata.mjs`)

- **Goal:** apply/get/update the `devtool_build_card` instance and map to/from the
  contract's `CardMetadata`.
- **Mapping:** contract `getMetadata` / `setMetadata`; SPEC §5.3 sync invariant, §8.2/§8.4.
- **Design:**
  - `applyMetadata(fileId, cardMetadata)` — used by `uploadCard` (create instance).
  - `getCardMetadata(fileId)` — fetch instance, project to `CardMetadata` (status, theme,
    pain_score, card_id, builder_session_id, repo_url, pr_url, box_task_id).
  - `patchMetadata(fileId, partial)` — JSON-patch `replace`/`add` ops for changed keys only
    (this is what makes `setMetadata` a **conditional** write).
- **Key SDK calls:** `createFileMetadataById`, `getFileMetadataById`,
  `updateFileMetadataById(fileId, 'enterprise', 'devtool_build_card', ops)` where each op is
  `{ op:'replace', path:'/<field>', value }` (use `add` if the field was previously unset).
- **Edge cases:** null builder fields — Box enum/string fields can't hold null; represent
  "unset" by **omitting** the field rather than writing null, and treat absent as null on
  read (keeps the contract's `null` semantics). `pain_score` numeric coercion. On read,
  surface raw values via the instance's extra-data accessor and re-key to contract names.
- **Tests:** round-trip a full `CardMetadata`; patch only touches changed paths; absent
  builder field reads back as `null`.
- **Done-when:** `getMetadata(setMetadata(fileId, patch))` reflects the patch and unchanged
  fields are untouched.

### F6 — `uploadCard` + `findDuplicate` (Idea Miner surface) (`box-client-real.mjs`, `lib/search.mjs`)

- **Goal:** Person A's two methods, for real.
- **Mapping:** contract `uploadCard`/`findDuplicate`; SPEC §6.6, §10.1.
- **Design:**
  - `uploadCard({cardId, specMarkdown, metadata})`: **reject** if `metadata.status !== 'inbox'`
    or `metadata.card_id !== cardId` (same guard the mock enforces). Then
    `ensureCardFolder(cardId, 'inbox')` → `uploadText(spec.md)` → `applyMetadata`. Return
    `{ fileId, cardId }`.
  - `findDuplicate({theme, withinDays})`: metadata search for non-failed cards with matching
    `theme` updated within the window; return `CardRef[]`.
- **Key SDK calls:** `client.search.searchForContent({ ancestorFolderIds:[rootId], mdfilters:
  [{ scope:'enterprise', templateKey:'devtool_build_card', filters:{ theme } }] })`; filter
  out `status==='failed'` and stale results client-side by `withinDays`.
- **Edge cases:** search indexing lag on Box can delay very-recent cards from appearing in
  `findDuplicate` — documented as a known limitation (Open Question §10); acceptable at
  hackathon scale. Status guard mirrors `verify-mock.mjs`'s rejection assertion.
- **Tests:** non-inbox status rejected (matches verify-mock assertion); `card_id !== cardId`
  rejected; findDuplicate excludes `failed` and out-of-window cards (faked search results).
- **Done-when:** verify-mock's upload + de-dup assertions pass against the real client.

### F7 — Orchestrator surface (`box-client-real.mjs`)

- **Goal:** `getMetadata`, `setMetadata`, `getSpecMarkdown`, `uploadArtifact`, `createTask`,
  `moveCard`, `listCardsByStatus`.
- **Mapping:** contract methods; SPEC §8.2–§8.4, §7.3, §5.1, §14 Phase 2.
- **Design (per method):**
  - `getMetadata(fileId)` → `getCardMetadata` (F5).
  - `setMetadata(fileId, patch)` → `patchMetadata` (F5), return merged metadata. Box emits
    the real webhook naturally on a status change (no in-process emit needed, unlike the mock).
  - `getSpecMarkdown(fileId)` → `downloadText` (F4).
  - `uploadArtifact({cardId, name, content, area})` → resolve target folder (`card` folder via
    `ensureCardFolder`, or `Logs/` when `area==='logs'`) → `uploadText`. Return `{fileId}`.
  - `createTask` → F8.
  - `moveCard(cardId, status)` → resolve current card folder → `moveFolder` into the matching
    status folder (F2).
  - `listCardsByStatus(status)` → metadata search filtered by `status` → `CardRef[]`.
- **Edge cases:** `setMetadata` is the **sole** writer of `builder.*`/status (sync invariant
  §5.3) — this module does not re-derive status from folders. `moveCard` is best-effort folder
  hygiene; metadata `status` remains canonical. Idempotent moves (already in target folder → no-op).
- **Tests:** each method against a faked SDK; `listCardsByStatus` returns only matching status;
  `moveCard` resolves correct destination; `uploadArtifact` logs go to `Logs/`.
- **Done-when:** verify-mock's full orchestrator path (building → task → completed) passes.

### F8 — Box approval task (`lib/tasks.mjs`)

- **Goal:** create the §7.3 approval task on `spec.md`.
- **Mapping:** contract `createTask`; SPEC §7.3 (UI affordance only — metadata is canonical).
- **Design:** `createTask({fileId, message, assignee, dueDays})` → create a review task on the
  file with the §7.3 message template and a due date `+dueDays` (default 3). Return `{taskId}`.
- **Key SDK calls:** `client.tasks.createTask({ item:{ id:fileId, type:'file' },
  action:'review', message, dueAt, completionRule })`; optionally assign via
  `client.taskAssignments.createTaskAssignment`.
- **Edge cases:** if the Box plan lacks task assignment, create the task unassigned and log a
  warning (don't fail the phase — the task is a UI affordance). `dueAt` ISO 8601.
- **Tests:** returns a taskId; message/dueAt constructed from inputs (faked SDK).
- **Done-when:** a task appears on `spec.md`; verify-mock's `createTask` assertion passes.

### F9 — HMAC verification (`lib/hmac.mjs`)

- **Goal:** pure, dual-key Box webhook signature verification.
- **Mapping:** SPEC §7.2, §8.2 (reject mismatch with 401).
- **Design:** `verifyBoxSignature({ rawBody, headers, primaryKey, secondaryKey, now })`:
  - Compute `HMAC-SHA256` over `rawBody + timestamp` per Box's scheme for each key.
  - Compare against `box-signature-primary` / `box-signature-secondary` headers using a
    constant-time compare (`crypto.timingSafeEqual`).
  - Valid if **either** key matches (supports key rotation). Reject if the
    `box-delivery-timestamp` is outside an allowed skew (replay protection).
  - Returns boolean; never throws on bad input (returns false).
- **Edge cases:** missing headers → false; one key unset → check only the set key; body must
  be the **raw** bytes (not re-serialized JSON) — server must preserve it.
- **Tests:** known body+key produces the expected signature (golden vector); primary-only
  match passes; secondary-only match passes; tampered body fails; stale timestamp fails;
  missing headers fail.
- **Done-when:** all HMAC unit cases green (this is the security-critical unit).

### F10 — Webhook server + registry (`webhook/server.mjs`, `webhook/registry.mjs`, `onWebhook`)

- **Goal:** `POST /webhooks/box` that verifies HMAC and dispatches the §10.2 payload to
  `onWebhook` handlers; `401` on bad signature.
- **Mapping:** contract `onWebhook`; SPEC §7.2, §8.2, §10.2.
- **Design:**
  - Built-in `http` server; collect the **raw** request body buffer (needed for HMAC).
  - On `POST /webhooks/box`: `verifyBoxSignature(...)` → `401` if false; else parse JSON,
    normalize to the §10.2 `WebhookEvent` shape, and invoke all registered handlers.
  - `registry.mjs` backs `RealBoxClient.onWebhook(handler)` → returns an unsubscribe fn
    (same signature as the mock).
  - Health route `GET /healthz` → 200.
- **Edge cases:** non-POST / wrong path → 404; malformed JSON after valid signature → 400;
  handler throws → log, still return 200 to Box (Box retries on non-2xx; at-least-once is
  handled by Person C's idempotency guards, not by failing here). Return 200 quickly; run
  handlers without blocking the response if needed.
- **Tests:** synthetic signed payload (built with a test key) → 200 + handler receives the
  §10.2 shape; bad signature → 401, handler not called; unsubscribe stops delivery; bad path
  → 404.
- **Done-when:** server unit tests green using synthetic signed payloads (no ngrok).

### F11 — Webhook registration script (`setup/register-webhooks.mjs`)

- **Goal:** register Box webhooks on the BuildCards folder for the two triggers (§7.2).
- **Mapping:** SPEC §7.2.
- **Design:** create webhooks targeting the `BuildCards` folder with triggers
  `METADATA_INSTANCE.UPDATED` (primary) and `ITEM.MOVED` (secondary), addressed to
  `${ORCHESTRATOR_HOST}/webhooks/box`. Idempotent: list existing webhooks for the target and
  skip/replace duplicates.
- **Key SDK calls:** `client.webhooks.createWebhook({ target:{ id:buildCardsFolderId,
  type:'folder' }, address:'${ORCHESTRATOR_HOST}/webhooks/box', triggers:[
  'METADATA_INSTANCE.UPDATED','ITEM.MOVED'] })`; `client.webhooks.getWebhooks()` to dedupe.
- **Edge cases:** Box max-webhooks-per-target limits; re-run must not pile up duplicates;
  `ORCHESTRATOR_HOST` unset → fail with a clear message. Live delivery deferred — this script
  is exercised against real Box during integration, not in unit tests.
- **Tests:** dedupe logic (faked SDK): existing matching webhook → no create; payload shape
  asserted.
- **Done-when:** running the script once registers exactly the two triggers; re-running is a
  no-op.

### F12 — `RealBoxClient` facade + index (`box-client-real.mjs`, `index.mjs`)

- **Goal:** the single class C/A import; `extends BoxClient`; composes F1–F11.
- **Mapping:** the whole frozen contract.
- **Design:** `class RealBoxClient extends BoxClient` implementing all 10 methods by
  delegating to `lib/*` and `webhook/registry`. Constructor takes optional injected
  dependencies (`{ client, registry }`) so tests fake the SDK; defaults to `getBoxClient()`
  and the real registry. `index.mjs` re-exports it.
- **Edge cases:** must not change any method **signature** from the contract; `onWebhook`
  returns an unsubscribe fn exactly like the mock.
- **Tests:** `contract.test.mjs` drives every method with a faked SDK and asserts the contract
  shapes (CardRef, CardMetadata, taskId, unsubscribe).
- **Done-when:** importable as a drop-in for `FileSystemBoxClient`.

### F13 — Acceptance: verify-mock against the real client

- **Goal:** prove the swap works end-to-end (TASKS.md Person B acceptance).
- **Mapping:** SPEC §14 Phase 0; TASKS.md "point verify-mock.mjs at your real client."
- **Design:** provide a thin harness/instructions to run `contracts/verify-mock.mjs` with the
  import repointed to `box-hub/index.mjs`. Because the mock fires webhooks in-process and real
  Box fires them over HTTP, the harness wires `RealBoxClient.onWebhook` to the same in-process
  registry the server dispatches to, so the verify script's handler runs on real status
  changes. The script's assertions are unchanged.
- **Edge cases:** verify-mock awaits ~10ms for the mock's microtask webhook; against real Box,
  status-change webhooks are asynchronous over the network — for the ready-to-run milestone we
  drive the handler via the in-process registry (status change → local dispatch), and note the
  live-HTTP path as the integration step (§10).
- **Tests:** the run itself is the test; CI runs unit tests, the live run is documented.
- **Done-when:** the verify script prints its success line against `RealBoxClient` (live or
  documented live-smoke).

---

## 6. Config & Secrets

All via env (SPEC §13); none committed. Required for this component:

| Var | Used by | Purpose |
|-----|---------|---------|
| `BOX_CLIENT_ID` | F1 | CCG client id |
| `BOX_CLIENT_SECRET` | F1 | CCG client secret |
| `BOX_ENTERPRISE_ID` | F1 | enterprise subject |
| `BOX_WEBHOOK_PRIMARY_KEY` | F9/F10 | webhook HMAC (primary) |
| `BOX_WEBHOOK_SECONDARY_KEY` | F9/F10 | webhook HMAC (secondary) |
| `ORCHESTRATOR_HOST` | F11 | webhook target base URL |

`setup/print-config.mjs` reports presence (never values). Secrets never logged; no secret
patterns in committed files.

---

## 7. Testing Strategy

- **Unit (node:test, no network):** `hmac.test.mjs` (golden vectors, dual-key, replay),
  `metadata.test.mjs` (round-trip + null mapping + patch-only), `contract.test.mjs` (all 10
  methods with a faked SDK), `webhook-server.test.mjs` (synthetic signed payload → 200/401/404).
- **Acceptance:** `contracts/verify-mock.mjs` repointed to `RealBoxClient` (F13).
- **Live smoke (deferred, documented in README):** with real creds, run setup scripts then a
  one-card walk (upload → set ready-for-build → observe webhook → set building-approved).
- **The SDK is faked at the `lib/*` boundary** so unit tests need no Box account.

---

## 8. Error Handling (component-relevant rows of SPEC §11)

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Missing Box env | F1 startup check | throw naming the variable; abort |
| Webhook signature invalid | F9 HMAC check | `401` + log (no body echo) |
| Webhook delivered twice | (Person C's guard) | server returns 200; idempotency is C's job |
| Template already exists | F3 conflict | treat as success; optional drift warning |
| Folder already exists | F2 list-then-create | reuse; idempotent |
| Box upload fails | SDK HTTP error | surface to caller; Idea Miner owns retry/backoff (§6.7) |
| Task assignment unsupported | F8 SDK error | create unassigned + warn; do not fail |

Retry/backoff for uploads lives with callers (Idea Miner §6.7, Orchestrator); this component
surfaces errors faithfully rather than silently swallowing.

---

## 9. Build Order

F1 → F2 → F3 (provisioning foundation) → F4 → F5 (data plane) → F6, F7, F8 (contract methods)
→ F9 → F10 → F11 (webhook plane) → F12 (facade) → F13 (acceptance). F9 (pure HMAC) can be
built any time and is a good early confidence win.

---

## 10. Open Questions / Deviations

1. **Null metadata fields.** Box string/enum fields can't store null. Decision: omit unset
   builder fields; read absent as `null` to honor the contract's `null` semantics. (Confirm no
   consumer requires the key to physically exist.)
2. **Search indexing lag.** `findDuplicate`/`listCardsByStatus` rely on Box metadata search,
   which can lag indexing by seconds-to-minutes. Acceptable at hackathon scale; revisit if
   de-dup misses near-simultaneous cards. (Fallback: folder-listing scan.)
3. **Live webhook delivery deferred.** Ready-to-run milestone verifies HMAC + routing via
   synthetic signed payloads and drives verify-mock through the in-process registry. The live
   HTTP path (ngrok / deployed host) is the integration step, not part of this milestone.
4. **Exact SDK method/field accessors** (e.g., reading metadata values back off the instance
   object, download-stream-to-string helper) to be confirmed against `box-typescript-sdk-gen`
   docs during implementation; the manager-level calls above are correct.

---

_This is a component design spec. SPEC.md remains authoritative; record any behavioral
deviation here (§10) and in SPEC §15._
