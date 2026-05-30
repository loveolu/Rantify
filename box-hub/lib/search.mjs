/**
 * search.mjs — metadata-driven card discovery (SPEC.md §6.6 de-dup, §14 Phase 2 polling).
 * Uses Box metadata search, then filters client-side for exact status/window semantics
 * (Box search indexing can lag — see Box Content Hub design Open Question §10.2).
 */

import { ROOT } from './paths.mjs';

const SCOPE = 'enterprise';
const TEMPLATE = 'devtool_build_card';

const instanceOf = (entry) => entry?.metadata?.[SCOPE]?.[TEMPLATE] ?? null;
const toRef = (entry) => ({ fileId: entry.id, cardId: instanceOf(entry).card_id });

async function searchByTemplate(client, filters, rootFolderId = '0') {
  const res = await client.search.searchForContent({
    ancestorFolderIds: [rootFolderId],
    mdfilters: [{ scope: SCOPE, templateKey: TEMPLATE, filters }],
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

export const ROOT_FOLDER_NAME = ROOT;
