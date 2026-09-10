import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useCurrentVessel } from '../VesselContext'
import { predeparture, DEFAULT_GUIDES, crewChangeBetween } from '../lib/certification/predeparture'
import { loadGuides, saveGuides } from '../lib/certification/logbookSettingsDb'
import { listSkips, skipItem, unskipItem } from '../lib/certification/skipsDb'
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
  const [skips, setSkips] = useState([])
  const [err, setErr] = useState('')

  const refresh = useCallback(async () => {
    setErr('')
    if (!current?.id) { setTrips([]); setBooks({}); return }
    try {
      /* THE DEPARTURES COME OFF THE LOGBOOK. `quota_trips.departure_at` is
         already the record of when she sailed; `vessel_departures` is an AIS
         feed of other boats and is NOT this. */
      const [t, cl, members, radio, olb, fuel, orb, garb] = await Promise.all([
        supabase.from('quota_trips')
          .select('id, departure_at, departure_port, trip_nr')
          .eq('vessel_id', current.id)
          .not('departure_at', 'is', null)
          .order('departure_at', { ascending: false }).limit(24),
        supabase.from('crew_lists').select('id, departure_date, created_at'),
        supabase.from('crew_list_members').select('crew_list_id, crew_id, full_name'),
        supabase.from('radio_log_entries').select('id, kind, log_date'),
        supabase.from('official_log_book_entries').select('id, entry_n, occurred_on'),
        supabase.from('vessel_fuel_log').select('id, kind, entry_date, litres'),
        supabase.from('oil_record_book_entries').select('id, fuel_log_id'),
        supabase.from('garbage_log').select('id, entry_date'),
      ])
      /* The boat’s own guides. A fleet with no row is the ordinary case — it
         means the shipped ones, unchanged. */
      const g = await loadGuides()
      setSkips(await listSkips(current.id))
      setGuides(g.guides)
      setStored(g.stored)
      const list = (t.data || []).map((x) => String(x.departure_at).slice(0, 10))
      setTrips(list)
      setBooks({
        crewLists: cl.data || [], members: members.data || [],
        radioEntries: radio.data || [],
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

  /* WHO IS NEW SINCE THE LAST VOYAGE. The crew list for this departure
     against the one before it — the app holds both, so it can say who rather
     than leaving it to somebody to remember.

     The lists are matched to a departure by DATE, which is what a crew list
     carries; two lodged for one departure take the later one, because that
     is the correction. */
  const crewChange = useMemo(() => {
    const { crewLists = [], members = [] } = books
    const forDate = (d) => {
      if (!d) return null
      const mine = crewLists
        .filter((c) => String(c.departure_date || '').slice(0, 10) === d)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      return mine[0] || null
    }
    const now = forDate(departure)
    const was = forDate(previous)
    if (!now || !was) return null
    const of = (list) => members.filter((m) => m.crew_list_id === list.id)
    return crewChangeBetween(of(was), of(now))
  }, [books, departure, previous])

  const check = useMemo(
    () => predeparture({
      departureAt: departure, previousDepartureAt: previous, guides, crewChange, skips, ...books,
    }),
    [departure, previous, books, guides, crewChange, skips])

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
        }}
        onSkip={async (row) => {
          /* THE REASON IS ASKED FOR AND MAY BE LEFT BLANK. "It did not
             happen" is the answer; why is a courtesy to whoever reads it
             later, and demanding one would make the skip cost more than
             writing the entry. */
          const reason = window.prompt('Why did it not happen this trip? (optional)') ?? ''
          await skipItem({
            fleetId: appUser?.fleet_id, vesselId: current?.id, departureOn: departure,
            itemKey: row.key, reason,
            userId: appUser?.id, name: appUser?.name || appUser?.email,
          })
          setSkips(await listSkips(current?.id))
        }}
        onUnskip={async (row) => {
          await unskipItem({ vesselId: current?.id, departureOn: departure, itemKey: row.key })
          setSkips(await listSkips(current?.id))
        }} />
    </AppShell>
  )
}
