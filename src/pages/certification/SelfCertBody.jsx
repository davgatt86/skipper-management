import React from 'react'
import {
  SECTIONS, EVIDENCE, allItems, progress, blockers, contradictions, isAnswered,
} from '../../lib/certification/selfCert'

/* THE ANNUAL SELF-CERTIFICATION, drawn.
 *
 * A FILE OF ITS OWN, and prop-driven, for the same reason as `Review.jsx` and
 * `SheetBody`: the page is behind a login and a fleet, so the only way to check
 * what it actually renders is to server-render it. Everything it needs arrives
 * as props — it opens no supabase client and reads no context.
 *
 * NOTHING IS EVER PRE-ANSWERED. The app knows whether the liferaft service is in
 * date; it does not know the condition of the freeing ports, and it must not
 * look as though it does. Every one of the 148 is answered by a person.
 */

const STATES = [
  { k: 'yes', label: 'Complied', tone: 'var(--kelp)' },
  { k: 'no', label: 'Not complied', tone: 'var(--rust)' },
  { k: 'na', label: 'Not applicable', tone: 'var(--brass)' },
]

export default function SelfCertBody({
  form, vessel, band, cert, answers = {}, evidence = {}, canSign = false,
  onAnswer, onClear, onNote, onSign, busy = false,
}) {
  /* WRONG BAND IS A FULL STOP, not a warning above a form. This checklist is
     the MCA's own list for 15 m LOA to under 24 m RL. Showing it to a 25 m boat
     would have her certified against the wrong code, and four centimetres is
     all that separates the two. */
  if (band?.band !== '15to24') {
    return (
      <div className="card" style={{ borderLeft: '3px solid var(--rust)' }}>
        <h3 style={{ marginTop: 0 }}>This checklist does not apply to {vessel?.label || 'this vessel'}</h3>
        <p className="muted" style={{ marginBottom: '0.4rem' }}>
          {form.code} is the MCA's aide memoire for fishing vessels of <b>15 m length overall to
          under 24 m registered length</b>.
        </p>
        {band?.why
          ? <p>The vessel's particulars do not say which band she is in — {band.why}. Registered
              length is on the Vessel page, and it is the figure that decides which code applies:
              it is not length overall, and the two are far apart.</p>
          : <p>She is recorded at <b>{fmt(band.rl)} m registered length</b>
              {band.loa ? <> and {fmt(band.loa)} m overall</> : null}, which puts her
              {band.band === '24plus'
                ? ' in the 24 m RL and over band — an International Fishing Vessel Certificate, an annual class or MCA survey, and an intermediate survey at the second anniversary.'
                : ' under 15 m LOA, which is a different code again.'}
            </p>}
      </div>
    )
  }

  const prog = progress(answers)
  const stops = blockers(answers)
  const clashes = contradictions(answers, evidence)
  const signed = !!cert?.completed_at

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <Fig label="Vessel" value={vessel?.label || '—'} />
          <Fig label="Certificate year" value={cert?.period || '—'} />
          <Fig label="Answered" value={`${prog.done} of ${prog.total}`} />
          <Fig label="Worked from" value={`${cert?.form_code || form.code} rev ${cert?.form_revision || form.revision}`} />
        </div>
        {/* THE LIST IS DATED. "The vessel complied" means nothing without the
            list it complied with, and the MCA revises this form. */}
        <p className="muted" style={{ fontSize: '0.8rem', margin: '0.6rem 0 0' }}>
          {form.title}, based on {form.basis.join(' and ')}. This is the working paper behind the
          annual self-certificate — it is not the MCA's form and should not be sent in place of one.
        </p>
      </div>

      {signed && (
        <div className="card" style={{ borderLeft: '3px solid var(--kelp)' }}>
          <b>Signed off {fmtDate(cert.completed_at)}</b>
          {cert.declared_name ? <> by {cert.declared_name}</> : null}. Answers are locked.
        </div>
      )}

      {/* WHAT THE RECORD DISAGREES WITH, and it never changes an answer.
          The skipper may have the paper in his hand and the app may simply not
          have been told; software that overruled him would be wrong more often
          than he is. */}
      {clashes.length > 0 && (
        <div className="card" style={{ borderLeft: '3px solid var(--brass)' }}>
          <h3 style={{ margin: '0 0 0.3rem' }}>
            {clashes.length === 1 ? 'One answer the record disagrees with' : `${clashes.length} answers the record disagrees with`}
          </h3>
          <p className="muted" style={{ fontSize: '0.82rem', marginTop: 0 }}>
            Marked complied, but this app's own record says otherwise. It does not stop you signing —
            you may be holding a certificate the app has never been told about — but it is worth
            knowing before you do.
          </p>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {clashes.map((c) => (
              <li key={c.n} style={{ fontSize: '0.85rem', marginBottom: '0.2rem' }}>
                <b>{c.n}.</b> {c.text} — <span style={{ color: 'var(--rust)' }}>{c.says}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!signed && <Outstanding stops={stops} />}

      {SECTIONS.map((s) => {
        const p = prog.bySection.find((x) => x.key === s.key)
        return (
          <div className="card" key={s.key}>
            <h3 style={{ margin: '0 0 0.5rem', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
              <span>{s.title}</span>
              <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>
                {p.done} of {p.total}
              </span>
            </h3>
            {s.items.map((it) => (
              <Item
                key={it.n} item={it} answer={answers[it.n]} evidence={evidence[it.n]}
                locked={signed || busy}
                onAnswer={(state) => onAnswer?.(it.n, state)}
                onClear={() => onClear?.(it.n)}
                onNote={(note) => onNote?.(it.n, note)}
              />
            ))}
          </div>
        )
      })}

      {!signed && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Sign off</h3>
          {!canSign && (
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              A self-certification is a declaration about the vessel by the person answerable for
              her, so only the skipper can sign it. You can work through the checks and they will be
              kept as you go.
            </p>
          )}
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Signing records who declared it and when, and locks every answer.
          </p>
          <button disabled={!canSign || !stops.ok || busy} onClick={onSign}>
            {stops.ok ? 'Sign off the self-certification' : 'Not ready to sign'}
          </button>
        </div>
      )}
    </div>
  )
}

/* THREE DIFFERENT FACTS, NOT ONE COUNT. "37 outstanding" sends nobody anywhere;
   what stops a sign-off is either that nobody has been there, or that something
   is not complied with, or that a "not applicable" carries no reason. */
function Outstanding({ stops }) {
  if (stops.ok) {
    return (
      <div className="card" style={{ borderLeft: '3px solid var(--kelp)' }}>
        Every check answered, nothing outstanding, and every "not applicable" says why.
      </div>
    )
  }
  return (
    <div className="card" style={{ borderLeft: '3px solid var(--brass)' }}>
      <h3 style={{ margin: '0 0 0.4rem' }}>Before this can be signed</h3>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem' }}>
        {stops.notComplied.length > 0 && (
          <li style={{ color: 'var(--rust)' }}>
            <b>{stops.notComplied.length} not complied with</b> — {list(stops.notComplied)}. A
            self-certificate is a statement of compliance, so these have to be put right rather
            than signed around.
          </li>
        )}
        {stops.unanswered.length > 0 && (
          <li><b>{stops.unanswered.length} not answered yet</b> — {list(stops.unanswered)}.</li>
        )}
        {stops.naNoReason.length > 0 && (
          <li>
            <b>{stops.naNoReason.length} marked not applicable with no reason</b> — {list(stops.naNoReason)}.
            A year from now nobody can tell a considered exemption from a shrug.
          </li>
        )}
      </ul>
    </div>
  )
}

function Item({ item, answer, evidence, locked, onAnswer, onClear, onNote }) {
  const state = answer?.state
  const tone = STATES.find((s) => s.k === state)?.tone
  return (
    <div style={{
      borderTop: '1px solid var(--line)', padding: '0.5rem 0 0.6rem',
      borderLeft: tone ? `3px solid ${tone}` : '3px solid transparent', paddingLeft: '0.5rem',
    }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontFamily: 'var(--mono, monospace)', minWidth: '2.2rem' }}>{item.n}</span>
        <span style={{ flex: '1 1 22rem', fontSize: '0.88rem' }}>{item.text}</span>
        <span style={{ display: 'flex', gap: '0.3rem' }}>
          {STATES.map((s) => (
            <button
              key={s.k} disabled={locked}
              onClick={() => (state === s.k ? onClear() : onAnswer(s.k))}
              style={{
                fontSize: '0.75rem', padding: '0.15rem 0.5rem',
                borderColor: state === s.k ? s.tone : undefined,
                background: state === s.k ? s.tone : undefined,
                color: state === s.k ? '#fff' : undefined,
              }}
            >{s.label}</button>
          ))}
        </span>
      </div>

      {/* WHAT THE APP HOLDS, where it holds anything. It informs the item; it
          never answers it. `unknown` says so rather than staying quiet, because
          silence would read as "nothing wrong". */}
      {EVIDENCE[item.n] && (
        <p style={{ margin: '0.25rem 0 0 2.7rem', fontSize: '0.78rem' }}
           className={evidence?.state === 'attention' ? undefined : 'muted'}>
          <span style={{ color: evidence?.state === 'attention' ? 'var(--rust)' : undefined }}>
            {EVIDENCE[item.n].label}: {evidence?.detail || 'nothing on file in this app'}
          </span>
        </p>
      )}

      {(state === 'na' || state === 'no' || answer?.note) && (
        <input
          type="text" disabled={locked} defaultValue={answer?.note || ''}
          onBlur={(e) => onNote(e.target.value)}
          placeholder={state === 'na' ? 'Why does this not apply? (required)' : 'Note'}
          style={{
            margin: '0.3rem 0 0 2.7rem', width: 'calc(100% - 3rem)', fontSize: '0.8rem',
            borderColor: state === 'na' && !answer?.note ? 'var(--brass)' : undefined,
          }}
        />
      )}
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

const fmt = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : '—')
const fmtDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—')
/* Names them rather than counting them, up to a point — a list of 148 numbers
   is no more use than the number 148. */
const list = (items) => {
  const ns = items.map((i) => i.n)
  return ns.length <= 12 ? `no. ${ns.join(', ')}` : `no. ${ns.slice(0, 12).join(', ')} and ${ns.length - 12} more`
}
