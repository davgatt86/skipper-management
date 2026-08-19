/* Render the REAL chalk sheet component against a REAL day tally, to an HTML
 * file that can be opened and printed.
 *
 * The page it comes from is behind a login and a file picker, so checking the
 * printed output through the app means a person doing it by hand every time.
 * This bundles the actual component with esbuild and server-renders it, so
 * what you look at is what the app produces — not a copy of it that can drift.
 *
 *   node scripts/sheet-preview.mjs "path/to/day tally.xlsx" [out.html]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { parseDayTally } from '../src/lib/market/parseDayTally.js'
import { planLayout } from '../src/lib/market/planLayout.js'

const file = process.argv[2]
const out = process.argv[3] || 'sheet-preview.html'
if (!file) { console.error('usage: node scripts/sheet-preview.mjs <tally.xlsx> [out.html]'); process.exit(1) }

const parsed = parseDayTally(readFileSync(file))
if (parsed.error) { console.error(parsed.error); process.exit(1) }
const plan = planLayout(parsed.lines)

// Bundle the component itself rather than reimplementing it here. It has to
// land inside the project or node cannot resolve react from it.
const dir = 'node_modules/.cache'
mkdirSync(dir, { recursive: true })
const bundle = join(dir, 'sheet-preview.mjs')
await esbuild.build({
  entryPoints: ['src/pages/MarketSheet.jsx'],
  bundle: true, format: 'esm', outfile: bundle,
  jsx: 'automatic', platform: 'node',
  external: ['react', 'react-dom', 'react-dom/*', 'react/*'],
  logLevel: 'warning',
})

const { SheetBody } = await import(pathToFileURL(bundle).href)
const { renderToStaticMarkup } = await import('react-dom/server')
const { createElement } = await import('react')

// Both shapes: the full-screen one that prints, and the one embedded on the
// layout page. They are the same component, and the point of checking both is
// that the page is now the sheet rather than a second drawing of it.
const html = renderToStaticMarkup(createElement(SheetBody, { plan, meta: parsed.meta }))
const embedded = process.argv.includes('--embedded')
  ? renderToStaticMarkup(createElement(SheetBody, { plan, meta: parsed.meta, embedded: true }))
  : ''
writeFileSync(out, `<!doctype html><meta charset="utf-8">
<title>Chalk sheet — ${parsed.meta?.port || 'market'}</title>
<style>body{margin:0}</style>
${embedded ? `<div id="root">${embedded}</div>` : html}`)

console.log(`${out}`)
console.log(`  tiers        ${plan.tiers}  (${(html.match(/class="msheet-page"/g) || []).length} page(s))`)
console.log(`  boxes        ${plan.totalBoxes}`)
console.log(`  footprints   ${plan.footprints} of ${plan.tiers * 47}, ${plan.spare} spare`)
