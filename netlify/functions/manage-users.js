// netlify/functions/manage-users.js
// ============================================================================
// SKIPPER-ONLY, per-fleet user management. One function, three actions:
//   { action: 'list' }                                   -> users in YOUR fleet
//   { action: 'create', email, displayName, role, crewId?, tempPassword? }
//   { action: 'delete', userId }
//
// Security: the caller must be signed in AND role='skipper'. Their fleet is
// read from the DATABASE by their verified user id — never from the request —
// so a skipper can only ever see and change users inside their own boat. New
// users are limited to office / crew / viewer / officer (a skipper can't mint
// another skipper or an owner). Deletes are blocked for yourself, the owner, and
// any skipper, so the boat can't be left without its skipper or its host.
//
// Env (already set): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Called same-origin with the signed-in user's access token in Authorization.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import CorsModule from './cors.cjs'
const { corsHeaders, preflight } = CorsModule


const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) })
// 'officer' is an engineer or a mate: the logs, the maintenance record and the
// crew papers, but none of the money. Enforced by RLS in
// supabase/officer_role.sql rather than by this list. 'engineer' is the old
// name for the same role — still honoured on existing logins, no longer minted.
// 'cook' gets the stores list and nothing else — see supabase/cook_role.sql.
const CREATABLE_ROLES = ['office', 'crew', 'viewer', 'officer', 'cook']

function makeTempPassword() {
  const a = Math.random().toString(16).slice(2, 6)
  const b = Math.random().toString(16).slice(2, 6)
  return `Crew-${a}-${b}`
}

const handleRequest = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const URL = process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!URL || !SERVICE_KEY) return json(500, { error: 'server missing supabase env' })
  const svc = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } })

  // ---- verify caller is a signed-in SKIPPER ----
  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json(401, { error: 'not signed in' })
  const { data: who, error: ue } = await svc.auth.getUser(token)
  if (ue || !who?.user) return json(401, { error: 'session not valid — sign in again' })
  const { data: me } = await svc.from('app_users')
    .select('id, role, fleet_id, is_owner').eq('id', who.user.id).maybeSingle()
  if (!me) return json(403, { error: 'no account found' })
  if (me.role !== 'skipper') return json(403, { error: 'only the skipper can manage users' })
  const fleet = me.fleet_id

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'bad json' }) }
  const action = body.action

  // ---------------- LIST ----------------
  if (action === 'list') {
    const { data, error } = await svc.from('app_users')
      .select('id, email, display_name, role, is_owner, crew_id')
      .eq('fleet_id', fleet)
    if (error) return json(500, { error: error.message })
    const users = (data || []).sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
    return json(200, { users, me: me.id })
  }

  // ---------------- CREATE ----------------
  if (action === 'create') {
    const email = String(body.email || '').trim().toLowerCase()
    const displayName = String(body.displayName || '').trim()
    const role = String(body.role || '').trim()
    const crewId = body.crewId ? String(body.crewId) : null
    const tempPassword = String(body.tempPassword || '').trim() || makeTempPassword()

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json(422, { error: 'a valid email is required' })
    if (!displayName) return json(422, { error: 'display name required' })
    if (!CREATABLE_ROLES.includes(role)) return json(422, { error: `role must be one of: ${CREATABLE_ROLES.join(', ')}` })
    // `check_crew_id_role` on app_users: a 'crew' login must be tied to a crew
    // record, and every other role must NOT be. Say so in words here, or the
    // skipper gets the constraint name thrown at him.
    if (role === 'crew' && !crewId) return json(422, { error: 'a Crew login must be linked to a crew record — pick the crewman' })
    if (role !== 'crew' && crewId) return json(422, { error: `a ${role} login is not linked to a crew record` })

    const { data: dup } = await svc.from('app_users').select('id').eq('email', email).maybeSingle()
    if (dup) return json(409, { error: `${email} is already a user` })

    // if linking to a crew record, it must belong to this fleet
    if (crewId) {
      const { data: crewRow } = await svc.from('crew').select('id').eq('id', crewId).eq('fleet_id', fleet).maybeSingle()
      if (!crewRow) return json(422, { error: 'that crew record is not in your fleet' })
    }

    let newUid = null
    try {
      const { data: created, error: ce } = await svc.auth.admin.createUser({ email, password: tempPassword, email_confirm: true })
      if (ce) return json(409, { error: `could not create login: ${ce.message}` })
      newUid = created.user.id
      const { error: ae } = await svc.from('app_users').insert({
        id: newUid, email, display_name: displayName, role, fleet_id: fleet, is_owner: false,
        // MUST be null for every role except 'crew'. `check_crew_id_role` on
        // app_users enforces exactly that, and linking an officer to his crew
        // record was tried and rejected. He does not need it: the link only
        // exists so `crew_read_all` can show a crewman his OWN row, and an
        // officer reads the whole crew list anyway.
        crew_id: role === 'crew' ? crewId : null,
      })
      if (ae) throw new Error(ae.message)
      return json(200, {
        ok: true, email, role, tempPassword,
        message: `${displayName} added as ${role}. Give them their email and this temporary password — they change it under Change password.`,
      })
    } catch (err) {
      try { if (newUid) await svc.from('app_users').delete().eq('id', newUid) } catch { /* ignore */ }
      try { if (newUid) await svc.auth.admin.deleteUser(newUid) } catch { /* ignore */ }
      return json(500, { error: `could not finish adding the user (${err.message}). Nothing was left half-made.` })
    }
  }

  // ---------------- UPDATE ----------------
  // Roles and names were fixed at creation, so the only way to correct one was
  // to delete the login and make a new one — which is how a relief skipper ends
  // up filed as 'office' and stays there.
  if (action === 'update') {
    const userId = String(body.userId || '')
    if (!userId) return json(422, { error: 'userId required' })

    const { data: target } = await svc.from('app_users')
      .select('id, role, is_owner, fleet_id, display_name, crew_id').eq('id', userId).maybeSingle()
    if (!target) return json(404, { error: 'user not found' })
    if (target.fleet_id !== fleet) return json(403, { error: 'that user is not in your fleet' })

    const patch = {}
    if (body.displayName !== undefined) {
      const dn = String(body.displayName).trim()
      if (!dn) return json(422, { error: 'display name cannot be blank' })
      patch.display_name = dn
    }

    if (body.role !== undefined) {
      const role = String(body.role).trim()
      // Only the site owner may make somebody a skipper. An ordinary skipper
      // minting more skippers is how one compromised login becomes several.
      const allowed = me.is_owner ? [...CREATABLE_ROLES, 'skipper'] : CREATABLE_ROLES
      if (!allowed.includes(role)) {
        return json(422, {
          error: me.is_owner
            ? `role must be one of: ${allowed.join(', ')}`
            : `role must be one of: ${allowed.join(', ')} — only the site owner can make someone a skipper`,
        })
      }
      // Changing your own role is how you lock yourself out of this page.
      if (userId === me.id) return json(409, { error: "you can't change your own role" })
      if (target.is_owner) return json(403, { error: "the site owner's role can't be changed here" })

      // check_crew_id_role: 'crew' must carry a crew_id, everything else must not.
      const crewId = body.crewId ? String(body.crewId) : null
      if (role === 'crew') {
        const linkTo = crewId || target.crew_id
        if (!linkTo) return json(422, { error: 'a Crew login must be linked to a crew record — pick the crewman' })
        const { data: crewRow } = await svc.from('crew').select('id').eq('id', linkTo).eq('fleet_id', fleet).maybeSingle()
        if (!crewRow) return json(422, { error: 'that crew record is not in your fleet' })
        patch.crew_id = linkTo
      } else {
        patch.crew_id = null
      }
      patch.role = role
    }

    if (!Object.keys(patch).length) return json(422, { error: 'nothing to change' })

    const { error: ue2 } = await svc.from('app_users').update(patch).eq('id', userId)
    if (ue2) return json(500, { error: ue2.message })
    return json(200, { ok: true, updated: userId, patch })
  }

  // ---------------- DELETE ----------------
  if (action === 'delete') {
    const userId = String(body.userId || '')
    if (!userId) return json(422, { error: 'userId required' })
    if (userId === me.id) return json(409, { error: "you can't delete your own account" })

    const { data: target } = await svc.from('app_users')
      .select('id, role, is_owner, fleet_id, display_name').eq('id', userId).maybeSingle()
    if (!target) return json(404, { error: 'user not found' })
    if (target.fleet_id !== fleet) return json(403, { error: 'that user is not in your fleet' })
    if (target.is_owner) return json(403, { error: "the site owner can't be deleted here" })
    if (target.role === 'skipper') return json(403, { error: "a skipper can't be deleted here" })

    // remove the app_users row, then the auth login (leaves any crew/bonus record intact)
    const { error: de } = await svc.from('app_users').delete().eq('id', userId)
    if (de) return json(500, { error: de.message })
    try { await svc.auth.admin.deleteUser(userId) } catch { /* login removal best-effort */ }
    return json(200, { ok: true, deleted: userId, name: target.display_name || '' })
  }

  return json(422, { error: 'unknown action' })
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
