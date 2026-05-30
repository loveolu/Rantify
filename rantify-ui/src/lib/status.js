// Shared status vocabulary for the build pipeline.
// 'mining' is a UI-only state (a feedback-mining job in flight); it is not a Box status.
export const STATUSES = [
  'mining',
  'inbox',
  'ready-for-build',
  'building',
  'building-approved',
  'completed',
  'failed',
];

export const STATUS_LABEL = {
  mining: 'Mining',
  inbox: 'Inbox',
  'ready-for-build': 'Ready',
  building: 'Building',
  'building-approved': 'Approved',
  completed: 'Shipped',
  failed: 'Failed',
};

export const STATUS_COLOR = {
  mining: 'var(--st-mining)',
  inbox: 'var(--st-inbox)',
  'ready-for-build': 'var(--st-ready)',
  building: 'var(--st-building)',
  'building-approved': 'var(--st-approved)',
  completed: 'var(--st-done)',
  failed: 'var(--st-failed)',
};
