# box-hub/ — Box Content Hub (Person B)

The **real** implementation of the frozen `BoxClient` contract (`contracts/box-client.mjs`),
plus the `POST /webhooks/box` server and Box provisioning scripts. Implements SPEC.md §7
(+ the data model in §5). Design: [`../docs/superpowers/specs/2026-05-30-box-content-hub-design.md`](../docs/superpowers/specs/2026-05-30-box-content-hub-design.md).

## Run offline (no Box account)

```bash
node box-hub/verify-real.mjs           # verify-mock scenario against RealBoxClient (drop-in proof)
node --test box-hub/**/*.test.mjs      # unit tests (SDK faked at the lib/* boundary)
```

## Go live (real Box, Client Credentials Grant)

1. Set env (SPEC §13): `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, `BOX_ENTERPRISE_ID`,
   `BOX_WEBHOOK_PRIMARY_KEY`, `BOX_WEBHOOK_SECONDARY_KEY`, `ORCHESTRATOR_HOST`.
2. Provision (idempotent, safe to re-run):
   ```bash
   node box-hub/setup/print-config.mjs     # confirm env presence (never prints values)
   npm run setup:phase0                    # template → folders → webhooks, in order
   ```
3. Repoint consumers from the mock to the real client — the **one-line swap**:
   ```js
   // import { FileSystemBoxClient } from '../contracts/box-client-mock.mjs';
   import { RealBoxClient } from '../box-hub/index.mjs';
   const box = new RealBoxClient();
   ```
4. Acceptance against real Box: run the `verify-real.mjs` scenario (or the live one-card
   walk) — same assertions as the mock must pass.

## Map (build order F1–F13)

| Concern | File |
|---|---|
| CCG auth (memoized client) | `lib/auth.mjs` |
| Folder layout + card folders (§5.1) | `lib/paths.mjs`, `lib/folders.mjs` |
| Metadata template fields (§5.3) | `setup/template-fields.mjs`, `setup/create-template.mjs` |
| File upload/download (§8.3) | `lib/files.mjs` |
| Metadata read/write + null mapping (§5.3) | `lib/metadata.mjs`, `lib/metadata-map.mjs` |
| Search: findDuplicate / listCardsByStatus | `lib/search.mjs` |
| Approval task (§7.3) | `lib/tasks.mjs` |
| HMAC verify, dual-key + replay (§7.2) | `lib/hmac.mjs` |
| Webhook server + registry (§8.2, §10.2) | `webhook/server.mjs`, `webhook/registry.mjs` |
| Webhook registration (§7.2) | `setup/register-webhooks.mjs`, `setup/webhook-plan.mjs` |
| `RealBoxClient` facade | `box-client-real.mjs`, `index.mjs` |

## Notes / open items (design §10)

- **Null metadata fields** are omitted on write and read back as `null` (Box can't store null).
- **`getArtifact`** was added to the frozen contract (new method) for Person C's Phase 2; it is
  implemented here. Box-side: artifacts live in the card folder (`area:'card'`) or `Logs/`.
- **Live webhook delivery** (ngrok / deployed host) is the integration step; offline runs use
  synthetic signed payloads and the in-process registry.
- Unit tests fake the SDK at the `lib/*` boundary, so no Box account is needed for CI.
