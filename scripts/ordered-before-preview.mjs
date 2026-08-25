/* Render the "ordered before" panel the way the app renders it, and read the
 * markup back.
 *
 * The stores page is behind a login and a fleet, so the panel could otherwise
 * only be checked by eye on somebody else's device. Same argument as
 * `scripts/upload-panel-preview.mjs` and `SheetBody`: esbuild-bundle the REAL
 * component and server-render it, rather than checking a copy that can drift.
 *
 * It renders all three states, because a preview showing only the happy case
 * is how the other two ship broken:
 *   one list of history   — must NOT say "regularly"
 *   several lists         — must rank the habit above the recent one-off
 *   nothing kept yet      — must render nothing at all
 *
 * Usage: node scripts/ordered-before-preview.mjs
 */
import { build } from 'esbuild'
import { readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
/* fileURLToPath, not a hand-rolled strip of the URL pathname: the repo lives
 * under "Skipper Management" and that space arrives as %20, which esbuild then
 * cannot resolve. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const OUT = path.join(root, 'node_modules', '.cache', 'ordered-before.cjs')

await build({
  entryPoints: [path.join(root, 'scripts', '_orderedBeforeEntry.jsx')],
  bundle: true, format: 'cjs', platform: 'node', outfile: OUT,
  jsx: 'automatic', logLevel: 'silent',
  external: ['react', 'react-dom', 'react-dom/server'],
})

const { render } = require(OUT)

let n = 0, bad = 0
const check = (cond, msg) => {
  n++
  if (!cond) { bad++; console.error('  FAIL  ' + msg) }
}

/* ---- the real thing ------------------------------------------------------
 * Audacious's own kept list, as at Aug 2026: one list, 64 lines. Taken from
 * the database rather than invented, because the whole point is what the boat
 * will actually see. */
const real = JSON.parse(await readFile(path.join(root, 'scripts', 'fixtures', 'stores-real.json'), 'utf8'))

const one = render(real.lists, real.lines, real.currentListId)
console.log('\n--- ONE LIST OF HISTORY (the live case) ---')
console.log(one.text.slice(0, 400))

check(one.html.includes('Ordered last trip'),
      'one list must be headed "Ordered last trip"')
check(!/Regularly ordered/.test(one.html),
      'ONE LIST MUST NOT CALL ITSELF REGULAR — the whole discipline of the panel')
check(one.html.includes('not a pattern yet'),
      'and it must say what it rests on')
check(!/1 of the last 1/.test(one.html),
      'no item may read "1 of the last 1"')
check(one.html.includes('Softies'), 'the boat\'s own items are offered')
check(/last trip/.test(one.html), 'each chip says when it was ordered')

/* The quantity must be the real one, not a bare 1 — the point of the tap. */
check(/>26</.test(one.html), 'Softies carries its real quantity of 26, not 1')

/* Truncation must be stated. 64 real items against the 60 limit. */
if (real.lines.length > 60) {
  check(/Showing the top \d+ of \d+/.test(one.html),
        'a truncated panel says so rather than quietly dropping items')
}

/* ---- several lists: the ranking must be visible in the output ------------ */
const many = render(
  [{ id: 'A', starts_on: '2026-06-01' }, { id: 'B', starts_on: '2026-07-01' },
   { id: 'C', starts_on: '2026-08-01' }, { id: 'CUR', starts_on: '2026-08-20' }],
  [
    { list_id: 'A', item_key: 'softies', name: 'Softies', qty: 20, unit: 'pack', category: 'BAKERS' },
    { list_id: 'B', item_key: 'softies', name: 'Softies', qty: 26, unit: 'pack', category: 'BAKERS' },
    { list_id: 'C', item_key: 'softies', name: 'Softies', qty: 30, unit: 'pack', category: 'BAKERS' },
    { list_id: 'C', item_key: 'scampi', name: 'Scampi', qty: 1, unit: 'unit', category: 'FROZEN' },
  ],
  'CUR')
console.log('\n--- THREE LISTS ---')
console.log(many.text.slice(0, 300))

check(many.html.includes('Regularly ordered'), 'three lists may speak of a habit')
check(many.html.includes('from the last 3 lists'), 'and says how many')
check(many.text.indexOf('Softies') < many.text.indexOf('Scampi'),
      'REGULARITY BEFORE RECENCY: the thing bought every trip comes before the recent one-off')
check(many.html.includes('every one of the last 3'), 'a thing bought every trip says so')

/* ---- nothing kept yet ---------------------------------------------------- */
const none = render([{ id: 'CUR', starts_on: '2026-08-20' }], [], 'CUR')
console.log('\n--- NO HISTORY ---')
check(none.html === '', 'with nothing kept the panel renders NOTHING — not an empty card')

await rm(OUT, { force: true })

console.log(`\nordered-before preview: ${n - bad}/${n} checks passed`)
if (bad) process.exit(1)
