import React from 'react'
import { Link } from 'react-router-dom'

/* THE PRE-DEPARTURE CHECK, DRAWN.
 *
 * Prop-driven and a file of its own so it can be server-rendered — the page is
 * behind a login and the states worth looking at are the awkward ones: no
 * departure on record, a drill inside its interval, an event with no entry.
 *
 * NOTHING IS ENTERED HERE. Every row links to the book that owns it, because a
 * second place to make a legal entry is a second version of the record. All the
 * deciding is in `lib/certification/predeparture.js`.
 */

const TONE = {
  done: { colour: 'var(--kelp)', word: 'done' },
  outstanding: { colour: 'var(--rust)', word: 'not done' },
  overdue: { colour: 'var(--rust)', word: 'overdue' },
  due: { colour: 'var(--brass)', word: 'due' },
  never: { colour: 'var(--rust)', word: 'never recorded' },
  nothing: { colour: 'var(--mute)', word: 'nothing to record' },
}

export default function PreDepartureBody({
  vessel, check, onPick, departures = [], busy = false,
}) {
  if (!check?.known) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>No sailing to check against</h3>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          The check measures each book from the last sailing to this one, so it needs a
          departure to work from. They come off the logbook — <Link to="/trips">Trips</Link>{' '}
          shows what has been read in.
        </p>
        {/* NO DEPARTURE, NO CHECK — and saying nothing is outstanding would be
            worse than saying nothing at all, because it reads as an all-clear. */}
      </div>
    )
  }

  const { items, outstanding, departure, from } = check
  const byClass = (c) => items.filter((i) => i.cls === c)

  return (
    <div>
      <div className="card">
        <div className="dash-head">
          <div>
            <h3>Before she sails</h3>
            <p className="dash-when">
              {vessel?.label ? vessel.label + ' · ' : ''}departure {fmt(departure)}
              {from ? ' · since ' + fmt(from) : ' · no earlier sailing on record'}
            </p>
          </div>
          {departures.length > 1 && (
            <select value={departure} disabled={busy}
                    onChange={(e) => onPick?.(e.target.value)}
                    style={{ maxWidth: '14rem' }}>
              {departures.map((d) => (
                <option key={d} value={d}>{fmt(d)}</option>
              ))}
            </select>
          )}
        </div>

        {/* IT NEVER SAYS SHE IS READY TO SAIL. It says what is not done. Ready is
            a claim about a vessel and her crew that no software can make out of
            four tables, and a green tick against a departure is the sort of
            thing read back at an inquiry. */}
        {outstanding.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            <b style={{ color: 'var(--kelp)' }}>Nothing outstanding in the books.</b>{' '}
            <span className="muted">
              That is what the records say — it is not a statement that the vessel is fit
              to sail.
            </span>
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            <b style={{ color: 'var(--rust)' }}>
              {outstanding.length} {outstanding.length === 1 ? 'thing is' : 'things are'} not done.
            </b>{' '}
            <span className="muted">Each one is made in its own book.</span>
          </p>
        )}
      </div>

      <Band title="Every voyage"
            note="Done before she sails, whatever was done last trip."
            rows={byClass('every')} />

      <Band title="On their own clock"
            note="Official Log Book entries with an interval. A drill done last week is not
                  wanted again because she happens to be sailing today."
            rows={byClass('due')} />

      <Band title="Only if it happened"
            note="There is no missing garbage entry when nothing went ashore. What makes one
                  of these outstanding is the event having happened and the book not saying so."
            rows={byClass('ifHappened')} />
    </div>
  )
}

function Band({ title, note, rows }) {
  if (!rows.length) return null
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>{note}</p>
      <div className="dlist">
        {rows.map((r) => <Row key={r.key} r={r} />)}
      </div>
    </div>
  )
}

function Row({ r }) {
  const t = TONE[r.state] || TONE.nothing
  return (
    <div className="di">
      <span>
        <b>{r.label}</b>
        <span className="sub3"> — {r.why}</span>
        {/* WHAT IT RESTS ON, so a state can be argued with rather than believed.
            An interval, a last date, or the number of movements it found. */}
        {r.cls === 'due' && (
          <span className="sub3">
            {' '}Every {r.every} days.{' '}
            {r.last ? 'Last ' + fmt(r.last) + (r.age != null ? ', ' + r.age + ' days ago' : '') : ''}
          </span>
        )}
        {r.key === 'bunkering' && r.n > 0 && (
          <span className="sub3">
            {' '}{r.n} movement{r.n === 1 ? '' : 's'} since she last sailed
            {r.unrecorded ? ', ' + r.unrecorded + ' with no entry' : ', all recorded'}.
          </span>
        )}
        {r.key === 'garbage' && r.n > 0 && (
          <span className="sub3"> {r.n} entr{r.n === 1 ? 'y' : 'ies'} made.</span>
        )}
      </span>
      <span style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', whiteSpace: 'nowrap' }}>
        <span className="when" style={{ color: t.colour }}>{t.word}</span>
        <Link to={r.to} className="when">open</Link>
      </span>
    </div>
  )
}

/**
 * The line the Crew List page shows after a list is saved.
 *
 * ONE THING, NOT SEVEN. A list of everything outstanding after saving one item
 * is a wall; the next single thing is an instruction.
 */
export function NextAfterSaving({ next, remaining }) {
  if (!next) return null
  return (
    <p className="dash-foot" style={{ borderLeft: '3px solid var(--hull)', paddingLeft: '0.6rem' }}>
      Next before she sails: <b>{next.label}</b>. <Link to={next.to}>Open it</Link>
      {remaining > 1 ? ` — ${remaining - 1} more after that` : ''}, or see them all on{' '}
      <Link to="/pre-departure">Before she sails</Link>.
    </p>
  )
}

const fmt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—')
