// netlify/functions/ingest-departures.js
// ============================================================================
// Inbound-email webhook for MarineTraffic PORT NOTIFICATION alerts.
// Turns "<VESSEL> Departed from Port <PORT>" emails into rows in
// vessel_departures, which feeds the Peterhead Market Forecast.
//
// Why this replaces the GFW GitHub Action:
//   • The email states the vessel TYPE ("Fishing") and LENGTH ("LOA: 29 m")
//     directly, so we can drop ferries, supply boats and small inshore boats
//     with a simple filter — no name-whitelist needed.
//   • MarineTraffic pushes the moment a boat leaves; no polling, no lag games.
//   • Add another port = add the alert in MarineTraffic. No code change; the
//     port is read from each email.
//
// ── Setup ───────────────────────────────────────────────────────────────────
//   1. CloudMailin: add an address/route whose target (POST, JSON) is
//        https://skippermanagement.co.uk/.netlify/functions/ingest-departures?key=<INGEST_SECRET>
//   2. MarineTraffic → Notifications: set that CloudMailin address as the
//      recipient for your port departure alerts.
//
// ── Env vars (Netlify → Site settings → Environment variables) ──────────────
//   SUPABASE_URL                 https://fbdfskjojgatsgmvxozo.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service_role key
//   INGEST_SECRET                the same secret used by the other ingest fn
//   FORECAST_FLEET_ID            (optional) defaults to AUDACIOUS BF83 fleet
//   FORECAST_MIN_LOA_M           (optional) minimum vessel length, default 15
// ============================================================================

import { createClient } from '@supabase/supabase-js'

const FLEET_ID  = process.env.FORECAST_FLEET_ID || '00000000-0000-0000-0000-000000000001'
const MIN_LOA_M = Number(process.env.FORECAST_MIN_LOA_M || 15)   // metres — tune to taste

const ok = (b) => ({ statusCode: 200, body: typeof b === 'string' ? b : JSON.stringify(b) })

// Flatten an HTML email (or pass-through plain text) to a single spaced string.
const toText = (s) => String(s || '')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
  .replace(/&deg;/gi, '°').replace(/&#39;|&rsquo;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim()

// Pull the useful fields out of one MarineTraffic notification.
function parseAlert(text) {
  const t = toText(text)

  // "<VESSEL> departed from Port <PORT> at <local> (<YYYY-MM-DD HH:MM> UTC)"
  const head = t.match(/NOTIFICATION\s+(.+?)\s+(departed|arrived)\s+(?:from|at)\s+Port\s+(.+?)\s+at\s+\d{4}-\d{2}-\d{2}/i)
  if (!head) return null
  const vessel = head[1].replace(/\s+/g, ' ').trim().toUpperCase()
  const event  = head[2].toLowerCase()
  const port   = head[3].replace(/\s+/g, ' ').trim()

  // Exact UTC stamp, e.g. "(2026-07-05 13:37 UTC)" or "Time: 2026-07-05 13:37 UTC"
  const tm = t.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*UTC/i)
  if (!tm) return null
  const date = tm[1]
  const departedAt = `${tm[1]}T${tm[2]}:00Z`

  // Vessel type sits immediately before "Flag:" in the vessel block.
  const isFishing = /\b(fishing(?:\s+vessel)?|trawler)\b\s+Flag:/i.test(t) || /\b(fishing|trawler)\b/i.test(t.split(/Vessel:/i).pop() || '')
  // Length overall, e.g. "LOA: 29 m"
  const loaM = (() => { const m = t.match(/LOA:\s*(\d+(?:\.\d+)?)\s*m/i); return m ? Number(m[1]) : null })()
  const mmsi = (() => { const m = t.match(/MMSI:\s*(\d+)/i); return m ? m[1] : null })()

  return { vessel, event, port, date, departedAt, isFishing, loaM, mmsi }
}

export const handler = async (event) => {
  const key = (event.queryStringParameters && event.queryStringParameters.key) || ''
  if (!process.env.INGEST_SECRET || key !== process.env.INGEST_SECRET) {
    return { statusCode: 403, body: 'forbidden' }
  }

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return { statusCode: 400, body: 'bad json' } }

  // Light source check — the ?key already gates it; return 200 so CloudMailin
  // doesn't retry a non-MarineTraffic message.
  const hay = (JSON.stringify(body.envelope || {}) + ' ' + JSON.stringify(body.headers || {})).toLowerCase()
  if (!hay.includes('marinetraffic')) {
    return ok({ skipped: 'not a marinetraffic email' })
  }

  const raw = body.plain || body.html || ''
  const a = parseAlert(raw)
  if (!a) return ok({ skipped: 'could not parse alert' })

  // ── Filter to real fishing vessels ────────────────────────────────────────
  if (a.event !== 'departed') return ok({ skipped: 'not a departure', vessel: a.vessel })
  if (!a.isFishing)           return ok({ skipped: 'not a fishing vessel', vessel: a.vessel })
  if (a.loaM != null && a.loaM < MIN_LOA_M)
    return ok({ skipped: `under ${MIN_LOA_M}m`, vessel: a.vessel, loa: a.loaM })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const row = {
    fleet_id: FLEET_ID,
    vessel_name: a.vessel,
    departure_port: a.port,
    departure_date: a.date,
    departed_at: a.departedAt,
    source: 'marinetraffic',
  }
  const { data, error } = await supabase.from('vessel_departures')
    .upsert(row, { onConflict: 'fleet_id,vessel_name,departure_date', ignoreDuplicates: true })
    .select('id')
  if (error) { console.error('ingest-departures FAILED', error.message, row); return { statusCode: 500, body: error.message } }

  const inserted = (data || []).length
  console.log('ingest-departures OK', JSON.stringify({ ...row, loa: a.loaM, mmsi: a.mmsi, inserted }))
  return ok({ vessel: a.vessel, port: a.port, date: a.date, loa: a.loaM, inserted })
}
