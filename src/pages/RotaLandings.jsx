import { useState } from 'react'
import { supabase } from '../supabaseClient'

// Rota planner: landings, watches and the running tally.
//
// David works 2 landings on, 2 landings off in two watches, and a man can
// swap in the MIDDLE of a trip to cover a holiday. So the unit is the
// LANDING, not the trip:
//
//     Crew A   david/david     2/0
//     Crew B   barry/barry     2/2
//     Crew A   david/barry     3/3
//
// Each slot is one landing; the right-hand column is the running tally.
//
// WHERE A LANDING'S CREW COMES FROM, in order:
//   1. an explicit per-landing override (rota_landing_crew) — a swap
//   2. else the trip's team members — the normal case, no typing
//   3. else the trip-level crew (rota_trip_crew) — how the 29 older trips
//      were recorded, before landings existed
//
// An empty override is treated as "inherit" rather than "nobody aboard",
// since a landing with no crew is not a real thing.

export function effectiveCrewIds(landing, trip, teamMembers, tripCrewIds, landingCrew) {
  const explicit = landingCrew[landing.id]
  if (explicit && explicit.length) return explicit
  if (trip.team_id && teamMembers[trip.team_id]?.length) return teamMembers[trip.team_id]
  return tripCrewIds || []
}

// Two men who share a berth: when one is on, the other is off. The whole
// point of knowing this is that a swap has an obvious answer — if David
// cannot do landing 2, the man who covers him is Barry.
export function partnerOf(crewId, pairs) {
  for (const p of pairs) {
    if (p.crew_a_id === crewId) return p.crew_b_id
    if (p.crew_b_id === crewId) return p.crew_a_id
  }
  return null
}

const chipStyle = (on, pal) => ({
  padding: '0.2rem 0.55rem', borderRadius: 14, fontSize: '0.8rem', cursor: 'pointer',
  border: on ? `2px solid ${pal.dot}` : '1px solid var(--border)',
  background: on ? pal.bg : 'transparent',
  color: on ? pal.fg : 'inherit',
  fontWeight: on ? 700 : 400,
})

/* ---------------- teams ---------------- */

export function TeamsPanel({ teams, teamMembers, rotaCrew, isSkipper, onChange, setError }) {
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  async function addTeam() {
    if (!newName.trim()) return
    setBusy(true)
    const sort = (teams.reduce((m, t) => Math.max(m, t.sort || 0), 0) || 0) + 10
    const { error } = await supabase.from('rota_teams').insert({ name: newName.trim(), sort })
    setBusy(false)
    if (error) setError(error.message)
    else { setNewName(''); onChange() }
  }

  async function removeTeam(t) {
    if (!confirm(`Delete ${t.name}? Trips assigned to it keep their landings but lose the watch.`)) return
    const { error } = await supabase.from('rota_teams').delete().eq('id', t.id)
    if (error) setError(error.message); else onChange()
  }

  async function toggleMember(teamId, crewId) {
    const inTeam = (teamMembers[teamId] || []).includes(crewId)
    const { error } = inTeam
      ? await supabase.from('rota_team_members').delete().eq('team_id', teamId).eq('crew_id', crewId)
      : await supabase.from('rota_team_members').insert({ team_id: teamId, crew_id: crewId })
    if (error && error.code !== '23505') setError(error.message)
    else onChange()
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Watches</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Set each watch once. A trip put on a watch takes these men automatically — you only
        touch a landing when somebody swaps.
      </p>

      {teams.length === 0 && <p className="muted">No watches yet.</p>}

      {teams.map((t) => (
        <div key={t.id} style={{ borderTop: '1px solid var(--border)', padding: '0.6rem 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
            <strong>{t.name}</strong>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {(teamMembers[t.id] || []).length} men
              {isSkipper && (
                <button className="secondary" onClick={() => removeTeam(t)} style={{ marginLeft: '0.6rem', padding: '0.1rem 0.45rem', fontSize: '0.75rem' }}>delete</button>
              )}
            </span>
          </div>
          {isSkipper ? (
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
              {rotaCrew.map((c) => {
                const on = (teamMembers[t.id] || []).includes(c.id)
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleMember(t.id, c.id)}
                    style={chipStyle(on, { bg: 'var(--hull)', fg: '#fff', dot: 'var(--hull)' })}
                  >
                    {c.full_name}
                  </button>
                )
              })}
              {rotaCrew.length === 0 && <span className="muted" style={{ fontSize: '0.82rem' }}>No self-employed rotation crew on the books.</span>}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>
              {(teamMembers[t.id] || []).map((id) => rotaCrew.find((c) => c.id === id)?.full_name).filter(Boolean).join(', ') || '—'}
            </div>
          )}
        </div>
      ))}

      {isSkipper && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem', flexWrap: 'wrap' }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Crew C" style={{ maxWidth: 160 }} />
          <button className="secondary" onClick={addTeam} disabled={busy || !newName.trim()}>+ Add watch</button>
        </div>
      )}
    </div>
  )
}

/* ---------------- back-to-back pairs ---------------- */

export function PairsPanel({ pairs, teams, rotaCrew, crewName, isSkipper, onChange, setError }) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const paired = new Set(pairs.flatMap((p) => [p.crew_a_id, p.crew_b_id]))
  const free = rotaCrew.filter((c) => !paired.has(c.id))

  async function addPair() {
    if (!a || !b || a === b) return
    setBusy(true)
    const sort = (pairs.reduce((m, p) => Math.max(m, p.sort || 0), 0) || 0) + 10
    const { error } = await supabase.from('rota_back_to_back')
      .insert({ name: name.trim() || null, sort, crew_a_id: a, crew_b_id: b })
    setBusy(false)
    if (error) setError(error.message)
    else { setA(''); setB(''); setName(''); onChange() }
  }

  async function removePair(p) {
    const { error } = await supabase.from('rota_back_to_back').delete().eq('id', p.id)
    if (error) setError(error.message); else onChange()
  }

  // Crew A gets every A-side man, Crew B every B-side man. This is the whole
  // reason for recording the pairs, so it is one button rather than a dozen
  // taps that can be got wrong.
  async function fillWatches() {
    const [teamA, teamB] = teams
    if (!teamA || !teamB) { setError('Two watches are needed before they can be filled.'); return }
    if (!confirm(`Set ${teamA.name} and ${teamB.name} from the ${pairs.length} pairs? This replaces their current members.`)) return
    setBusy(true)
    for (const [team, side] of [[teamA, 'crew_a_id'], [teamB, 'crew_b_id']]) {
      const { error: delErr } = await supabase.from('rota_team_members').delete().eq('team_id', team.id)
      if (delErr) { setError(delErr.message); setBusy(false); return }
      const rows = pairs.map((p) => ({ team_id: team.id, crew_id: p[side] }))
      if (rows.length) {
        const { error } = await supabase.from('rota_team_members').insert(rows)
        if (error) { setError(error.message); setBusy(false); return }
      }
    }
    setBusy(false)
    onChange()
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Back to back</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Two men to a berth — when one is on, the other is off. Recording it means a swap has an
        obvious answer, and the watches can be filled in one go.
      </p>

      {pairs.length === 0 && <p className="muted">No pairs set.</p>}

      {pairs.map((p) => (
        <div key={p.id} style={{ borderTop: '1px solid var(--border)', padding: '0.5rem 0', display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span>
            {p.name && <strong style={{ marginRight: '0.5rem' }}>{p.name}</strong>}
            <span>{crewName[p.crew_a_id] || '—'}</span>
            <span className="muted" style={{ margin: '0 0.4rem' }}>⇄</span>
            <span>{crewName[p.crew_b_id] || '—'}</span>
          </span>
          {isSkipper && <button className="secondary" onClick={() => removePair(p)} style={{ padding: '0.1rem 0.45rem', fontSize: '0.75rem' }}>delete</button>}
        </div>
      ))}

      {isSkipper && (
        <>
          <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginTop: '0.8rem', alignItems: 'end' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              Berth (optional)
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Deckhand" />
            </label>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {teams[0]?.name || 'Watch A'}
              <select value={a} onChange={(e) => setA(e.target.value)}>
                <option value="">—</option>
                {free.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {teams[1]?.name || 'Watch B'}
              <select value={b} onChange={(e) => setB(e.target.value)}>
                <option value="">—</option>
                {free.filter((c) => c.id !== a).map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </label>
            <button className="secondary" onClick={addPair} disabled={busy || !a || !b} style={{ height: 'fit-content' }}>+ Add pair</button>
          </div>

          {free.length > 0 && (
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.6rem', marginBottom: 0 }}>
              Not yet paired: {free.map((c) => c.full_name).join(', ')}.
            </p>
          )}

          {pairs.length > 0 && teams.length >= 2 && (
            <div style={{ marginTop: '0.9rem' }}>
              <button onClick={fillWatches} disabled={busy}>
                Fill {teams[0].name} and {teams[1].name} from these pairs
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ---------------- per-trip landings ---------------- */

export function TripLandings({ trip, landings, landingCrew, teamMembers, teams, pairs, rotaCrew, crewName, pal, isSkipper, onChange, setError }) {
  const mine = landings.filter((l) => l.trip_id === trip.id).sort((a, b) => a.seq - b.seq)

  async function setTeam(teamId) {
    const { error } = await supabase.from('rota_trips').update({ team_id: teamId || null }).eq('id', trip.id)
    if (error) setError(error.message); else onChange()
  }

  async function addLanding() {
    const seq = (mine.reduce((m, l) => Math.max(m, l.seq), 0) || 0) + 1
    const { error } = await supabase.from('rota_trip_landings').insert({ trip_id: trip.id, seq })
    if (error) setError(error.message); else onChange()
  }

  async function removeLanding(l) {
    const { error } = await supabase.from('rota_trip_landings').delete().eq('id', l.id)
    if (error) setError(error.message); else onChange()
  }

  // Toggling a man on a landing writes an explicit override. The first tap
  // has to materialise the inherited crew too, or removing one man would
  // read as "inherit" and silently put everybody back.
  async function toggleLandingCrew(l, crewId) {
    const inherited = effectiveCrewIds(l, trip, teamMembers, trip.crew_ids, landingCrew)
    const explicit = landingCrew[l.id] || []
    let next
    if (explicit.length) {
      next = explicit.includes(crewId) ? explicit.filter((x) => x !== crewId) : [...explicit, crewId]
    } else {
      next = inherited.includes(crewId) ? inherited.filter((x) => x !== crewId) : [...inherited, crewId]
    }
    const { error: delErr } = await supabase.from('rota_landing_crew').delete().eq('rota_landing_id', l.id)
    if (delErr) { setError(delErr.message); return }
    if (next.length) {
      const { error } = await supabase.from('rota_landing_crew')
        .insert(next.map((id) => ({ rota_landing_id: l.id, crew_id: id })))
      if (error) { setError(error.message); return }
    }
    onChange()
  }

  // Swap a man for his back-to-back in one tap — the normal way a landing
  // changes hands, rather than deselecting one man and hunting for the other.
  async function swapForPartner(l, crewId, partnerId) {
    const current = effectiveCrewIds(l, trip, teamMembers, trip.crew_ids, landingCrew)
    const next = current.map((id) => (id === crewId ? partnerId : id))
    const { error: delErr } = await supabase.from('rota_landing_crew').delete().eq('rota_landing_id', l.id)
    if (delErr) { setError(delErr.message); return }
    const { error } = await supabase.from('rota_landing_crew')
      .insert(next.map((id) => ({ rota_landing_id: l.id, crew_id: id })))
    if (error) { setError(error.message); return }
    onChange()
  }

  async function setPlannedDate(l, date) {
    const { error } = await supabase.from('rota_trip_landings').update({ planned_date: date || null }).eq('id', l.id)
    if (error) setError(error.message); else onChange()
  }

  return (
    <div style={{ marginTop: '0.6rem', paddingTop: '0.6rem', borderTop: '1px dashed var(--border)' }}>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>
          Watch{' '}
          <select value={trip.team_id || ''} onChange={(e) => setTeam(e.target.value)} disabled={!isSkipper} style={{ width: 'auto', padding: '0.2rem 0.4rem', fontSize: '0.85rem' }}>
            <option value="">— none —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        {isSkipper && <button className="secondary" onClick={addLanding} style={{ padding: '0.15rem 0.55rem', fontSize: '0.8rem' }}>+ landing</button>}
        {mine.length === 0 && <span className="muted" style={{ fontSize: '0.8rem' }}>No landings planned on this trip yet.</span>}
      </div>

      {mine.map((l) => {
        const eff = effectiveCrewIds(l, trip, teamMembers, trip.crew_ids, landingCrew)
        const overridden = (landingCrew[l.id] || []).length > 0
        return (
          <div key={l.id} style={{ padding: '0.45rem 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <strong style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem' }}>Landing {l.seq}</strong>
              <input
                type="date"
                value={l.planned_date || ''}
                disabled={!isSkipper}
                onChange={(e) => setPlannedDate(l, e.target.value)}
                style={{ width: 'auto', padding: '0.15rem 0.35rem', fontSize: '0.8rem' }}
              />
              <span className="muted" style={{ fontSize: '0.75rem' }}>
                {overridden ? 'swapped' : trip.team_id ? 'from watch' : 'from trip crew'}
              </span>
              {isSkipper && <button className="secondary" onClick={() => removeLanding(l)} style={{ marginLeft: 'auto', padding: '0.1rem 0.45rem', fontSize: '0.75rem' }}>remove</button>}
            </div>
            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
              {isSkipper
                ? rotaCrew.map((c) => (
                    <button key={c.id} onClick={() => toggleLandingCrew(l, c.id)} style={chipStyle(eff.includes(c.id), pal)}>
                      {c.full_name}
                    </button>
                  ))
                : eff.map((id) => (
                    <span key={id} style={{ ...chipStyle(true, pal), cursor: 'default' }}>{crewName[id] || 'Unknown'}</span>
                  ))}
            </div>

            {isSkipper && (() => {
              const swaps = eff
                .map((id) => ({ id, partner: partnerOf(id, pairs || []) }))
                .filter((s) => s.partner && !eff.includes(s.partner))
              if (!swaps.length) return null
              return (
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.35rem', alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: '0.72rem' }}>swap:</span>
                  {swaps.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => swapForPartner(l, s.id, s.partner)}
                      title={`Put ${crewName[s.partner]} on this landing in place of ${crewName[s.id]}`}
                      style={{ padding: '0.12rem 0.45rem', borderRadius: 12, fontSize: '0.72rem', cursor: 'pointer', border: '1px dashed var(--border)', background: 'transparent' }}
                    >
                      {crewName[s.id]?.split(/\s+/)[0]} ⇄ {crewName[s.partner]?.split(/\s+/)[0]}
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>
        )
      })}
    </div>
  )
}

/* ---------------- the ledger ---------------- */

// Trips in order, each landing's crew, and the running tally per man — the
// 2/0, 2/2, 3/3 column, generalised past two people.
export function LandingsLedger({ trips, landings, landingCrew, teamMembers, teams, rotaCrew, crewName }) {
  const teamName = Object.fromEntries(teams.map((t) => [t.id, t.name]))
  const ordered = [...trips].sort((a, b) => a.start_date.localeCompare(b.start_date))

  const running = {}
  for (const c of rotaCrew) running[c.id] = 0

  const rows = []
  for (const t of ordered) {
    const mine = landings.filter((l) => l.trip_id === t.id).sort((a, b) => a.seq - b.seq)
    if (!mine.length) continue
    const slots = mine.map((l) => effectiveCrewIds(l, t, teamMembers, t.crew_ids, landingCrew))
    for (const ids of slots) for (const id of ids) if (id in running) running[id] += 1
    rows.push({ trip: t, slots, tally: { ...running } })
  }

  // Only show men who actually appear, or the table is mostly zeros.
  const involved = rotaCrew.filter((c) => running[c.id] > 0)

  if (!rows.length) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Landings ledger</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          No landings planned yet. Open a trip and add its landings — normally two — and the
          running tally builds here.
        </p>
      </div>
    )
  }

  const th = { padding: '0.4rem 0.5rem', textAlign: 'left', whiteSpace: 'nowrap' }
  const maxSlots = Math.max(...rows.map((r) => r.slots.length))

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Landings ledger</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Who did which landing, and how many each man has done by the end of that trip.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={th}>Trip</th>
              <th style={th}>Watch</th>
              {Array.from({ length: maxSlots }, (_, i) => <th key={i} style={th}>Landing {i + 1}</th>)}
              {involved.map((c) => (
                <th key={c.id} style={{ ...th, textAlign: 'right' }} title={c.full_name}>
                  {c.full_name.split(/\s+/)[0]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.trip.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ ...th, fontFamily: 'var(--font-mono, monospace)' }}>
                  {r.trip.start_date.slice(8, 10)}/{r.trip.start_date.slice(5, 7)}
                </td>
                <td style={th}>{teamName[r.trip.team_id] || <span className="muted">—</span>}</td>
                {Array.from({ length: maxSlots }, (_, i) => (
                  <td key={i} style={th}>
                    {r.slots[i]
                      ? r.slots[i].map((id) => crewName[id]?.split(/\s+/)[0]).filter(Boolean).join(', ') || <span className="muted">—</span>
                      : ''}
                  </td>
                ))}
                {involved.map((c) => (
                  <td key={c.id} style={{ ...th, textAlign: 'right', fontFamily: 'var(--font-mono, monospace)', fontWeight: 700 }}>
                    {r.tally[c.id]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {involved.map((c) => (
          <span key={c.id} style={{ padding: '0.3rem 0.7rem', borderRadius: 14, border: '1px solid var(--border)', fontSize: '0.85rem' }}>
            {c.full_name} <strong style={{ fontFamily: 'var(--font-mono, monospace)' }}>{running[c.id]}</strong>
          </span>
        ))}
      </div>
    </div>
  )
}
