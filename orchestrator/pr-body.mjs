/**
 * pr-body.mjs — render the GitHub PR body (SPEC.md §10.4). Pure.
 * Written to PR_BODY.md and passed to `gh pr create --body-file`.
 */

/**
 * @param {{boxFileUrl:string, theme:string, painScore:number, aiNotes:string,
 *          testOutput:string}} a
 * @returns {string}
 */
export function buildPrBody({ boxFileUrl, theme, painScore, aiNotes, testOutput }) {
  return `## AI-Generated Scaffold
**Build Card:** ${boxFileUrl}
**Theme:** ${theme}   **Signal score:** ${painScore}

### What was generated
${aiNotes || '_(no AI_NOTES.md produced)_'}

### Test results
\`\`\`
${testOutput || '(no output captured)'}
\`\`\`

### Reviewer checklist
- [ ] CLI flags match spec
- [ ] No hardcoded secrets
- [ ] README is accurate
- [ ] Tests cover the acceptance criteria in spec.md
`;
}
