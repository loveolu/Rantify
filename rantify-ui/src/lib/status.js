// Shared status vocabulary for the build pipeline.
export const STATUSES = [
  'inbox',
  'ready-for-build',
  'building',
  'building-approved',
  'completed',
  'failed',
];

export const STATUS_LABEL = {
  inbox: 'Inbox',
  'ready-for-build': 'Ready',
  building: 'Building',
  'building-approved': 'Approved',
  completed: 'Shipped',
  failed: 'Failed',
};

export const STATUS_COLOR = {
  inbox: 'var(--st-inbox)',
  'ready-for-build': 'var(--st-ready)',
  building: 'var(--st-building)',
  'building-approved': 'var(--st-approved)',
  completed: 'var(--st-done)',
  failed: 'var(--st-failed)',
};
