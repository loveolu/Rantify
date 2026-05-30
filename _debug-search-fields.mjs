import path from 'node:path';
try { process.loadEnvFile(path.join(import.meta.dirname, '.env')); } catch {}
import { RealBoxClient } from './box-hub/box-client-real.mjs';
import { ROOT } from './box-hub/lib/paths.mjs';

const box = new RealBoxClient();
const client = await box._client();
const tree = await box._tree();
const rootId = tree[ROOT];

const res = await client.search.searchForContent({
  ancestorFolderIds: [rootId],
  mdfilters: [{ scope: 'enterprise', templateKey: 'devtool_build_card', filters: [] }],
  fields: ['name', 'id', 'metadata.enterprise.devtool_build_card'],
});

console.log('entries:', (res.entries ?? []).length);
for (const e of res.entries ?? []) {
  console.log('---');
  console.log('id=', e.id, 'name=', e.name);
  console.log(JSON.stringify(e, null, 2));
}
process.exit(0);
