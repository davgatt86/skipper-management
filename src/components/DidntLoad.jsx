/* "That didn't load" — said in one voice, and never as an instruction to go and
 * fix the database.
 *
 * BOTH PAGES THAT NEEDED THIS USED TO NAME A .sql FILE. Daily Prices said "the
 * market tables aren't set up yet — run supabase/market_prices.sql in
 * Supabase", and Quota said the same about quota_manual.sql. Three things wrong
 * with that, and only the first is manners:
 *
 *   1. It hands a man on a boat a database console. He cannot act on it at sea,
 *      and a missing table is an operator's problem, never his.
 *   2. IT ASSERTED A CAUSE IT DID NOT KNOW, and the one time Daily Prices ever
 *      fired it was WRONG: the tables were there all along, and sixty parallel
 *      reads had blown the statement timeout. A performance fault wearing the
 *      costume of a missing migration.
 *   3. Both migrations have been applied for months, so the only reader who
 *      could ever have seen it truthfully is a brand-new tenant mid-setup.
 *
 * So this says WHAT happened, says what is safe, offers the one thing that
 * helps a skipper — try again, because the real occurrence was transient — and
 * carries the server's own words in small type for whoever can act on them. A
 * genuinely missing table still reports itself there, in Postgres's wording,
 * which is more use to an operator than a filename was to a skipper.
 *
 * `reassurance` is per page and is the point of the component being shared
 * rather than copied: what is safe differs. The market board is on the server,
 * so nothing local is lost; on Quota the rest of the page stands on its own.
 */
export default function DidntLoad({ what, reassurance, why, busy, onRetry }) {
  return (
    <div className="card" style={{ marginBottom: '1rem', borderLeft: '3px solid var(--brass)' }}>
      <p style={{ margin: 0, fontWeight: 600 }}>{what}</p>
      {reassurance && (
        <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>{reassurance}</p>
      )}
      <div style={{ marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap' }}>
        {onRetry && (
          <button className="secondary" disabled={busy} onClick={onRetry}>
            {busy ? 'Trying…' : 'Try again'}
          </button>
        )}
        {/* The server's wording, not a diagnosis of it. Monospaced and muted
            because it is for whoever can act on it, not for the reader. */}
        {why && (
          <span style={{ fontSize: '0.78rem', color: 'var(--mute)', fontFamily: 'var(--font-mono)' }}>
            {why}
          </span>
        )}
      </div>
    </div>
  )
}
