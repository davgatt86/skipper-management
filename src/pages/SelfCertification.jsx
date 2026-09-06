import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { useCurrentVessel } from '../VesselContext'
import { pickDetails } from '../lib/vessels'
import { isSkipper } from '../lib/roles'
import { certStatus } from '../lib/certs/certStatus'
import SelfCertBody from './certification/SelfCertBody'
import { FORM, bandFor, periodFor, certYear } from '../lib/certification/selfCert'
import {
  listSelfCerts, loadAnswers, startSelfCert, answerItem, clearItem, completeSelfCert,
} from '../lib/certification/db'

/* THE ANNUAL SELF-CERTIFICATION.
 *
 * All the judgement is in `lib/certification/selfCert.js` and all the drawing is
 * in `certification/SelfCertBody.jsx`; this file does the IO and nothing else,
 * so the wizard can be server-rendered by `scripts/self-cert-preview.mjs` — the
 * page is behind a login and could otherwise only be checked by eye on the boat.
 */
export default function SelfCertification() {
  const { appUser } = useAuth()
  const { current } = useCurrentVessel()
  const [details, setDetails] = useState(null)
  const [certs, setCerts] = useState([])
  const [cert, setCert] = useState(null)
  const [answers, setAnswers] = useState({})
  const [ukfvc, setUkfvc] = useState(null)
  const [evidence, setEvidence] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const canSign = isSkipper(appUser)

  const refresh = useCallback(async () => {
    setErr('')
    try {
      const [{ data: vd }, { data: vc }, list] = await Promise.all([
        supabase.from('vessel_details').select('*'),
        supabase.from('vessel_certificates').select('cert_type, category, expiry_date, issue_date'),
        listSelfCerts(current?.id),
      ])
      const d = pickDetails(vd || [], current)
      setDetails(d)
      setCerts(list)
      setUkfvc((vc || []).find((c) => /fishing vessel cert/i.test(c.cert_type || '')) || null)
      setEvidence(buildEvidence(vc || []))
      /* The one for the current certificate year, if it has been started. */
      const period = periodFor((vc || []).find((c) => /fishing vessel cert/i.test(c.cert_type || ''))?.issue_date)
      const open = list.find((c) => c.period === period) || list[0] || null
      setCert(open)
      setAnswers(open ? await loadAnswers(open.id) : {})
    } catch (e) { setErr(e.message || String(e)) }
  }, [current?.id])

  useEffect(() => { refresh() }, [refresh])

  const band = useMemo(() => bandFor(details), [details])
  const period = useMemo(() => periodFor(ukfvc?.issue_date), [ukfvc])
  const year = useMemo(() => certYear(ukfvc?.issue_date), [ukfvc])

  async function start() {
    if (!current?.id) { setErr('Choose a boat first — a self-certification is about one hull.'); return }
    setBusy(true); setErr('')
    try {
      const c = await startSelfCert({
        vesselId: current.id, period, certIssuedOn: ukfvc?.issue_date || null, form: FORM,
      })
      setCert(c); setAnswers({}); setCerts((l) => [c, ...l])
      setMsg(`Started the ${c.period} self-certification.`)
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  /* Optimistic, then written. A checklist of 148 that waited on the network for
     every tap would not get used at sea, which is where it gets filled in. */
  async function setAnswer(n, state) {
    if (!cert) return
    setAnswers((a) => ({ ...a, [n]: { ...a[n], state, note: a[n]?.note } }))
    try { await answerItem(cert.id, n, state, answers[n]?.note, appUser?.id) }
    catch (e) { setErr(e.message || String(e)); refresh() }
  }
  async function drop(n) {
    if (!cert) return
    setAnswers((a) => { const c = { ...a }; delete c[n]; return c })
    try { await clearItem(cert.id, n) } catch (e) { setErr(e.message || String(e)); refresh() }
  }
  async function note(n, text) {
    if (!cert || !answers[n]) return
    setAnswers((a) => ({ ...a, [n]: { ...a[n], note: text } }))
    try { await answerItem(cert.id, n, answers[n].state, text, appUser?.id) }
    catch (e) { setErr(e.message || String(e)) }
  }

  async function sign() {
    if (!cert) return
    setBusy(true); setErr('')
    try {
      const c = await completeSelfCert(cert.id, { userId: appUser?.id, name: appUser?.name || appUser?.email })
      setCert(c)
      setMsg('Signed off. The answers are locked; the MSF 1323 itself is still yours to sign and send.')
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Certification"
        title="Annual self-certification"
        sub={band.band === '15to24'
          ? `${FORM.code} rev ${FORM.revision}${period ? ` · certificate year ${period}` : ''}`
          : 'Which code applies is decided on registered length'}
      />

      {err && <div className="card" style={{ borderLeft: '3px solid var(--rust)' }}>{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '3px solid var(--kelp)' }}>{msg}</div>}

      {/* YEAR 1 NEEDS NO SELF-CERTIFICATE — the survey that issued the
          certificate was the check. Saying so is better than an empty page. */}
      {band.band === '15to24' && year === 0 && (
        <div className="card">
          The certificate was issued this year, so there is no self-certification due yet. The
          survey that issued it was the check.
        </div>
      )}

      {band.band === '15to24' && !cert && year !== 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Nothing started for {period || 'this year'}</h3>
          {!ukfvc?.issue_date && (
            <p className="muted">
              No UK Fishing Vessel Certificate issue date is on file, so the certificate year cannot
              be worked out. Add it on <Link to="/vessel-certs">Vessel Certificates</Link> first —
              the self-certification hangs off the certificate anniversary, not the calendar.
            </p>
          )}
          <button onClick={start} disabled={busy || !period}>Start the {period || ''} self-certification</button>
        </div>
      )}

      {cert && (
        <SelfCertBody
          form={FORM} vessel={current} band={band} cert={cert}
          answers={answers} evidence={evidence} canSign={canSign} busy={busy}
          onAnswer={setAnswer} onClear={drop} onNote={note} onSign={sign}
        />
      )}
      {!cert && band.band !== '15to24' && (
        <SelfCertBody form={FORM} vessel={current} band={band} cert={null} answers={{}} evidence={{}} />
      )}

      {certs.length > 1 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Earlier years</h3>
          {certs.filter((c) => c.id !== cert?.id).map((c) => (
            <div key={c.id} style={{ fontSize: '0.85rem', padding: '0.2rem 0' }}>
              <b>{c.period}</b> · {c.form_code} rev {c.form_revision} ·{' '}
              {c.completed_at ? `signed off ${String(c.completed_at).slice(0, 10)}` : 'not signed off'}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  )
}

/* WHAT THE APP CAN SAY, AND ONLY WHERE IT REALLY KNOWS.
 *
 * `attention` is what raises a contradiction against an item answered complied,
 * so it is used only where the record positively says something is wrong — an
 * expired certificate. Not holding a record is `unknown` and raises nothing: the
 * app not knowing is not evidence, and a warning that fires whenever the data is
 * thin is a warning nobody reads.
 */
function buildEvidence(vesselCerts) {
  const ev = {}
  const say = (n, state, detail) => { ev[n] = { state, detail } }
  const expired = (re) => vesselCerts.filter((c) => re.test(c.cert_type || '')
    && certStatus(c.expiry_date) === 'expired')

  const svc = expired(/liferaft|extinguisher|fire|lifejacket|suppression/i)
  if (svc.length) say(10, 'attention', `${svc.map((c) => c.cert_type).join('; ')} expired`)
  else say(10, 'unknown', 'no expired servicing certificate on file')

  const reg = vesselCerts.find((c) => /registry|particulars/i.test(c.cert_type || ''))
  if (reg) say(1, certStatus(reg.expiry_date) === 'expired' ? 'attention' : 'ok',
               `${reg.cert_type}${reg.expiry_date ? ` to ${reg.expiry_date}` : ''}`)

  const uk = vesselCerts.find((c) => /fishing vessel cert/i.test(c.cert_type || ''))
  if (uk) say(148, certStatus(uk.expiry_date) === 'expired' ? 'attention' : 'ok',
              `UKFVC${uk.expiry_date ? ` valid to ${uk.expiry_date}` : ''}`)

  const epirb = vesselCerts.find((c) => /epirb/i.test(c.cert_type || ''))
  if (epirb) say(116, certStatus(epirb.expiry_date) === 'expired' ? 'attention' : 'ok',
                 `EPIRB test${epirb.expiry_date ? ` to ${epirb.expiry_date}` : ''}`)

  const stab = vesselCerts.find((c) => /stability/i.test(c.cert_type || ''))
  say(136, stab ? 'ok' : 'unknown', stab ? stab.cert_type : 'no stability book filed in this app')

  return ev
}
