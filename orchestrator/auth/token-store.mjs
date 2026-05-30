/**
 * token-store.mjs — GitHub OAuth token store, persisted as a JSON file.
 *
 * Maps email → { token, login }. Reads on construction, writes on every mutation.
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
    /** @param {string} email @returns {{token:string, login:string}|undefined} */
    get(email) { return data[email]; },

    /** @param {string} email @param {{token:string, login:string}} entry */
    set(email, entry) { data[email] = entry; save(); },

    /** @param {string} email @returns {boolean} */
    has(email) { return email in data; },

    get filePath() { return filePath; },

    /** Test seam: reset in-memory state. */
    _reset() { data = {}; },
  };
}
