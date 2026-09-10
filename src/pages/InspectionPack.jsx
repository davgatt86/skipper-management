import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useCurrentVessel } from '../VesselContext'
import { useVesselDetails } from '../VesselPlate'
import { inspectionPack } from '../lib/certification/inspectionPack'
import { exportPackPdf } from '../lib/certification/exportPack'
import InspectionPackBody from './certification/InspectionPackBody'

/* THE INSPECTION PACK — IO only.
 *
 * All the deciding is in `lib/certification/inspectionPack.js` and all the
 * drawing in `InspectionPackBody.jsx` / `exportPack.js`, so both the screen and
 * the PDF are built from ONE result and cannot disagree with each other. That
 * is the chalk-sheet-and-catalogue lesson: two documents rendered perfectly and
 * said different things because the ordering was worked out twice.
 *
 * IT READS TWELVE TABLES AND WRITES NONE.
 */

const iso = (d) => d.toISOString().slice(0, 10)

// A year back to today is the window a surveyor asks about, and it is only a
// starting point — both ends are editable.
function defaultPeriod() {
  const to = new Date()
  const from = new Date(to)
  from.setFullYear(from.getFullYear() - 1)
  return { from: iso(from), to: iso(to) }
}

export default function InspectionPack() {
  const { current } = useCurrentVessel()
  const details = useVesselDetails()
  const [{ from, to }, setPeriod] = useState(defaultPeriod)
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const refresh = useCallback(async () => {
    setErr('')
    try {
      const [
        vesselCerts, crew, crewCerts, assessments, hazards, briefings,
        equipment, examinations, tasks, events, selfCerts, crewLists,
        familiarisation, olb, orb, radio, garbage, fuel, engine,
      ] = await Promise.all([
        supabase.from('vessel_certificates').select('*'),
        supabase.from('crew').select('*'),
        supabase.from('crew_certificates').select('*'),
        supabase.from('risk_assessments').select('*'),
        supabase.from('risk_assessment_hazards').select('*'),
        supabase.from('risk_assessment_briefings').select('*'),
        supabase.from('work_equipment').select('*'),
        supabase.from('equipment_examinations').select('*'),
        supabase.from('maintenance_tasks').select('*'),
        supabase.from('maintenance_events').select('*'),
        supabase.from('self_certifications').select('*'),
        supabase.from('crew_lists').select('id, departure_date'),
        supabase.from('crew_familiarisation').select('id, completed_at'),
        supabase.from('official_log_book_entries').select('id, entry_n, occurred_on'),
        supabase.from('oil_record_book_entries').select('id, entry_date'),
        supabase.from('radio_log_entries').select('id, kind, log_date'),
        supabase.from('garbage_log').select('id, entry_date'),
        supabase.from('vessel_fuel_log').select('id, kind, entry_date'),
        supabase.from('engine_logs').select('id, log_date'),
      ])
      /* A READ THAT FAILED AND A TABLE THAT IS EMPTY MUST NOT LOOK ALIKE —
         which matters more here than anywhere else in the app, because an
         empty table is reported as a HOLE and a surveyor is handed that. A
         permission error silently read as [] would print "no entries at all"
         against a book that is being kept. */
      const bad = [
        ['vessel_certificates', vesselCerts], ['crew', crew],
        ['crew_certificates', crewCerts], ['risk_assessments', assessments],
        ['risk_assessment_hazards', hazards], ['risk_assessment_briefings', briefings],
        ['work_equipment', equipment], ['equipment_examinations', examinations],
        ['maintenance_tasks', tasks], ['maintenance_events', events],
        ['self_certifications', selfCerts], ['crew_lists', crewLists],
        ['crew_familiarisation', familiarisation],
        ['official_log_book_entries', olb], ['oil_record_book_entries', orb],
        ['radio_log_entries', radio], ['garbage_log', garbage],
        ['vessel_fuel_log', fuel], ['engine_logs', engine],
      ].filter(([, r]) => r.error)
      if (bad.length) {
        throw new Error(
          `Could not read ${bad.map(([n]) => n).join(', ')}. The pack is not built: `
          + 'a table this login cannot read would otherwise be reported as a book '
          + 'with no entries.')
      }

      setRows({
        vesselCerts: vesselCerts.data || [],
        crew: crew.data || [],
        crewCerts: crewCerts.data || [],
        assessments: assessments.data || [],
        hazards: hazards.data || [],
        briefings: briefings.data || [],
        equipment: equipment.data || [],
        examinations: examinations.data || [],
        tasks: tasks.data || [],
        events: events.data || [],
        selfCerts: selfCerts.data || [],
        crewLists: crewLists.data || [],
        familiarisation: familiarisation.data || [],
        books: {
          olb: olb.data || [], orb: orb.data || [], radio: radio.data || [],
          garbage: garbage.data || [], fuel: fuel.data || [], engine: engine.data || [],
        },
      })
    } catch (x) {
      setRows(null)
      setErr(x.message || String(x))
    }
  }, [current?.id])

  useEffect(() => { refresh() }, [refresh])

  const pack = useMemo(() => {
    if (!rows) return null
    return inspectionPack({ from, to, vessel: current, details, ...rows })
  }, [rows, from, to, current, details])

  return (
    <AppShell>
      <PageHeader
        eyebrow="Certification"
        title="Inspection pack"
        sub="What the records hold for a period, in one document"
      />
      {err && (
        <div className="card" style={{ borderLeft: '3px solid var(--rust)' }}>{err}</div>
      )}
      <InspectionPackBody
        pack={pack}
        vessel={current}
        from={from}
        to={to}
        busy={busy}
        onFrom={(v) => setPeriod((p) => ({ ...p, from: v }))}
        onTo={(v) => setPeriod((p) => ({ ...p, to: v }))}
        onExport={() => {
          if (!pack) return
          setBusy(true)
          try { exportPackPdf(pack) } finally { setBusy(false) }
        }}
      />
    </AppShell>
  )
}
