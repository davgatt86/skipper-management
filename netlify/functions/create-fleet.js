// netlify/functions/create-fleet.js
// ============================================================================
// OWNER-ONLY. Creates a whole new boat (tenant) in one call:
//   1. a Supabase auth login for the new skipper (email + temp password),
//   2. a fleets row,
//   3. their app_users row (role=skipper, is_owner=false, in the new fleet),
//   4. a settings row copied from YOUR fleet as a starting point.
// This is the in-app replacement for new_fleet_onboarding.sql — no dashboard,
// no SQL editor.
//
// Security: the caller must be signed in AND flagged is_owner in app_users.
// Owner status is read from the DATABASE by the caller's verified user id —
// never taken from the request — so a normal skipper can't call this to mint
// fleets. Run supabase/add_boat_owner.sql once to add the is_owner column and
// flag yourself.
//
// Env vars (already set for the ingest function):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// The app calls this same-origin with the signed-in user's access token:
//   fetch('/.netlify/functions/create-fleet', {
//     method:'POST',
//     headers:{ Authorization:`Bearer ${access_token}`, 'Content-Type':'application/json' },
//     body: JSON.stringify({ vessel, email, displayName, tempPassword })
//   })
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import CorsModule from './cors.cjs'
const { corsHeaders, preflight } = CorsModule


const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) })

function makeTempPassword() {
  // readable-ish temp password the owner can hand over, e.g. Boat-7f3a-21c9
  const a = Math.random().toString(16).slice(2, 6)
  const b = Math.random().toString(16).slice(2, 6)
  return `Boat-${a}-${b}`
}

const handleRequest = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const URL = process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!URL || !SERVICE_KEY) return json(500, { error: 'server missing supabase env' })
  const svc = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } })

  // ---- verify the caller is a signed-in OWNER ----
  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json(401, { error: 'not signed in' })
  const { data: who, error: ue } = await svc.auth.getUser(token)
  if (ue || !who?.user) return json(401, { error: 'session not valid — sign in again' })
  const { data: me } = await svc.from('app_users')
    .select('id, is_owner, fleet_id').eq('id', who.user.id).maybeSingle()
  if (!me || me.is_owner !== true) return json(403, { error: 'only the site owner can add a boat' })

  // ---- inputs ----
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'bad json' }) }
  const vessel = String(body.vessel || '').trim()
  const email = String(body.email || '').trim().toLowerCase()
  const displayName = String(body.displayName || '').trim()
  const tempPassword = String(body.tempPassword || '').trim() || makeTempPassword()
  if (!vessel) return json(422, { error: 'vessel name required' })
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json(422, { error: 'a valid skipper email is required' })
  if (!displayName) return json(422, { error: 'skipper display name required' })

  // ---- guard against duplicates ----
  const { data: existsUser } = await svc.from('app_users').select('id').eq('email', email).maybeSingle()
  if (existsUser) return json(409, { error: `${email} is already a user` })

  // ---- create, with best-effort rollback if a later step fails ----
  let newUid = null, fleetId = null
  try {
    const { data: created, error: ce } = await svc.auth.admin.createUser({
      email, password: tempPassword, email_confirm: true,
    })
    if (ce) return json(409, { error: `could not create login: ${ce.message}` })
    newUid = created.user.id

    fleetId = (globalThis.crypto?.randomUUID?.() ) || undefined
    const fleetRow = fleetId ? { id: fleetId, name: vessel } : { name: vessel }
    const { data: fleet, error: fe } = await svc.from('fleets').insert(fleetRow).select('id').single()
    if (fe) throw new Error(`fleet: ${fe.message}`)
    fleetId = fleet.id

    const { error: ae } = await svc.from('app_users').insert({
      id: newUid, email, display_name: displayName, role: 'skipper', fleet_id: fleetId, is_owner: false,
    })
    if (ae) throw new Error(`app_users: ${ae.message}`)

    // settings: copy the owner's fleet settings as a starting point, else defaults
    const { data: tmpl } = await svc.from('settings').select('*').eq('fleet_id', me.fleet_id).maybeSingle()
    let settingsRow
    if (tmpl) {
      const { id, fleet_id, created_at, updated_at, ...rest } = tmpl
      settingsRow = { fleet_id: fleetId, ...rest }
    } else {
      settingsRow = { fleet_id: fleetId, flat_rate_per_month: 350, box_rate: 0.15, ghb_first_half_pct: 0.5, currency: '£' }
    }
    const { error: se } = await svc.from('settings').insert(settingsRow)
    if (se) throw new Error(`settings: ${se.message}`)

    return json(200, {
      ok: true, vessel, email, fleet_id: fleetId, tempPassword,
      message: `${vessel} created. Give the skipper their email and this temporary password — they change it in the app under Change password.`,
    })
  } catch (err) {
    // roll back what we made so a half-built boat doesn't linger
    try { if (fleetId) await svc.from('fleets').delete().eq('id', fleetId) } catch { /* cascades app_users/settings if FK set; otherwise best-effort */ }
    try { if (newUid) await svc.from('app_users').delete().eq('id', newUid) } catch { /* ignore */ }
    try { if (newUid) await svc.auth.admin.deleteUser(newUid) } catch { /* ignore */ }
    return json(500, { error: `could not finish creating the boat (${err.message}). Nothing was left half-made.` })
  }
}

// CORS is only needed by the native shell — see netlify/functions/cors.cjs.
// Wrapping once means every return path carries the headers, including the
// error returns, which is where a hand-edited version would have missed them.
export const handler = async (event) => {
  const pre = preflight(event)
  if (pre) return pre
  const res = await handleRequest(event)
  return { ...res, headers: { ...(res.headers || {}), ...corsHeaders(event) } }
}
