import React, { useMemo, useState } from 'react'
import { suggestMerges } from '../../lib/invoices/mergeSuppliers'
import { money, MONO, Panel } from './shared'

/* TWO SPELLINGS OF ONE FIRM — SUGGESTED, NEVER APPLIED.
 *
 * Prop-driven and a file of its own for the same reason as CorrectFigures and
 * RemoveInvoice: it can be server-rendered, and this page is behind a login.
 *
 * NOTHING HERE MERGES ANYTHING ON ITS OWN. Two of the five pairs on this boat
 * are deliberately NOT merges — Macduff Shipyards against its crane hire arm,
 * Don Fishing against its Macduff branch — one firm and two trades with £1.34m
 * between them, where merging would fold a quota bill into the stores line.
 * That is not a case a rule can be trusted with, so the rule only ever asks.
 */
export default function MergeFirms({ suppliers = [], invoices = [], onMerge, onNotSame, busy }) {
  const pairs = useMemo(() => suggestMerges(suppliers, invoices), [suppliers, invoices])

  if (!pairs.length) {
    return (
      <Panel>
        <h3 style={{ marginTop: 0 }}>No two firms look like one</h3>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Nothing on the list has a name that is another name with more on the end. That is the
          only shape this can see — <b>Seaway Group</b> and <b>Seaway Net Company</b> would not
          appear here, and they were a real merge. A firm arriving under a second name that is not
          simply a longer version of the first still has to be spotted by eye.
        </p>
      </Panel>
    )
  }

  return (
    <Panel>
      <h3 style={{ marginTop: 0 }}>
        {pairs.length === 1 ? 'One pair worth a look' : `${pairs.length} pairs worth a look`}
      </h3>
      <p className="muted" style={{ fontSize: '0.82rem', marginTop: 0 }}>
        Each of these is a firm whose name is another firm's name with something on the end. Some
        are one company spelled two ways; some are a branch or a separate trade that must stay
        apart. <b>Nothing is merged until you say so</b>, and what each side actually sold is
        below, because that — not the name — is what tells them apart.
      </p>
      {pairs.map((p) => (
        <Pair key={p.keep.id + p.drop.id} pair={p} busy={busy}
              onMerge={onMerge} onNotSame={onNotSame} />
      ))}
    </Panel>
  )
}

function Pair({ pair, onMerge, onNotSame, busy }) {
  const { keep, drop, sameTrade, extra } = pair
  /* Which NAME survives is a judgement — "Banff Tyre Services" reads better
     than "Banff Tyre Services / County Garage" even though the second carried
     more invoices — so the offered direction can be turned round. */
  const [flip, setFlip] = useState(false)
  const a = flip ? drop : keep
  const b = flip ? keep : drop

  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '0.6rem 0' }}>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Side firm={a} role="keeps its name" />
        <Side firm={b} role="folds into it" />
      </div>

      <p className="muted" style={{ fontSize: '0.78rem', margin: '0.35rem 0' }}>
        {extra
          ? <>The difference is <b>{extra}</b>. </>
          : <>The names differ only in punctuation or a company suffix. </>}
        {sameTrade
          ? 'Both are filed to the same trade.'
          : /* NOT THE SAME TRADE IS THE LOUDEST THING ON THE ROW. It is exactly
               what separates the two pairs here that must never be merged. */
            <b style={{ color: 'var(--brass)' }}>
              They are filed to different trades ({keep.category || 'unfiled'} against{' '}
              {drop.category || 'unfiled'}) — which is how a branch selling something else looks.
            </b>}
      </p>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <button disabled={busy} onClick={() => onMerge?.(a, b)}>
          Merge — keep {a.name}
        </button>
        <button className="secondary" disabled={busy} onClick={() => setFlip(!flip)}>
          Other way round
        </button>
        {/* ANSWERED ONCE, NEVER ASKED AGAIN. Without this the page would put
            the same two refusals in front of him every time he opened it, and
            the one real pair would hide among them. */}
        <button className="secondary" disabled={busy} onClick={() => onNotSame?.(keep, drop)}>
          Not the same firm
        </button>
        <span className="muted" style={{ fontSize: '0.76rem' }}>
          {b.count} {b.count === 1 ? 'invoice moves' : 'invoices move'} · {money(b.value)} ·
          {' '}nothing is added up twice, and <b>{b.name}</b> is kept as a spelling so next
          Monday's bundle lands on the same firm
        </span>
      </div>
    </div>
  )
}

function Side({ firm, role }) {
  return (
    <div style={{ flex: '1 1 16rem', border: '1px solid var(--line)', borderRadius: 4,
                  padding: '0.4rem 0.5rem' }}>
      <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>{firm.name}</div>
      <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase',
                                      letterSpacing: '0.04em' }}>{role}</div>
      <div style={{ fontFamily: MONO, fontSize: '0.8rem', marginTop: 2 }}>
        {firm.count} {firm.count === 1 ? 'invoice' : 'invoices'} · {money(firm.value)}
      </div>
      <div className="muted" style={{ fontSize: '0.74rem' }}>
        {firm.first ? `${firm.first} to ${firm.last}` : 'no dated invoice'}
        {firm.category ? ` · ${firm.category}` : ' · not filed to a trade'}
      </div>
      {/* WHAT IT SOLD, which is the only thing that tells a branch from a
          business. The Don Fishing pair is chandlery against quota and nothing
          in either name says so. */}
      {firm.kinds?.length > 0 && (
        <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1rem', fontSize: '0.72rem' }}
            className="muted">
          {firm.kinds.map((k, i) => <li key={i}>{k.slice(0, 70)}</li>)}
        </ul>
      )}
    </div>
  )
}
