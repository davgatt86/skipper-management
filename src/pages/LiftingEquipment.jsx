import { useCallback, useEffect, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { useAuth } from '../AuthContext'
import { useCurrentVessel } from '../VesselContext'
import { keepsLogs } from '../lib/roles'
import { LiftingBody } from './certification/SafetyBody'
import {
  listEquipment, listExaminations, recordExamination, saveEquipment,
} from '../lib/certification/safetyDb'

/* LIFTING AND WORK EQUIPMENT — LOLER (SI 2006/2184) and PUWER (SI 2006/2183).
 *
 * MGN 332 says a thorough examination report may be held "electronically or on
 * computer disc, provided that the information is in a form which is usable by
 * the shipowner and employer or master" — so unlike the Oil Record Book and the
 * Official Log Book, this page IS the record and carries no paper-twin warning.
 */
export default function LiftingEquipment() {
  const { appUser } = useAuth()
  const { current } = useCurrentVessel()
  const [equipment, setEquipment] = useState([])
  const [examinations, setExaminations] = useState([])
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const canWrite = keepsLogs(appUser)

  const refresh = useCallback(async () => {
    setErr('')
    try {
      const [e, x] = await Promise.all([listEquipment(current?.id), listExaminations()])
      setEquipment(e); setExaminations(x)
    } catch (x) { setErr(x.message || String(x)) }
  }, [current?.id])

  useEffect(() => { refresh() }, [refresh])

  const run = async (fn, done) => {
    setBusy(true); setErr(''); setMsg('')
    try { await fn(); if (done) setMsg(done); await refresh() }
    catch (x) { setErr(x.message || String(x)) } finally { setBusy(false) }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Certification"
        title="Lifting & work equipment"
        sub="LOLER SI 2006/2184 · PUWER SI 2006/2183"
      />
      {err && <div className="card" style={{ borderLeft: '3px solid var(--rust)' }}>{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '3px solid var(--kelp)' }}>{msg}</div>}

      <LiftingBody
        vessel={current} equipment={equipment} examinations={examinations}
        canWrite={canWrite} busy={busy} selected={selected} onOpen={setSelected}
        /* `saveEquipment` was exported and never called: the register could be
           read and nothing could be put on it. */
        onSaveEquipment={(x) => run(
          () => saveEquipment({ ...x, vesselId: current?.id || null }),
          'On the register. Record its first thorough examination when it is done '
          + '— nothing is in date until one is.')}
        onExamine={(e) => {
          const who = window.prompt('Who made the examination? The competent person, by name.')
          if (!who) return
          run(() => recordExamination(e.id, {
            examinedOn: new Date().toISOString().slice(0, 10),
            competentPerson: who,
            userId: appUser?.id,
          }), `Examination recorded against ${e.name}. Open it to add the report reference, `
            + 'the date the examiner put on the next one, and any defects.')
        }}
      />
    </AppShell>
  )
}
