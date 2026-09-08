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
import OlbBody from './certification/OlbBody'
import { olbRequired } from '../lib/certification/olb'
import {
  listBooks, listEntries, openBook, closeBook, deliverBook, addEntry, correctEntry,
} from '../lib/certification/olbDb'

/* THE OFFICIAL LOG BOOK — SI 1981/570.
 *
 * All the judgement is in `lib/certification/olb.js` and all the drawing is in
 * `certification/OlbBody.jsx`; this does the IO and nothing else, so the book
 * can be server-rendered by `scripts/olb-preview.mjs`.
 *
 * ONE BOOK PER HULL. A pair team showing "all" is asked which boat: the book
 * names the vessel in its very first entry, and two boats' drills and
 * accidents run together would be a record of neither.
 */
export default function OfficialLogBook() {
  const { appUser } = useAuth()
  const { current, vessels, multi, hasVessels } = useCurrentVessel()
  const [details, setDetails] = useState(null)
  const [books, setBooks] = useState([])
  const [entries, setEntries] = useState([])
  const [correcting, setCorrecting] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const canOpen = isSkipper(appUser)

  const refresh = useCallback(async () => {
    setErr('')
    if (!current?.id) { setBooks([]); setEntries([]); return }
    try {
      const [{ data: vd }, b, e] = await Promise.all([
        supabase.from('vessel_details').select('*'),
        listBooks(current.id),
        listEntries(current.id),
      ])
      setDetails(pickDetails(vd || [], current))
      setBooks(b)
      setEntries(e)
    } catch (x) { setErr(x.message || String(x)) }
  }, [current?.id])

  useEffect(() => { refresh() }, [refresh])

  const required = useMemo(() => olbRequired(details), [details])

  const run = async (fn, done) => {
    setBusy(true); setErr(''); setMsg('')
    try { await fn(); if (done) setMsg(done); await refresh() }
    catch (x) { setErr(x.message || String(x)) } finally { setBusy(false) }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Certification"
        title="Official Log Book"
        sub="SI 1981/570 — the 33 prescribed entries"
      />

      {err && <div className="card" style={{ borderLeft: '3px solid var(--rust)' }}>{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '3px solid var(--kelp)' }}>{msg}</div>}

      {multi && !current?.id ? (
        <PickABoat
          vessels={vessels}
          reason="An official log book names its vessel in entry 1 and belongs to that hull. Two
                  boats' drills, inspections and accidents run together would be a record of
                  neither, and it is delivered to the superintendent as one book."
        />
      ) : !hasVessels ? (
        <div className="card">No vessel on file. Add one on <Link to="/vessel">Vessel</Link>.</div>
      ) : (
        <OlbBody
          vessel={current} required={required} books={books} entries={entries}
          canOpen={canOpen} busy={busy}
          onOpenBook={(f) => run(() => openBook(current.id, f), 'Book opened.')}
          onCloseBook={(id, f) => run(() => closeBook(id, f),
            'Closed. Nothing further can be entered, and it goes to the superintendent within 48 hours.')}
          onDeliver={(id, f) => run(() => deliverBook(id, f), 'Delivery recorded.')}
          onAddEntry={(e) => run(async () => {
            await (correcting
              ? correctEntry(correcting.id, { ...e, vesselId: current.id, userId: appUser?.id })
              : addEntry({ ...e, vesselId: current.id, userId: appUser?.id }))
            setCorrecting(null)
          }, 'Entry made.')}
          onCorrect={(entry) => {
            setCorrecting(entry)
            setMsg('The next entry you make will be recorded as amending that one. '
              + 'The original stays exactly as written — that is what reg 9 allows.')
          }}
        />
      )}
    </AppShell>
  )
}
