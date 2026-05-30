/**
 * mine-jobs.mjs — in-memory registry of in-flight feedback-mining jobs.
 *
 * Mining (interpret -> scrape -> generate -> upload) takes ~20-40s, so the API kicks it off
 * as a background job and the dashboard shows a "mining" placeholder until the real inbox
 * card lands in Box. This registry holds only transient UI state; nothing here is persisted
 * and Box/the frozen contract are untouched. Finished/errored jobs are pruned after a grace
 * period (by then the dashboard poll has picked up the real card).
 */

import { randomUUID } from 'node:crypto';

// Retain finished jobs long enough that the dashboard can bridge the Box metadata-search
// indexing lag (a just-mined inbox card is shown from the job until /api/cards lists it).
const PRUNE_AFTER_MS = 10 * 60_000;

export function createJobRegistry({ now = () => Date.now() } = {}) {
  /** @type {Map<string, {jobId:string, query:string, subreddit:string|null, creatorEmail:string|null, status:'mining'|'done'|'error', fileId?:string, cardId?:string, error?:string, startedAt:number, finishedAt?:number}>} */
  const jobs = new Map();

  function prune() {
    const t = now();
    for (const [id, j] of jobs) {
      if (j.status !== 'mining' && j.finishedAt && t - j.finishedAt > PRUNE_AFTER_MS) jobs.delete(id);
    }
  }

  return {
    start({ query, subreddit, creatorEmail }) {
      const jobId = randomUUID();
      jobs.set(jobId, {
        jobId, query, subreddit: subreddit ?? null, creatorEmail: creatorEmail ?? null,
        status: 'mining', startedAt: now(),
      });
      return jobId;
    },
    complete(jobId, ref) {
      const j = jobs.get(jobId);
      if (j) Object.assign(j, { status: 'done', fileId: ref?.fileId, cardId: ref?.cardId, finishedAt: now() });
    },
    fail(jobId, error) {
      const j = jobs.get(jobId);
      if (j) Object.assign(j, { status: 'error', error: String(error?.message ?? error), finishedAt: now() });
    },
    list() {
      prune();
      return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
    },
  };
}
