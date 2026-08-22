import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, hasStoredSession } from './supabaseClient'

const AuthContext = createContext(null)

/* Who is signed in, and how the app copes when it cannot ask.
 *
 * Two things break offline if they are not handled here, and both of them make
 * the offline log capture useless:
 *
 * 1. THE APP_USERS QUERY NEEDS THE NETWORK. Open the app at sea and it fails,
 *    `appUser` is null, and `keepsLogs(null)` is false — so the engineer cannot
 *    write the very entries the outbox exists to hold. Worse, `fleet_id` would
 *    be undefined on any row he did manage to create, and that row would be
 *    refused by RLS when it finally synced. So the record is cached.
 *
 * 2. AN EXPIRED ACCESS TOKEN READS AS A SIGNED-OUT USER. auth-js returns
 *    `session: null` when the token has expired and the refresh cannot reach
 *    the server — but it leaves storage alone, because a dropped connection is
 *    not a refused token. Treating that as signed out sends a man an hour into
 *    a trip to a login page that needs the network he has not got.
 *
 * `held` is that second state: signed in, cannot prove it at the moment. The
 * app stays open, reads come from cache and writes queue.
 *
 * The cached record is for RENDERING ONLY. Anyone can edit their own
 * localStorage and claim to be a skipper; it would change which menu items they
 * see and nothing else, because RLS decides what data exists. Never make a
 * security decision from it — see supabase/engineer_role.sql.
 */
const CACHE_KEY = 'skipper.appUser'

function readCachedUser() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function writeCachedUser(u) {
  try {
    if (u) localStorage.setItem(CACHE_KEY, JSON.stringify(u))
    else localStorage.removeItem(CACHE_KEY)
  } catch { /* private mode, or full — not worth failing sign-in over */ }
}

export function AuthProvider({ children }) {
  // BOOT FROM CACHE, DON'T WAIT ON THE NETWORK.
  //
  // getSession() has to attempt a token refresh when the access token has
  // expired, and auth-js retries that with backoff — measured at TWENTY SECONDS
  // against an unreachable server. Blocking the first paint on it means an
  // engineer opening the app at sea stares at "Loading…" every single time.
  //
  // So if storage says he is signed in and we have his cached record, render
  // immediately and let getSession() catch up. `presumed` covers that gap:
  // routing trusts it, but the "not reaching the office" banner waits for
  // `held`, which is only set once a refresh has actually been tried and
  // failed — otherwise the banner would flash on every normal load.
  const bootUser = readCachedUser()
  const bootPresumed = !!(bootUser && hasStoredSession())

  const [session, setSession] = useState(null)
  const [appUser, setAppUser] = useState(bootUser)
  const [held, setHeld] = useState(false)
  const [presumed, setPresumed] = useState(bootPresumed)
  const [loading, setLoading] = useState(!bootPresumed)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      applySession(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Only an explicit sign-out clears the cached identity. SIGNED_OUT is
      // also what auth-js emits when it genuinely gives up on a token, which is
      // the one case where we do want the login screen.
      if (event === 'SIGNED_OUT') {
        writeCachedUser(null)
        setSession(null); setAppUser(null); setHeld(false); setPresumed(false); setLoading(false)
        return
      }
      applySession(session)
    })

    // Coming back into signal: ask for the session again, which drives the
    // refresh, which un-holds the app and lets the outbox flush.
    const onOnline = () => { supabase.auth.getSession().then(({ data }) => applySession(data.session)) }
    window.addEventListener('online', onOnline)

    return () => { subscription.unsubscribe(); window.removeEventListener('online', onOnline) }
  }, [])

  // Called once getSession() has actually reported back, so from here on we
  // know rather than presume.
  function applySession(session) {
    setPresumed(false)
    if (session?.user) {
      setSession(session); setHeld(false)
      loadAppUser(session.user.id)
      return
    }
    // No usable session. Is that a sign-out, or just no signal?
    const cached = readCachedUser()
    if (hasStoredSession() && cached) {
      setSession(null); setHeld(true); setAppUser(cached); setLoading(false)
      return
    }
    setSession(null); setHeld(false); setAppUser(null); setLoading(false)
  }

  async function loadAppUser(userId) {
    const cached = readCachedUser()
    // Show the cached record straight away so the page is usable before — and
    // if — the query comes back.
    if (cached && cached.id === userId) { setAppUser(cached); setLoading(false) }
    else setLoading(true)

    const { data, error } = await supabase
      .from('app_users')
      .select('*, crew(full_name), fleets(is_demo)')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      // Keep whatever we had. Falling back to null here is what used to leave
      // an engineer unable to write his own logs.
      console.error('Error loading app_user:', error)
      if (!cached) setAppUser(null)
      setLoading(false)
      return
    }
    /* Flattened onto the record itself, so callers ask `appUser.is_demo`
     * rather than reaching through the join — and so the CACHED copy carries it
     * too, which matters because that cache is what the app boots from at sea. */
    const me = data ? { ...data, is_demo: !!data.fleets?.is_demo } : null
    if (me) writeCachedUser(me)
    setAppUser(me)
    setLoading(false)
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signOut() {
    writeCachedUser(null)
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{
      session, appUser, loading, held,
      // Routing trusts `presumed` so the app opens instantly offline; the
      // banner does not, so it never flashes on a normal load.
      signedIn: !!session || held || presumed,
      signIn, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
