/* THE DAY TALLY READ AGAINST THE SALES NOTE.
 *
 * David, Oct 2026: *"i think the good seed was sold as A2 due to it not being
 * graded perfectly onboard that trip by the crew. therefore it was sold as the
 * same grade as seed on the eAuction. maybe the splitter should allow for that.
 * user could upload a tally to check against sales note?"*
 *
 * IT IS ITS OWN FILE SO IT CAN BE RENDERED. `Sales.jsx` drags the supabase
 * client in behind it and cannot be server-rendered, so a panel living inside
 * it could only ever be checked by eye on a real login — and this one carries
 * the whole of the downgrade reasoning. Same reason `SheetBody` is exported
 * from `MarketSheet.jsx` and `Arrivals.jsx` is a file of its own.
 *
 * The table styles are exported FROM HERE and imported by the page, rather than
 * copied: one definition, owned by the file that can be rendered.
 */
export const th = { textAlign: 'left', padding: '0.45rem 0.6rem', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap', color: 'var(--navy)' }
export const td = { padding: '0.45rem 0.6rem', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
export const tdR = { ...td, textAlign: 'right' }
export const thR = { ...th, textAlign: 'right' }

export function Scroll({ children }) {
  return <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>{children}</div>
}

export default function TallyCheck({
  ladder, downgrades = [], addedBand, loaded,
  onPick, onAddBand, onClearBand, onUseTotals,
}) {
  return (
    <div className="no-print" style={{ marginBottom: '0.75rem' }}>
      <button className="secondary" onClick={onPick}>
        {loaded ? 'Check against a different tally' : 'Check against the day tally'}
      </button>
      {ladder && (() => {
      /* ONLY THE SIZES A CANDIDATE ACTUALLY NAMES ARE MARKED. Colouring every
         gap over some threshold put brass on A4's +3 — which is the ordinary
         difference between a count at sea and the scales, and which the panel
         then says nothing about. A mark that points at nothing is how a reader
         learns to ignore the marks that mean something. */
      const flagged = new Set(downgrades.flatMap(c => [c.fromDigit, c.toDigit]))
      return <div style={{ marginTop: '0.6rem' }}>
        {/* THE TOTALS ARE NOT MEANT TO AGREE, and saying so first is what stops
            the table reading as a list of errors. The tally is counted at sea
            before anything is weighed: 305 boxes of haddock against the 280 the
            note sold, on the trip this was built against. */}
        <div className="muted" style={{ fontSize: '0.78rem', marginBottom: '0.3rem' }}>
          What the crew graded against what the market sold. The tally counted{' '}
          {ladder.tallyTotal} boxes of {ladder.noteName.toLowerCase()} at sea and the note sold{' '}
          {ladder.noteTotal}, so the two are compared by share rather than box for box.
        </div>
        <Scroll>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.82rem' }}>
            <thead><tr>
              <th style={th}>Sold as</th><th style={th}>Graded by the crew</th>
              <th style={thR}>Crew</th><th style={thR}>Note</th><th style={thR}>Share gap</th>
            </tr></thead>
            <tbody>
              {ladder.rows.map(r => (
                <tr key={r.digit}>
                  <td style={td}>A{r.digit}</td>
                  <td style={td}>{r.codes.map(c => `${c.name} (${c.code}) ${c.boxes}`).join(', ') || '—'}</td>
                  <td style={tdR}>{r.tallyBoxes} · {r.tallyShare}%</td>
                  <td style={tdR}>{r.noteBoxes} · {r.noteShare}%</td>
                  {/* Brass, not rust: a gap is a question about the auction's
                      reading of the fish, not a fault in either document. */}
                  <td style={{ ...tdR, color: flagged.has(r.digit) ? 'var(--brass)' : undefined }}>
                    {r.gap == null ? '—' : `${r.gap > 0 ? '+' : ''}${r.gap}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
        {/* A rung the crew graded with no code cannot be placed, and is named
            rather than dropped — the shares would otherwise add to less than
            the fish counted. */}
        {ladder.unplaced?.length > 0 && <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.3rem' }}>
          Not on the ladder, so not compared: {ladder.unplaced.map(u => `${u.name} ${u.boxes}`).join(', ')}.
        </div>}

        {/* OFFERED, NEVER CONCLUDED. The app cannot tell loose grading from a
            wheelhouse miscount, so it names the rung and the skipper decides. */}
        {downgrades.map(c => (
          <div key={c.code} style={{ marginTop: '0.5rem', padding: '0.5rem 0.6rem', border: '1px solid var(--brass)', borderRadius: 4 }}>
            <div style={{ fontSize: '0.85rem' }}>
              <strong>A{c.fromDigit} sold {c.offset} points short and A{c.toDigit} the same over.</strong>{' '}
              The smallest grade in A{c.fromDigit} is <strong>{c.name} ({c.code})</strong>, {c.boxes} boxes,
              which accounts for {c.explains}% of the gap. If the crew graded it loosely it would have sold
              as A{c.toDigit}.
            </div>
            {addedBand === c.name
              ? <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.3rem' }}>
                  {c.name} is a band in the A{c.toDigit} split below.{' '}
                  <button className="secondary" style={{ padding: '0.1rem 0.4rem', fontSize: '0.75rem' }}
                    onClick={onClearBand}>Take it back out</button>
                </div>
              : <button className="secondary" style={{ marginTop: '0.3rem', padding: '0.15rem 0.5rem', fontSize: '0.78rem' }}
                  onClick={() => onAddBand(c.name)}>
                  Add {c.name} to the A{c.toDigit} split
                </button>}
          </div>
        ))}
        {/* NOTHING FOUND IS AN ANSWER, and must not read like a blank panel. */}
        {!downgrades.length && <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.3rem' }}>
          No grade looks to have sold a size down — every share agrees within 3 points, which is the
          ordinary difference between a count at sea and the scales.
        </div>}
        <button className="secondary" style={{ marginTop: '0.5rem' }} onClick={onUseTotals}>
          Use the tally's boxes as the totals
        </button>
      </div>
      })()}
    </div>
  )
}
