// Ask for a password reset link.
//
// WHY THIS FUNCTION EXISTS AT ALL, rather than a one-line call to
// supabase.auth.resetPasswordForEmail() from the browser:
//
//   1. SUPABASE'S BUILT-IN MAILER HAS NEVER SENT A MESSAGE ON THIS PROJECT.
//      Checked Sep 2026: recovery_sent_at AND confirmation_sent_at are null on
//      all 18 accounts, because every one was made by manage-users.js with
//      createUser({ password, email_confirm: true }). The built-in sender is
//      also two messages an hour from a supabase.io address, which is a spam
//      folder waiting to happen. `generateLink` MAKES the link and sends
//      nothing, so we post it down the CloudMailin SMTP path the alert digest
//      already uses -- a verified domain, and a route that is known to work.
//
//   2. THE DEMO LOGIN MUST NOT BE RESETTABLE. It is one shared account whose
//      password David hands out. A visitor resetting it locks out every
//      visitor after him, and only the Supabase dashboard could undo that.
//
//   3. THE ANSWER MUST NOT SAY WHETHER THE ACCOUNT EXISTS. Every vessel here
//      is a separate business. An endpoint that replies differently for a real
//      address is a way to ask "does this fisherman have an account", and it
//      needs nothing but a browser.
//
// Env (Netlify, never the repo):
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//   CLOUDMAILIN_SMTP_USERNAME / CLOUDMAILIN_SMTP_PASSWORD   as the digest
//   DIGEST_FROM                     the verified sender, shared with the digest
//   SITE_URL                        optional; where the link lands
//
// ONE DASHBOARD STEP GOES WITH THIS: the redirect below has to be in
// Authentication -> URL Configuration -> Redirect URLs, or Supabase refuses to
// bounce the user back and the link dies on its own verify page.

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import CorsModule from './cors.cjs'
const { corsHeaders, preflight } = CorsModule

const SITE = (process.env.SITE_URL || 'https://skippermanagement.co.uk').replace(/\/+$/, '')
const REDIRECT = `${SITE}/reset-password`
const FROM = process.env.DIGEST_FROM || ''
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.cloudmta.net'
const SMTP_PORT = Number(process.env.SMTP_PORT || 587)

/* Long enough that nobody can bury a skipper's inbox, short enough that a man
   who deleted the first one by accident is not stuck for the afternoon. */
const COOLDOWN_MINUTES = 10

/* THE SAME ANSWER EVERY TIME. Sent, refused, throttled, no such account, or
   the mailer down -- the caller is told the same thing, because any difference
   is an oracle. What actually happened is written to the table instead, which
   is where it is useful and where only the service key can read it. */
export const GENERIC = 'If that address is on an account, a reset link is on its way. '
  + 'It can take a few minutes and may land in junk mail. '
  + 'If nothing arrives, contact the office — some accounts have to be reset by hand.'

/* Only an address of this shape is looked up at all. Deliberately plain: it is
   a cheap way to throw out obvious rubbish before touching the database, and
   NOT a claim about which addresses are deliverable. */
export const looksLikeEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || ''))

/**
 * WHO GETS A LINK — the whole boundary, in one pure function.
 *
 * Extracted for the same reason as `planDigest` in alert-digest.js: the thing
 * worth testing is the decision about who receives mail, and it cannot be
 * tested through a handler that opens an SMTP connection. Four refusals, and
 * the caller is told none of them apart.
 */
export function decideReset({ email, user, recentSend, mailerReady }) {
  if (!looksLikeEmail(email)) return { send: false, outcome: 'no account' }
  // A refusal by the mailer is checked FIRST and for everybody. Checked after
  // the lookup it would only ever fire on real accounts, which turns an
  // outage into the very oracle the generic answer exists to close.
  if (!mailerReady) return { send: false, outcome: 'send failed' }
  if (!user) return { send: false, outcome: 'no account' }
  // THE SHARED DEMO LOGIN. One account, its password handed out to visitors;
  // a visitor resetting it locks out every visitor after him and only the
  // Supabase dashboard could undo that.
  if (user.fleets?.is_demo) return { send: false, outcome: 'demo' }
  // Only a request that actually SENT starts a cooldown -- three refusals in a
  // row must not lock a man out of his own reset.
  if (recentSend) return { send: false, outcome: 'cooldown' }
  return { send: true, outcome: 'sent' }
}

let transport = null
function getTransport() {
  if (transport) return transport
  const user = process.env.CLOUDMAILIN_SMTP_USERNAME
  const pass = process.env.CLOUDMAILIN_SMTP_PASSWORD
  if (!user || !pass) return null
  transport = nodemailer.createTransport({
    // 587 is STARTTLS, not implicit TLS: start plain, then upgrade, and
    // `requireTLS` is what makes the upgrade mandatory so the credentials are
    // never sent in the clear. Same pairing as alert-digest.js.
    host: SMTP_HOST, port: SMTP_PORT, secure: false, requireTLS: true,
    auth: { user, pass },
  })
  return transport
}

const json = (code, body, event) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', ...corsHeaders(event) },
  body: JSON.stringify(body),
})

export const handler = async (event) => {
  const pre = preflight(event)
  if (pre) return pre
  if ((event.httpMethod || '').toUpperCase() !== 'POST') return json(405, { error: 'POST only' }, event)

  const URL_ = process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!URL_ || !SERVICE_KEY) return json(500, { error: 'missing supabase env' }, event)
  const svc = createClient(URL_, SERVICE_KEY, { auth: { persistSession: false } })

  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { /* generic answer below */ }
  const email = String(body.email || '').trim().toLowerCase()
  const ip = event.headers?.['x-nf-client-connection-ip'] || event.headers?.['client-ip'] || null

  const record = async (outcome, sent = false) => {
    /* Never let the bookkeeping decide the answer: if this insert fails the
       caller still gets the generic reply, because the alternative is telling
       somebody their reset failed when the link is already in their inbox. */
    try {
      await svc.from('password_reset_requests').insert({ email, sent, outcome, ip })
    } catch { /* recorded nowhere, but the mail still went */ }
    return json(200, { ok: true, message: GENERIC }, event)
  }

  const mailerReady = !!getTransport() && !!FROM

  /* Is this an account, and is it one we may reset?
     `app_users` is the app's own register — an auth user without a row there
     cannot use the app at all, so it is the right list to ask.

     `.eq`, NEVER `.ilike`. ilike takes the caller's text as a LIKE pattern, so
     `%` and `_` are wildcards in it: `sandymcleman@btinternet.co%` would have
     matched a real account and fired a reset into that man's inbox from an
     address only half known, and a bare `%` would have matched all eighteen.
     One address on this project already contains an underscore. Every stored
     email is lower case (checked), and the input is lowered above, so an exact
     match is both correct and the only safe comparison. */
  let user = null
  if (looksLikeEmail(email) && mailerReady) {
    const { data, error: lookupErr } = await svc
      .from('app_users')
      .select('id, email, display_name, role, fleet_id, fleets(name, is_demo)')
      .eq('email', email)
      .maybeSingle()
    if (lookupErr) return record('send failed')
    user = data
  }

  /* THE COOLDOWN, off our own record rather than auth.users.recovery_sent_at —
     we send the mail ourselves, so whether Supabase moves that column is
     something nobody here has watched, and an unwatched thing is not a
     control. */
  let recentSend = false
  if (user) {
    const since = new Date(Date.now() - COOLDOWN_MINUTES * 60_000).toISOString()
    const { data: recent } = await svc
      .from('password_reset_requests')
      .select('id')
      .eq('email', email)
      .eq('sent', true)
      .gte('requested_at', since)
      .limit(1)
    recentSend = !!recent?.length
  }

  const call = decideReset({ email, user, recentSend, mailerReady })
  if (!call.send) {
    if (call.outcome === 'send failed') console.error('password reset: mailer not configured')
    return record(call.outcome)
  }

  /* MAKES THE LINK, SENDS NOTHING. We do the sending. */
  const { data: link, error: linkErr } = await svc.auth.admin.generateLink({
    type: 'recovery',
    email: user.email,
    options: { redirectTo: REDIRECT },
  })
  const action = link?.properties?.action_link
  if (linkErr || !action) {
    console.error('generateLink failed', linkErr?.message || 'no action_link')
    return record('send failed')
  }

  try {
    const t = getTransport()
    /* TO THE ADDRESS ON THE ACCOUNT, never to what was typed. They match here
       by definition, but writing it this way means a future lookup that
       matches on something looser cannot post a reset link to an address the
       account does not own. */
    await t.sendMail({
      from: FROM,
      to: user.email,
      subject: 'Reset your Skipper Management password',
      text: plain(user.display_name, action),
      html: html(user.display_name, action),
    })
  } catch (e) {
    console.error('password reset send failed:', e.message)
    return record('send failed')
  }

  return record('sent', true)
}

/* THE LINK IS A CREDENTIAL. It is never logged, never returned to the caller,
   and goes in the body of one message to one address. */
function plain(name, link) {
  return `${name ? `${name},` : 'Hello,'}

Somebody asked to reset the password on your Skipper Management account.

Open this link to set a new one:
${link}

It is good for one hour and can only be used once. If you did not ask for it
you can ignore this — your password has not changed.
`
}

function html(name, link) {
  const who = name ? `${escapeHtml(name)},` : 'Hello,'
  return `<div style="font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#0A1D26;max-width:34rem">
  <p style="font:600 13px/1 system-ui;letter-spacing:.08em;text-transform:uppercase;color:#5d6b70">Skipper Management</p>
  <p>${who}</p>
  <p>Somebody asked to reset the password on your account.</p>
  <p style="margin:1.4rem 0">
    <a href="${link}" style="background:#1749A8;color:#fff;text-decoration:none;padding:.7rem 1.2rem;border-radius:4px;display:inline-block;font-weight:600">Set a new password</a>
  </p>
  <p style="font-size:13px;color:#5d6b70">
    The link is good for one hour and can only be used once.
    If you did not ask for it you can ignore this message — your password has not changed.
  </p>
  <p style="font-size:12px;color:#5d6b70;word-break:break-all">${link}</p>
</div>`
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
