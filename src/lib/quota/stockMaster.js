// Master AFPO stock list, grouped by statement section.
// Extracted from the 2026 Audacious "Current Quota Holdings" file —
// the full universe of lines AFPO prints, so manual skippers pick
// from the same labels the parsers and the FAO stock map use.
// Order matches the printed statement.

export const STOCK_SECTIONS = [
  {
    section: 'North Sea',
    stocks: [
      'NS Cod', 'NS Haddock', 'NS Whiting', 'NS Saithe', 'NS Dogs', 'NS Hake',
      'NS Herring', 'NS Lemons', 'NS Witches', 'NS Ling (UK)', 'NS Mackerel',
      'NS Megrims', 'NS Monks (UK)', 'NS Monks (NOR)', 'NS Plaice', 'NS Pollack',
      'NS Nephrops', 'NS Dabs/Flounders', 'NS Skates/Rays', 'NS Sole', 'NS Squid',
      'NS Turbot', 'NS Brill', 'NS Tusk (UK)', 'NS Cats', 'Norway Others',
    ],
  },
  {
    section: 'West Coast',
    stocks: [
      'Cod Area VIa', 'Cod Area VIb', 'Haddock Area VIa', 'Haddock Area VIb',
      'WC Whiting', 'WC Saithe', 'WC Hake', 'WC Ling', 'WC Blue Ling', 'WC Megrim',
      'WC Monkfish', 'WC Plaice', 'WC Pollock', 'WC Nephrops', 'WC Argentines',
      'WC Black Scabbardfish', 'WC Catfish', 'WC Greater Forkbeard',
      'WC Greenland Halibut', 'WC Roundnose Grenadiers', 'WC Skates/Rays',
      'WC Tusk', 'WC Shark V-IX',
    ],
  },
  {
    section: 'Area VII',
    stocks: [
      'Cod VIIa', 'Cod VIIb-k', 'Haddock VIIb-k', 'Whiting VIIa', 'Whiting VIIb-k',
      'Saithe VII', 'Megrims VII', 'Monks VII', 'Nephrops VII', 'Plaice VII',
      'Pollock VII', 'Tusk VII',
    ],
  },
  {
    section: 'Area VIII',
    stocks: ['Monks VIII', 'Hake VIII'],
  },
]

const SECTION_OF = {}
for (const g of STOCK_SECTIONS) for (const s of g.stocks) SECTION_OF[s] = g.section

export function sectionOfStock(stock) {
  return SECTION_OF[stock] || ''
}
