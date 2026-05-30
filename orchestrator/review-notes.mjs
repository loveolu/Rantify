/**
 * review-notes.mjs — render REVIEW_NOTES.md written to Box after Phase 1 (SPEC.md §8.3),
 * and re-used to carry reviewer context into Phase 2. Pure.
 */

const mark = (ok) => (ok ? 'pass ✅' : 'FAIL ❌');

/**
 * @param {{title:string, buildPass:boolean, testsPass:boolean, aiNotes?:string,
 *          sessionFallback?:boolean}} a
 * @returns {string}
 */
export function buildReviewNotes({ title, buildPass, testsPass, aiNotes, sessionFallback }) {
  const lines = [
    `# Review notes — ${title}`,
    '',
    `- Build: ${mark(buildPass)}`,
    `- Tests: ${mark(testsPass)}`,
  ];
  if (sessionFallback) {
    lines.push(
      '',
      '> ⚠️ Claude Code session expired; started a fresh session and re-injected ' +
        'spec.md / PLAN.md / AI_NOTES.md as context (SPEC §9.1 fallback).',
    );
  }
  if (aiNotes) {
    lines.push('', '## AI notes', aiNotes);
  }
  return lines.join('\n') + '\n';
}
