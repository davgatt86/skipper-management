import React, { useMemo } from 'react'
import { yearInsight, yearsCovered } from '../../lib/invoices/dashboard'
import { yearShares } from '../../lib/invoices/when'
import { money, money0, moneyK, fmtDate, MONO, Stat, Delta, Bar, Panel } from './shared'

/* THE YEAR — what the boat has spent and on what.
 *
 * David, Sep 2026: "invoice dashboard could be a 2026 insight per category."
 *
 * THE PAGE'S ONE JOB IS TO NOT MISLEAD ABOUT A PART YEAR. 2026 stands at
 * £693,796 against 2025's £1,312,459 and the record only runs to 26 August —
 * shown side by side that reads as spending halving. Every comparison here is
 * this year to the last invoice on record against last year to the same day,
 * and the window is written on the page rather than assumed, because a
 * comparison nobody can see the edges of is one nobody can check.
 */
export default function YearDashboard({
  invoices, suppliers, cats, basis, on, year, setYear, onDrill, onOpen,
}) {
  const years = useMemo(() => yearsCovered(invoices, on), [invoices, on])

  /* Every year's total, for the strip. Off the same yearShares the grid and the
     insight use, so a bar cannot disagree with the figure beside it. */
  const byYear = useMemo(() => {
    const m = new Map()
    for (const inv of invoices) {
      const amt = Number(inv[basis]) || 0
      for (const s of yearShares(inv, on)) m.set(s.year, (m.get(s.year) || 0) + amt * s.share)
    }
    return m
  }, [invoices, basis, on])

  const d = useMemo(
    () => yearInsight(invoices, suppliers, { year, basis, on, cats }),
    [invoices, suppliers, year, basis, on, cats])

  if (!invoices.length) {
    return <Panel><p style={{ margin: 0 }}>
      No invoices filed yet. Add a bundle and they will total up here.
    </p></Panel>
  }

  const peak = Math.max(1, ...byYear.values())
  const topCat = Math.max(1, ...d.categories.map((c) => c.total))

  return (
    <>
      {/* ---- TEN YEARS AT A GLANCE, and the year picker in the same object.
              A row of chips would say which years exist; this says what
              happened in them, which is the thing a picker is actually being
              asked. The 2018 fit-out spike is invisible in a table. */}
      <Panel title="Ten years" sub={`Tap a year to read it. ${money0([...byYear.values()].reduce((a, b) => a + b, 0))} across ${byYear.size} years.`}>
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'flex-end', overflowX: 'auto',
                      paddingBottom: '0.2rem' }}>
          {[...byYear.keys()].sort((a, b) => a - b).map((y) => {
            const v = byYear.get(y)
            const isNow = y === year
            return (
              <button key={y} type="button" onClick={() => setYear(y)}
                      title={`${y} — ${money(v)}`}
                      style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
                               display: 'flex', flexDirection: 'column', alignItems: 'stretch',
                               gap: 4, minWidth: '3.3rem', flex: '1 1 3.3rem' }}>
                <span style={{ fontFamily: MONO, fontSize: '0.68rem', textAlign: 'center',
                               color: isNow ? 'var(--hull)' : 'var(--mute)' }}>{moneyK(v)}</span>
                <span style={{ height: 74, display: 'flex', alignItems: 'flex-end' }}>
                  <span style={{
                    width: '100%', borderRadius: '3px 3px 0 0',
                    height: Math.max(3, (v / peak) * 74),
                    background: isNow ? 'var(--hull)'
                      : 'color-mix(in srgb, var(--hull) 28%, transparent)',
                  }} />
                </span>
                <span style={{ fontFamily: MONO, fontSize: '0.72rem', textAlign: 'center',
                               fontWeight: isNow ? 700 : 400,
                               color: isNow ? 'var(--hull)' : undefined }}>{y}</span>
              </button>
            )
          })}
        </div>
      </Panel>

      {/* ---- THE YEAR ITSELF ------------------------------------------------ */}
      <Panel>
        <div style={{ display: 'flex', gap: '1.6rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Stat label={String(year)} value={money0(d.total)} size="2rem"
                sub={`${d.count} invoice${d.count === 1 ? '' : 's'} · ${d.firms.length} firm${d.firms.length === 1 ? '' : 's'}`} />
          <Stat label={`vs ${year - 1}`} value={<Delta change={d.change} pct={d.pct} />} size="1rem"
                sub={d.was ? `${money0(d.was)} at the same point` : 'nothing at this point last year'} />
          {d.firms[0] && (
            <Stat label="Biggest firm" value={money0(d.firms[0].total)} size="1.1rem"
                  sub={d.firms[0].name} />
          )}
          {d.categories[0] && (
            <Stat label="Biggest cost" value={money0(d.categories[0].total)} size="1.1rem"
                  sub={d.categories[0].label} />
          )}
        </div>

        {/* WHAT WINDOW IS BEING COMPARED, stated rather than assumed. Eight
            months against twelve is the difference between "spending is down by
            half" and "spending is up a little", and the reader cannot tell
            which they are looking at unless the page says. */}
        <p className="muted" style={{ margin: '0.7rem 0 0', fontSize: '0.8rem' }}>
          {d.partial
            ? <>This year is <b>not finished</b> — the record reaches {fmtDate(d.reaches)}.
                Both figures are cut at that day, so this is {year} to date against{' '}
                {year - 1} to the same day, not against its whole year.</>
            : <>A full year, against the whole of {year - 1}.</>}
          {d.spread > 0 && <> {money0(d.spread)} of it is work spanning a year end,
            divided between the years by days rather than read off a date.</>}
        </p>
      </Panel>

      {/* ---- PER CATEGORY, WHICH IS WHAT WAS ASKED FOR ---------------------- */}
      <Panel title={`What ${year} went on`}
             sub="Tap a row for the invoices behind it.">
        {d.categories.map((c) => (
          <div key={c.key} onClick={() => onDrill({ year, category: c.key === '__none__' ? null : c.key })}
               style={{ display: 'grid', gap: '0.15rem 0.6rem', padding: '0.45rem 0',
                        borderTop: '1px solid var(--line)', cursor: 'pointer',
                        gridTemplateColumns: 'minmax(8rem, 1fr) auto auto' }}>
            <span style={{ fontSize: '0.88rem',
                           color: c.key === '__none__' ? 'var(--brass)' : undefined }}>
              {c.label}
              <span className="muted" style={{ fontSize: '0.74rem', whiteSpace: 'nowrap' }}>
                {' '}· {c.count} · {c.firms} firm{c.firms === 1 ? '' : 's'}
              </span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: '0.88rem', textAlign: 'right',
                           fontWeight: 600 }}>{money0(c.total)}</span>
            <span style={{ textAlign: 'right', minWidth: '7.5rem' }}>
              <Delta change={c.change} pct={c.pct} isNew={c.isNew} />
            </span>
            <span style={{ gridColumn: '1 / -1' }}>
              <Bar value={c.total} max={topCat} />
            </span>
          </div>
        ))}

        {/* A TRADE THAT HAS STOPPED IS THE MOST INTERESTING ROW ON THE PAGE and
            would not appear at all if only this year's categories were listed —
            it has no figure this year, which is precisely the point. */}
        {d.gone.length > 0 && (
          <p className="muted" style={{ margin: '0.7rem 0 0', fontSize: '0.82rem' }}>
            <b>Nothing this year</b> where {year - 1} had it:{' '}
            {d.gone.map((g) => `${g.label} ${money0(g.was)}`).join(' · ')}.
          </p>
        )}
      </Panel>

      <div style={{ display: 'grid', gap: '0.8rem',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(19rem, 1fr))' }}>
        <Panel title={`Biggest invoices of ${year}`}
               sub="Open one to see the scan at its own page.">
          {d.biggest.map((b, i) => (
            <div key={b.inv.id || i}
                 style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline',
                          padding: '0.32rem 0', borderTop: '1px solid var(--line)' }}>
              <span style={{ flex: 1, fontSize: '0.84rem' }}>
                {b.inv.supplier || 'no supplier'}
                <span className="muted" style={{ fontSize: '0.74rem' }}>
                  {' '}· {fmtDate(b.inv.invoice_date)}
                  {b.spread && ' · part of a spanning job'}
                </span>
              </span>
              <span style={{ fontFamily: MONO, fontSize: '0.84rem' }}>{money0(b.amount)}</span>
              {b.inv.file_path && (
                <button className="secondary" style={{ padding: '0.1rem 0.45rem', fontSize: '0.74rem' }}
                        onClick={() => onOpen(b.inv)}>
                  {b.inv.page_from ? `p. ${b.inv.page_from}` : 'scan'}
                </button>
              )}
            </div>
          ))}
        </Panel>

        <Panel title={`Who ${year} was paid to`} sub="Tap a firm for its invoices.">
          {d.firms.slice(0, 10).map((f) => (
            <div key={f.key} onClick={() => onDrill({ year, supplierId: f.key })}
                 style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', cursor: 'pointer',
                          padding: '0.32rem 0', borderTop: '1px solid var(--line)' }}>
              <span style={{ flex: 1, fontSize: '0.84rem' }}>
                {f.name}
                <span className="muted" style={{ fontSize: '0.74rem' }}> · {f.count}</span>
              </span>
              <span style={{ fontFamily: MONO, fontSize: '0.84rem' }}>{money0(f.total)}</span>
            </div>
          ))}
          {d.firms.length > 10 && (
            <p className="muted" style={{ fontSize: '0.78rem', margin: '0.4rem 0 0' }}>
              …and {d.firms.length - 10} more, worth{' '}
              {money0(d.firms.slice(10).reduce((t, f) => t + f.total, 0))} together.
            </p>
          )}
        </Panel>
      </div>
    </>
  )
}
