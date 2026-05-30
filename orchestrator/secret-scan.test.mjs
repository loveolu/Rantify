import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanDiff } from './secret-scan.mjs';

test('clean diff yields no findings', () => {
  assert.deepEqual(scanDiff('+const x = 1;\n-const y = 2;\n'), []);
});

test('detects a GitHub personal access token', () => {
  const hits = scanDiff('+const t = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";');
  assert.ok(hits.some((h) => h.pattern === 'ghp_'));
});

test('detects an Anthropic/OpenAI-style sk- key', () => {
  assert.ok(scanDiff('token=sk-ant-api03-xxxxx').some((h) => h.pattern === 'sk-'));
});

test('detects an AWS access key id', () => {
  assert.ok(scanDiff('AWS=AKIAIOSFODNN7EXAMPLE').some((h) => h.pattern === 'AKIA'));
});

test('detects a Slack bot token', () => {
  assert.ok(scanDiff('xoxb-123-456-abc').some((h) => h.pattern === 'xoxb-'));
});

test('detects a PEM private key header', () => {
  assert.ok(scanDiff('-----BEGIN RSA PRIVATE KEY-----').some((h) => h.pattern === '-----BEGIN'));
});

test('reports the line number of each finding', () => {
  const hits = scanDiff('line one\nghp_AAAAAAAAAAAAAAAAAAAA\nline three');
  assert.equal(hits[0].line, 2);
});

test('finds multiple distinct secrets', () => {
  const hits = scanDiff('ghp_AAAAAAAAAAAAAAAAAAAA\nAKIAIOSFODNN7EXAMPLE');
  assert.equal(hits.length, 2);
});
