import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import {
  listBatches, listInvoices, listSuppliers, createSupplier, addAlias,
  saveBatchInvoices, setBatchStatus, deleteBatch, applySuppliers, storeRead,
  setSupplierCategory, setSupplierCategories, loadCategorySettings,
  setInvoiceVessels, setInvoicesWork, setInvoiceCategory,
} from '../lib/su/invoices'
import { parseDocuments, DOC_TYPES, mapInvoices, signedUrl, openDocument } from '../lib/su/parse'
import { addsWrong, figuresMissing, explainReadError } from '../lib/invoices/periods'
import { suggestCategory, resolveCategories } from '../lib/invoices/categories'
import { resolveEras } from '../lib/invoices/vessels'
import { yearsCovered } from '../lib/invoices/dashboard'
import { workLabel } from '../lib/invoices/when'
import YearDashboard from './invoices/YearDashboard'
import AllYears from './invoices/AllYears'
import FindInvoices from './invoices/FindInvoices'
import { Segmented } from './invoices/shared'

/* THE BOAT'S INVOICES — the weekly bundle, split by supplier.
 *
 * David, Sep 2026: "i get them scanned and emailed to me every monday by denise
 * nicolson don company ... splitting is what we want, do whatever it needs to
 * have it split by supplier" and "just reporting periods. annual is most
 * important."
 *
 * THREE THINGS, IN THE ORDER THEY HAPPEN. The bundle arrives; it is read and
 * checked; the costs are then a record you can total. They are tabs rather than
 * three pages because the middle one is a step, not a place — you are only ever
 * in it for as long as it takes to check a read.
 *
 * NOTHING IS SAVED WITHOUT BEING LOOKED AT. The bundle is a photograph read by a
 * model, exactly like a settling sheet, and this page inherits that discipline
 * for the same reason: a misread supplier is a miscategorised cost for ever, and
 * a misread total is money. The email files the document and stops.
 */

const money = (n) => {
  const v = Number(n) || 0
  const a = Math.abs(v)
  return (v < 0 ? '-£' : '£') + a.toLocaleString('en-GB',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const money0 = (n) => {
  const v = Number(n) || 0
  return (v < 0 ? '-£' : '£') + Math.abs(v).toLocaleString('en-GB', { maximumFractionDigits: 0 })
}
const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB',
  { day: '2-digit', month: 'short', year: 'numeric' }) : '')

export default function Invoices() {
  const { appUser } = useAuth()
  const fleetId = appUser?.fleet_id

  /* THE DASHBOARD IS THE PAGE NOW, and the three-step flow is one tab inside it.
   *
   * David, Sep 2026: "the arrivals/check/what it cost is almost like it was put
   * there for the initial upload. now we will be adding a pdf per week, it needs
   * to look better there too. invoice dashboard with a + invoice batch tab."
   *
   * He is right about why it looked like that: those three tabs WERE the initial
   * load, when 364 bundles went in over a weekend and the whole page was a
   * conveyor. That is done. What happens now is one PDF on a Monday and ten
   * years of costs to read the rest of the week, so the reading is the page and
   * adding a bundle is a thing you do to it. */
  const [tab, setTab] = useState('dashboard')

  /* Which date a cost is counted on. Billed is the honest default and is what
     every one of the 2,625 already filed uses; worked moves a job to the year it
     was actually done in, where somebody has said when that was. */
  const [on, setOn] = useState('invoice')
  const [basis, setBasis] = useState('total')
  const [year, setYear] = useState(null)
  /* One filter object, shared by the search box and by every drill-through from
     a grid cell — so a cell opens the SAME list, with its filters visible and
     wideable by hand rather than a pop-up that can only be dismissed. */
  const [filter, setFilter] = useState({ q: '' })
  const [batches, setBatches] = useState([])
  const [invoices, setInvoices] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [catSettings, setCatSettings] = useState(null)
  const [boatId, setBoatId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  /* The bundles READ but not yet saved. A queue rather than one at a time, so
     the run carries on in the background while the earliest are checked. */
  const [queue, setQueue] = useState([])
  const [progress, setProgress] = useState(null)
  const [stage, setStage] = useState('')

  const refresh = useCallback(async () => {
    if (!fleetId) return
    setLoading(true)
    const [b, i, s, c] = await Promise.all([
      listBatches(fleetId), listInvoices(fleetId), listSuppliers(fleetId),
      loadCategorySettings(fleetId),
    ])
    setBatches(b); setInvoices(i); setSuppliers(s); setCatSettings(c)
    setLoading(false)
  }, [fleetId])

  useEffect(() => { refresh() }, [refresh])

  /* PICK THE QUEUE BACK UP. Bundles read but not yet filed are restored from
     the batch, so closing the laptop mid-run costs nothing — the reading is
     already paid for and the checking carries on where it stopped. */
  useEffect(() => {
    setQueue((q) => {
      const have = new Set(q.map((x) => x.batch.id))
      const stored = batches
        .filter((b) => !have.has(b.id) && Array.isArray(b.read_result) && b.read_result.length)
        .map((b) => ({ batch: b, rows: b.read_result }))
      return stored.length ? [...q, ...stored] : q
    })
  }, [batches])

  useEffect(() => {
    if (!fleetId) return
    supabase.from('su_boats').select('id').eq('fleet_id', fleetId).eq('active', true)
      .limit(1).maybeSingle().then(({ data }) => setBoatId(data?.id || null))
  }, [fleetId])

  /* ---- PUTTING A BUNDLE IN BY HAND ----------------------------------------
   *
   * THE EMAIL ROUTE CANNOT CARRY THESE. CloudMailin refuses a message over
   * 512 KB — "552 Message size exceeds the allowed size for this account" — and
   * a weekly bundle is 0.7 to 2.3 MB before the base64 encoding an email adds.
   * Every one of them bounces.
   *
   * It is not only the invoices: `su_inbox` has never received a settling sheet
   * either, and Morna's run from 466 KB to 1.26 MB. That path was built in Aug
   * 2026 and has been quietly bouncing the big ones ever since. A sales note is
   * small, which is why the sales ingest has worked all along and nobody found
   * this.
   *
   * So the bundle is dropped in here instead. It is the same storage, the same
   * reader and the same review screen — only the delivery differs, and this one
   * has no size limit worth worrying about. Raising the CloudMailin plan would
   * restore the email route, but that costs money and this costs nothing.
   */
  const fileInput = useRef(null)

  async function uploadBundle(files) {
    const list = Array.from(files || [])
    if (!list.length || !boatId) return
    setErr(''); setMsg(''); setStage('uploading')
    try {
      const { ensurePdfjs } = await import('../lib/pdfjs.js')
      for (const f of list) {
        const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${boatId}/${Date.now()}_${safe}`
        const { error: ue } = await supabase.storage.from('su-documents').upload(path, f)
        if (ue) throw ue

        /* The page count is read here rather than left blank: it is the first
           thing that says whether the whole bundle came over, and the reader
           has not run yet. */
        let pages = null
        try {
          const pdfjs = await ensurePdfjs()
          const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise
          pages = doc.numPages
        } catch { /* a photo rather than a PDF — no page count, and that is fine */ }

        const { error: ie } = await supabase.from('su_invoice_batches').insert({
          fleet_id: fleetId, boat_id: boatId,
          file_path: path, filename: f.name, bytes: f.size, page_count: pages,
          /* NO manager's balance. It lives in the sentence Denise writes in the
             email body, and a file dropped in has no body. Blank is honest;
             carrying the last one forward would be a figure nobody stated. */
          subject: 'Added by hand', from_email: null,
        })
        if (ie) throw ie
      }
      setMsg(`${list.length} bundle${list.length === 1 ? '' : 's'} added. Read ${list.length === 1 ? 'it' : 'them'} below.`)
      await refresh()
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setStage('')
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  /* ---- READING, ONE BUNDLE OR ALL OF THEM ---------------------------------
   *
   * David, Sep 2026: "it's a bit tedious doing this batches of a year read 1 per
   * go. can we have a bulk read once a bundle goes in, even if it takes minutes
   * to do so."
   *
   * THE READING IS NOT THE SLOW PART TO A PERSON — THE WAITING IS. Each bundle
   * is a five-page photograph and takes a minute or two, and doing them one at
   * a time means sitting through every one of them doing nothing.
   *
   * So the run carries on in the BACKGROUND while the queue is reviewed. The
   * first bundle lands in a few moments and can be checked while the second and
   * third are still being read, which is why this is worth more than simply
   * making the button say "all".
   *
   * WHAT DOES NOT CHANGE IS THAT NOTHING SAVES UNLOOKED-AT. A misread supplier
   * is a miscategorised cost for ever and a misread total is money. What the
   * queue removes is the waiting and thirty-four separate Save clicks — not the
   * looking. */
  const cancelRead = useRef(false)

  async function readOne(batch) {
    const { data } = await parseDocuments([], DOC_TYPES.invoice, batch.boat_id || boatId, {
      /* THE FILE IS ALREADY IN THE BUCKET. `existingPaths` stops it being
         uploaded a second time, which would leave a duplicate object per read
         against an allowance that also holds every settlement document. */
      existingPaths: [batch.file_path],
      /* THE ONE FACT ABOUT THIS DOCUMENT THAT IS NOT THE MODEL'S OPINION —
         read off the PDF with pdf.js when the bundle went in. The reader uses
         it to throw away a page number that could not be true. */
      pageCount: batch.page_count,
    })
    return mapInvoices(data)
  }

  async function readBatches(list) {
    if (!list.length) return
    setErr(''); setMsg('')
    cancelRead.current = false
    setProgress({ done: 0, total: list.length })
    setTab('review')

    for (let i = 0; i < list.length; i++) {
      if (cancelRead.current) break
      const batch = list[i]
      setProgress({ done: i, total: list.length, current: batch })
      try {
        const rows = await readOne(batch)
        /* A BUNDLE THE READER FOUND NOTHING IN IS QUEUED AS A PROBLEM, not
           skipped. Silently passing over it is how a week's costs go missing
           with nobody the wiser. */
        setQueue((q) => [...q, rows.length
          ? { batch, rows }
          : { batch, rows: [], error: 'The reader found no invoices in this one.' }])
        /* STORED IMMEDIATELY. A read is a paid call on a photograph, so it must
           survive a reload — losing it means paying and waiting twice. */
        if (rows.length) await storeRead(batch.id, rows).catch(() => {})
        else await setBatchStatus(batch.id, 'read').catch(() => {})
      } catch (e) {
        /* ONE FAILURE MUST NOT STOP THE RUN. Thirty-three good bundles should
           not be lost to the thirty-fourth timing out. */
        setQueue((q) => [...q, { batch, rows: [], error: e.message || String(e) }])
      }
    }
    setProgress(null)
  }

  const readBatch = (batch) => readBatches([batch])
  const readAllNew = () => readBatches(batches.filter((b) => b.status === 'new'))

  /* Suppliers are matched at RENDER time over the whole queue, not stored on
     each item — so filing a firm re-matches every bundle already read AND every
     one still being read, without touching what is in flight. */
  const matched = useMemo(() => {
    const all = queue.flatMap((q) => q.rows)
    const m = applySuppliers(all, suppliers)
    let at = 0
    const items = queue.map((q) => {
      const rows = m.rows.slice(at, at + q.rows.length)
      at += q.rows.length
      return { ...q, rows }
    })
    return { items, unknown: m.unknown }
  }, [queue, suppliers])

  async function fileSupplier(unknownName, existing) {
    setErr('')
    try {
      const s = existing
        ? await addAlias(existing, unknownName)
        : await createSupplier(fleetId, unknownName)
      setSuppliers((prev) => existing
        ? prev.map((x) => (x.id === s.id ? s : x))
        : [...prev, s].sort((a, b) => a.name.localeCompare(b.name)))
    } catch (e) { setErr(e.message || String(e)) }
  }

  const editRow = (batchId, i, patch) => setQueue((q) => q.map((item) =>
    item.batch.id !== batchId ? item
      : { ...item, rows: item.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))

  /* Saved bundle by bundle even from a "save all", so a failure part-way leaves
     the ones before it filed rather than rolling the whole afternoon back. */
  async function saveItems(items) {
    setErr(''); setMsg('')
    let saved = 0
    /* Vessel and category answers lifted off the rows being replaced — see
       carryDecisions(). Counted so a re-read can say it kept them. */
    let carried = 0
    const lost = [], bundles = 0
    for (const item of items) {
      if (!item.rows.length) continue
      try {
        const rows = matched.items.find((x) => x.batch.id === item.batch.id)?.rows || item.rows
        const out = await saveBatchInvoices(item.batch, rows, fleetId)
        saved += out.saved
        carried += out.carried
        lost.push(...out.lost)
        bundles++
        setQueue((q) => q.filter((x) => x.batch.id !== item.batch.id))
      } catch (e) {
        setErr(`Stopped at the bundle of ${fmtDate(String(item.batch.received_at).slice(0, 10))} — ${e.message || e}. `
          + (bundles ? `The ${bundles} before it ${bundles === 1 ? 'is' : 'are'} filed; the rest are still here.`
                     : 'Nothing was filed — everything is still here.'))
        break
      }
    }
    if (bundles) setMsg(
      `${saved} invoice${saved === 1 ? '' : 's'} filed off ${bundles} bundle${bundles === 1 ? '' : 's'}.`
      + (carried ? ` ${carried} boat or category decision${carried === 1 ? '' : 's'} carried over.` : '')
      /* NAMED, NOT COUNTED. A decision with no invoice left to sit on is one
         somebody has to make again, so it says which. */
      + (lost.length
          ? ` ${lost.length} could not be matched to anything in the new read and ${lost.length === 1 ? 'was' : 'were'} lost: `
            + lost.map((l) => `${l.supplier || 'unnamed'}${l.invoice_no ? ' ' + l.invoice_no : ''}`).join(', ') + '.'
          : '')
    )
    await refresh()
  }

  /* The shipped categories with the boat's own merged over them. */
  const cats = useMemo(() => resolveCategories(catSettings?.categories), [catSettings])
  /* Three hulls, all called AUDACIOUS BF83. */
  const eras = useMemo(() => resolveEras(catSettings?.eras), [catSettings])

  async function fileSupplierCategory(id, category) {
    setErr('')
    try {
      await setSupplierCategory(id, category)
      setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, category } : s)))
    } catch (e) { setErr(e.message || String(e)) }
  }

  /* SUGGEST, NEVER APPLY — the suggestions are FILLED IN and the skipper
     confirms them. £8m across ten years is a lot of money to have bucketed by a
     regex, and a firm nothing fits is left blank rather than swept into Other. */
  async function suggestAll() {
    /* The descriptions are read here as well as in the list. Off the name
       alone only 74 of this boat's 153 firms can be placed; what they have
       actually sold places most of the rest. */
    const sold = new Map()
    for (const i of invoices) {
      if (!i.supplier_id || !i.description) continue
      const arr = sold.get(i.supplier_id) || []
      if (arr.length < 8) { arr.push(i.description); sold.set(i.supplier_id, arr) }
    }
    const guesses = suppliers
      .filter((s) => !s.category)
      .map((s) => [s, suggestCategory(s.name, sold.get(s.id) || [])])
      .filter(([, g]) => g)
    if (!guesses.length) { setMsg('Nothing to suggest — every firm with a guessable name is filed.'); return }
    if (!window.confirm(
      `File ${guesses.length} firm${guesses.length === 1 ? '' : 's'} on the suggested category?\n\n`
      + 'Suggested from the firm’s own name. Each one is changeable afterwards, and any '
      + 'firm the guess could not place is left for you.')) return
    setErr('')
    try {
      await setSupplierCategories(guesses.map(([s, g]) => [s.id, g.key]))
      const map = new Map(guesses.map(([s, g]) => [s.id, g.key]))
      setSuppliers((prev) => prev.map((s) => (map.has(s.id) ? { ...s, category: map.get(s.id) } : s)))
      setMsg(`${guesses.length} filed on the suggestion. Check them in the grid below.`)
    } catch (e) { setErr(e.message || String(e)) }
  }

  /* The years the record covers, and the one being read. Defaults to the latest
     rather than to the calendar's year: if the last bundle in is from August
     2026 then 2026 is the year with something in it, and landing on an empty
     year would look like a boat that had stopped spending. */
  const years = useMemo(() => yearsCovered(invoices, on), [invoices, on])
  const shownYear = year ?? years[0] ?? new Date().getFullYear()

  /* A CELL OPENS THE INVOICES BEHIND IT. Everything lands in the one list with
     its filters filled in and showing, so the answer can be widened by hand the
     moment it is nearly right. */
  const drill = useCallback((f) => { setFilter({ q: '', ...f }); setTab('find') }, [])

  const openInvoice = useCallback((inv) => {
    if (!inv?.file_path) return
    openDocument(inv.file_path, inv.page_from).catch((e) => setErr(e.message || String(e)))
  }, [])

  /* WHEN THE WORK WAS DONE — the answer that moves a cost into the year it was
     incurred. Applied to a whole lump billing at once, because that is how it
     was billed: six engine jobs invoiced on one day are one visit, and asking
     six times is how the answer does not get given at all. */
  const setWork = useCallback(async (ids, from, to) => {
    setErr(''); setMsg('')
    try {
      await setInvoicesWork(ids, from, to)
      const f = from || null, t = to || null
      setInvoices((prev) => prev.map((i) =>
        (ids.includes(i.id) ? { ...i, work_from: f, work_to: t } : i)))
      const when = workLabel({ work_from: f, work_to: t })
      setMsg(ids.length + (ids.length === 1 ? ' invoice' : ' invoices')
        + (when ? ' put to work done ' + when + '.' : ' cleared of their work dates.')
        + ' Switch "Dated by" to Worked to see it move.')
    } catch (e) { setErr(e.message || String(e)) }
  }, [])

  const placeVessel = useCallback(async (ids, era) => {
    setErr('')
    try {
      await setInvoiceVessels(ids, era)
      setInvoices((prev) => prev.map((i) => (ids.includes(i.id) ? { ...i, vessel_era: era } : i)))
    } catch (e) { setErr(e.message || String(e)) }
  }, [])

  const setOneCategory = useCallback(async (id, category) => {
    setErr('')
    try {
      await setInvoiceCategory(id, category)
      setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, category } : i)))
    } catch (e) { setErr(e.message || String(e)) }
  }, [])

  if (!fleetId) return <AppShell maxWidth={1040}><PageHeader title="Invoices" /></AppShell>

  return (
    <AppShell maxWidth={1040}>
      <PageHeader
        eyebrow="Office → boat"
        title="Invoices"
        sub="The weekly bundle, split by supplier"
      />

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center',
                    marginBottom: '0.9rem' }}>
        <Tab id="dashboard" tab={tab} set={setTab}>The year</Tab>
        <Tab id="allyears" tab={tab} set={setTab}>All years</Tab>
        <Tab id="find" tab={tab} set={setTab}>Find an invoice</Tab>
        <Tab id="add" tab={tab} set={setTab}>
          + Invoice batch{queue.length ? ' · ' + queue.length + ' to check' : ''}
        </Tab>
        <span style={{ flex: 1 }} />
        {/* NET AND GROSS DIFFER BY £563,735 OF VAT, which is real money, so the
            basis is shown rather than one being quietly assumed. */}
        <Segmented label="Count" value={basis} onChange={setBasis} options={[
          { value: 'total', label: 'Gross', title: 'What left the account, VAT included' },
          { value: 'net', label: 'Net', title: 'Before VAT' },
        ]} />
        <Segmented label="Dated by" value={on} onChange={setOn} options={[
          { value: 'invoice', label: 'Billed', title: 'The date on the invoice' },
          { value: 'work', label: 'Worked', title: 'When the job was done, where that has been recorded' },
        ]} />
      </div>

      {err && <p className="error" style={{ marginTop: 0 }}>{err}</p>}
      {msg && <p className="muted" style={{ marginTop: 0 }}>{msg}</p>}
      {stage === 'uploading' && <p className="muted" style={{ marginTop: 0 }}>Uploading…</p>}

      {tab === 'dashboard' && (loading ? <p className="muted">Loading…</p> : (
        <YearDashboard invoices={invoices} suppliers={suppliers} cats={cats}
                       basis={basis} on={on} year={shownYear} setYear={setYear}
                       onDrill={drill} onOpen={openInvoice} />
      ))}

      {tab === 'allyears' && (loading ? <p className="muted">Loading…</p> : (
        <AllYears invoices={invoices} suppliers={suppliers} cats={cats} eras={eras}
                  basis={basis} on={on}
                  onDrill={drill} onFileSupplier={fileSupplierCategory}
                  onSuggestAll={suggestAll} onPlaceVessel={placeVessel} onSetWork={setWork} />
      ))}

      {tab === 'find' && (loading ? <p className="muted">Loading…</p> : (
        <FindInvoices invoices={invoices} suppliers={suppliers} cats={cats} eras={eras}
                      basis={basis} on={on} filter={filter} setFilter={setFilter}
                      onOpen={openInvoice} onSetWork={setWork}
                      onPlaceVessel={placeVessel} onSetCategory={setOneCategory} />
      ))}

      {/* ---- ADDING A BUNDLE, WHICH IS NOW ONE PDF ON A MONDAY --------------
          The drop, the unread bundles and the check-the-read are one flow in one
          place. They were three tabs because the initial load WAS a conveyor —
          364 bundles over a weekend — and a weekly arrival is not that.

          What does not change is that nothing is filed unlooked-at. The bundle is
          a photograph read by a model: a misread supplier is a miscategorised
          cost for ever, and a misread total is money. */}
      {tab === 'add' && (
        <>
          <Arrivals batches={batches} loading={loading} onRead={readBatch}
                    onReadAll={readAllNew} reading={!!progress}
                    busy={!!stage || !!progress} canUpload={!!boatId}
                    fileInput={fileInput} onUpload={uploadBundle}
                    onIgnore={async (b) => { await setBatchStatus(b.id, 'ignored'); refresh() }}
                    onDelete={async (b) => {
                      if (!window.confirm(
                        'Delete the bundle of ' + fmtDate(String(b.received_at).slice(0, 10)) + '?'
                        + '\n\nAny invoices already read out of it are KEPT — the cost stood '
                        + 'whether or not the scan does. Only the document goes.')) return
                      await deleteBatch(b.id); refresh()
                    }} />

          {(queue.length > 0 || progress) && (
            <Review items={matched.items} unknown={matched.unknown} suppliers={suppliers}
                    progress={progress} onStop={() => { cancelRead.current = true }}
                    onEdit={editRow} onFile={fileSupplier} onSave={saveItems}
                    onDrop={(id) => setQueue((q) => q.filter((x) => x.batch.id !== id))} />
          )}
        </>
      )}
    </AppShell>
  )
}

/* THE WAY IN, and it has to be the way in rather than a fallback.
 *
 * CloudMailin refuses anything over 512 KB and these bundles are 0.7-2.3 MB, so
 * the email route bounces every one — "552 Message size exceeds the allowed
 * size for this account". The same cap has been silently bouncing the bigger
 * settling sheets since that path was built: su_inbox has never taken a single
 * one. A sales note is small, which is why nobody found this until now.
 *
 * So the page SAYS why it is asking for the file rather than presenting an
 * upload box with no explanation, which reads as the email route having been
 * forgotten about. */
function Dropzone({ canUpload, fileInput, onUpload, busy }) {
  const [over, setOver] = useState(false)
  if (!canUpload) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        This fleet has no Square Up boat, so there is nowhere to file a bundle against.
      </p>
    )
  }
  return (
    <>
      <input ref={fileInput} type="file" accept="application/pdf,image/*" multiple
             style={{ display: 'none' }}
             onChange={(e) => onUpload(e.target.files)} />
      <div onClick={() => !busy && fileInput.current?.click()}
           onDragOver={(e) => { e.preventDefault(); setOver(true) }}
           onDragLeave={() => setOver(false)}
           onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) onUpload(e.dataTransfer.files) }}
           style={{
             border: '1px dashed ' + (over ? 'var(--hull)' : 'var(--line)'),
             background: over ? 'color-mix(in srgb, var(--hull) 8%, transparent)' : 'transparent',
             borderRadius: 6, padding: '1rem', textAlign: 'center',
             cursor: busy ? 'wait' : 'pointer', marginBottom: '0.8rem',
           }}>
        <b>{busy ? 'Adding…' : 'Drop the Monday bundle here'}</b>
        <div className="muted" style={{ fontSize: '0.82rem', marginTop: '0.25rem' }}>
          Save the PDF out of the email and drop it in, or click to choose. Several at once is fine.
        </div>
      </div>
      <p className="muted" style={{ fontSize: '0.78rem', marginTop: 0 }}>
        <b>Why not by email?</b> The forwarding address takes messages up to 512 KB and these
        bundles are 0.7–2.3 MB, so they bounce — <i>552 message size exceeds the allowed size
        for this account</i>. Sales notes are small, which is why they have always worked.
      </p>
    </>
  )
}

/* A TAB, NOT A STEP. It used to be a numbered chip in a left-to-right flow —
 * arrivals, then check, then costs — which was right while the whole page was a
 * conveyor for the initial load and is wrong now: three of the four tabs are
 * places you read, and only one is a thing you do. */
function Tab({ id, tab, set, children, disabled }) {
  const now = tab === id
  return (
    <button type="button" onClick={() => !disabled && set(id)} disabled={disabled}
            style={{
              font: 'inherit', fontSize: '0.88rem', fontWeight: now ? 700 : 500,
              padding: '0.34rem 0.8rem', borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.45 : 1,
              border: '1px solid ' + (now ? 'var(--hull)' : 'transparent'),
              background: now ? 'color-mix(in srgb, var(--hull) 12%, transparent)' : 'transparent',
              color: now ? 'var(--hull)' : 'var(--ink)',
            }}>
      {children}
    </button>
  )
}

/* ── 1 · ARRIVALS ──────────────────────────────────────────────────────────
 * What the email put here. A bundle is FILED, never read automatically — the
 * same rule as a settling sheet, and for the same reason: reading is a model
 * looking at a photograph, and it has to be checked before it becomes a cost. */
function Arrivals({ batches, loading, onRead, onReadAll, reading, onIgnore, onDelete, busy,
                   canUpload, fileInput, onUpload }) {
  if (loading) return <p className="muted">Loading…</p>
  const unread = batches.filter((b) => b.status === 'new')
  return (
    <div className="card">
      <Dropzone canUpload={canUpload} fileInput={fileInput} onUpload={onUpload} busy={busy} />
      {!batches.length && (
        <p className="muted" style={{ marginBottom: 0 }}>
          Nothing here yet. Save the Monday PDF out of your email and drop it above.
        </p>
      )}

      {/* READ THE LOT. Each bundle is a minute or two, so the run carries on in
          the background and the earliest can be checked while the rest are still
          going — which is the difference between waiting an hour and working
          through them. */}
      {unread.length > 1 && (
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap',
                      padding: '0.6rem 0', borderTop: '1px solid var(--line)' }}>
          <button onClick={onReadAll} disabled={busy}>
            {reading ? 'Reading…' : `Read all ${unread.length}`}
          </button>
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            About {Math.max(1, Math.round(unread.length * 1.5))} minutes. Check them as they
            land — nothing saves until you do.
          </span>
        </div>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {batches.map((b) => (
          <li key={b.id} style={{
            display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap',
            padding: '0.6rem 0', borderTop: '1px solid var(--line)',
          }}>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', minWidth: '7rem' }}>
              {fmtDate(String(b.received_at).slice(0, 10))}
            </span>
            <span style={{ flex: '1 1 12rem', fontSize: '0.88rem' }}>
              {b.subject || <span className="muted">no subject</span>}
              <span className="muted" style={{ display: 'block', fontSize: '0.76rem' }}>
                {b.from_email} · {b.page_count || '?'} page{b.page_count === 1 ? '' : 's'}
              </span>
            </span>

            {/* THE MANAGER'S BALANCE, off the sentence in the email. It exists
                nowhere else in this app, and the direction is the part that
                matters — the wrong way is a different world from to the good. */}
            {b.manager_balance != null && (
              <span title={b.manager_balance_text || ''}
                    style={{
                      fontSize: '0.76rem', padding: '0.1rem 0.45rem', borderRadius: 3,
                      whiteSpace: 'nowrap', color: '#fff',
                      background: Number(b.manager_balance) < 0 ? 'var(--rust)' : 'var(--kelp)',
                    }}>
                {money0(b.manager_balance)}{Number(b.manager_balance) < 0 ? ' against' : ' to the good'}
              </span>
            )}

            {b.invoiceCount > 0 && (
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                {b.invoiceCount} invoice{b.invoiceCount === 1 ? '' : 's'}
              </span>
            )}
            {b.status === 'ignored' && <span className="muted" style={{ fontSize: '0.76rem' }}>ignored</span>}

            <button className="secondary" onClick={() => onRead(b)} disabled={busy}>
              {b.invoiceCount ? 'Read again' : 'Read'}
            </button>
            <button className="secondary" onClick={async () => {
              const url = await signedUrl(b.file_path).catch(() => null)
              if (url) window.open(url, '_blank', 'noopener')
            }}>Open</button>
            {b.status !== 'ignored' && (
              <button className="secondary" onClick={() => onIgnore(b)}>Ignore</button>
            )}
            <button className="secondary" style={{ color: 'var(--rust)' }}
                    onClick={() => onDelete(b)}>Delete</button>
          </li>
        ))}
      </ul>
      <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0 }}>
        <b>Read again</b> replaces what was read out of that bundle before — a bundle
        read twice must not double the costs.
      </p>
    </div>
  )
}

/* ── 2 · CHECK THE READ ────────────────────────────────────────────────────
 * Every figure editable, and the firms nobody has filed named at the top. */
/* ── 2 · CHECK THE READ ────────────────────────────────────────────────────
 *
 * EVERY BUNDLE IN THE RUN, IN ONE LIST. Reading thirty-four bundles one at a
 * time was the complaint; being asked to Save thirty-four times would only move
 * the tedium rather than remove it.
 *
 * WHAT NEEDS A LOOK IS PULLED TO THE TOP. That is what keeps "nothing saves
 * unlooked-at" honest at this size: a row whose net and VAT do not come to its
 * total, one with no date, one whose firm is not on the list. Scrolling past
 * two hundred correct rows to find the three wrong ones is not checking — it is
 * hoping. So the doubtful ones are counted and marked, and everything is still
 * on screen and still editable.
 */
function Review({ items, unknown, suppliers, progress, onStop, onEdit, onFile, onSave, onDrop }) {
  const rows = items.flatMap((i) => i.rows)
  const total = rows.reduce((s, r) => s + (Number(r.total) || 0), 0)

  /* The three things worth stopping for, counted across the whole run. Each is
     a different KIND of doubt and they are not lumped together: an unfiled firm
     is a decision, a sum that does not add up is a misread, a missing date puts
     the cost in no period at all. */
  const flags = {
    firm: rows.filter((r) => !r.supplier_id).length,
    adds: rows.filter((r) => addsWrong(r)).length,
    date: rows.filter((r) => !r.invoice_date).length,
    /* A FIGURE THE READER DID NOT GET is its own doubt, and was the hole: net +
       VAT cannot disagree with a total that is not there, so a blank sailed
       past "figures that add up" and then failed on save. */
    figs: rows.filter((r) => figuresMissing(r).length).length,
  }
  const failed = items.filter((i) => i.error)

  return (
    <>
      {progress && (
        <div className="card" style={{ borderColor: 'var(--hull)' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <b>Reading {progress.done + 1} of {progress.total}</b>
            <span className="muted" style={{ flex: 1, fontSize: '0.84rem' }}>
              {progress.current
                ? fmtDate(String(progress.current.received_at).slice(0, 10))
                : ''} — a photograph takes a minute or two
            </span>
            <button className="secondary" onClick={onStop}>Stop after this one</button>
          </div>
          {/* THE POINT OF THE QUEUE: check the ones already read while the rest
              are still going. */}
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
            Carry on checking below — the rest keep reading while you do.
            Leaving the page stops the run; anything already saved stays saved.
          </p>
        </div>
      )}

      {failed.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--rust)' }}>
          <b>{failed.length} bundle{failed.length === 1 ? '' : 's'} could not be read</b>
          <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', fontSize: '0.86rem' }}>
            {failed.map((f) => {
              /* WHAT IT MEANS FIRST, the raw text underneath. "Your credit
                 balance is too low" arrives wrapped in JSON, and a skipper
                 reading that cannot tell a billing card from a broken book. */
              const e = explainReadError(f.error)
              return (
                <li key={f.batch.id} style={{ marginBottom: '0.35rem' }}>
                  {fmtDate(String(f.batch.received_at).slice(0, 10))} — <b>{e.what}</b>{' '}
                  <button className="secondary" style={{ padding: '0 0.4rem', fontSize: '0.74rem' }}
                          onClick={() => onDrop(f.batch.id)}>dismiss</button>
                  {e.next && <div className="muted" style={{ fontSize: '0.82rem' }}>{e.next}</div>}
                  {e.next && (
                    <details style={{ fontSize: '0.76rem' }}>
                      <summary className="muted" style={{ cursor: 'pointer' }}>what it said</summary>
                      <code style={{ wordBreak: 'break-all' }}>{e.raw}</code>
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
            The files are still on the Arrivals tab and can be read again.
          </p>
        </div>
      )}

      {!items.length && !progress && (
        <div className="card"><p style={{ margin: 0 }}>
          Nothing waiting to be checked. Read a bundle on the Arrivals tab.
        </p></div>
      )}

      {/* FILING A FIRM COMES FIRST, because it changes every row that names it —
          across every bundle in the queue at once, which is most of the value of
          reading them together. */}
      {unknown.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--brass)' }}>
          <h3 style={{ margin: '0 0 0.3rem', fontSize: '0.95rem' }}>
            {unknown.length} firm{unknown.length === 1 ? '' : 's'} not on your list yet
          </h3>
          <p className="muted" style={{ margin: '0 0 0.7rem', fontSize: '0.82rem' }}>
            File one and every invoice naming it lines up, in this run and the next.
            Leave it and it still saves — under the name as read, which is how one firm
            ends up looking like four.
          </p>
          {unknown.map((u) => (
            <UnknownFirm key={u.key} u={u} suppliers={suppliers} onFile={onFile} />
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="card" style={{ position: 'sticky', top: 0, zIndex: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                        flexWrap: 'wrap', gap: '0.5rem' }}>
            <b>{rows.length} invoice{rows.length === 1 ? '' : 's'} off {items.length} bundle
              {items.length === 1 ? '' : 's'}</b>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700 }}>{money(total)}</span>
          </div>

          {/* WHAT WANTS A LOOK, named separately rather than as one count. */}
          <p style={{ margin: '0.4rem 0 0.6rem', fontSize: '0.84rem' }}>
            {flags.firm + flags.adds + flags.date + flags.figs === 0
              ? <span className="muted">Nothing flagged — every row has a filed firm, a date, and figures that add up.</span>
              : <>
                  <b>Worth a look:</b>{' '}
                  {[flags.firm && `${flags.firm} with no firm filed`,
                    flags.adds && `${flags.adds} where net + VAT ≠ total`,
                    flags.figs && `${flags.figs} with a figure the reader missed`,
                    flags.date && `${flags.date} with no date`]
                    .filter(Boolean).join(' · ')}
                </>}
          </p>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button onClick={() => onSave(items)}>
              Save all {rows.length}
            </button>
            <span className="muted" style={{ fontSize: '0.8rem', alignSelf: 'center' }}>
              or save a bundle at a time below
            </span>
          </div>
        </div>
      )}

      {items.filter((i) => i.rows.length).map((item) => (
        <div key={item.batch.id} className="card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap',
                        borderBottom: '1px solid var(--line)', paddingBottom: '0.4rem' }}>
            <b style={{ fontFamily: 'var(--font-mono, monospace)' }}>
              {fmtDate(String(item.batch.received_at).slice(0, 10))}
            </b>
            <span className="muted" style={{ flex: 1, fontSize: '0.82rem' }}>
              {item.rows.length} invoice{item.rows.length === 1 ? '' : 's'} ·{' '}
              {money(item.rows.reduce((s, r) => s + (Number(r.total) || 0), 0))} ·{' '}
              {item.batch.page_count || '?'} page{item.batch.page_count === 1 ? '' : 's'}
            </span>
            <button className="secondary" onClick={async () => {
              const url = await signedUrl(item.batch.file_path).catch(() => null)
              if (url) window.open(url, '_blank', 'noopener')
            }}>Open the scan</button>
            <button className="secondary" onClick={() => onSave([item])}>Save these</button>
            <button className="secondary" onClick={() => onDrop(item.batch.id)}>Discard</button>
          </div>

          {item.rows.map((r, i) => (
            <InvoiceRow key={i} r={r} filePath={item.batch.file_path}
                       pageCount={item.batch.page_count}
                       onChange={(patch) => onEdit(item.batch.id, i, patch)} />
          ))}
        </div>
      ))}
    </>
  )
}

function InvoiceRow({ r, filePath, pageCount, onChange }) {
  const bad = addsWrong(r)
  const missing = figuresMissing(r)
  /* The left edge carries the state at a glance down a long list: green filed,
     brass a firm to file, rust a sum that does not add up. */
  /* A page number is only worth offering if it could be true: a whole number,
     at least 1, and inside a document that has that many pages. */
  const asPage = (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 ? Number(v) : null)
  const pageAt = asPage(r.page_from)
  /* Refused rather than reversed, the same rule the pages follow: which of
     the two dates is wrong is not knowable. */
  const workBad = !!r.work_from && !!r.work_to && r.work_to < r.work_from
  const overrun = !!pageCount && [r.page_from, r.page_to].some((v) => asPage(v) > pageCount)
  const edge = bad || missing.length ? 'var(--rust)'
    : r.supplier_id ? 'var(--kelp)' : 'var(--brass)'
  return (
    <div style={{
      border: '1px solid var(--line)', borderRadius: 4, padding: '0.6rem',
      marginTop: '0.5rem', borderLeftWidth: 3, borderLeftColor: edge,
    }}>
      <div style={{ display: 'grid', gap: '0.4rem',
                    gridTemplateColumns: 'minmax(9rem, 2fr) minmax(6rem, 1fr) minmax(7rem, 1fr)' }}>
        <label>
          <span className="muted" style={{ fontSize: '0.72rem' }}>Supplier</span>
          <input value={r.supplier} onChange={(e) => onChange({ supplier: e.target.value })}
                 style={{ width: '100%' }} />
        </label>
        <label>
          <span className="muted" style={{ fontSize: '0.72rem' }}>Invoice no.</span>
          <input value={r.invoice_no} onChange={(e) => onChange({ invoice_no: e.target.value })}
                 style={{ width: '100%' }} />
        </label>
        <label>
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            Date{!r.invoice_date && <span style={{ color: 'var(--brass)' }}> · missing</span>}
          </span>
          <input type="date" value={r.invoice_date || ''}
                 onChange={(e) => onChange({ invoice_date: e.target.value })}
                 style={{ width: '100%' }} />
        </label>
      </div>

      <label style={{ display: 'block', marginTop: '0.4rem' }}>
        <span className="muted" style={{ fontSize: '0.72rem' }}>What for</span>
        <input value={r.description} onChange={(e) => onChange({ description: e.target.value })}
               style={{ width: '100%' }} />
      </label>

      <div style={{ display: 'grid', gap: '0.4rem', marginTop: '0.4rem',
                    gridTemplateColumns: 'repeat(3, minmax(5rem, 1fr))' }}>
        {['net', 'vat', 'total'].map((f) => (
          <label key={f}>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              {f === 'total' ? 'Total' : f.toUpperCase()}
              {missing.includes(f) && <span style={{ color: 'var(--rust)' }}> · not read</span>}
            </span>
            <input value={r[f] ?? ''} inputMode="decimal"
                   onChange={(e) => onChange({ [f]: e.target.value })}
                   style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)' }} />
          </label>
        ))}
      </div>
      {/* WHEN THE WORK WAS DONE, if the invoice says.
        *
        * Filled in HERE where it is cheapest — the scan is open, the reader has
        * just been through it, and a service invoice normally prints its job
        * dates. Left blank the cost counts on the invoice date exactly as every
        * one of the 2,625 already filed does; there is no second date anybody
        * has to supply before the page works. */}
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-end', flexWrap: 'wrap',
                    marginTop: '0.4rem' }}>
        <label style={{ width: '9rem' }}>
          <span className="muted" style={{ fontSize: '0.72rem' }}>Work done from</span>
          <input type="date" value={r.work_from || ''} style={{ width: '100%' }}
                 onChange={(e) => onChange({ work_from: e.target.value })} />
        </label>
        <label style={{ width: '9rem' }}>
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            to{workBad && <span style={{ color: 'var(--rust)' }}> · before the start</span>}
          </span>
          <input type="date" value={r.work_to || ''} style={{ width: '100%' }}
                 onChange={(e) => onChange({ work_to: e.target.value })} />
        </label>
        <span className="muted" style={{ fontSize: '0.76rem', flex: '1 1 12rem' }}>
          {r.work_from
            ? 'Counted in ' + String(r.work_from).slice(0, 4)
              + (r.work_to && String(r.work_to).slice(0, 4) !== String(r.work_from).slice(0, 4)
                  ? '–' + String(r.work_to).slice(0, 4) + ', divided by days' : '')
              + ' when the grid is dated by work.'
            : 'Blank counts it on the invoice date, which is the usual case.'}
        </span>
      </div>


      {/* WHICH PAGES OF THE BUNDLE THIS ONE IS.
        *
        * A bundle is a whole week in one file, so checking a read against the
        * scan meant opening five pages and hunting. This is the only field the
        * reader returns that nothing downstream can check against the invoice
        * itself, so a page it was unsure of comes back blank and says so —
        * a wrong page opens at the wrong invoice and looks certain doing it. */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4rem',
                    marginTop: '0.4rem', flexWrap: 'wrap' }}>
        {['page_from', 'page_to'].map((f) => (
          <label key={f} style={{ width: '4.2rem' }}>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              {f === 'page_from' ? 'Page' : 'to'}
            </span>
            <input value={r[f] ?? ''} inputMode="numeric"
                   onChange={(e) => onChange({ [f]: e.target.value })}
                   style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)' }} />
          </label>
        ))}
        <button className="secondary" type="button"
                onClick={() => openDocument(filePath, r.page_from).catch(() => {})}>
          {pageAt ? 'Open at page ' + pageAt : 'Open the scan'}
        </button>
        {!pageAt && (
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            the reader could not say which page this is
          </span>
        )}
        {overrun && (
          <span style={{ fontSize: '0.78rem', color: 'var(--rust)' }}>
            this bundle is only {pageCount} pages
          </span>
        )}
      </div>

      {/* SAY WHAT A BLANK WILL BECOME. The column will not take a null, so it
          goes in as 0 — and a 0 the document never showed must not read like
          one it did. Saved either way; the record keeps that nobody read it. */}
      {missing.length > 0 && (
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: 'var(--rust)' }}>
          The reader did not get {missing.join(', ').toUpperCase()} off this one.
          Fill {missing.length === 1 ? 'it' : 'them'} in, or it saves as nought and
          is marked as never read.
        </p>
      )}
      {bad && (
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: 'var(--rust)' }}>
          Net and VAT come to {money(Number(r.net) + Number(r.vat))}, not {money(r.total)} —
          out by {money(Number(r.net) + Number(r.vat) - Number(r.total))}. One of the three is misread.
        </p>
      )}
    </div>
  )
}
function UnknownFirm({ u, suppliers, onFile }) {
  const [pick, setPick] = useState('')
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap',
                  padding: '0.35rem 0', borderTop: '1px solid var(--line)' }}>
      <span style={{ flex: '1 1 12rem' }}>
        <b>{u.name}</b>
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          {' '}· {u.count} invoice{u.count === 1 ? '' : 's'} · {money(u.total)}
        </span>
      </span>
      <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: '13rem' }}>
        <option value="">add as a new firm</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>same as {s.name}</option>)}
      </select>
      <button className="secondary"
              onClick={() => onFile(u.name, pick ? suppliers.find((s) => s.id === pick) : null)}>
        File
      </button>
    </div>
  )
}

