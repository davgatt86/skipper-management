import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import SectionRule from '../SectionRule'

// Settled sheets returned by the office — the other end of the Square Up loop.
//
// Reads the su_* tables, which are fleet-isolated by su_visible_boat() +
// current_fleet_id() (see supabase/su_fleet_isolation.sql). No fleet filter is
// applied here on purpose: RLS decides what comes back, and a client-side
// filter would only give a false sense of where the boundary lives.
//
// Audacious currently holds a grant over Beryl, so this fleet sees two boats
// and gets a picker. Beryl sees one and gets none — same rule as the vessel
// picker: only offer a switch when there is something to switch between.

const gbp = n => '£' + Math.round(Number(n || 0)).toLocaleString('en-GB')
const gbp2 = n => '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtDate = d => (d ? `${d.slice(8, 10)} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}` : '—')

const SECTION_LABEL = { income: 'Income', expense: 'Expenses', recovery: 'Recoveries' }

function statusFlag(status) {
  const s = (status || '').toLowerCase()
  if (s === 'finalised' || s === 'final') return 'ok'
  if (s === 'draft' || s === 'query') return 'warn'
  return 'ok'
}

export default function Settlements() {
  const [boats, setBoats] = useState([])
  const [boatId, setBoatId] = useState('')
  const [rows, setRows] = useState([])
  const [openId, setOpenId] = useState(null)
  const [detail, setDetail] = useState({ lines: [], crew: [], loading: false })
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 1. Which boats can this login see? RLS answers that.
  useEffect(() => {
    let cancel = false
    ;(async () => {
      const { data, error } = await supabase
        .from('su_boats')
        .select('id, name, registration, format, active')
        .order('name')
      if (cancel) return
      if (error) setError(error.message)
      const list = data || []
      setBoats(list)
      if (list.length) setBoatId(b => b || list[0].id)
      else setLoading(false)
    })()
    return () => { cancel = true }
  }, [])

  // 2. Settlements and invoices for the selected boat.
  useEffect(() => {
    if (!boatId) return
    let cancel = false
    setLoading(true)
    setOpenId(null)
    ;(async () => {
      const [sRes, iRes] = await Promise.all([
        supabase
          .from('su_settlements')
          .select('id, reference, settling_date, period, status, trip_type, total_income, total_expenses, total_recoveries, crew_wages_total, owners_share, cash_generated, days_at_sea, weight_landed, trips, file_path')
          .eq('boat_id', boatId)
          .order('settling_date', { ascending: false, nullsFirst: false })
          .limit(200),
        supabase
          .from('su_invoices')
          .select('id, supplier, invoice_no, invoice_date, description, net, vat, total, status, paid_date')
          .eq('boat_id', boatId)
          .order('invoice_date', { ascending: false, nullsFirst: false })
          .limit(50),
      ])
      if (cancel) return
      if (sRes.error) setError(sRes.error.message)
      setRows(sRes.data || [])
      setInvoices(iRes.data || [])
      setLoading(false)
    })()
    return () => { cancel = true }
  }, [boatId])

  // 3. Lines and crew wages, loaded only when a settlement is opened.
  async function open(id) {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    setDetail({ lines: [], crew: [], loading: true })
    const [lRes, cRes] = await Promise.all([
      supabase.from('su_settlement_lines')
        .select('id, section, label, amount, opening, movement, closing, pct_income, sort')
        .eq('settlement_id', id).order('sort'),
      supabase.from('su_crew_payments')
        .select('id, crew_name, crew_code, gross, bond, gear, sundries, adv, subs, tax, add_tax, deductions_total, net, method')
        .eq('settlement_id', id).order('crew_name'),
    ])
    setDetail({ lines: lRes.data || [], crew: cRes.data || [], loading: false })
  }

  const boat = boats.find(b => b.id === boatId)
  const openRow = rows.find(r => r.id === openId)

  const linesBySection = useMemo(() => {
    const out = {}
    for (const l of detail.lines) (out[l.section] = out[l.section] || []).push(l)
    return out
  }, [detail.lines])

  const crewTotals = useMemo(() => detail.crew.reduce((a, c) => ({
    gross: a.gross + Number(c.gross || 0),
    bond: a.bond + Number(c.bond || 0),
    tax: a.tax + Number(c.tax || 0),
    net: a.net + Number(c.net || 0),
  }), { gross: 0, bond: 0, tax: 0, net: 0 }), [detail.crew])

  return (
    <AppShell>
      <PageHeader
        eyebrow="Office → you"
        title="Settlements"
        sub={boat ? `${boat.name} ${boat.registration || ''}`.trim() : 'Settled sheets returned by the office'}
      />

      <div className="flowbar">
        <span className="flow">1 · You fill in Square Up</span>
        <span className="flow-ar">→</span>
        <span className="flow">2 · Office settles</span>
        <span className="flow-ar">→</span>
        <span className="flow is-now">3 · Settlement comes back</span>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error">{error}</p></div>}

      {/* Only when there is something to switch between. */}
      {boats.length > 1 && (
        <div className="boatpick">
          {boats.map(b => (
            <button key={b.id} className={b.id === boatId ? 'on' : ''} onClick={() => setBoatId(b.id)}>
              {b.name} {b.registration}
            </button>
          ))}
        </div>
      )}

      {!loading && boats.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No settlement boats are set up for your fleet. Settlements are currently
            kept for Audacious and Beryl only.
          </p>
        </div>
      )}

      {loading && <div className="card"><p className="muted" style={{ margin: 0 }}>Loading…</p></div>}

      {!loading && boats.length > 0 && (
        <>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Reference</th><th>Settled</th>
                  <th className="r">Income</th><th className="r">Expenses</th>
                  <th className="r">Crew wages</th><th className="r">Owner share</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="muted">No settlements for this boat yet.</td></tr>
                )}
                {rows.map(r => (
                  <tr key={r.id} className="rowlink" onClick={() => open(r.id)}>
                    <td className="strong">{openId === r.id ? '▾ ' : '▸ '}{r.reference || '—'}</td>
                    <td className="num">{fmtDate(r.settling_date)}</td>
                    <td className="r num">{gbp(r.total_income)}</td>
                    <td className="r num">{gbp(r.total_expenses)}</td>
                    <td className="r num">{gbp(r.crew_wages_total)}</td>
                    <td className="r num">{gbp(r.owners_share)}</td>
                    <td><span className={'flag ' + statusFlag(r.status)}>{r.status || '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">{rows.length} settlement{rows.length === 1 ? '' : 's'} · newest first · tap a row to open it</p>

          {openRow && (
            <>
              <SectionRule side={`settled ${fmtDate(openRow.settling_date)}`}>
                {openRow.reference || 'Settlement'}
              </SectionRule>

              {detail.loading && <div className="card"><p className="muted" style={{ margin: 0 }}>Loading…</p></div>}

              {!detail.loading && (
                <>
                  <div className="trip">
                    <div className="trip-b">
                      <div className="tk"><div className="k">Income</div><div className="v">{gbp(openRow.total_income)}</div><div className="n">{openRow.trip_type || 'fishing'}</div></div>
                      <div className="tk"><div className="k">Expenses</div><div className="v">{gbp(openRow.total_expenses)}</div><div className="n">recoveries {gbp(openRow.total_recoveries)}</div></div>
                      <div className="tk"><div className="k">Crew wages</div><div className="v">{gbp(openRow.crew_wages_total)}</div><div className="n">{detail.crew.length} on the sheet</div></div>
                      <div className="tk"><div className="k">Owner share</div><div className="v">{gbp(openRow.owners_share)}</div><div className="n">cash {gbp(openRow.cash_generated)}</div></div>
                    </div>
                    {(openRow.days_at_sea || openRow.weight_landed) && (
                      <div className="trip-f">
                        {openRow.days_at_sea ? `${openRow.days_at_sea} days at sea` : ''}
                        {openRow.days_at_sea && openRow.weight_landed ? ' · ' : ''}
                        {openRow.weight_landed ? `${Number(openRow.weight_landed).toLocaleString('en-GB')} kg landed` : ''}
                        {openRow.trips ? ` · ${openRow.trips} trip${Number(openRow.trips) === 1 ? '' : 's'}` : ''}
                      </div>
                    )}
                  </div>

                  {['income', 'expense', 'recovery'].map(section => {
                    const list = linesBySection[section]
                    if (!list || !list.length) return null
                    const total = list.reduce((s, l) => s + Number(l.amount || 0), 0)
                    const hasRunning = list.some(l => l.opening != null || l.closing != null)
                    return (
                      <div key={section} style={{ marginTop: 18 }}>
                        <SectionRule side={`${list.length} line${list.length === 1 ? '' : 's'}`}>
                          {SECTION_LABEL[section] || section}
                        </SectionRule>
                        <div className="tw">
                          <table>
                            <thead>
                              <tr>
                                <th>Item</th>
                                {hasRunning && <th className="r">Opening</th>}
                                {hasRunning && <th className="r">Movement</th>}
                                {hasRunning && <th className="r">Closing</th>}
                                <th className="r">Amount</th>
                                <th className="r">% income</th>
                              </tr>
                            </thead>
                            <tbody>
                              {list.map(l => (
                                <tr key={l.id}>
                                  <td className="strong">{l.label}</td>
                                  {hasRunning && <td className="r num">{l.opening == null ? '—' : gbp2(l.opening)}</td>}
                                  {hasRunning && <td className="r num">{l.movement == null ? '—' : gbp2(l.movement)}</td>}
                                  {hasRunning && <td className="r num">{l.closing == null ? '—' : gbp2(l.closing)}</td>}
                                  <td className="r num">{gbp2(l.amount)}</td>
                                  <td className="r num">{l.pct_income == null ? '—' : Number(l.pct_income).toFixed(1) + '%'}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr>
                                <td colSpan={hasRunning ? 4 : 1}>Total {SECTION_LABEL[section].toLowerCase()}</td>
                                <td className="r num">{gbp2(total)}</td>
                                <td />
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )
                  })}

                  {detail.crew.length > 0 && (
                    <div style={{ marginTop: 18 }}>
                      <SectionRule side={`${detail.crew.length} crew`}>Crew wages</SectionRule>
                      <div className="tw">
                        <table>
                          <thead>
                            <tr>
                              <th>Crew</th>
                              <th className="r">Gross</th><th className="r">Bond</th><th className="r">Gear</th>
                              <th className="r">Subs</th><th className="r">Tax</th><th className="r">Net</th>
                              <th>Paid</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.crew.map(c => (
                              <tr key={c.id}>
                                <td className="strong">{c.crew_name}{c.crew_code ? <span className="g"> {c.crew_code}</span> : null}</td>
                                <td className="r num">{gbp2(c.gross)}</td>
                                <td className="r num">{Number(c.bond || 0) ? gbp2(c.bond) : '—'}</td>
                                <td className="r num">{Number(c.gear || 0) ? gbp2(c.gear) : '—'}</td>
                                <td className="r num">{Number(c.subs || 0) ? gbp2(c.subs) : '—'}</td>
                                <td className="r num">{gbp2(c.tax)}</td>
                                <td className="r num strong">{gbp2(c.net)}</td>
                                <td className="muted">{c.method || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td>{detail.crew.length} crew</td>
                              <td className="r num">{gbp2(crewTotals.gross)}</td>
                              <td className="r num">{gbp2(crewTotals.bond)}</td>
                              <td /><td />
                              <td className="r num">{gbp2(crewTotals.tax)}</td>
                              <td className="r num">{gbp2(crewTotals.net)}</td>
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}

                  <p className="note">
                    Figures as the office settled them. Checking these against the Square Up
                    worksheet you sent is the next stage.
                  </p>
                </>
              )}
            </>
          )}

          {invoices.length > 0 && (
            <div style={{ marginTop: 26 }}>
              <SectionRule side={`${invoices.filter(i => i.status !== 'paid').length} unpaid`}>Invoices</SectionRule>
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>Supplier</th><th>Invoice</th><th>Date</th>
                      <th className="r">Net</th><th className="r">VAT</th><th className="r">Total</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map(i => (
                      <tr key={i.id}>
                        <td className="strong">{i.supplier}</td>
                        <td className="g">{i.invoice_no || '—'}</td>
                        <td className="num">{fmtDate(i.invoice_date)}</td>
                        <td className="r num">{gbp2(i.net)}</td>
                        <td className="r num">{gbp2(i.vat)}</td>
                        <td className="r num strong">{gbp2(i.total)}</td>
                        <td>
                          <span className={'flag ' + (i.status === 'paid' ? 'ok' : 'warn')}>
                            {i.status === 'paid' ? `Paid ${fmtDate(i.paid_date)}` : 'Unpaid'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </AppShell>
  )
}
