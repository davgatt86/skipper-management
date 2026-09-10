import React, { useMemo, useState } from 'react'
import {
  CODES, codeFor, entriesByPage, correctionsOf, describeEntry, entryRef, itemText,
  keepUntil, unsigned, weeklyGaps, openPageOf, nextPageNo,
} from '../../lib/certification/orb'
import { reconcile, mappingFor, draftFromFuel } from '../../lib/certification/orbLink'

/* THE OIL RECORD BOOK PART I, drawn.
 *
 * A FILE OF ITS OWN, and prop-driven, for the same reason as `SelfCertBody`
 * and `Review.jsx`: the page is behind a login and a fleet, so the only way to
 * see what it actually renders is to server-render it.
 *
 * WHAT THIS PAGE MUST NEVER DO is offer to change an entry. There is no edit
 * button and no delete button anywhere below, and the database refuses both in
 * any case. A wrong entry is put right by making another one that says so.
 */

export default function OrbBody({
  vessel, required, pages = [], entries = [], canSign = false, busy = false,
  declared = null, today = new Date().toISOString().slice(0, 10),
  onOpenPage, onClosePage, onSignPage, onAddEntry, onCorrect,
  fuelRows = [],
}) {
  /* The movement a draft was raised from, so EntryForm can seed from it. */
  const [prefill, setPrefill] = useState(null)
  /* NOT REQUIRED IS NOT THE SAME AS UNKNOWN, and neither is a reason to hide
     the book -- a boat under 400 GT may keep one voluntarily. What changes is
     what the page claims about her. */
  if (required?.required === false) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>No Oil Record Book Part I is required for {vessel?.label || 'this vessel'}</h3>
        <p className="muted">
          Regulation 20 of the Merchant Shipping (Prevention of Oil Pollution) Regulations 2019
          applies to ships of 400 GT and above other than oil tankers. She is recorded
          at <b>{required.gt} GT</b>. A book may still be kept voluntarily.
        </p>
      </div>
    )
  }

  const byPage = useMemo(() => entriesByPage(entries), [entries])
  const corrections = useMemo(() => correctionsOf(entries), [entries])
  const open = useMemo(() => openPageOf(pages), [pages])
  const state = useMemo(() => unsigned(entries, pages), [entries, pages])
  const keep = useMemo(() => keepUntil(entries), [entries])
  const first = entries[0]?.entry_date || null
  const gaps = useMemo(() => (first ? weeklyGaps(entries, first, today) : []), [entries, first, today])

  return (
    <div>
      <Standing declared={declared} required={required} />

      <div className="card">
        <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <Fig label="Vessel" value={vessel?.label || '—'} />
          <Fig label="Pages" value={pages.length || '—'} />
          <Fig label="Entries" value={entries.length || '—'} />
          <Fig label="Open page" value={open ? `No. ${open.page_no}` : 'none'} />
          {/* THREE YEARS AFTER THE LAST ENTRY, not three years per entry. The
              date the whole book may be let go moves every time anybody writes
              in it, which is the sort of thing that gets built backwards. */}
          <Fig label="Keep until" value={keep ? fmtDate(keep) : '—'}
               hint={keep ? 'three years after the last entry, and it moves on the next one' : null} />
        </div>
      </div>

      <Outstanding pages={state.openPages} gaps={gaps} first={first} canSign={canSign} />

      {/* THE OPEN PAGE IS THE PAGE. Entries can only be made on it, and once
          the master signs, it is closed to them for good. */}
      {open ? (
        <Page
          page={open} entries={byPage.get(open.id) || []} corrections={corrections}
          canSign={canSign} busy={busy} onClose={onClosePage} onSign={onSignPage} onCorrect={onCorrect}
        />
      ) : (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>No page open</h3>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Entries are made on a page, and a page is closed and signed by the master when it is
            full. The next page in this book is <b>no. {nextPageNo(pages)}</b>
            {pages.length === 0 && <> — if the boat already keeps this book on paper, open it at the
              number the paper book has reached rather than at 1, so the two agree about which page
              a surveyor is being shown</>}.
          </p>
          <button disabled={busy} onClick={() => onOpenPage?.(nextPageNo(pages))}>
            Open page {nextPageNo(pages)}
          </button>
        </div>
      )}

      {/* WHAT THE FUEL LOG HAS AND THE BOOK DOES NOT. Shown whether or not a
          page is open, because a gap in this book is what an inspector counts
          and it should not be hidden behind having opened a page first. */}
      <FuelGap rows={fuelRows} entries={entries} vesselId={vessel?.id} today={today}
               /* An entry may only be made on an OPEN page, and only where the
                  page was given a way to make one.  is not a prop of
                  this body — the write gate here is onAddEntry itself. */
               canRaise={!!open && !!onAddEntry}
               onRaise={(row) => setPrefill(draftFromFuel(row, { pageId: open?.id, vesselId: vessel?.id }))} />

      {open && (
        <EntryForm
          /* Remounted when a different movement is raised, so the form seeds
             from it rather than needing an effect to push values in. */
          key={prefill ? prefill.fuelLogId : 'blank'}
          page={open} busy={busy} onAdd={onAddEntry} today={today} prefill={prefill}
          onClearPrefill={() => setPrefill(null)} />
      )}

      {pages.filter((p) => p.id !== open?.id).map((p) => (
        <Page key={p.id} page={p} entries={byPage.get(p.id) || []} corrections={corrections}
              canSign={canSign} busy={busy} onClose={onClosePage} onSign={onSignPage} onCorrect={onCorrect} />
      ))}
    </div>
  )
}

/* ---- THE STANDING WARNING, and it is not decoration ----------------------
 * MARPOL was amended by MEPC.314(74) to allow an electronic Oil Record Book,
 * and the UK gives effect to that -- but MIN 644 requires the system to be
 * approved against the MEPC.312(74) Guidelines by a Recognised Organisation,
 * which then issues a "Declaration of MARPOL electronic record book" to be kept
 * aboard. UNTIL THAT DECLARATION EXISTS THE PAPER BOOK IS THE RECORD.
 *
 * An app that quietly let a skipper believe otherwise would be worse than one
 * that had never offered the feature: he would stop writing the paper book.
 */
function Standing({ declared, required }) {
  if (declared) {
    return (
      <div className="card" style={{ borderLeft: '3px solid var(--kelp)' }}>
        <b>Approved electronic record book.</b> Declaration of MARPOL electronic record book
        issued by {declared.issuer}{declared.reference ? ` (${declared.reference})` : ''}
        {declared.issued_on ? `, ${fmtDate(declared.issued_on)}` : ''}. A copy must be kept aboard.
      </div>
    )
  }
  return (
    <div className="card" style={{ borderLeft: '3px solid var(--brass)' }}>
      <h3 style={{ margin: '0 0 0.3rem' }}>The paper book is still the record</h3>
      <p style={{ margin: 0, fontSize: '0.86rem' }}>
        An electronic Oil Record Book is allowed under MEPC.314(74), but only once the system has
        been approved against the MEPC.312(74) Guidelines by a Recognised Organisation, which issues
        a <i>Declaration of MARPOL electronic record book</i> to be kept aboard. No declaration is
        on file for this app, so <b>keep writing the paper book</b> — what is here is a working copy
        and a way of seeing what is missing, not the book itself.
      </p>
      {required?.required === null && (
        <p className="muted" style={{ fontSize: '0.82rem', marginBottom: 0 }}>
          Whether she needs one at all cannot be worked out either — {required.why}. Gross tonnage
          is on the Vessel page, and 400 GT is the line.
        </p>
      )}
    </div>
  )
}

/* WHAT IS OUTSTANDING, as separate facts rather than one count -- they are
   chased from different people. A page waiting on the master is his; a missing
   weekly sludge reading is the engineer's. */
function Outstanding({ pages, gaps, first, canSign }) {
  if (!pages.length && !gaps.length) {
    return first
      ? <div className="card" style={{ borderLeft: '3px solid var(--kelp)' }}>
          Every completed page signed by the master, and no week without a sludge reading since
          the book was opened.
        </div>
      : null
  }
  return (
    <div className="card" style={{ borderLeft: '3px solid var(--brass)' }}>
      <h3 style={{ margin: '0 0 0.4rem' }}>Outstanding</h3>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem' }}>
        {pages.length > 0 && (
          <li>
            <b>{pages.length === 1 ? 'One page' : `${pages.length} pages`} not signed by the
            master</b> — no. {pages.map((p) => p.page_no).join(', ')}.
            {' '}Regulation 20 requires each completed page to be signed.
            {!canSign && ' Only the skipper can sign one.'}
          </li>
        )}
        {/* THE WEEKLY SLUDGE READING. Code C item 11.3 is required weekly even
            on a long voyage, and a gap in it is the first thing a port state
            inspector counts. REPORTED, NEVER FILLED IN: inventing a quantity
            nobody measured is the worst thing this app could do. */}
        {gaps.length > 0 && (
          <li>
            <b>{gaps.length === 1 ? 'One week' : `${gaps.length} weeks`} with no sludge
            reading</b> — code (C) item 11.3 is required weekly, even where a voyage runs longer
            than a week. Weeks beginning {gaps.slice(0, 8).map((g) => fmtDate(g.from)).join(', ')}
            {gaps.length > 8 ? ` and ${gaps.length - 8} more` : ''}.
            {' '}Nothing has been filled in for them: a quantity nobody measured must not appear
            in this book.
          </li>
        )}
      </ul>
    </div>
  )
}

function Page({ page, entries, corrections, canSign, busy, onClose, onSign, onCorrect }) {
  const signed = !!page.master_signed_at
  return (
    <div className="card" style={{ borderLeft: signed ? '3px solid var(--kelp)' : undefined }}>
      <h3 style={{ margin: '0 0 0.4rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <span>Page {page.page_no}</span>
        <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          {signed
            ? ` · signed ${fmtDate(page.master_signed_at)}${page.master_signed_name ? ` by ${page.master_signed_name}` : ''}`
            : page.closed_at ? ` · closed ${fmtDate(page.closed_at)}, awaiting the master` : ' · open'}
        </span>
      </h3>

      {entries.length === 0
        ? <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>Nothing entered on this page yet.</p>
        : entries.map((e) => (
            <Entry key={e.id} entry={e} superseded={corrections.get(e.id) || []}
                   locked={signed || busy} onCorrect={onCorrect} />
          ))}

      {!signed && (
        <div style={{ marginTop: '0.7rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {!page.closed_at && (
            <button disabled={busy || entries.length === 0} onClick={() => onClose?.(page.id)}>
              Close page {page.page_no}
            </button>
          )}
          {/* SIGNING IS THE MASTER'S, and RLS says so as well -- an officer's
              update carrying a master_signed_at is refused by policy, so
              hiding the button is presentation and not the boundary. */}
          <button disabled={!canSign || busy || entries.length === 0} onClick={() => onSign?.(page.id)}>
            {canSign ? `Sign page ${page.page_no} as master` : 'Only the master signs a page'}
          </button>
        </div>
      )}
    </div>
  )
}

function Entry({ entry, superseded, locked, onCorrect }) {
  const put = superseded.length > 0
  return (
    <div style={{
      borderTop: '1px solid var(--line)', padding: '0.45rem 0 0.5rem 0.5rem',
      borderLeft: put ? '3px solid var(--brass)' : '3px solid transparent',
    }}>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.82rem' }}>{fmtDate(entry.entry_date)}</span>
        <b style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.82rem' }}>{entryRef(entry)}</b>
        <span style={{ flex: '1 1 18rem', fontSize: '0.86rem' }}>{describeEntry(entry) || '—'}</span>
        <span className="muted" style={{ fontSize: '0.78rem' }}>{entry.officer_name}</span>
      </div>
      <p className="muted" style={{ margin: '0.15rem 0 0', fontSize: '0.76rem' }}>
        {itemText(entry.code, entry.item_n) || codeFor(entry.code)?.title}
      </p>

      {/* A CORRECTED ENTRY IS NOT STRUCK OUT. It is what the book says
          happened, and the correction is a second fact about it — both are
          here, and the older one says which entry put it right. */}
      {put && (
        <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--brass)' }}>
          Superseded by the entry of {superseded.map((c) => fmtDate(c.entry_date)).join(', ')}. This
          one stays as written — nothing in an oil record book is erased.
        </p>
      )}
      {entry.corrects_entry_id && (
        <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem' }}>
          Made to correct an earlier entry.
        </p>
      )}
      {!locked && onCorrect && !put && (
        <button style={{ marginTop: '0.25rem', fontSize: '0.75rem', padding: '0.1rem 0.45rem' }}
                onClick={() => onCorrect(entry)}>
          Correct this by a further entry
        </button>
      )}
    </div>
  )
}

/* ---- MAKING AN ENTRY -----------------------------------------------------
 * The code is picked, then the item, from the prescribed list and nothing
 * else. FREE TEXT BELONGS IN CODE (I) AND NOWHERE ELSE, so the narrative box
 * is offered everywhere but the item is what identifies the entry.
 */
/* WHAT THE FUEL LOG HAS AND THE BOOK DOES NOT.
 *
 * David: "can we link the fuel/oil and ORB? so entry into 1 puts entry into
 * other?" — and the answer is that it OFFERS rather than writes, for reasons
 * set out in `orbLink.js`: the entry needs an officer's signature the fuel log
 * cannot give, it can never be edited once made, and it wants a tank the fuel
 * log does not record.
 *
 * THE LIST IS THE HALF THAT MATTERS MOST. It shows the gap whether or not
 * anybody presses the button, and a gap in this book is what a port state
 * inspector counts first.
 */
function FuelGap({ rows, entries, vesselId, today, canRaise, onRaise }) {
  const r = useMemo(
    () => reconcile(rows, entries, { vesselId, asOf: today }),
    [rows, entries, vesselId, today])

  if (!r.total) return null

  if (!r.missing.length) {
    return (
      <div className="card" style={{ borderLeft: '3px solid var(--kelp)' }}>
        <h3 style={{ marginTop: 0 }}>The fuel log agrees with the book</h3>
        <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>
          All {r.total} oil movements on the fuel log have an entry against them.
        </p>
      </div>
    )
  }

  return (
    <div className="card" style={{ borderLeft: '3px solid var(--brass)' }}>
      <h3 style={{ marginTop: 0 }}>On the fuel log, not in the book</h3>
      <p className="muted" style={{ fontSize: '0.82rem', marginTop: 0 }}>
        {/* A COUNT IS NOT A RECONCILIATION, so it says which movements and how
            much oil, not a percentage — each one is its own entry and its own
            signature, so two of three is not two thirds of a duty done. */}
        {r.missing.length} of {r.total} movements have no entry against them:{' '}
        {r.kinds.map((k) => k.n + ' × ' + k.what.toLowerCase()
          + (k.litres ? ' (' + Math.round(k.litres).toLocaleString('en-GB') + ' L)' : '')).join(' · ')}.
      </p>
      <div className="dlist">
        {r.missing.slice(0, 12).map((row) => {
          const m = mappingFor(row.kind)
          return (
            <div className="di" key={row.id}>
              <span>
                <b>{fmtDate(row.entry_date)}</b> · {m.what}
                {row.litres != null && <> · {Math.round(row.litres).toLocaleString('en-GB')} L</>}
                {row.location ? ' · ' + row.location : ''}
                <span className="sub3"> — would be {m.code} {m.itemN}</span>
              </span>
              {canRaise
                ? <button className="secondary" style={{ fontSize: '0.74rem' }}
                          onClick={() => onRaise(row)}>raise the entry</button>
                /* NO BUTTON WITHOUT AN OPEN PAGE, because an entry may only be
                   made on one — offering it and then refusing at save time is
                   a worse way to find out. */
                : <span className="sub3">open a page to enter it</span>}
            </div>
          )
        })}
      </div>
      {r.missing.length > 12 && (
        <p className="muted" style={{ fontSize: '0.76rem', margin: '0.5rem 0 0' }}>
          and {r.missing.length - 12} older ones.
        </p>
      )}
    </div>
  )
}

function EntryForm({ page, busy, onAdd, today, prefill, onClearPrefill }) {
  const [code, setCode] = useState(prefill?.code || 'C')
  const [itemN, setItemN] = useState(prefill?.itemN || '11.3')
  /* THE OFFICER NAME IS NEVER SEEDED. It is the one field reg 20 is most
     particular about and the one thing a fuel log cannot know — the schema
     refuses a blank one, and that refusal is the rule working. */
  const [f, setF] = useState(prefill
    ? {
        entryDate: prefill.entryDate || today, officerName: '',
        quantity: prefill.quantity ?? '', unit: prefill.unit || '',
        port: prefill.port || '', narrative: prefill.narrative || '',
        tank: '', fuelLogId: prefill.fuelLogId,
      }
    : { entryDate: today, officerName: '' })
  const c = codeFor(code)

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const pickCode = (e) => {
    const next = e.target.value
    setCode(next)
    /* The item must come off the NEW code. Leaving the old one behind is how
       a `C/11.3` becomes an `A/11.3`, which the database now refuses — but a
       refusal at save time is a worse way to find out than not offering it. */
    setItemN(codeFor(next)?.items?.[0]?.n || '')
  }

  const ready = String(f.officerName || '').trim().length > 1 && f.entryDate
    && (code === 'I' || itemN)

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Make an entry on page {page.page_no}</h3>
      {prefill && (
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0,
                                      borderLeft: '3px solid var(--hull)', paddingLeft: '0.6rem' }}>
          Raised from the fuel log. <b>It is not an entry until you sign it</b>, and
          {prefill.needs?.length ? ' it still needs ' + prefill.needs.join('; ') + '.' : '.'}
          {' '}<button className="secondary" style={{ fontSize: '0.72rem', padding: '0 0.35rem' }}
                       onClick={onClearPrefill}>start blank instead</button>
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Date">
          <input type="date" value={f.entryDate || ''} onChange={set('entryDate')} />
        </Field>
        <Field label="Code">
          <select value={code} onChange={pickCode}>
            {CODES.map((x) => <option key={x.code} value={x.code}>({x.code}) {x.title.slice(0, 44)}</option>)}
          </select>
        </Field>
        {!c?.freeText && (
          <Field label="Item">
            <select value={itemN} onChange={(e) => setItemN(e.target.value)}>
              {c?.items.map((i) => <option key={i.n} value={i.n}>{i.n}</option>)}
            </select>
          </Field>
        )}
      </div>

      <p className="muted" style={{ fontSize: '0.8rem', margin: '0.4rem 0' }}>
        {itemText(code, itemN) || c?.title}
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Quantity"><input type="number" step="any" value={f.quantity || ''} onChange={set('quantity')} /></Field>
        <Field label="Unit"><input value={f.unit || ''} onChange={set('unit')} placeholder="m3" /></Field>
        <Field label="Tank"><input value={f.tank || ''} onChange={set('tank')} /></Field>
        <Field label="Port"><input value={f.port || ''} onChange={set('port')} /></Field>
        <Field label="Position"><input value={f.position || ''} onChange={set('position')} /></Field>
      </div>

      <Field label={c?.freeText ? 'Remarks' : 'Remarks (optional)'} wide>
        <input value={f.narrative || ''} onChange={set('narrative')} style={{ width: '100%' }} />
      </Field>

      {/* THE OFFICER IN CHARGE OF THE OPERATION, and it is a name rather than
          a login: reg 20 requires the entry to be signed off by the officer in
          charge, who is not always the man holding the tablet. */}
      <Field label="Officer in charge of the operation" wide>
        <input value={f.officerName || ''} onChange={set('officerName')} style={{ width: '100%' }}
               placeholder="The name that would be signed against this entry" />
      </Field>

      <p className="muted" style={{ fontSize: '0.8rem' }}>
        An entry cannot be edited or deleted afterwards — that is what makes this a record book.
        A mistake is put right by making a further entry that says so.
      </p>
      <button disabled={!ready || busy}
              onClick={() => onAdd?.({ ...f, code, itemN: c?.freeText ? null : itemN,
                                        pageId: page.id, fuelLogId: f.fuelLogId || null })}>
        {ready ? 'Make the entry' : 'Date, code and officer are needed'}
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

function Fig({ label, value, hint }) {
  return (
    <span>
      <span className="muted" style={{ fontSize: '0.72rem', display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <b style={{ fontSize: '1rem' }}>{value}</b>
      {hint && <span className="muted" style={{ fontSize: '0.7rem', display: 'block' }}>{hint}</span>}
    </span>
  )
}

const fmtDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—')
