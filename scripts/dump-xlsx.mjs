/* Dump an .xlsx so its real shape can be seen before anything is written to
 * parse it. Two P&J parser fixes in this project were written against an
 * assumed layout and both failed; a spreadsheet is worse than a PDF for that,
 * because a moved header or a totals row that looks like data produces a wrong
 * number rather than an error.
 *
 *   node scripts/dump-xlsx.mjs "path/to/file.xlsx" [maxRows]
 */
import XLSX from 'xlsx'

const file = process.argv[2]
const maxRows = Number(process.argv[3] || 40)
if (!file) { console.error('usage: node scripts/dump-xlsx.mjs <file.xlsx> [maxRows]'); process.exit(1) }

const wb = XLSX.readFile(file)
console.log('SHEETS: ' + wb.SheetNames.join(' | '))

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false })
  console.log('')
  console.log('===== ' + name + '  (' + (ws['!ref'] || '') + ', ' + rows.length + ' rows) =====')
  const merges = (ws['!merges'] || []).length
  if (merges) console.log('  ' + merges + ' merged cell range(s) — watch for headers spanning columns')
  for (let i = 0; i < Math.min(rows.length, maxRows); i++) {
    const r = (rows[i] || []).map((c) => (c === null ? '' : String(c))).slice(0, 16)
    if (r.every((c) => c === '')) continue
    console.log(String(i).padStart(3) + ' | ' + r.join(' | '))
  }
  if (rows.length > maxRows) console.log('  ... ' + (rows.length - maxRows) + ' more rows')
}
