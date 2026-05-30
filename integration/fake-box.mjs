/**
 * fake-box.mjs — a minimal in-memory Box backing the SDK surface RealBoxClient uses, shared
 * by the integration tests. Not a production artifact; it stands in for the Box API so the
 * real RealBoxClient (Person B) can be driven offline.
 */
/** Read an upload body to a string: real Box (and uploadText) pass a Readable ByteStream,
 *  but a Buffer or plain string may also appear. Mirrors box-hub/lib/files.mjs#downloadText. */
async function readUpload(file) {
  if (file == null) return '';
  if (typeof file === 'string') return file;
  if (Buffer.isBuffer(file)) return file.toString('utf8');
  const chunks = [];
  for await (const chunk of file) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export function fakeBox() {
  let seq = 1; const id = (p) => `${p}_${seq++}`;
  const folders = new Map([['0', { id: '0', name: 'root', parentId: null }]]);
  const files = new Map(); const meta = new Map();
  const kids = (pid) => [
    ...[...folders.values()].filter((f) => f.parentId === pid).map((f) => ({ id: f.id, name: f.name, type: 'folder' })),
    ...[...files.values()].filter((f) => f.parentId === pid).map((f) => ({ id: f.id, name: f.name, type: 'file' })),
  ];
  return {
    folders: {
      getFolderItems: async (fid) => ({ entries: kids(fid) }),
      createFolder: async ({ name, parent }) => { const fid = id('folder'); folders.set(fid, { id: fid, name, parentId: parent.id }); return { id: fid, name, type: 'folder' }; },
      updateFolderById: async (fid, b) => { folders.get(fid).parentId = b.parent.id; return { id: fid }; },
    },
    uploads: {
      uploadFile: async ({ attributes, file }) => { const fid = id('file'); files.set(fid, { id: fid, name: attributes.name, parentId: attributes.parent.id, content: await readUpload(file), modified_at: new Date().toISOString() }); return { entries: [{ id: fid }] }; },
      uploadFileVersion: async (fid, { file }) => { files.get(fid).content = await readUpload(file); return { entries: [{ id: fid }] }; },
    },
    downloads: { downloadFile: async (fid) => Buffer.from(files.get(fid).content, 'utf8') },
    fileMetadata: {
      createFileMetadataById: async (fid, _s, _t, v) => { meta.set(fid, { ...v }); },
      getFileMetadataById: async (fid) => ({ extraData: { ...(meta.get(fid) ?? {}) } }),
      updateFileMetadataById: async (fid, _s, _t, ops) => { const m = meta.get(fid) ?? {}; for (const o of ops) { const k = o.path.slice(1); if (o.op === 'remove') delete m[k]; else m[k] = o.value; } meta.set(fid, m); },
    },
    tasks: { createTask: async () => ({ id: id('task') }) },
    // Mirror real Box: searchForContent wraps the template instance at
    // metadata.extraData.<scope>.<template>.extraData and includes $-prefixed system fields.
    search: { searchForContent: async () => ({ entries: [...files.values()].filter((f) => meta.has(f.id)).map((f) => ({ id: f.id, type: 'file', modified_at: f.modified_at, metadata: { extraData: { enterprise: { devtool_build_card: { extraData: { $parent: `file_${f.id}`, $template: 'devtool_build_card', $scope: 'enterprise_1', ...meta.get(f.id) } } } } } })) }) },
  };
}
