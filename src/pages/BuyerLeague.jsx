import { useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
// buyerPremiumLeague, not buyerLeague: SalesInsights already has a
// buyerLeague that ranks buyers on raw £/kg within a species and grade. That
// answers "who paid most for this grade". This answers "who consistently pays
// over the board", which is a different question, so both are kept.
import { buyerPremiumLeague, similarBuyers, buyerCoverage, bySpecies, scopeRows, scopeLandingIds, SALES_SCOPES } from '../lib/salesAgg'

// Who actually pays best.
//
// The whole point is the comparison method. Averaging a buyer's £/kg over a
// year mostly measures WHEN they were bidding, because prices move week to
// week. So every row is scored against the volume-weighted average for the
// same species, the same grade and the SAME DAY, and the score is how far
// above or below that they bought.
//
// A day with only one buyer is dropped — one bid is not a market.

const gbp = (n) => (n == null ? '—' : '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const gbp0 = (n) => (n == null ? '—' : '£' + Math.round(Number(n)).toLocaleString('en-GB'))
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-GB'))

export default function BuyerLeague() {
  const { appUser } = useAuth()
  const canView = ['skipper', 'viewer'].includes(appUser?.role)

  const [rows, setRows] = useState([])
  const [landings, setLandings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [scope, setScope] = useState('uk')       // Danish sales have no buyers
  const [species, setSpecies] = useState('')
  const [byGrade, setByGrade] = useState(false)
  const [minKg, setMinKg] = useState(1000)

  useEffect(() => {
    if (!canView) { setLoading(false); return }
    async function load() {
      setLoading(true); setError('')
      const [lRes, rRes] = await Promise.all([
        supabase.from('sales_landings').select('id, landing_date, vessel, market, currency'),
        supabase.from('sales_rows').select('landing_id, buyer, species, species_canon, grade, sub_grade, weight_kg, value, boxes'),
      ])
      if (lRes.error || rRes.error) setError((lRes.error || rRes.error).message)
      setLandings(lRes.data || [])
      setRows(rRes.data || [])
      setLoading(false)
    }
    load()
  }, [canView])

  const landingById = useMemo(() => Object.fromEntries(landings.map((l) => [l.id, l])), [landings])

  const years = useMemo(
    () => [...new Set(landings.map((l) => (l.landing_date || '').slice(0, 4)).filter(Boolean))].sort().reverse(),
    [landings]
  )

  const inScope = useMemo(() => {
    const keep = new Set(
      scopeLandingIds(landings.filter((l) => (l.landing_date || '').startsWith(year)), scope).map((l) => l.id)
    )
    return scopeRows(rows.filter((r) => keep.has(r.landing_id)), landingById, scope)
  }, [rows, landings, landingById, year, scope])

  const speciesList = useMemo(() => bySpecies(inScope).slice(0, 25), [inScope])
  const league = useMemo(
    () => buyerPremiumLeague(inScope, landingById, { minKg: Number(minKg) || 0, species: species || null, byGrade }),
    [inScope, landingById, minKg, species, byGrade]
  )
  const variants = useMemo(() => similarBuyers(inScope), [inScope])
  const coverage = useMemo(() => buyerCoverage(inScope, landingById), [inScope, landingById])

  if (!canView) return <AppShell><div className="card"><p className="muted">Skipper or viewer access only.</p></div></AppShell>

  const th = { padding: '0.5rem 0.4rem', textAlign: 'left', borderBottom: '2px solid var(--border)' }
  const thR = { ...th, textAlign: 'right' }
  const td = { padding: '0.45rem 0.4rem', borderBottom: '1px solid var(--border)' }
  const tdR = { ...td, textAlign: 'right', fontFamily: 'var(--font-mono, monospace)' }

  return (
    <AppShell>
      <PageHeader title="Buyer League" sub="Who pays over the board, on the day" />

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error">{error}</p></div>}

      <div className="card no-print" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 'auto' }}>
          {years.map((y) => <option key={y}>{y}</option>)}
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ width: 'auto' }}>
          {SALES_SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={species} onChange={(e) => setSpecies(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All species</option>
          {speciesList.map((s) => <option key={s.species} value={s.species}>{s.species}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
          <input type="checkbox" checked={byGrade} onChange={(e) => setByGrade(e.target.checked)} />
          Compare grade for grade
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', marginLeft: 'auto' }}>
          Min kg
          <input type="number" min="0" step="500" value={minKg} onChange={(e) => setMinKg(e.target.value)} style={{ width: 90 }} />
        </label>
      </div>

      <div className="card">
        <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
          Each buyer is scored against the volume-weighted average for the same fish on the same day
          {byGrade ? ', grade for grade' : ''}. A positive figure means they paid over the board.
          Days where only one buyer bought are ignored — one bid is not a market. Auctions are
          excluded throughout: Hanstholm print no buyer names.
        </p>
      </div>

      {coverage.blankRows > 0 && (
        <div className="card" style={{ borderColor: 'var(--brass)' }}>
          <h2 style={{ marginTop: 0 }}>Fish with no buyer against it</h2>
          <p style={{ marginTop: 0, fontSize: '0.9rem' }}>
            <strong>{gbp0(coverage.blankValue)}</strong> over {num(coverage.blankRows)} rows
            {' '}({coverage.pct}% of the value in scope) has no buyer recorded, so it cannot appear
            in the table below. Everything else about those rows is intact — species, grade, weight
            and value — so gross, tonnage and £/kg are unaffected. It is only the attribution that
            is missing.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr><th style={th}>Landing</th><th style={th}>Vessel</th><th style={thR}>Rows</th><th style={thR}>Value</th></tr>
              </thead>
              <tbody>
                {coverage.landings.map((l, i) => (
                  <tr key={i}>
                    <td style={td}>{l.date ? `${l.date.slice(8, 10)}/${l.date.slice(5, 7)}/${l.date.slice(0, 4)}` : '—'}</td>
                    <td style={td}>{l.vessel}</td>
                    <td style={tdR}>{num(l.rows)}</td>
                    <td style={tdR}>{gbp0(l.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: '0.78rem', marginBottom: 0 }}>
            These were parsed before the P&amp;J buyer-column fix shipped. Re-uploading the note
            fills the buyers in; where the note is no longer available, the gap is permanent and
            this panel is the record of it.
          </p>
        </div>
      )}

      {variants.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--brass)' }}>
          <h2 style={{ marginTop: 0 }}>Possibly the same buyer, twice</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
            Buyer names come off the sales note exactly as typed, so one firm can appear more than
            once and split its own record — which matters here, because a buyer&rsquo;s volume decides
            whether they clear the threshold at all. Same failure as crew ranks, fuel suppliers and
            vessel labels.
          </p>
          {variants.map((v, i) => (
            <div key={i} style={{ padding: '0.3rem 0', borderTop: '1px solid var(--border)', fontSize: '0.88rem' }}>
              {v.join('   ·   ')}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>
          {species || 'All species'} <span className="muted" style={{ fontWeight: 400, fontSize: '0.9rem' }}>({league.length} buyers over {num(minKg)} kg)</span>
        </h2>
        {loading ? <p className="muted">Loading…</p> : league.length === 0 ? (
          <p className="muted">
            Nothing to compare at that threshold. Lower the minimum kg, or widen the species.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr>
                  <th style={th}>#</th>
                  <th style={th}>Buyer</th>
                  <th style={thR}>Over the board</th>
                  <th style={thR}>Worth</th>
                  <th style={thR}>Kg</th>
                  <th style={thR}>Days</th>
                  <th style={thR}>£/kg paid</th>
                  <th style={th}>Mostly</th>
                </tr>
              </thead>
              <tbody>
                {league.map((b, i) => (
                  <tr key={b.buyer}>
                    <td style={td} className="muted">{i + 1}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{b.buyer}</td>
                    <td style={{ ...tdR, fontWeight: 700, color: b.premium > 0 ? 'var(--kelp)' : b.premium < 0 ? 'var(--rust)' : 'inherit' }}>
                      {b.premium > 0 ? '+' : ''}{gbp(b.premium)}
                    </td>
                    <td style={{ ...tdR, color: b.worth > 0 ? 'var(--kelp)' : 'var(--rust)' }}>
                      {b.worth > 0 ? '+' : ''}{gbp0(b.worth)}
                    </td>
                    <td style={tdR}>{num(Math.round(b.kg))}</td>
                    <td style={tdR}>{b.days}</td>
                    <td style={tdR}>{gbp(b.pkg)}</td>
                    <td style={td} className="muted">{b.top}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: '0.78rem', marginBottom: 0 }}>
          <strong>Worth</strong> is the premium across the volume that buyer actually took — what
          their bidding was worth to you over the year, not a rate.
          A buyer with few days can look strong on one good parcel, so read the days column with it.
        </p>
      </div>
    </AppShell>
  )
}
