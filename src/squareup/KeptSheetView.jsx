import React from 'react';
import { fmtMoney, shareTextOf, bondBreakdown } from './helpers.js';

/* ── A KEPT SHEET, READ AND NOT TOUCHED ─────────────────────────────────────
 *
 * David, Aug 2026: "it would be good if bond lines saved per crewman, so if
 * there's any disputes i can reopen a saved sheet and see exactly what each
 * crewman had ... how can i reopen a saved sheet to check?"
 *
 * Open was the only way in and it REPLACES the form, so answering a question
 * about a trip three weeks ago meant destroying the trip being worked on. This
 * reads the sheet and shows it. Nothing on the form moves.
 *
 * IT IS THE SKIPPER'S RECORD AND IT IS NOT THE OFFICE'S. The exported sheet
 * carries each man's bond TOTAL and a carried-over balance and no more — his
 * own words. What he actually had is what settles an argument, and settling an
 * argument is the skipper's job.
 */
export default function KeptSheetView({ w, t, onClose }) {
  const bond = bondBreakdown(t.bondItems, t.crew);
  const trip = [t.tripNo && `Trip ${t.tripNo}`, t.market,
    t.boxesLanded && `${Number(t.boxesLanded).toLocaleString('en-GB')} bx`,
    t.daysAtSea && `${t.daysAtSea} days`,
    t.landings && Number(t.landings) > 1 && `${t.landings} landings`]
    .filter(Boolean).join(' · ');

  return (
    <div className="card" style={{ marginTop: 12, borderColor: 'var(--hull)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
        <b style={{ fontFamily: 'var(--font-mono, monospace)' }}>{t.tripDate || w.landed_date || 'no date'}</b>
        <span className="muted" style={{ flex: 1, fontSize: '0.86rem' }}>{trip || 'no trip details'}</span>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>
      <p className="muted" style={{ margin: '0.4rem 0 0.8rem', fontSize: '0.8rem' }}>
        Reading only — nothing here touches the form. This is your own record of what
        each man had; the sheet the office gets shows totals only.
      </p>

      {/* THE BOND, MAN BY MAN. The whole reason this view exists. */}
      <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.78rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--brass)' }}>Bond</h4>
      {bond.isEmpty ? (
        <p className="muted" style={{ margin: 0, fontSize: '0.86rem', fontStyle: 'italic' }}>
          {w.unassignedBond == null
            /* NOT THE SAME AS NO BOND. A sheet kept before the items were stored
               has nothing to show, and saying "no bond" would be a claim about
               the trip rather than about the record. */
            ? 'This sheet was kept before the bond items were stored, so there is nothing itemised to show. Its per-man totals are on the crew list below.'
            : 'No bond on this trip.'}
        </p>
      ) : (
        <>
          {bond.perCrew.map(({ c, items, total }) => (
            <BondBlock key={c.id} title={c.name || '—'} items={items} total={total} />
          ))}
          {bond.stores.items.length > 0 && (
            <BondBlock title="Stores" note="boat pays" items={bond.stores.items} total={bond.stores.total} />
          )}
          {bond.carried.items.length > 0 && (
            <BondBlock title="Carried over" note="not yet charged" items={bond.carried.items} total={bond.carried.total} />
          )}
          {bond.unassigned.items.length > 0 && (
            <BondBlock title="Unassigned" tone="var(--rust)" note="nobody charged"
                       items={bond.unassigned.items} total={bond.unassigned.total} />
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid var(--line)', paddingTop: '0.4rem', marginTop: '0.5rem', fontWeight: 700 }}>
            <span>Bond on this sheet</span>
            <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{fmtMoney(bond.total)}</span>
          </div>
        </>
      )}

      <h4 style={{ margin: '1rem 0 0.4rem', fontSize: '0.78rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--brass)' }}>Crew</h4>
      {t.crew.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: '0.86rem', fontStyle: 'italic' }}>Nobody on this sheet.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: '0.88rem' }}>
          {t.crew.map((c) => (
            <li key={c.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', padding: '0.25rem 0', borderTop: '1px solid var(--line)' }}>
              <span style={{ flex: 1 }}>{c.name || '—'}</span>
              <span className="muted">{shareTextOf(c)}</span>
              {c.role && <span className="muted" style={{ fontSize: '0.78rem' }}>{c.role}</span>}
              {c.bonus && <span style={{ color: 'var(--brass)', fontWeight: 600 }}>+ {c.bonus}%</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* One party's bond: the total, and the items under it. The items are the point
   — a total nobody can break down is exactly what a dispute is about. */
export function BondBlock({ title, note, items, total, tone }) {
  return (
    <div style={{ marginBottom: '0.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', borderBottom: '1px solid var(--line)', paddingBottom: '0.2rem' }}>
        <span style={{ fontWeight: 600, color: tone || 'var(--text)' }}>
          {title}
          {note && <span className="muted" style={{ fontWeight: 400, fontSize: '0.78rem' }}> ({note})</span>}
        </span>
        <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 600, color: tone || 'var(--text)' }}>{fmtMoney(total)}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: '0.25rem 0 0', padding: 0, fontSize: '0.84rem' }}>
        {items.map((b) => (
          <li key={b.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', padding: '0.1rem 0 0.1rem 0.9rem' }}>
            <span style={{ flex: 1 }}>
              {b.description || <span className="muted">no description</span>}
              {Number(b.qty) > 1 && <span className="muted"> × {b.qty}</span>}
            </span>
            {b.source && <span className="muted" style={{ fontSize: '0.74rem' }}>{b.source}</span>}
            <span className="muted" style={{ fontFamily: 'var(--font-mono, monospace)' }}>{fmtMoney(b.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
