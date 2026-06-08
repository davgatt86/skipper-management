// netlify/functions/ingest-prices.js
// ⚠ TEMPORARY DIAGNOSTIC BUILD. It processes normally BUT always replies 422
// with a full report (so CloudMailin shows it). Swap back to the real one after.

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

export const handler = async (event) => {
  const key = (event.queryStringParameters && event.queryStringParameters.key) || ''
  if (!process.env.INGEST_SECRET || key !== process.env.INGEST_SECRET) return { statusCode: 403, body: 'forbidden' }
  if (event.httpMethod === 'GET') return { statusCode: 200, body: 'ingest-prices ready (DIAGNOSTIC build)' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' }

  const report = { env: {}, sender: {}, attachments: [], steps: [] }

  let body
  try { body = JSON.parse(event.body || '{}') } catch (e) { return { statusCode: 422, body: 'bad json: ' + e.message } }

  const url = process.env.SUPABASE_URL || ''
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  report.env.SUPABASE_URL = url || '(missing)'
  report.env.url_has_rest_suffix = /\/rest\//.test(url)
  report.env.url_has_trailing_slash = /\/$/.test(url)
  report.env.service_key_kind =
    svc.startsWith('sb_secret') ? 'secret OK'
    : svc.startsWith('sb_publishable') ? 'PUBLISHABLE - WRONG KEY'
    : svc.startsWith('eyJ') ? 'legacy JWT (anon or service?)'
    : svc ? 'unknown format' : '(missing)'
  report.env.allowed_sender = process.env.ALLOWED_SENDER || '(none set)'

  const allowed = (process.env.ALLOWED_SENDER || '').toLowerCase()
  report.sender.allowed_found_in_payload = allowed ? (event.body || '').toLowerCase().includes(allowed) : 'no check'

  const attachments = body.attachments || []
  report.attachment_count = attachments.length
  const isPdf = (a) => /pdf/i.test(a.content_type || a.contentType || '') || /\.pdf$/i.test(a.file_name || a.fileName || a.name || '')

  let supabase = null
  if (url && svc) { try { supabase = createClient(url, svc, { auth: { persistSession: false } }) } catch (e) { report.steps.push('createClient failed: ' + e.message) } }

  for (const a of attachments) {
    const name = a.file_name || a.fileName || a.name || '(no name)'
    const b64 = a.content || a.data
    const info = { name, content_type: a.content_type || a.contentType || '', keys: Object.keys(a), has_content: !!b64, content_len: b64 ? String(b64).length : 0, is_pdf: isPdf(a) }
    report.attachments.push(info)
    if (!isPdf(a) || !b64) { info.result = 'skipped (not a pdf or no content)'; continue }
    if (/^https?:\/\//.test(String(b64).trim())) { info.result = 'content is a URL (attachment store is ON - turn it OFF so content is base64)'; continue }
    try {
      const buf = Buffer.from(b64, 'base64')
      const pdf = await getDocument({ data: new Uint8Array(buf) }).promise
      const res = await parseMarketFromDoc(pdf, name)
      try { await pdf.destroy() } catch (e) {}
      info.parsed = { source: res.source, date: res.price_date, prices: res.prices.length, volumes: res.volumes.length, warning: res.warnings && res.warnings[0] ? res.warnings[0] : null }
      if (!res.source || !res.price_date || !res.prices.length) { info.result = 'parsed but nothing to insert'; continue }
      if (!supabase) { info.result = 'would insert, but Supabase env missing'; continue }
      const { data: existing, error: selErr } = await supabase.from('market_days').select('id').eq('source', res.source).eq('price_date', res.price_date).maybeSingle()
      if (selErr) { info.result = 'SELECT failed: ' + selErr.message; continue }
      if (existing) await supabase.from('market_days').delete().eq('id', existing.id)
      const ins = await supabase.from('market_days').insert({
        source: res.source, price_date: res.price_date,
        boats: res.meta.boats == null ? null : res.meta.boats,
        consignments: res.meta.consignments == null ? null : res.meta.consignments,
        total_boxes: res.meta.total_boxes == null ? null : res.meta.total_boxes,
        total_kg: res.meta.total_kg == null ? null : res.meta.total_kg,
        filename: name,
      }).select().single()
      if (ins.error) { info.result = 'INSERT market_days failed: ' + ins.error.message; continue }
      const day = ins.data
      const e2 = (await supabase.from('market_prices').insert(res.prices.map(p => Object.assign({}, p, { day_id: day.id })))).error
      const e3 = res.volumes.length ? (await supabase.from('market_volumes').insert(res.volumes.map(v => Object.assign({}, v, { day_id: day.id })))).error : null
      if (e2 || e3) { await supabase.from('market_days').delete().eq('id', day.id); info.result = 'INSERT prices/volumes failed: ' + (e2 || e3).message; continue }
      info.result = 'INSERTED OK ' + res.source + ' ' + res.price_date + (existing ? ' (replaced)' : '')
    } catch (err) { info.result = 'exception: ' + err.message }
  }

  return { statusCode: 422, body: JSON.stringify(report, null, 2) }
}
