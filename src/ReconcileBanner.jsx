import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

/* "One of your sales notes did not add up. Upload it again."
 *
 * A note is flagged when the rows the parser found do not match the TOTAL
 * printed on the note itself. That is not cosmetic — the wrapped-row bug fixed
 * in parser 1.3.3 silently dropped A+ rows, and on the Audacious note of
 * 13-08-2026 that was 13 boxes and £2,241.80 of fish missing from the books,
 * plus 13 boxes off the crew's box bonus, on a note that looked fine.
 *
 * WHY A BANNER AND NOT AN ALERT. The skipper is the only person who has the
 * note. Nobody can fix this for him, and an email would just be a message
 * asking him to go and open the app — so it belongs where he already is,
 * saying exactly which note and what it is worth.
 *
 * IT IS DRIVEN BY THE DATA AND CLEARS ITSELF. Re-uploading the note re-parses
 * and replaces the rows in place; when the figures agree the row stops being
 * flagged and the banner goes on its own. Nothing to remember to take down,
 * and a note that breaks next month raises it again without anyone editing a
 * hardcoded list.
 *
 * AND IT CAN BE PUT TO BED. Some notes genuinely cannot be got again — the ten
 * P&J landings are acknowledged in the migration for exactly that reason.
 * Without a way out, a fleet that cannot act would see this every login
 * forever, which is how a banner stops being read.
 */
export default function ReconcileBanner({ compact = false }) {
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    // RLS scopes this to the fleet, so a skipper only ever sees his own notes.
    const { data } = await supabase
      .from('sales_landings')
      .select('id, vessel, landing_date, market, reconcile_diff')
      .eq('reconcile_ok', false)
      .is('reconcile_ack_at', null)
      .order('landing_date', { ascending: false })
    setRows(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  async function ack(id) {
    setBusy(id)
    await supabase.from('sales_landings').update({
      reconcile_ack_at: new Date().toISOString(),
      reconcile_ack_by: (await supabase.auth.getUser()).data?.user?.id ?? null,
      reconcile_ack_note: 'Skipper says this note cannot be uploaded again.',
    }).eq('id', id)
    setBusy('')
    load()
  }

  if (!rows.length) return null

  const total = rows.reduce((a, r) => a + Math.abs(Number(r.reconcile_diff?.diffs?.value) || 0), 0)

  return (
    <div className="card no-print" style={{ borderColor: 'var(--brass)', borderWidth: 2 }}>
      <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>
        {rows.length === 1 ? 'A sales note needs uploading again' : `${rows.length} sales notes need uploading again`}
      </h2>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.9rem' }}>
        These didn’t add up to the total printed on the note itself, so the fish on them is not all in the
        books. It was a fault in the reader — <strong>now fixed</strong>. Upload the same note again on{' '}
        <Link to="/sales">Fish Sales</Link> and it will correct itself; the landing keeps its days at sea and
        its crew, and the crew’s box count is put right with it.
        {total > 0 && <> Between them these are missing about <strong>£{Math.round(total).toLocaleString('en-GB')}</strong>.</>}
      </p>

      <div style={{ display: 'grid', gap: '0.15rem' }}>
        {rows.map((r, i) => {
          const d = r.reconcile_diff?.diffs
          return (
            <div key={r.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap',
                                     borderTop: i ? '1px solid var(--border)' : 'none', padding: '0.35rem 0' }}>
              <span style={{ flex: '1 1 14rem' }}>
                <strong>{r.vessel}</strong>{' '}
                <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>
                  {r.landing_date?.slice(8, 10)}/{r.landing_date?.slice(5, 7)}/{r.landing_date?.slice(0, 4)}
                </span>
                <span className="muted" style={{ fontSize: '0.85rem' }}> · {r.market}</span>
              </span>
              <span className="muted" style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono, monospace)' }}>
                {d?.value
                  ? `short £${Math.abs(Math.round(d.value)).toLocaleString('en-GB')}`
                  : 'amount unrecorded'}
              </span>
              {isSkipper && !compact && (
                <button className="secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.78rem' }}
                        disabled={busy === r.id} onClick={() => ack(r.id)}
                        title="Hide this — the note cannot be got again">
                  {busy === r.id ? '…' : 'Can’t get this note'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
