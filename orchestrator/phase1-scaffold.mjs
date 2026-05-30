/**
 * phase1-scaffold.mjs — Phase 1: scaffold a repo from a ready-for-build card (SPEC.md §8.3).
 *
 * Sequence: building → fetch spec → init/create repo (commit spec.md + card-id package.json)
 * → Claude Code scaffold → install/build/test → secret scan → push → PR → REVIEW_NOTES +
 * Box task → record builder.* fields. Any failure routes to status=failed with a /Logs/
 * entry, no auto-retry (SPEC §11). Build/Claude/secret failures abort before the PR; a
 * failing test does NOT abort (human reviews the PR — SPEC §11 "never auto-complete").
 */

import fs from 'node:fs';
import path from 'node:path';
import { slugFromTitle } from './slug.mjs';
import { scanDiff } from './secret-scan.mjs';
import { buildPrBody } from './pr-body.mjs';
import { buildReviewNotes } from './review-notes.mjs';
import { PhaseError, withRetry, fail } from './phase-common.mjs';

const titleFromSpec = (spec) =>
  (spec.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? 'devtool').trim();

export async function phase1Scaffold(fileId, meta, deps) {
  const { box, gh, cc, build, workRoot, scaffoldPromptPath, now = () => new Date() } = deps;
  const cardId = meta.card_id;
  const repoDir = path.join(workRoot, cardId, 'repo');
  let repoUrl = meta.repo_url;

  try {
    await box.setMetadata(fileId, { status: 'building' });

    const spec = await box.getSpecMarkdown(fileId);
    const title = titleFromSpec(spec);
    const slug = slugFromTitle(title);

    if (repoUrl == null) {
      fs.mkdirSync(path.join(repoDir, 'specs', 'devtool-loop'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, 'specs', 'devtool-loop', 'spec.md'), spec);
      fs.writeFileSync(path.join(repoDir, 'package.json'),
        JSON.stringify({ name: slug, version: '0.0.0', private: true, devtool_build_card_id: cardId }, null, 2));
      await gh.init(repoDir);
      await gh.commitAll(repoDir, 'chore: add Build Card spec');
      repoUrl = await gh.createRepo(slug);
      await gh.addRemoteAndPush(repoDir, repoUrl);
      await box.setMetadata(fileId, { repo_url: repoUrl });
    }

    const sessionId = `${cardId}-phase1`;
    const ccResult = await cc.runSession(repoDir, { sessionId, promptFile: scaffoldPromptPath });
    await box.setMetadata(fileId, { builder_session_id: sessionId });
    if (ccResult.code !== 0) throw new PhaseError(`Claude Code exited ${ccResult.code}: ${ccResult.stderr}`);

    await build.install(repoDir);
    const buildRes = await build.build(repoDir);
    if (!buildRes.pass) throw new PhaseError(`build failed:\n${buildRes.output}`);
    const testRes = await build.test(repoDir); // a failing test still goes to human review

    // §12.5: scan the STAGED diff so newly-created (untracked) scaffold files are included.
    const findings = scanDiff(await gh.stagedDiff(repoDir));
    if (findings.length > 0) {
      throw new PhaseError(`secret(s) detected in diff: ${findings.map((f) => `${f.pattern}@${f.line}`).join(', ')}`);
    }

    await gh.commitAll(repoDir, 'feat: AI scaffold (phase 1)');
    const aiNotes = readIfExists(path.join(repoDir, 'AI_NOTES.md'));
    fs.writeFileSync(path.join(repoDir, 'PR_BODY.md'),
      buildPrBody({ boxFileUrl: `box://file/${fileId}`, theme: meta.theme, painScore: meta.pain_score, aiNotes, testOutput: testRes.output }));
    await withRetry(() => gh.push(repoDir));
    const prUrl = await gh.createPr(repoDir, { title: `AI Scaffold: ${title}`, bodyFile: 'PR_BODY.md' });
    await box.setMetadata(fileId, { pr_url: prUrl });

    await box.uploadArtifact({ cardId, name: 'REVIEW_NOTES.md', area: 'card',
      content: buildReviewNotes({ title, buildPass: buildRes.pass, testsPass: testRes.pass, aiNotes }) });
    const { taskId } = await box.createTask({ fileId,
      message: `Review AI scaffold for: ${title}\nRepo: ${repoUrl}\nPR: ${prUrl}` });

    await box.setMetadata(fileId, {
      box_task_id: taskId, phase: 'scaffold', last_run_at: now().toISOString(),
      tests_pass: testRes.pass, build_pass: buildRes.pass,
    });
    return { ok: true, prUrl };
  } catch (err) {
    await fail(box, fileId, cardId, 'phase1', err, now);
    return { ok: false, error: String(err.message ?? err) };
  }
}

function readIfExists(p) { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; }
