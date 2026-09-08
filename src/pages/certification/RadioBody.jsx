import React, { useMemo, useState } from 'react'
import {
  KINDS, kindOf, radioPart, requiredKinds, offeredKinds,
  unsignedDays, positionGaps, entriesByDay, signatureFor, beyondSchedule,
} from '../../lib/certification/radio'

/* THE RADIO LOG, drawn. SI 1999/3210, Schedule 3.
 *
 * Prop-driven and a file of its own so it can be server-rendered — the page is
 * behind a login, and a build passing proves nothing about a component.
 */
export default function RadioBody({
  vessel, part, entries = [], days = [], canSign = false, canWrite = false, busy = false,
  today = new Date().toISOString().slice(0, 10),
  onAdd, onSign,
}) {
  /* WHICH PART APPLIES IS THE WHOLE PAGE. Guessing it would tell a skipper he
     need only log distress traffic when he owes urgency, safety, incidents and
     a daily position — so where the record cannot settle it, the log is not
     drawn at all. The same refusal as the self-certification band, and the
     same 24 m figure deciding it. */
  if (!part?.part) {
    return (
      <div className="card" style={{ borderLeft: '3px solid var(--rust)' }}>
        <h3 style={{ marginTop: 0 }}>Which radio log {vessel?.label || 'this vessel'} keeps cannot be worked out</h3>
        <p className="muted" style={{ marginBottom: '0.4rem' }}>
          SI 1999/3210 asks a <b>Directive</b> fishing vessel — a new one of <b>24 m or more</b>,
          or an existing one of <b>45 m or more</b> — to keep the full GMDSS Radio Log under
          Schedule 3 Part I. Everything else keeps the Simplified FV GMDSS Radio Log, which is
          distress traffic and nothing else.
        </p>
        <p>
          Here, {part?.why}. The length the regulations use is a <b>rule length</b> — about 96% of
          the total length on a waterline at 85% of the least moulded depth — which is near the
          registered length and nothing like the length overall. Both are on the Vessel page, and
          taking the wrong one would hand her the wrong book.
        </p>
      </div>
    )
  }

  const byDay = useMemo(() => entriesByDay(entries), [entries])
  const unsigned = useMemo(() => unsignedDays(entries, days), [entries, days])
  const noPosition = useMemo(() => positionGaps(entries, part.part), [entries, part.part])
  const extra = useMemo(() => beyondSchedule(entries, part.part), [entries, part.part])
  const need = requiredKinds(part.part)
  const dates = [...byDay.keys()].sort((a, b) => b.localeCompare(a))

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <Fig label="Vessel" value={vessel?.label || '—'} />
          <Fig label="Log" value={part.part === 'I' ? 'GMDSS Radio Log' : 'Simplified FV GMDSS'} />
          <Fig label="Schedule 3" value={`Part ${part.part}`} />
          <Fig label="Days written" value={dates.length || '—'} />
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', margin: '0.6rem 0 0' }}>
          She is <b>{part.rl} m</b> registered and built <b>{part.built}</b>, so she is{' '}
          {part.directive ? 'a Directive vessel' : <>not a Directive vessel — the threshold for
            {part.isNew ? ' a new one' : ' an existing one'} is {part.threshold} m</>}, and{' '}
          {part.reg} applies. Schedule 3 Part {part.part} asks for{' '}
          <b>{need.map((k) => k.label.toLowerCase()).join(', ')}</b>
          {part.part === 'II' && <> — and nothing else</>}. The skipper{' '}
          <b>inspects and signs each day's entries</b>.
        </p>
      </div>

      <Outstanding unsigned={unsigned} noPosition={noPosition} part={part} canSign={canSign} onSign={onSign} />

      {canWrite && <AddForm part={part} today={today} busy={busy} onAdd={onAdd} />}

      {extra.length > 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
            {/* MORE THAN THE MINIMUM IS NOT A FAULT. A skipper on the simplified
                log who writes down a safety broadcast has done something useful;
                what would be wrong is the app implying the Schedule demanded it. */}
            {extra.length} {extra.length === 1 ? 'entry goes' : 'entries go'} beyond what Schedule 3
            Part {part.part} asks of her. That is not a fault — it is worth keeping, and it is kept.
          </p>
        </div>
      )}

      {dates.length === 0 ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Nothing logged yet</h3>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            {part.part === 'II'
              ? 'Only distress traffic has to go in this one — a summary of the communications she took part in, and the times they happened.'
              : 'Distress, urgency and safety traffic, anything important that happened to the radio, and her position at least once a day.'}
          </p>
        </div>
      ) : dates.map((d) => (
        <Day key={d} date={d} entries={byDay.get(d)} signature={signatureFor(d, days)}
             part={part} canSign={canSign} busy={busy} onSign={onSign} />
      ))}
    </div>
  )
}

function Outstanding({ unsigned, noPosition, part, canSign, onSign }) {
  if (!unsigned.length && !noPosition.length) return null
  return (
    <div className="card" style={{ borderLeft: '3px solid var(--brass)' }}>
      <h3 style={{ margin: '0 0 0.4rem' }}>Outstanding</h3>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem' }}>
        {unsigned.length > 0 && (
          <li>
            <b>{unsigned.length} {unsigned.length === 1 ? 'day' : 'days'} not signed by the
            skipper</b> — {unsigned.slice(0, 8).map((u) => fmt(u.date)).join(', ')}
            {unsigned.length > 8 ? ` and ${unsigned.length - 8} more` : ''}.
            {' '}{part.reg}: he inspects and signs each day's entries.
            {!canSign && ' Only he can — the mate keeping the log does not stand in for him here.'}
            {/* A DAY WITH NO ENTRIES NEEDS NO SIGNATURE, and is not listed. The
                duty is to sign "each day's ENTRIES"; where there are none there
                is nothing to attest, and chasing every quiet day is how a
                warning stops being read. */}
          </li>
        )}
        {noPosition.length > 0 && (
          <li>
            <b>{noPosition.length} {noPosition.length === 1 ? 'day has' : 'days have'} no
            position</b> — {noPosition.slice(0, 8).map(fmt).join(', ')}
            {noPosition.length > 8 ? ` and ${noPosition.length - 8} more` : ''}. Schedule 3 Part I
            asks for her position at least once a day. Nothing has been filled in for them.
          </li>
        )}
      </ul>
    </div>
  )
}

function Day({ date, entries, signature, part, canSign, busy, onSign }) {
  const signed = !!signature
  return (
    <div className="card" style={{ borderLeft: signed ? '3px solid var(--kelp)' : '3px solid var(--brass)' }}>
      <h3 style={{ margin: '0 0 0.4rem', display: 'flex', justifyContent: 'space-between',
                   gap: '1rem', flexWrap: 'wrap' }}>
        <span>{fmt(date)}</span>
        <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          {signed
            ? ` · signed by ${signature.signed_name}`
            : ' · not yet signed'}
        </span>
      </h3>

      {entries.map((e) => {
        const k = kindOf(e.kind)
        const beyond = k && part.part && !k.parts.includes(part.part)
        return (
          <div key={e.id} style={{ borderTop: '1px solid var(--line)', padding: '0.4rem 0' }}>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
              {/* THE TIME IS PART OF THE DUTY. Schedule 3 asks for "the time
                  such communications occurred" in every one of its limbs. */}
              <b style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.82rem' }}>
                {e.occurred_at ? String(e.occurred_at).slice(0, 5) : '--:--'}
              </b>
              <span style={{ fontSize: '0.78rem', color: e.kind === 'distress' ? 'var(--rust)' : undefined }}>
                {k?.label || e.kind}
              </span>
              <span style={{ flex: '1 1 16rem', fontSize: '0.86rem' }}>{e.summary}</span>
              {e.station && <span className="muted" style={{ fontSize: '0.76rem' }}>{e.station}</span>}
            </div>
            {e.position_text && <p className="muted" style={{ margin: 0, fontSize: '0.76rem' }}>{e.position_text}</p>}
            {beyond && (
              <p className="muted" style={{ margin: 0, fontSize: '0.74rem' }}>
                Beyond what Part {part.part} asks for — kept anyway.
              </p>
            )}
            {e.corrects_entry_id && (
              <p style={{ margin: 0, fontSize: '0.76rem' }}>Made to correct an earlier entry.</p>
            )}
          </div>
        )
      })}

      {!signed && (
        <div style={{ marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: '1px solid var(--line)' }}>
          <p className="muted" style={{ fontSize: '0.78rem', margin: '0 0 0.3rem' }}>
            {/* SIGNING CLOSES THE DAY. His signature attests these entries, so
                nothing may be added to or changed on the day afterwards — which
                is a rule that follows from the duty rather than one imported
                from the Official Log Book. */}
            Signing attests these entries. Nothing can be added to this day or changed on it
            afterwards.
          </p>
          <button disabled={!canSign || busy} onClick={() => onSign?.(date)}>
            {canSign ? `Sign ${fmt(date)} as skipper` : 'Only the skipper signs the day'}
          </button>
        </div>
      )}
    </div>
  )
}

function AddForm({ part, today, busy, onAdd }) {
  const offered = offeredKinds(part.part)
  const [f, setF] = useState({ logDate: today, kind: offered[0]?.key || 'distress' })
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const k = kindOf(f.kind)
  const ready = f.logDate && String(f.summary || '').trim().length > 2

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Log something</h3>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Date"><input type="date" value={f.logDate || ''} onChange={set('logDate')} /></Field>
        <Field label="Time"><input type="time" value={f.occurredAt || ''} onChange={set('occurredAt')} /></Field>
        <Field label="What">
          <select value={f.kind} onChange={set('kind')}>
            {offered.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </Field>
        <Field label="Station / MMSI"><input value={f.station || ''} onChange={set('station')} /></Field>
      </div>
      {k?.note && <p className="muted" style={{ fontSize: '0.78rem', margin: '0.35rem 0' }}>{k.note}</p>}
      <Field label="Summary" wide>
        <input value={f.summary || ''} onChange={set('summary')} style={{ width: '100%' }} />
      </Field>
      {f.kind === 'position' && (
        <Field label="Position" wide>
          <input value={f.position || ''} onChange={set('position')} style={{ width: '100%' }}
                 placeholder="57 30.2N 001 46.8W" />
        </Field>
      )}
      <p className="muted" style={{ fontSize: '0.78rem' }}>
        It can be corrected until the skipper signs that day. After that it is what he signed.
      </p>
      <button disabled={!ready || busy} onClick={() => onAdd?.(f)}>
        {ready ? 'Log it' : 'A date and a summary are needed'}
      </button>
    </div>
  )
}

function Field({ label, children, wide }) {
  return (
    <label style={{ display: 'block', flex: wide ? '1 1 100%' : undefined, marginTop: wide ? '0.4rem' : 0 }}>
      <span className="muted" style={{ fontSize: '0.72rem', display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      {children}
    </label>
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

export { KINDS, radioPart }
const fmt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—')
