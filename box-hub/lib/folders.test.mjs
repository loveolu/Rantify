import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureFolderTree, ensureCardFolder, moveFolder } from './folders.mjs';

/** In-memory Box-folder fake: ids auto-increment, '0' is root. */
function fakeClient() {
  let seq = 100;
  const children = new Map(); // parentId -> [{id,name,type}]
  const get = (p) => children.get(p) ?? [];
  return {
    created: 0,
    folders: {
      getFolderItems: async (id) => ({ entries: get(id) }),
      createFolder: async ({ name, parent }) => {
        const id = String(seq++);
        const list = get(parent.id); list.push({ id, name, type: 'folder' });
        children.set(parent.id, list);
        return { id, name, type: 'folder' };
      },
      updateFolderById: async (id, body) => ({ id, parent: body.parent }),
    },
    _children: children,
  };
}

test('ensureFolderTree creates the full §5.1 tree and returns path→id', async () => {
  const c = fakeClient();
  const ids = await ensureFolderTree(c);
  assert.ok(ids['DevTool-Loop']);
  assert.ok(ids['DevTool-Loop/BuildCards/Inbox']);
  assert.ok(ids['DevTool-Loop/Logs']);
});

test('a second ensureFolderTree run is a no-op (idempotent, same ids)', async () => {
  const c = fakeClient();
  const first = await ensureFolderTree(c);
  const created = [...c._children.values()].reduce((n, l) => n + l.length, 0);
  const second = await ensureFolderTree(c);
  const createdAfter = [...c._children.values()].reduce((n, l) => n + l.length, 0);
  assert.equal(created, createdAfter, 'no new folders on the second run');
  assert.deepEqual(second, first);
});

test('ensureCardFolder returns the same id on repeat (idempotent)', async () => {
  const c = fakeClient();
  const tree = await ensureFolderTree(c);
  const a = await ensureCardFolder(c, 'card-1', 'inbox', tree);
  const b = await ensureCardFolder(c, 'card-1', 'inbox', tree);
  assert.equal(a, b);
});

test('ensureCardFolder places ready-for-build cards under Ready-for-Build', async () => {
  const c = fakeClient();
  const tree = await ensureFolderTree(c);
  const id = await ensureCardFolder(c, 'card-2', 'ready-for-build', tree);
  const rfb = tree['DevTool-Loop/BuildCards/Ready-for-Build'];
  const kids = (await c.folders.getFolderItems(rfb)).entries;
  assert.ok(kids.some((k) => k.id === id && k.name === 'card-2'));
});

test('moveFolder updates the parent', async () => {
  const c = fakeClient();
  let captured;
  c.folders.updateFolderById = async (id, body) => { captured = { id, body }; return { id }; };
  await moveFolder(c, 'f1', 'p2');
  assert.deepEqual(captured, { id: 'f1', body: { parent: { id: 'p2' } } });
});
