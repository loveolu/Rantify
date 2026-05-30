/**
 * targets.mjs — parse/describe a GitHub build "target" chosen by a connected user.
 *
 * A target says WHERE the build loop publishes a card's work:
 *   - { kind: 'personal' }                      → create a NEW repo under the user's account
 *   - { kind: 'org', org }                       → create a NEW repo under that organization
 *   - { kind: 'repo', owner, repo }              → use an EXISTING repo: clone, branch, open a PR
 *
 * Wire format (compact, URL-safe so it can ride the OAuth ?target= param):
 *   "personal" | "" | undefined  → personal
 *   "org:acme"                    → org
 *   "repo:acme/flaky-helper"      → repo
 */

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/; // GitHub login/org rules (loose)
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Parse a target string into a normalized object.
 * @param {string|null|undefined} str
 * @returns {{kind:'personal'}|{kind:'org',org:string}|{kind:'repo',owner:string,repo:string}}
 * @throws {Error} on a malformed non-empty value
 */
export function parseTarget(str) {
  const raw = String(str ?? '').trim();
  if (raw === '' || raw.toLowerCase() === 'personal') return { kind: 'personal' };

  const sep = raw.indexOf(':');
  if (sep === -1) throw new Error(`invalid target "${raw}" (expected "org:NAME" or "repo:OWNER/NAME")`);
  const kind = raw.slice(0, sep).toLowerCase();
  const rest = raw.slice(sep + 1).trim();

  if (kind === 'org') {
    if (!OWNER_RE.test(rest)) throw new Error(`invalid org name in target "${raw}"`);
    return { kind: 'org', org: rest };
  }
  if (kind === 'repo') {
    const slash = rest.indexOf('/');
    const owner = slash === -1 ? '' : rest.slice(0, slash).trim();
    const repo = slash === -1 ? '' : rest.slice(slash + 1).trim();
    if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) {
      throw new Error(`invalid repo in target "${raw}" (expected "repo:OWNER/NAME")`);
    }
    return { kind: 'repo', owner, repo };
  }
  throw new Error(`unknown target kind "${kind}" (expected "org" or "repo")`);
}

/** Human-readable one-liner for logs/UI. */
export function describeTarget(target) {
  if (!target || target.kind === 'personal') return 'Personal account (new repo)';
  if (target.kind === 'org') return `Organization: ${target.org} (new repo)`;
  if (target.kind === 'repo') return `Existing repo: ${target.owner}/${target.repo}`;
  return 'Personal account (new repo)';
}

/** Serialize a target object back to wire format (inverse of parseTarget). */
export function serializeTarget(target) {
  if (!target || target.kind === 'personal') return 'personal';
  if (target.kind === 'org') return `org:${target.org}`;
  if (target.kind === 'repo') return `repo:${target.owner}/${target.repo}`;
  return 'personal';
}
