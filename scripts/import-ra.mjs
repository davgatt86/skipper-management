/* Read the existing risk assessments off their PDFs and report what is in them.
 *
 *   node scripts/import-ra.mjs "<dir or file>..."           # report only
 *   node scripts/import-ra.mjs --json "<dir or file>..."    # machine readable
 *
 * READING AND WRITING ARE TWO STEPS ON PURPOSE. This one only reads, so the
 * parse can be argued with before anything reaches the database — the same
 * reason a settling sheet is filed and never saved straight off the wire.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs')
const { toRows, hazardsFromRows, titleFromCover } =
  await import(pathToFileURL('src/lib/certification/importRa.js').href)

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const targets = args.filter((a) => !a.startsWith('--'))
if (!targets.length) {
  console.error('usage: node scripts/import-ra.mjs [--json] "<dir or file>..."')
  process.exit(1)
}

const files = []
for (const t of targets) {
  if (statSync(t).isDirectory()) {
    for (const e of readdirSync(t)) {
      if (extname(e).toLowerCase() === '.pdf') files.push(join(t, e))
    }
  } else files.push(t)
}

const docs = []
for (const file of files.sort()) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(file)), useSystemFonts: true,
  }).promise

  let cover = []
  const rows = []
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent()
    if (p === 1) {
      cover = content.items.map((i) => i.str).filter((s) => s.trim())
    } else {
      rows.push(...toRows(content.items))
    }
  }

  const hazards = hazardsFromRows(rows)
  /* THE ASSESSMENT'S OWN DATE IS THE OLDEST HAZARD ON IT — the sheet carries a
     date per hazard and none of its own, and the newest would claim the whole
     thing was written the day one line was last touched. */
  const dates = hazards.map((h) => h.assessedOn).filter(Boolean).sort()
  docs.push({
    file: basename(file),
    title: titleFromCover(cover) || basename(file, '.pdf').replace(/_/g, ' ').trim(),
    assessedOn: dates[0] || null,
    lastTouched: dates[dates.length - 1] || null,
    hazards,
  })
}

if (asJson) {
  writeFileSync('_sight/ra-import.json', JSON.stringify(docs, null, 1))
  console.log('_sight/ra-import.json')
} else {
  let total = 0
  let noControls = 0
  let noLevel = 0
  for (const d of docs) {
    total += d.hazards.length
    console.log('')
    console.log(d.title + '  (' + d.file + ')')
    console.log('  ' + d.hazards.length + ' hazards · dated ' + (d.assessedOn || '?')
      + ' to ' + (d.lastTouched || '?'))
    for (const h of d.hazards) {
      if (!h.controls) noControls++
      if (!h.sourceLevel) noLevel++
      console.log('   ' + String(h.ref).padStart(3) + ' [' + (h.sourceLevel || '—').padEnd(6) + '] '
        + h.hazard.slice(0, 68))
    }
  }
  console.log('')
  console.log(docs.length + ' assessments · ' + total + ' hazards'
    + ' · ' + noControls + ' with no controls read'
    + ' · ' + noLevel + ' with no level read')
}
