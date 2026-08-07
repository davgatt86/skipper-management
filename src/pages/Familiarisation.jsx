import { useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import CrewTabs from '../CrewTabs'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

// Crew familiarisation — the safety induction a man is taken through when he
// joins. 42 items in three categories, copied from what Audacious actually
// uses.
//
// The point of the page is the ticking, so the checklist opens straight into
// the categories with everything visible. A familiarisation nobody signed is
// not evidence of anything, so both signatures are recorded and the record
// only reads as complete when every item is ticked.

const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '—')

export default function Familiarisation() {
  const { appUser } = useAuth()
  const canEdit = appUser?.role === 'skipper'

  const [items, setItems] = useState([])
  const [crew, setCrew] = useState([])
  const [records, setRecords] = useState([])
  const [ticks, setTicks] = useState({})     // familiarisation_id -> Set(item_id)
  const [open, setOpen] = useState('')        // crew_id whose checklist is open
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true); setError('')
    const [iRes, cRes, rRes, tRes] = await Promise.all([
      supabase.from('familiarisation_items').select('*').eq('active', true).order('sort'),
      supabase.from('crew').select('id, full_name, status, rank_code, embarked_date').is('archived_at', null).neq('status', 'former').order('full_name'),
      supabase.from('crew_familiarisation').select('*'),
      supabase.from('crew_familiarisation_items').select('*'),
    ])
    const err = iRes.error || cRes.error || rRes.error || tRes.error
    if (err) setError(err.message)
    setItems(iRes.data || [])
    setCrew(cRes.data || [])
    setRecords(rRes.data || [])
    const by = {}
    for (const t of tRes.data || []) {
      if (!t.done_at) continue
      ;(by[t.familiarisation_id] = by[t.familiarisation_id] || new Set()).add(t.item_id)
    }
    setTicks(by)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const recOf = useMemo(() => Object.fromEntries(records.map((r) => [r.crew_id, r])), [records])
  const categories = useMemo(() => {
    const g = []
    for (const i of items) {
      let c = g.find((x) => x.name === i.category)
      if (!c) { c = { name: i.category, items: [] }; g.push(c) }
      c.items.push(i)
    }
    return g
  }, [items])

  const doneCount = (crewId) => {
    const r = recOf[crewId]
    return r ? (ticks[r.id]?.size || 0) : 0
  }

  // Anyone aboard with nothing ticked is the thing worth seeing first.
  const notStarted = crew.filter((c) => c.status === 'on_boat' && doneCount(c.id) === 0)

  async function ensureRecord(crewId) {
    if (recOf[crewId]) return recOf[crewId]
    const { data, error } = await supabase.from('crew_familiarisation')
      .insert({ crew_id: crewId }).select().single()
    if (error) { setError(error.message); return null }
    setRecords((p) => [...p, data])
    return data
  }

  async function toggle(crewId, itemId) {
    if (!canEdit) return
    setBusy(true)
    const rec = await ensureRecord(crewId)
    if (!rec) { setBusy(false); return }
    const on = ticks[rec.id]?.has(itemId)
    if (on) {
      const { error } = await supabase.from('crew_familiarisation_items')
        .delete().eq('familiarisation_id', rec.id).eq('item_id', itemId)
      if (error) { setError(error.message); setBusy(false); return }
    } else {
      const { error } = await supabase.from('crew_familiarisation_items')
        .upsert({ familiarisation_id: rec.id, item_id: itemId, done_at: new Date().toISOString() })
      if (error) { setError(error.message); setBusy(false); return }
    }
    setTicks((p) => {
      const s = new Set(p[rec.id] || [])
      if (on) s.delete(itemId); else s.add(itemId)
      return { ...p, [rec.id]: s }
    })
    setBusy(false)
  }

  async function tickAll(crewId) {
    if (!canEdit) return
    if (!confirm('Mark every item done for this crewman? Only do this if he has genuinely been taken through all of it.')) return
    setBusy(true)
    const rec = await ensureRecord(crewId)
    if (!rec) { setBusy(false); return }
    const rows = items.map((i) => ({ familiarisation_id: rec.id, item_id: i.id, done_at: new Date().toISOString() }))
    const { error } = await supabase.from('crew_familiarisation_items').upsert(rows)
    setBusy(false)
    if (error) { setError(error.message); return }
    load()
  }

  async function sign(crewId, which) {
    if (!canEdit) return
    const rec = await ensureRecord(crewId)
    if (!rec) return
    const patch = which === 'crew'
      ? { crew_signed_at: new Date().toISOString() }
      : { supervisor_signed_at: new Date().toISOString(), supervisor_name: appUser?.full_name || 'Skipper' }
    if (doneCount(crewId) < items.length) {
      setError('Every item has to be ticked before the record can be signed off.')
      return
    }
    const { error } = await supabase.from('crew_familiarisation')
      .update({ ...patch, completed_at: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() })
      .eq('id', rec.id)
    if (error) { setError(error.message); return }
    load()
  }

  const total = items.length
  const th = { padding: '0.5rem 0.4rem', textAlign: 'left' }

  return (
    <AppShell>
      <PageHeader title="Familiarisation" sub={`${total}-point safety induction`} />

      <CrewTabs />

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error">{error}</p></div>}

      {loading ? <div className="card"><p className="muted">Loading…</p></div> : total === 0 ? (
        <div className="card"><p className="muted">No familiarisation checklist set up for this fleet yet.</p></div>
      ) : (
        <>
          {notStarted.length > 0 && (
            <div className="card" style={{ borderColor: 'var(--brass)' }}>
              <h2 style={{ marginTop: 0 }}>Aboard with no familiarisation recorded</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
                These men are on the boat now and nothing has been ticked for them.
              </p>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {notStarted.map((c) => (
                  <button key={c.id} className="secondary" onClick={() => setOpen(c.id)} style={{ padding: '0.25rem 0.7rem', fontSize: '0.85rem' }}>
                    {c.full_name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Crew</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    <th style={th}>Name</th>
                    <th style={th}>Progress</th>
                    <th style={th}>Signed</th>
                    <th style={{ ...th, textAlign: 'right' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {crew.map((c) => {
                    const r = recOf[c.id]
                    const n = doneCount(c.id)
                    const pct = Math.round((n / total) * 100)
                    const complete = n === total
                    return (
                      <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ ...th, fontWeight: 600 }}>
                          {c.full_name}
                          {c.status === 'on_boat' && <span style={{ marginLeft: 6, fontSize: '0.68rem', color: 'var(--kelp)', fontWeight: 700 }}>● ABOARD</span>}
                        </td>
                        <td style={th}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ flex: '0 0 90px', height: 6, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: complete ? 'var(--kelp)' : n ? 'var(--brass)' : 'transparent' }} />
                            </div>
                            <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.8rem' }}>{n}/{total}</span>
                          </div>
                        </td>
                        <td className="muted" style={{ ...th, fontSize: '0.8rem' }}>
                          {r?.crew_signed_at ? 'crew ✓' : '—'}{r?.supervisor_signed_at ? ' · supervisor ✓' : ''}
                          {r?.completed_at && <div className="muted">{fmtDate(r.completed_at)}</div>}
                        </td>
                        <td style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="secondary" onClick={() => setOpen(open === c.id ? '' : c.id)} style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}>
                            {open === c.id ? 'Close' : 'Checklist'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {open && (() => {
            const c = crew.find((x) => x.id === open)
            if (!c) return null
            const r = recOf[c.id]
            const set = r ? ticks[r.id] : null
            const n = doneCount(c.id)
            return (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <h2 style={{ marginTop: 0, marginBottom: 0 }}>{c.full_name}</h2>
                  <span className="muted" style={{ fontFamily: 'var(--font-mono, monospace)' }}>{n}/{total}</span>
                </div>

                {categories.map((cat) => {
                  const catDone = cat.items.filter((i) => set?.has(i.id)).length
                  return (
                    <div key={cat.name} style={{ marginTop: '0.9rem' }}>
                      <h3 style={{ marginBottom: '0.3rem' }}>
                        {cat.name} <span className="muted" style={{ fontWeight: 400, fontSize: '0.85rem' }}>{catDone}/{cat.items.length}</span>
                      </h3>
                      {cat.items.map((i) => (
                        <label key={i.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.3rem 0', borderTop: '1px solid var(--border)', cursor: canEdit ? 'pointer' : 'default', fontSize: '0.9rem' }}>
                          <input type="checkbox" checked={!!set?.has(i.id)} disabled={!canEdit || busy} onChange={() => toggle(c.id, i.id)} />
                          <span>{i.label}</span>
                        </label>
                      ))}
                    </div>
                  )
                })}

                {canEdit && (
                  <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button className="secondary" onClick={() => tickAll(c.id)} disabled={busy}>Mark all done</button>
                    <button onClick={() => sign(c.id, 'crew')} disabled={busy || n < total}>Crew signs</button>
                    <button onClick={() => sign(c.id, 'supervisor')} disabled={busy || n < total}>Supervisor signs</button>
                    {n < total && <span className="muted" style={{ fontSize: '0.8rem' }}>All {total} items must be ticked before signing.</span>}
                  </div>
                )}
              </div>
            )
          })()}
        </>
      )}
    </AppShell>
  )
}
