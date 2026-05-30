/**
 * create-folders.mjs — idempotently create the §5.1 folder layout. Run:
 * `node box-hub/setup/create-folders.mjs` (needs Box CCG creds, SPEC §13).
 */
import { getBoxClient } from '../lib/auth.mjs';
import { ensureFolderTree } from '../lib/folders.mjs';

export async function createFolders(client = getBoxClient()) {
  return ensureFolderTree(client);
}

if (process.argv[1]?.endsWith('create-folders.mjs')) {
  createFolders()
    .then((ids) => console.log(`[box-hub] folder layout ensured (${Object.keys(ids).length} folders).`))
    .catch((err) => { console.error(err); process.exit(1); });
}
