/**
 * register-webhooks.mjs — register Box webhooks on the BuildCards folder for the two
 * triggers (SPEC.md §7.2), idempotently. Target: ${ORCHESTRATOR_HOST}/webhooks/box.
 * Run: `node box-hub/setup/register-webhooks.mjs` (needs Box CCG creds + ORCHESTRATOR_HOST).
 */
import { getBoxClient } from '../lib/auth.mjs';
import { ensureFolderTree } from '../lib/folders.mjs';
import { ROOT, FOLDERS } from '../lib/paths.mjs';
import { needsWebhook, isPublicWebhookAddress } from './webhook-plan.mjs';

const TRIGGERS = ['METADATA_INSTANCE.UPDATED', 'ITEM.MOVED'];

export async function registerWebhooks(client, env = process.env) {
  if (!client) client = await getBoxClient();
  const host = env.ORCHESTRATOR_HOST;
  if (!host) throw new Error('ORCHESTRATOR_HOST is required to register webhooks (SPEC §13)');
  const address = `${host.replace(/\/$/, '')}/webhooks/box`;

  // Box rejects non-public/HTTP targets (e.g. localhost) with 400. Skip rather than fail —
  // the orchestrator poller detects changes when running locally without a public tunnel.
  if (!isPublicWebhookAddress(address)) {
    console.warn(`[box-hub] skipping webhook registration: ${address} is not a public HTTPS URL (local dev). The orchestrator poller will detect Box changes instead.`);
    return { created: false, skipped: true, reason: 'non-public address' };
  }

  const tree = await ensureFolderTree(client);
  const target = { id: tree[`${ROOT}/${FOLDERS.buildCards}`], type: 'folder' };

  const existing = (await client.webhooks.getWebhooks())?.entries ?? [];
  if (!needsWebhook(existing, { target, address, triggers: TRIGGERS })) {
    return { created: false };
  }
  await client.webhooks.createWebhook({ target, address, triggers: TRIGGERS });
  return { created: true };
}

if (process.argv[1]?.endsWith('register-webhooks.mjs')) {
  registerWebhooks()
    .then((r) => console.log(`[box-hub] webhooks ${r.created ? 'registered' : 'already present'}.`))
    .catch((err) => { console.error(err); process.exit(1); });
}
