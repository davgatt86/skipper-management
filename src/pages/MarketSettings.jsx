import { Fragment, useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { useAuth } from '../AuthContext'
import { useMarketRules, saveMarketRules } from '../lib/market/useMarketRules'
import {
  DEFAULT_CLOCKS, DEFAULT_SPECIES_CLOCK, DEFAULT_HEIGHTS, DEFAULT_FLOORS, DEFAULT_GRADE_RULES,
  resolveRules, knownSpecies, BANDS, FALLBACK_HEIGHT, gradeKey,
} from '../lib/market/layoutRules'
import {
  DEFAULT_AUCTION_ORDER, parseTransactions, mergeOrders, clockOrders,
} from '../lib/market/auctionOrder'

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
  const [floors, setFloors] = useState({})
  const [gradeRules, setGradeRules] = useState({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [newSpecies, setNewSpecies] = useState('')
  const [auctionOrder, setAuctionOrder] = useState(DEFAULT_AUCTION_ORDER)
  const [orderNote, setOrderNote] = useState('')
  const [newRuleSp, setNewRuleSp] = useState('')
  const [newRuleGr, setNewRuleGr] = useState('')

  useEffect(() => {
    if (loading) return
    setClocks(settings?.clocks?.length ? settings.clocks : DEFAULT_CLOCKS)
    setSpeciesClock({ ...DEFAULT_SPECIES_CLOCK, ...(settings?.speciesClock || {}) })
    setHeights({ ...DEFAULT_HEIGHTS, ...(settings?.heights || {}) })
    setFloors({ ...DEFAULT_FLOORS, ...(settings?.floors || {}) })
    setGradeRules({ ...DEFAULT_GRADE_RULES, ...(settings?.gradeRules || {}) })
    setAuctionOrder(settings?.auctionOrder?.length ? settings.auctionOrder : DEFAULT_AUCTION_ORDER)
    setOrderNote('')
    setDirty(false)
  }, [loading, settings])

  const rules = useMemo(
    () => resolveRules({ clocks, speciesClock, heights, floors, gradeRules, auctionOrder }),
    [clocks, speciesClock, heights, floors, gradeRules, auctionOrder],
  )
  const species = useMemo(() => knownSpecies(rules), [rules])

  const touch = (fn) => { fn(); setDirty(true); setMsg('') }

  function setClock(sp, clockId) {
    touch(() => setSpeciesClock((m) => ({ ...m, [sp]: clockId })))
  }
  const cellSetter = (setter) => (sp, band, value) => {
    const n = value === '' ? null : Math.max(1, Math.min(6, Number(value) || 1))
    touch(() => setter((m) => {
      const row = { ...(m[sp] || {}) }
      if (n == null) delete row[band]
      else row[band] = n
      return { ...m, [sp]: row }
    }))
  }
  const setHeight = cellSetter(setHeights)
  const setFloor = cellSetter(setFloors)

  function setGradeRule(key, field, value) {
    const n = value === '' ? null : Math.max(1, Math.min(6, Number(value) || 1))
    touch(() => setGradeRules((m) => {
      const r = { ...(m[key] || {}) }
      if (n == null) delete r[field]
      else r[field] = n
      return { ...m, [key]: r }
    }))
  }
  function addGradeRule() {
    const key = gradeKey(newRuleSp, newRuleGr)
    touch(() => setGradeRules((m) => ({ ...m, [key]: m[key] || {} })))
    setNewRuleGr('')
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
      floors: onlyChangedDeep(floors, DEFAULT_FLOORS),
      gradeRules,          // entirely the skipper's own; there are no defaults
      /* Only stored when it DIFFERS from the shipped order, same as
       * everything else here — a fleet that has never uploaded a sale
       * sheet still picks up a later correction to the measured one. */
      auctionOrder: JSON.stringify(auctionOrder) === JSON.stringify(DEFAULT_AUCTION_ORDER)
        ? undefined : auctionOrder,
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
      setFloors({ ...DEFAULT_FLOORS })
      setGradeRules({ ...DEFAULT_GRADE_RULES })
      setAuctionOrder(DEFAULT_AUCTION_ORDER)
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

      {/* ---- 2b. THE ORDER THE MARKET SELLS IN ----------------------------

          The chalk sheet and the buyers' catalogue both lay a clock's species
          out in this order, so a buyer following the rough walks the fish in
          the order the clock will offer it.

          It ships MEASURED, off Peterhead's own transaction export for two
          real Audacious sales — not guessed. This panel is here so the boat
          can refresh it from a newer sale sheet when the market changes, the
          same as everything else on this page. */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>The order the market sells in</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
          Within a clock, which species comes up first. Measured from Peterhead&rsquo;s
          &ldquo;Transactions per supplier&rdquo; sheet &mdash; the chalk sheet and the
          buyers&rsquo; catalogue both follow it, so the two documents always agree.
        </p>

        <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {clocks.map((c) => {
            const run = clockOrders(auctionOrder, rules)[c.id] || []
            return (
              <div key={c.id} style={{ border: '1px solid var(--grey-300, #ddd)', borderRadius: 6, padding: '0.6rem' }}>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--mute)' }}>
                  {c.n} · {c.label}
                </div>
                {/* A clock with nothing measured says so rather than showing a
                    blank, or "not on a live auction yet" reads as an oversight. */}
                <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                  {run.length
                    ? run.join(' → ')
                    : <span className="muted">not on a live auction clock yet &mdash; laid out in the tally&rsquo;s own order</span>}
                </div>
              </div>
            )
          })}
        </div>

        {canEdit && (
          <div style={{ marginTop: '0.8rem' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
              <span>Update from a sale sheet</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  const r = parseTransactions(await f.text())
                  if (r.error) { setOrderNote(r.error); return }
                  /* MERGED, NOT REPLACED. One sale only carries what was landed
                   * that day — the 13-08 sheet has no tusk on it at all — so
                   * taking a single sale as the whole order would drop every
                   * species that happened not to be on the market. */
                  const merged = mergeOrders(auctionOrder, r.order)
                  touch(() => setAuctionOrder(merged))
                  setOrderNote(
                    `Read ${r.lines} transactions from the ${r.saleDate || 'sale'} sheet`
                    + ` (${r.order.length} species).`
                    + (r.unmapped.length
                      ? ` Not recognised, kept under their own codes: ${r.unmapped.join(', ')}.`
                      : ''),
                  )
                }}
              />
            </label>
            {orderNote && (
              <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.82rem' }}>{orderNote}</p>
            )}
          </div>
        )}
      </div>


      {/* ---- 3. heights and floors ---- */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>How high, and how low</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.88rem' }}>
          By <strong>size band</strong> — the number in the grade code on the tally, so <em>Good Seed (1d)</em> is
          band 1 and <em>Sma (4a)</em> is band 4. <strong>Any</strong> is the fallback for a grade with no code.
        </p>
        <ul className="muted" style={{ marginTop: 0, fontSize: '0.86rem', paddingLeft: '1.1rem' }}>
          <li><strong>Max</strong> is the ceiling — never stacked higher than this.</li>
          <li><strong>Low</strong> is the floor — never laid lower than this when spare room is being spent.
            Blank means <strong>1</strong>, free to go flat. Set it equal to Max to pin a grade exactly.</li>
        </ul>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.86rem' }}>
          The floor is what stops a bulk grade being laid flat. Flattening 124 boxes of chippers costs 62
          footprints and buys nobody a better look at the fish; flattening 8 boxes of baby cod costs 4 and is
          exactly what the spare room is for.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr>
                <th style={{ ...TH, textAlign: 'left' }} rowSpan={2}>Species</th>
                {[...BANDS, 'Any'].map((b) => <th key={b} style={TH} colSpan={2}>{b}</th>)}
                <th style={{ ...TH, textAlign: 'left' }} rowSpan={2}>Clock</th>
              </tr>
              <tr>
                {[...BANDS, 'Any'].map((b) => (
                  <Fragment key={b}>
                    <th style={SUBTH}>max</th><th style={SUBTH}>low</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {species.map((sp) => (
                <tr key={sp}>
                  <td style={{ ...TD, textAlign: 'left', fontWeight: 600 }}>{sp}</td>
                  {[...BANDS, '*'].map((b) => {
                    const max = heights[sp]?.[b] ?? (b === '*' ? FALLBACK_HEIGHT : null)
                    return (
                      <Fragment key={b}>
                        <td style={TD}>
                          <input type="number" min="1" max="6" disabled={!canEdit}
                                 value={heights[sp]?.[b] ?? ''}
                                 placeholder={b === '*' ? String(FALLBACK_HEIGHT) : ''}
                                 onChange={(e) => setHeight(sp, b, e.target.value)} style={NUM} />
                        </td>
                        <td style={{ ...TD, borderRight: '1px solid var(--border)' }}>
                          {/* Nothing to hold up if it already lies flat. */}
                          <input type="number" min="1" max="6" disabled={!canEdit || Number(max) === 1}
                                 value={floors[sp]?.[b] ?? ''} placeholder={Number(max) === 1 ? '–' : '1'}
                                 onChange={(e) => setFloor(sp, b, e.target.value)}
                                 style={{ ...NUM, opacity: Number(max) === 1 ? 0.35 : 1 }} />
                        </td>
                      </Fragment>
                    )
                  })}
                  <td style={{ ...TD, textAlign: 'left' }} className="muted">
                    {rules.clock(speciesClock[sp] || rules.fallbackClock)?.label}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- 4. per-grade exceptions ---- */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Rules for one exact grade</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.88rem' }}>
          A size band is not always fine enough. <em>Seed (2a)</em> and <em>Chipper (2b)</em> are both band 2
          haddock and both make about the same money, so no band rule can hold one up and let the other
          drop. A rule here names the grade exactly as the tally writes it and beats the grid above.
        </p>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.86rem' }}>
          The easy way to add one is from <strong>Market Layout</strong> — every grade that was laid lower or
          held up has a button beside it, so you set the rule while looking at what it did.
        </p>
        {Object.keys(gradeRules).length === 0 && (
          <p className="muted" style={{ fontSize: '0.86rem' }}>No per-grade rules — the grid above decides everything.</p>
        )}
        {Object.entries(gradeRules).map(([key, r], i) => {
          const [sp, gr] = key.split('||')
          return (
            <div key={key} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap',
                                    borderTop: i ? '1px solid var(--border)' : 'none', padding: '0.35rem 0' }}>
              <span style={{ flex: '1 1 14rem' }}><strong>{sp}</strong> {gr}</span>
              <label style={LBL}>max
                <input type="number" min="1" max="6" disabled={!canEdit} value={r.max ?? ''}
                       placeholder={String(rules.maxHeight(sp, gr))}
                       onChange={(e) => setGradeRule(key, 'max', e.target.value)} style={NUM} />
              </label>
              <label style={LBL}>low
                <input type="number" min="1" max="6" disabled={!canEdit} value={r.min ?? ''} placeholder="1"
                       onChange={(e) => setGradeRule(key, 'min', e.target.value)} style={NUM} />
              </label>
              {canEdit && (
                <button className="secondary" style={BTN}
                        onClick={() => touch(() => setGradeRules((m) => { const n = { ...m }; delete n[key]; return n }))}>
                  Remove
                </button>
              )}
            </div>
          )
        })}
        {canEdit && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={newRuleSp} onChange={(e) => setNewRuleSp(e.target.value)}>
              <option value="">Species…</option>
              {species.map((sp) => <option key={sp} value={sp}>{sp}</option>)}
            </select>
            <input placeholder="Grade, exactly as the tally writes it — e.g. Chipper (2b)" value={newRuleGr}
                   onChange={(e) => setNewRuleGr(e.target.value)} style={{ flex: '1 1 auto', maxWidth: 380 }} />
            <button className="secondary" disabled={!newRuleSp || !newRuleGr.trim()} onClick={addGradeRule}>Add</button>
          </div>
        )}
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
const NUM = { width: '2.6rem', textAlign: 'center', padding: '0.1rem' }
const LBL = { display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem' }
const TH = {
  borderBottom: '2px solid var(--border)', padding: '0.3rem 0.4rem',
  textAlign: 'center', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em',
}
const SUBTH = {
  borderBottom: '2px solid var(--border)', padding: '0 0.2rem 0.2rem',
  textAlign: 'center', fontSize: '0.68rem', fontWeight: 400, color: 'var(--mute)',
}
const TD = { borderBottom: '1px solid var(--border)', padding: '0.15rem 0.4rem', textAlign: 'center' }
