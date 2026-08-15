import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { useAuth } from '../AuthContext'
import { parseDayTally } from '../lib/market/parseDayTally'
import { planLayout } from '../lib/market/planLayout'
import { TOP_ROW, BOTTOM_ROW, PER_TIER_FLAT, gradeKey } from '../lib/market/layoutRules'
import { useMarketRules, saveMarketRules } from '../lib/market/useMarketRules'
import { gradeName, gradeCode } from '../lib/market/sheet'
import MarketSheet, { SheetBody } from './MarketSheet'

/* Laying the trip out on Peterhead market.
 *
 * Upload the wheelhouse day-tag tally and get back how many tiers to ask for
 * and what goes where — clocks kept together, species kept in one row, day
 * tags running from the high number down.
 *
 * THE SCREEN VIEW IS THE PRINTED SHEET. It was two drawings of the same thing
 * — a horizontal strip per tier on screen, columns on paper — and the strip
 * was the harder of the two to read: you cannot follow a species down the
 * market in it, and it is not the shape of the floor. Now the page embeds the
 * sheet itself, so there is one renderer and nothing to drift.
 *
 * The ÷94 figure is shown beside the computed one on purpose. ÷94 is what gets
 * asked for on the phone and it is a good rule, but it assumes everything
 * stacks two high; a trip heavy in cod and flats needs more, and Trip 63 came
 * out a tier short. Seeing both is what tells you which trip is which.
 */

export default function MarketLayout() {
  const { appUser } = useAuth()
  const canView = ['skipper', 'viewer'].includes(appUser?.role)
  const { rules, settings, loading: rulesLoading, isCustom, reload: reloadRules } = useMarketRules()

  const [parsed, setParsed] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [sheet, setSheet] = useState(false)
  const [ruleBusy, setRuleBusy] = useState(false)
  const [ruleMsg, setRuleMsg] = useState('')
  const inputRef = useRef(null)

  const canEdit = appUser?.role === 'skipper'

  /* Set the floor for ONE exact grade, from the panel that just showed it
   * going somewhere unwanted.
   *
   * Per grade rather than per size band, because a band is not fine enough:
   * Seed (2a) and Chipper (2b) are both band 2 haddock and both price the
   * same, so no band rule can hold one and let the other go. */
  async function setFloor(species, grade, floor) {
    if (!canEdit) return
    setRuleBusy(true); setRuleMsg('')
    const key = gradeKey(species, grade)
    const next = {
      ...(settings || {}),
      gradeRules: { ...(settings?.gradeRules || {}), [key]: { ...(settings?.gradeRules?.[key] || {}), min: floor } },
    }
    const { error: err } = await saveMarketRules(appUser.fleet_id, next)
    setRuleBusy(false)
    if (err) setRuleMsg('Could not save: ' + err.message)
    else {
      setRuleMsg(floor > 1
        ? `${species} ${grade} will not be laid below ${floor} high.`
        : `${species} ${grade} may now be laid flat.`)
      reloadRules()
    }
  }

  const plan = useMemo(
    () => (parsed?.lines && !rulesLoading ? planLayout(parsed.lines, { rules }) : null),
    [parsed, rules, rulesLoading],
  )

  async function onFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy(true); setError(''); setParsed(null)
    try {
      const buf = await f.arrayBuffer()
      const res = parseDayTally(new Uint8Array(buf))
      if (res.error) setError(res.error)
      else { setParsed(res); setFileName(f.name) }
    } catch (err) {
      setError('Could not read that file: ' + (err.message || String(err)))
    }
    setBusy(false)
  }

  if (!canView) {
    return <AppShell><div className="card"><p className="muted">Skipper or viewer access only.</p></div></AppShell>
  }

  return (
    <AppShell maxWidth={1280}>
      <PageHeader title="Market Layout" sub="Peterhead — tiers, clocks and day tags">
        <Link to="/market-rules"><button className="secondary">Market rules</button></Link>
        <button onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Reading…' : parsed ? 'Load another tally' : '📄 Upload day tally'}
        </button>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={onFile} style={{ display: 'none' }} />
      </PageHeader>

      {error && (
        <div className="card" style={{ borderColor: 'var(--rust)' }}>
          <p className="error" style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      {!parsed && !error && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Upload the day tally</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            The spreadsheet off the wheelhouse PC — boxes per species, grade and day tag. It works out how many
            tiers to ask the market for, lays the fish out inside them, and prints the sheet you chalk from.
          </p>
          <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 0 }}>
            A tier is {TOP_ROW} boxes across the top and {BOTTOM_ROW} across the bottom — {PER_TIER_FLAT} flat,
            or up to {PER_TIER_FLAT * 4} stacked four high. Nothing is stacked higher than its
            grade allows; <Link to="/market-rules">Market rules</Link> is where that is set
            {isCustom ? ' (this fleet has its own).' : '.'}
          </p>
        </div>
      )}

      {parsed && plan && (
        <>
          {/* ---- what to ask the market for ---- */}
          <div className="card">
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              <Fig label="Tiers to ask for" value={plan.tiers} big accent="var(--hull)" />
              <Fig label="÷94 rule says" value={plan.ruleOfThumb}
                   accent={plan.ruleOfThumb === plan.tiers ? undefined : 'var(--brass)'} />
              <Fig label="Boxes" value={plan.totalBoxes.toLocaleString('en-GB')} />
              <Fig label="Footprints used" value={`${plan.footprints} of ${plan.tiers * PER_TIER_FLAT}`} />
              <Fig label="Spare" value={plan.spare} accent={plan.spare > 20 ? 'var(--brass)' : undefined} />
              <Fig label="Day tags" value={parsed.days.join(', ')} />
            </div>
            <p className="muted" style={{ fontSize: '0.82rem', margin: '0.6rem 0 0' }}>
              {fileName} · {parsed.meta.port || 'port not stated'}
              {parsed.meta.gear ? ` · ${parsed.meta.gear}` : ''}
              {parsed.printedTotal != null && (
                parsed.reconciles
                  ? ' · agrees with the sheet’s own total'
                  : ` · ⚠ the sheet totals ${parsed.printedTotal}, this reads ${plan.totalBoxes}`
              )}
            </p>
          </div>

          {plan.warnings.map((w, i) => (
            <div key={i} className="card" style={{ borderColor: 'var(--brass)' }}>
              <p style={{ margin: 0, fontSize: '0.9rem' }}>
                {w}
                {plan.unfiled.length > 0 && w.includes('not on a clock') && (
                  <> <Link to="/market-rules">Open Market rules</Link>.</>
                )}
              </p>
            </div>
          ))}

          {/* ---- the clocks ---- */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Clocks</h2>
            <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
              {plan.auctionSpans.map((a, i) => (
                <div key={a.id} style={{ borderLeft: `3px solid ${CLOCK_COLOUR[i % CLOCK_COLOUR.length]}`, paddingLeft: '0.6rem' }}>
                  <div style={{ fontWeight: 700 }}>{a.n}. {a.label}</div>
                  <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '1.1rem' }}>
                    {a.boxes.toLocaleString('en-GB')} boxes
                  </div>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>
                    {a.from === a.to ? `tier ${a.from}` : `tiers ${a.from}–${a.to}`}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ---- what the spare room went to, and what was held back ----
               Both lists, and both adjustable from here. This is where you
               notice a grade has been laid somewhere you did not want it, so
               it is where the rule wants changing — not three pages away with
               the grade name typed from memory. */}
          {(plan.lowered.length > 0 || plan.held.length > 0) && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>How low each grade went</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
                Heights are a ceiling, never a target. These tiers are paid for either way, so the room left
                over goes to the fish that earns most, dearest first — but a <strong>floor</strong> stops a
                bulk grade being laid flat, which swallows the market and buys nobody a better look.
                {canEdit && ' Change either from here.'}
              </p>

              {plan.lowered.length > 0 && (
                <>
                  <h3 style={H3}>Laid lower</h3>
                  {plan.lowered.map((l, i) => (
                    <GradeRow key={i} first={!i} row={l} at={l.to} canEdit={canEdit} busy={ruleBusy}
                              action={{ label: `Hold at ${l.from}`, title: `Never lay ${l.species} ${gradeName(l.grade)} below ${l.from} high`,
                                        onClick: () => setFloor(l.species, l.grade, l.from) }}
                              note={<>{l.from} <span className="muted">→</span> <strong style={{ color: 'var(--kelp)' }}>{l.to}</strong> high</>} />
                  ))}
                </>
              )}

              {plan.held.length > 0 && (
                <>
                  <h3 style={H3}>Held up by the rules</h3>
                  {plan.held.map((h, i) => (
                    <GradeRow key={i} first={!i} row={h} at={h.at} canEdit={canEdit} busy={ruleBusy}
                              action={{ label: h.floor > 1 ? `Let it drop` : null,
                                        title: `Allow ${h.species} ${gradeName(h.grade)} to be laid flat`,
                                        onClick: () => setFloor(h.species, h.grade, 1) }}
                              note={<>at <strong>{h.at}</strong> high · floor {h.floor}</>} />
                  ))}
                </>
              )}

              {ruleMsg && <p style={{ fontSize: '0.82rem', margin: '0.6rem 0 0', color: 'var(--kelp)' }}>{ruleMsg}</p>}
              {plan.spare > 0 && (
                <p className="muted" style={{ fontSize: '0.82rem', margin: '0.6rem 0 0' }}>
                  {plan.spare} {plan.spare === 1 ? 'footprint' : 'footprints'} still spare — not enough to drop
                  another grade a full level.
                </p>
              )}
            </div>
          )}

          {/* ---- the sheet itself: what is on screen is what prints ---- */}
          <SheetBody plan={plan} meta={parsed.meta} embedded onPrint={() => setSheet(true)} />
          {sheet && <MarketSheet plan={plan} meta={parsed.meta} onClose={() => setSheet(false)} />}
        </>
      )}
    </AppShell>
  )
}

/* One grade in the drop panel. Same shape whether it was laid lower or held
 * up, so the two lists read as one decision seen from both sides. */
function GradeRow({ row, at, note, action, canEdit, busy, first }) {
  const code = gradeCode(row.grade)
  return (
    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap',
                  borderTop: first ? 'none' : '1px solid var(--border)', padding: '0.3rem 0' }}>
      <span style={{ flex: '1 1 12rem' }}>
        <strong>{row.species}</strong> {gradeName(row.grade)}
        {code && <span className="muted" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.8rem' }}> ({code})</span>}
      </span>
      <span className="muted" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem', width: '5rem', textAlign: 'right' }}>
        £{row.value.toFixed(2)}/kg
      </span>
      <span className="muted" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem', width: '5rem', textAlign: 'right' }}>
        {row.boxes} {row.boxes === 1 ? 'box' : 'boxes'}
      </span>
      <span style={{ fontFamily: 'var(--font-mono, monospace)', width: '9rem', textAlign: 'right' }}>{note}</span>
      {canEdit && action?.label && (
        <button className="secondary" title={action.title} disabled={busy} onClick={action.onClick}
                style={{ padding: '0.1rem 0.5rem', fontSize: '0.78rem' }}>
          {action.label}
        </button>
      )}
    </div>
  )
}

const H3 = { fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0.9rem 0 0.2rem' }

// The clock strip only — the sheet colours the fish itself, by species.
const CLOCK_COLOUR = ['var(--hull)', 'var(--kelp)', 'var(--brass)', 'var(--rust)', 'var(--mute)']

function Fig({ label, value, big, accent }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{
        fontSize: big ? '2.2rem' : '1.4rem', fontWeight: 700,
        fontFamily: 'var(--font-mono, monospace)', lineHeight: 1.1, color: accent || 'inherit',
      }}>{value}</div>
    </div>
  )
}
