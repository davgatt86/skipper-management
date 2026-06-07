import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import BackNav from '../BackNav'

// Trip period palette — cycles as trips are added (red, blue, ...)
const PALETTE = [
  { bg: '#fecaca', fg: '#991b1b', dot: '#dc2626', name: 'red' },
  { bg: '#bfdbfe', fg: '#1e40af', dot: '#2563eb', name: 'blue' },
  { bg: '#bbf7d0', fg: '#166534', dot: '#16a34a', name: 'green' },
  { bg: '#fde68a', fg: '#92400e', dot: '#d97706', name: 'amber' },
  { bg: '#e9d5ff', fg: '#6b21a8', dot: '#9333ea', name: 'purple' },
  { bg: '#99f6e4', fg: '#115e59', dot: '#0d9488', name: 'teal' },
  { bg: '#fbcfe8', fg: '#9d174d', dot: '#db2777', name: 'pink' },
  { bg: '#e2e8f0', fg: '#334155', dot: '#64748b', name: 'slate' },
]
const HOLIDAY_DOT = '#f97316'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const pad = n => String(n).padStart(2, '0')
const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`           // m 0-based
const fmtDate = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—'
const todayIso = () => { const t = new Date(); return isoOf(t.getFullYear(), t.getMonth(), t.getDate()) }
const initials = name => (name || '').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
const nights = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000)

export default function Rota() {
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'
  const canView = isSkipper || appUser?.role === 'viewer'

  const [trips, setTrips] = useState([])
  const [holidays, setHolidays] = useState([])
  const [crew, setCrew] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const now = new Date()
  const [viewY, setViewY] = useState(now.getFullYear())
  const [viewM, setViewM] = useState(now.getMonth())   // 0-based
  const [selStart, setSelStart] = useState('')          // first tap of a new trip
  const [openTrip, setOpenTrip] = useState('')          // trip id with crew picker open

  // holiday form
  const [hOpen, setHOpen] = useState(false)
  const [hCrew, setHCrew] = useState('')
  const [hStart, setHStart] = useState('')
  const [hEnd, setHEnd] = useState('')
  const [hNote, setHNote] = useState('')

  async function loadAll() {
    const [t, tc, h, c] = await Promise.all([
      supabase.from('rota_trips').select('*').order('start_date'),
      supabase.from('rota_trip_crew').select('*'),
      supabase.from('rota_holidays').select('*').order('start_date'),
      supabase.from('crew').select('id, full_name, status, archived_at'),
    ])
    const err = t.error || tc.error || h.error || c.error
    if (err) { setError(err.message); return }
    const crewByTrip = {}
    for (const r of tc.data || []) (crewByTrip[r.trip_id] = crewByTrip[r.trip_id] || []).push(r.crew_id)
    setTrips((t.data || []).map(x => ({ ...x, crew_ids: crewByTrip[x.id] || [] })))
    setHolidays(h.data || [])
    setCrew((c.data || []).filter(x => !x.archived_at))
  }
  useEffect(() => { loadAll().then(() => setLoading(false)) }, [])

  const crewName = useMemo(() => Object.fromEntries(crew.map(c => [c.id, c.full_name])), [crew])

  // day iso -> trip / holidays covering it
  const tripFor = iso => trips.find(t => t.start_date <= iso && iso <= t.end_date)
  const holsFor = iso => holidays.filter(h => h.start_date <= iso && iso <= h.end_date)

  /* ---------------- calendar interactions ---------------- */
  async function dayTap(iso) {
    if (!isSkipper) return
    setError('')
    if (!selStart) {
      const t = tripFor(iso)
      if (t) { setOpenTrip(t.id); return }   // tapping an existing trip opens it in the list
      setSelStart(iso)
      return
    }
    // second tap completes the period (either order)
    const [s, e] = selStart <= iso ? [selStart, iso] : [iso, selStart]
    setSelStart('')
    // refuse overlaps with existing trips — one boat, one trip at a time
    const clash = trips.find(t => !(t.end_date < s || e < t.start_date))
    if (clash) { setError(`Overlaps the ${fmtDate(clash.start_date)}–${fmtDate(clash.end_date)} trip — delete or adjust that one first.`); return }
    setBusy(true)
    const colour = trips.length % PALETTE.length
    const { error: err } = await supabase.from('rota_trips').insert({ start_date: s, end_date: e, colour })
    if (err) setError(err.message)
    else await loadAll()
    setBusy(false)
  }

  async function deleteTrip(t) {
    if (!confirm(`Delete the ${fmtDate(t.start_date)}–${fmtDate(t.end_date)} trip?`)) return
    const { error: err } = await supabase.from('rota_trips').delete().eq('id', t.id)
    if (err) setError(err.message); else loadAll()
  }

  async function toggleTripCrew(trip, crewId) {
    if (!isSkipper) return
    if (trip.crew_ids.includes(crewId)) {
      const { error: err } = await supabase.from('rota_trip_crew').delete().eq('trip_id', trip.id).eq('crew_id', crewId)
      if (err && err.code !== 'PGRST116') { setError(err.message); return }
    } else {
      const { error: err } = await supabase.from('rota_trip_crew').insert({ trip_id: trip.id, crew_id: crewId })
      if (err && err.code !== '23505') { setError(err.message); return }
    }
    loadAll()
  }

  async function saveHoliday(e) {
    e.preventDefault()
    if (!hCrew || !hStart || !hEnd) return
    const [s, en] = hStart <= hEnd ? [hStart, hEnd] : [hEnd, hStart]
    setBusy(true)
    const { error: err } = await supabase.from('rota_holidays').insert({ crew_id: hCrew, start_date: s, end_date: en, note: hNote.trim() })
    if (err) setError(err.message)
    else { setHOpen(false); setHCrew(''); setHStart(''); setHEnd(''); setHNote(''); await loadAll() }
    setBusy(false)
  }

  async function deleteHoliday(h) {
    if (!confirm(`Delete ${crewName[h.crew_id] || 'crew'}'s holiday ${fmtDate(h.start_date)}–${fmtDate(h.end_date)}?`)) return
    const { error: err } = await supabase.from('rota_holidays').delete().eq('id', h.id)
    if (err) setError(err.message); else loadAll()
  }

  /* ---------------- calendar grid ---------------- */
  const weeks = useMemo(() => {
    const first = new Date(viewY, viewM, 1)
    const lead = (first.getDay() + 6) % 7              // Monday-first offset
    const daysIn = new Date(viewY, viewM + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < lead; i++) cells.push(null)
    for (let d = 1; d <= daysIn; d++) cells.push(isoOf(viewY, viewM, d))
    while (cells.length % 7) cells.push(null)
    const out = []
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
    return out
  }, [viewY, viewM])

  function nav(dir) {
    let m = viewM + dir, y = viewY
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    setViewM(m); setViewY(y)
  }

  const today = todayIso()
  const upcoming = trips.filter(t => t.end_date >= today)
  const past = trips.filter(t => t.end_date < today)

  if (loading) return <div className="container"><p className="muted">Loading…</p></div>
  if (!canView) return <div className="container"><BackNav /><p className="muted" style={{ marginTop: '1rem' }}>The rota is skipper/viewer only.</p></div>

  return (
    <div className="container">
      <div style={{ marginBottom: '1rem' }}><BackNav /></div>
      <header style={{ marginBottom: '1rem' }}>
        <h1 style={{ marginBottom: 0 }}>Trip Rota</h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          {isSkipper ? 'Tap a start day, then an end day, to plan a trip. Tap a coloured day to open that trip below.' : 'Planned trips and crew holidays.'}
        </p>
      </header>

      {error && <div className="card" style={{ borderColor: 'var(--red)' }}><p className="error" style={{ marginBottom: 0 }}>{error}</p></div>}

      {/* ---------- calendar ---------- */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <button className="secondary" onClick={() => nav(-1)}>‹</button>
          <strong style={{ fontSize: '1.05rem' }}>{MONTHS[viewM]} {viewY}</strong>
          <button className="secondary" onClick={() => nav(1)}>›</button>
        </div>
        {selStart && (
          <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
            Trip starting <strong>{fmtDate(selStart)}</strong> — tap the end day…{' '}
            <button className="secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.8rem' }} onClick={() => setSelStart('')}>cancel</button>
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, fontSize: '0.8rem' }}>
          {DOW.map(d => <div key={d} className="muted" style={{ textAlign: 'center', padding: '0.2rem 0' }}>{d}</div>)}
          {weeks.flat().map((iso, i) => {
            if (!iso) return <div key={'e' + i} />
            const t = tripFor(iso)
            const hols = holsFor(iso)
            const pal = t ? PALETTE[t.colour % PALETTE.length] : null
            const isToday = iso === today
            const isSel = iso === selStart
            return (
              <div key={iso} onClick={() => dayTap(iso)}
                style={{
                  minHeight: 46, borderRadius: 6, padding: '0.2rem 0.25rem', cursor: isSkipper ? 'pointer' : 'default',
                  background: isSel ? 'var(--navy)' : pal ? pal.bg : 'var(--grey-50)',
                  color: isSel ? '#fff' : pal ? pal.fg : 'inherit',
                  outline: isToday ? '2px solid var(--navy)' : '1px solid var(--border)',
                }}>
                <div style={{ fontWeight: isToday ? 800 : 600 }}>{Number(iso.slice(8, 10))}</div>
                {hols.length > 0 && (
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: 1 }}>
                    {hols.slice(0, 3).map(h => (
                      <span key={h.id} title={crewName[h.crew_id]} style={{ background: HOLIDAY_DOT, color: '#fff', borderRadius: 3, fontSize: '0.6rem', padding: '0 2px', fontWeight: 700 }}>
                        {initials(crewName[h.crew_id])}
                      </span>
                    ))}
                    {hols.length > 3 && <span style={{ fontSize: '0.6rem' }}>+{hols.length - 3}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.5rem', marginBottom: 0 }}>
          Coloured = planned trip · <span style={{ background: HOLIDAY_DOT, color: '#fff', borderRadius: 3, padding: '0 3px', fontWeight: 700 }}>AB</span> = crew holiday · all dates approximate, weather permitting
        </p>
      </div>

      {/* ---------- trip list ---------- */}
      <div className="card">
        <h2>Planned trips</h2>
        {!upcoming.length && <p className="muted">No upcoming trips — tap two days on the calendar to plan one.</p>}
        {upcoming.map(t => {
          const pal = PALETTE[t.colour % PALETTE.length]
          const open = openTrip === t.id
          return (
            <div key={t.id} style={{ borderTop: '1px solid var(--border)', padding: '0.6rem 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }} onClick={() => setOpenTrip(open ? '' : t.id)}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: pal.dot, display: 'inline-block' }} />
                  <strong>{fmtDate(t.start_date)} → {fmtDate(t.end_date)}</strong>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>{nights(t.start_date, t.end_date) + 1} days</span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    {t.crew_ids.length ? t.crew_ids.map(id => crewName[id]).filter(Boolean).join(', ') : 'no crew yet'}
                  </span>
                  {isSkipper && <button className="secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem' }} onClick={() => deleteTrip(t)}>delete</button>}
                </div>
              </div>
              {open && isSkipper && (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                  {crew.filter(c => c.status !== 'former').map(c => {
                    const onTrip = t.crew_ids.includes(c.id)
                    const onHol = holidays.some(h => h.crew_id === c.id && !(h.end_date < t.start_date || t.end_date < h.start_date))
                    return (
                      <button key={c.id} onClick={() => toggleTripCrew(t, c.id)}
                        style={{
                          padding: '0.25rem 0.6rem', borderRadius: 14, fontSize: '0.82rem', cursor: 'pointer',
                          border: onTrip ? `2px solid ${pal.dot}` : '1px solid var(--border)',
                          background: onTrip ? pal.bg : '#fff', color: onTrip ? pal.fg : 'inherit', fontWeight: onTrip ? 700 : 400,
                        }}>
                        {c.full_name}{onHol ? ' ⚠ holiday' : ''}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {past.length > 0 && (
          <details style={{ marginTop: '0.6rem' }}>
            <summary className="muted" style={{ cursor: 'pointer' }}>Past trips ({past.length})</summary>
            {past.slice().reverse().map(t => (
              <div key={t.id} style={{ padding: '0.4rem 0', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                <span>{fmtDate(t.start_date)} → {fmtDate(t.end_date)} <span className="muted">{t.crew_ids.map(id => crewName[id]).filter(Boolean).join(', ')}</span></span>
                {isSkipper && <button className="secondary" style={{ padding: '0.1rem 0.45rem', fontSize: '0.78rem' }} onClick={() => deleteTrip(t)}>delete</button>}
              </div>
            ))}
          </details>
        )}
      </div>

      {/* ---------- holidays ---------- */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ marginBottom: 0 }}>Crew holidays</h2>
          {isSkipper && !hOpen && <button onClick={() => setHOpen(true)}>+ Add holiday</button>}
        </div>
        {hOpen && (
          <form onSubmit={saveHoliday} style={{ marginTop: '0.8rem', display: 'grid', gap: '0.6rem', maxWidth: 420 }}>
            <select value={hCrew} onChange={e => setHCrew(e.target.value)} required>
              <option value="">Crewman…</option>
              {crew.filter(c => c.status !== 'former').map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
            <label style={{ fontSize: '0.85rem' }}>From <input type="date" value={hStart} onChange={e => setHStart(e.target.value)} required /></label>
            <label style={{ fontSize: '0.85rem' }}>To <input type="date" value={hEnd} onChange={e => setHEnd(e.target.value)} required /></label>
            <input placeholder="Note (optional)" value={hNote} onChange={e => setHNote(e.target.value)} />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save holiday'}</button>
              <button type="button" className="secondary" onClick={() => setHOpen(false)}>Cancel</button>
            </div>
          </form>
        )}
        {!holidays.length && <p className="muted" style={{ marginTop: '0.6rem', marginBottom: 0 }}>No holidays recorded.</p>}
        {holidays.filter(h => h.end_date >= today).map(h => (
          <div key={h.id} style={{ padding: '0.5rem 0', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span>
              <strong>{crewName[h.crew_id] || 'Unknown'}</strong> {fmtDate(h.start_date)} → {fmtDate(h.end_date)}
              {h.note && <span className="muted"> — {h.note}</span>}
            </span>
            {isSkipper && <button className="secondary" style={{ padding: '0.1rem 0.45rem', fontSize: '0.78rem' }} onClick={() => deleteHoliday(h)}>delete</button>}
          </div>
        ))}
      </div>
    </div>
  )
}
