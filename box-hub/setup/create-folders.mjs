/**
 * create-folders.mjs — idempotently create the §5.1 folder layout and add the
 * reviewer collaborator. Run: `node box-hub/setup/create-folders.mjs` (needs Box
 * CCG creds + REVIEWER_EMAIL, SPEC §13).
 */
import { getBoxClient } from '../lib/auth.mjs';
import { ensureFolderTree, ensureCollaborator } from '../lib/folders.mjs';

export async function createFolders(client = getBoxClient(), env = process.env) {
  const ids = await ensureFolderTree(client);
  const email = env.REVIEWER_EMAIL;
  if (email) {
    const rootId = ids['DevTool-Loop'];
    await ensureCollaborator(client, rootId, email);
  }
  return ids;
}

if (process.argv[1]?.endsWith('create-folders.mjs')) {
  createFolders()
    .then((ids) => console.log(`[box-hub] folder layout ensured (${Object.keys(ids).length} folders).`))
    .catch((err) => { console.error(err); process.exit(1); });
}
