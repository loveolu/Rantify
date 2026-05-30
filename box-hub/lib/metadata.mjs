/**
 * metadata.mjs — apply/read/patch the `devtool_build_card` instance (SPEC.md §5.3, §8.2/§8.4).
 * Uses metadata-map for the null-omission / contract projection rules.
 */

import { toInstanceValues, toContractMetadata, toPatchOps } from './metadata-map.mjs';

const SCOPE = 'enterprise';
const TEMPLATE = 'devtool_build_card';

/** Create the metadata instance on a freshly-uploaded card (Idea Miner path). */
export async function applyMetadata(client, fileId, cardMetadata) {
  await client.fileMetadata.createFileMetadataById(fileId, SCOPE, TEMPLATE, toInstanceValues(cardMetadata));
}

/** Read the instance and project to the contract's CardMetadata (absent fields → null). */
export async function getCardMetadata(client, fileId) {
  const instance = await client.fileMetadata.getFileMetadataById(fileId, SCOPE, TEMPLATE);
  // box-typescript-sdk-gen surfaces custom template values under `extraData`; fall back to
  // the instance itself for fakes / direct shapes.
  const values = instance?.extraData ?? instance ?? {};
  return toContractMetadata(values);
}

/**
 * Conditional patch: read current state to choose add vs replace per field (Box requires
 * `add` for a never-set field), apply, and return the merged contract metadata. The
 * orchestrator is the sole writer of status/builder fields (SPEC §5.3 sync invariant).
 */
export async function patchMetadata(client, fileId, partial) {
  const current = await getCardMetadata(client, fileId);
  const ops = toPatchOps(partial, current);
  if (ops.length > 0) {
    await client.fileMetadata.updateFileMetadataById(fileId, SCOPE, TEMPLATE, ops);
  }
  return { ...current, ...partial };
}
