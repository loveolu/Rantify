import { getClient } from '../box-hub/auth.mjs';
import { ensureFolderTree, ensureCollaborator } from '../box-hub/folders.mjs';
import { ensureMetadataTemplate } from '../box-hub/metadata.mjs';
import { ensureWebhooks } from '../box-hub/webhooks/register.mjs';

const REQUIRED_ENV = [
  'BOX_CLIENT_ID',
  'BOX_CLIENT_SECRET',
  'BOX_ENTERPRISE_ID',
  'REVIEWER_EMAIL',
];

function validateEnv() {
  const empty = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (empty.length > 0) {
    console.error(`Missing or empty required environment variables: ${empty.join(', ')}`);
    const blank = empty.filter((k) => process.env[k] === '');
    if (blank.length > 0) {
      console.error(`  Tip: ${blank.join(', ')} ${blank.length === 1 ? 'has' : 'have'} the key but no value — ${'BOX_CLIENT_ID' === blank[0] ? 'check your .env file' : 'fill in the value'}`);
    }
    process.exit(1);
  }
}

async function withRetry(fn, label) {
  const maxAttempts = 2;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isTransient = isTransientError(err);
      if (attempt < maxAttempts && isTransient) {
        console.log(`Retrying ${label} after transient error: ${err.message}`);
        continue;
      }
    }
  }
  console.error(`FAILED ${label}`);
  printError(lastErr);
  throw lastErr;
}

function printError(err) {
  console.error(`  message: ${err.message}`);
  for (const key of Object.getOwnPropertyNames(err)) {
    try {
      const val = err[key];
      if (typeof val === 'object' && val !== null) {
        const sanitized = JSON.parse(JSON.stringify(val, (k, v) => k === 'headers' ? '[redacted]' : v));
        console.error(`  ${key}: ${JSON.stringify(sanitized, null, 2)}`);
      } else if (val !== undefined) {
        console.error(`  ${key}: ${val}`);
      }
    } catch (e) {
      console.error(`  ${key}: [error printing: ${e.message}]`);
    }
  }
}

function replacer(key, val) {
  if (key === 'headers') return '[redacted]';
  return val;
}

function extractStatusCode(err) {
  if (typeof err?.responseInfo?.statusCode === 'number') return err.responseInfo.statusCode;
  if (typeof err?.response?.status === 'number') return err.response.status;
  if (typeof err?.status === 'number') return err.status;
  const match = typeof err?.message === 'string' && err.message.match(/^(\d{3})/);
  if (match) return Number(match[1]);
  return 0;
}

function isTransientError(err) {
  const status = extractStatusCode(err);
  return status >= 500 || status === 429 || err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT';
}

async function main() {
  validateEnv();

  const client = getClient();

  const folderMap = await withRetry(() => ensureFolderTree(client), 'folder tree');
  const buildCardsId = folderMap['DevTool-Loop/BuildCards'];
  const rootId = folderMap['DevTool-Loop'];

  await withRetry(
    () => ensureCollaborator(client, rootId, process.env.REVIEWER_EMAIL),
    'collaborator',
  );

  const template = await withRetry(() => ensureMetadataTemplate(client), 'metadata template');

  let webhookIds = [];
  if (process.env.ORCHESTRATOR_HOST) {
    const targetUrl = `${process.env.ORCHESTRATOR_HOST.replace(/\/+$/, '')}/webhooks/box`;
    webhookIds = await withRetry(
      () => ensureWebhooks(client, buildCardsId, targetUrl),
      'webhooks',
    );
  } else {
    // TODO: after merging with Person C (Orchestrator), add ORCHESTRATOR_HOST back to
    // REQUIRED_ENV at line 6 and remove this conditional — webhook registration is
    // essential for the status-change → orchestrator trigger in §7.2.
    console.log('ORCHESTRATOR_HOST not set — skipping webhook registration');
  }

  const notes = {
    templateKey: `enterprise.${template.templateKey || template.template_key || 'devtool_build_card'}`,
    folderIds: folderMap,
    webhookIds,
    createdAt: new Date().toISOString(),
  };

  const { fileURLToPath } = await import('node:url');
  const notesPath = fileURLToPath(new URL('PHASE0_NOTES.md', import.meta.url));
  const fs = await import('node:fs');
  fs.writeFileSync(notesPath, formatNotes(notes), 'utf8');
  console.log(`\nWrote ${notesPath}`);
}

function formatNotes(notes) {
  const lines = [
    '# Phase 0 Setup Notes',
    `- **Created at:** ${notes.createdAt}`,
    `- **Metadata template:** \`${notes.templateKey}\``,
    '',
    '## Folders',
    ...Object.entries(notes.folderIds).map(([path, id]) => `- \`/${path}\` → \`${id}\``),
    '',
    '## Webhooks',
    ...notes.webhookIds.map((id) => `- \`${id}\``),
    '',
  ];
  return lines.join('\n');
}

const exitCode = await main().then(
  () => 0,
  (err) => {
    const status = extractStatusCode(err);
    return status > 0 ? 2 : 1;
  },
);

process.exit(exitCode);
