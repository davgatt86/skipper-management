import { useEffect, useState } from 'react'
import SectionRule from '../SectionRule'
import {
  findCandidateWorksheets, loadWorksheetDetail, linkWorksheet, unlinkWorksheet,
  compare, summarise,
} from '../lib/su/reconcile'

// The worksheet you sent, checked against the settlement that came back.
//
// Linking is never automatic. Nothing carries a trip number on both sides, so
// the app can only offer the worksheets landed near this settling date — you
// say which one it was. A wrong automatic guess would produce confident
// nonsense, which is worse than asking.

const fmtDate = d => {
  if (!d) return '—'
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.slice(8, 10)} ${M[Number(d.slice(5, 7)) - 1]}`
}

export default function Reconcile({ settlement, stLines, stCrew, format }) {
  const [candidates, setCandidates] = useState([])
  const [linked, setLinked] = useState(null)
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function refresh() {
    setError('')
    const list = await findCandidateWorksheets(settlement)
    setCandidates(list)
    const l = list.find(w => w.settlement_id === settlement.id) || null
    setLinked(l)
    setDetail(l ? await loadWorksheetDetail(l.id) : null)
  }

  useEffect(() => { refresh() }, [settlement.id])

  async function link(id) {
    setBusy(true)
    try { await linkWorksheet(id, settlement.id); await refresh() }
    catch (e) { setError(e.message || String(e)) }
    setBusy(false)
  }

  async function unlink() {
    setBusy(true)
    try { await unlinkWorksheet(linked.id); await refresh() }
    catch (e) { setError(e.message || String(e)) }
    setBusy(false)
  }

  const rows = linked && detail
    ? compare({
        worksheet: detail.worksheet, wsLines: detail.lines, wsCrew: detail.crew,
        settlement, stLines, stCrew, format,
      })
    : []
  const s = summarise(rows)

  return (
    <div style={{ marginTop: 18 }}>
      <SectionRule side={linked ? (s.differs ? `${s.differs} to look at` : 'all match') : 'not linked'}>
        Against your worksheet
      </SectionRule>

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error" style={{ margin: 0 }}>{error}</p></div>}

      {!linked && (
        <div className="card">
          {candidates.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No Square Up worksheet was kept for a landing near this settling date, so there
              is nothing to check it against. Worksheets kept from now on will show up here.
            </p>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                Which worksheet did this settle? Nothing links the two automatically —
                neither side carries a trip number, and a wrong guess would produce
                confident nonsense.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {candidates.map(w => (
                  <button key={w.id} className="secondary" disabled={busy} onClick={() => link(w.id)}>
                    {w.trip_no ? `Trip ${w.trip_no} · ` : ''}{fmtDate(w.landed_date)}
                    <span className="muted"> · {w.daysApart}d before</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {linked && (
        <>
          <div className="matchbox" style={{ borderLeftColor: s.differs ? 'var(--rust)' : 'var(--kelp)' }}>
            <div className="match-t">
              Worksheet {linked.trip_no ? `trip ${linked.trip_no}` : ''} landed {fmtDate(linked.landed_date)}
            </div>
            {rows.map(r => (
              <div className="mrow" key={r.label}>
                <span>{r.label}</span>
                {r.status === 'na' ? (
                  <>
                    <span className="num" style={{ gridColumn: 'span 2' }}>{r.reason}</span>
                    <span className="flag" style={{ background: 'var(--surface-2)', color: 'var(--mute)' }}>n/a</span>
                  </>
                ) : (
                  <>
                    <span className="num">you sent {r.sent}</span>
                    <span className="num">settled {r.settled}</span>
                    {r.status === 'match'
                      ? <span className="flag ok">Match</span>
                      : <span className="flag bad">{r.diffText}</span>}
                  </>
                )}
              </div>
            ))}
          </div>

          <p className="note">
            Quantities are checked as quantities and money as money. Anything with no
            counterpart on the settlement says n/a rather than showing a difference of
            zero — a zero difference reads as checked and fine.
          </p>

          <button className="secondary" disabled={busy} onClick={unlink}>
            Not this worksheet — unlink
          </button>
        </>
      )}
    </div>
  )
}
