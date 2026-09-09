import React, { useMemo, useState } from 'react'
import {
  DEFAULT_REVIEW_MONTHS, REVIEW_TRIGGERS, KINDS, kindOf,
  assessmentState, assessmentGaps, withLineage, rating,
  intervalMonths, equipmentState, equipmentOutstanding, reviewDue,
} from '../../lib/certification/safety'

/* RISK ASSESSMENTS, AND LIFTING AND WORK EQUIPMENT.
 *
 * THESE ARE THE FIRST CERTIFICATION PAGES WITH NO PAPER TWIN, and that is the
 * headline rather than a footnote. The Oil Record Book and the Official Log
 * Book both have to tell the skipper the paper is still the record; here reg 7
 * prescribes no form at all, and MGN 332 says a thorough examination report may
 * be kept electronically. So there is no warning banner, and there should not
 * be one — a warning that appears where nothing is wrong is how the ones that
 * matter stop being read.
 */

/* ==== RISK ASSESSMENTS ==================================================== */

export function RiskBody({
  vessel, assessments = [], hazards = [], briefings = [], canWrite = false, busy = false,
  today = new Date().toISOString().slice(0, 10), reviewMonths = DEFAULT_REVIEW_MONTHS,
  onSave, onReview, onBrief, onOpen, selected,
  onSaveHazard, onRemoveHazard,
}) {
  const [adding, setAdding] = useState(false)
  const rows = useMemo(() => withLineage(assessments), [assessments])
  const live = rows.filter((a) => !a.replaced_by && !a.withdrawn_on)
  const late = live
    .map((a) => ({ a, ...assessmentGaps(a, hazards, briefings, { asOf: today }) }))
    .filter((x) => ['overdue', 'due', 'undated'].includes(x.state) || x.neverBriefed || x.lateActions.length)

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <Fig label="Vessel" value={vessel?.label || 'the fleet'} />
          <Fig label="In force" value={live.length || '—'} />
          <Fig label="Reviewed every" value={`${reviewMonths} months`} />
        </div>
        {/* THE STATUTE'S TRIGGERS ARE EVENTS; THE ANNUAL CYCLE IS THE BOAT'S,
            and presenting them as one thing would be wrong about the law. */}
        <p className="muted" style={{ fontSize: '0.8rem', margin: '0.6rem 0 0' }}>
          Reg 7 of the Merchant Shipping and Fishing Vessels (Health and Safety at Work)
          Regulations 1997. The regulation gives no form and no calendar — it says an assessment
          is reviewed where <b>{REVIEW_TRIGGERS[0]}</b> or {REVIEW_TRIGGERS[1]}. The{' '}
          {reviewMonths}-month cycle is this boat's own, on top of that. It also requires the
          significant findings to be <b>brought to the notice of the crew</b>, which is what the
          briefing count below is.
        </p>
      </div>

      <Outstanding late={late} onOpen={onOpen} />

      {/* THE PAGE HAD NO WAY IN. The library could save an assessment from the
          day it was written and nothing ever called it, so the empty state was
          a dead end. */}
      {canWrite && onSave && (adding
        ? <NewAssessment today={today} reviewMonths={reviewMonths} busy={busy}
                         vessel={vessel}
                         onCancel={() => setAdding(false)}
                         onSave={async (a) => { await onSave(a); setAdding(false) }} />
        : <p style={{ margin: '0 0 1rem' }}>
            <button onClick={() => setAdding(true)} disabled={busy}>New assessment</button>
          </p>)}

      {rows.length === 0 ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>No risk assessments yet</h3>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            An assessment is about a job rather than a boat — shooting and hauling, working the
            deck in a sea, lifting, chemicals, working aloft. It does not have to name a vessel.
          </p>
        </div>
      ) : rows.map((a) => (
        <Assessment key={a.id} a={a} hazards={hazards} briefings={briefings} today={today}
                    open={selected === a.id} canWrite={canWrite} busy={busy}
                    reviewMonths={reviewMonths}
                    onOpen={onOpen} onReview={onReview} onBrief={onBrief}
                    onSaveHazard={onSaveHazard} onRemoveHazard={onRemoveHazard} />
      ))}
    </div>
  )
}

function Outstanding({ late, onOpen }) {
  if (!late.length) return null
  return (
    <div className="card" style={{ borderLeft: '3px solid var(--brass)' }}>
      <h3 style={{ margin: '0 0 0.4rem' }}>Wanting attention</h3>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem' }}>
        {late.map(({ a, state, days, lateActions, neverBriefed }) => (
          <li key={a.id} style={{ marginBottom: '0.2rem' }}>
            <button className="secondary" style={{ padding: '0 0.3rem', fontSize: '0.8rem' }}
                    onClick={() => onOpen?.(a.id)}>{a.title}</button>
            {state === 'overdue' && <> — review <b style={{ color: 'var(--rust)' }}>{days} days overdue</b></>}
            {state === 'due' && <> — review due in {days} days</>}
            {/* NO REVIEW DATE IS NOT "IN DATE". Calling it current would be the
                quiet lie; it is simply not known when it is next looked at. */}
            {state === 'undated' && <> — <b>no review date set</b>, so nothing is chasing it</>}
            {lateActions.length > 0 && <> · <b>{lateActions.length} action{lateActions.length === 1 ? '' : 's'} past their date</b></>}
            {/* THE DUTY NOTHING ELSE IN THIS APP RECORDS. */}
            {neverBriefed && <> · <b style={{ color: 'var(--rust)' }}>never brought to the crew's notice</b></>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Assessment({ a, hazards, briefings, today, open, canWrite, busy, reviewMonths,
                     onOpen, onReview, onBrief, onSaveHazard, onRemoveHazard }) {
  const mine = hazards.filter((h) => h.assessment_id === a.id)
  const told = briefings.filter((b) => b.assessment_id === a.id)
  const st = assessmentState(a, { asOf: today })
  const tone = { overdue: 'var(--rust)', due: 'var(--brass)', undated: 'var(--brass)',
                 superseded: 'var(--mute)', withdrawn: 'var(--mute)' }[st.state]

  return (
    <div className="card" style={{ borderLeft: tone ? `3px solid ${tone}` : '3px solid var(--kelp)' }}>
      <h3 style={{ margin: '0 0 0.3rem', display: 'flex', justifyContent: 'space-between',
                   gap: '1rem', flexWrap: 'wrap' }}>
        <span>{a.ref ? `${a.ref} · ` : ''}{a.title}</span>
        <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>
          {a.area ? `${a.area} · ` : ''}assessed {fmt(a.assessed_on)} by {a.assessed_by}
          {a.review_due ? ` · review ${fmt(a.review_due)}` : ' · no review date'}
        </span>
      </h3>

      <p className="muted" style={{ fontSize: '0.78rem', margin: '0 0 0.4rem' }}>
        {mine.length} hazard{mine.length === 1 ? '' : 's'} ·{' '}
        {told.length
          ? `${told.length} briefed, last ${fmt(told[0].briefed_on)}`
          : <b style={{ color: 'var(--rust)' }}>never brought to the crew's notice</b>}
        {st.state === 'superseded' && <> · <b>reviewed and replaced</b></>}
        {a.withdrawn_on && <> · withdrawn {fmt(a.withdrawn_on)}{a.withdrawn_why ? ` — ${a.withdrawn_why}` : ''}</>}
      </p>

      <button className="secondary" style={{ fontSize: '0.76rem' }}
              onClick={() => onOpen?.(open ? null : a.id)}>
        {open ? 'close' : 'the hazards'}
      </button>

      {open && (
        <>
          {mine.length === 0
            ? <p className="muted" style={{ fontSize: '0.82rem' }}>No hazards written down yet.</p>
            : mine.map((h) => (
                <Hazard key={h.id} h={h} today={today}
                        canWrite={canWrite && st.state !== 'superseded' && !a.withdrawn_on}
                        busy={busy} onRemove={onRemoveHazard}
                        onSave={(x) => onSaveHazard(a.id, x)} />
              ))}

          {/* AN ASSESSMENT WITH NO HAZARDS IN IT IS NOT AN ASSESSMENT, so the
              way to add one lives here rather than behind another click. A
              superseded or withdrawn assessment takes none: it is the record of
              what the crew were briefed on and must not move. */}
          {canWrite && onSaveHazard && st.state !== 'superseded' && !a.withdrawn_on && (
            <HazardForm busy={busy} nextSort={mine.length}
                        onSave={(h) => onSaveHazard(a.id, h)} />
          )}

          {canWrite && st.state !== 'superseded' && !a.withdrawn_on && (
            <div style={{ marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: '1px solid var(--line)',
                          display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {/* A REVIEW MAKES A NEW ASSESSMENT. The old one is left exactly as
                  it stands, because it is what the crew were briefed on. */}
              <button disabled={busy}
                      onClick={() => onReview?.(a, { assessedOn: today, reviewDue: reviewDue(today, reviewMonths) })}>
                Review it — makes a new one, carries the hazards over
              </button>
              <button className="secondary" disabled={busy} onClick={() => onBrief?.(a)}>
                Record that the crew were told
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Hazard({ h, today, canWrite, busy, onRemove, onSave }) {
  const [editing, setEditing] = useState(false)

  /* AN IMPORTED HAZARD IS EDITED IN PLACE, not added again. The eighty read
     off the vessel safety folder came in deliberately unrated, and this is
     where they get their likelihood and severity — so the form has to open
     with what is already there rather than blank. */
  if (editing) {
    return (
      <div style={{ borderTop: '1px solid var(--line)', padding: '0.4rem 0 0.45rem' }}>
        <HazardForm busy={busy} initial={h} startOpen
                    onCancel={() => setEditing(false)}
                    onSave={async (x) => { await onSave({ ...x, id: h.id }); setEditing(false) }} />
      </div>
    )
  }
  const r = rating(h)
  const openAction = String(h.further_action || '').trim() && !h.done_on
  const lateAction = openAction && h.action_due && String(h.action_due).slice(0, 10) < today
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '0.4rem 0 0.45rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ fontSize: '0.86rem', flex: '1 1 14rem' }}>{h.hazard}</b>
        {/* THE RATING IS DERIVED AND NEVER STORED, so the score and its two
            factors cannot drift apart — the same reason the parts ledger has no
            on_hand column. No rating where either factor is missing: a rating
            of nothing is not a rating of nought. */}
        {canWrite && onSave && (
          <button className="secondary" disabled={busy}
                  style={{ fontSize: '0.7rem', padding: '0 0.35rem' }}
                  onClick={() => setEditing(true)}>
            {h.likelihood == null || h.severity == null ? 'rate it' : 'edit'}
          </button>
        )}
        {canWrite && onRemove && (
          <button className="secondary" disabled={busy}
                  style={{ fontSize: '0.7rem', padding: '0 0.35rem' }}
                  onClick={() => { if (window.confirm('Take this hazard off the assessment?')) onRemove(h.id) }}>
            remove
          </button>
        )}
        {r
          ? <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.78rem',
                           color: r.band === 'high' ? 'var(--rust)' : r.band === 'medium' ? 'var(--brass)' : 'var(--kelp)' }}>
              {h.likelihood} × {h.severity} = {r.score} {r.band}
            </span>
          : <span className="muted" style={{ fontSize: '0.76rem' }}>not rated</span>}
      </div>
      {h.who_at_risk && <p className="muted" style={{ margin: 0, fontSize: '0.76rem' }}>Who: {h.who_at_risk}</p>}
      {/* WHAT HAPPENS IF IT IS REALISED. The imported assessments carry this in
          their own words and the app had nowhere to put it — half the document
          would have been dropped on the way in. */}
      {h.consequence && (
        <p className="muted" style={{ margin: 0, fontSize: '0.76rem' }}>What happens: {h.consequence}</p>
      )}
      {/* HIS OWN WORDED LEVEL, shown only while the hazard is unrated — once it
          carries a likelihood and a severity the derived rating is the answer,
          and two levels side by side would be two answers to one question. */}
      {h.source_level && (h.likelihood == null || h.severity == null) && (
        <p className="muted" style={{ margin: 0, fontSize: '0.74rem' }}>
          On the original: <b>{h.source_level}</b> — rate it to replace this.
        </p>
      )}
      {h.controls && <p style={{ margin: 0, fontSize: '0.78rem' }}>{h.controls}</p>}
      {openAction && (
        <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem',
                    color: lateAction ? 'var(--rust)' : 'var(--brass)' }}>
          Still to do: {h.further_action}
          {h.action_by ? ` — ${h.action_by}` : ''}
          {h.action_due ? `, by ${fmt(h.action_due)}${lateAction ? ' (past)' : ''}` : ', no date set'}
        </p>
      )}
      {h.done_on && <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.76rem' }}>
        Action closed {fmt(h.done_on)}.
      </p>}
    </div>
  )
}

/* ==== LIFTING AND WORK EQUIPMENT ========================================== */

export function LiftingBody({
  vessel, equipment = [], examinations = [], canWrite = false, busy = false,
  today = new Date().toISOString().slice(0, 10), onExamine, onOpen, selected,
  onSaveEquipment,
}) {
  const [addingEq, setAddingEq] = useState(false)
  const late = useMemo(() => equipmentOutstanding(equipment, examinations, { asOf: today }),
    [equipment, examinations, today])

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <Fig label="Vessel" value={vessel?.label || 'the fleet'} />
          <Fig label="Items" value={equipment.length || '—'} />
          <Fig label="Wanting attention" value={late.length || 'none'} />
        </div>
        {/* SIX AGAINST TWELVE IS THE THING PEOPLE GET THE WRONG WAY ROUND, so
            it is stated on the page rather than buried in the picker. */}
        <p className="muted" style={{ fontSize: '0.8rem', margin: '0.6rem 0 0' }}>
          LOLER reg 12(2): a thorough examination at least <b>every 6 months</b> for lifting
          equipment used to lift <b>persons</b> and for <b>lifting accessories</b>, and at least{' '}
          <b>every 12 months</b> for other lifting equipment — or to an examination scheme drawn
          up by a competent person. PUWER sets no interval at all, so a PUWER item is only chased
          where this boat has set one. A report may be kept electronically (MGN 332), so this{' '}
          <b>is</b> the record — there is no paper twin to keep in step.
        </p>
      </div>

      {late.length > 0 && (
        <div className="card" style={{ borderLeft: '3px solid var(--brass)' }}>
          <h3 style={{ margin: '0 0 0.4rem' }}>Wanting attention</h3>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem' }}>
            {late.map((x) => (
              <li key={x.equipment.id} style={{ marginBottom: '0.2rem' }}>
                <b>{x.equipment.name}</b>
                {x.equipment.identifier ? ` (${x.equipment.identifier})` : ''} —{' '}
                {/* UNSAFE IS NOT A PAPERWORK GAP. It sorts above everything and
                    is worded as what it is: gear that must not be used. */}
                {x.state === 'unsafe' && <b style={{ color: 'var(--rust)' }}>
                  last report says UNSAFE — it must not be used until it is put right</b>}
                {x.state === 'overdue' && <><b style={{ color: 'var(--rust)' }}>examination {x.days} days overdue</b> (was due {fmt(x.due)})</>}
                {x.state === 'never' && <b>never examined</b>}
                {x.state === 'due' && <>due in {x.days} days, {fmt(x.due)}</>}
                {x.state === 'no-interval' && <>no interval set and none prescribed — PUWER gives none, so it will not be chased until a scheme is set</>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* THE REGISTER HAD NO WAY IN EITHER — `saveEquipment` was exported and
          never called, so a boat with nothing on the register could do nothing
          about it. */}
      {canWrite && onSaveEquipment && (addingEq
        ? <NewEquipment busy={busy} vessel={vessel} today={today}
                        onCancel={() => setAddingEq(false)}
                        onSave={async (e) => { await onSaveEquipment(e); setAddingEq(false) }} />
        : <p style={{ margin: '0 0 0.8rem' }}>
            <button onClick={() => setAddingEq(true)} disabled={busy}>Add an item</button>
          </p>)}

      {equipment.length === 0 ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Nothing on the register yet</h3>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            The gilson, the net drum, the deck crane, every sling, shackle and strop. A lifting
            accessory is examined <b>every six months</b>, the same as anything that lifts a
            person — it is the crane at twelve that is the exception, not the sling at six.
          </p>
        </div>
      ) : equipment.map((e) => (
        <Equipment key={e.id} e={e} examinations={examinations} today={today}
                   open={selected === e.id} canWrite={canWrite} busy={busy}
                   onOpen={onOpen} onExamine={onExamine} />
      ))}
    </div>
  )
}

function Equipment({ e, examinations, today, open, canWrite, busy, onOpen, onExamine }) {
  const st = equipmentState(e, examinations, { asOf: today })
  const mine = examinations.filter((x) => x.equipment_id === e.id)
  const k = kindOf(e.kind)
  const iv = intervalMonths(e)
  const tone = { unsafe: 'var(--rust)', overdue: 'var(--rust)', never: 'var(--brass)',
                 due: 'var(--brass)', 'no-interval': 'var(--brass)',
                 'out-of-service': 'var(--mute)' }[st.state]

  return (
    <div className="card" style={{ borderLeft: tone ? `3px solid ${tone}` : '3px solid var(--kelp)' }}>
      <h3 style={{ margin: '0 0 0.3rem', display: 'flex', justifyContent: 'space-between',
                   gap: '1rem', flexWrap: 'wrap' }}>
        <span>{e.name}{e.identifier ? <span className="muted"> · {e.identifier}</span> : null}</span>
        <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>
          {k?.label}
          {e.swl ? ` · SWL ${e.swl}` : ''}
          {e.location ? ` · ${e.location}` : ''}
        </span>
      </h3>

      <p className="muted" style={{ fontSize: '0.78rem', margin: '0 0 0.3rem' }}>
        {iv.months
          ? <>Examined every <b>{iv.months} months</b>
              {iv.from === 'scheme'
                ? <> under this boat's examination scheme{e.scheme_by ? `, drawn up by ${e.scheme_by}` : ''}</>
                : <> — {iv.reg}</>}
            </>
          : <>No interval: PUWER prescribes none, and none has been set for this item.</>}
        {st.last && <> · last examined {fmt(st.last.examined_on)} by {st.last.competent_person}
          {st.last.organisation ? `, ${st.last.organisation}` : ''}</>}
      </p>

      {/* THE REPORT AND THE STATUTE DISAGREEING IS REPORTED, NEVER RESOLVED —
          the same rule as net + VAT against a printed total. Which of the two
          is wrong is not ours to decide, and the earlier date governs meanwhile. */}
      {st.overrun && (
        <p style={{ margin: '0 0 0.3rem', fontSize: '0.8rem', color: 'var(--brass)' }}>
          The report puts the next examination at <b>{fmt(st.overrun.stated)}</b>, but{' '}
          {iv.reg || 'the scheme'} allows no later than <b>{fmt(st.overrun.latest)}</b>. Worth
          asking the examiner which is right — the earlier of the two is being used here.
        </p>
      )}
      {st.defects && (
        <p style={{ margin: '0 0 0.3rem', fontSize: '0.8rem', color: 'var(--brass)' }}>
          Last report noted defects{st.last?.defects ? `: ${st.last.defects}` : '.'}
        </p>
      )}
      {st.unsafe && (
        <p style={{ margin: '0 0 0.3rem', fontSize: '0.82rem', color: 'var(--rust)' }}>
          <b>The last report says this is unsafe.</b>{st.last?.defects ? ` ${st.last.defects}` : ''}{' '}
          It must not be used until it has been put right and examined again.
        </p>
      )}

      <button className="secondary" style={{ fontSize: '0.76rem' }}
              onClick={() => onOpen?.(open ? null : e.id)}>
        {open ? 'close' : `${mine.length} examination${mine.length === 1 ? '' : 's'}`}
      </button>

      {open && (
        <>
          {mine.length === 0
            ? <p className="muted" style={{ fontSize: '0.82rem' }}>Nothing recorded yet.</p>
            : mine.map((x) => (
                <div key={x.id} style={{ borderTop: '1px solid var(--line)', padding: '0.35rem 0',
                                         fontSize: '0.82rem' }}>
                  <b style={{ fontFamily: 'var(--mono, monospace)' }}>{fmt(x.examined_on)}</b>
                  {' '}{x.kind} · {x.competent_person}{x.organisation ? `, ${x.organisation}` : ''}
                  {' · '}<span style={{ color: x.result === 'unsafe' ? 'var(--rust)'
                    : x.result === 'defects' ? 'var(--brass)' : 'var(--kelp)' }}>{x.result}</span>
                  {x.next_due ? <span className="muted"> · next {fmt(x.next_due)}</span> : null}
                  {x.report_ref ? <span className="muted"> · {x.report_ref}</span> : null}
                  {x.defects && <p style={{ margin: 0, fontSize: '0.78rem' }}>{x.defects}</p>}
                </div>
              ))}
          {canWrite && !e.out_of_service_on && (
            <button style={{ marginTop: '0.5rem' }} disabled={busy} onClick={() => onExamine?.(e)}>
              Record an examination
            </button>
          )}
        </>
      )}
    </div>
  )
}

/* Exported so scripts/safety-preview.mjs can render them OPEN. They only appear
   on a click otherwise, and a form nobody has rendered is where an undefined
   identifier hides — the fault this whole section exists because of.
 */

/* ==== THE FORMS ==========================================================
 *
 * These are why both pages existed and could not be used. `safetyDb.js` has
 * exported `saveAssessment`, `saveHazard`, `removeHazard` and `saveEquipment`
 * since the day it was written; `RiskBody` even destructured `onSave` and used
 * it nowhere, and neither page ever passed it. So the whole feature shipped
 * read-only, with an empty state and no button on it.
 *
 * Same shape as `VesselProvider` imported and never rendered, and as
 * `loadLatestWorksheet` exported and called by nothing at all. Three in one
 * codebase: WRITING THE FUNCTION IS NOT THE JOB.
 */

function Row({ label, children, wide }) {
  return (
    <label style={{ display: 'block', gridColumn: wide ? '1 / -1' : undefined }}>
      <span className="muted" style={{ display: 'block', fontSize: '0.68rem',
                                       textTransform: 'uppercase', letterSpacing: '0.08em',
                                       marginBottom: 2 }}>{label}</span>
      {children}
    </label>
  )
}

const FORM_GRID = {
  display: 'grid', gap: '0.6rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', alignItems: 'end',
}

export function NewAssessment({ today, reviewMonths, busy, vessel, onSave, onCancel }) {
  const [f, setF] = useState({
    title: '', area: '', ref: '', assessedOn: today, assessedBy: '',
    reviewDue: reviewDue(today, reviewMonths), notes: '',
  })
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))

  /* THE DATE DRIVES THE REVIEW DATE until somebody types over it — and only
     while it still matches, so a review date entered by hand is never quietly
     overwritten. Left independent, an assessment ends up with no review date
     at all, which `assessmentGaps` correctly reports as "nothing is chasing
     it" but which nobody sets out to create. */
  const setAssessed = (e) => setF((p) => ({
    ...p,
    assessedOn: e.target.value,
    reviewDue: p.reviewDue === reviewDue(p.assessedOn, reviewMonths)
      ? reviewDue(e.target.value, reviewMonths)
      : p.reviewDue,
  }))

  const ready = f.title.trim() && f.assessedOn && f.assessedBy.trim()

  return (
    <div className="card" style={{ borderLeft: '3px solid var(--hull)' }}>
      <h3 style={{ marginTop: 0 }}>New assessment</h3>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
        An assessment is about a JOB, not a boat — shooting and hauling, the engine room,
        handling the catch.{vessel?.label ? ' It will be filed against ' + vessel.label + '.' : ''}
      </p>
      <div style={FORM_GRID}>
        <Row label="What is being assessed">
          <input value={f.title} onChange={set('title')} placeholder="Shooting and hauling" />
        </Row>
        <Row label="Area or activity">
          <input value={f.area} onChange={set('area')} placeholder="Deck" />
        </Row>
        <Row label="Your own reference">
          <input value={f.ref} onChange={set('ref')} placeholder="optional" />
        </Row>
        <Row label="Assessed on">
          <input type="date" value={f.assessedOn} onChange={setAssessed} />
        </Row>
        <Row label="Assessed by">
          <input value={f.assessedBy} onChange={set('assessedBy')} placeholder="name" />
        </Row>
        <Row label="Review due">
          <input type="date" value={f.reviewDue} onChange={set('reviewDue')} />
        </Row>
        <Row label="Notes" wide>
          <input value={f.notes} onChange={set('notes')} />
        </Row>
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.8rem' }}>
        <button disabled={!ready || busy}
                onClick={() => onSave({ ...f, vesselId: vessel?.id || null })}>
          Save it
        </button>
        <button className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      {!ready && (
        <p className="muted" style={{ fontSize: '0.76rem', margin: '0.5rem 0 0' }}>
          It needs what is being assessed, the date, and who did it — an assessment
          nobody signed is not evidence of anything.
        </p>
      )}
    </div>
  )
}

export function HazardForm({ busy, nextSort, onSave, initial, startOpen, onCancel }) {
  const blank = {
    hazard: '', whoAtRisk: '', controls: '', likelihood: '', severity: '',
    furtherAction: '', actionBy: '', actionDue: '',
  }
  /* `?? ''` and not `|| ''`: a likelihood of 0 is not a thing, but the habit
     of reaching for `||` is how a real 0 becomes blank elsewhere. */
  const from = (h) => ({
    hazard: h.hazard ?? '', whoAtRisk: h.who_at_risk ?? '', controls: h.controls ?? '',
    consequence: h.consequence ?? '', sourceLevel: h.source_level ?? '',
    likelihood: h.likelihood ?? '', severity: h.severity ?? '',
    furtherAction: h.further_action ?? '', actionBy: h.action_by ?? '',
    actionDue: h.action_due ? String(h.action_due).slice(0, 10) : '',
  })
  const [f, setF] = useState(initial ? from(initial) : blank)
  const [open, setOpen] = useState(!!startOpen)
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))

  if (!open) {
    return (
      <p style={{ margin: '0.6rem 0 0' }}>
        <button className="secondary" style={{ fontSize: '0.78rem' }}
                onClick={() => setOpen(true)} disabled={busy}>Add a hazard</button>
      </p>
    )
  }

  return (
    <div style={{ borderTop: '1px solid var(--line)', marginTop: '0.6rem', paddingTop: '0.6rem' }}>
      <div style={FORM_GRID}>
        <Row label="The hazard" wide>
          <input value={f.hazard} onChange={set('hazard')}
                 placeholder="Crew caught in gear and pulled onto the net drum" />
        </Row>
        <Row label="Who is at risk">
          <input value={f.whoAtRisk} onChange={set('whoAtRisk')} />
        </Row>
        <Row label="Controls in place" wide>
          <input value={f.controls} onChange={set('controls')} />
        </Row>
        {/* BLANK STAYS BLANK. `Number('') === 0` has bitten this repo six times,
            and `rating()` gives no rating at all where either factor is missing —
            which is right, because a rating of nothing is not a rating of nought. */}
        <Row label="Likelihood 1-5">
          <input type="number" min="1" max="5" value={f.likelihood} onChange={set('likelihood')} />
        </Row>
        <Row label="Severity 1-5">
          <input type="number" min="1" max="5" value={f.severity} onChange={set('severity')} />
        </Row>
        <Row label="Further action" wide>
          <input value={f.furtherAction} onChange={set('furtherAction')}
                 placeholder="only where the controls are not enough yet" />
        </Row>
        <Row label="Action by">
          <input value={f.actionBy} onChange={set('actionBy')} />
        </Row>
        <Row label="Action due">
          <input type="date" value={f.actionDue} onChange={set('actionDue')} />
        </Row>
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.7rem' }}>
        <button disabled={!f.hazard.trim() || busy}
                onClick={async () => {
                  await onSave(initial ? f : { ...f, sort: nextSort })
                  if (!initial) setF(blank)
                }}>
          {initial ? 'Save it' : 'Add it'}
        </button>
        <button className="secondary" disabled={busy}
                onClick={() => { if (onCancel) { onCancel() } else { setF(blank); setOpen(false) } }}>
          {onCancel ? 'Cancel' : 'Done'}
        </button>
      </div>
    </div>
  )
}

export function NewEquipment({ busy, vessel, today, onSave, onCancel }) {
  const [f, setF] = useState({
    name: '', kind: 'loler_accessory', identifier: '', swl: '', location: '',
    inServiceOn: today, schemeMonths: '', schemeBy: '', notes: '',
  })
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const k = kindOf(f.kind)

  return (
    <div className="card" style={{ borderLeft: '3px solid var(--hull)' }}>
      <h3 style={{ marginTop: 0 }}>Add an item</h3>
      <div style={FORM_GRID}>
        <Row label="What it is">
          <input value={f.name} onChange={set('name')} placeholder="Gilson block" />
        </Row>
        {/* THE KIND SETS THE INTERVAL, and it is the thing most often got wrong:
            a sling is six months, the same as anything that lifts a person, and
            it is the crane at twelve that is the exception. */}
        <Row label="Kind">
          <select value={f.kind} onChange={set('kind')}>
            {KINDS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </Row>
        <Row label="Serial or mark">
          <input value={f.identifier} onChange={set('identifier')} />
        </Row>
        <Row label="Safe working load">
          <input value={f.swl} onChange={set('swl')} placeholder="2 t" />
        </Row>
        <Row label="Where it is">
          <input value={f.location} onChange={set('location')} />
        </Row>
        <Row label="In service from">
          <input type="date" value={f.inServiceOn} onChange={set('inServiceOn')} />
        </Row>
        <Row label="Scheme months">
          <input type="number" min="1" value={f.schemeMonths} onChange={set('schemeMonths')}
                 placeholder="only if a scheme is drawn up" />
        </Row>
        <Row label="Scheme drawn by">
          <input value={f.schemeBy} onChange={set('schemeBy')} />
        </Row>
        <Row label="Notes" wide>
          <input value={f.notes} onChange={set('notes')} />
        </Row>
      </div>
      <p className="muted" style={{ fontSize: '0.78rem', margin: '0.6rem 0 0' }}>
        {k && k.months
          ? 'Examined every ' + k.months + ' months — ' + k.reg + ' — unless the scheme above says otherwise.'
          : 'PUWER sets no interval at all. Nothing will chase this item unless you give it scheme months.'}
      </p>
      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.7rem' }}>
        <button disabled={!f.name.trim() || busy}
                onClick={() => onSave({ ...f, vesselId: vessel?.id || null })}>Save it</button>
        <button className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}


function Fig({ label, value }) {
  return (
    <span>
      <span className="muted" style={{ fontSize: '0.72rem', display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <b style={{ fontSize: '1rem' }}>{value}</b>
    </span>
  )
}

export { KINDS }
const fmt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—')
