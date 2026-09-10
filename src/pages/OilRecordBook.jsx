import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { useCurrentVessel } from '../VesselContext'
import { pickDetails } from '../lib/vessels'
import { isSkipper } from '../lib/roles'
import PickABoat from '../components/PickABoat'
import OrbBody from './certification/OrbBody'
import { orbRequired } from '../lib/certification/orb'
import {
  listPages, listEntries, openPage, closePage, signPage, addEntry, correctEntry,
} from '../lib/certification/orbDb'

/* THE OIL RECORD BOOK PART I.
 *
 * All the judgement is in `lib/certification/orb.js` and all the drawing is in
 * `certification/OrbBody.jsx`; this file does the IO and nothing else, so the
 * book can be server-rendered by `scripts/orb-preview.mjs`.
 *
 * A BOOK IS ABOUT ONE HULL. A pair team showing "all" is asked which boat
 * rather than shown a merged book — the entries would be a record of two
 * different machinery spaces run together, which is not a record of either.
 */
export default function OilRecordBook() {
  const { appUser } = useAuth()
  const { current, vessels, multi, hasVessels } = useCurrentVessel()
  const [details, setDetails] = useState(null)
  const [pages, setPages] = useState([])
  const [entries, setEntries] = useState([])
  /* The fuel log side of the reconciliation. Read here rather than in the
     body so the body stays prop-driven and can be server-rendered. */
  const [fuelRows, setFuelRows] = useState([])
  const [correcting, setCorrecting] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const canSign = isSkipper(appUser)

  const refresh = useCallback(async () => {
    setErr('')
    if (!current?.id) { setPages([]); setEntries([]); setFuelRows([]); return }
    try {
      const [{ data: vd }, p, e, fl] = await Promise.all([
        supabase.from('vessel_details').select('*'),
        listPages(current.id),
        listEntries(current.id),
        /* WHOLE, and filtered in `orbLink`. The kinds the book wants are a
           minority of the log and the rows that predate `vessel_id` belong to
           the fleet's only boat, so the scoping is a decision rather than a
           where clause. */
        supabase.from('vessel_fuel_log')
          .select('id, kind, entry_date, litres, grade, location, counterparty, vessel_id')
          .order('entry_date', { ascending: false }),
      ])
      setDetails(pickDetails(vd || [], current))
      setPages(p)
      setEntries(e)
      setFuelRows(fl.data || [])
    } catch (x) { setErr(x.message || String(x)) }
  }, [current?.id])

  useEffect(() => { refresh() }, [refresh])

  const required = useMemo(() => orbRequired(details), [details])

  const run = async (fn, done) => {
    setBusy(true); setErr(''); setMsg('')
    try { await fn(); if (done) setMsg(done); await refresh() }
    catch (x) { setErr(x.message || String(x)) } finally { setBusy(false) }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Certification"
        title="Oil Record Book"
        sub="Part I — machinery space operations, MARPOL Annex I Appendix III"
      />

      {err && <div className="card" style={{ borderLeft: '3px solid var(--rust)' }}>{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '3px solid var(--kelp)' }}>{msg}</div>}

      {multi && !current?.id ? (
        <PickABoat
          vessels={vessels}
          reason="An Oil Record Book is the record of ONE ship's machinery space. Two boats'
                  entries run together would not be a record of either, and a surveyor asks for
                  the book of the vessel he is standing on."
        />
      ) : !hasVessels ? (
        <div className="card">No vessel on file. Add one on <Link to="/vessel">Vessel</Link>.</div>
      ) : (
        <OrbBody
          vessel={current} required={required} pages={pages} entries={entries}
          fuelRows={fuelRows}
          canSign={canSign} busy={busy}
          onOpenPage={(n) => run(() => openPage(current.id, n), `Page ${n} opened.`)}
          onClosePage={(id) => run(() => closePage(id), 'Page closed. It still needs the master.')}
          onSignPage={(id) => run(
            () => signPage(id, { userId: appUser?.id, name: appUser?.name || appUser?.email }),
            'Signed. Nothing further can be entered on that page.')}
          onAddEntry={(e) => run(async () => {
            await (correcting
              ? correctEntry(correcting.id, { ...e, vesselId: current.id, userId: appUser?.id })
              : addEntry({ ...e, vesselId: current.id, userId: appUser?.id }))
            setCorrecting(null)
          }, 'Entry made.')}
          onCorrect={(entry) => {
            setCorrecting(entry)
            setMsg('The next entry you make will be recorded as correcting that one. '
              + 'The original stays exactly as written.')
          }}
        />
      )}
    </AppShell>
  )
}
