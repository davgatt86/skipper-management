import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useCurrentVessel } from './VesselContext'

// The registration number is the identity, so the plate leads with the PLN
// and the vessel name sits underneath it.
//
// Solid cobalt with one angled white flash on the far right (see .plate in
// index.css) — the flash is positioned clear of the lettering, and there is
// no repeating pattern behind text.
//
// vessel_details is one row per fleet and RLS scopes it to the signed-in
// fleet, so this needs no fleet filter of its own.

// "BF83" -> "BF 83". Display only; the canonical label stays "NAME REG".
export function formatPln(pln) {
  if (!pln) return ''
  const clean = String(pln).toUpperCase().replace(/\s+/g, '')
  const m = clean.match(/^([A-Z]+)(\d+)$/)
  return m ? `${m[1]} ${m[2]}` : clean
}

// "AUDACIOUS BF83" — the canonical vessel label used in copy and exports.
export function vesselLabel(v) {
  if (!v) return ''
  const name = (v.vessel_name || '').trim().toUpperCase()
  const pln = (v.pln || '').trim().toUpperCase().replace(/\s+/g, '')
  return [name, pln].filter(Boolean).join(' ')
}

/* THE PARTICULARS OF THE BOAT BEING LOOKED AT.
 *
 * Three states, and they are not the same thing — every caller has to be able
 * to tell them apart, which is why this returns a shape rather than a row:
 *
 *   a boat is current      → its particulars. The only case for a
 *                            single-vessel fleet, which is eight of the twelve.
 *   showing ALL of a pair  → `needsChoice`. THERE IS NO SUCH THING AS A PAIR'S
 *                            PARTICULARS: two boats have two registrations and
 *                            two tonnages, and picking one to stand for both
 *                            would put the wrong PLN on a crew list.
 *   no boats at all        → `hasVessels` false. HANSTHOLM.
 *
 * `all` carries every row for the fleet, so a page that CAN show both — the
 * dashboard plate — needs no second query.
 */
export function useVesselDetails() {
  const boat = useCurrentVessel()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancel = false
    ;(async () => {
      const { data, error } = await supabase.from('vessel_details').select('*')
      if (cancel) return
      if (error) console.error('Error loading vessel_details:', error)
      setRows(data || [])
      setLoading(false)
    })()
    return () => { cancel = true }
  }, [])

  const vessel = boat.current
    ? rows.find((r) => r.vessel_id === boat.current.id) || null
    // One row and no choice to make is unambiguous, whatever the picker says.
    : (rows.length === 1 ? rows[0] : null)

  return {
    vessel,
    all: rows,
    loading: loading || boat.loading,
    /* A REAL choice, never a missing one. A fleet with one boat and no
     * particulars row yet is not being asked to choose — it is being asked to
     * fill the form in, and those want different words. */
    needsChoice: boat.multi && !boat.current && rows.length > 1,
    hasVessels: boat.hasVessels,
    current: boat.current,
    vessels: boat.vessels,
  }
}

/* The narrower shape, for pages that only ever want one boat's row and already
 * handle a null. Same data. */
export function useVessel() {
  const { vessel, loading } = useVesselDetails()
  return { vessel, loading }
}

// The fleet's own photo behind the plate, when one has been set. Null falls
// back to the solid cobalt plate — that is the designed default, not a gap.
// Signed URL rather than public: the bucket is fleet-isolated like the others.
export function useFleetHero() {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let cancel = false
    ;(async () => {
      const { data: me } = await supabase.from('app_users').select('fleet_id').eq('id', (await supabase.auth.getUser()).data.user?.id).maybeSingle()
      if (!me?.fleet_id) return
      const { data: fleet } = await supabase.from('fleets').select('hero_path').eq('id', me.fleet_id).maybeSingle()
      if (cancel || !fleet?.hero_path) return
      const { data } = await supabase.storage.from('fleet-photos').createSignedUrl(fleet.hero_path, 3600)
      if (!cancel && data?.signedUrl) setUrl(data.signedUrl)
    })()
    return () => { cancel = true }
  }, [])
  return url
}

export default function VesselPlate({ vessel, loading, children }) {
  const hero = useFleetHero()
  // Nothing to show yet — hold the space rather than flashing an empty plate.
  const reg = formatPln(vessel?.pln)
  const name = vessel?.vessel_name || ''

  const sub = [
    name,
    vessel?.length_m ? `${Number(vessel.length_m).toFixed(2)} m` : null,
    vessel?.home_port || null
  ].filter(Boolean).join(' · ')

  // The photo sits UNDER a cobalt veil, never raw: the registration is the
  // identity and has to stay readable over whatever the photo happens to be.
  const heroStyle = hero
    ? {
        backgroundImage: `linear-gradient(90deg, color-mix(in srgb, var(--hull) 88%, transparent) 0%, color-mix(in srgb, var(--hull) 62%, transparent) 100%), url("${hero}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : undefined

  return (
    <div className="plate" style={heroStyle}>
      <div>
        <div className="reg">{loading ? ' ' : (reg || name.toUpperCase() || 'Vessel')}</div>
        {!loading && sub && <div className="vessel">{sub}</div>}
        {children}
      </div>
    </div>
  )
}
