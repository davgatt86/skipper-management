// netlify/functions/ingest-prices.js
// ⚠ TEMPORARY VERSION — only to capture the Gmail forwarding confirmation code.
// Once you've verified the forward in Gmail, put the ORIGINAL ingest-prices.js
// back so price PDFs ingest normally.
//
// What it does differently: if an email has NO PDF attachment (e.g. the Google
// "Gmail Forwarding confirmation" email), it pulls out the 9-digit code and the
// confirm link and returns them with a 422 status — which is the case where
// CloudMailin stores and shows "Your Server's Response Body".

if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
}

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createClient } from '@supabase/supabase-js'
import { parseMarketFromDoc } from '../../src/lib/market/parseMarket.js'

const ok = (body) => ({ statusCode: 200, body: typeof body === 'string' ? body : JSON.stringify(body) })

export const handler = async (event) => {
  const key = (event.queryStringParameters && event.queryStringParameters.key) || ''
  if (!process.env.INGEST_SECRET || key !== process.env.INGEST_SECRET) {
    return { statusCode: 403, body: 'forbidden' }
  }
  if (event.httpMethod === 'GET') return ok('ingest-prices ready')
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' }

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return { statusCode: 400, body: 'bad json' } }

  const attachments = body.attachments || []
  const isPdf = (a) => /pdf/i.test(a.content_type || a.contentType || '') || /\.pdf$/i.test(a.file_name || a.fileName || a.name || '')
  const hasPdf = attachments.some(isPdf)

  // ── TEMP: no PDF -> show the email text (code + link) in CloudMailin ──────
  if (!hasPdf) {
    const text = body.plain || body.html || ''
    const code = (text.match(/\b\d{6,9}\b/) || [])[0] || '(no code found — see text below)'
    const link = (text.match(/https?:\/\/mail-settings\.google\.com\/\S+/i)
      || text.match(/https?:\/\/\S*confirm\S*/i) || [])[0] || '(no link found — see text below)'
    return {
      statusCode: 422,
      body: JSON.stringify({
        debug: 'verification email captured — enter the code in Gmail',
        code,
        link,
        from: (body.envelope && body.envelope.from) || (body.headers && body.headers.from) || '',
        subject: (body.headers && body.headers.subject) || body.subject || '',
        text: text.slice(0, 4000),
      }, null, 2),
    }
  }

  // ── Normal price path (unchanged) ────────────────────────────────────────
  const allowed = (process.env.ALLOWED_SENDER || '').toLowerCase()
  if (allowed) {
    const hay = (JSON.stringify(body.headers || {}) + ' ' + JSON.stringify(body.envelope || {})).toLowerCase()
    if (!hay.includes(allowed)) return ok({ skipped: 'sender not allowed' })
  }

  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) return { statusCode: 500, body: 'server missing supabase env' }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const results = []
  for (const a of attachments) {
    if (!isPdf(a)) continue
    const name = a.file_name || a.fileName || a.name || 'email.pdf'
    const b64 = a.content || a.data
    if (!b64) continue
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
  return ok({ processed: results })
}
