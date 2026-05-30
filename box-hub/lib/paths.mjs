/**
 * paths.mjs — single source of the Box folder layout + status→folder mapping (SPEC.md §5.1).
 * Pure constants/helpers; no SDK or I/O so provisioning and runtime never duplicate the tree.
 */

export const ROOT = 'DevTool-Loop';
export const FOLDERS = { buildCards: 'BuildCards', logs: 'Logs' };

/** Status → BuildCards subfolder (SPEC §5.1). `failed` stays in place (terminal). */
const STATUS_FOLDER = {
  inbox: 'Inbox',
  'ready-for-build': 'Ready-for-Build',
  building: 'In-Progress',
  'building-approved': 'In-Progress',
  completed: 'Completed',
};

/** @param {string} status @returns {string|null} */
export function statusFolder(status) {
  return STATUS_FOLDER[status] ?? null;
}

/** Ordered so each node's parent appears before it (for create-on-walk). */
export const FOLDER_TREE = [
  { path: 'DevTool-Loop', name: ROOT, parent: null },
  { path: 'DevTool-Loop/BuildCards', name: FOLDERS.buildCards, parent: 'DevTool-Loop' },
  { path: 'DevTool-Loop/BuildCards/Inbox', name: 'Inbox', parent: 'DevTool-Loop/BuildCards' },
  { path: 'DevTool-Loop/BuildCards/Ready-for-Build', name: 'Ready-for-Build', parent: 'DevTool-Loop/BuildCards' },
  { path: 'DevTool-Loop/BuildCards/In-Progress', name: 'In-Progress', parent: 'DevTool-Loop/BuildCards' },
  { path: 'DevTool-Loop/BuildCards/Completed', name: 'Completed', parent: 'DevTool-Loop/BuildCards' },
  { path: 'DevTool-Loop/Logs', name: FOLDERS.logs, parent: 'DevTool-Loop' },
];
