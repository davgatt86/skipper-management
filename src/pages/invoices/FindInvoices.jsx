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
  onOpen, onSetWork, onPlaceVessel, onSetCategory,
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
                         onPlaceVessel={onPlaceVessel} onSetCategory={onSetCategory} />
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
function InvoiceLine({ inv, basis, cats, eras, supplier, onOpen, onSetWork, onPlaceVessel, onSetCategory }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(inv.work_from || '')
  const [to, setTo] = useState(inv.work_to || '')
  const work = workLabel(inv)
  const bad = from && to && to < from

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
        </div>
      )}
    </div>
  )
}
