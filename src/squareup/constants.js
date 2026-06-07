// App light theme (matches index.css). ink doubles as dark-on-light text
// and the dark side of accent gradients, so navy keeps it on brand.
export const C = {
  bg: '#ffffff',
  bgDeep: '#F2F2F2',
  panel: '#FAFAFA',
  panel2: '#ffffff',
  line: '#d0d7de',
  ink: '#1F3864',
  dim: '#6b7280',
  brass: '#a8780f',
  brassDk: '#7c5806',
  sea: '#0f766e',
  red: '#C00000',
  green: '#15803d',
  amber: '#b45309',
};

export const SHARE_OPTIONS = [
  { key: 'full', short: 'Full', display: 'Full share' },
  { key: '7_8', short: '7/8', display: '⅞ (7/8)' },
  { key: '6_8', short: '6/8', display: '¾ (6/8)' },
  { key: '5_8', short: '5/8', display: '⅝ (5/8)' },
  { key: '4_8', short: '4/8', display: '½ (4/8)' },
  { key: 'custom', short: 'Custom', display: 'Custom…' },
];

export const SHARE_VAL = { full: 1, '7_8': 0.875, '6_8': 0.75, '5_8': 0.625, '4_8': 0.5 };
export const QUOTA_OPTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
