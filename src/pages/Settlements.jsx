import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import SectionRule from '../SectionRule'
import Stat from '../Stat'
import SettlementImport from '../SettlementImport'
import FormatSampleUpload from '../FormatSampleUpload'
import StatsTab from '../settlements/StatsTab'
import CrewTab from '../settlements/CrewTab'
import InvoicesTab from '../settlements/InvoicesTab'
import Reconcile from '../settlements/Reconcile'
import { computeMetrics, money, money2, pct, qty } from '../lib/su/metrics'

// The settled sheets that come back from the office.
//
// Both sheet formats share one page. Every figure is defined once in
// metrics.js, which decides per format whether it can be produced — so a
// Beryl page shows "n/a, a Beryl sheet does not give weight landed" where an
// Audacious page shows a number, rather than each page quietly growing
// whatever its own format happened to carry.
//
// No fleet filter in the queries: RLS decides what comes back.

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtDate = d => (d ? `${d.slice(8, 10)} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : '—')
const TABS = [['overview', 'Overview'], ['settlements', 'Settlements'], ['stats', 'Stats'], ['crew', 'Crew Wages'], ['invoices', 'Invoices']]
const SECTION_LABEL = { income: 'Income', expense: 'Expenses', recovery: 'Recoveries' }

export default function Settlements() {
  const { appUser } = useAuth()
  const [boats, setBoats] = useState([])
  const [boatId, setBoatId] = useState('')
  const [year, setYear] = useState(null)
  const [years, setYears] = useState([])
  const [tab, setTab] = useState('overview')
  const [tripFilter, setTripFilter] = useState('fishing')

  const [settlements, setSettlements] = useState([])
  const [lines, setLines] = useState([])
  const [crew, setCrew] = useState([])
  const [invoices, setInvoices] = useState([])
  const [samples, setSamples] = useState([])

  const [openId, setOpenId] = useState(null)
  const [importing, setImporting] = useState(false)

  /* SETTLING SHEETS THAT ARRIVED BY EMAIL. Don Fishing send them now, so the
     ingest webhook files them here instead of the skipper hunting the
     attachment out of Gmail. They are FILED, never saved — a settling sheet is
     a photograph read by a model, so it still goes through the review screen
     and its two totals like any other. */
  const [inbox, setInbox] = useState([])
  const [fromInbox, setFromInbox] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  // 1. Which boats can this login see? RLS answers that.
  useEffect(() => {
    let cancel = false
    ;(async () => {
      const { data, error } = await supabase.from('su_boats')
        .select('id, name, registration, format, agent').order('name')
      if (cancel) return
      if (error) setError(error.message)
      const list = data || []
      setBoats(list)
      if (list.length) setBoatId(b => b || list[0].id)
      else setLoading(false)
    })()
    return () => { cancel = true }
  }, [])

  // What has arrived by email and not been dealt with yet.
  useEffect(() => {
    if (!boatId) return
    let cancel = false
    ;(async () => {
      const { data } = await supabase.from('su_inbox')
        .select('id, filename, from_email, subject, received_at, file_path, bytes')
        .eq('boat_id', boatId).eq('status', 'new')
        .order('received_at', { ascending: false })
      if (!cancel) setInbox(data || [])
    })()
    return () => { cancel = true }
  }, [boatId, reload])

  // 2. Which years does this boat have?
  useEffect(() => {
    if (!boatId) return
    let cancel = false
    ;(async () => {
      const { data } = await supabase.from('su_settlements')
        .select('settling_date').eq('boat_id', boatId)
        .order('settling_date', { ascending: false })
      if (cancel) return
      const ys = [...new Set((data || []).map(r => r.settling_date?.slice(0, 4)).filter(Boolean))]
      setYears(ys)
      setYear(y => (y && ys.includes(y) ? y : ys[0] || String(new Date().getFullYear())))
    })()
    return () => { cancel = true }
  }, [boatId, reload])

  // 3. Everything for this boat and year, in one go — the tabs all read from it.
  useEffect(() => {
    if (!boatId || !year) return
    let cancel = false
    setLoading(true); setOpenId(null)
    ;(async () => {
      const from = `${year}-01-01`, to = `${year}-12-31`
      const { data: s, error: sErr } = await supabase.from('su_settlements')
        .select('*').eq('boat_id', boatId)
        .gte('settling_date', from).lte('settling_date', to)
        .order('settling_date', { ascending: false })
      if (cancel) return
      if (sErr) { setError(sErr.message); setLoading(false); return }
      const rows = s || []
      setSettlements(rows)

      const ids = rows.map(r => r.id)
      if (ids.length) {
        const [lRes, cRes] = await Promise.all([
          supabase.from('su_settlement_lines').select('*').in('settlement_id', ids),
          supabase.from('su_crew_payments').select('*').in('settlement_id', ids),
        ])
        if (cancel) return
        setLines(lRes.data || []); setCrew(cRes.data || [])
      } else { setLines([]); setCrew([]) }

      const { data: inv } = await supabase.from('su_invoices')
        .select('*').eq('boat_id', boatId).order('invoice_date', { ascending: false })
      if (!cancel) { setInvoices(inv || []); setLoading(false) }
    })()
    return () => { cancel = true }
  }, [boatId, year, reload])

  // Owner only: formats other fleets have sent in.
  useEffect(() => {
    if (!appUser?.is_owner) return
    let cancel = false
    ;(async () => {
      const { data } = await supabase.from('su_format_samples')
        .select('id, uploader_email, agent, note, status, created_at, file_path')
        .neq('status', 'supported').order('created_at', { ascending: false })
      if (!cancel) setSamples(data || [])
    })()
    return () => { cancel = true }
  }, [appUser?.is_owner, reload])

  const boat = boats.find(b => b.id === boatId)
  const format = boat?.format || 'audacious'
  const isBeryl = format === 'beryl'

  // Science trips would drag every average down, so Stats filters them.
  const statsSettlements = useMemo(() => {
    if (isBeryl || tripFilter === 'all') return settlements
    return settlements.filter(s => (tripFilter === 'fishing'
      ? (s.trip_type || 'fishing') === 'fishing'
      : (s.trip_type || 'fishing') !== 'fishing'))
  }, [settlements, tripFilter, isBeryl])

  const m = useMemo(() => computeMetrics({ settlements, lines, format }), [settlements, lines, format])

  async function openFile(path) {
    if (!path) return
    const bucket = path.startsWith('sample/') ? 'su-format-samples' : 'su-documents'
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600)
    if (error) { setError(error.message); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function openSample(path) {
    const { data, error } = await supabase.storage.from('su-format-samples').createSignedUrl(path, 3600)
    if (error) { setError(error.message); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function setTripType(id, trip_type) {
    const { error } = await supabase.from('su_settlements').update({ trip_type }).eq('id', id)
    if (error) { setError(error.message); return }
    setSettlements(rows => rows.map(r => (r.id === id ? { ...r, trip_type } : r)))
  }

  const openRow = settlements.find(s => s.id === openId)
  const openLines = lines.filter(l => l.settlement_id === openId)
  const openCrew = crew.filter(c => c.settlement_id === openId)
  const shareLabel = isBeryl ? 'Boat share' : "Owner's share"
  const dateLabel = isBeryl ? 'Landed' : 'Settled'

  return (
    <AppShell>
      <PageHeader
        eyebrow="Office → you"
        title="Settlements"
        sub={boat ? `${boat.name} ${boat.registration || ''}${boat.agent ? ' · ' + boat.agent : ''}`.trim() : 'Settled sheets returned by the office'}
      >
        {boat && !importing && <button onClick={() => setImporting(true)}>+ Add settlement</button>}
      </PageHeader>

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error" style={{ margin: 0 }}>{error}</p></div>}

      {appUser?.is_owner && samples.length > 0 && !importing && (
        <div style={{ marginBottom: 20 }}>
          <SectionRule side={`${samples.filter(s => s.status === 'pending').length} waiting`}>Formats sent in</SectionRule>
          <div className="tw"><table>
            <thead><tr><th>Sent</th><th>From</th><th>Agent</th><th>Note</th><th /></tr></thead>
            <tbody>{samples.map(s => (
              <tr key={s.id}>
                <td className="num">{(s.created_at || '').slice(0, 10)}</td>
                <td className="strong">{s.uploader_email || '—'}</td>
                <td>{s.agent || '—'}</td>
                <td className="muted">{s.note || '—'}</td>
                <td><button className="secondary" style={{ padding: '0.2rem 0.55rem', fontSize: '0.76rem' }} onClick={() => openSample(s.file_path)}>Open</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      {!loading && boats.length === 0 && <FormatSampleUpload />}

      {boats.length > 1 && !importing && (
        <div className="boatpick">
          {boats.map(b => (
            <button key={b.id} className={b.id === boatId ? 'on' : ''} onClick={() => { setBoatId(b.id); setTab('overview') }}>
              {b.name} {b.registration}
            </button>
          ))}
        </div>
      )}

      {/* WHAT HAS COME IN. Shown above everything else when there is any,
          because a sheet sitting unread is the one thing on this page that
          wants doing. */}
      {!importing && inbox.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--brass)' }}>
          <h3 style={{ margin: '0 0 0.3rem' }}>
            {inbox.length} settling sheet{inbox.length === 1 ? '' : 's'} arrived by email
          </h3>
          <p className="muted" style={{ margin: '0 0 0.7rem', fontSize: '0.82rem' }}>
            Filed as they came in. Opening one reads it and shows the totals for checking, exactly as
            uploading it by hand does — nothing is saved until you say so.
          </p>
          {inbox.map(it => (
            <div key={it.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center',
                                      flexWrap: 'wrap', padding: '0.4rem 0', borderTop: '1px solid var(--line)' }}>
              <span style={{ fontFamily: 'var(--font-mono, monospace)', minWidth: '7rem' }}>
                {String(it.received_at).slice(0, 10)}
              </span>
              <span style={{ flex: '1 1 12rem', fontSize: '0.88rem' }}>
                {it.filename}
                {it.from_email && <span className="muted" style={{ fontSize: '0.78rem' }}> · from {it.from_email}</span>}
              </span>
              <button onClick={() => { setFromInbox(it); setImporting(true) }}>Read it</button>
              <button className="secondary" style={{ color: 'var(--mute)' }}
                      onClick={async () => {
                        await supabase.from('su_inbox').update({ status: 'ignored' }).eq('id', it.id)
                        setInbox(x => x.filter(y => y.id !== it.id))
                      }}>Not one of ours</button>
            </div>
          ))}
        </div>
      )}

      {importing && boat && (
        <SettlementImport boat={boat} inboxItem={fromInbox}
          onCancel={() => { setImporting(false); setFromInbox(null) }}
          onSaved={async id => {
            /* Tie the arrival to what it became, so the same sheet emailed
               twice does not read as two outstanding jobs. */
            if (fromInbox) {
              await supabase.from('su_inbox')
                .update({ status: 'imported', settlement_id: id }).eq('id', fromInbox.id)
              setInbox(x => x.filter(y => y.id !== fromInbox.id))
            }
            setImporting(false); setFromInbox(null)
            setReload(n => n + 1); setTab('settlements'); setOpenId(id)
          }} />
      )}

      {!importing && boats.length > 0 && (
        <>
          <div className="tabs">
            {TABS.map(([k, label]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
            <span className="fl" style={{ margin: 0 }}>Year</span>
            <select value={year || ''} onChange={e => setYear(e.target.value)} style={{ width: 'auto' }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              {settlements.length} {isBeryl ? 'landing' : 'settlement'}{settlements.length === 1 ? '' : 's'}
              {m.daysAtSea.value ? ` · ${m.daysAtSea.value} days at sea` : ''}
              {!isBeryl && m.trips.value ? ` · ${m.trips.value} trips` : ''}
            </span>
          </div>

          {loading && <div className="card"><p className="muted" style={{ margin: 0 }}>Loading…</p></div>}

          {!loading && tab === 'overview' && (
            <>
              <div className="statgrid">
                <Stat label="Fish sales" value={money2(m.gross.value)} unavailable={m.gross.unavailable} />
                <Stat label="Expenses" value={money2(m.expenses.value)} unavailable={m.expenses.unavailable} />
                <Stat label="Crew wages" value={money2(m.crewWages.value)} unavailable={m.crewWages.unavailable} />
                <Stat label={shareLabel} value={money2(m.boatOwnerShare.value)} unavailable={m.boatOwnerShare.unavailable} sub={pct(m.boatOwnerSharePct.value)} />
                <Stat label="After expenses" value={money2(m.afterExpenses.value)} unavailable={m.afterExpenses.unavailable} />
                <Stat label="Cash generated" value={money2(m.cashGenerated.value)} unavailable={m.cashGenerated.unavailable} accent />
                <Stat label={`Unpaid invoices (${invoices.filter(i => i.status !== 'paid').length})`}
                  value={money2(invoices.filter(i => i.status !== 'paid').reduce((a, i) => a + Number(i.total || 0), 0))} />
                <Stat label="Settling VAT" value={money2(m.settlingVat.value)} unavailable={m.settlingVat.unavailable} />
              </div>
              {renderList()}
            </>
          )}

          {!loading && tab === 'settlements' && (openRow ? renderDetail() : renderList())}

          {!loading && tab === 'stats' && (
            <StatsTab settlements={statsSettlements} lines={lines} format={format}
              tripFilter={tripFilter} setTripFilter={setTripFilter} />
          )}

          {!loading && tab === 'crew' && <CrewTab crew={crew} settlements={settlements} />}
          {!loading && tab === 'invoices' && <InvoicesTab invoices={invoices} onOpenFile={openFile} />}
        </>
      )}
    </AppShell>
  )

  function renderList() {
    return (
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{dateLabel}</th><th>Ref</th>
              <th className="r">Fish sales</th><th className="r">Expenses</th>
              <th className="r">Crew wages</th><th className="r">{shareLabel}</th>
            </tr>
          </thead>
          <tbody>
            {settlements.length === 0 && <tr><td colSpan={6} className="muted">Nothing in {year}.</td></tr>}
            {settlements.map(s => (
              <tr key={s.id} className="rowlink" onClick={() => { setTab('settlements'); setOpenId(s.id) }}>
                <td className="num">{fmtDate(s.settling_date)}</td>
                <td className="strong">
                  {s.reference || '—'}
                  {(s.trip_type && s.trip_type !== 'fishing') && <span className="flag warn" style={{ marginLeft: 6 }}>{s.trip_type}</span>}
                </td>
                <td className="r num">{money2(s.total_income)}</td>
                <td className="r num">{money2(s.total_expenses)}</td>
                <td className="r num">{money2(s.crew_wages_total)}</td>
                <td className="r num strong">{money2(isBeryl ? s.boat_share : s.owners_share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  function renderDetail() {
    const s = openRow
    const bySection = {}
    for (const l of openLines) (bySection[l.section] = bySection[l.section] || []).push(l)

    return (
      <>
        <button className="secondary" style={{ marginBottom: 14 }} onClick={() => setOpenId(null)}>← All {isBeryl ? 'landings' : 'settlements'}</button>

        <SectionRule side={`${dateLabel.toLowerCase()} ${fmtDate(s.settling_date)}`}>
          {s.reference || 'Settlement'}
        </SectionRule>

        {/* Science trips are kept out of the fishing averages on Stats. */}
        {!isBeryl && (
          <div className="card">
            <div className="fl">Trip type</div>
            <div className="boatpick" style={{ marginBottom: 8 }}>
              {['fishing', 'science', 'other'].map(t => (
                <button key={t} className={(s.trip_type || 'fishing') === t ? 'on' : ''} onClick={() => setTripType(s.id, t)}>{t}</button>
              ))}
            </div>
            <p className="note" style={{ margin: 0 }}>Science and other trips are left out of the fishing averages on Stats.</p>
          </div>
        )}

        <div className="statgrid" style={{ marginTop: 14 }}>
          <Stat label="Fish sales" value={money2(s.total_income)} />
          <Stat label="Expenses" value={money2(s.total_expenses)} />
          <Stat label="Crew wages" value={money2(s.crew_wages_total)} />
          <Stat label={shareLabel} value={money2(isBeryl ? s.boat_share : s.owners_share)} />
          <Stat label="Cash generated" value={isBeryl ? null : money2(s.cash_generated)} unavailable={isBeryl ? 'A Beryl sheet has no recoveries section' : null} accent />
        </div>

        {['income', 'expense', 'recovery'].map(sec => {
          const list = (bySection[sec] || []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
          if (!list.length) return null
          const total = list.reduce((a, l) => a + Number(l.amount || 0), 0)
          return (
            <div key={sec} style={{ marginTop: 16 }}>
              <SectionRule side={`${list.length} line${list.length === 1 ? '' : 's'}`}>{SECTION_LABEL[sec]}</SectionRule>
              <div className="tw"><table>
                <thead><tr><th>Item</th><th className="r">Amount</th><th className="r">% of income</th></tr></thead>
                <tbody>{list.map(l => (
                  <tr key={l.id}>
                    <td className="strong">{l.label}</td>
                    <td className="r num">{money2(l.amount)}</td>
                    <td className="r num">{l.pct_income == null ? '—' : Number(l.pct_income).toFixed(2)}</td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><td>Total {SECTION_LABEL[sec].toLowerCase()}</td><td className="r num">{money2(total)}</td><td /></tr></tfoot>
              </table></div>
            </div>
          )
        })}

        {openCrew.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <SectionRule side={`${openCrew.length} crew`}>Crew wages</SectionRule>
            <div className="tw"><table>
              <thead><tr><th>Crew</th><th className="r">Gross</th><th className="r">Deductions</th><th className="r">Net</th><th>Method</th></tr></thead>
              <tbody>{openCrew.map(c => (
                <tr key={c.id}>
                  <td className="strong">{c.crew_name}{c.crew_code && <span className="g"> · {c.crew_code}</span>}</td>
                  <td className="r num">{money2(c.gross)}</td>
                  <td className="r num">{Number(c.deductions_total || c.bond || 0) ? money2(c.deductions_total || c.bond) : '—'}</td>
                  <td className="r num strong">{money2(c.net)}</td>
                  <td className="muted">{c.method || '—'}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr>
                <td>{openCrew.length} crew</td>
                <td className="r num">{money2(openCrew.reduce((a, c) => a + Number(c.gross || 0), 0))}</td>
                <td className="r num">{money2(openCrew.reduce((a, c) => a + Number(c.deductions_total || c.bond || 0), 0))}</td>
                <td className="r num">{money2(openCrew.reduce((a, c) => a + Number(c.net || 0), 0))}</td>
                <td />
              </tr></tfoot>
            </table></div>
          </div>
        )}

        <div className="card" style={{ marginTop: 16 }}>
          <div className="fl">On this sheet</div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: '0.86rem' }}>
            <span>Days at sea <b className="num">{s.days_at_sea ?? '—'}</b></span>
            <span>Trips <b className="num">{isBeryl ? 'n/a' : (s.trips ?? '—')}</b></span>
            <span>Weight landed <b className="num">{isBeryl ? 'n/a' : (s.weight_landed ? qty(s.weight_landed, 'kg') : '—')}</b></span>
            <span>Fuel used <b className="num">{isBeryl ? 'n/a' : (s.fuel_used ? qty(s.fuel_used, 'L') : '—')}</b></span>
            <span>Settling VAT <b className="num">{isBeryl ? 'n/a' : money2(s.settling_vat)}</b></span>
          </div>
          {s.file_path ? (
            <button className="secondary" style={{ marginTop: 12 }} onClick={() => openFile(s.file_path)}>View original sheet</button>
          ) : (
            <p className="note" style={{ marginBottom: 0 }}>No original sheet on file — this one predates the upload.</p>
          )}
        </div>

        <Reconcile settlement={s} stLines={openLines} stCrew={openCrew} format={format} />
      </>
    )
  }
}
