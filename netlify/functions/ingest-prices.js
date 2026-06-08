// netlify/functions/ingest-prices.js
// Inbound-email webhook for the Daily Prices board.
//
// Flow:  CloudMailin receives a forwarded price email  ->  POSTs it here as
// JSON  ->  this function parses any PDF attachments with the SAME parser the
// app uses  ->  inserts rows into Supabase (dedup by source+date).
// Runs server-side, so nobody's browser needs to be open.
//
// ── Netlify settings (Site settings -> Environment variables) ──────────────
//   SUPABASE_URL                 e.g. https://fbdfskjojgatsgmvxozo.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    Supabase -> Project Settings -> API -> service_role (secret)
//   INGEST_SECRET                any long random string you invent
//   ALLOWED_SENDER               davgatt86@gmail.com   (who you forward from)
//
// ── CloudMailin ────────────────────────────────────────────────────────────
//   Target (POST) URL:  https://<your-site>.netlify.app/.netlify/functions/ingest-prices?key=<INGEST_SECRET>
//   Format:             JSON  (attachments delivered inline)
//
// ── Gmail ──────────────────────────────────────────────────────────────────
//   Forward the Don Fishing + Denmark price emails to your CloudMailin address
//   (verify it once via the code shown in CloudMailin's message log, then add a
//   filter: subject contains "Daily Market Prices" -> Forward to that address).

// pdf.js (v4) uses Promise.withResolvers, which only exists on Node 22+.
// Polyfill so the function runs on any Netlify Node version.
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
}

import { createClient } from '@supabase/supabase-js'
import { parseMarketFromDoc } from '../../src/lib/market/parseMarket.js'

const ok = (body) => ({ statusCode: 200, body: typeof body === 'string' ? body : JSON.stringify(body) })

export const handler = async (event) => {
  const key = (event.queryStringParameters && event.queryStringParameters.key) || ''
  if (!process.env.INGEST_SECRET || key !== process.env.INGEST_SECRET) {
    return { statusCode: 403, body: 'forbidden' }
  }
  // browser healthcheck: GET .../ingest-prices?key=... -> confirms it's live
  if (event.httpMethod === 'GET') return ok('ingest-prices ready')
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' }

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return { statusCode: 400, body: 'bad json' } }

  // Defence in depth (the secret URL is the real gate): only accept mail that
  // carries the allowed forwarder somewhere in its headers/envelope.
  const allowed = (process.env.ALLOWED_SENDER || '').toLowerCase()
  if (allowed) {
    const hay = (JSON.stringify(body.headers || {}) + ' ' + JSON.stringify(body.envelope || {})).toLowerCase()
    if (!hay.includes(allowed)) return ok({ skipped: 'sender not allowed' }) // 200 so CloudMailin doesn't retry
  }

  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) return { statusCode: 500, body: 'server missing supabase env' }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // pdf.js is ESM-only; load it via dynamic import (works from CommonJS).
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')


  const attachments = body.attachments || []
  const results = []
  for (const a of attachments) {
    const name = a.file_name || a.fileName || a.name || 'email.pdf'
    const ctype = a.content_type || a.contentType || ''
    const b64 = a.content || a.data
    if ((!/pdf/i.test(ctype) && !/\.pdf$/i.test(name)) || !b64) continue
    try {
      const buf = Buffer.from(b64, 'base64')
      const pdf = await getDocument({ data: new Uint8Array(buf) }).promise
      const res = await parseMarketFromDoc(pdf, name)
      try { await pdf.destroy() } catch { /* ignore */ }
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
      results.push(`ok ${name}: ${res.source} ${res.price_date} (${res.prices.length} prices)${existing ? ' replaced' : ''}`)
    } catch (err) {
      results.push(`fail ${name}: ${err.message}`)
    }
  }
  // Success (or a non-price email with no PDF) -> 200, silent. If a sheet
  // actually failed or parsed empty, return 422 so CloudMailin bounces it back
  // to you as an email alert naming the problem.
  const problems = results.filter(r => r.startsWith('fail') || r.startsWith('skip'))
  if (problems.length) {
    return { statusCode: 422, body: JSON.stringify({ error: 'a sheet did not load', problems, processed: results }, null, 2) }
  }
  return ok({ processed: results })
}
