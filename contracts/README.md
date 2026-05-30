# contracts/ — the parallel-work seam

These files let three people build the system at once without waiting on each other.
See [`../TASKS.md`](../TASKS.md) for the full per-person breakdown.

| File | What it is | Who touches it |
|------|------------|----------------|
| `box-client.mjs` | **Frozen v1 interface.** Every component talks through this. | All (read-only; edits need group sign-off) |
| `box-client-mock.mjs` | Filesystem-backed fake Box implementing the interface. | A & C develop against it; B replaces it |
| `verify-mock.mjs` | Runs the whole pipeline against the mock. Reference + acceptance test. | All |

## Try it

```bash
node contracts/verify-mock.mjs
```

You should see the card go `inbox → ready-for-build → building → building-approved →
completed`, with the Orchestrator reacting to webhooks — all with no real Box, GitHub,
Reddit, or Claude.

## How each person uses it

- **A (Idea Miner):** `import { FileSystemBoxClient } from '../contracts/box-client-mock.mjs'`
  then `findDuplicate()` + `uploadCard()`.
- **B (Box Hub):** `class RealBoxClient extends BoxClient { ... }` against the Box SDK,
  then point `verify-mock.mjs` at it — same assertions must pass.
- **C (Orchestrator):** register `box.onWebhook(...)` and drive the state machine with
  `getMetadata` / `setMetadata` / `getSpecMarkdown` / `createTask` / `moveCard`. Use the
  payloads in `../fixtures/` to exercise the handler.

To go live, each component changes one import: mock → B's real client.
