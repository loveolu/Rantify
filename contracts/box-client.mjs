/**
 * box-client.mjs — THE FROZEN CONTRACT
 * ====================================
 *
 * This is the single interface every component talks through. It is the thing that
 * lets three people work in parallel without waiting on each other:
 *
 *   - Person A (Idea Miner)   WRITES cards through this interface.
 *   - Person B (Box Hub)      IMPLEMENTS this interface for real (Box SDK + webhooks).
 *   - Person C (Orchestrator) READS/UPDATES cards through this interface.
 *
 * A and C develop against `box-client-mock.mjs` (filesystem-backed). B swaps in the
 * real implementation later. Because everyone codes to THIS file, the swap is a
 * one-line change in each component's bootstrap.
 *
 * RULE: Do not change a method signature here without telling all three people.
 *       This contract is "v1, frozen". New needs => add a method, never mutate one.
 *
 * Maps to SPEC.md §5 (data model), §7 (Box), §8.2-8.4 (orchestrator calls), §10 (contracts).
 */

/**
 * @typedef {'inbox'|'ready-for-build'|'building'|'building-approved'|'completed'|'failed'} CardStatus
 *   See SPEC.md §4.2 state machine.
 */

/**
 * The Box metadata template `devtool_build_card` (SPEC.md §5.3). Mirrors the critical
 * front-matter fields so search/routing work without parsing the file body.
 * @typedef {Object} CardMetadata
 * @property {CardStatus} status
 * @property {string}     theme               e.g. "testing-ci"
 * @property {number}     pain_score          0.0–1.0, mirrors signal_strength.score
 * @property {string}     card_id             UUID; equals front-matter `id`
 * @property {string|null} builder_session_id set by Orchestrator only
 * @property {string|null} repo_url           set by Orchestrator only
 * @property {string|null} pr_url             set by Orchestrator only
 * @property {string|null} [box_task_id]      set by Orchestrator only
 * @property {string|null} creator_email      set by UI / Idea Miner
 */

/**
 * @typedef {Object} CardWithMetadata
 * @property {string} fileId
 * @property {string} cardId
 * @property {CardMetadata} metadata
 */

/**
 * @typedef {Object} CardRef
 * @property {string} fileId    Box file id of spec.md (NOT the same as card_id).
 * @property {string} cardId    The UUID (front-matter `id`).
 */

/**
 * Webhook payload of interest (SPEC.md §10.2). The Orchestrator must re-fetch the
 * full metadata via getMetadata() — it never trusts this payload as source of truth.
 * @typedef {Object} WebhookEvent
 * @property {'METADATA_INSTANCE.UPDATED'|'ITEM.MOVED'} trigger
 * @property {{id: string, type: 'file'}} source
 * @property {{metadata_instance: {template_key: 'devtool_build_card', data: {status: CardStatus, card_id: string}}}} additional_info
 */

/**
 * Abstract contract. Both the mock and the real Box client extend this.
 * Every method throws until implemented, so a partial implementation fails loudly.
 */
export class BoxClient {
  /* ---- Idea Miner (Person A) uses these ---- */

  /**
   * De-dup check before writing a card (SPEC.md §6.6).
   * @param {{theme: string, withinDays: number}} q
   * @returns {Promise<CardRef[]>} existing non-failed cards matching theme within window
   */
  async findDuplicate(q) { throw new Error('not implemented: findDuplicate'); }

  /**
   * Create /BuildCards/Inbox/{cardId}/spec.md + apply metadata (SPEC.md §6.6).
   * Idea Miner ALWAYS uploads with status='inbox' and NEVER sets builder.* fields.
   * @param {{cardId: string, specMarkdown: string, metadata: CardMetadata}} card
   * @returns {Promise<CardRef>}
   */
  async uploadCard(card) { throw new Error('not implemented: uploadCard'); }

  /* ---- Orchestrator (Person C) uses these ---- */

  /**
   * Re-fetch metadata for a file (SPEC.md §8.2 — never trust the webhook body).
   * @param {string} fileId
   * @returns {Promise<CardMetadata>}
   */
  async getMetadata(fileId) { throw new Error('not implemented: getMetadata'); }

  /**
   * Conditional metadata write. If `patch.status` differs from current, a webhook is
   * emitted (mock) / Box emits one naturally (real). Orchestrator is the SOLE writer of
   * status transitions and builder.* fields (SPEC.md §5.3 sync invariant, §8.4 idempotency).
   * @param {string} fileId
   * @param {Partial<CardMetadata>} patch
   * @returns {Promise<CardMetadata>} the merged metadata
   */
  async setMetadata(fileId, patch) { throw new Error('not implemented: setMetadata'); }

  /**
   * Fetch the spec.md body text for a card (SPEC.md §8.3 "download spec.md").
   * @param {string} fileId
   * @returns {Promise<string>}
   */
  async getSpecMarkdown(fileId) { throw new Error('not implemented: getSpecMarkdown'); }

  /**
   * Write a review/log artifact into the card folder or /Logs/
   * (REVIEW_NOTES.md §8.3, build_summary.md §8.4).
   * @param {{cardId: string, name: string, content: string, area?: 'card'|'logs'}} a
   * @returns {Promise<{fileId: string}>}
   */
  async uploadArtifact(a) { throw new Error('not implemented: uploadArtifact'); }

  /**
   * Read back an artifact previously written with uploadArtifact (SPEC.md §8.4 — Phase 2
   * fetches REVIEW_NOTES.md to carry reviewer feedback into the refine session).
   * Added to the frozen contract as a NEW method (no existing signature changed); Person B
   * must implement it on the real client.
   * @param {{cardId: string, name: string, area?: 'card'|'logs'}} a
   * @returns {Promise<string>} the artifact's text content
   */
  async getArtifact(a) { throw new Error('not implemented: getArtifact'); }

  /**
   * Create the Box approval task on spec.md (SPEC.md §7.3). UI affordance only —
   * the canonical approval signal is the metadata status change.
   * @param {{fileId: string, message: string, assignee?: string, dueDays?: number}} t
   * @returns {Promise<{taskId: string}>}
   */
  async createTask(t) { throw new Error('not implemented: createTask'); }

  /**
   * Move a card's folder to match a status (SPEC.md §5.1 / §8.4 "move to Completed/").
   * @param {string} cardId
   * @param {CardStatus} status
   * @returns {Promise<void>}
   */
  async moveCard(cardId, status) { throw new Error('not implemented: moveCard'); }

  /**
   * Poll helper (SPEC.md §14 Phase 2 — poll every 30s for ready-for-build).
   * @param {CardStatus} status
   * @returns {Promise<CardRef[]>}
   */
   async listCardsByStatus(status) { throw new Error('not implemented: listCardsByStatus'); }

  /**
   * Return every Build Card with its full metadata (for the dashboard).
   * @returns {Promise<CardWithMetadata[]>}
   */
  async listCardsWithMetadata() { throw new Error('not implemented: listCardsWithMetadata'); }

  /* ---- Box Hub (Person B) wires this for the Orchestrator ---- */

  /**
   * Register a webhook handler. Real impl verifies HMAC and routes POST /webhooks/box
   * (SPEC.md §7.2, §8.2); mock invokes the handler in-process on status change.
   * @param {(event: WebhookEvent) => void | Promise<void>} handler
   * @returns {() => void} unsubscribe
   */
  onWebhook(handler) { throw new Error('not implemented: onWebhook'); }
}
