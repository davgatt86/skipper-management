import { useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { useAuth } from '../AuthContext'
import { useMarketRules, saveMarketRules } from '../lib/market/useMarketRules'
import {
  DEFAULT_CLOCKS, DEFAULT_SPECIES_CLOCK, DEFAULT_HEIGHTS,
  resolveRules, knownSpecies, BANDS, FALLBACK_HEIGHT,
} from '../lib/market/layoutRules'

/* Market Rules — the clocks, what goes on each, and how high it may go.
 *
 * All of this used to live in the code, which meant the market moving a
 * species from one clock to another was a deploy. It is a thing the skipper
 * knows the day it happens and nobody else does, so it belongs here.
 *
 * Two panels, because they are two different questions:
 *   1. WHERE does a fish go — which clock, and in what order the clocks run.
 *   2. HOW HIGH may it be stacked, per size band.
 *
 * The stored document only holds what has been CHANGED. A key that is not set
 * falls through to the shipped default, so a fleet that moves one species
 * keeps every later correction to the rest instead of freezing a copy of
 * today's defaults the first time it saves.
 */

export default function MarketSettings() {
  const { appUser } = useAuth()
  const canEdit = appUser?.role === 'skipper'
  const { settings, loading, reload } = useMarketRules()

  const [clocks, setClocks] = useState(DEFAULT_CLOCKS)
  const [speciesClock, setSpeciesClock] = useState({})
  const [heights, setHeights] = useState({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [newSpecies, setNewSpecies] = useState('')

  useEffect(() => {
    if (loading) return
    setClocks(settings?.clocks?.length ? settings.clocks : DEFAULT_CLOCKS)
    setSpeciesClock({ ...DEFAULT_SPECIES_CLOCK, ...(settings?.speciesClock || {}) })
    setHeights({ ...DEFAULT_HEIGHTS, ...(settings?.heights || {}) })
    setDirty(false)
  }, [loading, settings])

  const rules = useMemo(() => resolveRules({ clocks, speciesClock, heights }), [clocks, speciesClock, heights])
  const species = useMemo(() => knownSpecies(rules), [rules])

  const touch = (fn) => { fn(); setDirty(true); setMsg('') }

  function setClock(sp, clockId) {
    touch(() => setSpeciesClock((m) => ({ ...m, [sp]: clockId })))
  }
  function setHeight(sp, band, value) {
    const n = value === '' ? null : Math.max(1, Math.min(6, Number(value) || 1))
    touch(() => setHeights((m) => {
      const row = { ...(m[sp] || {}) }
      if (n == null) delete row[band]
      else row[band] = n
      return { ...m, [sp]: row }
    }))
  }
  function moveClock(i, dir) {
    const next = [...clocks]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    touch(() => setClocks(next.map((c, k) => ({ ...c, n: k + 1 }))))
  }
  function addSpecies() {
    const sp = newSpecies.trim().toUpperCase()
    if (!sp) return
    touch(() => {
      setSpeciesClock((m) => ({ ...m, [sp]: m[sp] || rules.fallbackClock }))
      setHeights((m) => ({ ...m, [sp]: m[sp] || { '*': FALLBACK_HEIGHT } }))
    })
    setNewSpecies('')
  }

  async function save() {
    setSaving(true); setMsg('')
    // Store only what differs from the shipped defaults, so later corrections
    // to the ones nobody has touched still arrive.
    const doc = {
      clocks,
      speciesClock: onlyChanged(speciesClock, DEFAULT_SPECIES_CLOCK),
      heights: onlyChangedDeep(heights, DEFAULT_HEIGHTS),
    }
    const { error } = await saveMarketRules(appUser.fleet_id, doc)
    setSaving(false)
    if (error) setMsg('Could not save: ' + error.message)
    else { setMsg('Saved.'); setDirty(false); reload() }
  }

  function resetAll() {
    touch(() => {
      setClocks(DEFAULT_CLOCKS)
      setSpeciesClock({ ...DEFAULT_SPECIES_CLOCK })
      setHeights({ ...DEFAULT_HEIGHTS })
    })
  }

  if (loading) return <AppShell><div className="card"><p className="muted">Loading…</p></div></AppShell>

  const byClock = clocks.map((c) => ({
    ...c, species: species.filter((sp) => (speciesClock[sp] || rules.fallbackClock) === c.id),
  }))

  return (
    <AppShell maxWidth={1100}>
      <PageHeader title="Market Rules" sub="Which clock each fish goes on, and how high it stacks">
        {canEdit && (
          <>
            <button onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="secondary" onClick={resetAll}>Reset to defaults</button>
          </>
        )}
      </PageHeader>

      {msg && (
        <div className="card" style={{ borderColor: msg.startsWith('Could not') ? 'var(--rust)' : 'var(--kelp)' }}>
          <p style={{ margin: 0 }}>{msg}</p>
        </div>
      )}

      {!canEdit && (
        <div className="card"><p className="muted" style={{ margin: 0 }}>
          Read-only — only the skipper changes these. Putting a fish on the wrong clock sends it to the wrong auction.
        </p></div>
      )}

      {/* ---- 1. the clocks ---- */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>The clocks</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.88rem' }}>
          Fish on one clock is kept together on the floor so its buyers walk it in one go, and the clocks
          run in this order across the tiers. <strong>Split rows</strong> lets a clock be broken between the
          top and bottom rows to soak up space the others leave — only the flats should normally do that,
          since a buyer should not have to look in two places for the same round fish.
        </p>
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          {clocks.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center',
                                     borderTop: i ? '1px solid var(--border)' : 'none', paddingTop: i ? '0.4rem' : 0 }}>
              <span style={{ fontFamily: 'var(--font-mono, monospace)', width: '1.5rem' }}>{i + 1}</span>
              <input value={c.label} disabled={!canEdit} style={{ flex: '1 1 auto', maxWidth: 280 }}
                     onChange={(e) => touch(() => setClocks(clocks.map((x) => x.id === c.id ? { ...x, label: e.target.value } : x)))} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={!!c.splitRows} disabled={!canEdit}
                       onChange={(e) => touch(() => setClocks(clocks.map((x) => x.id === c.id ? { ...x, splitRows: e.target.checked } : x)))} />
                split rows
              </label>
              <span className="muted" style={{ fontSize: '0.8rem', width: '5.5rem', textAlign: 'right' }}>
                {byClock[i].species.length} species
              </span>
              {canEdit && (
                <span style={{ display: 'flex', gap: '0.2rem' }}>
                  <button className="secondary" style={BTN} disabled={i === 0} onClick={() => moveClock(i, -1)}>↑</button>
                  <button className="secondary" style={BTN} disabled={i === clocks.length - 1} onClick={() => moveClock(i, 1)}>↓</button>
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', margin: '0.8rem 0 0' }}>
          Anything not filed below goes on <strong>{rules.clock(rules.fallbackClock)?.label}</strong> and is
          named on the layout page, rather than being sent somewhere quietly.
        </p>
      </div>

      {/* ---- 2. species → clock ---- */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>What goes on each clock</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.88rem' }}>
          Set from Peterhead's own supply catalogue, 13 Aug 2026. Change one here when the market moves it.
        </p>
        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {byClock.map((c) => (
            <div key={c.id}>
              <div style={{ fontWeight: 700, borderBottom: '2px solid var(--hull)', paddingBottom: '0.2rem', marginBottom: '0.4rem' }}>
                {c.n}. {c.label}
              </div>
              {c.species.length === 0 && <p className="muted" style={{ fontSize: '0.82rem' }}>Nothing on this clock.</p>}
              {c.species.map((sp) => (
                <div key={sp} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.15rem 0' }}>
                  <span style={{ flex: '1 1 auto', fontSize: '0.9rem' }}>{sp}</span>
                  <select value={speciesClock[sp] || rules.fallbackClock} disabled={!canEdit}
                          onChange={(e) => setClock(sp, e.target.value)}
                          style={{ fontSize: '0.8rem', padding: '0.1rem 0.3rem' }}>
                    {clocks.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          ))}
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
            <input placeholder="Add a species — the name as it reads on the tally" value={newSpecies}
                   onChange={(e) => setNewSpecies(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && addSpecies()}
                   style={{ flex: '1 1 auto', maxWidth: 380 }} />
            <button className="secondary" onClick={addSpecies} disabled={!newSpecies.trim()}>Add</button>
          </div>
        )}
      </div>

      {/* ---- 3. heights ---- */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>How high each fish may be stacked</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.88rem' }}>
          By <strong>size band</strong> — the number in the grade code on the tally, so <em>Good Seed (1d)</em> is
          band 1 and <em>Sma (4a)</em> is band 4. <strong>Any</strong> is the fallback for a grade with no code.
          These are a <strong>ceiling</strong>: the layout is always free to lay a fish lower to use up spare
          room, and never higher. Blank means use <em>Any</em>.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr>
                <th style={{ ...TH, textAlign: 'left' }}>Species</th>
                {BANDS.map((b) => <th key={b} style={TH}>{b}</th>)}
                <th style={TH}>Any</th>
                <th style={{ ...TH, textAlign: 'left' }}>Clock</th>
              </tr>
            </thead>
            <tbody>
              {species.map((sp) => (
                <tr key={sp}>
                  <td style={{ ...TD, textAlign: 'left', fontWeight: 600 }}>{sp}</td>
                  {[...BANDS, '*'].map((b) => (
                    <td key={b} style={TD}>
                      <input type="number" min="1" max="6" disabled={!canEdit}
                             value={heights[sp]?.[b] ?? ''}
                             placeholder={b === '*' ? String(FALLBACK_HEIGHT) : ''}
                             onChange={(e) => setHeight(sp, b, e.target.value)}
                             style={{ width: '3rem', textAlign: 'center', padding: '0.1rem' }} />
                    </td>
                  ))}
                  <td style={{ ...TD, textAlign: 'left' }} className="muted">
                    {rules.clock(speciesClock[sp] || rules.fallbackClock)?.label}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  )
}

// Only what differs from the shipped default, so a later correction to a
// species nobody has touched still reaches this fleet.
function onlyChanged(current, base) {
  const out = {}
  for (const [k, v] of Object.entries(current)) if (base[k] !== v) out[k] = v
  return out
}
function onlyChangedDeep(current, base) {
  const out = {}
  for (const [k, row] of Object.entries(current)) {
    if (JSON.stringify(row) !== JSON.stringify(base[k])) out[k] = row
  }
  return out
}

const BTN = { padding: '0.1rem 0.45rem', fontSize: '0.8rem' }
const TH = {
  borderBottom: '2px solid var(--border)', padding: '0.3rem 0.4rem',
  textAlign: 'center', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em',
}
const TD = { borderBottom: '1px solid var(--border)', padding: '0.15rem 0.4rem', textAlign: 'center' }
