import React, { useMemo, useState } from 'react'
import { categoryMatrix, categoryLabel, suggestCategory } from '../../lib/invoices/categories'
import { bySupplierRows } from '../../lib/invoices/bySupplier'
import { eraLabel, vesselOf, vesselSplitPerYear } from '../../lib/invoices/vessels'
import { lumpBillings, workDateCoverage } from '../../lib/invoices/when'
import {
  money, money0, moneyK, fmtDate, MONO, Panel, DrillCell, Spark, Segmented,
} from './shared'

/* TEN YEARS, £8m, TWENTY TRADES AND 153 FIRMS — as a picture rather than a wall.
 *
 * The same 220 figures were already here as a table. What is added is a way of
 * SEEING them: each cell shaded by size, so the shape of a decade shows without
 * anybody reading a single number, and every cell a way into the invoices
 * behind it. A grid you cannot open is a report; a grid you can open is a
 * record.
 */
export default function AllYears({
  invoices, suppliers, cats, eras, basis, on,
  onDrill, onFileSupplier, onSuggestAll, onPlaceVessel, onSetWork,
}) {
  const [view, setView] = useState('category')
  const [era, setEra] = useState('')
  const [open, setOpen] = useState(null)

  const split = useMemo(
    () => vesselSplitPerYear(invoices, eras, { basis }), [invoices, eras, basis])
  const shown = useMemo(
    () => (era ? invoices.filter((i) => vesselOf(i, eras) === era) : invoices),
    [invoices, era, eras])
  const matrix = useMemo(
    () => categoryMatrix(shown, suppliers, { basis, on }), [shown, suppliers, basis, on])
  const supRows = useMemo(() => bySupplierRows(matrix), [matrix])
  const byId = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers])

  /* Firms with no category yet, what they are worth, and WHAT THEY HAVE SOLD.
     The descriptions matter: 79 of this boat's 153 firms have a name that says
     nothing about their trade — "PBP Services", "Melpass Limited", "Cromwell" —
     and the only thing that places them is the work on their invoices. */
  const unfiled = useMemo(() => {
    const spend = new Map()
    for (const i of invoices) {
      if (byId.get(i.supplier_id)?.category || i.category) continue
      const s = byId.get(i.supplier_id)
      if (!s) continue
      const cur = spend.get(s.id) || { s, total: 0, count: 0, descriptions: [] }
      cur.total += Number(i[basis]) || 0
      cur.count++
      if (i.description && cur.descriptions.length < 8) cur.descriptions.push(i.description)
      spend.set(s.id, cur)
    }
    return [...spend.values()].sort((a, b) => b.total - a.total)
  }, [invoices, byId, basis])

  const lumps = useMemo(() => lumpBillings(invoices, { basis }), [invoices, basis])
  const cover = useMemo(() => workDateCoverage(invoices, basis), [invoices, basis])

  if (!invoices.length) {
    return <Panel><p style={{ margin: 0 }}>
      No invoices filed yet. Add a bundle and they will total up here.
    </p></Panel>
  }

  const years = matrix.columns
  const rows = view === 'category' ? matrix.rows : supRows

  return (
    <>
      {/* ---- THREE BOATS, ONE NAME ------------------------------------------
          COMPARING THEIR TOTALS IS COMPARING THREE DIFFERENT LENGTHS OF TIME,
          and the page used to do exactly that: the record holds two and a half
          years of the old boat against four of the twin, so the totals ranked
          them by how long each sits in the record. £/year is the comparable
          figure and the totals stay beside it, because the total is the money
          that actually left the account. */}
      <Panel title="Which boat"
             sub={split.rows.map((r) => `${r.label}: ${r.note}`).join(' · ')}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <BoatChip on={era === ''} onClick={() => setEra('')} label="All three"
                    total={split.rows.reduce((t, r) => t + r.total, 0)} />
          {split.rows.map((r) => (
            <BoatChip key={r.key} on={era === r.key} onClick={() => setEra(r.key)}
                      label={r.label} total={r.total} perYear={r.perYear}
                      years={r.service?.years} fromRecord={r.service?.fromRecord} />
          ))}
        </div>
        {split.rows.some((r) => r.service?.fromRecord) && (
          <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.78rem' }}>
            The oldest boat's per-year figure is the one to distrust: she was sold in
            August 2018 and the invoices only begin in 2016, so the window is where the
            RECORD starts rather than where she did.
          </p>
        )}
        {split.undated.count > 0 && (
          <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
            {split.undated.count} invoice{split.undated.count === 1 ? '' : 's'} carrying{' '}
            {money0(split.undated.total)} has no date, so no boat.
          </p>
        )}
      </Panel>

      {/* ---- WHERE THE DATE CANNOT SAY -------------------------------------- */}
      {split.uncertain.length > 0 && (
        <Panel tone="var(--brass)"
               title={`${split.uncertain.length} invoice${split.uncertain.length === 1 ? '' : 's'} could belong to either boat`}
               right={<span className="muted" style={{ fontSize: '0.84rem' }}>{money0(split.unsureTotal)}</span>}
               sub="Dated inside a changeover, when the old boat was still fishing and the new one was being fitted out. Counted against the boat in service until you say otherwise.">
          {split.uncertain.slice(0, 8).map((u) => (
            <div key={u.invoice.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center',
                                             flexWrap: 'wrap', padding: '0.3rem 0',
                                             borderTop: '1px solid var(--line)' }}>
              <span style={{ fontFamily: MONO, minWidth: '5.6rem', fontSize: '0.82rem' }}>
                {u.invoice.invoice_date}
              </span>
              <span style={{ flex: '1 1 12rem', fontSize: '0.84rem' }}>
                {u.invoice.supplier}
                <span className="muted" style={{ fontSize: '0.76rem' }}>
                  {' '}· {u.invoice.invoice_no || 'no number'}
                </span>
              </span>
              <span style={{ fontFamily: MONO, minWidth: '5.5rem', textAlign: 'right',
                             fontSize: '0.84rem' }}>{money0(u.amount)}</span>
              <button className="secondary" onClick={() => onPlaceVessel([u.invoice.id], u.offered)}>
                {eraLabel(u.offered, eras)}
              </button>
              <button onClick={() => onPlaceVessel([u.invoice.id], u.alsoCould)}>
                {eraLabel(u.alsoCould, eras)}
              </button>
            </div>
          ))}
          {split.uncertain.length > 8 && (
            <p className="muted" style={{ fontSize: '0.8rem', margin: '0.4rem 0 0' }}>
              …and {split.uncertain.length - 8} smaller ones worth{' '}
              {money0(split.uncertain.slice(8).reduce((t, u) => t + u.amount, 0))} together.
              Settling the big ones first is what moves the figures.
            </p>
          )}
        </Panel>
      )}

      {/* ---- BILLED IN A LUMP ----------------------------------------------- */}
      {lumps.length > 0 && (
        <Panel tone="var(--brass)"
               title={`${lumps.length} lump billing${lumps.length === 1 ? '' : 's'} — several invoices on one day`}
               sub={`A firm that bills a run of jobs in one go puts all of it in one year. Saying when the work was actually done moves each job to the year it belongs in. ${cover.withWork} of ${cover.total} invoices carry a work date so far.`}>
          {lumps.slice(0, 6).map((g) => (
            <LumpRow key={g.supplier_id + g.date} g={g} onSetWork={onSetWork} onDrill={onDrill} />
          ))}
          {lumps.length > 6 && (
            <p className="muted" style={{ fontSize: '0.8rem', margin: '0.4rem 0 0' }}>
              …and {lumps.length - 6} more, worth{' '}
              {money0(lumps.slice(6).reduce((t, g) => t + g.total, 0))} together.
            </p>
          )}
        </Panel>
      )}

      {/* ---- FIRMS WITH NO CATEGORY ----------------------------------------- */}
      {unfiled.length > 0 && (
        <Panel tone="var(--brass)"
               title={`${unfiled.length} firm${unfiled.length === 1 ? '' : 's'} not filed to a category`}
               right={<button onClick={onSuggestAll}>Suggest categories</button>}
               sub={`${money0(unfiled.reduce((s, u) => s + u.total, 0))}${unfiled.length === 1 ? '' : ' between them'}. One decision files every invoice a firm has ever sent — biggest first, since the top few are most of the money.`}>
          {unfiled.slice(0, 10).map((u) => (
            <FileFirm key={u.s.id} s={u.s} total={u.total} count={u.count}
                      descriptions={u.descriptions} cats={cats} onFile={onFileSupplier} />
          ))}
          {unfiled.length > 10 && (
            <p className="muted" style={{ fontSize: '0.8rem', margin: '0.4rem 0 0' }}>
              …and {unfiled.length - 10} smaller ones, worth{' '}
              {money0(unfiled.slice(10).reduce((s, u) => s + u.total, 0))} together.
            </p>
          )}
        </Panel>
      )}

      {/* ---- THE GRID ------------------------------------------------------- */}
      <Panel
        title={view === 'category' ? 'Every year, by trade' : 'Every year, by firm'}
        right={<Segmented value={view} onChange={setView} options={[
          { value: 'category', label: 'By trade' },
          { value: 'supplier', label: 'By firm' },
        ]} />}
        sub="Shaded by size across the whole grid, so the shape of a decade shows without reading a figure — scaled so one £616,200 order does not leave every other cell white. Tap any cell for the invoices behind it.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.3rem 0.45rem', position: 'sticky',
                             left: 0, background: 'var(--surface, #fff)' }}>
                  {view === 'category' ? 'What for' : 'Who'}
                </th>
                {view === 'supplier' && (
                  <th style={{ padding: '0.3rem 0.45rem', textAlign: 'left', fontWeight: 400 }}>
                    <span className="muted" style={{ fontSize: '0.72rem' }}>trend</span>
                  </th>
                )}
                {years.map((c) => (
                  <th key={c} style={{ textAlign: 'right', padding: '0.3rem 0.45rem',
                                       fontFamily: MONO, fontSize: '0.78rem',
                                       color: c === 'undated' ? 'var(--brass)' : undefined }}>
                    {c === 'undated' ? 'no date' : c}
                  </th>
                ))}
                <th style={{ textAlign: 'right', padding: '0.3rem 0.45rem' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isCat = view === 'category'
                const key = r.key
                const label = isCat
                  ? categoryLabel(key === '__none__' ? null : key, cats) : r.name
                const isOpen = open === key
                return (
                  <React.Fragment key={key}>
                    <tr style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: '0.3rem 0.45rem', position: 'sticky', left: 0,
                                   background: 'var(--surface, #fff)',
                                   color: key === '__none__' ? 'var(--brass)' : undefined }}>
                        {isCat && (
                          <span className="muted" style={{ marginRight: 4, cursor: 'pointer' }}
                                onClick={() => setOpen(isOpen ? null : key)}>
                            {isOpen ? '▾' : '▸'}
                          </span>
                        )}
                        <span style={{ cursor: 'pointer' }}
                              onClick={() => onDrill(isCat
                                ? { category: key === '__none__' ? null : key, era: era || null }
                                : { supplierId: r.key, era: era || null })}>
                          {label}
                        </span>
                        <span className="muted" style={{ fontSize: '0.74rem' }}> · {r.count}</span>
                        {!isCat && r.last && (
                          <span className="muted" style={{ fontSize: '0.72rem', display: 'block' }}>
                            {fmtDate(r.first)} → {fmtDate(r.last)}
                          </span>
                        )}
                      </td>
                      {!isCat && (
                        <td style={{ padding: '0.3rem 0.45rem' }}>
                          <Spark values={years.filter((y) => y !== 'undated')
                            .slice().sort((a, b) => a - b).map((y) => r.cells[y] || 0)} />
                        </td>
                      )}
                      {years.map((c) => (
                        <DrillCell key={c} value={r.cells[c] || 0} peak={matrix.scale || matrix.peak}
                                   title={`${label} · ${c} · ${money(r.cells[c] || 0)}`}
                                   onClick={() => onDrill({
                                     year: c === 'undated' ? null : c,
                                     undated: c === 'undated',
                                     era: era || null,
                                     ...(isCat ? { category: key === '__none__' ? null : key }
                                               : { supplierId: r.key }),
                                   })} />
                      ))}
                      <td style={{ textAlign: 'right', padding: '0.3rem 0.45rem', fontWeight: 700,
                                   fontFamily: MONO, whiteSpace: 'nowrap' }}>
                        {money0(r.total)}
                        <span className="muted" style={{ fontWeight: 400, fontSize: '0.72rem' }}>
                          {' '}{matrix.grand ? Math.round((r.total / matrix.grand) * 100) : 0}%
                        </span>
                      </td>
                    </tr>
                    {isOpen && isCat && (
                      <tr>
                        <td colSpan={years.length + 2}
                            style={{ padding: '0 0.45rem 0.5rem 1.7rem' }}>
                          {r.suppliers.slice(0, 15).map((s) => (
                            <div key={s.id || s.name}
                                 onClick={() => onDrill({ supplierId: s.id, category: key === '__none__' ? null : key })}
                                 style={{ display: 'flex', gap: '0.6rem', fontSize: '0.8rem',
                                          padding: '0.1rem 0', cursor: 'pointer' }}>
                              <span style={{ flex: 1 }}>{s.name}</span>
                              <span className="muted">{s.count}</span>
                              <span style={{ fontFamily: MONO, minWidth: '6rem', textAlign: 'right' }}>
                                {money0(s.total)}
                              </span>
                            </div>
                          ))}
                          {r.suppliers.length > 15 && (
                            <div className="muted" style={{ fontSize: '0.76rem' }}>
                              …and {r.suppliers.length - 15} more
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--line)', fontWeight: 700 }}>
                <td style={{ padding: '0.4rem 0.45rem', position: 'sticky', left: 0,
                             background: 'var(--surface, #fff)' }}>All</td>
                {view === 'supplier' && <td />}
                {years.map((c) => (
                  <td key={c} style={{ textAlign: 'right', padding: '0.4rem 0.45rem',
                                       fontFamily: MONO, fontSize: '0.82rem' }}>
                    {moneyK(matrix.totals[c])}
                  </td>
                ))}
                <td style={{ textAlign: 'right', padding: '0.4rem 0.45rem', fontFamily: MONO }}>
                  {money0(matrix.grand)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {view === 'supplier' && supRows.length >= 40 && (
          <p className="muted" style={{ fontSize: '0.78rem', margin: '0.5rem 0 0' }}>
            The 40 biggest firms of {suppliers.length}. Use Find for the rest.
          </p>
        )}
        {Object.keys(matrix.spread).length > 0 && (
          <p className="muted" style={{ fontSize: '0.78rem', margin: '0.5rem 0 0' }}>
            Some of these years include work spanning a year end, divided by days rather
            than read off a date:{' '}
            {Object.entries(matrix.spread).map(([y, v]) => `${y} ${money0(v)}`).join(' · ')}.
          </p>
        )}
      </Panel>
    </>
  )
}

function BoatChip({ on, onClick, label, total, perYear, years, fromRecord }) {
  return (
    <button type="button" onClick={onClick}
            style={{
              textAlign: 'left', padding: '0.45rem 0.7rem', borderRadius: 6, cursor: 'pointer',
              border: '1px solid ' + (on ? 'var(--hull)' : 'var(--line)'),
              background: on ? 'color-mix(in srgb, var(--hull) 10%, transparent)' : 'transparent',
              color: 'var(--ink)',
            }}>
      <div style={{ fontWeight: on ? 700 : 500, fontSize: '0.85rem' }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: '0.95rem' }}>{money0(total)}</div>
      {perYear != null && (
        <div className="muted" style={{ fontSize: '0.73rem' }}>
          {money0(perYear)}/yr over {years?.toFixed(1)} yr{fromRecord ? '*' : ''}
        </div>
      )}
    </button>
  )
}

/* A run of invoices billed on one day, and when the work was actually done.
 *
 * ANSWERED FOR THE WHOLE RUN AT ONCE, because that is how it was billed: six
 * MAK M20 jobs invoiced on 5 October are six jobs from one visit, and asking
 * six times is how the answer does not get given at all. Per-invoice dates are
 * still available in Find, for the case where one job genuinely sits apart. */
function LumpRow({ g, onSetWork, onDrill }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const bad = from && to && to < from
  return (
    <div style={{ padding: '0.45rem 0', borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ flex: '1 1 12rem', fontSize: '0.86rem' }}>{g.supplier}</b>
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          {g.count} invoices billed {fmtDate(g.date)}
        </span>
        <span style={{ fontFamily: MONO, fontSize: '0.88rem' }}>{money0(g.total)}</span>
        <button className="secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.76rem' }}
                onClick={() => onDrill({ supplierId: g.supplier_id })}>see them</button>
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-end', flexWrap: 'wrap',
                    marginTop: '0.35rem' }}>
        <label style={{ fontSize: '0.74rem' }}>
          <span className="muted" style={{ display: 'block' }}>Work done from</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={{ fontSize: '0.74rem' }}>
          <span className="muted" style={{ display: 'block' }}>to (optional)</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button disabled={!from || bad}
                onClick={() => onSetWork(g.invoices.map((i) => i.id), from, to)}>
          Put {g.count} invoices in that year
        </button>
        {bad && <span style={{ color: 'var(--rust)', fontSize: '0.78rem' }}>
          the end is before the start
        </span>}
      </div>
      <p className="muted" style={{ margin: '0.3rem 0 0', fontSize: '0.76rem' }}>
        One date puts all {g.count} whole into that year. Two dates spanning a year end
        divide them between the years by days, and the grid says so.
      </p>
    </div>
  )
}

/* One firm, its suggestion, and the decision. THE SUGGESTION IS SHOWN AND NEVER
   APPLIED — £8m is a lot of money to have bucketed by a regex, and this
   codebase has already said so once about crew tickets. */
function FileFirm({ s, total, count, descriptions, cats, onFile }) {
  const guess = suggestCategory(s.name, descriptions)
  const [pick, setPick] = useState(guess?.key || '')
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap',
                  padding: '0.3rem 0', borderTop: '1px solid var(--line)' }}>
      <span style={{ flex: '1 1 13rem' }}>
        <b>{s.name}</b>
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          {' '}· {count} invoice{count === 1 ? '' : 's'} · {money0(total)}
        </span>
      </span>
      <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: '13rem' }}>
        <option value="">— pick a category —</option>
        {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
      {guess && pick === guess.key && (
        <span className="muted" style={{ fontSize: '0.74rem' }}>suggested from {guess.why}</span>
      )}
      <button className="secondary" disabled={!pick} onClick={() => onFile(s.id, pick)}>File</button>
    </div>
  )
}
