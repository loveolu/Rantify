export async function ensureFolderTree(client) {
  const tree = [
    'DevTool-Loop',
    'DevTool-Loop/BuildCards',
    'DevTool-Loop/BuildCards/Inbox',
    'DevTool-Loop/BuildCards/Ready-for-Build',
    'DevTool-Loop/BuildCards/In-Progress',
    'DevTool-Loop/BuildCards/Completed',
    'DevTool-Loop/Logs',
  ];

  const folderMap = {};
  let parentId = '0';

  for (const path of tree) {
    const name = path.split('/').pop();
    const existing = await findSubfolderByName(client, parentId, name);
    if (existing) {
      folderMap[path] = existing.id;
      parentId = existing.id;
      console.log(`EXISTS (skipped) folder /${path} (id ${existing.id})`);
    } else {
      const created = await client.folders.createFolder({
        name,
        parent: { id: parentId },
      });
      folderMap[path] = created.id;
      parentId = created.id;
      console.log(`CREATED folder /${path} (id ${created.id})`);
    }
  }

  return folderMap;
}

export async function ensureCollaborator(client, folderId, email) {
  const collabs = await client.listCollaborations.getFolderCollaborations(folderId);
  const existing = collabs.entries?.find(
    (c) => c.accessibleBy?.type === 'user' && c.accessibleBy?.login === email,
  );
  if (existing) {
    console.log(`EXISTS (skipped) collaboration for ${email} on folder ${folderId}`);
    return existing;
  }
  const created = await client.userCollaborations.createCollaboration({
    item: { type: 'folder', id: folderId },
    accessibleBy: { type: 'user', login: email },
    role: 'editor',
  });
  console.log(`CREATED collaboration for ${email} (id ${created.id}) on folder ${folderId}`);
  return created;
}

async function findSubfolderByName(client, parentId, name) {
  const items = await client.folders.getFolderItems(parentId, {
    queryParams: { limit: 200, fields: ['id', 'name', 'type'] },
  });
  const entry = items.entries?.find(
    (e) => e.type === 'folder' && e.name === name,
  );
  return entry || null;
}
