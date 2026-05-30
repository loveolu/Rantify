/**
 * create-template.mjs — idempotently create the `devtool_build_card` enterprise metadata
 * template (SPEC.md §5.3). Re-running is safe: an existing-template conflict is treated as
 * success. Run: `node box-hub/setup/create-template.mjs` (needs Box CCG creds, SPEC §13).
 */
import { getBoxClient } from '../lib/auth.mjs';
import { templateFields } from './template-fields.mjs';

export async function createTemplate(client) {
  if (!client) client = await getBoxClient();
  try {
    await client.metadataTemplates.createMetadataTemplate({
      scope: 'enterprise',
      templateKey: 'devtool_build_card',
      displayName: 'DevTool Build Card',
      fields: templateFields(),
    });
    return { created: true };
  } catch (err) {
    if (/conflict|already exists|409/i.test(err?.message ?? '')) return { created: false, existed: true };
    throw err;
  }
}

if (process.argv[1]?.endsWith('create-template.mjs')) {
  createTemplate()
    .then((r) => console.log(`[box-hub] devtool_build_card template ${r.existed ? 'already exists' : 'created'}.`))
    .catch((err) => { console.error(err); process.exit(1); });
}
