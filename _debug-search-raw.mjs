import path from 'node:path';
try { process.loadEnvFile(path.join(import.meta.dirname, '.env')); } catch {}
import { RealBoxClient } from './box-hub/box-client-real.mjs';
import { ROOT } from './box-hub/lib/paths.mjs';

const box = new RealBoxClient();
const client = await box._client();
const tree = await box._tree();
const rootId = tree[ROOT];

console.log('rootId=', rootId);

const res = await client.search.searchForContent({
  ancestorFolderIds: [rootId],
  mdfilters: [{ scope: 'enterprise', templateKey: 'devtool_build_card', filters: [] }],
});

console.log('total entries:', (res.entries ?? []).length);
for (const e of res.entries ?? []) {
  console.log('---');
  console.log('id:', e.id, 'name:', e.name, 'type:', e.type);
  console.log('metadata keys:', Object.keys(e.metadata ?? {}));
  console.log('full metadata:', JSON.stringify(e.metadata, null, 2));
}

// Also check the inbox spec.md directly
const fileId = '2255049160659';
console.log('\n=== file directly, with fields=metadata.enterprise.devtool_build_card ===');
try {
  const f = await client.files.getFileById(fileId, { queryParams: { fields: ['name', 'metadata.enterprise.devtool_build_card'] } });
  console.log(JSON.stringify(f.metadata, null, 2));
} catch (err) {
  console.log('getFileById ERR:', err.message);
}

console.log('\n=== getFileMetadataById ===');
try {
  const m = await client.fileMetadata.getFileMetadataById(fileId, 'enterprise', 'devtool_build_card');
  console.log(JSON.stringify(m, null, 2));
} catch (err) {
  console.log('getFileMetadataById ERR:', err.message);
}

process.exit(0);
