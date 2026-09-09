/* Read an existing risk assessment PDF as text.
 *
 *   node scripts/read-ra.mjs "<file.pdf>" [--json]
 *
 * David's twelve assessments came out of Aegir as real text PDFs (16 fonts, no
 * images), so they can be read rather than transcribed. This is a one-off
 * reader for working out what shape the app has to hold — NOT an importer.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs')

const file = process.argv[2]
if (!file) { console.error('usage: node scripts/read-ra.mjs "<file.pdf>"'); process.exit(1) }

const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(file)),
  useSystemFonts: true,
}).promise

const pages = []
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p)
  const content = await page.getTextContent()
  /* Group by y so a printed row comes back as a row rather than in pieces —
     the same reason the sales-note parsers work off positioned text. */
  const rows = new Map()
  for (const item of content.items) {
    if (!item.str.trim()) continue
    const y = Math.round(item.transform[5])
    if (!rows.has(y)) rows.set(y, [])
    rows.get(y).push({ x: item.transform[4], s: item.str })
  }
  const lines = [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((q) => q.s).join(' ')
      .replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  pages.push(lines)
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ file, pages }, null, 1))
} else {
  pages.forEach((lines, i) => {
    console.log('=== page ' + (i + 1) + ' of ' + pages.length + ' ===')
    for (const l of lines) console.log(l)
  })
}
