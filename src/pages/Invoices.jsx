import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import {
  listBatches, listInvoices, listSuppliers, createSupplier, addAlias,
  saveBatchInvoices, setBatchStatus, deleteBatch, applySuppliers, storeRead, clearRead,
  setSupplierCategory, setSupplierCategories, loadCategorySettings,
  setInvoiceVessels, setInvoicesWork, setInvoiceCategory,
} from '../lib/su/invoices'
import { parseDocuments, DOC_TYPES, mapInvoices, signedUrl, openDocument } from '../lib/su/parse'
import { suggestCategory, resolveCategories } from '../lib/invoices/categories'
import { resolveEras } from '../lib/invoices/vessels'
import { yearsCovered } from '../lib/invoices/dashboard'
import { workLabel } from '../lib/invoices/when'
import { arrivalFromName, arrivalSubject } from '../lib/invoices/arrival'
import YearDashboard from './invoices/YearDashboard'
import AllYears from './invoices/AllYears'
import FindInvoices from './invoices/FindInvoices'
import { Segmented } from './invoices/shared'
import Arrivals from './invoices/Arrivals'
import Review from './invoices/Review'

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
      let dated = 0
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

        /* WHEN IT ARRIVED, OFF THE FILE NAME. `received_at` defaults to now(),
           so without this every bundle dropped on the page claims to have
           arrived today — which is exactly how all 364 of the original load came
           to claim 1-2 September and needed a migration to put right. The date
           is on the front of the name because gmail-attachments.gs puts it
           there; nothing was reading it. Null where there is none, so the column
           falls back to now() and is wrong for that one bundle rather than
           quietly wrong for all of them. */
        const arrived = arrivalFromName(f.name)
        if (arrived) dated++

        const { error: ie } = await supabase.from('su_invoice_batches').insert({
          fleet_id: fleetId, boat_id: boatId,
          file_path: path, filename: f.name, bytes: f.size, page_count: pages,
          ...(arrived ? { received_at: arrived } : {}),
          /* NO manager's balance. It lives in the sentence Denise writes in the
             email body, and a file dropped in has no body. Blank is honest;
             carrying the last one forward would be a figure nobody stated. */
          subject: arrivalSubject(f.name), from_email: null,
        })
        if (ie) throw ie
      }
      setMsg(`${list.length} bundle${list.length === 1 ? '' : 's'} added. `
        /* SAID OUT LOUD, because a wrong arrival date is invisible afterwards —
           it looks exactly like a real one. */
        + (dated === list.length
            ? `Arrival date${list.length === 1 ? '' : 's'} read off the file name${list.length === 1 ? '' : 's'}. `
            : dated
              ? `${dated} carried an arrival date in the file name; the other ${list.length - dated} are filed as arriving today. `
              : `No arrival date in the file name${list.length === 1 ? '' : 's'}, so ${list.length === 1 ? 'it is' : 'they are'} filed as arriving today. `)
        + `Read ${list.length === 1 ? 'it' : 'them'} below.`)
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
    /* 'add', NOT 'review'. There has been no tab called `review` since the page
       became a dashboard — the checking moved INSIDE the add tab, and this line
       was left behind. Setting a tab that matches no branch renders the header,
       the tab strip and nothing else, so pressing Read blanked the page and the
       only way back was to leave and return. David: "the page goes blank when i
       choose to read the invoices ... need to come off it and back again." */
    setTab('add')

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

  /* LEAVING ONE OUT IS THE WHOLE ANSWER TO A DUPLICATE, so it is one tap and it
     happens before anything is filed. Nothing is deleted — the row is simply
     not saved, and reading the bundle again brings it back if this was wrong. */
  const dropRow = (batchId, i) => setQueue((q) => q.map((item) =>
    item.batch.id !== batchId ? item
      : { ...item, rows: item.rows.filter((_, j) => j !== i) }))

  /* Saved bundle by bundle even from a "save all", so a failure part-way leaves
     the ones before it filed rather than rolling the whole afternoon back. */
  /* DISCARD PUTS THE BUNDLE BACK, it does not make it disappear.
   *
   * It used to be `setQueue(q => q.filter(...))` and nothing else — the card
   * left the screen and NOTHING WAS WRITTEN DOWN. But reading a bundle sets its
   * status to `read` and stores the result, so a discarded bundle was left
   * `read` with no invoices: past `readAllNew()`, which only offers `new`; gone
   * from the queue; absent from the record. **Invisible to every part of this
   * page at once.** David hit it on the first two bundles of the 290 —
   * "trying to discard them and upload again but this one won't discard" — and
   * re-uploading is what you resort to when the thing has no way back.
   *
   * So it goes back to unread, and the stored read is cleared with it. The
   * bundle returns to the arrivals list where it came from and can be read
   * again. Deleting it is a different act with its own button, and it should be:
   * the arrival is the record that the scan exists at all.
   *
   * THE COST OF BEING WRONG DECIDES THE DIRECTION. Back-to-unread costs another
   * read if he really did want rid of it; leaving it `read` loses the bundle
   * with nothing on screen to say so. */
  async function dropBundle(id) {
    setQueue((q) => q.filter((x) => x.batch.id !== id))
    try {
      await clearRead(id)
      await refresh()
      setMsg('Put back as unread. It is in Arrivals and can be read again.')
    } catch (e) {
      /* NAMED, NOT SWALLOWED. The card has already gone from the screen, so a
         silent failure here is exactly the limbo this function exists to end. */
      setErr('Taken off the list, but it could not be put back as unread — '
        + (e.message || String(e)) + ' It may still show as read with no invoices.')
    }
  }

  async function saveItems(items) {
    setErr(''); setMsg('')
    let saved = 0
    /* Vessel and category answers lifted off the rows being replaced — see
       carryDecisions(). Counted so a re-read can say it kept them. */
    let carried = 0
    /* `let`, not `const`. As `const lost = [], bundles = 0` the `bundles++`
       below threw "Assignment to constant variable" on EVERY save — after
       saveBatchInvoices had already filed the rows, so the invoices went in,
       the catch reported "Stopped at the bundle of ...", and setQueue never ran
       so the card stayed on screen looking unsaved. Shipped in 0b86852 and
       invisible to the build, because assigning to a const is perfectly valid
       JavaScript right up until it runs. */
    const lost = []
    let bundles = 0
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

  /* A TAB ID THAT MATCHES NO BRANCH MUST NOT RENDER AN EMPTY PAGE.
     `setTab('review')` survived the rebuild that replaced the review tab with a
     step inside "add", and the result was a page with a header, a tab strip and
     nothing under it — which reads as broken rather than as a bug in one line.
     Falling back to the dashboard means the worst a stale id can now do is show
     the wrong tab, which is visible and recoverable. */
  const TABS = ['dashboard', 'allyears', 'find', 'add']
  const shownTab = TABS.includes(tab) ? tab : 'dashboard'

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
        <Tab id="dashboard" tab={shownTab} set={setTab}>The year</Tab>
        <Tab id="allyears" tab={shownTab} set={setTab}>All years</Tab>
        <Tab id="find" tab={shownTab} set={setTab}>Find an invoice</Tab>
        <Tab id="add" tab={shownTab} set={setTab}>
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

      {shownTab === 'dashboard' && (loading ? <p className="muted">Loading…</p> : (
        <YearDashboard invoices={invoices} suppliers={suppliers} cats={cats}
                       basis={basis} on={on} year={shownYear} setYear={setYear}
                       onDrill={drill} onOpen={openInvoice} />
      ))}

      {shownTab === 'allyears' && (loading ? <p className="muted">Loading…</p> : (
        <AllYears invoices={invoices} suppliers={suppliers} cats={cats} eras={eras}
                  basis={basis} on={on}
                  onDrill={drill} onFileSupplier={fileSupplierCategory}
                  onSuggestAll={suggestAll} onPlaceVessel={placeVessel} onSetWork={setWork} />
      ))}

      {shownTab === 'find' && (loading ? <p className="muted">Loading…</p> : (
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
      {shownTab === 'add' && (
        <>
          {/* WHAT IS WAITING TO BE CHECKED COMES FIRST.
              It used to sit under the arrivals list, which was fine when that
              list was a handful of Mondays. After the date backfill it is 362
              bundles going back to 2015, so the one thing actually asking for a
              decision was below a decade of history and you had to scroll past
              all of it — David: "the ones i need to deal with are at foot of
              page. again confusing."

              A read costs money and a bundle is not filed until somebody looks
              at it, so when there IS something to look at, it is the page. The
              arrivals list is a record and can wait underneath. */}
          {(queue.length > 0 || progress) && (
            <Review items={matched.items} unknown={matched.unknown} suppliers={suppliers}
                    filed={invoices}
                    onOpenScan={(b) => openDocument(b.file_path)}
                    onOpenPage={(path, page) => openDocument(path, page)}
                    progress={progress} onStop={() => { cancelRead.current = true }}
                    onEdit={editRow} onDropRow={dropRow} onFile={fileSupplier} onSave={saveItems}
                    onDrop={dropBundle} />
          )}

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
        </>
      )}
    </AppShell>
  )
}

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
