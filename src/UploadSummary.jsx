/* What the note just changed — shown after an upload, above the log.
 *
 * The log line says the file was read. This says what it did: whether it
 * reconciled against its own printed total, whether it replaced a note already
 * on file, what carried it, and where it lands against the year.
 *
 * It is for everybody, not only the demo. A skipper uploading a note wants the
 * same three facts a visitor does, and building it demo-only would have meant a
 * second code path that nobody exercises.
 */
const gbp = (n) => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (n) => (Number(n) || 0).toLocaleString('en-GB')
const plural = (n, one, many) => `${num(n)} ${Number(n) === 1 ? one : many}`

const CHECK = {
  ok: { text: 'reconciles to the penny against the note’s own printed total', tone: 'var(--kelp)' },
  differs: { text: 'does NOT match the note’s printed total', tone: 'var(--rust)' },
  /* Three states, not two. A note with no printed total has not failed — it
   * cannot be checked, and calling that "reconciled" would be a claim nobody
   * made. */
  none: { text: 'the note prints no total, so there is nothing to check it against', tone: 'var(--brass)' },
}

function Figure({ label, value, sub }) {
  return (
    <div style={{ minWidth: '7.5rem' }}>
      <div className="muted" style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: '1.05rem', fontWeight: 600 }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: '0.72rem' }}>{sub}</div>}
    </div>
  )
}

export default function UploadSummary({ items = [] }) {
  if (!items.length) return null
  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      {items.map((s, i) => {
        const chk = CHECK[s.checked] || CHECK.none
        return (
          <div key={i} className="card" style={{ borderLeft: `3px solid ${chk.tone}` }}>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
              <strong>{s.vessel || 'Unknown vessel'}</strong>
              <span className="muted">{s.date || 'no date'}</span>
              <span className="muted">· {s.market}</span>
              {s.saleNo && <span className="muted">· sale {s.saleNo}</span>}
              {/* Replacing a note in place is the normal way a parser fix
                  reaches old data, so it is stated rather than left to be
                  inferred from a landing count that did not move. */}
              <span style={{
                fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 3,
                background: s.isNew ? 'var(--kelp)' : 'var(--hull)', color: '#fff',
              }}>
                {s.isNew ? 'new landing' : 're-read, replaced in place'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '1.4rem', flexWrap: 'wrap', margin: '0.7rem 0 0.4rem' }}>
              <Figure label="Rows read" value={num(s.rows)} sub={`${s.species} species · ${s.buyers} buyers`} />
              <Figure label="Boxes" value={num(s.boxes)} />
              <Figure label="Landed" value={`${num(Math.round(s.weight))} kg`} />
              <Figure label="Gross" value={gbp(s.value)} sub={s.ppk ? `${gbp(s.ppk)} a kilo` : null} />
            </div>

            <p style={{ margin: '0.2rem 0', fontSize: '0.85rem', color: chk.tone }}>
              {s.checked === 'ok' ? '✓ ' : s.checked === 'differs' ? '⚠ ' : '· '}{chk.text}
              {s.diffs && (
                <span className="muted">
                  {' '}— out by {num(s.diffs.boxes)} boxes, {num(s.diffs.weight)} kg, {gbp(s.diffs.value)}
                </span>
              )}
            </p>

            {s.top?.length > 0 && (
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                <span className="muted">Carried by </span>
                {s.top.map((t, k) => (
                  <span key={t.species}>
                    {k > 0 && <span className="muted">, </span>}
                    <strong>{t.species}</strong> <span className="muted">{t.share}%{t.ppk ? ` at ${gbp(t.ppk)}/kg` : ''}</span>
                  </span>
                ))}
              </p>
            )}

            {/* "no new buyers" and "nobody looked" must not read the same, so a
                null fresh list says nothing at all rather than claiming none. */}
            {s.fresh?.length > 0 && (
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                <span className="muted">First time on this boat’s notes: </span>
                <strong>{s.fresh.join(', ')}</strong>
              </p>
            )}

            {s.before && s.after && (
              <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
                {s.before.year}: {plural(s.before.landings, 'landing', 'landings')}, {gbp(s.before.value)}
                {' → '}
                <strong style={{ color: 'var(--ink)' }}>
                  {plural(s.after.landings, 'landing', 'landings')}, {gbp(s.after.value)}
                </strong>
                {s.isNew ? '' : ' — the same landing, its figures replaced'}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
