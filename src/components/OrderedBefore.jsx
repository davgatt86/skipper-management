import { itemNote } from '../lib/stores/history'

/* WHAT SHE USUALLY ORDERS — the quick-add panel above the stores catalogue.
 *
 * The catalogue is 334 items and a trip uses about sixty of them, largely the
 * same sixty. Rebuilding that by hand each trip is the work this removes: the
 * lines already kept ARE the record of what gets bought, so the next list can
 * start from them.
 *
 * THE HEADING CHANGES WITH HOW MUCH IS BEHIND IT. One previous list is not a
 * habit, and a panel headed "Regularly ordered" on the strength of a single
 * trip is a confident lie about the boat's own routine — so at one list it
 * says "Ordered last trip" and admits it is not a pattern yet. Same discipline
 * as the gear life figures and `groundConfidence()`.
 *
 * SPLIT OUT OF `Stores.jsx` so it can be rendered without a login.
 * `scripts/ordered-before-preview.mjs` server-renders it against the boat's
 * REAL kept lines — the page itself is behind auth and a fleet, so inline it
 * could only ever be checked by eye, on somebody else's device.
 */
export default function OrderedBefore({ hist, byKey, open, onToggle, onAdd }) {
  if (!hist || !hist.trips) return null

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>{hist.heading}</h3>
        <span className="muted" style={{ fontSize: '0.8rem' }}>{hist.basis}</span>
        <button className="secondary" style={{ marginLeft: 'auto' }} onClick={onToggle}>
          {open ? 'Hide' : `Show ${hist.items.length}`}
        </button>
      </div>
      {open && (
        <>
          <p className="muted" style={{ margin: '0.5rem 0 0.7rem', fontSize: '0.8rem' }}>
            Tap to put it on this list at the usual quantity. Anything already on the
            list is left out.
            {/* Audacious's last real list carried 64 items. "Here is what you
                usually order" quietly missing a third of it is the kind of gap
                nobody notices until the shop delivers. */}
            {hist.total > hist.items.length
              && ` Showing the top ${hist.items.length} of ${hist.total} — the rest are in the catalogue below.`}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {hist.items.map((h) => {
              /* Prefer the CATALOGUE entry, so the current name, unit and
                 translations are used; fall back to what the old line recorded
                 for an item since removed from it. */
              const item = byKey?.get(h.key)
                || { key: h.key, name: h.name, category: h.category, unit: h.unit,
                     section: h.section, pack: h.packSize }
              return (
                <button key={h.key} className="secondary"
                        onClick={() => onAdd(item, h.typicalQty)}
                        title={`${item.name} — ordered ${itemNote(h)}`}
                        style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'baseline' }}>
                  <span>{item.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700 }}>
                    {h.typicalQty}
                  </span>
                  <span className="muted" style={{ fontSize: '0.72rem' }}>{itemNote(h)}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
