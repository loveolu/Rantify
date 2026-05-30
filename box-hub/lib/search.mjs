/**
 * search.mjs — metadata-driven card discovery (SPEC.md §6.6 de-dup, §14 Phase 2 polling).
 * Uses Box metadata search, then filters client-side for exact status/window semantics
 * (Box search indexing can lag — see Box Content Hub design Open Question §10.2).
 */

import { ROOT } from './paths.mjs';

const SCOPE = 'enterprise';
const TEMPLATE = 'devtool_build_card';

// Box's `searchForContent` does NOT include metadata in the entry by default — and once
// `fields` is set, standard fields stop being returned too. So explicitly request the
// metadata template plus the standard fields callers read (id, modified_at, name).
const FIELDS = ['id', 'name', 'modified_at', `metadata.${SCOPE}.${TEMPLATE}`];

/**
 * Extract the user-defined template fields from a Box file entry.
 * Real Box wraps the payload at `metadata.extraData[scope][template].extraData` and
 * mixes in $-prefixed system fields ($id, $type, $parent, $scope, $template, $version,
 * $typeVersion, $canEdit). Strip those so callers see only their template fields.
 * Returns null when the file has no template instance.
 */
function instanceOf(entry) {
  const raw = entry?.metadata?.extraData?.[SCOPE]?.[TEMPLATE]?.extraData;
  if (!raw || typeof raw !== 'object') return null;
  const fields = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!k.startsWith('$')) fields[k] = v;
  }
  return Object.keys(fields).length ? fields : null;
}

const toRef = (entry) => ({ fileId: entry.id, cardId: instanceOf(entry).card_id });

async function searchByTemplate(client, filters, rootFolderId = '0') {
  const res = await client.search.searchForContent({
    ancestorFolderIds: [rootFolderId],
    mdfilters: [{ scope: SCOPE, templateKey: TEMPLATE, filters }],
    fields: FIELDS,
  });
  return (res.entries ?? []).filter((e) => instanceOf(e));
}

/** Non-failed cards of a theme updated within the window (SPEC §6.6). */
export async function findDuplicate(client, { theme, withinDays }, rootFolderId) {
  const cutoff = Date.now() - withinDays * 86400000;
  const entries = await searchByTemplate(client, { theme }, rootFolderId);
  return entries
    .filter((e) => {
      const inst = instanceOf(e);
      const modified = Date.parse(e.modified_at ?? e.modifiedAt ?? 0);
      return inst.theme === theme && inst.status !== 'failed' && modified >= cutoff;
    })
    .map(toRef);
}

/** Cards currently in a given status (SPEC §14 poller). */
export async function listCardsByStatus(client, status, rootFolderId) {
  const entries = await searchByTemplate(client, { status }, rootFolderId);
  return entries.filter((e) => instanceOf(e).status === status).map(toRef);
}

/** Every Build Card with full metadata (dashboard API). */
export async function listCardsWithMetadata(client, rootFolderId) {
  const res = await client.search.searchForContent({
    ancestorFolderIds: [rootFolderId],
    mdfilters: [{ scope: SCOPE, templateKey: TEMPLATE, filters: [] }],
    fields: FIELDS,
  });
  return (res.entries ?? [])
    .filter((e) => instanceOf(e))
    .map((e) => ({ fileId: e.id, cardId: instanceOf(e).card_id, metadata: instanceOf(e) }));
}

export const ROOT_FOLDER_NAME = ROOT;
