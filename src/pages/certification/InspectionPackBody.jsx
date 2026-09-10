import React from 'react'
import { Link } from 'react-router-dom'

/* THE INSPECTION PACK, ON SCREEN.
 *
 * Prop-driven and a file of its own so it can be server-rendered — the page is
 * behind a login, and the state worth checking is the awkward one: a boat whose
 * certificates are immaculate and whose statutory books are empty.
 *
 * THE SCREEN SHOWS WHAT THE PDF WILL SAY, and in the same order, because a
 * skipper who checks a shape that only exists on screen has checked the wrong
 * document. Both are built from one `inspectionPack()` result.
 */

const D = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—')

const TONE = {
  expired: 'var(--rust)', overdue: 'var(--rust)', unsafe: 'var(--rust)',
  due: 'var(--brass)', undated: 'var(--brass)', never: 'var(--brass)',
  valid: 'var(--kelp)', current: 'var(--kelp)',
  noexpiry: 'var(--mute)', 'no-interval': 'var(--brass)',
}
const WORD = {
  expired: 'expired', due: 'due', valid: 'valid', noexpiry: 'no expiry',
  overdue: 'overdue', current: 'current', undated: 'no review date',
  never: 'never examined', unsafe: 'UNSAFE',
}

export default function InspectionPackBody({
  pack, from, to, onFrom, onTo, onExport, busy = false, vessel,
}) {
  if (!pack) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Nothing to report on yet</h3>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          The pack reads the books; it keeps none of its own. Once there are records
          for a period there will be something to put in it.
        </p>
      </div>
    )
  }

  const holes = pack.notCovered.filter((g) => g.kind === 'empty')
  const paper = pack.notCovered.filter((g) => g.kind === 'paper')
  const files = pack.notCovered.filter((g) => g.kind === 'nofile')

  return (
    <div>
      <div className="card">
        <div className="dash-head">
          <div>
            <h3>The period</h3>
            <p className="dash-when">
              {vessel?.label ? vessel.label + ' · ' : ''}
              {D(pack.period.from)} to {D(pack.period.to)}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.72rem' }}>
              <span className="muted">From</span>
              <input type="date" value={from || ''} onChange={(e) => onFrom?.(e.target.value)} />
            </label>
            <label style={{ fontSize: '0.72rem' }}>
              <span className="muted">To</span>
              <input type="date" value={to || ''} onChange={(e) => onTo?.(e.target.value)} />
            </label>
            <button onClick={onExport} disabled={busy}>
              {busy ? 'Building…' : 'Export the pack'}
            </button>
          </div>
        </div>

        {/* THE SENTENCE THAT KEEPS THE WHOLE THING HONEST, on the screen as
            well as the cover — a skipper handing this over should know what he
            is handing over. */}
        <p style={{
          margin: '0.6rem 0 0', fontSize: '0.85rem',
          borderLeft: '3px solid var(--hull)', paddingLeft: '0.6rem',
        }}>
          A report of what the records hold for this period. <b>It is not a declaration
          of compliance</b>, and nothing in it certifies the vessel, her equipment or
          her crew. Where a record is absent it says so rather than leaving it out.
        </p>
      </div>

      {/* ---- what it cannot speak to, FIRST ---------------------------- */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>What this pack does not cover</h3>

        {!pack.notCovered.length && (
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--kelp)' }}>
            Every book carries entries for the period, and every certificate listed
            has its document held here.
          </p>
        )}

        {holes.length > 0 && (
          <>
            <p style={{ margin: '0 0 0.6rem', fontSize: '0.9rem' }}>
              <b style={{ color: 'var(--rust)' }}>
                {holes.length} record{holes.length === 1 ? ' has' : 's have'} no entries at all.
              </b>{' '}
              <span className="muted">
                These are the pages a surveyor turns to first, and the pack cannot
                speak to any of them.
              </span>
            </p>
            <div className="dlist">
              {holes.map((g) => (
                <div className="di" key={g.key} style={{ alignItems: 'flex-start' }}>
                  <span>
                    <b>{g.label}</b>
                    <span className="sub3"> — {g.why}</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* NOT A FAILING, and it must not look like one. */}
        {paper.length > 0 && (
          <>
            <h4 style={{ margin: '1rem 0 0.4rem', fontSize: '0.85rem' }}>
              Kept on paper — the paper book is the record
            </h4>
            <div className="dlist">
              {paper.map((g) => (
                <div className="di" key={g.key} style={{ alignItems: 'flex-start' }}>
                  <span><b>{g.label}</b><span className="sub3"> — {g.why}</span></span>
                </div>
              ))}
            </div>
          </>
        )}

        {files.length > 0 && (
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.8rem' }}>
            {files[0].why}
          </p>
        )}
      </div>

      {/* ---- the books ------------------------------------------------- */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>The record books</h3>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
          Entries in the period, with the lifetime position beside it. A book that is
          quiet in one period is a different thing from one that has never been
          started, so both are given.
        </p>
        <div className="dlist">
          {pack.books.map((b) => (
            <div className="di" key={b.key}>
              <span>
                <b>{b.label}</b>
                <span className="sub3"> — {b.source}</span>
                {!b.never && (
                  <span className="sub3">
                    {' '}{b.n} in the period
                    {b.n ? ` (${D(b.first)} to ${D(b.last)})` : ''}
                    {' · '}{b.total} in all, last {D(b.everLast)}
                  </span>
                )}
              </span>
              <span className="when" style={{ color: b.never ? 'var(--rust)' : 'var(--kelp)' }}>
                {b.never ? 'never started' : `${b.n} this period`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ---- certificates ---------------------------------------------- */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Vessel certificates</h3>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
          As they stood on {D(pack.certs.asOf)} — the closing date, not today. A
          certificate is a state rather than an event.
        </p>
        <p style={{ margin: '0 0 0.6rem', fontSize: '0.9rem' }}>
          {pack.certs.expired.length > 0 && (
            <b style={{ color: 'var(--rust)' }}>{pack.certs.expired.length} expired. </b>)}
          {pack.certs.due.length > 0 && (
            <b style={{ color: 'var(--brass)' }}>{pack.certs.due.length} falling due. </b>)}
          <span className="muted">
            {pack.certs.valid.length} valid, {pack.certs.noExpiry.length} with no expiry,
            {' '}{pack.certs.withoutFile.length} without the document held here.
          </span>
        </p>
        {pack.certs.lapsed.length > 0 && (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--brass)' }}>
            <b>Lapsed during this period:</b>{' '}
            {pack.certs.lapsed.map((c) => `${c.cert_type} (${D(c.expiry_date)})`).join(', ')}.
          </p>
        )}
      </div>

      {/* ---- crew ------------------------------------------------------- */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Crew aboard</h3>
        {!pack.crew.length ? (
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--rust)' }}>
            Nobody is recorded as aboard. Crew status is set on{' '}
            <Link to="/crew">Crew</Link>.
          </p>
        ) : (
          <div className="dlist">
            {pack.crew.map((c) => (
              <div className="di" key={c.id}>
                <span>
                  <b>{c.name}</b>
                  <span className="sub3">
                    {' '}{c.rank || 'no rank'} · {c.nationality || 'no nationality'}
                    {' · '}{c.tickets.length} ticket{c.tickets.length === 1 ? '' : 's'}
                  </span>
                  {c.passportState === 'expired' && (
                    <span className="sub3" style={{ color: 'var(--rust)' }}>
                      {' '}Passport expired {D(c.passportExpiry)}.
                    </span>
                  )}
                  {!c.passportNumber && (
                    <span className="sub3" style={{ color: 'var(--brass)' }}>
                      {' '}No passport on file — a crew list is a border document.
                    </span>
                  )}
                </span>
                <span className="when" style={{
                  color: c.expired.length ? 'var(--rust)'
                    : c.due.length ? 'var(--brass)' : 'var(--kelp)',
                }}>
                  {c.expired.length ? `${c.expired.length} expired`
                    : c.due.length ? `${c.due.length} due` : 'in date'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- risk assessments ------------------------------------------- */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Risk assessments</h3>
        {!pack.assessments.length ? (
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--rust)' }}>
            None on record. <Link to="/risk-assessments">Risk assessments</Link>.
          </p>
        ) : (
          <>
            <p style={{ margin: '0 0 0.6rem', fontSize: '0.9rem' }}>
              <b>{pack.assessmentsLive} in force</b>
              <span className="muted"> of {pack.assessmentsHeld} held.</span>
              {pack.hazardsUnrated > 0 && (
                <span style={{ color: 'var(--brass)' }}>
                  {' '}{pack.hazardsUnrated} hazards carry no rating.
                </span>
              )}
            </p>
            <div className="dlist">
              {pack.assessments.map((a) => (
                <div className="di" key={a.id}>
                  <span>
                    <b>{a.title}</b>
                    <span className="sub3">
                      {' '}{a.ref ? a.ref + ' · ' : ''}assessed {D(a.assessedOn)} by {a.assessedBy}
                      {' · '}{a.hazards} hazard{a.hazards === 1 ? '' : 's'}
                      {a.unrated ? `, ${a.unrated} unrated` : ''}
                    </span>
                    {!a.briefed && (
                      <span className="sub3" style={{ color: 'var(--brass)' }}>
                        {' '}No record of the crew being briefed on it.
                      </span>
                    )}
                  </span>
                  <span className="when" style={{ color: TONE[a.state] || 'var(--mute)' }}>
                    {WORD[a.state] || a.state}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ---- lifting and work equipment ---------------------------------- */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Lifting and work equipment</h3>
        {!pack.equipment.length ? (
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--rust)' }}>
            Nothing on record, and no thorough examinations. LOLER and PUWER both apply
            to a vessel of this kind. <Link to="/lifting-equipment">Lifting equipment</Link>.
          </p>
        ) : (
          <div className="dlist">
            {pack.equipment.map((e) => (
              <div className="di" key={e.id}>
                <span>
                  <b>{e.name}</b>
                  <span className="sub3">
                    {' '}{e.identifier || 'no id'}{e.swl ? ' · SWL ' + e.swl : ''}
                    {' · '}{e.examinations} examination{e.examinations === 1 ? '' : 's'}
                    {e.lastExamined ? `, last ${D(e.lastExamined)}` : ''}
                    {e.nextDue ? `, next ${D(e.nextDue)}` : ''}
                  </span>
                </span>
                <span className="when" style={{ color: TONE[e.state] || 'var(--mute)' }}>
                  {WORD[e.state] || e.state}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- maintenance -------------------------------------------------- */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Maintenance in the period</h3>
        {!pack.maintenance.length ? (
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--brass)' }}>
            Nothing recorded between {D(pack.period.from)} and {D(pack.period.to)}.
            {' '}{pack.maintenanceTasks} tasks are on the schedule.
          </p>
        ) : (
          <div className="dlist">
            {pack.maintenance.map((m, i) => (
              <div className="di" key={i}>
                <span>
                  <b>{m.task}</b>
                  <span className="sub3">
                    {' '}{m.component || 'no component'} · {m.doneBy || 'not named'}
                    {m.runningHours != null ? ` · ${m.runningHours} h` : ''}
                  </span>
                </span>
                <span className="when">{D(m.doneOn)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
