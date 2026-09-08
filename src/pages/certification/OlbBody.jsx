import React, { useMemo, useState } from 'react'
import {
  OLB_ENTRIES, entryOf, entryProblems, overdue, correctionsOf, openBook as openOf,
  DEFAULT_INTERVALS,
} from '../../lib/certification/olb'

/* THE OFFICIAL LOG BOOK, drawn.
 *
 * Prop-driven and a file of its own so it can be server-rendered — the page is
 * behind a login, and a build passing proves nothing about a component.
 *
 * WHAT THIS PAGE MUST NEVER DO is offer to change an entry. There is no edit
 * button and no delete button below, and the database refuses both. Reg 9 of
 * SI 1981/570 allows one remedy only: a further entry that refers to the first
 * and amends or cancels it.
 */

export default function OlbBody({
  vessel, required, books = [], entries = [], canOpen = false, busy = false,
  today = new Date().toISOString().slice(0, 10), intervals = DEFAULT_INTERVALS,
  onOpenBook, onCloseBook, onDeliver, onAddEntry, onCorrect,
}) {
  /* NOT REQUIRED IS NOT THE SAME AS UNKNOWN, and neither hides the book — a
     boat under 55 feet may keep one anyway. What changes is what is claimed. */
  if (required?.required === false) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>No official log book is required for {vessel?.label || 'this vessel'}</h3>
        <p className="muted">
          The Merchant Shipping (Official Log Books) (Fishing Vessels) Regulations 1981 do not
          apply to a fishing vessel under 55 feet. She is recorded at <b>{required.metres} m</b>,
          about {required.feet} feet. One may still be kept voluntarily.
        </p>
      </div>
    )
  }

  const book = useMemo(() => openOf(books), [books])
  const byBook = useMemo(() => {
    const m = new Map()
    for (const e of entries) {
      if (!m.has(e.book_id)) m.set(e.book_id, [])
      m.get(e.book_id).push(e)
    }
    return m
  }, [entries])
  const corrections = useMemo(() => correctionsOf(entries), [entries])
  const late = useMemo(() => overdue(entries, { asOf: today, intervals }), [entries, today, intervals])

  return (
    <div>
      <Standing required={required} />

      <div className="card">
        <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <Fig label="Vessel" value={vessel?.label || '—'} />
          <Fig label="Books" value={books.length || '—'} />
          <Fig label="Entries" value={entries.length || '—'} />
          <Fig label="Open book" value={book ? (book.book_no || `opened ${fmt(book.opened_on)}`) : 'none'} />
        </div>
      </div>

      <Outstanding late={late} entries={entries} book={book} />

      {book ? (
        <Book book={book} entries={byBook.get(book.id) || []} corrections={corrections}
              canOpen={canOpen} busy={busy} onClose={onCloseBook} onDeliver={onDeliver}
              onCorrect={onCorrect} />
      ) : (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>No book open</h3>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Entries 1, 2, 3 and 5 are what opening a book records — the vessel, her owner, the
            skipper and his certificate, and the date and place. If the boat already keeps this
            book on paper, give it the same number so the two agree about which book a surveyor
            is being shown.
          </p>
          {canOpen
            ? <OpenForm busy={busy} today={today} onOpen={onOpenBook} />
            : <p className="muted" style={{ fontSize: '0.85rem' }}>
                Only the skipper opens a book — entries 1 to 3, 5 and 6 are all signed by him.
              </p>}
        </div>
      )}

      {book && <EntryForm book={book} busy={busy} today={today} onAdd={onAddEntry} />}

      {books.filter((b) => b.id !== book?.id).map((b) => (
        <Book key={b.id} book={b} entries={byBook.get(b.id) || []} corrections={corrections}
              canOpen={canOpen} busy={busy} onClose={onCloseBook} onDeliver={onDeliver}
              onCorrect={onCorrect} />
      ))}
    </div>
  )
}

/* ---- THE STANDING WARNING ------------------------------------------------
 * MGN 690 is the electronic record book route and it is narrower than it
 * looks: it covers the SOLAS V/Reg 28 deck logbook and says in terms that
 * "the requirement to maintain other logbooks such as the Official Logbook
 * shall be in accordance with their applicable legislation". There is no
 * approval route for this book today.
 *
 * An app that quietly let a skipper believe otherwise would be worse than one
 * that had never offered the feature: he would stop writing the paper book,
 * and the paper book is the one the superintendent takes.
 */
function Standing({ required }) {
  return (
    <div className="card" style={{ borderLeft: '3px solid var(--brass)' }}>
      <h3 style={{ margin: '0 0 0.3rem' }}>The paper book is still the record</h3>
      <p style={{ margin: 0, fontSize: '0.86rem' }}>
        This keeps the same entries in the same shape as the official log book, and shows what has
        not been written down — but there is no approved electronic version of it. MGN 690 covers
        the SOLAS V deck logbook only, and says the requirement to maintain other logbooks such as
        the Official Logbook stands under their own legislation. <b>Keep writing the paper book</b>;
        it is what gets signed, and it is what is delivered to the superintendent.
      </p>
      {required?.required === null && (
        <p className="muted" style={{ fontSize: '0.82rem', marginBottom: 0 }}>
          Whether she needs one at all cannot be worked out either — {required.why}. 55 feet is the
          line, and length overall is on the Vessel page.
        </p>
      )}
    </div>
  )
}

/* WHAT HAS NOT BEEN WRITTEN DOWN, and what is written down badly. Two
   different lists because they are put right by different people: an overdue
   drill is the skipper's to hold, an unwitnessed entry is a signature to find. */
function Outstanding({ late, entries, book }) {
  const faulty = entries
    .map((e) => ({ entry: e, problems: entryProblems(e, book) }))
    .filter((x) => x.problems.length)

  if (!late.length && !faulty.length) {
    return entries.length
      ? <div className="card" style={{ borderLeft: '3px solid var(--kelp)' }}>
          Every recurring entry is up to date, and every entry made is signed and witnessed as the
          Schedule requires.
        </div>
      : null
  }

  return (
    <div className="card" style={{ borderLeft: '3px solid var(--brass)' }}>
      <h3 style={{ margin: '0 0 0.4rem' }}>Outstanding</h3>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem' }}>
        {late.map((l) => (
          <li key={l.n}>
            <b>{l.n}. {l.entry.text}</b> —{' '}
            {/* NEVER WRITTEN IN AT ALL IS A DIFFERENT FACT from overdue, and
                reporting it as "999 days" would be inventing a date. */}
            {l.never
              ? <>nothing recorded under this entry at all.</>
              : <>last recorded {fmt(l.last)}, <b>{l.days} days</b> ago, against about every {l.every}.</>}
            {' '}Nothing has been filled in for it.
          </li>
        ))}
        {faulty.length > 0 && (
          <li>
            <b>{faulty.length} {faulty.length === 1 ? 'entry needs' : 'entries need'} something
            before {faulty.length === 1 ? 'it is' : 'they are'} complete</b> —{' '}
            {faulty.slice(0, 4).map((x) => `no. ${x.entry.entry_n} (${x.problems[0].kind.replace(/-/g, ' ')})`).join(', ')}
            {faulty.length > 4 ? ` and ${faulty.length - 4} more` : ''}.
          </li>
        )}
      </ul>
      {/* THE REGULATION ITSELF HAS A SLOT FOR "IT DID NOT HAPPEN". Entry 8
          exists so that a drill that was not held is recorded WITH ITS REASON,
          which is the discipline this app follows everywhere, written into the
          statute. So an overdue drill is never quietly invented. */}
      {late.some((l) => l.n === 7) && (
        <p className="muted" style={{ fontSize: '0.8rem', margin: '0.4rem 0 0' }}>
          A drill that should have been held and was not is <b>entry 8</b>, with the reason —
          the Schedule provides for that, so it is written down rather than left blank.
        </p>
      )}
    </div>
  )
}

function Book({ book, entries, corrections, canOpen, busy, onClose, onDeliver, onCorrect }) {
  const closed = !!book.closed_on
  return (
    <div className="card" style={{ borderLeft: closed ? '3px solid var(--kelp)' : undefined }}>
      <h3 style={{ margin: '0 0 0.4rem', display: 'flex', justifyContent: 'space-between',
                   gap: '1rem', flexWrap: 'wrap' }}>
        <span>{book.book_no ? `Book ${book.book_no}` : 'Official log book'}</span>
        <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>
          opened {fmt(book.opened_on)}{book.opened_place ? ` at ${book.opened_place}` : ''} ·
          {' '}{entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          {closed && <> · closed {fmt(book.closed_on)}{book.closed_place ? ` at ${book.closed_place}` : ''}</>}
          {book.delivered_on && <> · delivered {fmt(book.delivered_on)}</>}
        </span>
      </h3>

      {entries.length === 0
        ? <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>Nothing entered yet.</p>
        : entries.map((e) => (
            <Entry key={e.id} entry={e} book={book} superseded={corrections.get(e.id) || []}
                   locked={closed || busy} onCorrect={onCorrect} />
          ))}

      {!closed && canOpen && (
        <CloseForm book={book} busy={busy} onClose={onClose} />
      )}
      {/* WITHIN 48 HOURS, to the superintendent or proper officer. A closed
          book that has not gone is its own outstanding thing. */}
      {closed && !book.delivered_on && canOpen && (
        <DeliverForm book={book} busy={busy} onDeliver={onDeliver} />
      )}
    </div>
  )
}

function Entry({ entry, book, superseded, locked, onCorrect }) {
  const e = entryOf(entry.entry_n)
  const problems = entryProblems(entry, book)
  const put = superseded.length > 0
  return (
    <div style={{
      borderTop: '1px solid var(--line)', padding: '0.45rem 0 0.5rem 0.5rem',
      borderLeft: put ? '3px solid var(--brass)' : problems.length ? '3px solid var(--rust)' : '3px solid transparent',
    }}>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.82rem' }}>{fmt(entry.occurred_on)}</span>
        <b style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.82rem' }}>no. {entry.entry_n}</b>
        <span style={{ flex: '1 1 18rem', fontSize: '0.86rem' }}>
          {entry.narrative || e?.text || '—'}
          {entry.occurred_at_place ? <span className="muted"> · {entry.occurred_at_place}</span> : null}
        </span>
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          {entry.signed_name}
          {entry.signed_by_officer ? ' (authorised officer)' : ''}
          {entry.witness_name ? ` · witness ${entry.witness_name}` : ''}
        </span>
      </div>
      <p className="muted" style={{ margin: '0.15rem 0 0', fontSize: '0.76rem' }}>{e?.text}</p>

      {problems.map((p, i) => (
        <p key={i} style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: 'var(--rust)' }}>{p.says}</p>
      ))}

      {/* A CORRECTED ENTRY IS NOT STRUCK OUT. Reg 9 puts a further entry
          alongside it; what the book says happened stays as written. */}
      {put && (
        <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--brass)' }}>
          Amended by the entry of {superseded.map((c) => fmt(c.occurred_on)).join(', ')}. This one
          stays as written — nothing in an official log book is erased.
        </p>
      )}
      {entry.corrects_entry_id && (
        <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem' }}>Made to amend an earlier entry.</p>
      )}
      {!locked && onCorrect && !put && (
        <button style={{ marginTop: '0.25rem', fontSize: '0.75rem', padding: '0.1rem 0.45rem' }}
                onClick={() => onCorrect(entry)}>
          Amend this by a further entry
        </button>
      )}
    </div>
  )
}

function OpenForm({ busy, today, onOpen }) {
  const [f, setF] = useState({ openedOn: today })
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <Field label="Book number, as on the paper one">
        <input value={f.bookNo || ''} onChange={set('bookNo')} placeholder="e.g. 4" />
      </Field>
      <Field label="Opened on"><input type="date" value={f.openedOn || ''} onChange={set('openedOn')} /></Field>
      <Field label="At"><input value={f.openedPlace || ''} onChange={set('openedPlace')} placeholder="Peterhead" /></Field>
      <button disabled={busy || !f.openedOn} onClick={() => onOpen?.(f)}>Open the book</button>
    </div>
  )
}

function CloseForm({ book, busy, onClose }) {
  const [f, setF] = useState({})
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  return (
    <div style={{ marginTop: '0.7rem', paddingTop: '0.5rem', borderTop: '1px solid var(--line)' }}>
      <p className="muted" style={{ fontSize: '0.8rem', margin: '0 0 0.3rem' }}>
        Closing is <b>entry 6</b> — the date and place. Nothing can be entered afterwards, and the
        book goes to the superintendent or proper officer within 48 hours.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Closed on"><input type="date" value={f.closedOn || ''} onChange={set('closedOn')} /></Field>
        <Field label="At"><input value={f.closedPlace || ''} onChange={set('closedPlace')} /></Field>
        <button disabled={busy || !f.closedOn} onClick={() => onClose?.(book.id, f)}>Close the book</button>
      </div>
    </div>
  )
}

function DeliverForm({ book, busy, onDeliver }) {
  const [f, setF] = useState({})
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  return (
    <div style={{ marginTop: '0.7rem', paddingTop: '0.5rem', borderTop: '1px solid var(--line)' }}>
      <p style={{ fontSize: '0.8rem', margin: '0 0 0.3rem', color: 'var(--brass)' }}>
        Closed and not yet delivered. It goes to the superintendent or proper officer within 48 hours.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Delivered on"><input type="date" value={f.deliveredOn || ''} onChange={set('deliveredOn')} /></Field>
        <Field label="To"><input value={f.deliveredTo || ''} onChange={set('deliveredTo')} placeholder="superintendent" /></Field>
        <button disabled={busy || !f.deliveredOn} onClick={() => onDeliver?.(book.id, f)}>Record delivery</button>
      </div>
    </div>
  )
}

/* ---- MAKING AN ENTRY -----------------------------------------------------
 * The number is picked from the Schedule and nothing else, and the form tells
 * you who must sign it and who must witness it BEFORE it is written — those
 * are prescribed per entry and nobody remembers thirty-three of them.
 */
function EntryForm({ book, busy, today, onAdd }) {
  const [entryN, setEntryN] = useState(7)
  const [f, setF] = useState({ occurredOn: today })
  const e = entryOf(entryN)
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }))
  const on = (k) => (ev) => set(k)(ev.target.value)

  const ready = f.occurredOn && String(f.signedName || '').trim().length > 1
    && (!e?.witness || String(f.witnessName || '').trim().length > 1)
    && !(e?.inPerson && f.signedByOfficer)

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Make an entry</h3>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Entry">
          <select value={entryN} onChange={(ev) => setEntryN(Number(ev.target.value))}>
            {OLB_ENTRIES.map((x) => <option key={x.n} value={x.n}>{x.n}. {x.text.slice(0, 52)}</option>)}
          </select>
        </Field>
        <Field label="When"><input type="date" value={f.occurredOn || ''} onChange={on('occurredOn')} /></Field>
        <Field label="Where"><input value={f.place || ''} onChange={on('place')} /></Field>
      </div>

      <p className="muted" style={{ fontSize: '0.8rem', margin: '0.4rem 0' }}>{e?.text}</p>

      <Field label="What happened" wide>
        <input value={f.narrative || ''} onChange={on('narrative')} style={{ width: '100%' }} />
      </Field>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label={`Signed by — ${e?.signer || 'the skipper'}`}>
          <input value={f.signedName || ''} onChange={on('signedName')} />
        </Field>
        {e?.witness && (
          <Field label={`Witnessed by — ${e.witness}`}>
            <input value={f.witnessName || ''} onChange={on('witnessName')} />
          </Field>
        )}
      </div>

      {/* THE DELEGATION RULE, shown where it applies and nowhere else. An
          officer may sign for the skipper on twenty-six of the thirty-three;
          on the other seven the regulation says IN PERSON and means it. */}
      {e?.inPerson ? (
        <p style={{ fontSize: '0.8rem', color: 'var(--brass)', margin: '0.3rem 0' }}>
          Entry {e.n} must be signed by the <b>skipper in person</b>. An officer authorised by the
          skipper may sign most entries; not this one.
        </p>
      ) : (
        <label style={{ fontSize: '0.78rem', display: 'block', margin: '0.3rem 0' }}>
          <input type="checkbox" checked={!!f.signedByOfficer}
                 onChange={(ev) => set('signedByOfficer')(ev.target.checked)} />
          {' '}Signed by an officer authorised by the skipper
        </label>
      )}

      <p className="muted" style={{ fontSize: '0.8rem' }}>
        An entry cannot be edited or deleted afterwards. One that turns out to be wrong is put
        right by a further entry that refers to it — that is what the regulations allow, and the
        only thing they allow.
      </p>
      <button disabled={!ready || busy}
              onClick={() => onAdd?.({ ...f, entryN, bookId: book.id })}>
        {ready ? 'Make the entry'
          : e?.witness ? 'A date, a signature and a witness are needed' : 'A date and a signature are needed'}
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

const fmt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—')
