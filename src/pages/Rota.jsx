import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import CrewTabs from '../CrewTabs'
import { TeamsPanel, PairsPanel, TripLandings, LandingsLedger } from './RotaLandings'

// Section 4 of the crew page: the rota planner.
//
// Rebuilt for legibility. A trip now reads as one continuous band across the
// days it covers, labelled with its crew count, instead of a run of separate
// coloured squares you had to count by eye. Crew are chips rather than a comma
// string, and each trip says plainly who is short and who is on holiday.
//
// The palette below stays literal rather than using the brand tokens: these
// are categorical colours whose whole job is to be told apart from one
// another, which is the documented exception in CLAUDE.md. Everything that is
// chrome rather than category uses the semantic tokens.

const PALETTE = [
  { bg: '#fecaca', fg: '#7f1d1d', dot: '#dc2626' },
  { bg: '#bfdbfe', fg: '#1e3a8a', dot: '#2563eb' },
  { bg: '#bbf7d0', fg: '#14532d', dot: '#16a34a' },
  { bg: '#fde68a', fg: '#78350f', dot: '#d97706' },
  { bg: '#e9d5ff', fg: '#581c87', dot: '#9333ea' },
  { bg: '#99f6e4', fg: '#134e4a', dot: '#0d9488' },
  { bg: '#fbcfe8', fg: '#831843', dot: '#db2777' },
  { bg: '#e2e8f0', fg: '#1e293b', dot: '#64748b' },
]
const HOLIDAY_DOT = '#f97316'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const pad = (n) => String(n).padStart(2, '0')
const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const fmtDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—')
const todayIso = () => { const t = new Date(); return isoOf(t.getFullYear(), t.getMonth(), t.getDate()) }
const initials = (name) => (name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
// Inclusive day count: a trip that starts and ends the same day is one day.
const daysInclusive = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1
const shiftIso = (iso, days) => {
  const d = new Date(iso); d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function Rota() {
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'
  const canView = isSkipper || appUser?.role === 'viewer'

  const [trips, setTrips] = useState([])
  const [holidays, setHolidays] = useState([])
  const [crew, setCrew] = useState([])
  const [teams, setTeams] = useState([])
  const [teamMembers, setTeamMembers] = useState({})   // team_id -> [crew_id]
  const [landings, setLandings] = useState([])         // rota_trip_landings
  const [landingCrew, setLandingCrew] = useState({})   // rota_landing_id -> [crew_id]
  const [pairs, setPairs] = useState([])              // back-to-back berths
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const now = new Date()
  const [viewY, setViewY] = useState(now.getFullYear())
  const [viewM, setViewM] = useState(now.getMonth())
  const [selStart, setSelStart] = useState('')
  const [openTrip, setOpenTrip] = useState('')

  const [hOpen, setHOpen] = useState(false)
  const [hCrew, setHCrew] = useState('')
  const [hStart, setHStart] = useState('')
  const [hEnd, setHEnd] = useState('')
  const [hNote, setHNote] = useState('')

  async function loadAll() {
    const [t, tc, h, c, tm, tmm, tl, lc, bb] = await Promise.all([
      supabase.from('rota_trips').select('*').order('start_date'),
      supabase.from('rota_trip_crew').select('*'),
      supabase.from('rota_holidays').select('*').order('start_date'),
      supabase.from('crew').select('id, full_name, status, archived_at, crew_type'),
      supabase.from('rota_teams').select('*').order('sort'),
      supabase.from('rota_team_members').select('*'),
      supabase.from('rota_trip_landings').select('*').order('seq'),
      supabase.from('rota_landing_crew').select('*'),
      supabase.from('rota_back_to_back').select('*').order('sort'),
    ])
    const err = t.error || tc.error || h.error || c.error || tm.error || tmm.error || tl.error || lc.error || bb.error
    if (err) { setError(err.message); return }
    const crewByTrip = {}
    for (const r of tc.data || []) (crewByTrip[r.trip_id] = crewByTrip[r.trip_id] || []).push(r.crew_id)
    setTrips((t.data || []).map((x) => ({ ...x, crew_ids: crewByTrip[x.id] || [] })))
    setHolidays(h.data || [])
    setCrew((c.data || []).filter((x) => !x.archived_at))
    setTeams(tm.data || [])
    const byTeam = {}
    for (const r of tmm.data || []) (byTeam[r.team_id] = byTeam[r.team_id] || []).push(r.crew_id)
    setTeamMembers(byTeam)
    setLandings(tl.data || [])
    const byLanding = {}
    for (const r of lc.data || []) (byLanding[r.rota_landing_id] = byLanding[r.rota_landing_id] || []).push(r.crew_id)
    setLandingCrew(byLanding)
    setPairs(bb.data || [])
  }
  useEffect(() => { loadAll().then(() => setLoading(false)) }, [])

  const crewName = useMemo(() => Object.fromEntries(crew.map((c) => [c.id, c.full_name])), [crew])
  // Rota crew = self-employed UK rotation lads only; contracted agency crew
  // are managed through contracts, not the rota.
  const rotaCrew = useMemo(() => crew.filter((c) => c.crew_type === 'self_employed' && c.status !== 'former'), [crew])

  const tripFor = (iso) => trips.find((t) => t.start_date <= iso && iso <= t.end_date)
  const holsFor = (iso) => holidays.filter((h) => h.start_date <= iso && iso <= h.end_date)
  const onHolidayDuring = (crewId, s, e) => holidays.some((h) => h.crew_id === crewId && !(h.end_date < s || e < h.start_date))

  /* ---------------- calendar interactions ---------------- */
  async function dayTap(iso) {
    if (!isSkipper) return
    setError('')
    if (!selStart) {
      const t = tripFor(iso)
      if (t) { setOpenTrip(t.id); return }
      setSelStart(iso)
      return
    }
    const [s, e] = selStart <= iso ? [selStart, iso] : [iso, selStart]
    setSelStart('')
    const clash = trips.find((t) => !(t.end_date < s || e < t.start_date))
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
    const lead = (first.getDay() + 6) % 7
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
  const upcoming = trips.filter((t) => t.end_date >= today)
  const past = trips.filter((t) => t.end_date < today)
  const upcomingHols = holidays.filter((h) => h.end_date >= today)
  const currentTrip = tripFor(today)

  // What this month actually contains, so the calendar has a caption rather
  // than leaving you to count coloured squares.
  const monthSummary = useMemo(() => {
    const days = weeks.flat().filter(Boolean)
    const atSea = days.filter((d) => tripFor(d)).length
    const tripsThisMonth = new Set(days.map((d) => tripFor(d)?.id).filter(Boolean)).size
    return { atSea, tripsThisMonth, total: days.length }
  }, [weeks, trips])

  if (loading) return <AppShell><p className="muted">Loading…</p></AppShell>
  if (!canView) return <AppShell><div className="card"><p className="muted">The rota is skipper/viewer only.</p></div></AppShell>

  const chip = (bg, fg, bold) => ({
    padding: '0.25rem 0.6rem', borderRadius: 14, fontSize: '0.82rem',
    background: bg, color: fg, fontWeight: bold ? 700 : 400,
    border: '1px solid var(--border)', display: 'inline-block',
  })

  return (
    <AppShell>
      <PageHeader
        title="Rota Planner"
        sub={isSkipper ? 'Tap a start day, then an end day, to plan a trip. Tap a planned day to open that trip.' : 'Planned trips and crew holidays.'}
      />

      <CrewTabs />

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error" style={{ marginBottom: 0 }}>{error}</p></div>}

      {currentTrip && (
        <div className="card" style={{ borderColor: 'var(--hull)' }}>
          <strong>At sea now</strong>{' '}
          <span className="muted">
            {fmtDate(currentTrip.start_date)} → {fmtDate(currentTrip.end_date)},
            day {daysInclusive(currentTrip.start_date, today)} of {daysInclusive(currentTrip.start_date, currentTrip.end_date)}
            {currentTrip.crew_ids.length ? ` · ${currentTrip.crew_ids.length} aboard` : ' · no crew set'}
          </span>
        </div>
      )}

      {/* ---------- calendar ---------- */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <button className="secondary" onClick={() => nav(-1)} aria-label="Previous month">‹</button>
          <div style={{ textAlign: 'center' }}>
            <strong style={{ fontSize: '1.05rem' }}>{MONTHS[viewM]} {viewY}</strong>
            <div className="muted" style={{ fontSize: '0.75rem' }}>
              {monthSummary.atSea} of {monthSummary.total} days at sea
              {monthSummary.tripsThisMonth > 0 && ` · ${monthSummary.tripsThisMonth} trip${monthSummary.tripsThisMonth === 1 ? '' : 's'}`}
            </div>
          </div>
          <button className="secondary" onClick={() => nav(1)} aria-label="Next month">›</button>
        </div>

        {selStart && (
          <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
            Trip starting <strong>{fmtDate(selStart)}</strong> — tap the end day…{' '}
            <button className="secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.8rem' }} onClick={() => setSelStart('')}>cancel</button>
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, fontSize: '0.8rem' }}>
          {DOW.map((d) => <div key={d} className="muted" style={{ textAlign: 'center', padding: '0.2rem 0', fontWeight: 600 }}>{d}</div>)}
          {weeks.flat().map((iso, i) => {
            if (!iso) return <div key={'e' + i} />
            const t = tripFor(iso)
            const hols = holsFor(iso)
            const pal = t ? PALETTE[t.colour % PALETTE.length] : null
            const isToday = iso === today
            const isSel = iso === selStart
            // A trip reads as one band: square off the joins, round the ends.
            // Compared by trip id, not merely "is there a trip", so two trips
            // running back to back do not merge into one band.
            const prev = t && tripFor(shiftIso(iso, -1))
            const next = t && tripFor(shiftIso(iso, 1))
            const startsHere = t && (!prev || prev.id !== t.id)
            const endsHere = t && (!next || next.id !== t.id)
            const radius = t
              ? `${startsHere ? 8 : 0}px ${endsHere ? 8 : 0}px ${endsHere ? 8 : 0}px ${startsHere ? 8 : 0}px`
              : '8px'
            return (
              <div
                key={iso}
                onClick={() => dayTap(iso)}
                role={isSkipper ? 'button' : undefined}
                tabIndex={isSkipper ? 0 : undefined}
                onKeyDown={isSkipper ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dayTap(iso) } } : undefined}
                title={t ? `${fmtDate(t.start_date)} → ${fmtDate(t.end_date)}` : ''}
                style={{
                  minHeight: 58, borderRadius: radius, padding: '0.25rem 0.3rem',
                  cursor: isSkipper ? 'pointer' : 'default',
                  background: isSel ? 'var(--hull)' : pal ? pal.bg : 'var(--bg-soft, #f8fafc)',
                  color: isSel ? '#fff' : pal ? pal.fg : 'inherit',
                  border: isToday ? '2px solid var(--hull)' : '1px solid var(--border)',
                  display: 'flex', flexDirection: 'column', gap: 2,
                }}
              >
                <div style={{ fontWeight: isToday ? 800 : 600, fontFamily: 'var(--font-mono, monospace)' }}>
                  {Number(iso.slice(8, 10))}
                </div>
                {t && startsHere && (
                  <div style={{ fontSize: '0.62rem', fontWeight: 700, lineHeight: 1.1 }}>
                    {t.crew_ids.length ? `${t.crew_ids.length} crew` : 'no crew'}
                  </div>
                )}
                {hols.length > 0 && (
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: 'auto' }}>
                    {hols.slice(0, 3).map((h) => (
                      <span key={h.id} title={`${crewName[h.crew_id]} on holiday`} style={{ background: HOLIDAY_DOT, color: '#fff', borderRadius: 3, fontSize: '0.6rem', padding: '0 3px', fontWeight: 700 }}>
                        {initials(crewName[h.crew_id])}
                      </span>
                    ))}
                    {hols.length > 3 && <span style={{ fontSize: '0.6rem', fontWeight: 700 }}>+{hols.length - 3}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.6rem', marginBottom: 0 }}>
          Coloured band = planned trip ·{' '}
          <span style={{ background: HOLIDAY_DOT, color: '#fff', borderRadius: 3, padding: '0 3px', fontWeight: 700 }}>AB</span> = crew holiday ·
          all dates approximate, weather permitting
        </p>
      </div>

      {/* ---------- trip list ---------- */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Planned trips</h2>
        {!upcoming.length && <p className="muted">No upcoming trips — tap two days on the calendar to plan one.</p>}
        {upcoming.map((t) => {
          const pal = PALETTE[t.colour % PALETTE.length]
          const open = openTrip === t.id
          const clashes = t.crew_ids.filter((id) => onHolidayDuring(id, t.start_date, t.end_date))
          return (
            <div key={t.id} style={{ borderTop: '1px solid var(--border)', padding: '0.7rem 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }} onClick={() => setOpenTrip(open ? '' : t.id)}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: pal.dot, display: 'inline-block' }} />
                  <strong>{fmtDate(t.start_date)} → {fmtDate(t.end_date)}</strong>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>{daysInclusive(t.start_date, t.end_date)} days</span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    {t.crew_ids.length ? `${t.crew_ids.length} crew` : 'no crew yet'}
                  </span>
                  {isSkipper && <button className="secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem' }} onClick={() => deleteTrip(t)}>delete</button>}
                </div>
              </div>

              {/* Who is on it, always visible — this was a comma-separated
                  string that ran off the end of the row. */}
              {t.crew_ids.length > 0 && (
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.45rem' }}>
                  {t.crew_ids.map((id) => (
                    <span key={id} style={chip(pal.bg, pal.fg, true)}>
                      {crewName[id] || 'Unknown'}
                      {onHolidayDuring(id, t.start_date, t.end_date) && ' ⚠'}
                    </span>
                  ))}
                </div>
              )}
              {clashes.length > 0 && (
                <p style={{ fontSize: '0.8rem', color: 'var(--brass)', fontWeight: 700, margin: '0.4rem 0 0' }}>
                  ⚠ {clashes.map((id) => crewName[id]).filter(Boolean).join(', ')} {clashes.length === 1 ? 'is' : 'are'} on holiday during this trip.
                </p>
              )}

              {open && (
                <>
                  {/* Per-landing crew: where a mid-trip swap lives. */}
                  <TripLandings
                    trip={t}
                    landings={landings}
                    landingCrew={landingCrew}
                    teamMembers={teamMembers}
                    teams={teams}
                    pairs={pairs}
                    rotaCrew={rotaCrew}
                    crewName={crewName}
                    pal={pal}
                    isSkipper={isSkipper}
                    onChange={loadAll}
                    setError={setError}
                  />

                  {isSkipper && (
                    <div style={{ marginTop: '0.6rem', paddingTop: '0.6rem', borderTop: '1px dashed var(--border)' }}>
                      <div className="muted" style={{ fontSize: '0.78rem', marginBottom: '0.4rem' }}>
                        Crew for the whole trip — used only where a landing has no watch and no crew of
                        its own. Rotation crew only; contracted crew are handled through contracts.
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {rotaCrew.map((c) => {
                          const onTrip = t.crew_ids.includes(c.id)
                          const onHol = onHolidayDuring(c.id, t.start_date, t.end_date)
                          return (
                            <button
                              key={c.id}
                              onClick={() => toggleTripCrew(t, c.id)}
                              style={{
                                ...chip(onTrip ? pal.bg : 'transparent', onTrip ? pal.fg : 'inherit', onTrip),
                                cursor: 'pointer',
                                border: onTrip ? `2px solid ${pal.dot}` : '1px solid var(--border)',
                              }}
                            >
                              {c.full_name}{onHol ? ' ⚠ holiday' : ''}
                            </button>
                          )
                        })}
                      </div>
                      {rotaCrew.length === 0 && <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>No self-employed rotation crew on the books.</p>}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}

        {past.length > 0 && (
          <details style={{ marginTop: '0.6rem' }}>
            <summary className="muted" style={{ cursor: 'pointer' }}>Past trips ({past.length})</summary>
            {past.slice().reverse().map((t) => (
              <div key={t.id} style={{ padding: '0.45rem 0', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                <span>
                  {fmtDate(t.start_date)} → {fmtDate(t.end_date)}{' '}
                  <span className="muted">{t.crew_ids.map((id) => crewName[id]).filter(Boolean).join(', ') || 'no crew recorded'}</span>
                </span>
                {isSkipper && <button className="secondary" style={{ padding: '0.1rem 0.45rem', fontSize: '0.78rem' }} onClick={() => deleteTrip(t)}>delete</button>}
              </div>
            ))}
          </details>
        )}
      </div>

      {/* ---------- watches and the landings ledger ---------- */}
      <TeamsPanel
        teams={teams}
        teamMembers={teamMembers}
        rotaCrew={rotaCrew}
        isSkipper={isSkipper}
        onChange={loadAll}
        setError={setError}
      />

      <PairsPanel
        pairs={pairs}
        teams={teams}
        rotaCrew={rotaCrew}
        crewName={crewName}
        isSkipper={isSkipper}
        onChange={loadAll}
        setError={setError}
      />

      <LandingsLedger
        trips={trips}
        landings={landings}
        landingCrew={landingCrew}
        teamMembers={teamMembers}
        teams={teams}
        rotaCrew={rotaCrew}
        crewName={crewName}
      />

      {/* ---------- holidays ---------- */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ marginBottom: 0, marginTop: 0 }}>Crew holidays</h2>
          {isSkipper && !hOpen && <button onClick={() => setHOpen(true)}>+ Add holiday</button>}
        </div>

        {hOpen && (
          <form onSubmit={saveHoliday} style={{ marginTop: '0.8rem', display: 'grid', gap: '0.6rem', maxWidth: 420 }}>
            <select value={hCrew} onChange={(e) => setHCrew(e.target.value)} required>
              <option value="">Crewman…</option>
              {rotaCrew.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
            <label style={{ fontSize: '0.85rem' }}>From <input type="date" value={hStart} onChange={(e) => setHStart(e.target.value)} required /></label>
            <label style={{ fontSize: '0.85rem' }}>To <input type="date" value={hEnd} onChange={(e) => setHEnd(e.target.value)} required /></label>
            <input placeholder="Note (optional)" value={hNote} onChange={(e) => setHNote(e.target.value)} />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save holiday'}</button>
              <button type="button" className="secondary" onClick={() => setHOpen(false)}>Cancel</button>
            </div>
          </form>
        )}

        {/* The empty state used to test ALL holidays but render only upcoming
            ones, so a page with nothing but past holidays showed neither a row
            nor a message. */}
        {upcomingHols.length === 0 && (
          <p className="muted" style={{ marginTop: '0.6rem', marginBottom: 0 }}>
            {holidays.length === 0
              ? 'No holidays recorded.'
              : `No upcoming holidays. ${holidays.length} past one${holidays.length === 1 ? '' : 's'} on record.`}
          </p>
        )}
        {upcomingHols.map((h) => (
          <div key={h.id} style={{ padding: '0.5rem 0', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span>
              <strong>{crewName[h.crew_id] || 'Unknown'}</strong> {fmtDate(h.start_date)} → {fmtDate(h.end_date)}
              <span className="muted" style={{ fontSize: '0.8rem' }}> · {daysInclusive(h.start_date, h.end_date)} days</span>
              {h.note && <span className="muted"> — {h.note}</span>}
            </span>
            {isSkipper && <button className="secondary" style={{ padding: '0.1rem 0.45rem', fontSize: '0.78rem' }} onClick={() => deleteHoliday(h)}>delete</button>}
          </div>
        ))}
      </div>
    </AppShell>
  )
}
