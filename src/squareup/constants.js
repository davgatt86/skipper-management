// App light theme (matches index.css). These are literal values rather than
// CSS variables because they are also used to draw the Square Up PDF, which
// renders outside the DOM. Square Up always prints on white, so only the
// light-theme palette applies here.
export const C = {
  bg: '#ffffff',
  bgDeep: '#ECEFEE',   // paper
  panel: '#F6F8F7',
  panel2: '#ffffff',
  line: '#D2DAD9',
  ink: '#1749A8',      // hull cobalt
  dim: '#5D7079',      // mute
  brass: '#A97614',
  brassDk: '#7C5610',
  sea: '#1C4D3B',      // deep kelp
  red: '#C2342A',      // rust
  green: '#26654F',    // kelp
  amber: '#A97614',    // brass
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
