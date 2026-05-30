/**
 * files.mjs — upload text files (new or new-version) and download a file body as text.
 * Maps to contract uploadCard(spec.md), uploadArtifact, getSpecMarkdown (SPEC.md §8.3).
 */

import { Readable } from 'node:stream';

async function findFile(client, parentId, name) {
  const items = await client.folders.getFolderItems(parentId);
  return (items.entries ?? []).find((e) => e.type === 'file' && e.name === name) ?? null;
}

/** box-typescript-sdk-gen expects `file` as a ByteStream (Readable), NOT a raw Buffer. */
function toByteStream(content) {
  return Readable.from(Buffer.from(content, 'utf8'));
}

/**
 * Upload UTF-8 text; if a file of the same name exists in the parent, upload a new VERSION
 * (so cards aren't duplicated on re-write). Returns the file id.
 */
export async function uploadText(client, { parentId, name, content }) {
  const file = toByteStream(content);
  const existing = await findFile(client, parentId, name);
  if (existing) {
    const res = await client.uploads.uploadFileVersion(existing.id, { attributes: { name }, file });
    return res?.entries?.[0]?.id ?? existing.id;
  }
  const res = await client.uploads.uploadFile({ attributes: { name, parent: { id: parentId } }, file });
  return res.entries[0].id;
}

/** Download a file body and decode it to a UTF-8 string (handles stream or buffer). */
export async function downloadText(client, fileId) {
  const body = await client.downloads.downloadFile(fileId);
  if (body == null) return '';
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8');
  if (typeof body === 'string') return body;
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
