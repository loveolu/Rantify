import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyBoxSignature } from './hmac.mjs';

const PRIMARY = 'primary-key';
const SECONDARY = 'secondary-key';
const NOW = new Date('2026-05-30T12:00:00Z');
const TS = '2026-05-30T11:59:50Z'; // 10s before now

const sign = (body, key, ts = TS) => createHmac('sha256', key).update(body).update(ts).digest('base64');
const headers = (extra) => ({ 'box-delivery-timestamp': TS, ...extra });

test('valid primary signature passes', () => {
  const body = '{"a":1}';
  assert.equal(verifyBoxSignature({ rawBody: body, headers: headers({ 'box-signature-primary': sign(body, PRIMARY) }), primaryKey: PRIMARY, secondaryKey: SECONDARY, now: NOW }), true);
});

test('valid secondary signature passes (key rotation)', () => {
  const body = '{"a":1}';
  assert.equal(verifyBoxSignature({ rawBody: body, headers: headers({ 'box-signature-secondary': sign(body, SECONDARY) }), primaryKey: PRIMARY, secondaryKey: SECONDARY, now: NOW }), true);
});

test('tampered body fails', () => {
  const h = headers({ 'box-signature-primary': sign('{"a":1}', PRIMARY) });
  assert.equal(verifyBoxSignature({ rawBody: '{"a":2}', headers: h, primaryKey: PRIMARY, secondaryKey: SECONDARY, now: NOW }), false);
});

test('missing signature headers fail', () => {
  assert.equal(verifyBoxSignature({ rawBody: '{}', headers: headers({}), primaryKey: PRIMARY, secondaryKey: SECONDARY, now: NOW }), false);
});

test('stale timestamp beyond skew fails (replay protection)', () => {
  const body = '{}';
  const staleTs = '2026-05-30T11:50:00Z'; // 10 min before now
  const h = { 'box-delivery-timestamp': staleTs, 'box-signature-primary': sign(body, PRIMARY, staleTs) };
  assert.equal(verifyBoxSignature({ rawBody: body, headers: h, primaryKey: PRIMARY, secondaryKey: SECONDARY, now: NOW }), false);
});

test('only the set key is checked when secondary is empty', () => {
  const body = '{}';
  const h = headers({ 'box-signature-primary': sign(body, PRIMARY) });
  assert.equal(verifyBoxSignature({ rawBody: body, headers: h, primaryKey: PRIMARY, secondaryKey: '', now: NOW }), true);
});
