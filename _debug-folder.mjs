// Walk the BuildCards folder tree and report what's in each status subfolder.
import path from 'node:path';
try { process.loadEnvFile(path.join(import.meta.dirname, '.env')); } catch {}
import { RealBoxClient } from './box-hub/box-client-real.mjs';
import { ROOT, FOLDERS } from './box-hub/lib/paths.mjs';

const box = new RealBoxClient();
const client = await box._client();
const tree = await box._tree();

const STATUS = ['Inbox', 'Ready-for-Build', 'In-Progress', 'Completed'];

for (const sub of STATUS) {
  const subId = tree[`${ROOT}/${FOLDERS.buildCards}/${sub}`];
  const items = await client.folders.getFolderItems(subId);
  console.log(`\n=== ${sub} (id=${subId}) — ${items.entries?.length ?? 0} items ===`);
  for (const e of items.entries ?? []) {
    console.log(`  ${e.type}/${e.id}  ${e.name}`);
    if (e.type === 'folder') {
      const sub2 = await client.folders.getFolderItems(e.id);
      for (const f of sub2.entries ?? []) {
        console.log(`    └─ ${f.type}/${f.id}  ${f.name}`);
        if (f.type === 'file' && f.name === 'spec.md') {
          // Check metadata
          try {
            const md = await client.fileMetadata.getFileMetadataById(f.id, 'enterprise', 'devtool_build_card');
            console.log(`       metadata: ${JSON.stringify({ status: md.status, theme: md.theme, card_id: md.card_id })}`);
          } catch (err) {
            console.log(`       metadata: MISSING (${err.message?.slice(0, 80)})`);
          }
        }
      }
    }
  }
}

// Also test search by template
console.log('\n=== Search by template (what /api/cards uses) ===');
const rootId = tree[ROOT];
const res = await client.search.searchForContent({
  ancestorFolderIds: [rootId],
  mdfilters: [{ scope: 'enterprise', templateKey: 'devtool_build_card', filters: [] }],
});
console.log(`search returned ${(res.entries ?? []).length} entries`);
for (const e of res.entries ?? []) {
  console.log(`  ${e.type}/${e.id} ${e.name}`);
}
process.exit(0);
