/**
 * folders.mjs — idempotent Box folder provisioning + card-folder resolution (SPEC.md §5.1).
 * Takes an authenticated SDK client (injected, so it is unit-tested with a fake).
 */

import { ROOT, FOLDERS, FOLDER_TREE, statusFolder } from './paths.mjs';

const ROOT_ID = '0';

async function findChild(client, parentId, name) {
  const items = await client.folders.getFolderItems(parentId);
  return (items.entries ?? []).find((e) => e.type === 'folder' && e.name === name) ?? null;
}

/** Create the child if absent (idempotent); return its id. */
async function ensureChild(client, parentId, name) {
  const existing = await findChild(client, parentId, name);
  if (existing) return existing.id;
  const created = await client.folders.createFolder({ name, parent: { id: parentId } });
  return created.id;
}

/** Walk the §5.1 tree creating any missing node; returns { path → folderId }. */
export async function ensureFolderTree(client) {
  const ids = {};
  for (const node of FOLDER_TREE) {
    const parentId = node.parent ? ids[node.parent] : ROOT_ID;
    ids[node.path] = await ensureChild(client, parentId, node.name);
  }
  return ids;
}

/** Resolve (creating if needed) BuildCards/<statusFolder>/<cardId>/; returns its folder id. */
export async function ensureCardFolder(client, cardId, status, tree) {
  const sf = statusFolder(status);
  if (!sf) throw new Error(`no status folder for status=${status} (SPEC §5.1)`);
  const ids = tree ?? (await ensureFolderTree(client));
  const statusId = ids[`${ROOT}/${FOLDERS.buildCards}/${sf}`];
  return ensureChild(client, statusId, cardId);
}

export async function moveFolder(client, folderId, newParentId) {
  await client.folders.updateFolderById(folderId, { parent: { id: newParentId } });
}

/** Add an editor collaborator to a folder if not already present (idempotent). */
export async function ensureCollaborator(client, folderId, email) {
  const collabs = await client.listCollaborations.getFolderCollaborations(folderId);
  const existing = (collabs.entries ?? []).find(
    (c) => c.accessibleBy?.type === 'user' && c.accessibleBy?.login === email,
  );
  if (existing) return existing;
  return client.userCollaborations.createCollaboration({
    item: { type: 'folder', id: folderId },
    accessibleBy: { type: 'user', login: email },
    role: 'editor',
  });
}
