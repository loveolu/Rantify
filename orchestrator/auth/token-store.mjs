/**
 * token-store.mjs — GitHub OAuth token store, persisted as a JSON file.
 *
 * Maps email → { token, login, target? }. `target` (optional) records WHERE the build
 * loop should publish this user's work (personal / org / existing repo) — see targets.mjs.
 * Reads on construction, writes on every mutation.
 * Safe to use across multiple requests (sync I/O for simplicity at this scale).
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {{filePath?: string}} [opts]
 */
export function createTokenStore({ filePath = path.join(process.cwd(), '.github-tokens.json') } = {}) {
  let data = {};

  function load() {
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      data = {};
    }
  }

  function save() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  load();

  return {
    /** @param {string} email @returns {{token:string, login:string, target?:object}|undefined} */
    get(email) { return data[email]; },

    /** @param {string} email @param {{token:string, login:string, target?:object}} entry */
    set(email, entry) { data[email] = entry; save(); },

    /**
     * Update only the build target for an already-connected user (no re-auth).
     * @param {string} email @param {object} target
     * @returns {boolean} false if the email isn't connected
     */
    setTarget(email, target) {
      if (!(email in data)) return false;
      data[email] = { ...data[email], target };
      save();
      return true;
    },

    /** @param {string} email @returns {boolean} */
    has(email) { return email in data; },

    get filePath() { return filePath; },

    /** Test seam: reset in-memory state. */
    _reset() { data = {}; },
  };
}
