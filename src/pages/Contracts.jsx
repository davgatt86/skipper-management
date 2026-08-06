import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

const STATUS_LABEL = { current: 'Current', pending_return: 'Gone Home', completed: 'Completed' }
const STATUS_COLOR = { current: 'var(--green)', pending_return: 'var(--amber)', completed: 'var(--grey-400)' }

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
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function addMonths(isoDate, months) {
  const d = new Date(isoDate + 'T00:00:00')
  if (isNaN(d)) return null
  const whole = Math.floor(months)
  const frac = months - whole
  d.setMonth(d.getMonth() + whole)
  if (frac > 0) d.setDate(d.getDate() + Math.round(frac * 30.44))
  return d.toISOString().slice(0, 10)
}

function promptDate(message) {
  const today = new Date().toISOString().slice(0, 10)
  const v = window.prompt(`${message} (YYYY-MM-DD)`, today)
  if (v === null) return null
  const t = v.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || isNaN(Date.parse(t))) {
    alert('Invalid date — use YYYY-MM-DD')
    return null
  }
  return t
}

const round2 = (x) => Math.round(x * 100) / 100

export default function Contracts() {
  const { appUser } = useAuth()
  const [contracts, setContracts] = useState([])
  const [crew, setCrew] = useState([])
  const [settings, setSettings] = useState(null)
  const [ghbPaid, setGhbPaid] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [newCrewId, setNewCrewId] = useState('')
  const [newStart, setNewStart] = useState('')
  const [newGhb, setNewGhb] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const canEdit = appUser?.role === 'skipper'

  async function loadAll() {
    setLoading(true)
    setError('')

    const [ctRes, crewRes, setRes, payRes] = await Promise.all([
      supabase
        .from('contracts')
        .select('*, crew(full_name)')
        .order('start_date', { ascending: false }),
      supabase
        .from('crew')
        .select('id, full_name')
        .is('archived_at', null)
        .order('full_name'),
      supabase.from('settings').select('*').maybeSingle(),
      supabase
        .from('payments')
        .select('contract_id, payment_type')
        .in('payment_type', ['ghb_first_half', 'ghb_second_half']),
    ])

    const firstError = ctRes.error || crewRes.error || setRes.error || payRes.error
    if (firstError) setError(firstError.message)

    setContracts(ctRes.data || [])
    setCrew(crewRes.data || [])
    setSettings(setRes.data || null)

    const paid = {}
    for (const p of payRes.data || []) {
      if (!p.contract_id) continue
      if (!paid[p.contract_id]) paid[p.contract_id] = {}
      if (p.payment_type === 'ghb_first_half') paid[p.contract_id].first = true
      if (p.payment_type === 'ghb_second_half') paid[p.contract_id].second = true
    }
    setGhbPaid(paid)
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  const crewWithCurrent = new Set(
    contracts.filter(c => c.status === 'current').map(c => c.crew_id)
  )

  function ghbHalves(c) {
    const raw = settings ? Number(settings.ghb_first_half_pct) : 0.5
    const frac = raw > 1 ? raw / 100 : raw
    const total = Number(c.going_home_bonus)
    const first = round2(total * frac)
    return { total, first, second: round2(total - first) }
  }

  async function addContract(e) {
    e.preventDefault()
    if (!newCrewId || !newStart) return
    setBusy(true)
    setError('')
    const { error } = await supabase.from('contracts').insert({
      fleet_id: appUser.fleet_id,
      crew_id: newCrewId,
      start_date: newStart,
      going_home_bonus: newGhb === '' ? null : Number(newGhb),
      notes: newNotes.trim() || null,
      status: 'current',
    })
    setBusy(false)
    if (error) {
      setError(error.message)
    } else {
      setNewCrewId('')
      setNewStart('')
      setNewGhb('')
      setNewNotes('')
      setAdding(false)
      loadAll()
    }
  }

  async function markGoneHome(c) {
    const d = promptDate(`Mark ${c.crew?.full_name || 'crewman'} as gone home — contract end date`)
    if (!d) return
    const { error } = await supabase
      .from('contracts')
      .update({ status: 'pending_return', end_date: d })
      .eq('id', c.id)
    if (error) setError(error.message)
    else loadAll()
  }

  async function markReturned(c) {
    const d = promptDate(`Mark ${c.crew?.full_name || 'crewman'} as returned — return date`)
    if (!d) return
    const { error } = await supabase
      .from('contracts')
      .update({ status: 'completed', return_date: d })
      .eq('id', c.id)
    if (error) setError(error.message)
    else loadAll()
  }

  async function setGhbAmount(c) {
    const v = window.prompt(
      `Going-home bonus for ${c.crew?.full_name || 'crewman'}`,
      c.going_home_bonus ?? ''
    )
    if (v === null) return
    const t = v.trim()
    if (t !== '' && (isNaN(Number(t)) || Number(t) < 0)) {
      alert('Enter a number, e.g. 1000')
      return
    }
    const { error } = await supabase
      .from('contracts')
      .update({ going_home_bonus: t === '' ? null : Number(t) })
      .eq('id', c.id)
    if (error) setError(error.message)
    else loadAll()
  }

  async function markHalfPaid(c, half) {
    const { first, second } = ghbHalves(c)
    const amount = half === 'first' ? first : second
    const name = c.crew?.full_name || 'crewman'
    const label = half === 'first' ? '1st' : '2nd'
    if (!confirm(`Record ${label} half GHB of ${money(amount, settings?.currency)} as paid to ${name}?`)) return
    const d = promptDate(`Date the ${label} half was paid`)
    if (!d) return
    const { error } = await supabase.from('payments').insert({
      fleet_id: appUser.fleet_id,
      crew_id: c.crew_id,
      payment_date: d,
      amount,
      payment_type: half === 'first' ? 'ghb_first_half' : 'ghb_second_half',
      contract_id: c.id,
      notes: `GHB ${label} half`,
      created_by: appUser.id,
    })
    if (error) setError(error.message)
    else loadAll()
  }

  function renderGhb(c) {
    const cur = settings?.currency || ''
    if (c.going_home_bonus === null || c.going_home_bonus === undefined) {
      return <span className="muted">not set</span>
    }
    const { total, first, second } = ghbHalves(c)
    const paid = ghbPaid[c.id] || {}

    if (c.status === 'current') {
      return <span>{money(total, cur)}</span>
    }
    return (
      <span>
        {money(total, cur)}
        <div style={{ fontSize: '0.8rem', marginTop: '0.15rem' }}>
          <span style={{ color: paid.first ? 'var(--green)' : 'var(--amber)' }}>
            1st {money(first, cur)} {paid.first ? '✓ paid' : 'due'}
          </span>
          {' · '}
          <span style={{ color: paid.second ? 'var(--green)' : c.status === 'completed' ? 'var(--amber)' : 'var(--grey-400)' }}>
            2nd {money(second, cur)} {paid.second ? '✓ paid' : c.status === 'completed' ? 'due' : 'on return'}
          </span>
        </div>
      </span>
    )
  }

  function endCell(c) {
    if (c.end_date) return fmtDate(c.end_date)
    if (c.status === 'current' && settings?.expected_contract_months) {
      const est = addMonths(c.start_date, Number(settings.expected_contract_months))
      if (est) return <span className="muted" style={{ fontStyle: 'italic' }}>≈ {fmtDate(est)}</span>
    }
    return '—'
  }

  const btnStyle = { padding: '0.3rem 0.7rem', fontSize: '0.85rem' }

  function actionButtons(c) {
    const paid = ghbPaid[c.id] || {}
    const hasGhb = c.going_home_bonus !== null && c.going_home_bonus !== undefined
    return (
      <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {c.status === 'current' && (
          <button className="secondary" onClick={() => markGoneHome(c)} style={btnStyle}>Gone home…</button>
        )}
        {c.status === 'pending_return' && (
          <button className="secondary" onClick={() => markReturned(c)} style={btnStyle}>Returned…</button>
        )}
        {hasGhb && (c.status === 'pending_return' || c.status === 'completed') && !paid.first && (
          <button className="secondary" onClick={() => markHalfPaid(c, 'first')} style={btnStyle}>1st half paid…</button>
        )}
        {hasGhb && c.status === 'completed' && !paid.second && (
          <button className="secondary" onClick={() => markHalfPaid(c, 'second')} style={btnStyle}>2nd half paid…</button>
        )}
        <button className="secondary" onClick={() => setGhbAmount(c)} style={btnStyle}>Set GHB…</button>
      </div>
    )
  }

  return (
    <AppShell>
      <PageHeader title="Contracts">
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)}>+ New contract</button>
        )}
      </PageHeader>

      {error && <div className="card" style={{ borderColor: 'var(--red)' }}><p className="error">{error}</p></div>}

      {adding && (
        <div className="card">
          <h2>New contract</h2>
          <form onSubmit={addContract}>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Crewman</div>
              <select value={newCrewId} onChange={(e) => setNewCrewId(e.target.value)} required autoFocus>
                <option value="">Select crewman…</option>
                {crew.map(m => (
                  <option key={m.id} value={m.id} disabled={crewWithCurrent.has(m.id)}>
                    {m.full_name}{crewWithCurrent.has(m.id) ? ' — already on a current contract' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Start date</div>
              <input type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} required />
              {newStart && settings?.expected_contract_months && (
                <div className="muted" style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>
                  Expected end ≈ {fmtDate(addMonths(newStart, Number(settings.expected_contract_months)))} ({Number(settings.expected_contract_months)} months)
                </div>
              )}
            </label>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Going-home bonus ({settings?.currency || '£'}) — optional, can be set later</div>
              <input type="number" min="0" step="0.01" value={newGhb} onChange={(e) => setNewGhb(e.target.value)} placeholder="e.g. 1000" />
            </label>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Notes — optional</div>
              <input type="text" value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="e.g. second contract" />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add'}</button>
              <button type="button" className="secondary" onClick={() => { setAdding(false); setError('') }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {loading && <p className="muted">Loading…</p>}
        {!loading && contracts.length === 0 && (
          <p className="muted">No contracts yet. {canEdit && 'Click "New contract" above to add the first.'}</p>
        )}
        {!loading && contracts.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border)' }}>
                  <th style={{ padding: '0.6rem 0.4rem' }}>Crewman</th>
                  <th style={{ padding: '0.6rem 0.4rem' }}>Start</th>
                  <th style={{ padding: '0.6rem 0.4rem' }}>End</th>
                  <th style={{ padding: '0.6rem 0.4rem' }}>Returned</th>
                  <th style={{ padding: '0.6rem 0.4rem' }}>Status</th>
                  <th style={{ padding: '0.6rem 0.4rem' }}>Going-home bonus</th>
                  {canEdit && <th style={{ padding: '0.6rem 0.4rem', textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {contracts.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.6rem 0.4rem', fontWeight: 600 }}>
                      <Link to={`/contracts/${c.id}`}>{c.crew?.full_name || '—'}</Link>
                      {c.notes && <div className="muted" style={{ fontSize: '0.8rem', fontWeight: 400 }}>{c.notes}</div>}
                    </td>
                    <td style={{ padding: '0.6rem 0.4rem' }}>{fmtDate(c.start_date)}</td>
                    <td style={{ padding: '0.6rem 0.4rem' }}>{endCell(c)}</td>
                    <td style={{ padding: '0.6rem 0.4rem' }}>{fmtDate(c.return_date)}</td>
                    <td style={{ padding: '0.6rem 0.4rem' }}>
                      <span style={{ color: STATUS_COLOR[c.status], fontWeight: 600 }}>
                        {STATUS_LABEL[c.status] || c.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.6rem 0.4rem' }}>{renderGhb(c)}</td>
                    {canEdit && (
                      <td style={{ padding: '0.6rem 0.4rem' }}>
                        {actionButtons(c)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
