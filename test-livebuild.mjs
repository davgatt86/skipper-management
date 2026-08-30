/* RECOVERING FROM A DEPLOY THAT LANDED MID-SESSION.
 *
 * David got this uploading a note:
 *
 *   Failed to fetch dynamically imported module:
 *   https://skippermanagement.co.uk/assets/parse-core-CDChEAJ_.js
 *
 * Nothing was broken — the parser is loaded on demand, bumping it to 1.3.5
 * changed the chunk's content hash, and his open page went on asking for a file
 * the deploy had replaced.
 *
 * The reload that fixes it is the dangerous part, not the detection. This app
 * is used at sea, and a reload loop on a boat with no signal is far worse than
 * the error it replaces. These are the three guards.
 */
import assert from 'node:assert/strict'

let n = 0
const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m) }
const ok = (c, m) => { n++; assert.ok(c, m) }

// --- a browser, near enough ------------------------------------------------
let reloads = 0
const store = new Map()
globalThis.window = { location: { reload: () => { reloads++ } }, addEventListener() {} }
// node 24 defines navigator as a getter-only global, so it has to be redefined
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, writable: true, configurable: true })
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const LB = await import('./src/lib/liveBuild.js')

// --- recognising it --------------------------------------------------------
/* Three browsers, three wordings, none of it structured — so the match is on
 * the shapes actually seen rather than one string. */
ok(LB.isStaleChunkError(new Error(
  'Failed to fetch dynamically imported module: https://skippermanagement.co.uk/assets/parse-core-CDChEAJ_.js')),
  "David's own error, verbatim (Chrome)")
ok(LB.isStaleChunkError(new Error('Importing a module script failed.')), 'Safari')
ok(LB.isStaleChunkError(new Error('error loading dynamically imported module')), 'Firefox')

/* AND NOT ANYTHING ELSE. A parser that throws on a bad note must still say the
 * note is bad, not silently reload the page under him. */
ok(!LB.isStaleChunkError(new Error('Unsupported file type')), 'a real parse failure is not this')
ok(!LB.isStaleChunkError(new Error('NetworkError when attempting to fetch resource.')),
   'nor a plain network error — that is being at sea, and reloading would lose the page')
ok(!LB.isStaleChunkError(null), 'nor nothing at all')

// --- ONLINE ONLY -----------------------------------------------------------
{
  store.clear(); reloads = 0
  navigator.onLine = false
  eq(LB.recoverStaleBuild(), false, 'offline it refuses')
  eq(reloads, 0, 'and does not reload — the chunk is missing because it was never cached')
  ok(!LB.alreadyTried(), 'and it does not burn the one attempt it has')
  navigator.onLine = true
}

// --- ONCE PER SESSION ------------------------------------------------------
{
  store.clear(); reloads = 0
  eq(LB.recoverStaleBuild(), true, 'online, it reloads')
  eq(reloads, 1, 'once')
  eq(LB.recoverStaleBuild(), false, 'and refuses a second time')
  eq(reloads, 1, 'so a half-finished deploy cannot put the boat in a reload loop')
}

// --- a clean load clears the guard -----------------------------------------
{
  ok(LB.alreadyTried(), 'the flag is set after an attempt')
  LB.buildLoadedCleanly()
  ok(!LB.alreadyTried(), 'and a build that actually ran clears it')
  reloads = 0
  eq(LB.recoverStaleBuild(), true, 'so a LATER update in the same session can still heal itself')
  eq(reloads, 1, 'once again')
}

// --- freshImport -----------------------------------------------------------
{
  store.clear(); reloads = 0
  const val = await LB.freshImport(async () => ({ ok: 1 }))
  eq(val, { ok: 1 }, 'a working import is passed straight through')
  eq(reloads, 0, 'with no reload')
}

{
  /* NOT A STALE CHUNK -> RETHROWN UNTOUCHED. This is the guard that keeps a
   * genuine failure legible: the message the user sees must be the real one. */
  store.clear(); reloads = 0
  let caught = null
  try { await LB.freshImport(async () => { throw new Error('Unsupported file type') }) }
  catch (e) { caught = e }
  eq(caught.message, 'Unsupported file type', 'the real error survives')
  eq(reloads, 0, 'and nothing reloaded')
}

{
  // A stale chunk, offline: no reload, and a message a person can act on.
  store.clear(); reloads = 0
  navigator.onLine = false
  let caught = null
  try {
    await LB.freshImport(async () => { throw new Error('Failed to fetch dynamically imported module: /assets/x.js') })
  } catch (e) { caught = e }
  eq(reloads, 0, 'offline it does not reload')
  ok(caught.message.includes('updated while this page was open'), 'it says what happened')
  ok(caught.message.includes('nothing you have entered is lost'), 'and that his work is safe')
  ok(!/dynamically imported module/i.test(caught.message),
     'and never shows him the raw browser wording, which names a file he cannot act on')
  navigator.onLine = true
}

console.log('live build: ' + n + ' checks passed')
