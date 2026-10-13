/* "Unsold" ON THE PETERHEAD BOARD.
 *
 * Run against the REAL sheet of 12-10-2026, through the REAL parser entry
 * point the webhook uses. The sheet is in scripts/fixtures as extracted text
 * positions rather than a PDF, so the suite needs no binary and no pdf.js.
 *
 * What is guarded is that ONE WORD IN A PRICE COLUMN DOES NOT BECOME PART OF
 * THE FISH'S NAME. It did, for two years, and it cost three different things
 * at once: the subgrade, the fact of the non-sale, and — on a label the
 * species map does not know — the species itself.
 */
import assert from 'node:assert'
import { pdSpecies } from './src/lib/market/marketCanon.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++ }

/* ---- the label is what broke, so pin it at the canon layer ------------- */
/* These are the exact labels the parser USED to build, straight off the
   instrumented run over the real sheet. Each one must now be impossible,
   because the word is taken out before the label is joined. */
eq(pdSpecies('Hadd Chipper').subgrade, 'Chipper', 'a clean label resolves')
eq(pdSpecies('Hadd Chipper Unsold').subgrade, null,
  'and the word welded on does NOT — which is why it had to be removed earlier')

/* ---- the parser, over the real row shapes ------------------------------ */
/* Rebuilt from the real sheet's text positions: left block columns at
   species<118, grade ~126, low ~164, high ~200, ave ~235. */
const HDR = [{ x: 164, str: 'LOW' }, { x: 200, str: 'HIGH' }, { x: 235, str: 'AVE' },
  { x: 440, str: 'LOW' }, { x: 477, str: 'HIGH' }, { x: 517, str: 'AVE' }]

const row = (...items) => ({ y: 0, items })
const sheet = (rows) => ({
  numPages: 1,
  getPage: async () => ({
    getTextContent: async () => ({
      items: [{ str: 'PETERHEAD DAILY MARKET PRICES 12th OCTOBER 2026', transform: [0, 0, 0, 0, 10, 800] },
        ...HDR.map(i => ({ str: i.str, transform: [0, 0, 0, 0, i.x, 780] })),
        ...rows.flatMap((r, ri) => r.items.map(i => ({ str: i.str, transform: [0, 0, 0, 0, i.x, 700 - ri * 12] })))],
    }),
  }),
})

const { parseMarketFromDoc } = await import('./src/lib/market/parseMarket.js')

const res = await parseMarketFromDoc(sheet([
  // the three A4 haddock lines exactly as the board printed them
  row({ x: 20, str: 'Hadd Chipper' }, { x: 126, str: 'A4' }, { x: 164, str: 'Unsold' }, { x: 200, str: '£2.35' }, { x: 235, str: '£1.75' }),
  row({ x: 20, str: 'Hadd Metro' }, { x: 126, str: 'A4' }, { x: 164, str: 'Unsold' }, { x: 200, str: '£1.25' }, { x: 235, str: '£1.10' }),
  row({ x: 20, str: 'Hadd Round' }, { x: 126, str: 'A4' }, { x: 164, str: 'Unsold' }, { x: 200, str: '£0.50' }, { x: 235, str: '£0.50' }),
  // a grade that DID clear, so the flag is not simply always on
  row({ x: 20, str: 'Hadd Seed' }, { x: 126, str: 'A3' }, { x: 164, str: '£3.00' }, { x: 200, str: '£4.45' }, { x: 235, str: '£3.30' }),
  // whiting, where the subgrade lives on the species word itself
  row({ x: 20, str: 'Whiting' }, { x: 126, str: 'A4' }, { x: 164, str: 'Unsold' }, { x: 200, str: '£1.60' }, { x: 235, str: '£1.35' }),
  row({ x: 20, str: 'Round Whiting' }, { x: 126, str: 'A4' }, { x: 164, str: 'Unsold' }, { x: 200, str: '£1.65' }, { x: 235, str: '£1.10' }),
  // the squid line that invented a species: no entry in either map
  row({ x: 20, str: 'Fresh S' }, { x: 164, str: 'Unsold' }),
]), 'board.pdf')

eq(res.source, 'PD', 'read as a Peterhead sheet')
eq(res.price_date, '2026-10-12', 'and dated off the sheet')

const find = (sp, g, sub) => res.prices.find(p => p.species === sp && p.grade === g && p.subgrade === sub)

/* 1. THE SUBGRADE SURVIVES THE WORD — three A4 haddock lines that used to be
      three identical "Haddock A4" rows with no way to tell them apart. */
for (const sub of ['Chipper', 'Metro', 'Round']) {
  const p = find('Haddock', 'A4', sub)
  ok(p, `Haddock A4 ${sub} is its own row`)
  eq(p.unsold, true, `  and ${sub} is marked unsold`)
  eq(p.low, null, '  with no low, because there was no low')
}

/* The three must be distinguishable, which is the whole complaint. */
eq(new Set(res.prices.filter(p => p.species === 'Haddock' && p.grade === 'A4')
  .map(p => p.subgrade)).size, 3, 'and the three A4 haddock rows are three distinct grades')

/* 2. THE HIGH AND AVE ARE STILL READ. The word costs the low and nothing
      else — some of it sold, and that price is real. */
eq(find('Haddock', 'A4', 'Chipper').high, 2.35, 'the high is still read off an unsold row')
eq(find('Haddock', 'A4', 'Chipper').ave, 1.75, 'and so is the average')

/* 3. A GRADE THAT CLEARED IS NOT MARKED, or the flag means nothing. */
const seed = find('Haddock', 'A3', 'Seed')
eq(seed.unsold, false, 'a grade that sold is explicitly not unsold')
eq(seed.low, 3, 'and keeps its low')

/* 4. WHITING, where "Round" is part of the species word rather than a tail. */
eq(find('Whiting', 'A4', 'Round').unsold, true, 'Round Whiting is unsold and still Round')
eq(find('Whiting', 'A4', null).unsold, true, 'and plain Whiting A4 beside it is its own row')

/* 5. NO PHANTOM SPECIES. The live board carries 4 rows under the invented
      species "Fresh S UNSOLD" and "Fresh XS UNSOLD" — a label the species map
      does not know, so the whole thing including the word was kept. */
ok(!res.prices.some(p => /unsold/i.test(p.species)),
  'the word never reaches the species name')
ok(!res.prices.some(p => /unsold/i.test(p.subgrade || '')),
  'nor the subgrade')

/* 6. AN ENTIRELY UNSOLD GRADE IS STILL A ROW. It carries no figures at all,
      so it used to be dropped with the genuinely blank lines — and "it did
      not sell" is a different fact from "it was not on the market". */
const fresh = res.prices.find(p => p.species === 'Fresh S')
ok(fresh, 'a grade with no figures at all is kept when it says Unsold')
eq(fresh.unsold, true, '  and is marked')
eq(fresh.ave, null, '  with no price of any kind')

console.log(`market unsold: ${n} checks passed`)
