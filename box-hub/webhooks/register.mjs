const TRIGGERS = ['METADATA_INSTANCE.UPDATED', 'ITEM.MOVED'];

export async function ensureWebhooks(client, folderId, targetUrl) {
  const ids = [];

  const existing = await client.webhooks.getWebhooks({ limit: 200 });
  const candidates = (existing.entries || []).filter(
    (w) => w.target?.id === folderId && w.target?.type === 'folder',
  );

  for (const candidate of candidates) {
    const full = await client.webhooks.getWebhookById(candidate.id);
    if (full.address === targetUrl && hasSameTriggers(full.triggers || [])) {
      ids.push(full.id);
      console.log(`EXISTS (skipped) webhook ${full.id} on folder ${folderId} for ${targetUrl}`);
    }
  }

  if (ids.length === 0) {
    const created = await client.webhooks.createWebhook({
      target: { id: folderId, type: 'folder' },
      address: targetUrl,
      triggers: TRIGGERS,
    });
    ids.push(created.id);
    console.log(`CREATED webhook ${created.id} on folder ${folderId} for ${targetUrl}`);
  }

  return ids;
}

function hasSameTriggers(actual) {
  const sorted = [...actual].sort();
  const expected = [...TRIGGERS].sort();
  return sorted.length === expected.length && sorted.every((v, i) => v === expected[i]);
}
