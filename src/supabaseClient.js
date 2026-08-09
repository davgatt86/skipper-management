import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables. Check Netlify env settings.')
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
})

// Where supabase-js keeps the session. Derived, not hard-coded, so it cannot
// drift from the project URL.
export const authStorageKey = (() => {
  try { return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token` }
  catch { return null }
})()

/* Has this user signed out, or have they merely lost the signal?
 *
 * The two look identical from getSession(), and telling them apart is the whole
 * problem. When the access token expires and the refresh cannot reach the
 * server, auth-js returns `session: null` — but it deliberately does NOT clear
 * storage, because the failure was a dropped connection rather than a refused
 * token. signOut() does clear it.
 *
 * So the presence of a refresh token in storage is the honest test for "still
 * signed in, just cannot prove it right now". Without this the app bounces an
 * engineer an hour into a trip to a login page that needs the network he does
 * not have, stranding everything in his outbox.
 */
// Pure so it can be tested without a browser or a project URL — the decision it
// makes is the difference between an engineer keeping his logs and being thrown
// out of the app mid-trip, so it is worth a test. See test-session.mjs.
export function sessionHeldInStorage(raw) {
  if (!raw) return false
  try {
    const p = JSON.parse(raw)
    return !!(p?.refresh_token || p?.currentSession?.refresh_token)
  } catch { return false }
}

export function hasStoredSession() {
  if (!authStorageKey || typeof localStorage === 'undefined') return false
  try { return sessionHeldInStorage(localStorage.getItem(authStorageKey)) }
  catch { return false }
}
