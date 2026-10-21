/* PETERHEAD AGAINST DENMARK, RUN ON THE REAL BOARDS OF 21-10-2026.
 *
 * The Daily Prices page is behind a login, and nothing in this repo tested
 * `marketAgg` or the comparison at all — so this is the only thing that shows
 * what the table says. Run it before and after a change to the bridge:
 *
 *   node scripts/compare-boards-preview.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { buildBoard } from '../src/lib/market/marketAgg.js'
import { compareBoards } from '../src/lib/market/compareBoards.js'

export function loadFixture(path = './scripts/fixtures/board-2026-10-21.txt') {
  return readFileSync(path, 'utf8').split(/\r?\n/)
    .filter((l) => /^(PD|DK)~/.test(l))
    .map((l) => {
      const [source, species, grade, subgrade, ave] = l.split('~')
      return {
        source, species, grade, subgrade: subgrade || null,
        /* BLANK IS NOT NOUGHT. `Number('')` is 0, which this repo has turned
           into a lie seven times; a price nobody printed must stay null. */
        ave: ave === '' ? null : Number(ave),
        low: ave === '' ? null : Number(ave), high: ave === '' ? null : Number(ave),
        price_date: '2026-10-21', unsold: false,
      }
    })
}

/* `fileURLToPath`, not string-building a file:// URL — this project lives under
 * "Skipper Management", so a hand-made URL carries a raw space where
 * `import.meta.url` has %20 and the guard silently never fires. The same
 * mistake made `find-undefined.mjs` look at a folder that did not exist. */
if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '')) {
  const rows = loadFixture()
  const cmp = compareBoards(buildBoard(rows, 'PD'), buildBoard(rows, 'DK'))
  const w = (s, n) => String(s ?? '').padEnd(n)
  console.log(`PD ${cmp.date} vs DK ${cmp.dkDate} — ${cmp.groups.length} species compared\n`)
  console.log(`${w('species', 10)}${w('Peterhead grade', 22)}${w('vs DK', 9)}${w('band', 14)}${w('PD', 8)}${w('DK', 8)}${w('diff', 7)}fit`)
  let n = 0
  for (const g of cmp.groups) for (const r of g.rows) {
    n++
    const pct = r.pd ? ((r.dk - r.pd) / r.pd) * 100 : null
    console.log(`${w(g.species, 10)}${w(r.grade, 22)}${w(r.dkGrade, 9)}${w(r.band, 14)}`
      + `${w(r.pd.toFixed(2), 8)}${w(r.dk.toFixed(2), 8)}`
      + `${w((pct > 0 ? '+' : '') + pct.toFixed(0) + '%', 7)}${r.fit}`)
  }
  console.log(`\n${n} rows · exact ${cmp.groups.flatMap((g) => g.rows).filter((r) => r.fit === 'exact').length}`
    + ` · blend ${cmp.groups.flatMap((g) => g.rows).filter((r) => r.fit === 'blend').length}`)
  if (cmp.skipped.length) {
    console.log('\nnot compared on size:')
    for (const s of cmp.skipped) console.log(`  ${w(s.species, 12)}${s.note || '(no published bands on one side)'}`)
  }
}
