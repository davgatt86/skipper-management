import { supabase } from '../../supabaseClient'

// Client for the su-parse-document edge function — the AI reader that turns a
// settling sheet or invoice (PDF or photo) into structured JSON.
//
// Ported from the Square Up app against its integration contract. The flow is
// deliberately a poll, not a wait: the function returns a job id straight away
// and does the read in the background, because a settling sheet can take the
// model well over a browser's patience.
//
//   upload to su-documents at {boatId}/{ts}_{name}
//     -> POST { paths, doc_type } with the USER's JWT (verify_jwt is on)
//     -> { job_id }
//     -> poll su_parse_jobs every 3s until done or error
//
// Note on su_parse_jobs: the function writes it with the service-role key, so
// its rows carry no fleet_id and the table is left unscoped in
// supabase/su_fleet_isolation.sql. Scoping it would break this poll — the
// client reads the job back with its own session. Fixing that properly means
// changing the edge function to set fleet_id from the caller's JWT.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY

const POLL_MS = 3000
const DEADLINE_MS = 6 * 60 * 1000   // matches the function's own AI timeout headroom

export const DOC_TYPES = {
  audacious: 'settlement',
  beryl: 'settlement_beryl',
  invoice: 'invoice',
}

export async function uploadDocument(boatId, file) {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${boatId}/${Date.now()}_${safe}`
  const { error } = await supabase.storage.from('su-documents').upload(path, file)
  if (error) throw error
  return path
}

/* OPEN THE SCAN AT THE INVOICE, NOT AT PAGE ONE.
 *
 * A bundle is a whole week in one file, so "open the scan" has always meant
 * "here are five pages, find it yourself". The `#page=` fragment is honoured by
 * every built-in PDF viewer — and where it is not, the document still opens at
 * the top, which is exactly what the button did before. It degrades to the old
 * behaviour rather than failing, which is why no capability check is wanted. */
export async function openDocument(path, page) {
  const url = await signedUrl(path)
  const at = Number(page)
  window.open(Number.isInteger(at) && at > 1 ? url + "#page=" + at : url, "_blank", "noopener")
}

export async function signedUrl(path, seconds = 3600) {
  const { data, error } = await supabase.storage.from('su-documents').createSignedUrl(path, seconds)
  if (error) throw error
  return data.signedUrl
}

// Photos off a phone are far larger than the model needs and slow the upload on
// a poor signal. PDFs are left alone — the model reads them natively.
function downscaleToJpeg(file, maxEdge = 2200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        blob => {
          if (!blob) { reject(new Error('Could not process that photo.')); return }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }))
        },
        'image/jpeg',
        quality
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')) }
    img.src = url
  })
}

const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')

/**
 * Upload the files and read them.
 * Returns { data, paths } — paths lets the caller reuse the stored original
 * rather than uploading the same document twice on save.
 * `onStage` is called with 'uploading' | 'reading' so the UI can say which.
 */
/* `existingPaths` is for a sheet that is ALREADY in the bucket — one that
 * arrived by email and was filed by the ingest webhook. Uploading it a second
 * time would leave a duplicate object behind for every arrival, and the bucket
 * already carries every settlement document against a 1 GB allowance. */
export async function parseDocuments(files, docType, boatId, { onStage, existingPaths, pageCount } = {}) {
  if (!boatId) throw new Error('No boat selected.')
  if (!existingPaths?.length && !files?.length) throw new Error('No file chosen.')

  let paths = existingPaths || []
  if (!paths.length) {
    onStage?.('uploading')
    for (const f of files) {
      const toUpload = isPdf(f) ? f : await downscaleToJpeg(f)
      paths.push(await uploadDocument(boatId, toUpload))
    }
  }

  onStage?.('reading')
  const { data: sess } = await supabase.auth.getSession()
  const token = sess?.session?.access_token
  if (!token) throw new Error('Signed out — sign in again and retry.')

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/su-parse-document`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_KEY,
    },
    /* THE PAGE COUNT IS THE ONE FACT ABOUT THE DOCUMENT THAT IS NOT THE
       MODEL'S OPINION — it was read off the PDF with pdf.js on upload. The
       function uses it to throw away a page number that could not be true. */
    body: JSON.stringify({ paths, doc_type: docType, page_count: Number.isInteger(pageCount) ? pageCount : null }),
  })
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(json.error || `Could not start the read (${resp.status}).`)

  const jobId = json.job_id
  if (!jobId) throw new Error('The reader did not return a job to wait on.')

  const deadline = Date.now() + DEADLINE_MS
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_MS))
    const { data: job, error } = await supabase
      .from('su_parse_jobs').select('status, result, error').eq('id', jobId).maybeSingle()
    if (error) throw new Error(error.message)
    if (job?.status === 'done') return { data: job.result, paths }
    if (job?.status === 'error') throw new Error(job.error || 'Reading failed.')
  }
  throw new Error('Reading took too long. The file is stored — try again, or enter the figures by hand.')
}

// ---- mapping the reader's JSON onto editable review state ----------------
// The shapes below are the edge function's own prompt schemas. Amounts always
// come back positive; the prompts flip bracketed figures.

const n = v => (v === '' || v == null ? '' : v)

export function mapAudacious(d) {
  return {
    head: {
      trip_type: 'fishing',
      reference: d.reference || '',
      settling_date: d.settling_date || '',
      period: d.period || '',
      total_income: n(d.total_income),
      total_expenses: n(d.total_expenses),
      total_recoveries: n(d.total_recoveries),
      crew_wages_total: n(d.crew_wages_total),
      settling_vat: n(d.settling_vat),
      trips: n(d.trips),
      days_at_sea: n(d.days_at_sea),
      fuel_used: n(d.fuel_used),
      weight_landed: n(d.weight_landed),
      notes: '',
    },
    lines: (d.lines || []).map(l => ({ section: l.section, label: l.label, amount: n(l.amount) })),
    crew: (d.crew_payments || []).map(c => ({
      crew_code: c.crew_code || '',
      crew_name: c.crew_name || '',
      adv: n(c.adv), bond: n(c.bond), gear: n(c.gear), sundries: n(c.sundries),
      add_tax: n(c.add_tax), tax: n(c.tax),
      gross: n(c.gross), net: n(c.net),
      method: c.method || 'BACS',
    })),
  }
}

export function mapBeryl(d) {
  return {
    head: {
      // Beryl sheets carry no reference of their own, so one is derived from
      // the settling date — su_settlements has a unique (boat_id, reference).
      reference: d.settling_date ? `BERYL-${d.settling_date}` : '',
      settling_date: d.settling_date || '',
      total_income: n(d.total_income),
      total_expenses: n(d.total_expenses),
      boat_share: n(d.boat_share),
      boat_share_pct: n(d.boat_share_pct),
      fuel_pct: n(d.fuel_pct),
      commission: n(d.commission),
      days_at_sea: n(d.days_at_sea),
    },
    // Every Beryl line is an expense; the format has no recovery section.
    lines: (d.expenses || []).map(e => ({ section: 'expense', label: e.label, amount: n(e.amount) })),
    // Trustworthy as-is: fixBerylCrew() runs server-side before this is stored,
    // correcting a wage misread into the bond column and filling a blank net.
    crew: (d.crew || []).map(c => ({
      crew_name: c.crew_name || '',
      gross: n(c.gross), bond: n(c.bond), net: n(c.net),
      method: 'BACS',
    })),
  }
}

export function mapInvoices(d) {
  return (d.invoices || []).map(i => ({
    supplier: i.supplier || '',
    invoice_no: i.invoice_no || '',
    invoice_date: i.invoice_date || '',
    description: i.description || '',
    net: n(i.net), vat: n(i.vat), total: n(i.total),
    /* WHAT THE FIGURES ARE DENOMINATED IN, and it is not always sterling. This
       boat is billed by Danish, Dutch and French suppliers, and until Sep 2026
       nothing ever asked: all 2,660 invoices were stamped GBP and £1,039,972 of
       foreign invoices sat in the record at FACE VALUE. Vest-EL's autopilot
       reads "DKK 48.084,02" on the invoice and went in as £48,084 — about eight
       times what it cost.

       BLANK, NEVER GBP, where the reader did not say. `saveBatchInvoices`
       defaults an empty one to GBP, which is the right guess for a Peterhead
       boat, but the guess has to be made in ONE place and be visible there —
       filling it in here would hide it. */
    currency: (i.currency || '').toUpperCase().trim(),
    account_code: i.account_code || '',
    /* Which pages of the bundle this invoice is. Blank rather than 0 when the
       reader was not sure: page 0 does not exist, and a number that looks like
       an answer is worse than an honest gap. */
    page_from: n(i.page_from), page_to: n(i.page_to),
    /* WHEN THE WORK WAS DONE, where the invoice states it. The reader is told
       in as many words not to copy the invoice date here, and the function
       drops one that matches it anyway — a work date that is really the invoice
       date repeated looks exactly like a reading and would make the whole
       "dated by work" view a copy of the billed one. */
    work_from: i.work_from || '', work_to: i.work_to || '',
    status: 'unpaid',
  }))
}
