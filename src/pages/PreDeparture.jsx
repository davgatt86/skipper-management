import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useCurrentVessel } from '../VesselContext'
import { predeparture, DEFAULT_GUIDES } from '../lib/certification/predeparture'
import { loadGuides, saveGuides } from '../lib/certification/logbookSettingsDb'
import { useAuth } from '../AuthContext'
import PreDepartureBody from './certification/PreDepartureBody'

/* BEFORE SHE SAILS — the eight entries, each in its own book.
 *
 * This does the IO and nothing else; all the deciding is in
 * `lib/certification/predeparture.js` and all the drawing in
 * `PreDepartureBody.jsx`, so the page can be server-rendered.
 *
 * IT READS SEVEN TABLES AND WRITES NONE. Every entry is made in the book that
 * owns it — a second place to write a legal record is a second version of it.
 */
export default function PreDeparture() {
  const { current } = useCurrentVessel()
  const { appUser } = useAuth()
  const [guides, setGuides] = useState(DEFAULT_GUIDES)
  const [stored, setStored] = useState({})
  const [trips, setTrips] = useState([])
  const [picked, setPicked] = useState(null)
  const [books, setBooks] = useState({})
  const [err, setErr] = useState('')

  const refresh = useCallback(async () => {
    setErr('')
    if (!current?.id) { setTrips([]); setBooks({}); return }
    try {
      /* THE DEPARTURES COME OFF THE LOGBOOK. `quota_trips.departure_at` is
         already the record of when she sailed; `vessel_departures` is an AIS
         feed of other boats and is NOT this. */
      const [t, cl, radio, olb, fuel, orb, garb] = await Promise.all([
        supabase.from('quota_trips')
          .select('id, departure_at, departure_port, trip_nr')
          .eq('vessel_id', current.id)
          .not('departure_at', 'is', null)
          .order('departure_at', { ascending: false }).limit(24),
        supabase.from('crew_lists').select('id, departure_date, created_at'),
        supabase.from('radio_log_entries').select('id, kind, log_date'),
        supabase.from('official_log_book_entries').select('id, entry_n, occurred_on'),
        supabase.from('vessel_fuel_log').select('id, kind, entry_date, litres'),
        supabase.from('oil_record_book_entries').select('id, fuel_log_id'),
        supabase.from('garbage_log').select('id, entry_date'),
      ])
      /* The boat’s own guides. A fleet with no row is the ordinary case — it
         means the shipped ones, unchanged. */
      const g = await loadGuides()
      setGuides(g.guides)
      setStored(g.stored)
      const list = (t.data || []).map((x) => String(x.departure_at).slice(0, 10))
      setTrips(list)
      setBooks({
        crewLists: cl.data || [], radioEntries: radio.data || [],
        olbEntries: olb.data || [], fuelRows: fuel.data || [],
        orbEntries: orb.data || [], garbageRows: garb.data || [],
      })
    } catch (x) { setErr(x.message || String(x)) }
  }, [current?.id])

  useEffect(() => { refresh() }, [refresh])

  const departure = picked || trips[0] || null
  /* The sailing BEFORE the one being checked, which is what bounds the window.
     Not simply trips[1] — he may have picked an older one. */
  const previous = useMemo(() => {
    const i = trips.indexOf(departure)
    return i >= 0 ? trips[i + 1] || null : null
  }, [trips, departure])

  const check = useMemo(
    () => predeparture({ departureAt: departure, previousDepartureAt: previous, guides, ...books }),
    [departure, previous, books, guides])

  return (
    <AppShell>
      <PageHeader
        eyebrow="Certification"
        title="Before she sails"
        sub="The entries a departure wants, and the book each one belongs in"
      />
      {err && <div className="card" style={{ borderLeft: '3px solid var(--rust)' }}>{err}</div>}
      <PreDepartureBody
        vessel={current} check={check} departures={trips} onPick={setPicked}
        onGuide={async (olbN, days) => {
          /* ONLY THE DIFFERENCE IS STORED. Setting one back to the shipped
             guide REMOVES it rather than writing today’s default in, so a
             later correction still reaches this boat. */
          const next = { ...stored }
          if (days === DEFAULT_GUIDES[olbN]) delete next[olbN]
          else next[olbN] = days
          setStored(next)
          setGuides(await saveGuides(next, { fleetId: appUser?.fleet_id, userId: appUser?.id }))
        }} />
    </AppShell>
  )
}
