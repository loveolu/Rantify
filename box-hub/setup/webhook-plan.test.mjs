import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsWebhook, isPublicWebhookAddress } from './webhook-plan.mjs';

const target = { id: 'folder_5', type: 'folder' };
const address = 'https://orch.example/webhooks/box';
const triggers = ['METADATA_INSTANCE.UPDATED', 'ITEM.MOVED'];

test('returns true when no matching webhook exists', () => {
  assert.equal(needsWebhook([], { target, address, triggers }), true);
});

test('returns false when an equivalent webhook already exists (idempotent)', () => {
  const existing = [{ target, address, triggers: ['ITEM.MOVED', 'METADATA_INSTANCE.UPDATED'] }];
  assert.equal(needsWebhook(existing, { target, address, triggers }), false);
});

test('returns true when an existing webhook targets a different folder', () => {
  const existing = [{ target: { id: 'other', type: 'folder' }, address, triggers }];
  assert.equal(needsWebhook(existing, { target, address, triggers }), true);
});

test('returns true when the address differs', () => {
  const existing = [{ target, address: 'https://old/webhooks/box', triggers }];
  assert.equal(needsWebhook(existing, { target, address, triggers }), true);
});

test('isPublicWebhookAddress accepts public HTTPS, rejects localhost/http/private', () => {
  assert.equal(isPublicWebhookAddress('https://orch.example.com/webhooks/box'), true);
  assert.equal(isPublicWebhookAddress('http://orch.example.com/webhooks/box'), false); // not HTTPS
  assert.equal(isPublicWebhookAddress('http://localhost:8080/webhooks/box'), false);
  assert.equal(isPublicWebhookAddress('https://localhost:8080/webhooks/box'), false);
  assert.equal(isPublicWebhookAddress('https://127.0.0.1/webhooks/box'), false);
  assert.equal(isPublicWebhookAddress('https://my-box.local/webhooks/box'), false);
  assert.equal(isPublicWebhookAddress('not a url'), false);
});
