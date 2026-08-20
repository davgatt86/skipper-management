import { useMemo } from 'react'
import { partLives, netLives, confidence } from '../lib/gear/gearStats'

/* HOW LONG THE GEAR LASTS — the stats tab.
 *
 * "Bridles lasted X days/trips, hoppers lasted X days/trips between renewal…
 * the usage tracked would show avg time for each." (David, Aug 2026)
 *
 * THE COUNT IS SHOWN BESIDE EVERY AVERAGE, always. One renewal is an anecdote
 * and a mean of two is barely better, so a figure that reads like a fact when
 * it rests on a single interval is the failure worth guarding against here.
 * Same discipline as the pair price-gap panel, which reports 29 paired days and
 * a mean difference of £0.000 rather than a headline number.
 *
 * And a set still on the net is NEVER folded into the average — it has not
 * finished. It sits in its own column, compared against the average, because
 * "running at 111 days against an average of 60" is the thing you act on.
 */

const fmtDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—')
const num = (n, suffix = '') => (Number.isFinite(n) ? `${n}${suffix}` : '—')

export default function GearStats({ parts, nets, components, vessels, tripDates, today, tripsKnown }) {
  const byPart = useMemo(
    () => partLives({ parts, nets, components, tripDates, today }),
    [parts, nets, components, tripDates, today])
  const byNet = useMemo(
    () => netLives({ nets, components, tripDates, today, vessels }),
    [nets, components, tripDates, today, vessels])

  const anyLives = byPart.some((r) => r.n > 0)

  return (
    <>
      {!anyLives && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Nothing has been renewed yet</h2>
          <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
            A life is measured between one renewal and the next, so these figures start
            filling in the second time a set of gear is changed. What is fitted now is
            shown below with how long it has been on.
          </p>
        </div>
      )}

      {!tripsKnown && (
        <div className="card" style={{ borderColor: 'var(--brass)' }}>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Trip counts need a signal — the days stand on their own until then, rather than
            showing a zero that would read as “no trips”.
          </p>
        </div>
      )}

      {/* ---- per part: how long one of these usually lasts ---------------- */}
      <div className="card">
        <h3 style={{ margin: '0 0 0.6rem', fontSize: '0.95rem' }}>How long a part lasts</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 620 }}>
            <thead>
              <tr>
                <th style={{ ...TH, textAlign: 'left' }}>Part</th>
                <th style={TH}>Average</th>
                <th style={TH}>Shortest</th>
                <th style={TH}>Longest</th>
                <th style={TH}>Cost</th>
                <th style={{ ...TH, textAlign: 'left' }}>On the basis of</th>
              </tr>
            </thead>
            <tbody>
              {byPart.map((r) => {
                const c = confidence(r.n)
                return (
                  <tr key={r.part.key}>
                    <td style={{ ...TD, textAlign: 'left', fontWeight: 600 }}>{r.part.label}</td>
                    <td style={{ ...TD, ...MONO }}>
                      {num(r.avgDays, 'd')}
                      {Number.isFinite(r.avgTrips) && <span className="muted"> · {r.avgTrips}t</span>}
                    </td>
                    <td style={{ ...TD, ...MONO }}>{num(r.minDays, 'd')}</td>
                    <td style={{ ...TD, ...MONO }}>{num(r.maxDays, 'd')}</td>
                    <td style={{ ...TD, ...MONO }}>
                      {Number.isFinite(r.avgCost) ? `£${r.avgCost.toLocaleString()}` : '—'}
                      {/* Averaged over the ones that HAVE a cost, and it says so.
                          A mean over "the ones we know" shown as a mean over all
                          of them is a quiet lie, and the cost often is unknown. */}
                      {Number.isFinite(r.avgCost) && r.costKnown < r.n && (
                        <span className="muted" style={{ fontSize: '0.7rem' }}> of {r.costKnown}</span>
                      )}
                    </td>
                    <td style={{ ...TD, textAlign: 'left' }}>
                      <span className="muted" style={{ fontSize: '0.78rem',
                              color: c.level === 'ok' ? 'var(--mute)' : 'var(--brass)' }}>
                        {c.text}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- what is on now, and how it compares ------------------------- */}
      <div className="card">
        <h3 style={{ margin: '0 0 0.2rem', fontSize: '0.95rem' }}>What is on now</h3>
        <p className="muted" style={{ margin: '0 0 0.6rem', fontSize: '0.78rem' }}>
          Never counted into the averages above — a set still on the net has not finished, and
          folding it in would drag every figure towards however recently the last renewal was.
        </p>
        {byPart.filter((r) => r.running.length).map((r) => (
          <div key={r.part.key} style={{ borderTop: '1px solid var(--border)', padding: '0.4rem 0' }}>
            <strong style={{ fontSize: '0.88rem' }}>{r.part.label}</strong>
            {r.running.map((x) => (
              <div key={x.net.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline',
                                           flexWrap: 'wrap', fontSize: '0.84rem', padding: '0.1rem 0' }}>
                <span style={{ minWidth: '9rem' }}>{x.net.name}</span>
                <span style={{ ...MONO, minWidth: '5rem' }}>
                  {num(x.days, 'd')}
                  {Number.isFinite(x.trips) && <span className="muted"> · {x.trips}t</span>}
                </span>
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  on since {fmtDate(x.component.fitted_on)}
                </span>
                {/* Only where there IS an average to be past. With none, saying
                    nothing is right — implying a comparison would be worse. */}
                {x.over !== null && (
                  <span style={{ fontSize: '0.78rem', fontWeight: 600,
                                 color: x.over > 0 ? 'var(--brass)' : 'var(--kelp)' }}>
                    {x.over > 0 ? `${Math.round(x.over * 100)}% past the usual ${r.avgDays}d`
                                : `${Math.round(-x.over * 100)}% inside the usual ${r.avgDays}d`}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
        {!byPart.some((r) => r.running.length) && (
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>Nothing fitted yet.</p>
        )}
      </div>

      {/* ---- per net ------------------------------------------------------ */}
      <div className="card">
        <h3 style={{ margin: '0 0 0.6rem', fontSize: '0.95rem' }}>The nets themselves</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ ...TH, textAlign: 'left' }}>Net</th>
                <th style={{ ...TH, textAlign: 'left' }}>Boat</th>
                <th style={TH}>Aboard</th>
                <th style={TH}>Age</th>
                <th style={TH}>Renewals</th>
              </tr>
            </thead>
            <tbody>
              {byNet.map((r) => (
                <tr key={r.net.id} style={{ opacity: r.retired ? 0.55 : 1 }}>
                  <td style={{ ...TD, textAlign: 'left', fontWeight: 600 }}>
                    {r.net.name}
                    {r.retired && <span className="muted" style={{ fontWeight: 400 }}> · retired</span>}
                  </td>
                  <td style={{ ...TD, textAlign: 'left' }} className="muted">
                    {r.vessel?.label || r.vessel?.name || '—'}
                  </td>
                  <td style={{ ...TD }} className="muted">{fmtDate(r.net.came_aboard)}</td>
                  {/* A retired net is aged to its retirement, not to today —
                      otherwise every net ever taken off keeps getting older and
                      the oldest on the books is always the one longest gone. */}
                  <td style={{ ...TD, ...MONO }}>
                    {num(r.ageDays, 'd')}
                    {Number.isFinite(r.ageTrips) && <span className="muted"> · {r.ageTrips}t</span>}
                  </td>
                  <td style={{ ...TD, ...MONO }}>{r.renewals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

const TH = { fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em',
             color: 'var(--mute)', padding: '0.3rem 0.5rem', textAlign: 'right',
             borderBottom: '1px solid var(--border)', fontWeight: 600 }
const TD = { padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--border)',
             fontSize: '0.85rem' }
const MONO = { fontFamily: 'var(--font-mono, monospace)', fontWeight: 700 }
