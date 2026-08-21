import { Fragment, useEffect, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import CrewTabs from '../CrewTabs'
import { supabase } from '../supabaseClient'
import { useCurrentVessel } from '../VesselContext'
import { scopeRows } from '../lib/vessels'
import { useAuth } from '../AuthContext'
import { keepsCrewRecords } from '../lib/roles'
import { CrewCerts, CertAlerts } from './CrewCerts'
import { CrewDetails } from './CrewDetails'

// Section 1 of the crew page: crew status.
//
// Status is changed here and NOWHERE else — that is the whole point of the
// section. Everything downstream (the crew list, the rota, who is aboard on
// the dashboard) reads it.

const STATUSES = ['on_boat', 'on_leave', 'former']
const STATUS_LABEL = { on_boat: 'On Boat', on_leave: 'On Leave', former: 'Former' }
const STATUS_COLOR = { on_boat: 'var(--kelp)', on_leave: 'var(--brass)', former: 'var(--mute)' }
const TYPE_LABEL = { contracted: 'Contracted (agency)', self_employed: 'Self-employed (UK)' }

const monthsSince = (d) => {
  if (!d) return null
  const ms = Date.now() - new Date(String(d).slice(0, 10) + 'T00:00:00').getTime()
  return Math.max(0, Math.round((ms / (1000 * 60 * 60 * 24 * 30.44)) * 10) / 10)
}

// The currency setting holds a symbol OR a code. Concatenating it raw is what
// produced "GBP192.30" on the old crew hub, so a known code is mapped to its
// symbol and anything else falls back to £.
const SYMBOL = { GBP: '£', EUR: '€', USD: '$', DKK: 'kr', NOK: 'kr' }
function money(n, cur) {
  if (n === null || n === undefined) return '—'
  const raw = (cur || '£').trim()
  const sym = SYMBOL[raw.toUpperCase()] || (raw.length <= 2 ? raw : '£')
  return `${sym}${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const isExpired = (d) => !!d && new Date(String(d).slice(0, 10) + 'T00:00:00') < new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00')

export default function Crew() {
  const { appUser } = useAuth()
  const [crew, setCrew] = useState([])
  const [ranks, setRanks] = useState([])
  const [contracts, setContracts] = useState([])
  const [monthLandings, setMonthLandings] = useState([])
  const [ghbPaid, setGhbPaid] = useState({})
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newStatus, setNewStatus] = useState('on_leave')
  const [newType, setNewType] = useState('contracted')
  const [busy, setBusy] = useState(false)
  const [openCerts, setOpenCerts] = useState(null)
  const [openDetails, setOpenDetails] = useState(null)

  const canEdit = keepsCrewRecords(appUser)
  /* WHICH BOAT a man is on. A pair team runs two crews — different men,
   * different numbers aboard — and until now the crew list was the fleet's.
   * No pair fleet has any crew records yet, so this filters nothing today; what
   * makes it worth having is the STAMP on adding a man, without which their
   * crew would all land unassigned and the picker would never have anything to
   * do. */
  const boat = useCurrentVessel()
  const [unassigned, setUnassigned] = useState(0)

  async function loadAll() {
    setLoading(true)
    const monthStart = new Date().toISOString().slice(0, 8) + '01'
    const [cRes, rRes, ctRes, lRes, sRes, pRes] = await Promise.all([
      supabase.from('crew').select('*').is('archived_at', null).order('full_name'),
      supabase.from('crew_ranks').select('code, label').order('sort'),
      supabase.from('contracts').select('id, crew_id, start_date, end_date, status, going_home_bonus').order('start_date', { ascending: false }),
      supabase.from('landings').select('id, landing_date, boxes, landing_crew(crew_id)').gte('landing_date', monthStart),
      supabase.from('settings').select('*').maybeSingle(),
      // The table is `payments`. The old crew hub asked for `wage_payments`,
      // which does not exist, and ignored the error — so ghbPaid was always
      // empty and "GHB on return" showed the full bonus even where half had
      // already been paid.
      supabase.from('payments').select('contract_id, payment_type, amount').in('payment_type', ['ghb_first_half', 'ghb_second_half']),
    ])
    if (cRes.error || pRes.error) setError((cRes.error || pRes.error).message)
    /* Filter to the boat being shown — but a man with NO boat would then
     * vanish, and a crewman quietly missing off a list is exactly the failure
     * worth guarding against. They are kept aside and counted, not dropped. */
    const allCrew = cRes.data || []
    setCrew(scopeRows(allCrew, boat.current))
    setUnassigned(boat.current ? allCrew.filter((c) => !c.vessel_id).length : 0)
    setRanks(rRes.data || [])
    setContracts(ctRes.data || [])
    setMonthLandings(lRes.data || [])
    setSettings(sRes.data || null)
    const paid = {}
    for (const p of (pRes.data || [])) paid[p.contract_id] = (paid[p.contract_id] || 0) + Number(p.amount || 0)
    setGhbPaid(paid)
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  const rankLabel = Object.fromEntries(ranks.map((r) => [r.code, r.label]))
  const boxRate = settings ? Number(settings.box_rate) : 0
  const cur = settings?.currency

  async function addCrew(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setBusy(true); setError('')
    const { error } = await supabase.from('crew').insert({
      fleet_id: appUser.fleet_id, full_name: newName.trim(), status: newStatus, crew_type: newType,
      // Stamped from the boat being shown. Null on "all", which is honest —
      // a man added while looking at the whole fleet has not been put on a boat.
      vessel_id: boat.current?.id ?? null,
    })
    setBusy(false)
    if (error) setError(error.message)
    else { setNewName(''); setNewStatus('on_leave'); setNewType('contracted'); setAdding(false); loadAll() }
  }

  async function updateStatus(id, status) {
    const { error } = await supabase.from('crew').update({ status }).eq('id', id)
    if (error) setError(error.message); else loadAll()
  }

  async function updateType(id, crew_type) {
    const { error } = await supabase.from('crew').update({ crew_type }).eq('id', id)
    if (error) setError(error.message); else loadAll()
  }

  async function archiveCrew(id, name) {
    if (!confirm(`Archive ${name}? They'll be hidden from the list but their history is kept.`)) return
    const { error } = await supabase.from('crew').update({ archived_at: new Date().toISOString(), status: 'former' }).eq('id', id)
    if (error) setError(error.message); else loadAll()
  }

  // Per-crewman figures. Contract language is only ever shown for contracted
  // crew — a self-employed man has no contract, so telling him he has "no
  // ended contract on record" was reporting a missing thing that cannot exist.
  function info(c) {
    const contracted = (c.crew_type || 'contracted') !== 'self_employed'
    const own = contracts.filter((x) => x.crew_id === c.id)
    const active = own.find((x) => x.status === 'active' || (!x.end_date && x.status !== 'ended')) || own.find((x) => !x.end_date)
    const latestEnded = own.filter((x) => x.end_date).sort((a, b) => b.end_date.localeCompare(a.end_date))[0]
    const out = { contracted }
    if (c.status === 'on_boat') {
      // Embarked now comes off the crewman, so days aboard no longer depend on
      // a contract existing — which is why self-employed crew showed nothing.
      out.aboardMonths = monthsSince(c.embarked_date) ?? (contracted && active ? monthsSince(active.start_date) : null)
      if (contracted) {
        const boxes = monthLandings.reduce((s, l) => s + ((l.landing_crew || []).some((x) => x.crew_id === c.id) ? Number(l.boxes || 0) : 0), 0)
        out.monthBoxes = boxes
        out.monthBonus = Math.round(boxes * boxRate * 100) / 100
        if (active && active.going_home_bonus != null) {
          out.ghbOnReturn = Math.max(0, Math.round((Number(active.going_home_bonus) - (ghbPaid[active.id] || 0)) * 100) / 100)
        }
      }
    }
    if (c.status === 'on_leave' && contracted) {
      out.ashoreMonths = latestEnded ? monthsSince(latestEnded.end_date) : null
      out.noContract = !latestEnded
    }
    return out
  }

  const visible = crew.filter((c) => c.status !== 'former')
  const onBoatCount = visible.filter((c) => c.status === 'on_boat').length
  const onLeaveCount = visible.filter((c) => c.status === 'on_leave').length
  const noPassport = visible.filter((c) => !c.passport_number).length
  const expiredPassport = visible.filter((c) => isExpired(c.passport_expiry)).length

  const th = { padding: '0.6rem 0.4rem' }

  return (
    <AppShell>
      <PageHeader title="Crew" sub="Status, papers and who is aboard">
        {canEdit && !adding && <button onClick={() => setAdding(true)}>+ Add crewman</button>}
      </PageHeader>

      <CrewTabs />

      {/* A CREWMAN QUIETLY MISSING OFF A LIST is the failure worth guarding
          against here — that is a border document. Filtering to one boat hides
          anyone not yet put on a boat, so say how many and where they went,
          rather than letting the count silently drop. */}
      {unassigned > 0 && (
        <div className="card" style={{ borderColor: 'var(--brass)' }}>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            {unassigned} {unassigned === 1 ? 'crewman is' : 'crew are'} not on either boat yet,
            so {unassigned === 1 ? 'he is' : 'they are'} hidden while one is selected.
            Switch <strong>Showing</strong> to all boats to see {unassigned === 1 ? 'him' : 'them'}.
          </p>
        </div>
      )}

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error">{error}</p></div>}

      {canEdit && <CertAlerts />}

      {adding && (
        <div className="card">
          <h2>Add new crewman</h2>
          <form onSubmit={addCrew}>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Full name</div>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Lorenzo Rusiana" required autoFocus />
              <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}>
                Use the name exactly as it appears in the passport — a crew list is a border document.
              </div>
            </label>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Status</div>
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Type</div>
              <select value={newType} onChange={(e) => setNewType(e.target.value)}>
                <option value="contracted">{TYPE_LABEL.contracted}</option>
                <option value="self_employed">{TYPE_LABEL.self_employed}</option>
              </select>
              <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}>
                Self-employed rotation crew get no contracts or box bonus — they're listed for the rota.
              </div>
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add'}</button>
              <button type="button" className="secondary" onClick={() => { setAdding(false); setNewName(''); setError('') }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {!loading && visible.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div><span style={{ color: STATUS_COLOR.on_boat, fontWeight: 700, fontSize: '1.4rem', fontFamily: 'var(--font-mono, monospace)' }}>{onBoatCount}</span> <span className="muted">on boat</span></div>
            <div><span style={{ color: STATUS_COLOR.on_leave, fontWeight: 700, fontSize: '1.4rem', fontFamily: 'var(--font-mono, monospace)' }}>{onLeaveCount}</span> <span className="muted">on leave</span></div>
            {noPassport > 0 && <div><span style={{ color: 'var(--brass)', fontWeight: 700, fontSize: '1.4rem', fontFamily: 'var(--font-mono, monospace)' }}>{noPassport}</span> <span className="muted">no passport on file</span></div>}
            {expiredPassport > 0 && <div><span style={{ color: 'var(--rust)', fontWeight: 700, fontSize: '1.4rem', fontFamily: 'var(--font-mono, monospace)' }}>{expiredPassport}</span> <span className="muted">passport expired</span></div>}
          </div>
        </div>
      )}

      {loading && <div className="card"><p className="muted">Loading…</p></div>}
      {!loading && crew.length === 0 && (
        <div className="card"><p className="muted">No crew yet. {canEdit && 'Click "Add crewman" above to add your first.'}</p></div>
      )}

      {!loading && [
        ['contracted', 'Contracted crew (agency)', crew.filter((c) => (c.crew_type || 'contracted') !== 'self_employed')],
        ['self_employed', 'Self-employed crew (UK rotation)', crew.filter((c) => c.crew_type === 'self_employed')],
      ].map(([key, title, group]) => group.length === 0 ? null : (
        <div className="card" key={key}>
          <h2 style={{ marginTop: 0 }}>{title} <span className="muted" style={{ fontWeight: 400, fontSize: '0.9rem' }}>({group.length})</span></h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border)' }}>
                  <th style={th}>Name</th>
                  <th style={th}>Rank</th>
                  <th style={th}>Status</th>
                  <th style={th}>Type</th>
                  {canEdit && <th style={{ ...th, textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {group.map((c) => {
                  const i = info(c)
                  const expired = isExpired(c.passport_expiry)
                  return (
                    <Fragment key={c.id}>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ ...th, fontWeight: 600 }}>
                          {c.full_name}
                          <div className="muted" style={{ fontWeight: 400, fontSize: '0.78rem', display: 'flex', gap: '0.7rem', flexWrap: 'wrap', marginTop: '0.15rem' }}>
                            {c.nationality && <span>{c.nationality}</span>}
                            {!c.passport_number && <span style={{ color: 'var(--brass)', fontWeight: 700 }}>no passport on file</span>}
                            {c.passport_number && expired && <span style={{ color: 'var(--rust)', fontWeight: 700 }}>passport expired</span>}
                            {c.status === 'on_boat' && i.aboardMonths != null && <span>{i.aboardMonths} months aboard</span>}
                            {c.status === 'on_boat' && i.contracted && i.monthBoxes != null && (
                              <span>{i.monthBoxes.toLocaleString('en-GB')} boxes this month → {money(i.monthBonus || 0, cur)}</span>
                            )}
                            {c.status === 'on_boat' && i.ghbOnReturn != null && (
                              <span style={{ color: 'var(--hull)' }}>GHB on return: {money(i.ghbOnReturn, cur)}</span>
                            )}
                            {c.status === 'on_leave' && i.contracted && (
                              <span>{i.noContract ? 'no ended contract on record' : `${i.ashoreMonths} months since last contract ended`}</span>
                            )}
                          </div>
                        </td>
                        <td style={th}>
                          {c.rank_code
                            ? <span>{rankLabel[c.rank_code] || c.rank_code}</span>
                            : <span className="muted" style={{ fontSize: '0.85rem' }}>—</span>}
                        </td>
                        <td style={th}>
                          {canEdit ? (
                            <select value={c.status} onChange={(e) => updateStatus(c.id, e.target.value)} style={{ width: 'auto', padding: '0.3rem 0.5rem', color: STATUS_COLOR[c.status], fontWeight: 600 }}>
                              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                            </select>
                          ) : (
                            <span style={{ color: STATUS_COLOR[c.status], fontWeight: 600 }}>{STATUS_LABEL[c.status]}</span>
                          )}
                        </td>
                        <td style={th}>
                          {canEdit ? (
                            <select value={c.crew_type || 'contracted'} onChange={(e) => updateType(c.id, e.target.value)} style={{ width: 'auto', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}>
                              <option value="contracted">Contracted</option>
                              <option value="self_employed">Self-employed</option>
                            </select>
                          ) : (
                            <span className="muted">{(c.crew_type || 'contracted') === 'self_employed' ? 'Self-employed' : 'Contracted'}</span>
                          )}
                        </td>
                        {canEdit && (
                          <td style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button className="secondary" onClick={() => setOpenDetails(openDetails === c.id ? null : c.id)} style={{ padding: '0.3rem 0.7rem', fontSize: '0.85rem', marginRight: '0.3rem' }}>
                              {openDetails === c.id ? 'Hide details' : 'Details'}
                            </button>
                            <button className="secondary" onClick={() => setOpenCerts(openCerts === c.id ? null : c.id)} style={{ padding: '0.3rem 0.7rem', fontSize: '0.85rem', marginRight: '0.3rem' }}>
                              {openCerts === c.id ? 'Hide certs' : 'Certificates'}
                            </button>
                            <button className="secondary" onClick={() => archiveCrew(c.id, c.full_name)} style={{ padding: '0.3rem 0.7rem', fontSize: '0.85rem' }}>
                              Archive
                            </button>
                          </td>
                        )}
                      </tr>
                      {openDetails === c.id && (
                        <tr>
                          <td colSpan={canEdit ? 5 : 4} style={{ padding: '0 0.4rem 0.8rem', background: 'var(--bg-soft, #f8fafc)' }}>
                            <CrewDetails crew={c} canEdit={canEdit} onSaved={loadAll} />
                          </td>
                        </tr>
                      )}
                      {openCerts === c.id && (
                        <tr>
                          <td colSpan={canEdit ? 5 : 4} style={{ padding: '0 0.4rem 0.8rem', background: 'var(--bg-soft, #f8fafc)' }}>
                            <CrewCerts crew={c} canEdit={canEdit} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </AppShell>
  )
}
