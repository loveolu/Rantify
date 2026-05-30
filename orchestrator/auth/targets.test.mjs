import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget, describeTarget, serializeTarget } from './targets.mjs';

test('empty / personal parse to personal', () => {
  assert.deepEqual(parseTarget(''), { kind: 'personal' });
  assert.deepEqual(parseTarget(undefined), { kind: 'personal' });
  assert.deepEqual(parseTarget('personal'), { kind: 'personal' });
  assert.deepEqual(parseTarget('  Personal '), { kind: 'personal' });
});

test('org target', () => {
  assert.deepEqual(parseTarget('org:acme'), { kind: 'org', org: 'acme' });
  assert.deepEqual(parseTarget('org: my-org '), { kind: 'org', org: 'my-org' });
});

test('repo target', () => {
  assert.deepEqual(parseTarget('repo:acme/flaky-helper'), { kind: 'repo', owner: 'acme', repo: 'flaky-helper' });
  assert.deepEqual(parseTarget('repo:Acme/Some.Repo_1'), { kind: 'repo', owner: 'Acme', repo: 'Some.Repo_1' });
});

test('malformed values throw', () => {
  assert.throws(() => parseTarget('acme'), /invalid target/);
  assert.throws(() => parseTarget('org:'), /invalid org/);
  assert.throws(() => parseTarget('repo:acme'), /expected "repo:OWNER\/NAME"/);
  assert.throws(() => parseTarget('repo:/name'), /expected "repo:OWNER\/NAME"/);
  assert.throws(() => parseTarget('what:ever'), /unknown target kind/);
});

test('describe + serialize round-trip', () => {
  for (const s of ['personal', 'org:acme', 'repo:acme/tool']) {
    assert.equal(serializeTarget(parseTarget(s)), s === 'personal' ? 'personal' : s);
  }
  assert.match(describeTarget(parseTarget('repo:acme/tool')), /Existing repo: acme\/tool/);
  assert.match(describeTarget(parseTarget('org:acme')), /Organization: acme/);
  assert.match(describeTarget({ kind: 'personal' }), /Personal account/);
});
