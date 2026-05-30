/**
 * setup/phase0.mjs — SPEC.md §14 Phase 0 provisioning entrypoint (the `npm run setup:phase0`
 * target). Runs the Box Content Hub provisioning in order against real Box:
 *   1. check env  2. metadata template  3. folder layout  4. webhooks
 * Each step is idempotent, so this is safe to re-run. Needs Box CCG creds + ORCHESTRATOR_HOST.
 */
import path from 'node:path';
import { reportConfig } from '../box-hub/setup/print-config.mjs';
import { createTemplate } from '../box-hub/setup/create-template.mjs';
import { createFolders } from '../box-hub/setup/create-folders.mjs';
import { registerWebhooks } from '../box-hub/setup/register-webhooks.mjs';

// Auto-load repo-root .env so `npm run setup:phase0` works without a shell wrapper (cross-platform).
try { process.loadEnvFile(path.join(import.meta.dirname, '..', '.env')); } catch { /* no .env file — rely on the ambient environment */ }

async function main() {
  const missing = reportConfig().filter((r) => !r.present).map((r) => r.key);
  if (missing.length) throw new Error(`Missing env: ${missing.join(', ')} (SPEC §13)`);

  console.log('1/3 metadata template…');
  const t = await createTemplate();
  console.log(`    ${t.existed ? 'exists' : 'created'}`);

  console.log('2/3 folder layout…');
  const ids = await createFolders();
  console.log(`    ${Object.keys(ids).length} folders ensured`);

  console.log('3/3 webhooks…');
  const w = await registerWebhooks();
  console.log(`    ${w.skipped ? 'skipped (local/non-HTTPS host — poller will be used)' : w.created ? 'registered' : 'already present'}`);

  console.log('\n✅ Phase 0 provisioning complete.');
}

main().catch((err) => { console.error('\n❌ Phase 0 failed:', err.message); process.exit(1); });
