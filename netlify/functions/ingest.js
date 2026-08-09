// netlify/functions/ingest.js
// ============================================================================
// ONE inbound-email webhook for BOTH:
//   • Daily price sheets   -> shared market_* tables (every fleet reads them)
//   • Sales notes          -> sales_landings / sales_rows, routed to the FLEET
//                             of whoever forwarded the email
//
// It reads each PDF, decides whether it's a price sheet or a sales note, and
// files it accordingly — so the SAME CloudMailin address can carry both. No
// browser needs to be open.
//
// ── Why two kinds in one function ──────────────────────────────────────────
// CloudMailin posts every forwarded email to one URL. Telling them apart from
// the PDF text (not the address) means David can forward Don Fishing price
// sheets and Don Fishing sales notes from the same Gmail filter set, and the
// Danish lads can forward their fiskeauktion.dk sheets, all to one address.
//
// ── Routing (sales only) ───────────────────────────────────────────────────
// Sales notes are private to a boat, so they're filed into the FORWARDER's
// fleet. The forwarder's email is looked up in the `ingest_senders` table
// (run supabase/ingest_senders.sql). Unknown forwarder -> 422 bounce naming
// the addresses it saw, so you can add the right one. Price sheets feed the
// shared board, so they only require the forwarder to be a known sender.
//
// ── Netlify env vars (Site settings -> Environment variables) ──────────────
//   SUPABASE_URL                 https://fbdfskjojgatsgmvxozo.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    Supabase -> Project Settings -> API -> service_role
//   INGEST_SECRET                any long random string you invent
//   (ALLOWED_SENDER is NO LONGER used — the ingest_senders table is the gate)
//
// ── CloudMailin ────────────────────────────────────────────────────────────
//   Target (POST) URL:  https://<your-site>.netlify.app/.netlify/functions/ingest?key=<INGEST_SECRET>
//   Format:             JSON  (attachments delivered inline)
//
// ── Migrating from ingest-prices ───────────────────────────────────────────
//   ingest-prices.js is left in place, untouched, as a proven fallback. Once
//   you've health-checked /ingest, change CloudMailin's target URL from
//   .../ingest-prices?key=... to .../ingest?key=...  — that's the only switch.
//   If anything ever looks off, point it back; price handling here is the same
//   logic, lifted verbatim.
// ============================================================================

// pdf.js (v4) uses Promise.withResolvers, which only exists on Node 22+.
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
}

import { createClient } from '@supabase/supabase-js'
import { parseMarketFromDoc } from '../../src/lib/market/parseMarket.js'

// parse-core.cjs is the canonical sales-note parser, vendored here so the
// function can run it server-side. Imported statically so the Netlify/esbuild
// bundler inlines it (createRequire(import.meta.url) breaks once bundled to
// CommonJS — import.meta.url is undefined there). Keep this file identical to
// the copy hosted at fish-sales.netlify.app/parse-core.js — all parser fixes
// happen there, then this file is replaced with the same contents.
import ParseCoreModule from './parse-core.cjs'
const ParseCore = ParseCoreModule?.default ?? ParseCoreModule

const ok = (body) => ({ statusCode: 200, body: typeof body === 'string' ? body : JSON.stringify(body) })

// Same dedup scheme the app uses (src/lib/parseCore.js dedupKey).
function dedupKey(res) {
  const m = res.meta || {}
  return (res.market || '') + '|' + (m.vessel || '') + '|' + (m.saleNo || m.isoDate || res.filename || '')
}

// Which crew were aboard on a date, for the FORWARDER's fleet. Mirrors the
// app's aboardOnDate: crew on an active contract that day (self-employed have
// no contracts, so they're excluded), else on-boat contracted crew. Service
// role bypasses RLS, so we MUST filter by fleet_id ourselves.
async function aboardOnDate(supabase, fleetId, date) {
  const [ctRes, cRes] = await Promise.all([
    supabase.from('contracts').select('crew_id, start_date, end_date').eq('fleet_id', fleetId),
    supabase.from('crew').select('id, status, archived_at, crew_type').eq('fleet_id', fleetId),
  ])
  const crewRows = (cRes.data || []).filter(c => !c.archived_at)
  const live = new Set(crewRows.map(c => c.id))
  const ids = [...new Set((ctRes.data || [])
    .filter(ct => ct.start_date <= date && (!ct.end_date || date <= ct.end_date))
    .map(ct => ct.crew_id))].filter(id => live.has(id))
  if (ids.length) return ids
  return crewRows.filter(c => c.status === 'on_boat' && c.crew_type !== 'self_employed').map(c => c.id)
}

// Feed a sale's box total into the crew-bonus `landings` row for that date so
// box bonus picks it up automatically — the server-side twin of the app's
// feedCrewLanding. Same guards: never add a note's boxes twice (sales_keys),
// leave locked (closed-month) landings alone, sum across joint-trip notes on
// the same date, and self-heal a landing that lost its crew. All reads are
// fleet-scoped and all writes set fleet_id explicitly. Failures here are
// returned as a note, never thrown — the sale itself is already saved.
async function feedCrewLanding(supabase, fleetId, createdBy, date, boxes, key) {
  if (!date || !boxes) return ''
  const { data: existing, error } = await supabase.from('landings')
    .select('id, boxes, locked, sales_keys, landing_crew(crew_id)')
    .eq('fleet_id', fleetId).eq('landing_date', date)
  if (error) return ` (crew landing: ${error.message})`
  const rows = existing || []
  const keyedAnywhere = rows.some(r => (r.sales_keys || []).includes(key))
  const l = rows.find(r => (r.sales_keys || []).length > 0) || rows[0]
  const dupNote = rows.length > 1 ? ` ⚠ ${rows.length} landings on ${date} — check Crew Landings` : ''
  if (l) {
    let healed = ''
    if (!l.locked && (l.landing_crew || []).length === 0) {
      const aboard = await aboardOnDate(supabase, fleetId, date)
      if (aboard.length) {
        const { error: he } = await supabase.from('landing_crew')
          .upsert(aboard.map(crew_id => ({ fleet_id: fleetId, landing_id: l.id, crew_id })),
                  { onConflict: 'landing_id,crew_id', ignoreDuplicates: true })
        healed = he ? ` (crew re-add failed: ${he.message})` : ` — re-added ${aboard.length} crew aboard`
      }
    }
    if (keyedAnywhere) return healed + dupNote                              // already counted this note
    if (l.locked) return ' — crew landing locked (month closed), not updated'
    const { error: e } = await supabase.from('landings')
      .update({ boxes: Math.round((Number(l.boxes || 0) + Number(boxes)) * 100) / 100, sales_keys: [...(l.sales_keys || []), key] })
      .eq('id', l.id)
    return e ? ` (crew landing: ${e.message})` : ` -> crew landing +${boxes} bx${healed}${dupNote}`
  }
  const aboard = await aboardOnDate(supabase, fleetId, date)
  if (!aboard.length) return ' — no crew aboard on that date, crew landing not created'
  const { data: ins, error: ie } = await supabase.from('landings')
    .insert({ fleet_id: fleetId, landing_date: date, boxes: Number(boxes), notes: 'Auto from sales notes (email)', locked: false, created_by: createdBy, sales_keys: [key] })
    .select('id').single()
  if (ie) return ` (crew landing: ${ie.message})`
  const { error: lce } = await supabase.from('landing_crew')
    .upsert(aboard.map(crew_id => ({ fleet_id: fleetId, landing_id: ins.id, crew_id })),
            { onConflict: 'landing_id,crew_id', ignoreDuplicates: true })
  if (lce) return ` (crew aboard failed: ${lce.message} — edit the landing)`
  return ` -> crew landing created (${boxes} bx, ${aboard.length} crew aboard)`
}

// Decide what a PDF is from its text. Sales-note signatures are tested BEFORE
// the fiskeauktion.dk price catch, because the Hanstholm "My sales" note also
// carries the fiskeauktion.dk domain — order is what stops a per-vessel note
// being mistaken for the Danish price board.
function classifyKind(t) {
  t = t || ''
  // ---- Sales notes (per-vessel, private -> fleet tables) ----
  if (/My sales/i.test(t) || /MyTransactions/i.test(t)) return 'sales'              // Hanstholm "My sales"
  if (/Registered Seller Sales Note/i.test(t) || /PETER\s*&\s*J\.?\s*JOHNSTONE/i.test(t) || /pjj-peterhead/i.test(t)) return 'sales'
  if (/SALES NOTE/i.test(t)) return 'sales'                                          // Don Fishing
  if (/Supplier Transactions/i.test(t)) return 'sales'                               // John S Duncan / Shetland
  // ---- Price boards (shared -> market_* tables) ----
  if (/PETERHEAD DAILY MARKET PRICES/i.test(t)) return 'price'
  if (/Hanstholm Fiskeauktion/i.test(t)) return 'price'
  if (/fiskeauktion\.dk/i.test(t)) return 'price'                                    // Danish board (sales caught above)
  return 'unknown'
}

// Pull every email address out of the envelope + headers, lower-cased.
function emailsFrom(body) {
  const hay = JSON.stringify(body.envelope || {}) + ' ' + JSON.stringify(body.headers || {})
  const found = hay.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []
  return [...new Set(found)]
}

export const handler = async (event) => {
  const key = (event.queryStringParameters && event.queryStringParameters.key) || ''
  if (!process.env.INGEST_SECRET || key !== process.env.INGEST_SECRET) {
    return { statusCode: 403, body: 'forbidden' }
  }
  if (event.httpMethod === 'GET') return ok('ingest ready (prices + sales)')
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' }

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return { statusCode: 400, body: 'bad json' } }

  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) return { statusCode: 500, body: 'server missing supabase env' }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Resolve the forwarder -> fleet. The first email in the envelope/headers
  // that matches a row in ingest_senders wins (the original sender — Don
  // Fishing, the Danish auction — is never in the table, so the forwarder is
  // what's picked).
  const seen = emailsFrom(body)
  const { data: senders, error: se } = await supabase
    .from('ingest_senders').select('email, fleet_id, label')
  if (se) return { statusCode: 500, body: 'cannot read ingest_senders: ' + se.message }
  // Two kinds of allow-rule: an exact address ('flemming@…' / 'davgatt86@gmail.com')
  // or a whole-domain rule whose email begins with '@' ('@hanstholmfiskeauktion.dk').
  // A domain rule matches that domain and any sub-domain of it, so the auction's
  // random per-message ESP address (xxxx@em934663.hanstholmfiskeauktion.dk) still
  // resolves. Exact matches are tried across ALL seen addresses first, so a known
  // human forwarder always wins and a domain rule can't hijack someone else's
  // forwarded note; the domain rule is only the fallback (e.g. the auction mailing
  // us directly, with no known forwarder in the envelope).
  const exact = new Map()
  const domains = []
  for (const s of senders || []) {
    const e = String(s.email || '').toLowerCase().trim()
    if (!e) continue
    if (e.startsWith('@')) domains.push({ suffix: e.slice(1), row: s })
    else exact.set(e, s)
  }
  const domainMatch = (addr) => {
    const at = addr.lastIndexOf('@')
    if (at < 0) return null
    const dom = addr.slice(at + 1)
    for (const d of domains) if (dom === d.suffix || dom.endsWith('.' + d.suffix)) return d.row
    return null
  }
  const sender = seen.map(e => exact.get(e)).find(Boolean)
    || seen.map(domainMatch).find(Boolean)
    || null
  if (!sender) {
    // 422 -> CloudMailin bounces it back to you as an email naming what it saw.
    return { statusCode: 422, body: JSON.stringify({ error: 'unknown forwarder — add them to ingest_senders', addresses_seen: seen }, null, 2) }
  }

  // created_by for any auto-created crew landing: the fleet's skipper (the
  // function runs as service role, so there's no logged-in user to attribute).
  const { data: skipperRow } = await supabase.from('app_users')
    .select('id').eq('fleet_id', sender.fleet_id).eq('role', 'skipper').limit(1).maybeSingle()
  const createdBy = skipperRow?.id || null

  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const attachments = body.attachments || []
  const results = []
  for (const a of attachments) {
    const name = a.file_name || a.fileName || a.name || 'email.pdf'
    const ctype = a.content_type || a.contentType || ''
    const b64 = a.content || a.data
    if ((!/pdf/i.test(ctype) && !/\.pdf$/i.test(name)) || !b64) continue

    let pdf
    try {
      const buf = Buffer.from(b64, 'base64')
      pdf = await getDocument({ data: new Uint8Array(buf) }).promise

      // Extract once via the sales parser's own extractor (gives us fullText
      // for classification and the line bundle the sales parsers consume).
      const extracted = await ParseCore.extractPages(pdf)
      const kind = classifyKind(extracted.fullText)

      if (kind === 'sales') {
        const res = ParseCore.parseExtracted(extracted, name)
        if (!res.rows.length) { results.push(`skip ${name}: sales note but no rows parsed (${res.market})`); continue }
        const rec = res.reconcile || {}
        const tot = rec.actual || { boxes: 0, weight: 0, value: 0 }
        const dkey = dedupKey(res)
        // Danish (Hanstholm Afregning) notes are priced in DKK and the email
        // path can't ask for a rate, so land them rate-pending: keep the DKK
        // originals, hold the £ figures at 0. The skipper sets the day rate in
        // the app (Fish Sales -> the DKK landing) which converts and fills them.
        const dkk = res.meta.currency === 'DKK'

        // Per-fleet dedup: (fleet_id, dedup_key) is unique after multi_tenancy.sql.
        const { data: dup } = await supabase.from('sales_landings')
          .select('id, fx_rate').eq('fleet_id', sender.fleet_id).eq('dedup_key', dkey).maybeSingle()

        // Self-heal: re-sending a note that's already imported now RE-PARSES and
        // replaces its rows in place (same landing id, so crew-landing links and
        // any manual edits to the landing survive). This lets a corrected parser
        // propagate just by re-forwarding the note — no manual delete/reload, and
        // no need to hand the raw sales notes to anyone. The one thing we never
        // overwrite is a DKK (Hanstholm) landing the skipper has already set a £
        // day rate on: those rows carry a manual conversion, so leave them be.
        if (dup && dup.fx_rate != null) {
          results.push(`dup ${name}: already imported with a set £ rate — left unchanged`); continue
        }

        const landingFields = {
          fleet_id: sender.fleet_id,                       // <- explicit; service role has no current_fleet_id()
          dedup_key: dkey, vessel: res.meta.vessel || '', market: res.market || '', port: res.meta.port || '',
          sale_no: res.meta.saleNo || '', landing_date: res.meta.isoDate || null, filename: name,
          boxes: tot.boxes, weight_kg: tot.weight, value: dkk ? 0 : tot.value,
          consigned: !!res.meta.consigned, reconcile_ok: rec.found ? rec.ok : null,
          // Keep WHAT differed, not just that something did. The landing's own
          // totals are the row sum, so they can never disagree with the rows —
          // the printed TOTAL is the only independent check and it lived
          // nowhere. See supabase/sales_reconcile_diff.sql.
          reconcile_diff: rec.found
            ? { expected: rec.expected, actual: rec.actual, diffs: rec.diffs, basis: rec.boxBasis || null }
            : null,
          currency: res.meta.currency || null, fx_rate: null,
        }

        let landingId
        if (dup) {
          // Replace: refresh the landing fields, wipe its rows, re-insert below.
          landingId = dup.id
          const { error: eu } = await supabase.from('sales_landings').update(landingFields).eq('id', landingId)
          if (eu) throw eu
          const { error: ed } = await supabase.from('sales_rows').delete().eq('landing_id', landingId)
          if (ed) throw ed
        } else {
          const { data: ins, error: e1 } = await supabase.from('sales_landings')
            .insert(landingFields).select('id').single()
          if (e1) throw e1
          landingId = ins.id
        }

        /* Apply this fleet's buyer merges.
         *
         * Buyer names come off the sales note as typed, so one firm turns up
         * several ways and splits its own record. Merging the history fixes
         * what is there; without this the NEXT note reintroduces the variant
         * and the work is undone — which is what the aliases column was added
         * for and nothing was reading.
         *
         * Matched case- and space-insensitively, because that is how the
         * variants differ ("G & J JACK" vs "G&J Jack Seafoods Ltd"). Applied
         * per fleet: two boats may know the same firm by different names, and
         * one fleet's merge is not evidence about another's. */
        const { data: flags } = await supabase
          .from('sales_buyer_flags')
          .select('canonical_name, aliases')
          .eq('fleet_id', sender.fleet_id)
          .not('canonical_name', 'is', null)
        const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        const aliasMap = new Map()
        for (const f of flags || []) {
          for (const a of f.aliases || []) aliasMap.set(squash(a), f.canonical_name)
        }
        const canonBuyer = (b) => aliasMap.get(squash(b)) || b || ''

        const payload = res.rows.map(r => ({
          fleet_id: sender.fleet_id, landing_id: landingId,
          buyer: canonBuyer(r.buyer), species: r.species || '', species_canon: r.species_canon || r.species || '',
          presentation: r.presentation || '', grade: r.grade || '', boxes: r.boxes || 0, box_weight: r.box_weight || 0,
          weight_kg: r.total_weight || 0,
          price_per_kg: dkk ? 0 : (r.price_per_kg || 0), price_per_box: dkk ? 0 : (r.price_per_box || 0),
          value: dkk ? 0 : (r.total_value || 0), msc: !!r.msc,
          value_dkk: dkk ? (r.total_value || 0) : null, ppk_dkk: dkk ? (r.price_per_kg || 0) : null,
        }))
        for (let i = 0; i < payload.length; i += 500) {
          const { error: e2 } = await supabase.from('sales_rows').insert(payload.slice(i, i + 500))
          // Only unwind a brand-new landing on failure; a replaced one keeps its
          // id (and crew links) and self-heals on the next re-send.
          if (e2) { if (!dup) await supabase.from('sales_landings').delete().eq('id', landingId); throw e2 }
        }
        const warn = rec.found && !rec.ok ? ` ⚠ differs from printed TOTAL (£${rec.diffs?.value ?? '?'})` : ''
        const fed = await feedCrewLanding(supabase, sender.fleet_id, createdBy, res.meta.isoDate, tot.boxes, dkey)
        const grossTxt = dkk ? `${Math.round(res.meta.grossDkk || tot.value).toLocaleString()} DKK — set £ rate in app` : `£${tot.value}`
        results.push(`ok ${name}: SALE${dup ? ' ↻ re-parsed' : ''} ${res.market} ${res.meta.vessel || ''} ${res.meta.isoDate || ''} -> ${sender.label || sender.fleet_id} (${res.rows.length} rows, ${grossTxt})${warn}${fed}`)

      } else if (kind === 'price') {
        // Shared board — same logic as ingest-prices.js (replace day, insert prices+volumes).
        const res = await parseMarketFromDoc(pdf, name)
        if (!res.source || !res.price_date || !res.prices.length) {
          results.push(`skip ${name}: ${res.warnings?.[0] || 'no prices parsed'}`); continue
        }
        const { data: existing } = await supabase.from('market_days')
          .select('id').eq('source', res.source).eq('price_date', res.price_date).maybeSingle()
        if (existing) await supabase.from('market_days').delete().eq('id', existing.id)
        const { data: day, error: e1 } = await supabase.from('market_days').insert({
          source: res.source, price_date: res.price_date,
          boats: res.meta.boats ?? null, consignments: res.meta.consignments ?? null,
          total_boxes: res.meta.total_boxes ?? null, total_kg: res.meta.total_kg ?? null,
          filename: name,
        }).select().single()
        if (e1) throw e1
        const e2 = (await supabase.from('market_prices').insert(res.prices.map(p => ({ ...p, day_id: day.id })))).error
        const e3 = res.volumes.length ? (await supabase.from('market_volumes').insert(res.volumes.map(v => ({ ...v, day_id: day.id })))).error : null
        if (e2 || e3) { await supabase.from('market_days').delete().eq('id', day.id); throw (e2 || e3) }
        results.push(`ok ${name}: PRICES ${res.source} ${res.price_date} (${res.prices.length} prices)${existing ? ' replaced' : ''}`)
        // New board prices in -> refresh price alerts (idempotent, deduped).
        try { await supabase.rpc('generate_alerts') } catch (e) { /* non-fatal */ }

      } else {
        results.push(`skip ${name}: not recognised as a price sheet or sales note`)
      }
    } catch (err) {
      results.push(`fail ${name}: ${err.message}`)
    } finally {
      if (pdf) { try { await pdf.destroy() } catch { /* ignore */ } }
    }
  }

  const problems = results.filter(r => r.startsWith('fail') || r.startsWith('skip'))
  if (problems.length) {
    return { statusCode: 422, body: JSON.stringify({ error: 'a sheet did not load', forwarder: sender.label || sender.fleet_id, problems, processed: results }, null, 2) }
  }
  return ok({ forwarder: sender.label || sender.fleet_id, processed: results })
}
