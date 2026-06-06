import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
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

export default function OneOffs() {
  const { appUser } = useAuth()
  const [bonuses, setBonuses] = useState([])
  const [crew, setCrew] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [fCrewId, setFCrewId] = useState('')
  const [fDate, setFDate] = useState(new Date().toISOString().slice(0, 10))
  const [fDesc, setFDesc] = useState('')
  const [fAmount, setFAmount] = useState('')
  const [fNotes, setFNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const isSkipper = appUser?.role === 'skipper'
  const canView = isSkipper || appUser?.role === 'viewer'

  async function loadAll() {
    setLoading(true)
    setError('')
    const [bRes, cRes, sRes] = await Promise.all([
      supabase
        .from('one_off_bonuses')
        .select('*')
        .order('bonus_date', { ascending: false }),
      supabase
        .from('crew')
        .select('id, full_name')
        .order('full_name'),
      supabase.from('settings').select('*').maybeSingle(),
    ])
    const firstError = bRes.error || cRes.error || sRes.error
    if (firstError) setError(firstError.message)
    setBonuses(bRes.data || [])
    setCrew(cRes.data || [])
    setSettings(sRes.data || null)
    setLoading(false)
  }

  useEffect(() => { if (canView) loadAll() }, [canView])

  if (!canView) {
    return (
      <div className="container">
        <div style={{ marginBottom: '1rem' }}>
          <Link to="/" style={{ fontSize: '0.9rem' }}>← Back to Dashboard</Link>
        </div>
        <div className="card">
          <p className="muted">This page is only available to the skipper.</p>
        </div>
      </div>
    )
  }

  const crewName = {}
  for (const c of crew) crewName[c.id] = c.full_name
  const cur = settings?.currency || ''

  const unpaidTotal = bonuses.filter(b => !b.paid).reduce((s, b) => s + Number(b.amount), 0)
  const paidTotal = bonuses.filter(b => b.paid).reduce((s, b) => s + Number(b.amount), 0)

  async function addBonus(e) {
    e.preventDefault()
    if (!fCrewId || !fDate || !fDesc.trim() || fAmount === '') return
    setBusy(true)
    setError('')
    const { error } = await supabase.from('one_off_bonuses').insert({
      fleet_id: appUser.fleet_id,
      crew_id: fCrewId,
      bonus_date: fDate,
      description: fDesc.trim(),
      amount: Number(fAmount),
      paid: false,
      notes: fNotes.trim() || null,
      created_by: appUser.id,
    })
    setBusy(false)
    if (error) {
      setError(error.message)
    } else {
      setFCrewId('')
      setFDate(new Date().toISOString().slice(0, 10))
      setFDesc('')
      setFAmount('')
      setFNotes('')
      setAdding(false)
      loadAll()
    }
  }

  async function markPaid(b) {
    const name = crewName[b.crew_id] || 'crewman'
    const d = promptDate(`Date ${money(b.amount, cur)} was paid to ${name}`)
    if (!d) return

    const { error: upErr } = await supabase
      .from('one_off_bonuses')
      .update({ paid: true, paid_date: d })
      .eq('id', b.id)
    if (upErr) { setError(upErr.message); return }

    const { error: payErr } = await supabase.from('payments').insert({
      fleet_id: appUser.fleet_id,
      crew_id: b.crew_id,
      payment_date: d,
      amount: Number(b.amount),
      payment_type: 'one_off',
      one_off_bonus_id: b.id,
      notes: b.description,
      created_by: appUser.id,
    })
    if (payErr) setError(`Marked paid but payment record failed: ${payErr.message}`)
    loadAll()
  }

  async function deleteBonus(b) {
    const name = crewName[b.crew_id] || 'crewman'
    if (!confirm(`Delete the ${money(b.amount, cur)} bonus for ${name}${b.paid ? ' and its payment record' : ''}? This can't be undone.`)) return
    if (b.paid) {
      const { error: payErr } = await supabase
        .from('payments')
        .delete()
        .eq('one_off_bonus_id', b.id)
      if (payErr) { setError(payErr.message); return }
    }
    const { error } = await supabase.from('one_off_bonuses').delete().eq('id', b.id)
    if (error) setError(error.message)
    else loadAll()
  }

  return (
    <div className="container">
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/" style={{ fontSize: '0.9rem' }}>← Back to Dashboard</Link>
      </div>

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>One-Off Bonuses</h1>
          <p className="muted" style={{ marginBottom: 0 }}>
            Skipper only — not visible to office or crew.
            {' '}Outstanding: <strong>{money(unpaidTotal, cur)}</strong> · Paid: {money(paidTotal, cur)}
          </p>
        </div>
        {!adding && <button onClick={() => setAdding(true)}>+ Add bonus</button>}
      </header>

      {error && <div className="card" style={{ borderColor: 'var(--red)' }}><p className="error">{error}</p></div>}

      {adding && (
        <div className="card">
          <h2>Add one-off bonus</h2>
          <form onSubmit={addBonus}>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Crewman</div>
              <select value={fCrewId} onChange={(e) => setFCrewId(e.target.value)} required autoFocus>
                <option value="">Select crewman…</option>
                {crew.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Date awarded</div>
              <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} required />
            </label>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Description</div>
              <input type="text" value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="e.g. Extra effort on gear repair" required />
            </label>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Amount ({cur || '£'})</div>
              <input type="number" min="0" step="0.01" value={fAmount} onChange={(e) => setFAmount(e.target.value)} placeholder="e.g. 100" required />
            </label>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Notes — optional</div>
              <input type="text" value={fNotes} onChange={(e) => setFNotes(e.target.value)} />
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
        {!loading && bonuses.length === 0 && (
          <p className="muted">No one-off bonuses yet. Click "Add bonus" above to add the first.</p>
        )}
        {!loading && bonuses.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border)' }}>
                  <th style={{ padding: '0.6rem 0.4rem' }}>Date</th>
                  <th style={{ padding: '0.6rem 0.4rem' }}>Crewman</th>
                  <th style={{ padding: '0.6rem 0.4rem' }}>Description</th>
                  <th style={{ padding: '0.6rem 0.4rem' }}>Amount</th>
                  <th style={{ padding: '0.6rem 0.4rem' }}>Status</th>
                  <th style={{ padding: '0.6rem 0.4rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bonuses.map(b => (
                  <tr key={b.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.6rem 0.4rem' }}>{fmtDate(b.bonus_date)}</td>
                    <td style={{ padding: '0.6rem 0.4rem', fontWeight: 600 }}>{crewName[b.crew_id] || '—'}</td>
                    <td style={{ padding: '0.6rem 0.4rem' }}>
                      {b.description}
                      {b.notes && <div className="muted" style={{ fontSize: '0.8rem' }}>{b.notes}</div>}
                    </td>
                    <td style={{ padding: '0.6rem 0.4rem', fontWeight: 600 }}>{money(b.amount, cur)}</td>
                    <td style={{ padding: '0.6rem 0.4rem' }}>
                      {b.paid
                        ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>✓ Paid {fmtDate(b.paid_date)}</span>
                        : <span style={{ color: 'var(--amber)', fontWeight: 600 }}>Unpaid</span>}
                    </td>
                    <td style={{ padding: '0.6rem 0.4rem' }}>
                      <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {!b.paid && (
                          <button className="secondary" onClick={() => markPaid(b)} style={{ padding: '0.3rem 0.7rem', fontSize: '0.85rem' }}>
                            Mark paid…
                          </button>
                        )}
                        <button className="secondary" onClick={() => deleteBonus(b)} style={{ padding: '0.3rem 0.7rem', fontSize: '0.85rem' }}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
