import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTokenStore } from './token-store.mjs';

test('returns undefined for missing email', () => {
  const store = createTokenStore({ filePath: '/dev/null/non-existent' });
  assert.equal(store.get('none@x.com'), undefined);
  assert.equal(store.has('none@x.com'), false);
});

test('set and get round-trip', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ts-')), 'tokens.json');
  const store = createTokenStore({ filePath: tmp });
  store.set('alice@x.com', { token: 'ghp_abc', login: 'alice' });
  assert.deepEqual(store.get('alice@x.com'), { token: 'ghp_abc', login: 'alice' });
  assert.equal(store.has('alice@x.com'), true);
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
});

test('persists to disk and reloads', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ts-')), 'tokens.json');
  const store = createTokenStore({ filePath: tmp });
  store.set('bob@x.com', { token: 'ghp_xyz', login: 'bob' });
  const store2 = createTokenStore({ filePath: tmp });
  assert.deepEqual(store2.get('bob@x.com'), { token: 'ghp_xyz', login: 'bob' });
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
});

test('survives missing file on construction', () => {
  const store = createTokenStore({ filePath: '/tmp/__nonexistent_dir__/tokens.json' });
  assert.equal(store.get('x'), undefined);
});

test('overwrites existing entry for same email', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ts-')), 'tokens.json');
  const store = createTokenStore({ filePath: tmp });
  store.set('a@x.com', { token: 't1', login: 'a' });
  store.set('a@x.com', { token: 't2', login: 'a2' });
  assert.equal(store.get('a@x.com').token, 't2');
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
});
