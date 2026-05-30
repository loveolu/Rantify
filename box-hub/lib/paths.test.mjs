import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT, FOLDERS, statusFolder, FOLDER_TREE } from './paths.mjs';

test('root is DevTool-Loop (SPEC §5.1)', () => {
  assert.equal(ROOT, 'DevTool-Loop');
});

test('each status maps to its BuildCards subfolder', () => {
  assert.equal(statusFolder('inbox'), 'Inbox');
  assert.equal(statusFolder('ready-for-build'), 'Ready-for-Build');
  assert.equal(statusFolder('building'), 'In-Progress');
  assert.equal(statusFolder('building-approved'), 'In-Progress');
  assert.equal(statusFolder('completed'), 'Completed');
});

test('failed has no dedicated folder (terminal in place)', () => {
  assert.equal(statusFolder('failed'), null);
});

test('the folder tree lists the §5.1 layout', () => {
  const names = FOLDER_TREE.map((n) => n.path);
  assert.ok(names.includes('DevTool-Loop'));
  assert.ok(names.includes('DevTool-Loop/BuildCards'));
  assert.ok(names.includes('DevTool-Loop/BuildCards/Inbox'));
  assert.ok(names.includes('DevTool-Loop/BuildCards/Ready-for-Build'));
  assert.ok(names.includes('DevTool-Loop/BuildCards/In-Progress'));
  assert.ok(names.includes('DevTool-Loop/BuildCards/Completed'));
  assert.ok(names.includes('DevTool-Loop/Logs'));
});

test('FOLDERS exposes BuildCards and Logs names', () => {
  assert.equal(FOLDERS.buildCards, 'BuildCards');
  assert.equal(FOLDERS.logs, 'Logs');
});
