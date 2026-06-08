// Canonicalisation for daily market price sheets.
// Aligns Peterhead (Don Fishing) and the two Denmark formats onto one
// species + grade vocabulary so they can be charted together and, later,
// overlaid on the fleet's own realised sale prices.

// ---- Peterhead: split the printed label into species + subgrade ----
// PD prints e.g. "Cod/Large A1", "Hadd Chipper A4", "Lythe/Pollack A3".
// The grade column (A1..A5/U9/...) is read separately; here we map the
// descriptive label to a canonical species and keep the descriptive tail
// as a subgrade so haddock's three A4 lines stay distinct.
const PD_SPECIES = [
  [/^cod\b/i, 'Cod'],
  [/^hadd/i, 'Haddock'],
  [/^seed$/i, 'Haddock'],
  [/^chipper/i, 'Haddock'],
  [/^metro/i, 'Haddock'],
  [/^round hadd/i, 'Haddock'],
  [/^round whiting/i, 'Whiting'],
  [/^whiting/i, 'Whiting'],
  [/^catfish/i, 'Catfish'],
  [/^coley/i, 'Saithe'],
  [/^monks?/i, 'Monkfish'],
  [/^lythe|pollack/i, 'Pollack'],
  [/^lemons?/i, 'Lemon'],
  [/^megrims?/i, 'Megrim'],
  [/^atlantic mackerel/i, 'Mackerel'],
  [/^ling/i, 'Ling'],
  [/^hake/i, 'Hake'],
  [/^plaice/i, 'Plaice'],
  [/^squid/i, 'Squid'],
  [/^turbot/i, 'Turbot'],
  [/^halibut/i, 'Halibut'],
  [/^brill/i, 'Brill'],
  [/^witch/i, 'Witch'],
  [/^tusk/i, 'Tusk'],
  [/skate/i, 'Skate'],
]
const PD_SUBGRADE = {
  'Cod/Large': 'Large', 'Cod Sprags': 'Sprags', 'Cod Medium': 'Medium', 'Cod Selected': 'Selected', 'Cod Small': 'Small',
  'Hadd Lge/Med': 'Lge/Med', 'Hadd Selected': 'Selected', 'Hadd Seed': 'Seed',
  'Hadd Chipper': 'Chipper', 'Hadd Metro': 'Metro', 'Hadd Round': 'Round',
  'Seed': 'Seed', 'Chippers': 'Chipper', 'Chipper': 'Chipper', 'Metros': 'Metro', 'Metro': 'Metro', 'Round Hadd': 'Round',
  'Round Whiting': 'Round', 'Catfish Scottish': 'Scottish',
}
export function pdSpecies(label) {
  const clean = label.replace(/\s+/g, ' ').trim()
  const hit = PD_SPECIES.find(([re]) => re.test(clean))
  return { species: hit ? hit[1] : clean, subgrade: PD_SUBGRADE[clean] || null }
}

// ---- Denmark: one map covers both the fiskeauktion.dk and Hanstholm reports ----
const DK_SPECIES = {
  'atlantic cod': 'Cod', 'cod': 'Cod',
  'haddock': 'Haddock',
  'whiting': 'Whiting',
  'saithe': 'Saithe',
  'catfishes': 'Catfish', 'catfish': 'Catfish',
  'monkfish': 'Monkfish',
  'megrim': 'Megrim',
  'european hake': 'Hake', 'hake': 'Hake',
  'ling': 'Ling',
  'european plaice': 'Plaice', 'plaice': 'Plaice',
  'pollack': 'Pollack',
  'lemon sole': 'Lemon',
  'common sole': 'Sole',
  'turbot': 'Turbot',
  'brill': 'Brill',
  'atlantic halibut': 'Halibut',
  'witch flounder': 'Witch',
  'flounder u/r': 'Flounder',
  'common dab': 'Dab',
  'tusk': 'Tusk',
  'squid': 'Squid',
  'mackerel': 'Mackerel', 'atlantic mackerel': 'Mackerel',
  'atlantic herring': 'Herring',
  'atlantic horsemackerel': 'Horse Mackerel',
  'norway lobster': 'Nephrops', 'norwaylobster tail': 'Nephrops Tail',
  'hummer': 'Lobster', 'european lobster': 'Lobster',
  'crab claws': 'Crab',
  'piked dogfish u/r': 'Dogfish',
  'rays': 'Skate', 'sailray, wings': 'Skate', 'skate': 'Skate',
  'greater forkbeard': 'Forkbeard', 'greater forkbear': 'Forkbeard',
  'greater weever': 'Weever',
  'tub gurnard': 'Gurnard',
  'garfish': 'Garfish', 'pouting': 'Pouting', 'sea urchin': 'Sea Urchin', 'mixed': 'Mixed',
}
export function dkSpecies(label) {
  const k = label.replace(/\s+/g, ' ').trim().toLowerCase()
  return DK_SPECIES[k] || label.replace(/\s+/g, ' ').trim()
}

// DK "Sort" -> grade. 0..5 -> A0..A5, '-' -> ungraded, anything else kept as A<n>.
export function dkGrade(sort) {
  const s = String(sort).trim()
  if (s === '-' || s === '') return 'U'
  return 'A' + s
}

// ---- dates ----
const DK_MONTHS = { januar: 1, februar: 2, marts: 3, april: 4, maj: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, december: 12 }
const EN_MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 }
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

// "1st JUNE 2026" / "2nd JUNE 2026"
export function parsePdDate(text) {
  const m = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/)
  if (!m) return null
  const mo = EN_MONTHS[m[2].toLowerCase()]
  return mo ? iso(m[3], mo, m[1]) : null
}
// fiskeauktion: "Tuesday, June 2, 2026"  |  Hanstholm: "1. juni 2026"
export function parseDkDate(text) {
  let m = text.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/) // English "June 2, 2026"
  if (m && EN_MONTHS[m[1].toLowerCase()]) return iso(m[3], EN_MONTHS[m[1].toLowerCase()], m[2])
  m = text.match(/(\d{1,2})\.\s*([a-zæøå]+)\s+(\d{4})/i)   // Danish "1. juni 2026"
  if (m && DK_MONTHS[m[2].toLowerCase()]) return iso(m[3], DK_MONTHS[m[2].toLowerCase()], m[1])
  return null
}

export const num = t => {
  if (t == null) return null
  const s = String(t).replace(/£/g, '').trim()
  if (/unsold/i.test(s) || s === '') return null
  return Number(s.replace(',', '.'))
}
