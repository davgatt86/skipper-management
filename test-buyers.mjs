/* Buyer merges at ingest.
 *
 * The merge fixes history; the ALIAS is what stops the next sales note
 * reintroducing the variant. Buyer names arrive from the note rather than a
 * pick-list, so this is the only durable fix — it is the fourth instance of
 * the same drift after crew_ranks, fuel suppliers and vessel labels.
 *
 * The rows below are the real ones on the database, Aug 2026.
 */
import { squashBuyer, buildAliasMap, makeCanonBuyer, canonBuyerFrom } from './src/lib/buyerAliases.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const AUDACIOUS = [
  { canonical_name: 'Messrs J Smith Ltd', aliases: ['J Smith'] },
]
const BOY_JOHN = [
  { canonical_name: 'G&J Jack Seafoods Ltd', aliases: ['G & J JACK'] },
  { canonical_name: 'QA Fish (Local)', aliases: ['QALOCAL', 'QA FISH (LOCAL)'] },
  { canonical_name: 'Whitelink Seafoods', aliases: ['WHITELINK'] },
]

// The merge that changed the answer: "J Smith" was hiding a third of that
// buyer's volume AND understating their rate, because the split rows were the
// strongest of the lot.
{
  const canon = canonBuyerFrom(AUDACIOUS)
  eq('the variant becomes the canonical name', canon('J Smith'), 'Messrs J Smith Ltd')
  eq('the canonical name survives untouched', canon('Messrs J Smith Ltd'), 'Messrs J Smith Ltd')
  eq('a buyer nobody merged passes through', canon('Bells Seafood'), 'Bells Seafood')
}

// Variants differ by case, spacing and punctuation — that is the whole point.
{
  const canon = canonBuyerFrom(BOY_JOHN)
  eq('spacing is ignored', canon('G & J JACK'), 'G&J Jack Seafoods Ltd')
  eq('and so is case', canon('g & j jack'), 'G&J Jack Seafoods Ltd')
  eq('and punctuation', canon('G&J-JACK'), 'G&J Jack Seafoods Ltd')
  eq('two aliases can point at one firm',
    [canon('QALOCAL'), canon('QA FISH (LOCAL)')], ['QA Fish (Local)', 'QA Fish (Local)'])
  eq('a canonical name differing only in punctuation still lands',
    canon('whitelink  seafoods'), 'Whitelink Seafoods')
}

// PER FLEET. Two boats may know the same firm by different names, and one
// fleet's merge is not evidence about another's.
{
  const aud = canonBuyerFrom(AUDACIOUS)
  const bj = canonBuyerFrom(BOY_JOHN)
  eq('one fleet’s merge does not reach another', aud('WHITELINK'), 'WHITELINK')
  eq('and the other fleet still has it', bj('WHITELINK'), 'Whitelink Seafoods')
}

// An unknown buyer must pass through unchanged. Guessing a merge from string
// similarity is how two genuinely different firms get welded together, and
// that is not recoverable from the note afterwards.
{
  const canon = canonBuyerFrom(AUDACIOUS)
  eq('a near-miss is NOT guessed at', canon('J Smithson'), 'J Smithson')
  eq('nor is a longer name containing an alias', canon('J Smith & Daughters'), 'J Smith & Daughters')
}

// Rubbish in must not throw — this runs inside the ingest loop for every row.
{
  const canon = canonBuyerFrom(AUDACIOUS)
  eq('a blank buyer stays blank', canon(''), '')
  eq('null is handled', canon(null), '')
  eq('undefined is handled', canon(undefined), '')
  eq('no flags at all is handled', canonBuyerFrom(null)('J Smith'), 'J Smith')
  eq('a flag with no canonical name is skipped',
    canonBuyerFrom([{ canonical_name: null, aliases: ['X'] }])('X'), 'X')
  eq('a flag with no aliases is still self-mapped',
    canonBuyerFrom([{ canonical_name: 'Lone Ltd', aliases: null }])('LONE LTD'), 'Lone Ltd')
}

eq('squash strips everything that varies', squashBuyer('G & J JACK!'), 'gjjack')
eq('and an empty alias never enters the map',
  buildAliasMap([{ canonical_name: 'A Ltd', aliases: ['', '  '] }]).has(''), false)
eq('makeCanonBuyer takes a prepared map',
  makeCanonBuyer(buildAliasMap(AUDACIOUS))('J Smith'), 'Messrs J Smith Ltd')

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
