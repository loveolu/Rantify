/**
 * box-client-mock.mjs — filesystem-backed fake Box, shared by Person A and Person C.
 *
 * Implements the frozen `BoxClient` contract so the Idea Miner and the Orchestrator can
 * each run their FULL flow end-to-end before the real Box (Person B) exists.
 *
 * Storage: a local `.box-mock/` directory (gitignored). Each card lives in its own
 * folder keyed by card_id, mirroring SPEC.md §5.1, with spec.md + metadata.json.
 * Status transitions emit the SPEC.md §10.2 webhook payload to any onWebhook handler,
 * so Person C can exercise the webhook path without ngrok or a real Box.
 *
 * Deliberately faithful where it matters:
 *   - fileId is generated DISTINCT from card_id, so code that conflates them breaks here
 *     (it would also break against real Box).
 *   - getMetadata returns a COPY, so callers can't mutate state without setMetadata.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_ROOT = path.join(process.cwd(), '.box-mock');

export class FileSystemBoxClient /* extends BoxClient (duck-typed to avoid import cycle) */ {
  /** @param {{root?: string}} [opts] */
  constructor(opts = {}) {
    this.root = opts.root ?? DEFAULT_ROOT;
    this.cardsDir = path.join(this.root, 'cards');
    this.logsDir = path.join(this.root, 'logs');
    fs.mkdirSync(this.cardsDir, { recursive: true });
    fs.mkdirSync(this.logsDir, { recursive: true });
    this._bus = new EventEmitter();
    this._fileIndex = this._rebuildIndex(); // fileId -> cardId
  }

  _rebuildIndex() {
    const idx = new Map();
    for (const cardId of this._listCardIds()) {
      const meta = this._readMeta(cardId);
      if (meta?._fileId) idx.set(meta._fileId, cardId);
    }
    return idx;
  }

  _listCardIds() {
    if (!fs.existsSync(this.cardsDir)) return [];
    return fs.readdirSync(this.cardsDir).filter((d) =>
      fs.statSync(path.join(this.cardsDir, d)).isDirectory());
  }

  _cardPath(cardId, file) { return path.join(this.cardsDir, cardId, file); }
  _readMeta(cardId) {
    const p = this._cardPath(cardId, 'metadata.json');
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  }
  _writeMeta(cardId, meta) {
    fs.writeFileSync(this._cardPath(cardId, 'metadata.json'), JSON.stringify(meta, null, 2));
  }
  _cardIdForFile(fileId) {
    const cardId = this._fileIndex.get(fileId);
    if (!cardId) throw new Error(`unknown fileId: ${fileId}`);
    return cardId;
  }
  /** strip internal fields (_fileId) before returning metadata to callers */
  _publicMeta(meta) { const { _fileId, ...pub } = meta; return pub; }

  // ---- Idea Miner (Person A) ----

  async findDuplicate({ theme, withinDays }) {
    const cutoff = Date.now() - withinDays * 86_400_000;
    const out = [];
    for (const cardId of this._listCardIds()) {
      const meta = this._readMeta(cardId);
      if (!meta || meta.status === 'failed' || meta.theme !== theme) continue;
      const stat = fs.statSync(this._cardPath(cardId, 'metadata.json'));
      if (stat.mtimeMs >= cutoff) out.push({ fileId: meta._fileId, cardId });
    }
    return out;
  }

  async uploadCard({ cardId, specMarkdown, metadata }) {
    if (metadata.status !== 'inbox')
      throw new Error('Idea Miner must upload with status="inbox" (SPEC.md §6.6/§10.1)');
    if (metadata.card_id !== cardId)
      throw new Error('metadata.card_id must equal cardId');
    fs.mkdirSync(path.join(this.cardsDir, cardId), { recursive: true });
    fs.writeFileSync(this._cardPath(cardId, 'spec.md'), specMarkdown);
    const fileId = `file_${randomUUID()}`;
    this._writeMeta(cardId, { ...metadata, _fileId: fileId });
    this._fileIndex.set(fileId, cardId);
    return { fileId, cardId };
  }

  // ---- Orchestrator (Person C) ----

  async getMetadata(fileId) {
    const cardId = this._cardIdForFile(fileId);
    return this._publicMeta(this._readMeta(cardId));
  }

  async setMetadata(fileId, patch) {
    const cardId = this._cardIdForFile(fileId);
    const prev = this._readMeta(cardId);
    const next = { ...prev, ...patch, _fileId: prev._fileId };
    this._writeMeta(cardId, next);
    if (patch.status && patch.status !== prev.status) {
      // emit the SPEC.md §10.2 webhook payload
      queueMicrotask(() => this._bus.emit('webhook', {
        trigger: 'METADATA_INSTANCE.UPDATED',
        source: { id: fileId, type: 'file' },
        additional_info: {
          metadata_instance: {
            template_key: 'devtool_build_card',
            data: { status: next.status, card_id: cardId },
          },
        },
      }));
    }
    return this._publicMeta(next);
  }

  async getSpecMarkdown(fileId) {
    const cardId = this._cardIdForFile(fileId);
    return fs.readFileSync(this._cardPath(cardId, 'spec.md'), 'utf8');
  }

  async uploadArtifact({ cardId, name, content, area = 'card' }) {
    const dir = area === 'logs' ? this.logsDir : path.join(this.cardsDir, cardId);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, name);
    fs.writeFileSync(dest, content);
    return { fileId: `file_${randomUUID()}` };
  }

  async getArtifact({ cardId, name, area = 'card' }) {
    const dir = area === 'logs' ? this.logsDir : path.join(this.cardsDir, cardId);
    const src = path.join(dir, name);
    if (!fs.existsSync(src)) throw new Error(`artifact not found: ${name}`);
    return fs.readFileSync(src, 'utf8');
  }

  async createTask({ fileId, message, assignee = 'reviewers', dueDays = 3 }) {
    const cardId = this._cardIdForFile(fileId);
    const taskId = `task_${randomUUID()}`;
    fs.writeFileSync(this._cardPath(cardId, 'task.json'),
      JSON.stringify({ taskId, message, assignee, dueDays, createdAt: new Date().toISOString() }, null, 2));
    return { taskId };
  }

  async moveCard(cardId, status) {
    // Mock keeps a flat layout; status lives in metadata. Recorded for fidelity/debugging.
    const meta = this._readMeta(cardId);
    if (!meta) throw new Error(`unknown cardId: ${cardId}`);
    meta._folder = status;
    this._writeMeta(cardId, meta);
  }

  async listCardsByStatus(status) {
    const out = [];
    for (const cardId of this._listCardIds()) {
      const meta = this._readMeta(cardId);
      if (meta?.status === status) out.push({ fileId: meta._fileId, cardId });
    }
    return out;
  }

  async listCardsWithMetadata() {
    const out = [];
    for (const cardId of this._listCardIds()) {
      const meta = this._readMeta(cardId);
      if (meta) out.push({ fileId: meta._fileId, cardId, metadata: this._publicMeta(meta) });
    }
    return out;
  }

  // ---- Webhook (Person B wires real; mock fires in-process) ----

  onWebhook(handler) {
    this._bus.on('webhook', handler);
    return () => this._bus.off('webhook', handler);
  }
}
