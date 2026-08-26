import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import SampleDocs from '../SampleDocs'
import { useAuth } from '../AuthContext'
import { parseDayTally } from '../lib/market/parseDayTally'
import { buildCatalogue, freshestNote } from '../lib/market/catalogue'
import { exportCataloguePdf } from '../lib/market/exportCatalogue'
import { planLayout } from '../lib/market/planLayout'
import { TOP_ROW, BOTTOM_ROW, PER_TIER_FLAT, gradeKey } from '../lib/market/layoutRules'
import { PETERHEAD, tierAt, areaLabel, marketTotals } from '../lib/market/markets'
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
  const [pendingRule, setPendingRule] = useState(null)

  /* WHERE ON THE FLOOR THIS SHOT STARTS.
   *
   * Blank is the honest default and means "anywhere in the middle of the new
   * market" — the uniform 21/26 the page has always assumed, which is right
   * wherever the market puts you among tiers 7 to 67. Name a tier and the real
   * building applies: shallower tiers at each end, no top row past the new
   * market, an end to run out of, and the amber and red that go with it.
   *
   * Opt-in on purpose. Defaulting everyone onto the real floor would change
   * every answer the page has ever given, including for the tallies it was
   * tuned against. */
  const [startTier, setStartTier] = useState('')
  const startAt = startTier === '' ? null : Number(startTier)
  const startInfo = startAt == null ? null : tierAt(PETERHEAD, startAt)
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
      /* REPORT THE OUTCOME, NOT THE INTENTION.
       *
       * "Chipper (2b) may now be laid flat" is what the rule says, and on a
       * full trip nothing whatever happens: releasing a floor only lets the
       * drop solver spend room that may not exist. David clicked it on Trip 63
       * and read it as the button not working — the rule had saved perfectly
       * well and there was no room to use it.
       *
       * So the grade is remembered and checked once the new plan is in, and
       * the page says where it actually ended up. */
      setPendingRule({ species, grade, floor })
      setRuleMsg(floor > 1
        ? `${species} ${grade} will not be laid below ${floor} high.`
        : `${species} ${grade} may now be laid flat — working out the sheet again…`)
      reloadRules()
    }
  }

  const plan = useMemo(
    () => (parsed?.lines && !rulesLoading
      ? planLayout(parsed.lines, startInfo ? { rules, market: PETERHEAD, startTier: startAt } : { rules })
      : null),
    [parsed, rules, rulesLoading, startAt, startInfo],
  )

  /* DID THE RULE ACTUALLY CHANGE ANYTHING?
   *
   * Releasing a floor does not lay a fish flat — it only lets the drop solver
   * spend room on it, and on a full trip there is none. Trip 63 came out with
   * fifteen places spare, twelve of them on the top row, while the chipper
   * that had just been released sits on the bottom, which was full to the last
   * place. Nothing moved, and "Chipper (2b) may now be laid flat" read as the
   * button having done nothing.
   *
   * This waits for the new plan and says where the grade really ended up, with
   * the figures — so a rule that could not bite is visibly a lack of room
   * rather than a lack of a working button.
   */
  useEffect(() => {
    if (!pendingRule || !plan) return
    const { species, grade, floor } = pendingRule
    setPendingRule(null)
    if (floor > 1) return            // holding a grade up always takes effect

    const dropped = plan.lowered.find((l) => l.species === species && l.grade === grade)
    if (dropped) {
      setRuleMsg(`${species} ${grade} is now laid ${dropped.to === 1 ? 'flat' : `${dropped.to} high`}.`)
      return
    }

    /* It did not come down. Say what it would have cost against what is there
     * — and in WHICH row, since a grade can only use the room in its own. */
    const mine = (list) => list.filter((s) => s.species === species && s.grade === grade)
    const onTop = mine(plan.rows.top)
    const stacks = onTop.length ? onTop : mine(plan.rows.bottom)
    if (!stacks.length) { setRuleMsg(`${species} ${grade} may now be laid flat.`); return }

    const row = onTop.length ? 'top' : 'bottom'
    const room = onTop.length ? plan.spareTop : plan.spareBottom
    const boxes = stacks.reduce((n, s) => n + s.boxes, 0)
    const need = boxes - stacks.length          // footprints to go from here to flat
    setRuleMsg(
      `${species} ${grade} may now be laid flat, but there is no room this trip. `
      + `It is on the ${row} row, which has ${room === 0 ? 'nothing' : room} spare, `
      + `and laying its ${boxes} boxes flat would need ${need} more. `
      + `It stays at ${stacks[0].height} high.`,
    )
  }, [plan, pendingRule])


  /* THE BUYERS' CATALOGUE — the same tally, turned round to face the market.
   *
   * The chalk sheet tells the boat where to lay the fish. This tells the buyer
   * what is there and in what order it comes up, because the freshest day sells
   * as A+ and everything else as A — and buyers have been complaining they
   * cannot tell which is which once the auction is under way.
   *
   * Which day is freshest is a SETTING rather than my reading of it. A boat
   * fills day 1 first, so day 5 of a five-day trip should be the last caught
   * and the freshest — but getting it backwards would print A+ on the OLDEST
   * fish on every sheet the market hands out, and that is not worth risking on
   * an inference. */
  const [freshest, setFreshest] = useState('high')
  const catalogue = useMemo(
    () => (parsed?.lines && !rulesLoading
      ? buildCatalogue({ lines: parsed.lines, rules, freshest })
      : null),
    [parsed, rules, rulesLoading, freshest],
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

      <SampleDocs kind="tally" />

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
          {/* ---- WHERE ON THE FLOOR, which changes what the answer is -------
              The market is three areas of three different depths and the app
              assumed one for years. Naming the tier you start from is what
              turns the generic answer into this building's answer. */}
          <div className="card">
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ display: 'grid', gap: 3 }}>
                <span className="muted" style={{ fontSize: '0.75rem', letterSpacing: 0.4, textTransform: 'uppercase' }}>
                  Start at tier
                </span>
                <select value={startTier} onChange={(e) => setStartTier(e.target.value)}>
                  <option value="">Anywhere in the new market</option>
                  {PETERHEAD.tiers.map((x) => (
                    <option key={x.n} value={x.n}>
                      {x.n} — {areaLabel(x.area)} ({x.top ? `${x.top}+${x.bottom}` : x.bottom} deep)
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted" style={{ margin: 0, fontSize: '0.8rem', flex: '1 1 22rem' }}>
                {startInfo
                  ? `Tier ${startInfo.n} is in the ${areaLabel(startInfo.area)}, ${startInfo.top ? `${startInfo.top} across the top and ${startInfo.bottom} across the bottom` : `${startInfo.bottom} across, with no top row`}. The plan runs up the market from there and stops at tier 177.`
                  : `Assuming a standard tier — 21 across the top, 26 across the bottom. True of tiers 7 to 67 and nowhere else, so name the tier you are given if you want this building's real answer.`}
              </p>
            </div>
          </div>

          {/* AMBER INTO THE CAFE, RED INTO THE OLD MARKET, and red again if it
              runs off the end. These carry their own tone rather than the page
              guessing one from the words. */}
          {(plan.notices || []).map((nte, i) => (
            <div key={i} className="card"
                 style={{ borderColor: nte.tone === 'red' ? 'var(--rust)' : 'var(--brass)', borderWidth: 2 }}>
              <p style={{ margin: 0, fontSize: '0.9rem',
                          color: nte.tone === 'red' ? 'var(--rust)' : undefined,
                          fontWeight: nte.kind === 'nofit' ? 700 : 400 }}>
                {nte.text}
              </p>
            </div>
          ))}

          {/* ---- what to ask the market for ---- */}
          <div className="card">
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              <Fig label="Tiers to ask for" value={plan.tiers} big accent="var(--hull)" />
              <Fig label="÷94 rule says" value={plan.ruleOfThumb}
                   accent={plan.ruleOfThumb === plan.tiers ? undefined : 'var(--brass)'} />
              <Fig label="Boxes" value={plan.totalBoxes.toLocaleString('en-GB')} />
              {/* The real room in THESE tiers. Multiplying by 47 is only right in
                  the middle of the new market. */}
              <Fig label="Footprints used"
                   value={`${plan.footprints} of ${plan.capacity ?? plan.tiers * PER_TIER_FLAT}`} />
              {plan.firstTier != null && (
                <Fig label="Tiers" value={`${plan.firstTier}–${plan.lastTier}`}
                     accent={plan.areas?.length > 1 ? 'var(--brass)' : undefined} />
              )}
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

          {plan.warnings.filter((w) => !(plan.notices || []).some((nte) => nte.text === w)).map((w, i) => (
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
              {/* WHERE the spare room is, not just how much.
                  The rows fill independently, so a total is not a budget: on
                  Trip 63 all fifteen spare places were on the top row while the
                  megrim that could have come down are on the bottom, which was
                  full to the last place. "Not enough to drop another grade"
                  reads as an arithmetic shortfall when it is nothing of the
                  kind. */}
              {plan.spare > 0 && (
                <p className="muted" style={{ fontSize: '0.82rem', margin: '0.6rem 0 0' }}>
                  {plan.spare} {plan.spare === 1 ? 'footprint' : 'footprints'} still spare
                  {plan.spareTop > 0 && plan.spareBottom > 0
                    ? ` — ${plan.spareTop} on the top row, ${plan.spareBottom} on the bottom.`
                    : ` — all of ${plan.spare === 1 ? 'it' : 'them'} on the ${plan.spareBottom > 0 ? 'bottom' : 'top'} row.`}
                  {' '}A grade can only use the room in its <em>own</em> row, so spare space on one side
                  cannot bring a fish down on the other.
                </p>
              )}
            </div>
          )}

          {/* ---- THE BUYERS' CATALOGUE ----------------------------------
              A second sheet off the same tally, for the market rather than
              the boat. Buyers cannot tell which lot is the freshest once the
              auction is under way, and only the freshest day sells as A+. */}
          {catalogue && catalogue.totalBoxes > 0 && (
            <div className="card">
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ flex: '1 1 18rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Buyers&rsquo; catalogue</h3>
                  <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.82rem' }}>
                    {freshestNote(catalogue)} One page per clock, only what is aboard, with a
                    column to cross lots off as they sell.
                  </p>
                </div>

                {/* WHICH DAY IS FRESHEST is asked, not assumed. Getting it
                    backwards would print A+ on the oldest fish on every sheet
                    the market hands out. */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Freshest day
                  </span>
                  <select value={freshest} onChange={(e) => setFreshest(e.target.value)}>
                    <option value="high">Highest number ({Math.max(...catalogue.days)})</option>
                    <option value="low">Lowest number ({Math.min(...catalogue.days)})</option>
                  </select>
                </label>

                <button onClick={() => exportCataloguePdf(catalogue, {
                  vessel: parsed.meta?.vessel || null,
                  port: parsed.meta?.port || null,
                  saleDate: parsed.meta?.saleDate || null,
                })}>📄 Catalogue for buyers</button>
              </div>

              {/* An unfiled species is NAMED rather than quietly dropped — the
                  buyers are working from this. */}
              {catalogue.unfiled.length > 0 && (
                <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--brass)' }}>
                  {catalogue.unfiled.map((s) => s.species).join(', ')} {catalogue.unfiled.length === 1 ? 'is' : 'are'} not on a clock yet,
                  so {catalogue.unfiled.length === 1 ? 'it prints' : 'they print'} on their own page at the back.{' '}
                  <Link to="/market-rules">Put {catalogue.unfiled.length === 1 ? 'it' : 'them'} on one</Link>.
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
