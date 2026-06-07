// FAO 3-alpha species code + FAO area -> AFPO stock label.
// Area-aware: POK is 'NS Saithe' in 27.4 but 'WC Saithe' in 27.6.
// Returns:
//   { kind: 'quota', stock }      maps to an AFPO holdings line
//   { kind: 'nonquota' }          HAL, JOD, and non-TAC species in area VI
//   { kind: 'ignore' }            MZZ zero-rows
//   { kind: 'unmapped' }          unknown combo -> surfaced in UI for review

const NON_QUOTA_ALWAYS = new Set(['HAL', 'JOD'])
// quota stocks only exist in the North Sea for these; in area VI they are non-TAC
const NON_QUOTA_IN_WC = new Set(['LEM', 'WIT', 'TUR', 'BLL'])

export function areaBucket(fao) {
  if (!fao) return '?'
  if (fao.startsWith('27.4')) return 'NS'
  if (fao.startsWith('27.6.a')) return 'VIa'
  if (fao.startsWith('27.6.b')) return 'VIb'
  if (fao.startsWith('27.7')) return 'VII'
  if (fao.startsWith('27.8')) return 'VIII'
  return '?'
}

const MAP = {
  COD: { NS: 'NS Cod', VIa: 'Cod Area VIa', VIb: 'Cod Area VIb', VII: 'Cod VIIb-k' },
  HAD: { NS: 'NS Haddock', VIa: 'Haddock Area VIa', VIb: 'Haddock Area VIb', VII: 'Haddock VIIb-k' },
  WHG: { NS: 'NS Whiting', VIa: 'WC Whiting', VIb: 'WC Whiting', VII: 'Whiting VIIb-k' },
  POK: { NS: 'NS Saithe', VIa: 'WC Saithe', VIb: 'WC Saithe', VII: 'Saithe VII' },
  ANF: { NS: 'NS Monks (UK)', VIa: 'WC Monkfish', VIb: 'WC Monkfish', VII: 'Monks VII' },
  LEZ: { NS: 'NS Megrims', VIa: 'WC Megrim', VIb: 'WC Megrim', VII: 'Megrims VII' },
  LIN: { NS: 'NS Ling (UK)', VIa: 'WC Ling', VIb: 'WC Ling' },
  BLI: { VIa: 'WC Blue Ling', VIb: 'WC Blue Ling' },
  HKE: { NS: 'NS Hake', VIa: 'WC Hake', VIb: 'WC Hake', VIII: 'Hake VIII' },
  USK: { NS: 'NS Tusk (UK)', VIa: 'WC Tusk', VIb: 'WC Tusk', VII: 'Tusk VII' },
  PLE: { NS: 'NS Plaice', VIa: 'WC Plaice', VIb: 'WC Plaice', VII: 'Plaice VII' },
  POL: { NS: 'NS Pollack', VIa: 'WC Pollock', VIb: 'WC Pollock', VII: 'Pollock VII' },
  LEM: { NS: 'NS Lemons' },
  WIT: { NS: 'NS Witches' },
  CAT: { NS: 'NS Cats', VIa: 'WC Catfish', VIb: 'WC Catfish' },
  SQR: { NS: 'NS Squid', VIa: 'NS Squid', VIb: 'NS Squid' },
  SQS: { NS: 'NS Squid', VIa: 'NS Squid', VIb: 'NS Squid' },
  RJC: { NS: 'NS Skates/Rays', VIa: 'WC Skates/Rays', VIb: 'WC Skates/Rays' },
  TUR: { NS: 'NS Turbot' },
  BLL: { NS: 'NS Brill' },
  NEP: { NS: 'NS Nephrops', VIa: 'WC Nephrops', VIb: 'WC Nephrops', VII: 'Nephrops VII' },
  HER: { NS: 'NS Herring' },
  MAC: { NS: 'NS Mackerel' },
  DGS: { NS: 'NS Dogs' },
  SOL: { NS: 'NS Sole' },
  DAB: { NS: 'NS Dabs/Flounders' },
  FLE: { NS: 'NS Dabs/Flounders' },
  GHL: { VIa: 'WC Greenland Halibut', VIb: 'WC Greenland Halibut' },
  GFB: { VIa: 'WC Greater Forkbeard', VIb: 'WC Greater Forkbeard' },
  BSF: { VIa: 'WC Black Scabbardfish', VIb: 'WC Black Scabbardfish' },
  ARU: { VIa: 'WC Argentines', VIb: 'WC Argentines' },
  RNG: { VIa: 'WC Roundnose Grenadiers', VIb: 'WC Roundnose Grenadiers' },
}

// Friendly names for the non-quota panel
export const FAO_NAMES = {
  HAL: 'Halibut', JOD: 'John Dory', LEM: 'Lemon Sole', WIT: 'Witch',
  TUR: 'Turbot', BLL: 'Brill', SQR: 'Squid', SQS: 'Squid (SQS)', MZZ: 'Misc',
  POK: 'Saithe', ANF: 'Monks', LEZ: 'Megrim', USK: 'Tusk', CAT: 'Cats',
  COD: 'Cod', HAD: 'Haddock', WHG: 'Whiting', LIN: 'Ling', HKE: 'Hake',
  PLE: 'Plaice', POL: 'Pollack', RJC: 'Cuckoo Ray',
}

export function mapStock(speciesFao, faoArea) {
  if (speciesFao === 'MZZ') return { kind: 'ignore' }
  if (NON_QUOTA_ALWAYS.has(speciesFao)) return { kind: 'nonquota' }
  const a = areaBucket(faoArea)
  if ((a === 'VIa' || a === 'VIb') && NON_QUOTA_IN_WC.has(speciesFao)) return { kind: 'nonquota' }
  const stock = MAP[speciesFao]?.[a]
  return stock ? { kind: 'quota', stock } : { kind: 'unmapped' }
}
