import assert from 'node:assert'
import { readFileSync } from 'node:fs'

/* A PROVIDER IMPORTED AND NEVER RENDERED IS VALID JAVASCRIPT.
 *
 * `VesselProvider` was imported into `App.jsx` and never put in the tree (Sep
 * 2026). Every `useCurrentVessel()` in fifteen pages therefore read the module
 * default — `{ current: null, vessels: [], hasVessels: false }` — so the app
 * behaved as though the fleet had no boat:
 *
 *   - the ORB, OLB and radio log all said "No vessel on file. Add one on
 *     Vessel", on a boat whose particulars were filled in;
 *   - the self-certification said "choose a boat first" to a fleet with
 *     exactly ONE boat, where there is nothing to choose;
 *   - risk assessments and the lifting register said "Vessel: the fleet";
 *   - and saving vessel details sent `vessel_id: null` into a NOT NULL column,
 *     which is the only part that produced an error message.
 *
 * A PROVIDER IS THE WORST SHAPE OF THIS BUG, because a context consumer has a
 * default and so degrades silently rather than crashing. The build passed,
 * nothing threw, every page rendered — they just rendered the wrong answer.
 * There is no ESLint in this project to catch an unused import, and a test
 * that swept for all of them flagged 34 harmless ones (mostly `React` under
 * the automatic JSX runtime), so it is scoped to the case that matters.
 */

let n = 0
const ok = (c, why) => { assert.ok(c, why); n++ }

const app = readFileSync('src/App.jsx', 'utf8')

const IMPORT = /^import\s+(?:([A-Z]\w*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"][^'"]+['"]/gm
function importedNames(src) {
  const names = []
  for (const m of src.matchAll(IMPORT)) {
    if (m[1]) names.push(m[1])
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const nm = part.split(' as ').pop().trim()
        if (/^[A-Z]\w*$/.test(nm)) names.push(nm)
      }
    }
  }
  return [...new Set(names)]
}

const providers = importedNames(app).filter((nm) => /Provider$/.test(nm))
ok(providers.length > 0, 'App.jsx imports at least one provider')

/* EVERY provider, so one added next year is covered without editing this. */
for (const nm of providers) {
  ok(new RegExp('<' + nm + '[\\s>]').test(app),
     nm + ' is RENDERED in App.jsx, not merely imported')
}

/* And the two that exist today by name, so removing one is a deliberate act
   rather than something the loop above stops noticing. */
for (const nm of ['AuthProvider', 'VesselProvider']) {
  ok(providers.includes(nm), nm + ' is imported by App.jsx')
  ok(new RegExp('<' + nm + '[\\s>]').test(app), nm + ' is in the rendered tree')
}

/* ORDER MATTERS. VesselProvider reads `appUser.fleet_id` to know whose boats to
   fetch, so outside AuthProvider it fetches nothing and every symptom above
   comes straight back — with the tree looking correct. */
ok(app.indexOf('<AuthProvider') < app.indexOf('<VesselProvider'),
   'VesselProvider sits INSIDE AuthProvider — it needs appUser.fleet_id')

/* The consumers are the reason this matters; if none are left, the provider
   should go rather than this test being kept green for nothing. */
ok(/useCurrentVessel/.test(readFileSync('src/VesselContext.jsx', 'utf8')),
   'VesselContext still exports the hook the pages read')

console.log('app tree: ' + n + ' checks passed')
