import React, { useMemo, useState } from 'react'
import { addsWrong, figuresMissing, explainReadError } from '../../lib/invoices/periods'
import { checkForDuplicates } from '../../lib/invoices/duplicates'
import { money, money0, fmtDate } from './shared'

/* CHECK THE READ — the screen nothing is filed without.
 *
 * A FILE OF ITS OWN so it can be rendered without a login, which matters more
 * here than anywhere else on the page: this is the last thing between a model
 * reading a photograph and a cost standing in the record for ever. A build
 * passing proves nothing about it — an undefined identifier is valid
 * JavaScript — so `scripts/invoices-page-preview.mjs` server-renders it and
 * reads the markup back.
 *
 * OPENING A DOCUMENT ARRIVES AS A PROP. `signedUrl` and `openDocument` drag
 * the supabase client in behind them, and a component that does that can only
 * ever be checked by eye on somebody else’s device. Same reason
 * `KeptSheetView.jsx` is its own file.
 */
/* ── 2 · CHECK THE READ ────────────────────────────────────────────────────
 * Every figure editable, and the firms nobody has filed named at the top. */
/* ── 2 · CHECK THE READ ────────────────────────────────────────────────────
 *
 * EVERY BUNDLE IN THE RUN, IN ONE LIST. Reading thirty-four bundles one at a
 * time was the complaint; being asked to Save thirty-four times would only move
 * the tedium rather than remove it.
 *
 * WHAT NEEDS A LOOK IS PULLED TO THE TOP. That is what keeps "nothing saves
 * unlooked-at" honest at this size: a row whose net and VAT do not come to its
 * total, one with no date, one whose firm is not on the list. Scrolling past
 * two hundred correct rows to find the three wrong ones is not checking — it is
 * hoping. So the doubtful ones are counted and marked, and everything is still
 * on screen and still editable.
 */
export default function Review({ items, unknown, suppliers, filed, progress, onStop,
                                onEdit, onDropRow, onFile, onSave, onDrop,
                                onOpenScan, onOpenPage }) {
  const rows = items.flatMap((i) => i.rows)
  const total = rows.reduce((s, r) => s + (Number(r.total) || 0), 0)

  /* The three things worth stopping for, counted across the whole run. Each is
     a different KIND of doubt and they are not lumped together: an unfiled firm
     is a decision, a sum that does not add up is a misread, a missing date puts
     the cost in no period at all. */
  const flags = {
    firm: rows.filter((r) => !r.supplier_id).length,
    adds: rows.filter((r) => addsWrong(r)).length,
    date: rows.filter((r) => !r.invoice_date).length,
    /* A FIGURE THE READER DID NOT GET is its own doubt, and was the hole: net +
       VAT cannot disagree with a total that is not there, so a blank sailed
       past "figures that add up" and then failed on save. */
    figs: rows.filter((r) => figuresMissing(r).length).length,
  }

  /* ALREADY ON FILE, COUNTED ACROSS THE WHOLE RUN.
   *
   * Worked out here as well as inside each card because the summary at the top
   * said "Nothing flagged" while the card below it said three of four were
   * duplicates — caught by rendering it. Two parts of one screen disagreeing is
   * worse than either of them being wrong on its own: it is the reason nobody
   * believes the summary again. */
  const dupes = items.reduce((t, it) => t + checkForDuplicates(
    it.rows, filed || [], { ignoreBatch: it.batch.id, alsoInRun: items }).found.length, 0)
  const failed = items.filter((i) => i.error)

  return (
    <>
      {progress && (
        <div className="card" style={{ borderColor: 'var(--hull)' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <b>Reading {progress.done + 1} of {progress.total}</b>
            <span className="muted" style={{ flex: 1, fontSize: '0.84rem' }}>
              {progress.current
                ? fmtDate(String(progress.current.received_at).slice(0, 10))
                : ''} — a photograph takes a minute or two
            </span>
            <button className="secondary" onClick={onStop}>Stop after this one</button>
          </div>
          {/* THE POINT OF THE QUEUE: check the ones already read while the rest
              are still going. */}
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
            Carry on checking below — the rest keep reading while you do.
            Leaving the page stops the run; anything already saved stays saved.
          </p>
        </div>
      )}

      {failed.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--rust)' }}>
          <b>{failed.length} bundle{failed.length === 1 ? '' : 's'} could not be read</b>
          <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', fontSize: '0.86rem' }}>
            {failed.map((f) => {
              /* WHAT IT MEANS FIRST, the raw text underneath. "Your credit
                 balance is too low" arrives wrapped in JSON, and a skipper
                 reading that cannot tell a billing card from a broken book. */
              const e = explainReadError(f.error)
              return (
                <li key={f.batch.id} style={{ marginBottom: '0.35rem' }}>
                  {fmtDate(String(f.batch.received_at).slice(0, 10))} — <b>{e.what}</b>{' '}
                  <button className="secondary" style={{ padding: '0 0.4rem', fontSize: '0.74rem' }}
                          onClick={() => onDrop(f.batch.id)}>dismiss</button>
                  {e.next && <div className="muted" style={{ fontSize: '0.82rem' }}>{e.next}</div>}
                  {e.next && (
                    <details style={{ fontSize: '0.76rem' }}>
                      <summary className="muted" style={{ cursor: 'pointer' }}>what it said</summary>
                      <code style={{ wordBreak: 'break-all' }}>{e.raw}</code>
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
            The files are still on the Arrivals tab and can be read again.
          </p>
        </div>
      )}

      {!items.length && !progress && (
        <div className="card"><p style={{ margin: 0 }}>
          Nothing waiting to be checked. Read a bundle on the Arrivals tab.
        </p></div>
      )}

      {/* FILING A FIRM COMES FIRST, because it changes every row that names it —
          across every bundle in the queue at once, which is most of the value of
          reading them together. */}
      {unknown.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--brass)' }}>
          <h3 style={{ margin: '0 0 0.3rem', fontSize: '0.95rem' }}>
            {unknown.length} firm{unknown.length === 1 ? '' : 's'} not on your list yet
          </h3>
          <p className="muted" style={{ margin: '0 0 0.7rem', fontSize: '0.82rem' }}>
            File one and every invoice naming it lines up, in this run and the next.
            Leave it and it still saves — under the name as read, which is how one firm
            ends up looking like four.
          </p>
          {unknown.map((u) => (
            <UnknownFirm key={u.key} u={u} suppliers={suppliers} onFile={onFile} />
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="card" style={{ position: 'sticky', top: 0, zIndex: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                        flexWrap: 'wrap', gap: '0.5rem' }}>
            <b>{rows.length} invoice{rows.length === 1 ? '' : 's'} off {items.length} bundle
              {items.length === 1 ? '' : 's'}</b>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700 }}>{money(total)}</span>
          </div>

          {/* WHAT WANTS A LOOK, named separately rather than as one count. */}
          <p style={{ margin: '0.4rem 0 0.6rem', fontSize: '0.84rem' }}>
            {/* NO ROWS IS NOT A CLEAN BILL OF HEALTH.
                With nothing read, the all-clear below reads "every row has a
                filed firm, a date, and figures that add up" — a sentence about
                rows, printed when there are none, above a "Save all 0" button.
                David hit it on three 2017 files: one was French bank details and
                one a duplicate down-payment request, so finding nothing was
                CORRECT, and the page made a correct outcome look like a fault.
                An empty result and a clean result must never read alike. */
             rows.length === 0
              ? <span className="muted">
                  The reader found no invoices in {items.length === 1 ? 'this one' : 'any of these'}.
                  That is the right answer for a covering letter, a statement or a
                  set of bank details — open the scan to check, then discard it.
                </span>
              : flags.firm + flags.adds + flags.date + flags.figs + dupes === 0
              ? <span className="muted">Nothing flagged — every row has a filed firm, a date, and figures that add up, and none of them is already on file.</span>
              : <>
                  <b>Worth a look:</b>{' '}
                  {[/* First, because its answer is "leave it out" and that makes
                       every other flag on the row moot. */
                    dupes && `${dupes} already on file`,
                    flags.firm && `${flags.firm} with no firm filed`,
                    flags.adds && `${flags.adds} where net + VAT ≠ total`,
                    flags.figs && `${flags.figs} with a figure the reader missed`,
                    flags.date && `${flags.date} with no date`]
                    .filter(Boolean).join(' · ')}
                </>}
          </p>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            {rows.length > 0 && (
              <button onClick={() => onSave(items)}>
                Save all {rows.length}
              </button>
            )}
            <span className="muted" style={{ fontSize: '0.8rem', alignSelf: 'center' }}>
              or save a bundle at a time below
            </span>
          </div>
        </div>
      )}

      {items.filter((i) => i.rows.length).map((item) => (
        <BundleCard key={item.batch.id} item={item} filed={filed} run={items}
                    onEdit={onEdit} onDropRow={onDropRow} onSave={onSave} onDrop={onDrop}
                    onOpenScan={onOpenScan} onOpenPage={onOpenPage} />
      ))}
    </>
  )
}

/* ONE BUNDLE, CHECKED BEFORE IT IS FILED.
 *
 * The duplicate check lives here rather than in the save because the answer is
 * a decision, not a rule: the office re-sends an unapproved invoice in the next
 * week's PDF — Inverboyndie INV-0114 is in three consecutive Mondays — and only
 * the skipper knows whether a second copy is that or a genuine second charge.
 * £240,015.96 across ten years says it is nearly always the former. */
function BundleCard({ item, filed, run, onEdit, onDropRow, onSave, onDrop, onOpenScan, onOpenPage }) {
  const dupes = useMemo(
    () => checkForDuplicates(item.rows, filed || [], {
      ignoreBatch: item.batch.id, alsoInRun: run,
    }), [item.rows, filed, item.batch.id, run])
  const flagged = useMemo(
    () => new Map(dupes.found.map((f) => [f.index, f])), [dupes])

  return (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap',
                        borderBottom: '1px solid var(--line)', paddingBottom: '0.4rem' }}>
            <b style={{ fontFamily: 'var(--font-mono, monospace)' }}>
              {fmtDate(String(item.batch.received_at).slice(0, 10))}
            </b>
            <span className="muted" style={{ flex: 1, fontSize: '0.82rem' }}>
              {item.rows.length} invoice{item.rows.length === 1 ? '' : 's'} ·{' '}
              {money(item.rows.reduce((s, r) => s + (Number(r.total) || 0), 0))} ·{' '}
              {item.batch.page_count || '?'} page{item.batch.page_count === 1 ? '' : 's'}
            </span>
            <button className="secondary"
                    onClick={() => onOpenScan(item.batch)}>Open the scan</button>
            <button className="secondary" onClick={() => onSave([item])}>Save these</button>
            <button className="secondary" onClick={() => onDrop(item.batch.id)}>Discard</button>
          </div>

          {/* ALREADY ON FILE — said once at the top, before thirteen rows of
              detail, because this is the one flag whose answer is "leave it
              out" rather than "correct it". */}
          {dupes.found.length > 0 && (
            <div style={{ border: '1px solid var(--brass)', borderRadius: 4,
                          padding: '0.5rem 0.6rem', margin: '0.6rem 0' }}>
              <b style={{ fontSize: '0.9rem' }}>
                {dupes.found.length} of these {dupes.found.length === 1 ? 'is' : 'are'} already on file
              </b>
              <span className="muted" style={{ fontSize: '0.84rem' }}>
                {' '}· {money(dupes.value)} if you file {dupes.found.length === 1 ? 'it' : 'them'} again
              </span>
              <p className="muted" style={{ margin: '0.3rem 0 0', fontSize: '0.8rem' }}>
                The office re-sends an invoice in the following week's bundle until it has
                been approved, so the same cost arrives more than once. Ten years of this
                put {money(240015.96)} into the record twice. Each one is marked below —
                leave it out, or file it anyway if it really is a second charge.
              </p>
            </div>
          )}

          {item.rows.map((r, i) => (
            <InvoiceRow key={i} r={r} filePath={item.batch.file_path}
                       pageCount={item.batch.page_count}
                       duplicate={flagged.get(i)}
                       onOpenPage={onOpenPage}
                       onDropRow={() => onDropRow(item.batch.id, i)}
                       onChange={(patch) => onEdit(item.batch.id, i, patch)} />
          ))}
        </div>
  )
}

function InvoiceRow({ r, filePath, pageCount, duplicate, onDropRow, onOpenPage, onChange }) {
  const bad = addsWrong(r)
  const missing = figuresMissing(r)
  /* The left edge carries the state at a glance down a long list: green filed,
     brass a firm to file, rust a sum that does not add up. */
  /* A page number is only worth offering if it could be true: a whole number,
     at least 1, and inside a document that has that many pages. */
  const asPage = (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 ? Number(v) : null)
  const pageAt = asPage(r.page_from)
  /* Refused rather than reversed, the same rule the pages follow: which of
     the two dates is wrong is not knowable. */
  const workBad = !!r.work_from && !!r.work_to && r.work_to < r.work_from
  const overrun = !!pageCount && [r.page_from, r.page_to].some((v) => asPage(v) > pageCount)
  /* A duplicate is not a misread — it is brass, the colour of a decision, and
     it wins the edge because leaving the row out makes every other flag on it
     moot. */
  const edge = duplicate ? 'var(--brass)'
    : bad || missing.length ? 'var(--rust)'
    : r.supplier_id ? 'var(--kelp)' : 'var(--brass)'
  return (
    <div style={{
      border: '1px solid var(--line)', borderRadius: 4, padding: '0.6rem',
      marginTop: '0.5rem', borderLeftWidth: 3, borderLeftColor: edge,
    }}>
      {duplicate && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap',
                      marginBottom: '0.45rem' }}>
          <b style={{ color: 'var(--brass)', fontSize: '0.86rem' }}>
            {duplicate.kind === 'within' ? 'This bundle carries it twice'
              : duplicate.kind === 'run' ? 'Also in another bundle you are about to save'
              : duplicate.kind === 'certain' ? 'Already on file'
              : 'Same firm and number already on file'}
          </b>
          <span className="muted" style={{ fontSize: '0.8rem', flex: 1 }}>
            {duplicate.kind === 'within'
              ? 'the reader returned the same invoice more than once'
              /* NOT ON FILE YET, so the answer is to leave one out rather than
                 to go looking through history. Names the other bundle, because
                 "it is in one of the twelve on this screen" is not an answer. */
              : duplicate.kind === 'run'
                ? 'not filed yet — it is also in the bundle of '
                  + duplicate.hits.map((h) => fmtDate(String(h._batch?.received_at || '').slice(0, 10))
                      || 'another bundle').join(' and ')
                  + '. Leave it out of one of them.'
              : duplicate.hits.map((h) => (h.invoice_date || 'no date') + ' · ' + money(h.total))
                  .join(' · ')}
            {/* SIMILAR IS NOT CERTAIN, and saying so matters: 3098 and 3098b
                were the same invoice reissued with one line corrected, and
                £147,985.99 turned on telling those apart. */}
            {duplicate.kind === 'similar' && ' — a different amount, so possibly a corrected reissue'}
          </span>
          <button onClick={onDropRow}>Leave it out</button>
        </div>
      )}

      <div style={{ display: 'grid', gap: '0.4rem',
                    gridTemplateColumns: 'minmax(9rem, 2fr) minmax(6rem, 1fr) minmax(7rem, 1fr)' }}>
        <label>
          <span className="muted" style={{ fontSize: '0.72rem' }}>Supplier</span>
          <input value={r.supplier} onChange={(e) => onChange({ supplier: e.target.value })}
                 style={{ width: '100%' }} />
        </label>
        <label>
          <span className="muted" style={{ fontSize: '0.72rem' }}>Invoice no.</span>
          <input value={r.invoice_no} onChange={(e) => onChange({ invoice_no: e.target.value })}
                 style={{ width: '100%' }} />
        </label>
        <label>
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            Date{!r.invoice_date && <span style={{ color: 'var(--brass)' }}> · missing</span>}
          </span>
          <input type="date" value={r.invoice_date || ''}
                 onChange={(e) => onChange({ invoice_date: e.target.value })}
                 style={{ width: '100%' }} />
        </label>
      </div>

      <label style={{ display: 'block', marginTop: '0.4rem' }}>
        <span className="muted" style={{ fontSize: '0.72rem' }}>What for</span>
        <input value={r.description} onChange={(e) => onChange({ description: e.target.value })}
               style={{ width: '100%' }} />
      </label>

      <div style={{ display: 'grid', gap: '0.4rem', marginTop: '0.4rem',
                    gridTemplateColumns: 'repeat(3, minmax(5rem, 1fr))' }}>
        {['net', 'vat', 'total'].map((f) => (
          <label key={f}>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              {f === 'total' ? 'Total' : f.toUpperCase()}
              {missing.includes(f) && <span style={{ color: 'var(--rust)' }}> · not read</span>}
            </span>
            <input value={r[f] ?? ''} inputMode="decimal"
                   onChange={(e) => onChange({ [f]: e.target.value })}
                   style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)' }} />
          </label>
        ))}
      </div>
      {/* WHEN THE WORK WAS DONE, if the invoice says.
        *
        * Filled in HERE where it is cheapest — the scan is open, the reader has
        * just been through it, and a service invoice normally prints its job
        * dates. Left blank the cost counts on the invoice date exactly as every
        * one of the 2,625 already filed does; there is no second date anybody
        * has to supply before the page works. */}
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-end', flexWrap: 'wrap',
                    marginTop: '0.4rem' }}>
        <label style={{ width: '9rem' }}>
          <span className="muted" style={{ fontSize: '0.72rem' }}>Work done from</span>
          <input type="date" value={r.work_from || ''} style={{ width: '100%' }}
                 onChange={(e) => onChange({ work_from: e.target.value })} />
        </label>
        <label style={{ width: '9rem' }}>
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            to{workBad && <span style={{ color: 'var(--rust)' }}> · before the start</span>}
          </span>
          <input type="date" value={r.work_to || ''} style={{ width: '100%' }}
                 onChange={(e) => onChange({ work_to: e.target.value })} />
        </label>
        <span className="muted" style={{ fontSize: '0.76rem', flex: '1 1 12rem' }}>
          {r.work_from
            ? 'Counted in ' + String(r.work_from).slice(0, 4)
              + (r.work_to && String(r.work_to).slice(0, 4) !== String(r.work_from).slice(0, 4)
                  ? '–' + String(r.work_to).slice(0, 4) + ', divided by days' : '')
              + ' when the grid is dated by work.'
            : 'Blank counts it on the invoice date, which is the usual case.'}
        </span>
      </div>


      {/* WHICH PAGES OF THE BUNDLE THIS ONE IS.
        *
        * A bundle is a whole week in one file, so checking a read against the
        * scan meant opening five pages and hunting. This is the only field the
        * reader returns that nothing downstream can check against the invoice
        * itself, so a page it was unsure of comes back blank and says so —
        * a wrong page opens at the wrong invoice and looks certain doing it. */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4rem',
                    marginTop: '0.4rem', flexWrap: 'wrap' }}>
        {['page_from', 'page_to'].map((f) => (
          <label key={f} style={{ width: '4.2rem' }}>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              {f === 'page_from' ? 'Page' : 'to'}
            </span>
            <input value={r[f] ?? ''} inputMode="numeric"
                   onChange={(e) => onChange({ [f]: e.target.value })}
                   style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)' }} />
          </label>
        ))}
        <button className="secondary" type="button"
                onClick={() => onOpenPage(filePath, r.page_from)}>
          {pageAt ? 'Open at page ' + pageAt : 'Open the scan'}
        </button>
        {!pageAt && (
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            the reader could not say which page this is
          </span>
        )}
        {overrun && (
          <span style={{ fontSize: '0.78rem', color: 'var(--rust)' }}>
            this bundle is only {pageCount} pages
          </span>
        )}
      </div>

      {/* SAY WHAT A BLANK WILL BECOME. The column will not take a null, so it
          goes in as 0 — and a 0 the document never showed must not read like
          one it did. Saved either way; the record keeps that nobody read it. */}
      {missing.length > 0 && (
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: 'var(--rust)' }}>
          The reader did not get {missing.join(', ').toUpperCase()} off this one.
          Fill {missing.length === 1 ? 'it' : 'them'} in, or it saves as nought and
          is marked as never read.
        </p>
      )}
      {bad && (
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: 'var(--rust)' }}>
          Net and VAT come to {money(Number(r.net) + Number(r.vat))}, not {money(r.total)} —
          out by {money(Number(r.net) + Number(r.vat) - Number(r.total))}. One of the three is misread.
        </p>
      )}
    </div>
  )
}
function UnknownFirm({ u, suppliers, onFile }) {
  const [pick, setPick] = useState('')
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap',
                  padding: '0.35rem 0', borderTop: '1px solid var(--line)' }}>
      <span style={{ flex: '1 1 12rem' }}>
        <b>{u.name}</b>
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          {' '}· {u.count} invoice{u.count === 1 ? '' : 's'} · {money(u.total)}
        </span>
      </span>
      <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: '13rem' }}>
        <option value="">add as a new firm</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>same as {s.name}</option>)}
      </select>
      <button className="secondary"
              onClick={() => onFile(u.name, pick ? suppliers.find((s) => s.id === pick) : null)}>
        File
      </button>
    </div>
  )
}
