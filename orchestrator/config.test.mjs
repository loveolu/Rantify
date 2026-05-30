import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.mjs';

const fullEnv = {
  GITHUB_TOKEN: 'ghp_xxx',
  GITHUB_ORG: 'acme',
  GITHUB_REPO_VISIBILITY: 'public',
  BOX_WEBHOOK_PRIMARY_KEY: 'primary',
  BOX_WEBHOOK_SECONDARY_KEY: 'secondary',
  ANTHROPIC_API_KEY: 'sk-ant-xxx',
};

test('loads a complete config', () => {
  const cfg = loadConfig(fullEnv);
  assert.equal(cfg.githubToken, 'ghp_xxx');
  assert.equal(cfg.githubOrg, 'acme');
  assert.equal(cfg.githubRepoVisibility, 'public');
  assert.equal(cfg.boxWebhookPrimaryKey, 'primary');
  assert.equal(cfg.boxWebhookSecondaryKey, 'secondary');
  assert.equal(cfg.anthropicApiKey, 'sk-ant-xxx');
  assert.equal(cfg.stubExternals, false);
});

test('defaults GITHUB_REPO_VISIBILITY to private (SPEC §13, Decision #5)', () => {
  const { GITHUB_REPO_VISIBILITY, ...rest } = fullEnv;
  const cfg = loadConfig(rest);
  assert.equal(cfg.githubRepoVisibility, 'private');
});

test('throws listing every missing required var in real mode', () => {
  assert.throws(
    () => loadConfig({ GITHUB_ORG: 'acme' }),
    (err) => {
      assert.match(err.message, /GITHUB_TOKEN/);
      assert.match(err.message, /BOX_WEBHOOK_PRIMARY_KEY/);
      assert.match(err.message, /ANTHROPIC_API_KEY/);
      assert.doesNotMatch(err.message, /GITHUB_ORG/); // present, not listed
      return true;
    },
  );
});

test('ORCH_STUB_EXTERNALS=1 relaxes external creds and sets stubExternals', () => {
  const cfg = loadConfig({ GITHUB_ORG: 'acme', ORCH_STUB_EXTERNALS: '1' });
  assert.equal(cfg.stubExternals, true);
  assert.equal(cfg.githubOrg, 'acme');
});

test('rejects an invalid GITHUB_REPO_VISIBILITY', () => {
  assert.throws(
    () => loadConfig({ ...fullEnv, GITHUB_REPO_VISIBILITY: 'secret' }),
    /GITHUB_REPO_VISIBILITY/,
  );
});

test.describe('ORCH_STUB_EXTERNALS truthy parsing', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes']) {
    test(`"${v}" is true`, () => {
      assert.equal(loadConfig({ GITHUB_ORG: 'a', ORCH_STUB_EXTERNALS: v }).stubExternals, true);
    });
  }
  for (const v of ['0', 'false', '', 'no']) {
    test(`"${v}" is false`, () => {
      assert.equal(loadConfig({ ...fullEnv, ORCH_STUB_EXTERNALS: v }).stubExternals, false);
    });
  }
});
