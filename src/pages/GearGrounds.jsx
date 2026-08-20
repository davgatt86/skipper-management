import { useMemo } from 'react'
import { livesOf } from '../lib/gear/gearStats'
import { groundWear, groundMix, mixShares, groundConfidence } from '../lib/gear/grounds'

/* WHICH GROUNDS EAT GEAR — the grounds tab.
 *
 * "Some areas fished are more abrasive on gear" (David, Aug 2026). The logbook
 * has carried the FAO area and EEZ since October 2022, so this is measurable
 * rather than an impression — but only once there are finished sets to
 * attribute, and the page has to be honest about that from the first day it is
 * opened, which is a day when it can say nothing at all.
 *
 * AREA, NOT RECTANGLE: 17 area+EEZ combinations against 129 rectangles. At the
 * number of renewals a boat logs, rectangles would divide the evidence into
 * slivers and every one would be noise.
 */

const fmtDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—')

export default function GearGrounds({ parts, nets, components, groundDays, groundsKnown }) {
  const netVessel = useMemo(
    () => Object.fromEntries((nets || []).map((n) => [n.id, n.vessel_id])), [nets])
  const netById = useMemo(
    () => Object.fromEntries((nets || []).map((n) => [n.id, n])), [nets])

  const allLives = useMemo(() => livesOf(components, {}), [components])
  const { rows, unattributed } = useMemo(
    () => groundWear(allLives, groundDays, netVessel), [allLives, groundDays, netVessel])
  const conf = groundConfidence(rows, allLives.length - unattributed)

  if (!groundsKnown) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          The grounds come off the logbook, which needs a signal. Nothing is shown rather than a
          set of empty rows that would read as “never fished there”.
        </p>
      </div>
    )
  }

  return (
    <>
      {/* The honest state of the evidence, first and unmissable. Ranking
          grounds off one or two finished sets would be inventing a finding, and
          the top of a wear table is exactly where a thin figure misleads. */}
      <div className="card" style={{ borderColor: conf.level === 'ok' ? 'var(--kelp)' : 'var(--brass)' }}>
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>
          {conf.level === 'ok' ? 'Enough to compare grounds' : 'Not enough to compare grounds yet'}
        </h2>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          {conf.text}.{' '}
          {conf.level !== 'ok' && (
            <>A ground’s wear rate is measured from sets that have been renewed, so this fills in
            as gear is changed. Where the gear has been worked is shown below regardless.</>
          )}
          {unattributed > 0 && (
            <> {unattributed} finished set{unattributed === 1 ? ' has' : 's have'} no logbook days
            inside {unattributed === 1 ? 'its' : 'their'} life and {unattributed === 1 ? 'is' : 'are'} not
            counted.</>
          )}
        </p>
      </div>

      {rows.length > 0 && (
        <div className="card">
          <h3 style={{ margin: '0 0 0.2rem', fontSize: '0.95rem' }}>Wear by ground</h3>
          <p className="muted" style={{ margin: '0 0 0.6rem', fontSize: '0.78rem' }}>
            Each finished set counts as one set consumed, split across the grounds it was worked
            over in proportion to the days on each. Higher means gear is used up faster there.
            <strong> Read the days and sets columns before the rate</strong> — a ground with a
            handful of days will show the most extreme figure on this page and mean nothing.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, textAlign: 'left' }}>Ground</th>
                  <th style={TH}>Sets per 100 days</th>
                  <th style={TH}>Days fished</th>
                  <th style={TH}>Sets</th>
                  <th style={TH}>From</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  // Thin rows are marked as thin rather than left to look equal
                  // to the ones that rest on real evidence.
                  const thin = r.days < 20 || r.lives < 2
                  return (
                    <tr key={r.key} style={{ opacity: thin ? 0.6 : 1 }}>
                      <td style={{ ...TD, textAlign: 'left', fontWeight: 600 }}>
                        {r.label}
                        {thin && <span className="muted" style={{ fontWeight: 400, fontSize: '0.72rem' }}> · thin</span>}
                      </td>
                      <td style={{ ...TD, ...MONO }}>{r.per100 ?? '—'}</td>
                      <td style={{ ...TD, ...MONO }}>{r.days}</td>
                      <td style={{ ...TD, ...MONO }}>{r.sets}</td>
                      <td style={{ ...TD, ...MONO }}>{r.lives}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Where each finished set was actually worked. Useful from the first
          renewal, long before any rate above it means anything. */}
      <div className="card">
        <h3 style={{ margin: '0 0 0.6rem', fontSize: '0.95rem' }}>Where each set was worked</h3>
        {!allLives.length && (
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Nothing has been renewed yet, so there are no finished sets to place.
          </p>
        )}
        {(parts || []).map((part) => {
          const lives = allLives.filter((l) => l.part_key === part.key)
          if (!lives.length) return null
          return (
            <div key={part.key} style={{ borderTop: '1px solid var(--border)', padding: '0.5rem 0' }}>
              <strong style={{ fontSize: '0.88rem' }}>{part.label}</strong>
              {lives.map((l) => {
                const mix = groundMix(groundDays[netVessel[l.net_id]] || [], l.fitted_on, l.removed_on)
                const shares = mixShares(mix)
                return (
                  <div key={l.id} style={{ padding: '0.2rem 0', fontSize: '0.82rem' }}>
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <span className="muted" style={{ minWidth: '8rem' }}>
                        {netById[l.net_id]?.name || 'net'}
                      </span>
                      <span style={{ ...MONO, minWidth: '4rem' }}>{l.days}d</span>
                      {Number.isFinite(l.trips) && <span className="muted" style={MONO}>{l.trips}t</span>}
                      <span className="muted" style={{ fontSize: '0.76rem' }}>
                        {fmtDate(l.fitted_on)} → {fmtDate(l.removed_on)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.1rem' }}>
                      {shares.length === 0
                        ? <span className="muted" style={{ fontSize: '0.76rem' }}>no logbook days inside this life</span>
                        : shares.map((g) => (
                            <span key={g.key} style={CHIP}>
                              {g.label} <span className="muted">{Math.round(g.share * 100)}%</span>
                            </span>
                          ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
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
const CHIP = { fontSize: '0.74rem', padding: '0.05rem 0.4rem', borderRadius: 3,
               background: 'var(--paper, #ECEFEE)', border: '1px solid var(--border)' }
