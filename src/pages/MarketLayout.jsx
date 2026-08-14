import { useMemo, useRef, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { useAuth } from '../AuthContext'
import { parseDayTally } from '../lib/market/parseDayTally'
import { planLayout } from '../lib/market/planLayout'
import { TOP_ROW, BOTTOM_ROW, AUCTIONS } from '../lib/market/layoutRules'
import MarketSheet from './MarketSheet'

/* Laying the trip out on Peterhead market.
 *
 * Upload the wheelhouse day-tag tally and get back how many tiers to ask for
 * and what goes where — auctions kept together, species kept in one row, day
 * tags running from the high number down.
 *
 * The ÷94 figure is shown beside the computed one on purpose. ÷94 is what gets
 * asked for on the phone and it is a good rule, but it assumes everything
 * stacks two high; a trip heavy in cod and flats needs more, and Trip 63 came
 * out a tier short. Seeing both is what tells you which trip is which.
 */

const AUCTION_COLOUR = {
  cod: 'var(--hull)',
  hadwhit: 'var(--kelp)',
  rough: 'var(--brass)',
  flats: 'var(--rust)',
}

export default function MarketLayout() {
  const { appUser } = useAuth()
  const canView = ['skipper', 'viewer'].includes(appUser?.role)

  const [parsed, setParsed] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [openTier, setOpenTier] = useState(null)
  const [sheet, setSheet] = useState(false)
  const inputRef = useRef(null)

  const plan = useMemo(() => (parsed?.lines ? planLayout(parsed.lines) : null), [parsed])

  async function onFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy(true); setError(''); setParsed(null); setOpenTier(null)
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

  if (!canView) return <AppShell><div className="card"><p className="muted">Skipper or viewer access only.</p></div></AppShell>

  return (
    <AppShell maxWidth={1200}>
      <PageHeader title="Market Layout" sub="Peterhead — tiers, auctions and day tags">
        {plan && (
          <button onClick={() => setSheet(true)}>🖨 Chalk sheet</button>
        )}
        <button className={plan ? 'secondary' : undefined} onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Reading…' : parsed ? 'Load another tally' : '📄 Upload day tally'}
        </button>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={onFile} style={{ display: 'none' }} />
      </PageHeader>

      {sheet && plan && (
        <MarketSheet plan={plan} meta={parsed?.meta} onClose={() => setSheet(false)} />
      )}

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error" style={{ margin: 0 }}>{error}</p></div>}

      {!parsed && !error && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Upload the day tally</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            The spreadsheet off the wheelhouse PC — boxes per species, grade and day tag. It works out
            how many tiers to ask the market for, and lays the fish out inside them.
          </p>
          <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 0 }}>
            A tier is {TOP_ROW} boxes across the top and {BOTTOM_ROW} across the bottom — {TOP_ROW + BOTTOM_ROW} flat,
            or up to {(TOP_ROW + BOTTOM_ROW) * 4} stacked four high. Nothing is stacked higher than its grade allows.
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
              <Fig label="Footprints" value={`${plan.footprints} of ${plan.tiers * (TOP_ROW + BOTTOM_ROW)}`} />
              <Fig label="Spare" value={plan.spare} accent={plan.spare > 20 ? 'var(--brass)' : undefined} />
              <Fig label="Days" value={parsed.days.join(', ')} />
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
              <p style={{ margin: 0, fontSize: '0.9rem' }}>{w}</p>
            </div>
          ))}

          {/* ---- the fish given the spare room ---- */}
          {plan.lowered.length > 0 && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Laid lower than the guideline</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
                Heights are a ceiling, not a target — never higher, always allowed lower. These tiers are
                being paid for either way, so the room left over goes to the fish that earns most,
                dearest first. Nothing here has cost an extra tier.
              </p>
              <div style={{ display: 'grid', gap: '0.15rem' }}>
                {plan.lowered.map((l, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline',
                                        borderTop: i ? '1px solid var(--border)' : 'none', padding: '0.25rem 0' }}>
                    <span style={{ flex: '1 1 auto' }}>{l.species} <span className="muted">{l.grade}</span></span>
                    <span className="muted" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem' }}>
                      {l.boxes} {l.boxes === 1 ? 'box' : 'boxes'}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono, monospace)', width: '6rem', textAlign: 'right' }}>
                      {l.from} <span className="muted">→</span> <strong style={{ color: 'var(--kelp)' }}>{l.to}</strong> high
                    </span>
                  </div>
                ))}
              </div>
              {plan.spare > 0 && (
                <p className="muted" style={{ fontSize: '0.82rem', margin: '0.6rem 0 0' }}>
                  {plan.spare} {plan.spare === 1 ? 'footprint' : 'footprints'} still spare — not enough to
                  drop another grade a full level.
                </p>
              )}
            </div>
          )}

          {/* ---- the four auctions ---- */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Auctions</h2>
            <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
              {plan.auctionSpans.map((a) => (
                <div key={a.id} style={{ borderLeft: `3px solid ${AUCTION_COLOUR[a.id]}`, paddingLeft: '0.6rem' }}>
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

          {/* ---- the market itself ---- */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>The layout</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
              Each tier is top row over bottom row with the walkway between. Colour is the auction.
              Tap a tier for every box in it.
            </p>
            {plan.byTier.map((t) => (
              <div key={t.tier} style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
                  <strong style={{ fontSize: '0.9rem' }}>Tier {t.tier}</strong>
                  <span className="muted" style={{ fontSize: '0.78rem' }}>
                    top {t.top.length}/{TOP_ROW} · bottom {t.bottom.length}/{BOTTOM_ROW}
                  </span>
                  <button className="secondary" style={{ marginLeft: 'auto', padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => setOpenTier(openTier === t.tier ? null : t.tier)}>
                    {openTier === t.tier ? 'Hide' : 'Detail'}
                  </button>
                </div>
                <Row stacks={t.top} slots={TOP_ROW} />
                <div style={{ height: 6, background: 'repeating-linear-gradient(90deg, var(--border) 0 6px, transparent 6px 12px)', margin: '3px 0' }} />
                <Row stacks={t.bottom} slots={BOTTOM_ROW} />

                {openTier === t.tier && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.82rem' }}>
                    {['top', 'bottom'].map((band) => (
                      <div key={band} style={{ marginBottom: '0.4rem' }}>
                        <div className="muted" style={{ textTransform: 'uppercase', fontSize: '0.72rem', letterSpacing: '0.05em' }}>{band}</div>
                        {(band === 'top' ? t.top : t.bottom).map((s, i) => (
                          <div key={i} style={{ display: 'flex', gap: '0.5rem', borderTop: '1px solid var(--border)', padding: '0.2rem 0' }}>
                            <span style={{ width: 10, background: AUCTION_COLOUR[s.auction], flex: '0 0 auto' }} />
                            <span style={{ flex: '1 1 auto' }}>{s.species} <span className="muted">{s.grade}</span></span>
                            <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>
                              {s.parts.map((p) => `d${p.day}×${p.boxes}`).join(' + ')}
                            </span>
                            <span className="muted" style={{ width: '7rem', textAlign: 'right' }}>
                              {s.boxes} {s.boxes === 1 ? 'box' : 'boxes'}
                              {s.height > 1 ? ` · ${s.height} high` : ' · flat'}
                              {s.lowered && <span style={{ color: 'var(--kelp)' }}> ↓{s.max}</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  )
}

/* One row of a tier. Empty slots are drawn so a half-used tier is obvious —
 * that is the space you could still fill, and it is the reason to look. */
function Row({ stacks, slots }) {
  return (
    <div style={{ display: 'flex', gap: 2, flexWrap: 'nowrap', overflowX: 'auto' }}>
      {Array.from({ length: slots }).map((_, i) => {
        const s = stacks[i]
        return (
          <div key={i}
               title={s ? `${s.species} ${s.grade} — ${s.parts.map((p) => `day ${p.day} ×${p.boxes}`).join(', ')}` : 'empty'}
               style={{
                 flex: '1 1 0', minWidth: 14, height: 30,
                 background: s ? AUCTION_COLOUR[s.auction] : 'transparent',
                 border: s ? 'none' : '1px dashed var(--border)',
                 borderRadius: 2, position: 'relative',
                 display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                 color: '#fff', fontSize: '0.62rem', fontWeight: 700, paddingBottom: 1,
                 opacity: s ? 0.35 + 0.65 * (s.boxes / Math.max(s.height, 1)) : 1,
               }}>
            {s ? s.boxes : ''}
          </div>
        )
      })}
    </div>
  )
}

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
