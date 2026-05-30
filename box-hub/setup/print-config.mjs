/**
 * print-config.mjs — report presence of the required env vars (never their values), for
 * diagnostics before a live run. Run: `node box-hub/setup/print-config.mjs`.
 */
const REQUIRED = [
  'BOX_CLIENT_ID', 'BOX_CLIENT_SECRET', 'BOX_ENTERPRISE_ID',
  'BOX_WEBHOOK_PRIMARY_KEY', 'BOX_WEBHOOK_SECONDARY_KEY', 'ORCHESTRATOR_HOST',
];

export function reportConfig(env = process.env) {
  return REQUIRED.map((k) => ({ key: k, present: Boolean(env[k]) }));
}

if (process.argv[1]?.endsWith('print-config.mjs')) {
  const rows = reportConfig();
  for (const r of rows) console.log(`${r.present ? '✓' : '✗'} ${r.key}`);
  const missing = rows.filter((r) => !r.present).map((r) => r.key);
  if (missing.length) { console.error(`\nMissing: ${missing.join(', ')}`); process.exit(1); }
  console.log('\nAll required Box env vars present.');
}
