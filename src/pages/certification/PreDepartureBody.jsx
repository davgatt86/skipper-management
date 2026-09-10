import React from 'react'
import { Link } from 'react-router-dom'
import { GUIDES } from '../../lib/certification/predeparture'

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

/* NOTHING IS "OVERDUE". David: "intervals are guide not targets." The word
   asserts a breach of a calendar SI 1981/570 does not set — it says WHAT to
   enter, not how often to hold a drill. Past the guide is a WATCH, in brass
   rather than rust, and what the row leads with is the number of days.

   `never` keeps the red: no record at all is a different thing from a record
   that is older than the boat meant. */
const TONE = {
  done: { colour: 'var(--kelp)', word: 'done' },
  logged: { colour: 'var(--mute)', word: 'logged' },
  outstanding: { colour: 'var(--rust)', word: 'not done' },
  watch: { colour: 'var(--brass)', word: 'past the guide' },
  never: { colour: 'var(--rust)', word: 'never recorded' },
  nothing: { colour: 'var(--mute)', word: 'nothing to record' },
}

export default function PreDepartureBody({
  vessel, check, onPick, departures = [], busy = false, onGuide,
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

  const { items, outstanding, watch = [], departure, from } = check
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

        {/* NOT DONE AND PAST THE GUIDE ARE COUNTED SEPARATELY. Rolling them
            together is how a checklist starts crying wolf: a crew list that was
            never lodged is not done, and a drill held 34 days ago against a
            30-day guide is a judgement for the skipper. */}
        <p style={{ margin: 0, fontSize: '0.9rem' }}>
          {outstanding.length > 0 && (
            <b style={{ color: 'var(--rust)' }}>
              {outstanding.length} {outstanding.length === 1 ? 'thing is' : 'things are'} not done.
            </b>
          )}
          {outstanding.length > 0 && watch.length > 0 && ' '}
          {watch.length > 0 && (
            <b style={{ color: 'var(--brass)' }}>
              {watch.length} {watch.length === 1 ? 'is' : 'are'} past the guide.
            </b>
          )}
          {outstanding.length === 0 && watch.length === 0 && (
            <b style={{ color: 'var(--kelp)' }}>Nothing outstanding in the books.</b>
          )}
          {' '}
          <span className="muted">
            {outstanding.length || watch.length
              ? 'Each one is made in its own book.'
              : 'That is what the records say — it is not a statement that the vessel is fit to sail.'}
          </span>
        </p>
      </div>

      <Band title="Every voyage"
            note="Done before she sails, whatever was done last trip."
            rows={byClass('every')} />

      <Band title="How often the boat holds them"
            note="A GUIDE, not a target — the regulation says what to enter, not how often to
                  hold a drill. Weekly, fortnightly or monthly is the boat’s own call, and
                  the number of days since is the fact."
            rows={byClass('due')} onGuide={onGuide} />

      <Band title="Only if it happened"
            note="There is no missing garbage entry when nothing went ashore. What makes one
                  of these outstanding is the event having happened and the book not saying so."
            rows={byClass('ifHappened')} />
    </div>
  )
}

function Band({ title, note, rows, onGuide }) {
  if (!rows.length) return null
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>{note}</p>
      <div className="dlist">
        {rows.map((r) => <Row key={r.key} r={r} onGuide={onGuide} />)}
      </div>
    </div>
  )
}

function Row({ r, onGuide }) {
  const t = TONE[r.state] || TONE.nothing
  return (
    <div className="di">
      <span>
        <b>{r.label}</b>
        <span className="sub3"> — {r.why}</span>
        {/* WHAT IT RESTS ON, so a state can be argued with rather than believed.
            An interval, a last date, or the number of movements it found. */}
        {/* THE NUMBER OF DAYS IS THE FACT and leads; the guide is what it is
            being read against, and it is the boat’s own. */}
        {r.cls === 'due' && (
          <span className="sub3">
            {' '}
            {r.last
              ? r.age + ' days since — last ' + fmt(r.last)
                + (r.every ? ', the boat’s guide is ' + guideWord(r.every) : ', no guide set')
              : 'no entry on record'}
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
        {onGuide && r.cls === 'due' && (
          <select value={r.every == null ? '' : String(r.every)}
                  onChange={(e) => onGuide(r.olb, e.target.value === '' ? null : Number(e.target.value))}
                  style={{ fontSize: '0.74rem', padding: '1px 4px', width: 'auto' }}>
            {GUIDES.map((g) => (
              <option key={g.key} value={g.days == null ? '' : String(g.days)}>{g.label}</option>
            ))}
          </select>
        )}
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

const guideWord = (days) =>
  (GUIDES.find((g) => g.days === days)?.label || 'every ' + days + ' days').toLowerCase()

const fmt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—')
