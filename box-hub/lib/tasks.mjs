/**
 * tasks.mjs — create the Box approval task on spec.md (SPEC.md §7.3).
 * UI affordance only: the canonical approval signal is the metadata status change, so an
 * assignment failure must NOT fail the caller.
 */

/**
 * @param {{fileId:string, message:string, assignee?:string, dueDays?:number, now?:Date}} a
 * @returns {Promise<{taskId:string}>}
 */
export async function createApprovalTask(client, { fileId, message, assignee, dueDays = 3, now = new Date() }) {
  const dueAt = new Date(now.getTime() + dueDays * 86400000).toISOString();
  const task = await client.tasks.createTask({
    item: { id: fileId, type: 'file' },
    action: 'review',
    message,
    dueAt,
  });

  if (assignee && client.taskAssignments?.createTaskAssignment) {
    try {
      await client.taskAssignments.createTaskAssignment({ task: { id: task.id, type: 'task' }, assignTo: { login: assignee } });
    } catch (err) {
      console.warn('[box-hub] task assignment failed (task created unassigned):', err?.message ?? err);
    }
  }
  return { taskId: task.id };
}
