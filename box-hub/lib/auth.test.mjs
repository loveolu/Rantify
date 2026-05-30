import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireBoxEnv, getBoxClient } from './auth.mjs';

const fullEnv = { BOX_CLIENT_ID: 'id', BOX_CLIENT_SECRET: 'secret', BOX_ENTERPRISE_ID: 'ent' };

test('requireBoxEnv returns the creds when all present', () => {
  assert.deepEqual(requireBoxEnv(fullEnv), { clientId: 'id', clientSecret: 'secret', enterpriseId: 'ent' });
});

test('requireBoxEnv throws naming every missing variable', () => {
  assert.throws(() => requireBoxEnv({ BOX_CLIENT_ID: 'id' }), (e) => {
    assert.match(e.message, /BOX_CLIENT_SECRET/);
    assert.match(e.message, /BOX_ENTERPRISE_ID/);
    assert.doesNotMatch(e.message, /BOX_CLIENT_ID/);
    return true;
  });
});

test('getBoxClient memoizes (builds the client once)', async () => {
  let built = 0;
  const makeClient = () => ({ id: ++built });
  const a = await getBoxClient(fullEnv, makeClient);
  const b = await getBoxClient(fullEnv, makeClient);
  assert.equal(a, b);
  assert.equal(built, 1);
});
