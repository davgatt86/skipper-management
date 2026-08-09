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
// ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (already set),
//      RESEND_API_KEY   — must be added before anything is actually sent
//      DIGEST_FROM      — optional, defaults below; must be a verified sender
// ============================================================================

import { createClient } from '@supabase/supabase-js'

// Only the expiry stream. Market alerts are deliberately excluded — see above.
const DIGEST_TYPES = ['crew_passport', 'crew_cert', 'vessel_cert', 'crew_bonus']

const SITE = process.env.SITE_URL || 'https://skipper-management.netlify.app'
const FROM = process.env.DIGEST_FROM || 'Skipper Management <alerts@skipper-management.app>'

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

async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY
  if (!key) return { skipped: 'RESEND_API_KEY not set' }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  })
  if (!res.ok) return { error: `${res.status} ${await res.text()}` }
  return { ok: true }
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
    // Skippers only. An officer keeps the logs but chasing a certificate is the
    // skipper's job, and a digest to somebody who cannot act on it is noise.
    svc.from('app_users').select('email, display_name, fleet_id, role').eq('role', 'skipper'),
  ])
  const fleetName = Object.fromEntries((fleets || []).map((f) => [f.id, f.name]))

  const results = []
  for (const [fleetId, list] of byFleet) {
    const to = (users || []).filter((u) => u.fleet_id === fleetId && u.email)
    if (!to.length) { results.push(`${fleetName[fleetId] || fleetId}: no skipper with an email`); continue }
    const overdue = list.filter((a) => a.severity === 'warn').length
    const subject = overdue
      ? `${fleetName[fleetId] || 'Your boat'} — ${overdue} overdue, ${list.length} in total`
      : `${fleetName[fleetId] || 'Your boat'} — ${list.length} falling due`
    const html = renderEmail(fleetName[fleetId] || 'Your boat', list)
    for (const u of to) {
      const r = await sendEmail(u.email, subject, html)
      results.push(`${u.email}: ${r.ok ? 'sent' : r.skipped || r.error}`)
    }
  }

  return { statusCode: 200, body: results.join('\n') || 'nothing to send' }
}
