import React from 'react'
import { pageLabel, uncoveredPages } from '../lib/certs/bundle'

/* WHAT A BUNDLE OF CERTIFICATES TURNED OUT TO BE — before anything is filed.
 *
 * Prop-driven and a file of its own so it can be server-rendered: the page is
 * behind a login and a real scan, and the state worth checking is the awkward
 * one — a bundle where half the certificates are last year's.
 *
 * FIVE OUTCOMES AND FIVE SETS OF WORDS. An older copy and a missing scan both
 * come off the same page of the same scan, and a review that rendered them
 * alike would invite the skipper to tick a lapsed liferaft certificate back
 * into the record as current. All the deciding is in `lib/certs/bundle.js`.
 */

const D = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—')

const KIND = {
  attach: { word: 'link this page', colour: 'var(--hull)' },
  hasFile: { word: 'already held', colour: 'var(--mute)' },
  superseded: { word: 'older copy', colour: 'var(--brass)' },
  duplicate: { word: 'read twice', colour: 'var(--mute)' },
  new: { word: 'not on file', colour: 'var(--kelp)' },
}

function explain(r) {
  const pages = pageLabel(r.page_from, r.page_to)
  if (r.kind === 'attach') {
    return `Matches “${r.target.cert_type}” on file, which has no scan. Saving links `
      + `${pages || 'this bundle'} to it — its dates and number stay as filed.`
  }
  if (r.kind === 'hasFile') {
    return `Already on file as “${r.target.cert_type}”, with its own scan. Nothing changes.`
  }
  if (r.kind === 'superseded') {
    const n = r.newer
    const at = n.expiry_date ? `expiring ${D(n.expiry_date)}` : `dated ${D(n.issue_date)}`
    return `Older than “${n.cert_type}” on file, ${at}. Not added — the renewal is the current certificate.`
      + (r.shared
        ? ' That renewal is the only later one for more than one older certificate here. If these are '
          + 'different items, one of them may not have been renewed.'
        : '')
  }
  if (r.kind === 'duplicate') return 'The reader returned this certificate twice. The second copy is ignored.'
  return 'Nothing like it is on file.'
    + (r.expired ? ` It expired ${D(r.expiry_date)}, and nothing on file replaces it — worth checking before adding.` : '')
    + (r.undated ? ' No dates were read off it.' : '')
    + (r.unknownKind ? ' The app could not tell what kind of certificate this is, so it could not look for an older or newer copy.' : '')
}

export default function CertBundleReview({
  fileName, pageCount, match, picks, onToggle, onOpenPage, onSave, onDiscard, busy = false,
}) {
  const { rows, counts } = match
  const chosen = rows.filter((r) => picks.has(r.idx))
  const gaps = uncoveredPages(rows, pageCount)
  const links = chosen.filter((r) => r.kind === 'attach').length
  const adds = chosen.filter((r) => r.kind === 'new').length

  const parts = [
    counts.attach && `${counts.attach} missing a scan`,
    counts.hasFile && `${counts.hasFile} already held`,
    counts.superseded && `${counts.superseded} older cop${counts.superseded === 1 ? 'y' : 'ies'}`,
    counts.duplicate && `${counts.duplicate} read twice`,
    counts.new && `${counts.new} not on file`,
  ].filter(Boolean)

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Read from {fileName}</h2>

      {!rows.length ? (
        <p style={{ margin: 0, color: 'var(--brass)' }}>
          No certificate was read off this document. That can be right — a covering letter, a
          blank scan — but open it and check before discarding.
        </p>
      ) : (
        <p style={{ margin: '0 0 0.4rem', fontSize: '0.9rem' }}>
          <b>
            {rows.length} certificate{rows.length === 1 ? '' : 's'} read
            {pageCount ? ` from ${pageCount} page${pageCount === 1 ? '' : 's'}` : ''}.
          </b>{' '}
          <span className="muted">{parts.join(' · ')}.</span>
        </p>
      )}

      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
        Nothing is filed until you save, and only the ticked rows. Whether a certificate is current is
        decided against what is already on file, never by the reader.
      </p>

      {gaps && gaps.length > 0 && (
        <p style={{ fontSize: '0.85rem', color: 'var(--brass)' }}>
          No certificate was read off page{gaps.length === 1 ? '' : 's'} {gaps.join(', ')}.{' '}
          <span className="muted">
            It may be a continuation or a covering note — open it before assuming nothing is there.
          </span>
        </p>
      )}

      {rows.length > 0 && (
        <div className="dlist">
          {rows.map((r) => {
            const k = KIND[r.kind]
            const pickable = r.kind === 'attach' || r.kind === 'new'
            return (
              <div className="di" key={r.idx} style={{ alignItems: 'flex-start' }}>
                <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                  {pickable ? (
                    <input type="checkbox" checked={picks.has(r.idx)} disabled={busy}
                           onChange={() => onToggle?.(r.idx)}
                           aria-label={`${r.kind === 'attach' ? 'Link' : 'Add'} ${r.cert_type}`}
                           style={{ width: 'auto', marginTop: '0.25rem' }} />
                  ) : <span style={{ width: '0.8rem' }} />}
                  <span>
                    <b>{r.cert_type || 'Title not read'}</b>
                    <span className="sub3">
                      {' '}— {r.issuer || 'issuer not read'} · issued {D(r.issue_date)} · expires {D(r.expiry_date)}
                      {r.cert_number ? ` · no. ${r.cert_number}` : ''}
                      {r.item_serial ? ` · serial ${r.item_serial}` : ''}
                    </span>
                    <br />
                    <span className="sub3" style={{ color: k.colour }}>{explain(r)}</span>
                  </span>
                </span>
                <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', whiteSpace: 'nowrap' }}>
                  <span className="when" style={{ color: k.colour }}>{k.word}</span>
                  {r.page_from ? (
                    <button type="button" className="secondary" onClick={() => onOpenPage?.(r.page_from)}
                            style={{ fontSize: '0.74rem', padding: '0 0.45rem' }}>
                      {pageLabel(r.page_from, r.page_to)}
                    </button>
                  ) : <span className="sub3">page not known</span>}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
        <button onClick={onSave} disabled={busy || !chosen.length}>
          {busy ? 'Saving…'
            : !chosen.length ? 'Nothing ticked'
              : [links && `Link ${links} page${links === 1 ? '' : 's'}`, adds && `add ${adds}`]
                .filter(Boolean).join(' and ').replace(/^a/, 'A')}
        </button>
        <button className="secondary" onClick={onDiscard} disabled={busy}>Discard</button>
      </div>
    </div>
  )
}
