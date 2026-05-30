import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { uploadText, downloadText } from './files.mjs';

test('uploadText creates a new file when the name is absent', async () => {
  let body;
  const client = {
    folders: { getFolderItems: async () => ({ entries: [] }) },
    uploads: { uploadFile: async (b) => { body = b; return { entries: [{ id: 'file_1' }] }; } },
  };
  const id = await uploadText(client, { parentId: '10', name: 'spec.md', content: '# spec' });
  assert.equal(id, 'file_1');
  assert.equal(body.attributes.name, 'spec.md');
  assert.equal(body.attributes.parent.id, '10');
});

test('uploadText uploads a new VERSION when the name already exists', async () => {
  let versionedFileId;
  const client = {
    folders: { getFolderItems: async () => ({ entries: [{ id: 'file_existing', name: 'spec.md', type: 'file' }] }) },
    uploads: { uploadFileVersion: async (id) => { versionedFileId = id; return { entries: [{ id }] }; } },
  };
  const id = await uploadText(client, { parentId: '10', name: 'spec.md', content: 'v2' });
  assert.equal(versionedFileId, 'file_existing');
  assert.equal(id, 'file_existing');
});

test('downloadText reads a stream body to a string', async () => {
  const client = { downloads: { downloadFile: async () => Readable.from([Buffer.from('hello '), Buffer.from('world')]) } };
  assert.equal(await downloadText(client, 'file_1'), 'hello world');
});

test('downloadText handles a Buffer/ArrayBuffer body', async () => {
  const client = { downloads: { downloadFile: async () => Buffer.from('plain') } };
  assert.equal(await downloadText(client, 'file_1'), 'plain');
});
