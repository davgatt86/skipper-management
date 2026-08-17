// netlify/functions/alert-digest.js
// ============================================================================
// The daily digest. One email per skipper, per boat, listing what came due.
//
// WHY THIS EXISTS
// The cron already generates alerts every morning, but generating an alert is
// not the same as telling anyone. The rows landed in `alerts` and sat there
// until somebody happened to open the app — which is exactly the hole the cron
// was built to close, moved one step along. This closes it.
//
// WHAT IT SENDS, AND WHAT IT DOES NOT
// Vessel and crew expiries only: passports, crew tickets, vessel certificates
// and going-home bonuses falling due. NOT market price alerts — those run every
// three hours and would turn a useful daily note into noise nobody reads, and a
// digest people stop reading is worse than no digest.
//
// Nothing is sent when there is nothing to say. A daily "all clear" trains the
// reader to ignore the sender.
//
// Alerts already read or dismissed in the app are skipped, so acting on one
// stops it being chased.
//
// SCHEDULE: see netlify.toml. Runs after the 06:00 UTC generation cron so it
// reports the same morning's alerts rather than yesterday's.
//
// SENDING: CloudMailin, over SMTP — the same vendor already handling inbound
// sales notes, so there is one account to manage rather than two.
//
// ENV (set these in Netlify, never in the repo — this file is on GitHub):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   already set
//   CLOUDMAILIN_SMTP_USERNAME                 from the CloudMailin dashboard
//   CLOUDMAILIN_SMTP_PASSWORD                 ditto (the API key)
//   DIGEST_FROM                               must be on a VERIFIED domain
//   SMTP_HOST / SMTP_PORT                     optional overrides
//
// Until a domain is verified, CloudMailin accepts the message and delivers
// nothing — that is its test mode, not a failure, and the log below will still
// read "sent". Verify the domain before believing a green run.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

// Expiries and stopped books. Market alerts are deliberately excluded — see
// above: they run every three hours and would drown this.
export const DIGEST_TYPES = [
  // running out
  'crew_passport', 'crew_cert', 'vessel_cert', 'crew_bonus',
  // stopped being written in, or falling due
  'log_engine', 'log_fuel', 'log_garbage', 'log_crewlist', 'maint_due',
]

/* Who gets it.
 *
 * Anyone aboard who keeps the records, plus the office. An expired liferaft
 * certificate is the skipper's to renew, but the engine log going quiet is the
 * engineer's to fix — sending only to the skipper would mean he has to relay it
 * to the man who can actually act.
 *
 * 'engineer' is the old name for 'officer' and is still honoured on any
 * unmigrated login. 'crew' is excluded: a deckhand can do nothing about any of
 * this and a daily list of other people's overdue paperwork is just noise. */
const DIGEST_ROLES = ['skipper', 'officer', 'engineer', 'office']

/* WHAT EACH ROLE MAY BE TOLD, which is not the same as who gets an email.
 *
 * An officer is denied every money table at the database — contracts,
 * payments, bonuses — and that denial is the entire reason the role exists
 * rather than handing out a skipper login. But `crew_bonus` alerts carry the
 * figures in the body:
 *
 *   "Eugene Tano — going-home bonus due now — Contract ends 02-03-2026.
 *    Bonus 4500.00, paid so far 2250.00, still to pay 2250.00."
 *
 * Mailing that to the engineer every morning walks straight around the
 * boundary. RLS cannot help here: the digest runs on the service-role key by
 * necessity, so the filter has to be written down, and this is it.
 *
 * The lists mirror `supabase/officer_role.sql` — an officer gets the logs, the
 * maintenance and the crew paperwork, and nothing to do with money.
 */
export const MONEY_TYPES = ['crew_bonus']
export const TYPES_FOR_ROLE = {
  skipper: DIGEST_TYPES,
  office: DIGEST_TYPES,                                        // bonuses are their job
  officer: DIGEST_TYPES.filter((t) => !MONEY_TYPES.includes(t)),
  engineer: DIGEST_TYPES.filter((t) => !MONEY_TYPES.includes(t)),   // legacy name
}
export const typesFor = (role) => TYPES_FOR_ROLE[role] || []

const SITE = process.env.SITE_URL || 'https://skippermanagement.co.uk'
// Must be on the domain verified in CloudMailin, or the message is accepted and
// quietly dropped. Overridable so a second boat's brand does not need a deploy.
/* No default sender, deliberately.
 *
 * A hardcoded fallback address is a quiet way to send from a domain that is not
 * verified — the message is accepted and dropped, and the log says "sent". If
 * DIGEST_FROM is not set, this refuses to send and says so, which is the honest
 * failure.
 *
 * It also stopped the literal appearing in the build output: DIGEST_FROM was
 * flagged as a secret in Netlify, and secret scanning fails a build that
 * contains the value. */
const FROM = process.env.DIGEST_FROM || ''
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.cloudmta.net'
const SMTP_PORT = Number(process.env.SMTP_PORT || 587)

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function renderEmail(fleetName, alerts) {
  const overdue = alerts.filter((a) => a.severity === 'warn')
  const soon = alerts.filter((a) => a.severity !== 'warn')

  const row = (a) => `
    <tr>
      <td style="padding:8px 0;border-top:1px solid #dfe3e2;vertical-align:top">
        <div style="font-weight:600;color:#0A1D26">${esc(a.title)}</div>
        <div style="font-size:13px;color:#5b6b72;margin-top:2px">${esc(a.body)}</div>
      </td>
    </tr>`

  const section = (label, list, colour) => list.length ? `
    <p style="margin:22px 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${colour};font-weight:700">
      ${label} — ${list.length}
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${list.map(row).join('')}</table>` : ''

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#ECEFEE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0A1D26">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;padding:24px">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#1749A8;font-weight:700">Skipper Management</div>
    <h1 style="margin:6px 0 2px;font-size:20px">${esc(fleetName)}</h1>
    <p style="margin:0;color:#5b6b72;font-size:14px">
      ${alerts.length} ${alerts.length === 1 ? 'thing needs' : 'things need'} attention.
    </p>
    ${section('Expired or overdue', overdue, '#C2342A')}
    ${section('Falling due', soon, '#A97614')}
    <p style="margin:26px 0 0">
      <a href="${SITE}/alerts" style="background:#1749A8;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;display:inline-block;font-weight:600;font-size:14px">Open the alerts page</a>
    </p>
    <p style="margin:20px 0 0;font-size:12px;color:#8a9499">
      Sent because these fell due on your boat. Marking one read in the app stops it appearing here.
      Market price alerts are not included — they are on the Alerts page.
    </p>
  </div>
</body></html>`
}

/* One connection for the whole run, not one per skipper.
 *
 * Opening an SMTP session costs a TLS handshake and an AUTH round trip, and
 * there is one message per boat. `pool` keeps a single connection open across
 * them, which matters because a Netlify function is billed by the second and
 * dies when it returns. */
let transport = null
function getTransport() {
  if (transport) return transport
  const user = process.env.CLOUDMAILIN_SMTP_USERNAME
  const pass = process.env.CLOUDMAILIN_SMTP_PASSWORD
  if (!user || !pass) return null
  transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    // 587 is STARTTLS, not implicit TLS. `secure: false` here means "start
    // plain, then upgrade" — `requireTLS` is what makes the upgrade mandatory,
    // so the credentials are never sent in the clear.
    secure: false,
    requireTLS: true,
    auth: { user, pass },
    pool: true,
    maxConnections: 1,
  })
  return transport
}

async function sendEmail(to, subject, html) {
  const t = getTransport()
  if (!t) return { skipped: 'CLOUDMAILIN_SMTP_USERNAME / _PASSWORD not set' }
  if (!FROM) return { skipped: 'DIGEST_FROM not set — refusing to guess a sender' }
  try {
    await t.sendMail({ from: FROM, to, subject, html })
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}

export const handler = async () => {
  const URL = process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!URL || !SERVICE_KEY) return { statusCode: 500, body: 'missing supabase env' }
  const svc = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Outstanding expiry alerts, oldest first. Read or dismissed ones are gone:
  // acting on it in the app is what stops it being chased.
  const { data: alerts, error: ae } = await svc
    .from('alerts')
    .select('id, fleet_id, type, severity, title, body, created_at')
    .in('type', DIGEST_TYPES)
    .is('read_at', null)
    .is('dismissed_at', null)
    .order('severity', { ascending: true })
    .order('created_at', { ascending: true })
  if (ae) return { statusCode: 500, body: `alerts: ${ae.message}` }

  if (!alerts?.length) return { statusCode: 200, body: 'nothing outstanding — no mail sent' }

  const byFleet = new Map()
  for (const a of alerts) {
    if (!byFleet.has(a.fleet_id)) byFleet.set(a.fleet_id, [])
    byFleet.get(a.fleet_id).push(a)
  }

  const [{ data: fleets }, { data: users }] = await Promise.all([
    svc.from('fleets').select('id, name'),
    svc.from('app_users').select('email, display_name, fleet_id, role').in('role', DIGEST_ROLES),
  ])
  const fleetName = Object.fromEntries((fleets || []).map((f) => [f.id, f.name]))

  const results = []
  for (const [fleetId, list] of byFleet) {
    const to = (users || []).filter((u) => u.fleet_id === fleetId && u.email)
    if (!to.length) { results.push(`${fleetName[fleetId] || fleetId}: nobody to send to`); continue }
    const boat = fleetName[fleetId] || 'Your boat'

    /* The email is built PER RECIPIENT, not once per fleet, because what an
     * officer may be told is narrower than what the skipper may. Rendering one
     * message and posting it to everybody is how the bonus figures reached the
     * engineer. */
    for (const u of to) {
      const allowed = typesFor(u.role)
      const mine = list.filter((a) => allowed.includes(a.type))
      // Nothing this reader can act on: say nothing. A digest that arrives
      // empty teaches people to stop opening it.
      if (!mine.length) { results.push(`${u.email}: nothing for a ${u.role}`); continue }
      const overdue = mine.filter((a) => a.severity === 'warn').length
      const subject = overdue
        ? `${boat} — ${overdue} overdue, ${mine.length} in total`
        : `${boat} — ${mine.length} falling due`
      const r = await sendEmail(u.email, subject, renderEmail(boat, mine))
      results.push(`${u.email} (${u.role}): ${r.ok ? `sent ${mine.length}` : r.skipped || r.error}`)
    }
  }

  // Close the pooled connection, or the function holds it open until the
  // runtime kills it and CloudMailin logs a dropped session every morning.
  if (transport) { transport.close(); transport = null }

  return { statusCode: 200, body: results.join('\n') || 'nothing to send' }
}
