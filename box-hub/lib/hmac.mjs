/**
 * hmac.mjs — pure, dual-key Box webhook signature verification (SPEC.md §7.2, §8.2).
 *
 * Box signs (raw body + delivery timestamp) with HMAC-SHA256, base64, in
 * box-signature-primary / box-signature-secondary headers (two keys for rotation).
 * Valid if EITHER configured key matches (timing-safe), AND the delivery timestamp is
 * within an allowed skew (replay protection). Never throws on bad input — returns false.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_SKEW_MS = 5 * 60 * 1000; // 5 minutes

const expected = (rawBody, ts, key) =>
  createHmac('sha256', key).update(rawBody).update(ts ?? '').digest('base64');

function safeEqual(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * @param {{rawBody:string, headers:Record<string,string|undefined>,
 *          primaryKey:string, secondaryKey:string, now?:Date}} a
 * @returns {boolean}
 */
export function verifyBoxSignature({ rawBody, headers, primaryKey, secondaryKey, now = new Date() }) {
  const ts = headers['box-delivery-timestamp'];
  if (!ts) return false;

  const delivered = Date.parse(ts);
  if (Number.isNaN(delivered) || Math.abs(now.getTime() - delivered) > MAX_SKEW_MS) return false;

  const checks = [
    [headers['box-signature-primary'], primaryKey],
    [headers['box-signature-secondary'], secondaryKey],
  ];
  for (const [sig, key] of checks) {
    if (sig && key && safeEqual(sig, expected(rawBody, ts, key))) return true;
  }
  return false;
}
