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
  // The board prints "Atlantic Mackeral" — their spelling, on the real sheet
  // of 21-10-2026. Matching only the dictionary spelling left the label
  // unresolved, which is how a fish becomes its own species in the record.
  [/^atlantic mackerel|^atlantic mackeral|^mackerel|^mackeral/i, 'Mackerel'],
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
/* `known` says whether the label actually RESOLVED to a species, as against
 * falling through and being kept verbatim.
 *
 * The parser needs that to carry a species down a block. From 21-10-2026 the
 * board names a fish once and then lists its grades on bare rows beneath:
 *
 *     Squid | U9a | £4.52 ...
 *           | U9c | £3.02 ...      <- no species of its own
 *
 * Carrying the last label down is only safe if it was a FISH. Without this
 * flag a volumes line ("Boxes 1350") or a stray word would be carried onto a
 * price row as though it were a species. */
/* The guide name off the new board, where the fish and its grade are printed
 * as one label: "Cod/Sprag", "Hadd/Mini Metro", "Lythe/Pollack/LRG".
 *
 * It is DESCRIPTIVE ONLY. The sheet says so itself — "the by names listed next
 * to the grades are not definitive and may be interpreted differently,
 * provided as a guide only" — so the code identifies the grade and this is
 * what to show a human beside it. `PD_SUBGRADE` is consulted first, so every
 * label already on file keeps the exact subgrade it has always had. */
export function pdGuideName(label) {
  const clean = String(label || '').replace(/\s+/g, ' ').trim()
  const i = clean.lastIndexOf('/')
  return i < 0 ? null : (clean.slice(i + 1).trim() || null)
}
export function pdSpecies(label) {
  const clean = label.replace(/\s+/g, ' ').trim()
  const hit = PD_SPECIES.find(([re]) => re.test(clean))
  return { species: hit ? hit[1] : clean, subgrade: PD_SUBGRADE[clean] || null, known: !!hit }
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
  'common dab': 'Dab',
  'tusk': 'Tusk',
  'squid': 'Squid',
  'mackerel': 'Mackerel', 'atlantic mackerel': 'Mackerel',
  'atlantic herring': 'Herring',
  'atlantic horsemackerel': 'Horse Mackerel',
  'norway lobster': 'Nephrops', 'norwaylobster tail': 'Nephrops Tail',
  'hummer': 'Lobster', 'european lobster': 'Lobster',
  'crab claws': 'Crab',
  'piked dogfish': 'Dogfish',
  'rays': 'Skate', 'sailray, wings': 'Skate', 'skate': 'Skate',
  'greater forkbeard': 'Forkbeard', 'greater forkbear': 'Forkbeard',
  'greater weever': 'Weever',
  'tub gurnard': 'Gurnard',
  'garfish': 'Garfish', 'pouting': 'Pouting', 'sea urchin': 'Sea Urchin', 'mixed': 'Mixed',
}
/* DENMARK WRITES THE PRESENTATION AFTER THE SPECIES — "Whiting u/r",
 * "Catfish u/h", "Piked dogfish u/r". `u/` is Danish *uden*, without.
 *
 * David, Oct 2026: *"denmark label round as u/r."* So a round Danish fish is
 * the same thing Peterhead prints as `4 Round`, and the two boards had better
 * agree on the word.
 *
 * LEFT ON THE SPECIES IT SPLITS THE FISH IN TWO. `Whiting u/r` never matched
 * the map, so it was filed as a species of its own and never grouped with
 * whiting — 2 rows on record. **AND THE MAP ITSELF SHOWS THE OTHER HALF OF THE
 * FAULT**: it carried `'flounder u/r': 'Flounder'` and
 * `'piked dogfish u/r': 'Dogfish'`, which is the same problem answered the
 * other way round — the marker collapsed away, so round flounder and round
 * dogfish went into the same line as the gutted ones and cannot now be told
 * apart. Both entries are gone; the marker is split off instead.
 *
 * ONLY `u/r` IS TRANSLATED, because it is the only one David named. Anything
 * else is carried through verbatim rather than guessed at — `u/h` is most
 * likely *uden hoved*, headed, and most likely is not good enough to write
 * into a price record. */
const DK_PRESENTATION = { 'u/r': 'Round' }

/** Split a Danish species label into its fish and its presentation. */
export function dkSplitPresentation(label) {
  const t = String(label ?? '').replace(/\s+/g, ' ').trim()
  const m = t.match(/^(.*?)[\s,]+(u\/[a-zæøå]+)$/i)
  if (!m || !m[1]) return { label: t, presentation: null }
  const mark = m[2].toLowerCase()
  return { label: m[1].trim(), presentation: DK_PRESENTATION[mark] || mark }
}

export function dkSpecies(label) {
  const k = label.replace(/\s+/g, ' ').trim().toLowerCase()
  return DK_SPECIES[k] || label.replace(/\s+/g, ' ').trim()
}

/**
 * The Danish species AND how it was presented, which is what the board rows
 * actually carry. The presentation goes in `subgrade`, the way Peterhead's
 * `A4 Round` does, so one board's round fish keys apart from its own gutted
 * line exactly as the other's does.
 */
export function dkSpeciesAndPresentation(label) {
  const { label: name, presentation } = dkSplitPresentation(label)
  return { species: dkSpecies(name), presentation }
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
