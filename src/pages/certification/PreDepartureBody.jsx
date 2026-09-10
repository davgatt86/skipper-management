import React from 'react'
import { Link } from 'react-router-dom'
import { guidesFor } from '../../lib/certification/predeparture'

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

/* TWO CLOCKS, AND THE WORDS ARE NOT INTERCHANGEABLE.

   `overdue` means past the STATUTORY interval — a breach, and it is rust.
   `past her own` means past the cadence the boat set for herself while still
   inside the law: her standard, not the law's, so brass.

   Saying "overdue" for the second would cry wolf; saying "past her own" for
   the first would let a breach read as a preference. */
const TONE = {
  done: { colour: 'var(--kelp)', word: 'done' },
  outstanding: { colour: 'var(--rust)', word: 'not done' },
  overdue: { colour: 'var(--rust)', word: 'overdue' },
  watch: { colour: 'var(--brass)', word: 'past her own' },
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
              {watch.length} {watch.length === 1 ? 'is' : 'are'} past her own interval.
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

      <Band title="On a repeating interval"
            note="Two clocks. The statutory interval is a maximum and going past it is a
                  breach; the boat may keep to a shorter one of her own — weekly,
                  fortnightly or monthly — and going past that alone is her standard, not
                  the law’s."
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
        {/* THE NUMBER OF DAYS LEADS, because it is the fact. Then BOTH clocks,
            so a reader can see which one a state is against. */}
        {r.cls === 'due' && (
          <span className="sub3">
            {' '}
            {r.last
              ? r.age + ' days since — last ' + fmt(r.last)
                + (r.every ? ', her own ' + everyWord(r.every) : '')
                + (r.statutory ? ', statutory ' + everyWord(r.statutory.days) : '')
              : 'no entry on record'}
          </span>
        )}
        {/* THE STATUTORY FIGURE IS NOT CONFIRMED, and the row says so rather
            than letting the app put a regulation in a skipper’s mouth. */}
        {r.statutory && !r.statutory.confirmed && (
          <span className="sub3" style={{ color: 'var(--brass)' }}>
            {' '}⚑ {r.statutory.source}
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
          /* OFFERING A LONGER CADENCE THAN THE LAW WOULD BE OFFERING TO BREACH,
             so the list is cut at the statutory interval for that entry. */
          <select value={r.every == null ? '' : String(r.every)}
                  onChange={(e) => onGuide(r.olb, e.target.value === '' ? null : Number(e.target.value))}
                  style={{ fontSize: '0.74rem', padding: '1px 4px', width: 'auto' }}>
            {guidesFor(r.olb).map((g) => (
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

const WORDS = { 7: 'weekly', 14: 'fortnightly', 30: 'monthly', 90: 'quarterly' }
const everyWord = (days) => WORDS[days] || 'every ' + days + ' days'

const fmt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—')
