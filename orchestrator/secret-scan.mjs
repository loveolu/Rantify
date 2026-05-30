/**
 * secret-scan.mjs — pre-push secret detection (SPEC.md §12.5).
 *
 * Greps a diff (or any text) for the common secret patterns the spec enumerates. A single
 * match blocks the push and fails the phase. Pure: returns the findings; the caller decides
 * to abort. Patterns are literal substrings per the spec, not full credential regexes.
 */

/** @type {string[]} — SPEC.md §12.5 */
const PATTERNS = ['ghp_', 'sk-', 'xoxb-', 'AKIA', '-----BEGIN'];

/**
 * @param {string} text
 * @returns {{pattern: string, line: number}[]}
 */
export function scanDiff(text) {
  const findings = [];
  const lines = String(text ?? '').split('\n');
  lines.forEach((content, i) => {
    for (const pattern of PATTERNS) {
      if (content.includes(pattern)) findings.push({ pattern, line: i + 1 });
    }
  });
  return findings;
}
