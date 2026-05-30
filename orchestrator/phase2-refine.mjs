/**
 * phase2-refine.mjs — Phase 2: refine on approval, then complete (SPEC.md §8.4).
 *
 * Resume the SAME Claude Code session ({cardId}-phase1) so context is retained (§9.1). If
 * the resume fails (e.g. session expired), fall back to one fresh attempt with the context
 * files already present in the repo, noting the fallback in REVIEW_NOTES.md (§9.1). Then
 * build+test, secret scan, push, mark completed, write a build summary to /Logs/, move the
 * card folder to Completed/. Build/test/secret failures route to status=failed (§11) — a
 * failing test never auto-completes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { scanDiff } from './secret-scan.mjs';
import { buildReviewNotes } from './review-notes.mjs';
import { fail } from './phase1-scaffold.mjs';

class PhaseError extends Error {}
const withRetry = async (fn) => { try { return await fn(); } catch { return await fn(); } };

export async function phase2Refine(fileId, meta, deps) {
  const { box, gh, cc, build, workRoot, refinePromptPath, now = () => new Date() } = deps;
  const cardId = meta.card_id;
  const repoDir = path.join(workRoot, cardId, 'repo');
  const sessionId = meta.builder_session_id ?? `${cardId}-phase1`;

  try {
    fs.mkdirSync(repoDir, { recursive: true });

    // §8.4: carry reviewer feedback into the repo before refining.
    const reviewerNotes = await readArtifact(box, cardId, 'REVIEW_NOTES.md');
    fs.writeFileSync(path.join(repoDir, 'REVIEW_NOTES.md'), reviewerNotes);

    // §9.1: resume same session; one fallback attempt on failure.
    let res = await cc.runSession(repoDir, { sessionId, promptFile: refinePromptPath });
    let sessionFallback = false;
    if (res.code !== 0) {
      sessionFallback = true;
      fs.appendFileSync(path.join(repoDir, 'REVIEW_NOTES.md'),
        '\n\n> Session resume failed; retrying with re-injected context (SPEC §9.1).\n');
      res = await cc.runSession(repoDir, { sessionId, promptFile: refinePromptPath });
      if (res.code !== 0) throw new PhaseError(`Claude Code refine failed twice: ${res.stderr ?? ''}`);
    }

    const buildRes = await build.build(repoDir);
    if (!buildRes.pass) throw new PhaseError(`build failed:\n${buildRes.output}`);
    const testRes = await build.test(repoDir);
    if (!testRes.pass) throw new PhaseError(`tests failed — never auto-complete (§11):\n${testRes.output}`);

    const findings = scanDiff(await gh.diff(repoDir));
    if (findings.length > 0) throw new PhaseError(`secret(s) detected: ${findings.map((f) => f.pattern).join(', ')}`);

    await gh.commitAll(repoDir, 'feat: AI refine (phase 2)');
    await withRetry(() => gh.push(repoDir));

    await box.setMetadata(fileId, { status: 'completed', last_run_at: now().toISOString(), tests_pass: true, build_pass: true });
    await box.uploadArtifact({ cardId, area: 'logs',
      name: `${cardId}-build-${now().toISOString().replace(/[:.]/g, '-')}.md`,
      content: buildReviewNotes({ title: cardId, buildPass: true, testsPass: true, sessionFallback }) });
    await box.moveCard(cardId, 'completed');
    return { ok: true };
  } catch (err) {
    await fail(box, fileId, cardId, 'phase2', err, now);
    return { ok: false, error: String(err.message ?? err) };
  }
}

async function readArtifact(box, cardId, name) {
  if (typeof box.getArtifact === 'function') {
    try { return await box.getArtifact(cardId, name); } catch { /* fall through */ }
  }
  return `# Review notes\n(See Box card ${cardId}.)\n`;
}
