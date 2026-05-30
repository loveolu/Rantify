import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApprovalTask } from './tasks.mjs';

test('creates a review task on the file with message and due date', async () => {
  let captured;
  const client = { tasks: { createTask: async (b) => { captured = b; return { id: 'task_1' }; } } };
  const now = new Date('2026-05-30T12:00:00Z');
  const { taskId } = await createApprovalTask(client, { fileId: 'file_1', message: 'Review X', dueDays: 3, now });
  assert.equal(taskId, 'task_1');
  assert.deepEqual(captured.item, { id: 'file_1', type: 'file' });
  assert.equal(captured.action, 'review');
  assert.equal(captured.message, 'Review X');
  assert.equal(captured.dueAt, new Date('2026-06-02T12:00:00Z').toISOString());
});

test('tolerates a task-assignment failure by returning the created task (UI affordance, §7.3)', async () => {
  const client = { tasks: { createTask: async () => ({ id: 'task_2' }) }, taskAssignments: { createTaskAssignment: async () => { throw new Error('plan lacks assignment'); } } };
  const { taskId } = await createApprovalTask(client, { fileId: 'f', message: 'm', assignee: 'reviewers' });
  assert.equal(taskId, 'task_2');
});
