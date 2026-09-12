/* Render the REAL "that didn't load" panel and read the markup back.
 *
 *   node scripts/didnt-load-preview.mjs [out.html]
 *
 * This panel replaced two messages that told the skipper to run a `.sql` file in
 * the Supabase console — and one of them had fired once, wrongly, when the
 * tables were fine and a statement timeout was the real fault. So what is
 * asserted here is mostly what it must NEVER say: no filename, no console, and
 * no claim about the cause. Those are easy to reintroduce by copying the old
 * wording back, and nothing else in the repo would notice.
 *
 * Both pages that use it are behind a login and drag the supabase client in
 * behind them, so they cannot be server-rendered; this component can, which is
 * the reason the wording lives in a component at all.
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { safeOut } from './safeOut.mjs'

const out = safeOut(process.argv[2] || 'didnt-load-preview.html', '.html')

mkdirSync('node_modules/.cache', { recursive: true })
const bundlePath = join('node_modules/.cache', 'trouble.mjs')
await esbuild.build({
  entryPoints: ['src/components/Trouble.jsx'],
  bundle: true, format: 'esm', outfile: bundlePath, platform: 'node', jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*', 'react/*'],
  logLevel: 'warning',
})
const Trouble = (await import(pathToFileURL(bundlePath).href)).default
const { renderToStaticMarkup } = await import('react-dom/server')
const React = await import('react')

/* The four states, and the last two are the ones a copy of the old wording
   would get wrong: a failure with nothing to show, and a panel on a page that
   cannot retry. */
const states = [
  ['Daily Prices — the market board, with the server’s own words', {
    what: 'The market board didn’t load.',
    reassurance: 'The board lives on the server rather than on this device, so nothing has been lost and nothing you have uploaded is affected. It is worth trying again.',
    why: 'canceling statement due to statement timeout',
    busy: false, onRetry() {},
  }],
  ['Quota — manual stock tracking, mid-retry', {
    what: 'Manual stock tracking didn’t load.',
    reassurance: 'Everything else on this page is unaffected — the position off your statements is above, and nothing you have entered by hand has been lost.',
    why: 'relation "quota_manual_stocks" does not exist',
    busy: true, onRetry() {},
  }],
  ['Nothing to show for it — the read failed and said nothing', {
    what: 'The market board didn’t load.',
    reassurance: 'It is worth trying again.',
    why: '', busy: false, onRetry() {},
  }],
  ['No retry offered', {
    what: 'Manual stock tracking didn’t load.',
    reassurance: 'Everything else on this page is unaffected.',
    why: 'permission denied for table quota_manual_stocks',
  }],
  /* The crew pages, where several reads go out together and any of them can be
     the one that failed — so the panel has to say WHICH, or the skipper is left
     guessing whether it was his crew or his rank list that is missing. */
  ['Crew — several reads, and only two of them failed', {
    what: 'Some of this page didn’t load.',
    reassurance: 'Missing: the rank list, the contracts. Nothing has been changed — this is only a read, so trying again is safe.',
    why: 'the rank list: permission denied for table crew_ranks · the contracts: canceling statement due to statement timeout',
    busy: false, onRetry() {},
  }],
  /* A WRITE that failed, and the reason this panel does both: the same reader
     needs the same voice whether it was a read or a save. It takes no retry —
     a button that silently re-fires a save is how a boat ends up with two of
     the same crewman. */
  ['Crew — a save that failed, which must NOT offer to try again', {
    what: 'Couldn’t add the crewman.',
    reassurance: 'Nothing was added, so the list is as it was.',
    why: 'new row violates row-level security policy for table "crew"',
  }],
]

const html = states.map(([title, props]) =>
  `<h2 class="pv">${title}</h2>` + renderToStaticMarkup(React.createElement(Trouble, props))).join('\n')

const appCss = readFileSync('src/index.css', 'utf8')
writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>That didn't load</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>${appCss}</style>
<style>
 body{margin:0;padding:0 20px 48px;background:var(--paper)}
 .wrap{max-width:820px;margin:0 auto}
 h2.pv{font:600 13px var(--font-mono);letter-spacing:.08em;text-transform:uppercase;
       background:var(--ink);color:#fff;padding:9px 14px;margin:26px 0 0;border-radius:3px}
</style>
<div class="wrap">${html}</div>`)

/* ---- what it must and must not say ------------------------------------- */
const decode = (t) => t.replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const panes = html.split('<h2 class="pv">').slice(1).map(decode)
const all = decode(html)
let bad = 0
const ok = (cond, why) => {
  if (cond) console.log('  ok    ' + why)
  else { console.log('  FAIL  ' + why); bad++ }
}
const has = (i, s, why) => ok(panes[i - 1]?.includes(s), why)

/* THE RULES THAT MATTER — none of these is about looks. */
ok(!/\.sql/i.test(all), 'it never names a .sql file')
ok(!/supabase/i.test(all), 'it never sends anybody to Supabase')
ok(!/sql editor|console/i.test(all), 'it never mentions a database console')
ok(!/aren't set up|isn't set up|not set up yet/i.test(all), 'and it never asserts a cause it cannot know')

has(1, 'The market board didn’t load.', 'it says what did not load')
has(1, 'nothing has been lost', 'and what is safe')
has(1, 'canceling statement due to statement timeout',
    'the server’s own words are carried — the real fault the old message misdiagnosed')
has(1, '>Try again<', 'a retry is offered, which is the one thing that helps a skipper')

has(2, 'relation "quota_manual_stocks" does not exist',
    'a genuinely missing table still reports itself, in Postgres’s wording')
has(2, 'Trying…', 'a retry in flight says so')
has(2, 'disabled=""', 'and cannot be pressed twice')
has(2, 'the position off your statements', 'Quota says what still works')

ok(!panes[2].includes('<span'), 'a failure with nothing to show renders no empty detail line')
has(3, '>Try again<', 'and still offers the retry')

ok(!panes[3].includes('Try again'), 'no retry button where the page passes no handler')
has(4, 'permission denied', 'but the reason is still carried')

has(5, 'Missing: the rank list, the contracts', 'a multi-read failure names which parts are missing')
has(5, 'only a read, so trying again is safe', 'and says why retrying is safe')
has(5, 'permission denied for table crew_ranks', 'carrying each read’s own reason')
has(5, '>Try again<', 'a read offers the retry')

has(6, 'Couldn’t add the crewman.', 'a failed save names the action in plain words')
has(6, 'Nothing was added', 'and says what did not happen')
ok(!panes[5].includes('Try again'),
   'A SAVE NEVER OFFERS A RETRY — re-firing a write is how a boat gets two of the same crewman')
ok(panes[5].includes('violates row-level security policy'),
   'though the server’s own words are still carried')

ok(panes.every((p) => p.includes('var(--brass)')),
   'brass, not rust: a failure here is a question, not a fault in the boat')

console.log(out)
console.log(`  ${states.length} states rendered`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  it says what happened and never what to go and fix')
