import React, { useMemo, useState } from 'react'
import { findInvoices } from '../../lib/invoices/find'
import { categoryOf, categoryLabel } from '../../lib/invoices/categories'
import { vesselOf, eraLabel } from '../../lib/invoices/vessels'
import { yearShares, workLabel } from '../../lib/invoices/when'
import { money, money0, fmtDate, MONO, Panel } from './shared'

/* FINDING ONE INVOICE AMONG 2,625 — and the place every cell in the grid opens
 * into.
 *
 * There was no way to see a single invoice anywhere on this page: ten years of
 * costs, totalled every way, and the one question a person actually arrives
 * with — "what was that Scantrol bill" — had no answer at all.
 *
 * IT IS ONE LIST, AND EVERY DRILL-THROUGH LANDS IN IT with its filters filled
 * in and visible. A grid cell could have opened its own little pop-up of rows,
 * and then there would be two lists of invoices that could disagree about what
 * an invoice is. Landing here instead means the filters can be widened by hand
 * the moment the answer is nearly right — which is what actually happens.
 */
const PAGE = 60

export default function FindInvoices({
  invoices, suppliers, cats, eras, basis, on, filter, setFilter,
  onOpen, onSetWork, onPlaceVessel, onSetCategory, onEdit, onDelete,
}) {
  const [limit, setLimit] = useState(PAGE)
  const byId = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers])

  const res = useMemo(() => findInvoices(invoices, {
    ...filter,
    basis,
    suppliers,
    yearOf: (inv) => (filter.undated
      ? (yearShares(inv, on).length ? [] : [null])
      : yearShares(inv, on).map((s) => s.year)),
    categoryFor: (inv) => categoryOf(inv, byId) || null,
    eraFor: (inv) => vesselOf(inv, eras),
  }), [invoices, filter, basis, on, suppliers, byId, eras])

  const set = (patch) => { setLimit(PAGE); setFilter({ ...filter, ...patch }) }
  const clear = () => { setLimit(PAGE); setFilter({ q: '' }) }

  const active = [
    filter.year != null && `${filter.year}`,
    filter.undated && 'no date',
    filter.category !== undefined && filter.category !== null && categoryLabel(filter.category, cats),
    filter.category === null && filter.categorySet && 'not filed to a category',
    filter.supplierId && (byId.get(filter.supplierId)?.name || 'one firm'),
    filter.era && eraLabel(filter.era, eras),
  ].filter(Boolean)

  return (
    <>
      <Panel>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '2 1 16rem' }}>
            <span className="muted" style={{ fontSize: '0.74rem', display: 'block' }}>
              Firm, invoice number, what it was for, an amount
            </span>
            <input value={filter.q || ''} onChange={(e) => set({ q: e.target.value })}
                   placeholder="scantrol · jackson 2024 · 5200"
                   style={{ width: '100%' }} />
          </label>
          <label style={{ flex: '1 1 9rem' }}>
            <span className="muted" style={{ fontSize: '0.74rem', display: 'block' }}>Firm</span>
            <select value={filter.supplierId || ''} style={{ width: '100%' }}
                    onChange={(e) => set({ supplierId: e.target.value || null })}>
              <option value="">any firm</option>
              {suppliers.slice().sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={{ flex: '1 1 8rem' }}>
            <span className="muted" style={{ fontSize: '0.74rem', display: 'block' }}>What for</span>
            <select value={filter.category ?? ''} style={{ width: '100%' }}
                    onChange={(e) => set({ category: e.target.value || undefined, categorySet: !!e.target.value })}>
              <option value="">any trade</option>
              {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label style={{ flex: '0 1 7rem' }}>
            <span className="muted" style={{ fontSize: '0.74rem', display: 'block' }}>Sort</span>
            <select value={(filter.sort || 'date') + ':' + (filter.dir || 'desc')}
                    style={{ width: '100%' }}
                    onChange={(e) => {
                      const [sort, dir] = e.target.value.split(':')
                      set({ sort, dir })
                    }}>
              <option value="date:desc">newest</option>
              <option value="date:asc">oldest</option>
              <option value="amount:desc">dearest</option>
              <option value="amount:asc">cheapest</option>
              <option value="supplier:asc">by firm</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap',
                      marginTop: '0.6rem' }}>
          <b style={{ fontFamily: MONO }}>{res.count.toLocaleString('en-GB')}</b>
          <span className="muted" style={{ fontSize: '0.84rem' }}>
            of {invoices.length.toLocaleString('en-GB')} invoices ·{' '}
          </span>
          <b style={{ fontFamily: MONO }}>{money(res.total)}</b>
          <span style={{ flex: 1 }} />
          {active.length > 0 && (
            <>
              <span className="muted" style={{ fontSize: '0.8rem' }}>{active.join(' · ')}</span>
              <button className="secondary" onClick={clear}>Clear</button>
            </>
          )}
        </div>
      </Panel>

      {/* A TERM THAT MATCHES NOTHING RETURNS NOTHING. "No invoice says that" is
          an answer; a full list handed back as a result is not. */}
      {res.count === 0 ? (
        <Panel><p style={{ margin: 0 }}>
          Nothing matches{filter.q ? <> <b>{filter.q}</b></> : ''}
          {active.length ? ` in ${active.join(' · ')}` : ''}.
          {' '}Try fewer words, or <button className="secondary" onClick={clear}>clear the filters</button>.
        </p></Panel>
      ) : (
        <Panel pad={false}>
          {res.rows.slice(0, limit).map((inv) => (
            <InvoiceLine key={inv.id} inv={inv} basis={basis} cats={cats} eras={eras}
                         supplier={byId.get(inv.supplier_id)}
                         onOpen={onOpen} onSetWork={onSetWork}
                         onPlaceVessel={onPlaceVessel} onSetCategory={onSetCategory}
                         onEdit={onEdit} onDelete={onDelete} />
          ))}
          {res.count > limit && (
            <div style={{ paddingTop: '0.6rem', borderTop: '1px solid var(--line)' }}>
              <button className="secondary" onClick={() => setLimit(limit + PAGE * 4)}>
                Show more — {(res.count - limit).toLocaleString('en-GB')} still hidden, worth{' '}
                {money0(res.rows.slice(limit).reduce((t, i) => t + (Number(i[basis]) || 0), 0))}
              </button>
            </div>
          )}
        </Panel>
      )}
    </>
  )
}

/* ONE INVOICE, AND EVERY DECISION ABOUT IT IN ONE PLACE.
 *
 * The three things only a person can answer — which boat, what trade, when the
 * work was done — sit behind one toggle rather than on the row, because the
 * common case is reading, not deciding. Opening the scan is on the row, because
 * that IS the common case. */
function InvoiceLine({ inv, basis, cats, eras, supplier, onOpen, onSetWork, onPlaceVessel,
                      onSetCategory, onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(inv.work_from || '')
  const [to, setTo] = useState(inv.work_to || '')
  const work = workLabel(inv)
  const bad = from && to && to < from

  /* THE FIGURES, AND THEY ARE A DIFFERENT KIND OF THING FROM THE THREE ABOVE.
     Which boat, what trade and when the work was done are ANSWERS the invoice
     cannot give. These are CORRECTIONS to what the reader took off the scan —
     so they are behind their own toggle, they ask why, and they keep what the
     row said before. */
  const [fixing, setFixing] = useState(false)
  const [f, setF] = useState({})
  const [why, setWhy] = useState('')
  const val = (k) => (f[k] !== undefined ? f[k] : (inv[k] ?? ''))
  const put = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const patch = {}
  for (const k of ['supplier', 'invoice_no', 'invoice_date', 'net', 'vat', 'total',
                   'currency', 'description', 'page_from', 'page_to']) {
    if (f[k] !== undefined && String(f[k]) !== String(inv[k] ?? '')) patch[k] = f[k]
  }
  const changed = Object.keys(patch)

  const [killing, setKilling] = useState(false)
  const [killWhy, setKillWhy] = useState('')

  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '0.42rem 0' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: MONO, fontSize: '0.78rem', minWidth: '5.4rem',
                       color: inv.invoice_date ? undefined : 'var(--brass)' }}>
          {inv.invoice_date || 'no date'}
        </span>
        <span style={{ flex: '2 1 14rem', fontSize: '0.86rem' }}>
          {supplier?.name || inv.supplier || 'no supplier'}
          {inv.description && (
            <span className="muted" style={{ display: 'block', fontSize: '0.76rem' }}>
              {inv.description}
            </span>
          )}
        </span>
        <span className="muted" style={{ fontSize: '0.74rem', minWidth: '4rem' }}>
          {inv.invoice_no || '—'}
        </span>
        <span style={{ fontFamily: MONO, fontSize: '0.88rem', minWidth: '6rem',
                       textAlign: 'right', fontWeight: 600 }}>
          {money(inv[basis])}
        </span>
        {inv.file_path && (
          <button className="secondary" style={{ padding: '0.12rem 0.5rem', fontSize: '0.74rem' }}
                  onClick={() => onOpen(inv)}
                  title={inv.page_from ? `opens the scan at page ${inv.page_from}`
                                       : 'opens the scan — no page was read for this one'}>
            {inv.page_from ? `p. ${inv.page_from}${inv.page_to && inv.page_to !== inv.page_from ? '–' + inv.page_to : ''}` : 'scan'}
          </button>
        )}
        <button className="secondary" style={{ padding: '0.12rem 0.5rem', fontSize: '0.74rem' }}
                onClick={() => setOpen(!open)}>{open ? 'done' : 'edit'}</button>
      </div>

      <div className="muted" style={{ fontSize: '0.74rem', marginTop: 2 }}>
        {categoryLabel(inv.category || supplier?.category || null, cats)}
        {inv.category && ' (this invoice)'}
        {' · '}{eraLabel(vesselOf(inv, eras), eras)}
        {inv.vessel_era && ' (settled)'}
        {work && <> · <b>work {work}</b></>}
      </div>

      {open && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end',
                      marginTop: '0.45rem', paddingLeft: '0.2rem' }}>
          <label style={{ fontSize: '0.74rem' }}>
            <span className="muted" style={{ display: 'block' }}>Work done from</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label style={{ fontSize: '0.74rem' }}>
            <span className="muted" style={{ display: 'block' }}>to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button disabled={bad} onClick={() => onSetWork([inv.id], from, to)}>Save the dates</button>
          {bad && <span style={{ color: 'var(--rust)', fontSize: '0.76rem' }}>
            the end is before the start
          </span>}

          <label style={{ fontSize: '0.74rem' }}>
            <span className="muted" style={{ display: 'block' }}>What for, this invoice only</span>
            <select value={inv.category || ''} onChange={(e) => onSetCategory(inv.id, e.target.value || null)}>
              <option value="">— its firm's category —</option>
              {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>

          <label style={{ fontSize: '0.74rem' }}>
            <span className="muted" style={{ display: 'block' }}>Which boat</span>
            <select value={inv.vessel_era || ''} onChange={(e) => onPlaceVessel([inv.id], e.target.value || null)}>
              <option value="">— from the date —</option>
              {eras.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
            </select>
          </label>

          {(onEdit || onDelete) && (
            <div style={{ flex: '1 1 100%', display: 'flex', gap: '0.4rem', marginTop: '0.2rem' }}>
              {onEdit && (
                <button className="secondary" style={{ fontSize: '0.74rem' }}
                        onClick={() => { setFixing(!fixing); setKilling(false) }}>
                  {fixing ? 'leave the figures' : 'Correct the figures'}
                </button>
              )}
              {onDelete && (
                <button className="secondary" style={{ fontSize: '0.74rem', color: 'var(--rust)' }}
                        onClick={() => { setKilling(!killing); setFixing(false) }}>
                  {killing ? 'keep it' : 'Remove this invoice'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- CORRECTING WHAT WAS READ OFF THE SCAN ------------------------
          Every one of these came off a model reading a photograph, and this
          record already holds a £100,612 total copied from the invoice beside
          it and a VAT of 20 that was really 20 PENCE. Until now the only way
          to put one right was a hand-written UPDATE. */}
      {open && fixing && onEdit && (
        <CorrectFigures inv={inv} val={val} put={put} changed={changed}
                        why={why} setWhy={setWhy}
                        onSave={() => { onEdit(inv.id, patch, why); setFixing(false); setF({}); setWhy('') }} />
      )}

      {/* ---- REMOVING ONE ------------------------------------------------
          The confirmation states the money, because that is what is leaving
          the totals. `su_*` has no audit trail of its own, so the whole row is
          snapshotted in the same statement that removes it — this is the first
          delete on this table that records itself. */}
      {open && killing && onDelete && (
        <RemoveInvoice inv={inv} supplier={supplier} why={killWhy} setWhy={setKillWhy}
                       onRemove={() => { onDelete(inv, killWhy); setKilling(false) }} />
      )}
    </div>
  )
}

/* ---- THE TWO PANELS, AS COMPONENTS OF THEIR OWN -------------------------
 *
 * Exported and prop-driven for the same reason as Review.jsx and SelfCertBody:
 * they sit behind row state, so a server render of the list can never reach
 * them, and this page is behind a login and a fleet. A build passing proves
 * nothing here — an undefined identifier is valid JavaScript, and this repo has
 * already shipped a commit where two pages called a function they never
 * imported. scripts/invoices-page-preview.mjs renders both directly.
 */
export function CorrectFigures({ inv, val, put, changed, why, setWhy, onSave }) {
  return (
      <div style={{ marginTop: '0.5rem', padding: '0.5rem', borderLeft: '3px solid var(--hull)',
                    background: 'var(--paper, #f4f6f5)' }}>
        {/* THE PANEL SAYS WHAT IT IS. It used to rely on the button that opened
            it, which is the wrong way round once it is on screen — and these
            boxes hold the figures every total on the page is built from. */}
        <p style={{ margin: '0 0 0.4rem', fontSize: '0.8rem' }}>
          <b>Correct the figures</b> on {inv.invoice_no || 'this invoice'} — what the reader took
          off the scan, not what you have decided about it.
        </p>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Fix label="Firm" wide value={val('supplier')} onChange={put('supplier')} />
          <Fix label="Invoice no" value={val('invoice_no')} onChange={put('invoice_no')} />
          <Fix label="Date" type="date" value={val('invoice_date')} onChange={put('invoice_date')} />
          <Fix label="Net" type="number" value={val('net')} onChange={put('net')} />
          <Fix label="VAT" type="number" value={val('vat')} onChange={put('vat')} />
          <Fix label="Total" type="number" value={val('total')} onChange={put('total')} />
          <Fix label="Currency" size={5} value={val('currency')} onChange={put('currency')} />
          <Fix label="Page from" type="number" size={5} value={val('page_from')} onChange={put('page_from')} />
          <Fix label="to" type="number" size={5} value={val('page_to')} onChange={put('page_to')} />
          <Fix label="What it was for" wide value={val('description')} onChange={put('description')} />
        </div>

        {/* NET + VAT AGAINST THE TOTAL, REPORTED AND NEVER RESOLVED — the
            same rule as the review screen. 26 of 27 disagreements in this
            record turned out to be the invoice, not the reading: no split
            printed, carriage outside the net, or somebody else paying the
            goods and the boat owing the VAT alone. */}
        <Adds net={val('net')} vat={val('vat')} total={val('total')} />

        <label style={{ fontSize: '0.74rem', display: 'block', marginTop: '0.4rem' }}>
          <span className="muted" style={{ display: 'block' }}>
            Why — so a year from now this reads as a decision and not a typo
          </span>
          <input value={why} onChange={(e) => setWhy(e.target.value)} style={{ width: '100%' }}
                 placeholder="read the scan again — the total is on page 3" />
        </label>

        <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
          <button disabled={!changed.length}
                  onClick={onSave}>
            {changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Nothing changed'}
          </button>
          <span className="muted" style={{ fontSize: '0.74rem' }}>
            {changed.length ? changed.join(', ') : 'edit a box above'}
            {' · what it says now is kept either way'}
          </span>
        </div>
      </div>
  )
}

export function RemoveInvoice({ inv, supplier, why, setWhy, onRemove }) {
  return (
      <div style={{ marginTop: '0.5rem', padding: '0.5rem', borderLeft: '3px solid var(--rust)',
                    background: 'var(--paper, #f4f6f5)' }}>
        <p style={{ margin: '0 0 0.4rem', fontSize: '0.84rem' }}>
          Take <b>{supplier?.name || inv.supplier} {inv.invoice_no || ''}</b> out of the record?
          {' '}<b>{money(inv.total)}</b> comes off every total on this page.
        </p>
        <p className="muted" style={{ margin: '0 0 0.4rem', fontSize: '0.76rem' }}>
          If it is a duplicate, check which copy carries the page number, the work dates or a
          currency conversion — that is the one to keep, and the other is the one to remove.
        </p>
        <label style={{ fontSize: '0.74rem', display: 'block' }}>
          <span className="muted" style={{ display: 'block' }}>Why it is going</span>
          <input value={why} onChange={(e) => setWhy(e.target.value)} style={{ width: '100%' }}
                 placeholder="the same scan was loaded twice — this is the second copy" />
        </label>
        <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
          <button style={{ background: 'var(--rust)', borderColor: 'var(--rust)', color: '#fff' }}
                  disabled={!why.trim()}
                  onClick={onRemove}>
            Remove it
          </button>
          {/* THE REASON IS REQUIRED. It is the only thing that will say why
              this row went — nothing else on this table records anything. */}
          <span className="muted" style={{ fontSize: '0.74rem' }}>
            {why.trim() ? 'kept on record, so it can be put back' : 'say why first'}
          </span>
        </div>
      </div>
  )
}

function Fix({ label, value, onChange, type = 'text', wide, size }) {
  return (
    <label style={{ fontSize: '0.74rem', flex: wide ? '1 1 100%' : undefined }}>
      <span className="muted" style={{ display: 'block' }}>{label}</span>
      <input type={type} value={value ?? ''} onChange={onChange} size={size}
             style={{ width: wide ? '100%' : undefined }} step={type === 'number' ? 'any' : undefined} />
    </label>
  )
}

/* Net + VAT against the printed total. A disagreement is BRASS, not rust: it
   is a question, not a fault, and this record proved that 26 times out of 27. */
function Adds({ net, vat, total }) {
  const n = Number(net), v = Number(vat), t = Number(total)
  if (![n, v, t].every(Number.isFinite) || !t) return null
  const gap = Math.round((n + v - t) * 100) / 100
  if (Math.abs(gap) < 0.01) return null
  return (
    <p style={{ margin: '0.3rem 0 0', fontSize: '0.76rem', color: 'var(--brass)' }}>
      Net and VAT come to {money(n + v)}, and the total says {money(t)} — {money(Math.abs(gap))}{' '}
      {gap > 0 ? 'over' : 'under'}. Often the invoice rather than the reading: no split printed,
      carriage charged outside the net, or somebody else paying the goods. The <b>total</b> is the
      figure that counts.
    </p>
  )
}
