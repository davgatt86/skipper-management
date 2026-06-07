import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import BackNav from '../BackNav'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

function money(n, currency) {
  if (n === null || n === undefined || n === '') return '—'
  const num = Number(n)
  if (currency && /^[A-Za-z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(num)
    } catch { /* fall through */ }
  }
  return `${currency || ''}${num.toFixed(2)}`
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB')
}

const round2 = (x) => Math.round(x * 100) / 100
const dayCount = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 86400000) + 1

export default function Closeout() {
  const { appUser } = useAuth()
  const now = new Date()
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  )
  const [crew, setCrew] = useState([])
  const [contracts, setContracts] = useState([])
  const [landings, setLandings] = useState([])
  const [closeouts, setCloseouts] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const canEdit = appUser?.role === 'skipper'

  const [yy, mm] = month.split('-').map(Number)
  const monthStart = `${month}-01`
  const daysInMonth = new Date(yy, mm, 0).getDate()
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`

  async function loadAll() {
    setLoading(true)
    setError('')
    const [cRes, ctRes, lRes, coRes, sRes] = await Promise.all([
      supabase.from('crew').select('id, full_name').order('full_name'),
      supabase.from('contracts').select('id, crew_id, start_date, end_date, status'),
      supabase
        .from('landings')
        .select('id, landing_date, boxes, locked, landing_crew(crew_id)')
        .gte('landing_date', monthStart)
        .lte('landing_date', monthEnd),
      supabase.from('month_closeouts').select('*').eq('month', monthStart),
      supabase.from('settings').select('*').maybeSingle(),
    ])
    const firstError = cRes.error || ctRes.error || lRes.error || coRes.error || sRes.error
    if (firstError) setError(firstError.message)
    setCrew(cRes.data || [])
    setContracts(ctRes.data || [])
    setLandings(lRes.data || [])
    setCloseouts(coRes.data || [])
    setSettings(sRes.data || null)
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [month])

  const crewName = {}
  for (const c of crew) crewName[c.id] = c.full_name

  const flatRate = settings ? Number(settings.flat_rate_per_month) : 0
  const boxRate = settings ? Number(settings.box_rate) : 0
  const cur = settings?.currency || ''

  const isClosed = closeouts.length > 0 && closeouts.every(r => !r.reopened_at)
  const isReopened = closeouts.length > 0 && closeouts.some(r => r.reopened_at)

  // --- live preview calculation ---
  function computeRows() {
    const byCrew = {}
    for (const ct of contracts) {
      const from = ct.start_date > monthStart ? ct.start_date : monthStart
      const to = (ct.end_date && ct.end_date < monthEnd) ? ct.end_date : monthEnd
      if (ct.start_date > monthEnd) continue
      if (ct.end_date && ct.end_date < monthStart) continue
      const days = Math.max(0, dayCount(from, to))
      if (days > 0) {
        byCrew[ct.crew_id] = (byCrew[ct.crew_id] || 0) + days
      }
    }
    const boxesByCrew = {}
    for (const l of landings) {
      for (const x of l.landing_crew || []) {
        boxesByCrew[x.crew_id] = (boxesByCrew[x.crew_id] || 0) + (l.boxes || 0)
      }
    }
    const ids = new Set([...Object.keys(byCrew), ...Object.keys(boxesByCrew)])
    const rows = []
    for (const id of ids) {
      const days = Math.min(byCrew[id] || 0, daysInMonth)
      const boxes = boxesByCrew[id] || 0
      const flat = round2(flatRate * days / daysInMonth)
      const boxBonus = round2(boxes * boxRate)
      rows.push({
        crew_id: id,
        name: crewName[id] || '—',
        days,
        boxes,
        flat,
        boxBonus,
        total: round2(flat + boxBonus),
      })
    }
    rows.sort((a, b) => a.name.localeCompare(b.name))
    return rows
  }

  const previewRows = !isClosed ? computeRows() : []

  const closedRows = isClosed || isReopened
    ? [...closeouts]
        .map(r => ({
          crew_id: r.crew_id,
          name: crewName[r.crew_id] || '—',
          days: r.days_on_contract,
          boxes: r.boxes_for_month,
          flat: Number(r.flat_rate_paid),
          boxBonus: Number(r.box_bonus_paid),
          total: Number(r.total_paid),
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : []

  async function closeMonth() {
    const rows = computeRows()
    if (rows.length === 0) {
      alert('Nothing to close — no contracts or landings in this month.')
      return
    }
    const total = rows.reduce((s, r) => s + r.total, 0)
    if (!confirm(
      `Close ${month}?\n\n${rows.length} crewmen, total ${money(total, cur)}.\n\nThis locks all landings in the month and records the wage payments.`
    )) return

    setBusy(true)
    setError('')

    if (isReopened) {
      const { error: delErr } = await supabase
        .from('month_closeouts')
        .delete()
        .eq('month', monthStart)
      if (delErr) { setError(delErr.message); setBusy(false); return }
    }

    const { data: inserted, error: insErr } = await supabase
      .from('month_closeouts')
      .insert(rows.map(r => ({
        fleet_id: appUser.fleet_id,
        month: monthStart,
        crew_id: r.crew_id,
        days_on_contract: r.days,
        boxes_for_month: r.boxes,
        flat_rate_paid: r.flat,
        box_bonus_paid: r.boxBonus,
        total_paid: r.total,
        closed_at: new Date().toISOString(),
        closed_by: appUser.id,
      })))
      .select('id, crew_id, total_paid')
    if (insErr) { setError(insErr.message); setBusy(false); return }

    const today = new Date().toISOString().slice(0, 10)
    const { error: payErr } = await supabase.from('payments').insert(
      (inserted || []).map(r => ({
        fleet_id: appUser.fleet_id,
        crew_id: r.crew_id,
        payment_date: today,
        amount: r.total_paid,
        payment_type: 'wages',
        month_closeout_id: r.id,
        notes: `Wages ${month}`,
        created_by: appUser.id,
      }))
    )
    if (payErr) { setError(`Closeout saved but payments failed: ${payErr.message}`); setBusy(false); loadAll(); return }

    const { error: lockErr } = await supabase
      .from('landings')
      .update({ locked: true })
      .gte('landing_date', monthStart)
      .lte('landing_date', monthEnd)
    if (lockErr) setError(`Closed, but locking landings failed: ${lockErr.message}`)

    setBusy(false)
    loadAll()
  }

  async function reopenMonth() {
    const reason = window.prompt(`Reason for reopening ${month}? (shown in the audit trail)`)
    if (reason === null) return
    if (!confirm(`Reopen ${month}? Wage payment records for this month will be removed and landings unlocked — you must close the month again afterwards.`)) return

    setBusy(true)
    setError('')

    const ids = closeouts.map(r => r.id)

    const { error: upErr } = await supabase
      .from('month_closeouts')
      .update({
        reopened_at: new Date().toISOString(),
        reopened_by: appUser.id,
        reopen_reason: reason.trim() || null,
      })
      .eq('month', monthStart)
    if (upErr) { setError(upErr.message); setBusy(false); return }

    const { error: payErr } = await supabase
      .from('payments')
      .delete()
      .in('month_closeout_id', ids)
    if (payErr) { setError(payErr.message); setBusy(false); return }

    const { error: unlockErr } = await supabase
      .from('landings')
      .update({ locked: false })
      .gte('landing_date', monthStart)
      .lte('landing_date', monthEnd)
    if (unlockErr) setError(unlockErr.message)

    setBusy(false)
    loadAll()
  }

  function renderTable(rows) {
    const tFlat = rows.reduce((s, r) => s + r.flat, 0)
    const tBox = rows.reduce((s, r) => s + r.boxBonus, 0)
    const tTotal = rows.reduce((s, r) => s + r.total, 0)
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border)' }}>
              <th style={{ padding: '0.6rem 0.4rem' }}>Crewman</th>
              <th style={{ padding: '0.6rem 0.4rem' }}>Days</th>
              <th style={{ padding: '0.6rem 0.4rem' }}>Flat rate</th>
              <th style={{ padding: '0.6rem 0.4rem' }}>Boxes</th>
              <th style={{ padding: '0.6rem 0.4rem' }}>Box bonus</th>
              <th style={{ padding: '0.6rem 0.4rem' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.crew_id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.6rem 0.4rem', fontWeight: 600 }}>{r.name}</td>
                <td style={{ padding: '0.6rem 0.4rem' }}>{r.days}/{daysInMonth}</td>
                <td style={{ padding: '0.6rem 0.4rem' }}>{money(r.flat, cur)}</td>
                <td style={{ padding: '0.6rem 0.4rem' }}>{r.boxes}</td>
                <td style={{ padding: '0.6rem 0.4rem' }}>{money(r.boxBonus, cur)}</td>
                <td style={{ padding: '0.6rem 0.4rem', fontWeight: 600 }}>{money(r.total, cur)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--border)' }}>
              <td style={{ padding: '0.6rem 0.4rem', fontWeight: 700 }}>Total</td>
              <td></td>
              <td style={{ padding: '0.6rem 0.4rem', fontWeight: 700 }}>{money(tFlat, cur)}</td>
              <td></td>
              <td style={{ padding: '0.6rem 0.4rem', fontWeight: 700 }}>{money(tBox, cur)}</td>
              <td style={{ padding: '0.6rem 0.4rem', fontWeight: 700 }}>{money(tTotal, cur)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    )
  }

  const closedAt = closeouts.length > 0 ? closeouts[0].closed_at : null

  return (
    <div className="container">
      <div style={{ marginBottom: '1rem' }}>
        <BackNav />
      </div>

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ marginBottom: 0 }}>Month Closeout</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{ width: 'auto' }}
        />
      </header>

      {error && <div className="card" style={{ borderColor: 'var(--red)' }}><p className="error">{error}</p></div>}

      {loading && <div className="card"><p className="muted">Loading…</p></div>}

      {!loading && (
        <div className="card">
          {isClosed && (
            <p style={{ marginBottom: '1rem' }}>
              <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓ Closed</span>
              <span className="muted"> on {fmtDate(closedAt)} — landings locked, wages recorded.</span>
            </p>
          )}
          {isReopened && (
            <p style={{ marginBottom: '1rem' }}>
              <span style={{ color: 'var(--amber)', fontWeight: 700 }}>Reopened</span>
              <span className="muted"> — figures below are recalculated live. Close the month again when corrections are done.</span>
            </p>
          )}
          {!isClosed && !isReopened && (
            <p className="muted" style={{ marginBottom: '1rem' }}>
              Open — {landings.length} landing{landings.length === 1 ? '' : 's'} this month. Figures below are a live preview.
            </p>
          )}

          {(isClosed ? closedRows : previewRows).length === 0
            ? <p className="muted">No contracts or landings in this month.</p>
            : renderTable(isClosed ? closedRows : previewRows)}

          {canEdit && (
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              {!isClosed && (isClosed || previewRows.length > 0) && (
                <button onClick={closeMonth} disabled={busy}>
                  {busy ? 'Working…' : `Close ${month}`}
                </button>
              )}
              {isClosed && (
                <button className="secondary" onClick={reopenMonth} disabled={busy}>
                  {busy ? 'Working…' : 'Reopen month…'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
