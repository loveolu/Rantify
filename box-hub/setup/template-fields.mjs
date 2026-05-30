/**
 * template-fields.mjs — the `devtool_build_card` field set (SPEC.md §5.3). Pure, so the
 * exact schema is asserted in tests and reused by create-template.mjs.
 */

const STATUS_OPTIONS = ['inbox', 'ready-for-build', 'building', 'building-approved', 'completed', 'failed'];

export function templateFields() {
  const str = (key) => ({ type: 'string', key, displayName: key });
  return [
    { type: 'enum', key: 'status', displayName: 'status', options: STATUS_OPTIONS.map((key) => ({ key })) },
    str('theme'),
    { type: 'float', key: 'pain_score', displayName: 'pain_score' },
    str('card_id'),
    str('builder_session_id'),
    str('repo_url'),
    str('pr_url'),
    str('box_task_id'),
  ];
}
