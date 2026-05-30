import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardConcurrent } from './in-flight.mjs';

test('concurrent calls with the same key run the work once', async () => {
  let runs = 0;
  let release;
  const guarded = guardConcurrent(() => { runs++; return new Promise((r) => { release = r; }); });
  const a = guarded('file_1');
  const b = guarded('file_1'); // arrives while the first is still in flight
  release();
  await Promise.all([a, b]);
  assert.equal(runs, 1);
});

test('different keys run independently', async () => {
  let runs = 0;
  const guarded = guardConcurrent(() => { runs++; });
  await Promise.all([guarded('file_1'), guarded('file_2')]);
  assert.equal(runs, 2);
});

test('a key can run again after its previous run settles', async () => {
  let runs = 0;
  const guarded = guardConcurrent(() => { runs++; });
  await guarded('file_1');
  await guarded('file_1');
  assert.equal(runs, 2);
});

test('the in-flight slot is freed even when the work throws', async () => {
  let runs = 0;
  const guarded = guardConcurrent(() => { runs++; throw new Error('boom'); });
  await guarded('file_1').catch(() => {});
  await guarded('file_1').catch(() => {});
  assert.equal(runs, 2);
});

test('passes the key through to the wrapped function', async () => {
  const seen = [];
  const guarded = guardConcurrent((id) => { seen.push(id); });
  await guarded('file_xyz');
  assert.deepEqual(seen, ['file_xyz']);
});
