import { useCallback, useEffect, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { useAuth } from '../AuthContext'
import { useCurrentVessel } from '../VesselContext'
import { keepsLogs } from '../lib/roles'
import { RiskBody } from './certification/SafetyBody'
import { DEFAULT_REVIEW_MONTHS } from '../lib/certification/safety'
import {
  listAssessments, listHazards, listBriefings, reviewAssessment, recordBriefing,
} from '../lib/certification/safetyDb'

/* RISK ASSESSMENTS — reg 7, MS&FV (Health and Safety at Work) Regs 1997.
 *
 * The mate keeps these as much as the skipper does: he is the man doing the
 * job being assessed, and if writing it down needs somebody else to sign in,
 * it does not get written down.
 */
export default function RiskAssessments() {
  const { appUser } = useAuth()
  const { current } = useCurrentVessel()
  const [assessments, setAssessments] = useState([])
  const [hazards, setHazards] = useState([])
  const [briefings, setBriefings] = useState([])
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const canWrite = keepsLogs(appUser)

  const refresh = useCallback(async () => {
    setErr('')
    try {
      const [a, h, b] = await Promise.all([
        listAssessments(current?.id), listHazards(), listBriefings(),
      ])
      setAssessments(a); setHazards(h); setBriefings(b)
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
        title="Risk assessments"
        sub="Reg 7, MS&FV (Health and Safety at Work) Regulations 1997"
      />
      {err && <div className="card" style={{ borderLeft: '3px solid var(--rust)' }}>{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '3px solid var(--kelp)' }}>{msg}</div>}

      <RiskBody
        vessel={current} assessments={assessments} hazards={hazards} briefings={briefings}
        canWrite={canWrite} busy={busy} selected={selected} reviewMonths={DEFAULT_REVIEW_MONTHS}
        onOpen={setSelected}
        onReview={(a, when) => run(
          () => reviewAssessment(a, hazards, { ...when, assessedBy: appUser?.display_name || appUser?.email }),
          'Reviewed. A new assessment carries the hazards over; the old one stays exactly as it was, '
          + 'because that is what the crew were briefed on.')}
        onBrief={(a) => {
          const who = window.prompt('Who was told? One name — record each of them.')
          if (!who) return
          run(() => recordBriefing(a.id, {
            briefedOn: new Date().toISOString().slice(0, 10),
            crewName: who,
            briefedBy: appUser?.display_name || appUser?.email,
          }), `${who} recorded as told.`)
        }}
      />
    </AppShell>
  )
}
