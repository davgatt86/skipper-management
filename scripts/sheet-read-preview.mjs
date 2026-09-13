/* Render the REAL "read from a photo" panel in every state and read it back.
 *
 *   node scripts/sheet-read-preview.mjs [out.html]
 *
 * Engine Logs is behind a login and drags the supabase client in behind it, so
 * the panel is a component precisely so it can be checked here. The states come
 * off reviewSheetRead() itself rather than being written by hand, so what is
 * rendered is what the page would be handed.
 *
 * The one sentence every state must carry is that nothing is saved yet: a form
 * that filled itself looks finished.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { safeOut } from './safeOut.mjs'
import { reviewSheetRead, sheetFields } from '../src/lib/engine/sheetRead.js'
import { sheetShapes, SHEET_LAYOUT } from '../src/lib/engine/printSheet.js'
import { ENGINE_TEMPLATE } from '../src/lib/engine/template.js'

const out = safeOut(process.argv[2] || 'sheet-read-preview.html', '.html')

mkdirSync('node_modules/.cache', { recursive: true })
const bundlePath = join('node_modules/.cache', 'sheet-read-card.mjs')
await esbuild.build({
  entryPoints: ['src/components/SheetReadCard.jsx'],
  bundle: true, format: 'esm', outfile: bundlePath, platform: 'node', jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*', 'react/*'],
  logLevel: 'warning',
})
const Card = (await import(pathToFileURL(bundlePath).href)).default
const { renderToStaticMarkup } = await import('react-dom/server')
const React = await import('react')

const FIX = JSON.parse(readFileSync('scripts/fixtures/engine-log.json', 'utf8'))
const fields = sheetFields(ENGINE_TEMPLATE, sheetShapes({ logs: FIX.logs, limits: FIX.limits }))
const TODAY = '2026-09-13'
const review = (res) => reviewSheetRead(res, fields, { today: TODAY, layout: SHEET_LAYOUT })
const PHOTO = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='

const states = [
  ['A clean read of the printed sheet', { read: { ...review({ layout: 'ER2', date: '2026-09-06', readings: { 'Main Engine 1||RPM': 752, 'Generator 1||Oil': 4.2 } }), photoUrl: PHOTO } }],
  ['Marked figures, an older layout, an unread date, a day already logged', { read: { ...review({ layout: 'ER1', readings: { 'Main Engine 1||GOV': 1.5, 'Gearbox 1||Oil Press': 280 }, unsure: ['Main Engine 1||GOV'] }), photoUrl: PHOTO }, sameDayAs: TODAY }],
  ['A photo of nothing', { read: { ...review({ readings: {} }), photoUrl: PHOTO } }],
  ['A date in the future, and no link to the photo', { read: { ...review({ layout: 'ER2', date: '2026-10-01', readings: { 'Main Engine 1||RPM': 752 } }), photoUrl: null } }],
]

let bad = 0
const ok = (cond, why) => { if (cond) console.log('  ok    ' + why); else { console.log('  FAIL  ' + why); bad++ } }
const html = states.map(([title, props]) => [title, renderToStaticMarkup(React.createElement(Card, { ...props, onDiscard() {} }))])
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ')

html.forEach(([title, h]) => {
  ok(text(h).includes('Nothing is saved until you press Save'), `${title}: says nothing is saved yet`)
  ok(!/saved ✓|has been saved|was saved/i.test(text(h)), `${title}: never claims anything was saved`)
})
const [clean, marked, nothing, future] = html.map(([, h]) => text(h))
ok(/2 figures read · \d+ left blank · none marked to check/.test(clean), 'a clean read counts what it read and says nothing is marked')
ok(!/layout/i.test(clean.replace(/Daily Engine Room Log/, '')), 'a read of the current layout raises no layout note')
ok(/2 marked to check/.test(marked), 'the marked count is shown')
ok(marked.includes('layout ER1') && marked.includes('now prints ER2'), 'an older sheet names both layouts')
ok(marked.includes('date could not be read'), 'an unread date says today’s is filled in')
ok(marked.includes('already a log for 13-09-2026'), 'a day already logged is named')
ok(nothing.includes('Nothing was read off this photo'), 'a photo of nothing says so instead of counting zeroes')
ok(!nothing.includes('layout'), 'and does not lecture about layouts on a photo it could not read')
ok(future.includes('01-10-2026') && future.includes('in the future'), 'a future date is named and refused')
ok(future.includes('a link to show it here could not be made'), 'no photo link is said, not left as a broken image')
ok(html[0][1].includes('<img') && html[0][1].includes('target="_blank"'), 'the photo is shown and opens full size')

writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Sheet read panel</title><style>${readFileSync('src/index.css', 'utf8')}</style><body style="padding:1rem;max-width:900px">` +
  html.map(([t, h]) => `<h4>${t}</h4>${h}`).join('\n'))
console.log(out)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  every state says nothing is saved, and each note appears exactly where it belongs')
