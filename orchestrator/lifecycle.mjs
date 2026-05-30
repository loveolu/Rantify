/**
 * lifecycle.mjs — the shared core both triggers feed (SPEC.md §8.2, §8.5).
 *
 * handleCard re-fetches metadata (never trusts the webhook/poll payload), then routes by
 * the AUTHORITATIVE status. The routing itself is the idempotency guard: Phase 1 runs only
 * while status is exactly `ready-for-build`, Phase 2 only while `building-approved`. A
 * duplicate delivery arriving after the status has already advanced (e.g. to `building`)
 * falls through to a no-op, so cards are never double-scaffolded or double-billed.
 */

/**
 * @param {string} fileId
 * @param {{box: {getMetadata: (id:string)=>Promise<any>},
 *          phase1: (fileId:string, meta:any)=>Promise<void>,
 *          phase2: (fileId:string, meta:any)=>Promise<void>}} deps
 * @returns {Promise<{action: 'phase1'|'phase2'|'noop', status: string}>}
 */
export async function handleCard(fileId, { box, phase1, phase2 }) {
  const meta = await box.getMetadata(fileId); // §8.2 — authoritative, not the payload

  switch (meta.status) {
    case 'ready-for-build':
      await phase1(fileId, meta);
      return { action: 'phase1', status: meta.status };
    case 'building-approved':
      await phase2(fileId, meta);
      return { action: 'phase2', status: meta.status };
    default:
      return { action: 'noop', status: meta.status };
  }
}
