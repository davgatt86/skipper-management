/* WHEN THE APP IS UPDATED WHILE A PAGE IS STILL OPEN.
 *
 * David, Aug 2026, uploading a sales note:
 *
 *   AUDACIOUS BF83 (1).pdf: Failed to fetch dynamically imported module:
 *   https://skippermanagement.co.uk/assets/parse-core-CDChEAJ_.js
 *
 * Nothing was broken. The parser is loaded ON DEMAND — pdf.js and the parser
 * are large and most sessions never upload a note — so Vite splits it into a
 * content-hashed chunk whose NAME is baked into the JS already running in the
 * browser. Bumping the parser to 1.3.5 changed that hash, the deploy replaced
 * the file, and his open page went on asking for a chunk that no longer exists.
 *
 * It is not a service-worker fault and not an offline fault. Navigations are
 * network-first, so a plain reload fixes it — but the man is standing at the
 * upload button and should not have to know that.
 *
 * THE RELOAD IS GUARDED THREE WAYS, because this app is used at sea and a
 * reload loop on a boat with no signal is far worse than the error it replaces:
 *
 *   - ONLINE ONLY. Offline, the chunk is missing because it was never cached,
 *     and reloading cannot conjure it. Say so instead.
 *   - ONCE PER SESSION. If the chunk is genuinely absent — a half-finished
 *     deploy — reloading again just loops. One attempt, then the plain message.
 *   - ONLY FOR THIS FAILURE. A parser that throws on a bad PDF must still
 *     report a bad PDF, not silently reload the page under him.
 */

const ONCE = 'skm.staleBuildReload'

/* The browsers word this differently and none of it is structured, so match on
 * the shapes actually seen rather than one string:
 *   Chrome  "Failed to fetch dynamically imported module: <url>"
 *   Safari  "Importing a module script failed."
 *   Firefox "error loading dynamically imported module"
 * Vite also raises its own `vite:preloadError` for route chunks. */
export function isStaleChunkError(err) {
  const m = String(err?.message || err || '')
  return /dynamically imported module/i.test(m)
    || /Importing a module script failed/i.test(m)
    || /error loading dynamically imported module/i.test(m)
    || /Failed to fetch dynamically imported/i.test(m)
}

export const alreadyTried = () => {
  try { return sessionStorage.getItem(ONCE) === '1' } catch { return false }
}
const remember = () => { try { sessionStorage.setItem(ONCE, '1') } catch { /* private mode */ } }

/** Clear the flag once a load has gone through cleanly, so a later update in
 *  the same session can still recover itself. */
export function buildLoadedCleanly() {
  try { sessionStorage.removeItem(ONCE) } catch { /* ignore */ }
}

export const STALE_MESSAGE =
  'The app was updated while this page was open, and part of it could not be fetched. '
  + 'Reload the page when you have a signal — nothing you have entered is lost.'

/**
 * Try to recover from a stale build. Returns false if it cannot, so the caller
 * can show something honest rather than hanging on a reload that never comes.
 */
export function recoverStaleBuild() {
  if (typeof window === 'undefined') return false
  if (!navigator.onLine) return false
  if (alreadyTried()) return false
  remember()
  // Reload from the server rather than the bfcache, so the new index.html and
  // its new chunk names are what comes back.
  window.location.reload()
  return true
}

/**
 * Wrap a dynamic import so an update that lands mid-session heals itself.
 *
 *   const mod = await freshImport(() => import('./parse-core.cjs'))
 *
 * Anything that is NOT a stale-chunk error is rethrown untouched — a parser
 * that fails on a bad note must still say so.
 */
export async function freshImport(load) {
  try {
    return await load()
  } catch (err) {
    if (!isStaleChunkError(err)) throw err
    if (recoverStaleBuild()) {
      // The reload is in flight; hang rather than flashing an error at him.
      await new Promise(() => {})
    }
    throw new Error(STALE_MESSAGE)
  }
}
