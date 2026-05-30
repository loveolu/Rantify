import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyBoxSignature } from './hmac.mjs';

const PRIMARY = 'primary-key';
const SECONDARY = 'secondary-key';
const TS = '2026-05-30T12:00:00Z';

const sign = (body, key, ts = TS) =>
  createHmac('sha256', key).update(body).update(ts).digest('base64');

test('accepts a valid primary signature', () => {
  const body = '{"trigger":"x"}';
  const headers = {
    'box-delivery-timestamp': TS,
    'box-signature-primary': sign(body, PRIMARY),
  };
  assert.equal(verifyBoxSignature(body, headers, PRIMARY, SECONDARY), true);
});

test('accepts a valid secondary signature (key rotation)', () => {
  const body = '{"trigger":"x"}';
  const headers = {
    'box-delivery-timestamp': TS,
    'box-signature-secondary': sign(body, SECONDARY),
  };
  assert.equal(verifyBoxSignature(body, headers, PRIMARY, SECONDARY), true);
});

test('rejects a tampered body', () => {
  const headers = {
    'box-delivery-timestamp': TS,
    'box-signature-primary': sign('{"trigger":"x"}', PRIMARY),
  };
  assert.equal(verifyBoxSignature('{"trigger":"TAMPERED"}', headers, PRIMARY, SECONDARY), false);
});

test('rejects when no signature header is present', () => {
  assert.equal(verifyBoxSignature('{}', { 'box-delivery-timestamp': TS }, PRIMARY, SECONDARY), false);
});

test('rejects a signature made with the wrong key', () => {
  const body = '{}';
  const headers = {
    'box-delivery-timestamp': TS,
    'box-signature-primary': sign(body, 'attacker-key'),
  };
  assert.equal(verifyBoxSignature(body, headers, PRIMARY, SECONDARY), false);
});

test('rejects when the secondary key is unset but a secondary sig is sent', () => {
  const body = '{}';
  const headers = {
    'box-delivery-timestamp': TS,
    'box-signature-secondary': sign(body, ''),
  };
  assert.equal(verifyBoxSignature(body, headers, PRIMARY, ''), false);
});
