/**
 * hmac.mjs — Box webhook signature verification (SPEC.md §7.2, §8.2).
 *
 * Box signs each webhook with HMAC-SHA256 over (raw body + delivery timestamp), base64,
 * delivered in `box-signature-primary` / `box-signature-secondary` headers (two keys so
 * keys can be rotated without downtime). We accept if EITHER configured key validates,
 * using a timing-safe comparison. Mismatch → caller returns 401.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

function expected(rawBody, timestamp, key) {
  return createHmac('sha256', key).update(rawBody).update(timestamp ?? '').digest('base64');
}

function safeEqual(a, b) {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * @param {string} rawBody  exact bytes received (do not re-serialize parsed JSON)
 * @param {Record<string,string|undefined>} headers  lower-cased header map
 * @param {string} primaryKey
 * @param {string} secondaryKey
 * @returns {boolean}
 */
export function verifyBoxSignature(rawBody, headers, primaryKey, secondaryKey) {
  const ts = headers['box-delivery-timestamp'];
  const checks = [
    [headers['box-signature-primary'], primaryKey],
    [headers['box-signature-secondary'], secondaryKey],
  ];
  for (const [sig, key] of checks) {
    if (!sig || !key) continue;
    if (safeEqual(sig, expected(rawBody, ts, key))) return true;
  }
  return false;
}
