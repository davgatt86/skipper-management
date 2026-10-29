/* FINGERPRINT EVERY SALES NOTE ON DISK, so a parser change can be diffed.
 *
 * The Don grade class has now had to grow three times, and each widening is a
 * chance to start matching something that is not a fish. A build passing says
 * nothing about that; what says it is running the real notes through both
 * versions and comparing row for row.
 *
 *   node scripts/note-fingerprint.mjs <dir-or-file>... > before.json
 *   ...change the parser...
 *   node scripts/note-fingerprint.mjs <dir-or-file>... > after.json
 *   node scripts/note-fingerprint.mjs --diff before.json after.json
 *
 * The fingerprint is the market, vessel, date, row count, the reconcile and a
 * hash of every row's buyer/species/presentation/grade/boxes/weight/value — so
 * a row that changes its grade or its money shows up, not merely a row count.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

const require = createRequire(import.meta.url)
const ParseCore = require('../src/lib/parse-core.cjs')

const args = process.argv.slice(2)

if (args[0] === '--diff') {
  const a = JSON.parse(readFileSync(args[1], 'utf8'))
  const b = JSON.parse(readFileSync(args[2], 'utf8'))
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  let same = 0
  const changed = []
  for (const n of names) {
    if (JSON.stringify(a[n]) === JSON.stringify(b[n])) { same++; continue }
    changed.push({ file: n, before: a[n], after: b[n] })
  }
  console.log(`${same} of ${names.length} notes byte-identical`)
  for (const c of changed) {
    console.log(`\nCHANGED  ${c.file}`)
    console.log(`  before  ${JSON.stringify(c.before)}`)
    console.log(`  after   ${JSON.stringify(c.after)}`)
  }
  process.exit(changed.length ? 0 : 0)
}

const files = []
for (const a of args) {
  const st = statSync(a)
  if (st.isDirectory()) for (const f of readdirSync(a)) { if (/\.pdf$/i.test(f)) files.push(join(a, f)) }
  else files.push(a)
}

const out = {}
for (const f of files.sort()) {
  const name = f.split(/[\\/]/).pop()
  try {
    // pdf.js writes font warnings to STDOUT, which would corrupt the JSON.
    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(readFileSync(f)), verbosity: 0,
    }).promise
    const res = ParseCore.parseExtracted(await ParseCore.extractPages(doc), name)
    /* A FILE THAT IS NOT A SALES NOTE IS STILL WORTH FINGERPRINTING as the
       nothing it is: a widened token that started reading rows out of an
       invoice or a chalk sheet would otherwise go unnoticed. */
    const h = createHash('sha1')
    for (const r of res.rows)
      h.update([r.buyer, r.species, r.presentation, r.grade, r.boxes, r.total_weight, r.total_value].join('|') + '\n')
    out[name] = {
      market: res.market, vessel: res.meta.vessel, date: res.meta.isoDate,
      rows: res.rows.length, rec: res.reconcile ? res.reconcile.diffs || null : null,
      ok: res.reconcile ? res.reconcile.ok : null,
      hash: h.digest('hex').slice(0, 12),
    }
  } catch (e) {
    out[name] = { error: String(e.message || e).slice(0, 80) }
  }
}
console.log(JSON.stringify(out, null, 1))
