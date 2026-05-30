const TEMPLATE_KEY = 'devtool_build_card';
const SCOPE = 'enterprise';

const EXPECTED_FIELDS = [
  { key: 'status', type: 'enum', options: ['inbox', 'ready-for-build', 'building', 'building-approved', 'completed', 'failed'] },
  { key: 'theme', type: 'string' },
  { key: 'pain_score', type: 'float' },
  { key: 'card_id', type: 'string' },
  { key: 'builder_session_id', type: 'string' },
  { key: 'repo_url', type: 'string' },
  { key: 'pr_url', type: 'string' },
];

export async function ensureMetadataTemplate(client) {
  let template;

  try {
    template = await client.metadataTemplates.getMetadataTemplate(SCOPE, TEMPLATE_KEY);
    console.log(`EXISTS (skipped) metadata template ${SCOPE}.${TEMPLATE_KEY} (id ${template.id})`);

    const drifts = detectDrift(template);
    for (const d of drifts) {
      console.log(`WARN metadata template field "${d.fieldKey}" — expected ${d.expected}, got ${d.actual}`);
    }

    return template;
  } catch (err) {
    if (isNotFoundError(err)) {
      template = await client.metadataTemplates.createMetadataTemplate({
        scope: SCOPE,
        templateKey: TEMPLATE_KEY,
        displayName: 'DevTool Build Card',
        fields: EXPECTED_FIELDS.map((f) => ({
          type: f.type,
          key: f.key,
          displayName: f.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          ...(f.options ? { options: f.options.map((o) => ({ key: o })) } : {}),
        })),
      });
      console.log(`CREATED metadata template ${SCOPE}.${TEMPLATE_KEY} (id ${template.id})`);
      return template;
    }
    throw err;
  }
}

function detectDrift(template) {
  const actualFields = template.fields || [];
  const drifts = [];

  for (const expected of EXPECTED_FIELDS) {
    const actual = actualFields.find((f) => f.key === expected.key);
    if (!actual) {
      drifts.push({ fieldKey: expected.key, expected: `field present`, actual: `missing` });
      continue;
    }
    if (actual.type !== expected.type) {
      drifts.push({ fieldKey: expected.key, expected: `type="${expected.type}"`, actual: `type="${actual.type}"` });
    }
    if (expected.options) {
      const actualOptKeys = (actual.options || []).map((o) => o.key).sort();
      const expectedOptKeys = [...expected.options].sort();
      if (JSON.stringify(actualOptKeys) !== JSON.stringify(expectedOptKeys)) {
        drifts.push({ fieldKey: expected.key, expected: `options=[${expectedOptKeys.join(',')}]`, actual: `options=[${actualOptKeys.join(',')}]` });
      }
    }
  }

  return drifts;
}

function isNotFoundError(err) {
  const status = extractStatusCode(err);
  if (status === 404) return true;
  return err?.message && err.message.includes('not_found');
}

function extractStatusCode(err) {
  if (typeof err?.responseInfo?.statusCode === 'number') return err.responseInfo.statusCode;
  if (typeof err?.response?.status === 'number') return err.response.status;
  if (typeof err?.status === 'number') return err.status;
  const match = typeof err?.message === 'string' && err.message.match(/^(\d{3})/);
  if (match) return Number(match[1]);
  return 0;
}
