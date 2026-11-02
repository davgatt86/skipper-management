/* Render the REAL page header and read the back link out of the markup.
 *
 *   node scripts/pagehead-back-preview.mjs [out.html]
 *
 * David, Oct 2026: *"whilst dredging through the crew pages. there wasn't
 * sufficient <- back buttons. it's easy to go into areas of the app then only
 * way of geting to where i was is start from the side menu"*
 *
 * Every page in the app opens with this header and every one of them is behind
 * a login, so the link it now carries can only be checked by rendering the
 * component itself. The whole risk in the change is that it fires on the wrong
 * pages: a "back" link on top of all fifty is the old BackNav, which was
 * deleted for duplicating the sidebar. So half of what is asserted here is
 * where it must NOT appear.
 *
 * It needs a Router — `parentOf` reads the current path rather than taking it
 * as a prop, precisely so no page has to remember to pass one — so the harness
 * supplies a MemoryRouter at each address.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { safeOut } from './safeOut.mjs'

const out = safeOut(process.argv[2] || 'pagehead-back-preview.html', '.html')

mkdirSync('node_modules/.cache', { recursive: true })
const bundlePath = join('node_modules/.cache', 'pagehead.mjs')
await esbuild.build({
  entryPoints: ['src/PageHeader.jsx'],
  bundle: true, format: 'esm', outfile: bundlePath, platform: 'node', jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*', 'react/*', 'react-router-dom'],
  logLevel: 'warning',
})
const PageHeader = (await import(pathToFileURL(bundlePath).href)).default
/* react-router calls useLayoutEffect on mount, which the static renderer warns
   about on every pane. Harmless here and it buries the assertions. */
const warn = console.error
console.error = (m, ...r) => (String(m).includes('useLayoutEffect') ? undefined : warn(m, ...r))
const { renderToStaticMarkup } = await import('react-dom/server')
const React = await import('react')
const { MemoryRouter } = await import('react-router-dom')

/* Five addresses, picked to cover both answers. The first three are the ones
   that were stranded; the last two are pages the sidebar lists, where the link
   must not appear at all. */
const CASES = [
  ['/contracts', 'Contracts', { title: 'Contracts' }, '/contracted-crew'],
  ['/closeout', 'Month Closeout — step 3 of the workflow', { title: 'Month Closeout' }, '/contracted-crew'],
  ['/settings', 'Crew Bonus Settings — step 5, and the only route in', { title: 'Crew Bonus Settings', sub: 'Rates for this boat.' }, '/contracted-crew'],
  ['/contracts/8d1f-aaaa', 'A contract — back to the LIST, not past it', { title: 'Christopher Cuanan' }, '/contracts'],
  ['/sales', 'Fish Sales — on the sidebar, so nothing', { title: 'Fish Sales', sub: '28-10-2026' }, null],
  ['/crew', 'Crew Status — on the sidebar, so nothing', { title: 'Crew' }, null],
]

let fail = 0
const ok = (label, cond, detail = '') => {
  if (!cond) fail++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${cond || !detail ? '' : `  — ${detail}`}`)
}

const panes = []
for (const [path, caption, props, wantHref] of CASES) {
  const html = renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: [path] },
      React.createElement(PageHeader, props))
  )
  panes.push(`<section><p class="cap"><code>${path}</code> — ${caption}</p><div class="pane">${html}</div></section>`)

  const link = html.match(/<a[^>]*class="pagehead-back[^"]*"[^>]*>(.*?)<\/a>/s)
  if (wantHref) {
    ok(`${path} carries a back link`, !!link, 'no .pagehead-back in the markup')
    if (link) {
      const href = (html.match(/<a[^>]*class="pagehead-back[^"]*"[^>]*href="([^"]+)"/) ||
                    html.match(/<a[^>]*href="([^"]+)"[^>]*class="pagehead-back/) || [])[1]
      ok(`${path} points at ${wantHref}`, href === wantHref, `points at ${href}`)
      /* It has to SAY where it goes. An arrow on its own is what the old
         BackNav amounted to, and nobody used it. */
      const words = link[1].replace(/<[^>]+>/g, '').replace(/[←\s]+/g, ' ').trim()
      ok(`${path} names the destination`, words.length > 2, `reads "${words}"`)
      /* Not in print. A sheet off the printer has nothing to click. */
      ok(`${path} back link is no-print`, /class="pagehead-back[^"]*no-print/.test(html))
    }
  } else {
    ok(`${path} has NO back link`, !link, 'the sidebar already lists this page')
  }
  /* Whatever else changed, the header still has to say what the page is. */
  ok(`${path} still renders its title`, html.includes(`<h1>${props.title}</h1>`))
}

writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Page header — the way back</title>
<style>
 body{font:16px/1.5 system-ui;margin:0;padding:24px;background:#ECEFEE;color:#0A1D26}
 :root{--hull:#1749A8;--mute:#5a6b72;--border:#cfd6d4}
 section{margin-bottom:22px}
 .cap{font:13px/1.4 ui-monospace,monospace;color:#5a6b72;margin:0 0 6px}
 .pane{background:#fff;border:1px solid #cfd6d4;border-radius:10px;padding:18px 20px}
 .pagehead{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:0}
 .pagehead h1{margin:0}
 .pagehead .muted{margin-top:4px;color:#5a6b72}
 .pagehead-back{display:inline-flex;align-items:center;gap:6px;min-height:44px;margin:-10px 0 0 -8px;padding:0 8px;font-size:.85rem;font-weight:600;color:var(--hull);text-decoration:none}
</style>
<h1 style="font-size:1.1rem">Page header — where the back link appears, and where it must not</h1>
${panes.join('\n')}`)

console.log('')
console.log(`wrote ${out}`)
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
