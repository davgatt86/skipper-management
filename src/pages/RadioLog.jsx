import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { useCurrentVessel } from '../VesselContext'
import { pickDetails } from '../lib/vessels'
import { isSkipper, keepsLogs } from '../lib/roles'
import PickABoat from '../components/PickABoat'
import RadioBody from './certification/RadioBody'
import { radioPart } from '../lib/certification/radio'

/* THE RADIO LOG — SI 1999/3210, Schedule 3.
 *
 * The mate keeps it and the SKIPPER signs each day's entries, which is the
 * distinctive rule and is enforced by RLS rather than by hiding a button.
 */
export default function RadioLog() {
  const { appUser } = useAuth()
  const { current, vessels, multi, hasVessels } = useCurrentVessel()
  const [details, setDetails] = useState(null)
  const [entries, setEntries] = useState([])
  const [days, setDays] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const canSign = isSkipper(appUser)
  const canWrite = keepsLogs(appUser)

  const refresh = useCallback(async () => {
    setErr('')
    if (!current?.id) { setEntries([]); setDays([]); return }
    try {
      const [{ data: vd }, e, d] = await Promise.all([
        supabase.from('vessel_details').select('*'),
        supabase.from('radio_log_entries').select('*').eq('vessel_id', current.id)
          .order('log_date', { ascending: false }),
        supabase.from('radio_log_days').select('*').eq('vessel_id', current.id)
          .order('log_date', { ascending: false }),
      ])
      setDetails(pickDetails(vd || [], current))
      setEntries(e.data || [])
      setDays(d.data || [])
      if (e.error) throw e.error
      if (d.error) throw d.error
    } catch (x) { setErr(x.message || String(x)) }
  }, [current?.id])

  useEffect(() => { refresh() }, [refresh])

  const part = useMemo(() => radioPart(details), [details])

  const run = async (fn, done) => {
    setBusy(true); setErr(''); setMsg('')
    try { await fn(); if (done) setMsg(done); await refresh() }
    catch (x) { setErr(x.message || String(x)) } finally { setBusy(false) }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Certification"
        title="Radio log"
        sub="SI 1999/3210, Schedule 3"
      />
      {err && <div className="card" style={{ borderLeft: '3px solid var(--rust)' }}>{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '3px solid var(--kelp)' }}>{msg}</div>}

      {multi && !current?.id ? (
        <PickABoat
          vessels={vessels}
          reason="A radio log belongs to one vessel, and which Schedule 3 Part she keeps is decided
                  on her own length — a boat of 24 m keeps a different book from one of 23.96 m."
        />
      ) : !hasVessels ? (
        <div className="card">No vessel on file. Add one on <Link to="/vessel">Vessel</Link>.</div>
      ) : (
        <RadioBody
          vessel={current} part={part} entries={entries} days={days}
          canSign={canSign} canWrite={canWrite} busy={busy}
          onAdd={(f) => run(async () => {
            const { error } = await supabase.from('radio_log_entries').insert({
              vessel_id: current.id,
              log_date: f.logDate,
              occurred_at: f.occurredAt || null,
              kind: f.kind,
              summary: String(f.summary || '').trim(),
              station: String(f.station || '').trim() || null,
              position_text: String(f.position || '').trim() || null,
              recorded_by: appUser?.id || null,
            })
            if (error) throw error
          }, 'Logged.')}
          onSign={(date) => run(async () => {
            const { error } = await supabase.from('radio_log_days').insert({
              vessel_id: current.id,
              log_date: date,
              signed_name: appUser?.display_name || appUser?.email,
              signed_by: appUser?.id || null,
            })
            if (error) throw error
          }, 'Signed. Nothing further can be added to that day or changed on it.')}
        />
      )}
    </AppShell>
  )
}
