/* WHAT THE READER MADE OF THE PHOTO, said above the form it has filled.
 *
 * A component of its own for the same reason as Trouble.jsx: Engine Logs is
 * behind a login and drags the supabase client in behind it, so the only way to
 * check what this panel says is to render it on its own
 * (scripts/sheet-read-preview.mjs).
 *
 * THE ONE SENTENCE IT MUST ALWAYS CARRY is that nothing is saved yet. A form
 * that filled itself looks finished, and a log saved unchecked off a photograph
 * is a record nobody read. The count to check is LIVE — it falls as the marked
 * figures are touched — so the panel reports the work left, not the work found.
 */

const fmtDay = (iso) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-')
  return y && m && d ? `${d}-${m}-${y}` : String(iso || '')
}

export default function SheetReadCard({ read, sameDayAs, onDiscard }) {
  if (!read) return null
  const { summary = {}, flags = {}, layout, layoutMatches, expectedLayout, dateNote, readDate, photoUrl } = read
  const toCheck = Object.keys(flags).length
  const nothing = !summary.read

  const notes = []
  if (!nothing && layout && !layoutMatches) {
    notes.push(`This sheet is layout ${layout} and the app now prints ${expectedLayout || 'a newer layout'}. Rows may sit in different places, so check each figure by its name.`)
  }
  if (!nothing && !layout) {
    notes.push('No layout code was read, so this may be an older sheet. Check each figure by its name.')
  }
  if (dateNote === 'unread') notes.push('The date could not be read, so today’s date is filled in. Set it from the sheet.')
  if (dateNote === 'impossible') notes.push(`The date read off the sheet (${readDate}) is not a real date, so today’s is filled in. Set it from the sheet.`)
  if (dateNote === 'future') notes.push(`The date read off the sheet (${fmtDay(readDate)}) is in the future, so today’s is filled in. Set it from the sheet.`)
  if (sameDayAs) notes.push(`There is already a log for ${fmtDay(sameDayAs)}. Save this only if it is a second set of readings that day.`)

  return (
    <div className="card" role="status" style={{ borderColor: 'var(--brass)', margin: '0 0 1rem' }}>
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', alignItems: 'start' }}>
        <div>
          <h3 style={{ marginTop: 0 }}>Read from a photo of the sheet</h3>
          {nothing ? (
            <p style={{ fontWeight: 600 }}>
              Nothing was read off this photo. Check it is the engine room sheet with the figures in shot, then try another photo or type the figures in.
            </p>
          ) : (
            <p style={{ fontWeight: 600 }}>
              {summary.read} figure{summary.read === 1 ? '' : 's'} read · {summary.blank} left blank · {toCheck ? `${toCheck} marked to check` : 'none marked to check'}
            </p>
          )}
          <p className="muted" style={{ fontSize: '0.88rem' }}>
            Nothing is saved until you press Save. Check every figure against the paper sheet
            {toCheck ? ' — the ones marked in brass most of all' : ''}. The usual checks on ranges and running hours still run when you save.
          </p>
          {notes.length > 0 && (
            <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', fontSize: '0.88rem' }}>
              {notes.map((n) => <li key={n} style={{ marginBottom: '0.25rem' }}>{n}</li>)}
            </ul>
          )}
          {onDiscard && (
            <div style={{ marginTop: '0.6rem' }}>
              <button type="button" className="secondary" onClick={onDiscard} style={{ padding: '0.3rem 0.7rem', fontSize: '0.82rem' }}>Discard this read</button>
            </div>
          )}
        </div>
        <div>
          {photoUrl ? (
            <>
              <a href={photoUrl} target="_blank" rel="noopener noreferrer">
                <img src={photoUrl} alt="The photographed engine room sheet"
                  style={{ width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)' }} />
              </a>
              <div style={{ fontSize: '0.82rem', marginTop: '0.3rem' }}>
                <a href={photoUrl} target="_blank" rel="noopener noreferrer">Open the photo full size</a>
              </div>
            </>
          ) : (
            <p className="muted" style={{ fontSize: '0.85rem' }}>The photo is stored, but a link to show it here could not be made.</p>
          )}
        </div>
      </div>
    </div>
  )
}
