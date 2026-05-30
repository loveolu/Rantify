/**
 * box-client-real.mjs — RealBoxClient: the real implementation of the frozen BoxClient
 * contract (contracts/box-client.mjs), composed from the lib/* modules. This is the single
 * class A and C swap the mock for. Constructor deps (client, registry) are injectable so it
 * is unit-tested with a fake SDK.
 */

import { BoxClient } from '../contracts/box-client.mjs';
import { getBoxClient } from './lib/auth.mjs';
import { ROOT, FOLDERS, statusFolder } from './lib/paths.mjs';
import { ensureFolderTree, ensureCardFolder, moveFolder } from './lib/folders.mjs';
import { uploadText, downloadText } from './lib/files.mjs';
import { applyMetadata, getCardMetadata, patchMetadata } from './lib/metadata.mjs';
import { createApprovalTask } from './lib/tasks.mjs';
import { findDuplicate, listCardsByStatus, listCardsWithMetadata as searchCardsWithMetadata } from './lib/search.mjs';
import { createRegistry } from './webhook/registry.mjs';

const STATUS_SUBFOLDERS = ['Inbox', 'Ready-for-Build', 'In-Progress', 'Completed'];

export class RealBoxClient extends BoxClient {
  /** @param {{client?:any, registry?:ReturnType<typeof createRegistry>}} [deps] */
  constructor({ client, registry } = {}) {
    super();
    this._clientArg = client;
    this._clientPromise = null;
    this._registry = registry ?? createRegistry();
    this._treePromise = null;
  }

  async _client() {
    if (!this._clientPromise) this._clientPromise = this._clientArg ?? getBoxClient();
    return this._clientPromise;
  }

  /** Lazily provision + memoize the folder tree (path → id). */
  async _tree() { const c = await this._client(); return (this._treePromise ??= ensureFolderTree(c)); }
  async _rootId() { return (await this._tree())[ROOT]; }

  /** Locate the card's folder under whichever status subfolder it currently lives in. */
  async _cardFolderId(cardId) {
    const c = await this._client();
    const tree = await this._tree();
    for (const sub of STATUS_SUBFOLDERS) {
      const subId = tree[`${ROOT}/${FOLDERS.buildCards}/${sub}`];
      const items = await c.folders.getFolderItems(subId);
      const hit = (items.entries ?? []).find((e) => e.type === 'folder' && e.name === cardId);
      if (hit) return hit.id;
    }
    return null;
  }

  // ---- Idea Miner (Person A) ----

  async findDuplicate(q) { const c = await this._client(); return findDuplicate(c, q, await this._rootId()); }

  async uploadCard({ cardId, specMarkdown, metadata }) {
    const c = await this._client();
    if (metadata.status !== 'inbox') throw new Error('Idea Miner must upload with status="inbox" (SPEC §6.6/§10.1)');
    if (metadata.card_id !== cardId) throw new Error('metadata.card_id must equal cardId');
    const folderId = await ensureCardFolder(c, cardId, 'inbox', await this._tree());
    const fileId = await uploadText(c, { parentId: folderId, name: 'spec.md', content: specMarkdown });
    await applyMetadata(c, fileId, metadata);
    return { fileId, cardId };
  }

  // ---- Orchestrator (Person C) ----

  async getMetadata(fileId) { const c = await this._client(); return getCardMetadata(c, fileId); }
  async setMetadata(fileId, patch) { const c = await this._client(); return patchMetadata(c, fileId, patch); }
  async getSpecMarkdown(fileId) { const c = await this._client(); return downloadText(c, fileId); }

  async uploadArtifact({ cardId, name, content, area = 'card' }) {
    const c = await this._client();
    const tree = await this._tree();
    const parentId = area === 'logs'
      ? tree[`${ROOT}/${FOLDERS.logs}`]
      : (await this._cardFolderId(cardId)) ?? (await ensureCardFolder(c, cardId, 'building', tree));
    const fileId = await uploadText(c, { parentId, name, content });
    return { fileId };
  }

  async getArtifact({ cardId, name, area = 'card' }) {
    const c = await this._client();
    const tree = await this._tree();
    const parentId = area === 'logs' ? tree[`${ROOT}/${FOLDERS.logs}`] : await this._cardFolderId(cardId);
    const items = parentId ? await c.folders.getFolderItems(parentId) : { entries: [] };
    const hit = (items.entries ?? []).find((e) => e.type === 'file' && e.name === name);
    if (!hit) throw new Error(`artifact not found: ${name}`);
    return downloadText(c, hit.id);
  }

  async createTask({ fileId, message, assignee, dueDays }) {
    const c = await this._client();
    return createApprovalTask(c, { fileId, message, assignee, dueDays });
  }

  async moveCard(cardId, status) {
    const c = await this._client();
    const sf = statusFolder(status);
    if (!sf) return;
    const tree = await this._tree();
    const folderId = await this._cardFolderId(cardId);
    if (!folderId) return;
    const destId = tree[`${ROOT}/${FOLDERS.buildCards}/${sf}`];
    if (!destId) return; // destination subfolder not provisioned — leave the card in place
    await moveFolder(c, folderId, destId);
  }

  async listCardsByStatus(status) { const c = await this._client(); return listCardsByStatus(c, status, await this._rootId()); }
  async listCardsWithMetadata() { const c = await this._client(); return searchCardsWithMetadata(c, await this._rootId()); }

  // ---- Webhook (real server dispatches into this registry) ----

  onWebhook(handler) { return this._registry.register(handler); }
  get registry() { return this._registry; }
}
