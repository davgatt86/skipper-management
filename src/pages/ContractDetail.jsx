import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import AppShell from '../AppShell'
import { useAuth } from '../AuthContext'

const STATUS_LABEL = { current: 'Current', pending_return: 'Gone Home', completed: 'Completed' }
const STATUS_COLOR = { current: 'var(--green)', pending_return: 'var(--amber)', completed: 'var(--grey-400)' }

function money(n, currency) {
  if (n === null || n === undefined || n === '') return '—'
  const num = Number(n)
  if (currency && /^[A-Za-z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(num)
    } catch { /* fall through */ }
  }
  return `${currency || ''}${num.toFixed(2)}`
}

function fmtDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function fmtMonth(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

const round2 = (x) => Math.round(x * 100) / 100

export default function ContractDetail() {
  const { id } = useParams()
  const { appUser } = useAuth()
  const [contract, setContract] = useState(null)
  const [settings, setSettings] = useState(null)
  const [landings, setLandings] = useState([])
  const [months, setMonths] = useState([])
  const [ghbPayments, setGhbPayments] = useState([])
  const [oneOffs, setOneOffs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadAll() {
      setLoading(true)
      setError('')

      const [ctRes, setRes] = await Promise.all([
        supabase.from('contracts').select('*, crew(full_name)').eq('id', id).single(),
        supabase.from('settings').select('*').maybeSingle(),
      ])
      if (ctRes.error) {
        setError(ctRes.error.message)
        setLoading(false)
        return
      }
      const ct = ctRes.data
      setContract(ct)
      setSettings(setRes.data || null)

      const today = new Date().toISOString().slice(0, 10)
      const spanEnd = ct.end_date || today
      const monthStart = ct.start_date.slice(0, 7) + '-01'
      const monthEnd = spanEnd.slice(0, 7) + '-01'

      const [lRes, mRes, gRes, oRes] = await Promise.all([
        supabase
          .from('landings')
          .select('id, landing_date, boxes, notes, landing_crew!inner(crew_id)')
          .eq('landing_crew.crew_id', ct.crew_id)
          .gte('landing_date', ct.start_date)
          .lte('landing_date', spanEnd)
          .order('landing_date'),
        supabase
          .from('month_closeouts')
          .select('*')
          .eq('crew_id', ct.crew_id)
          .gte('month', monthStart)
          .lte('month', monthEnd)
          .order('month'),
        supabase
          .from('payments')
          .select('payment_type, payment_date, amount')
          .eq('contract_id', id)
          .in('payment_type', ['ghb_first_half', 'ghb_second_half']),
        supabase
          .from('one_off_bonuses')
          .select('bonus_date, description, amount, paid, paid_date')
          .eq('crew_id', ct.crew_id)
          .gte('bonus_date', ct.start_date)
          .lte('bonus_date', spanEnd)
          .order('bonus_date'),
      ])
      const firstError = lRes.error || mRes.error || gRes.error
      if (firstError) setError(firstError.message)
      setLandings(lRes.data || [])
      setMonths(mRes.data || [])
      setGhbPayments(gRes.data || [])
      setOneOffs(oRes.error ? [] : (oRes.data || []))
      setLoading(false)
    }
    loadAll()
  }, [id])

  if (loading) {
    return (
      <AppShell>
        <div style={{ marginBottom: '1rem' }}>
          <Link to="/contracts" style={{ fontSize: '0.9rem' }}>← Back to Contracts</Link>
        </div>
        <div className="card"><p className="muted">Loading…</p></div>
      </AppShell>
    )
  }

  if (!contract) {
    return (
      <AppShell>
        <div style={{ marginBottom: '1rem' }}>
          <Link to="/contracts" style={{ fontSize: '0.9rem' }}>← Back to Contracts</Link>
        </div>
        <div className="card"><p className="error">{error || 'Contract not found.'}</p></div>
      </AppShell>
    )
  }

  const cur = settings?.currency || ''
  const totalBoxes = landings.reduce((s, l) => s + (l.boxes || 0), 0)
  const flatTotal = months.reduce((s, m) => s + Number(m.flat_rate_paid), 0)
  const boxTotal = months.reduce((s, m) => s + Number(m.box_bonus_paid), 0)
  const wagesTotal = months.reduce((s, m) => s + Number(m.total_paid), 0)

  const ghb = contract.going_home_bonus !== null && contract.going_home_bonus !== undefined
    ? Number(contract.going_home_bonus) : null
  const raw = settings ? Number(settings.ghb_first_half_pct) : 0.5
  const frac = raw > 1 ? raw / 100 : raw
  const firstHalf = ghb !== null ? round2(ghb * frac) : null
  const secondHalf = ghb !== null ? round2(ghb - firstHalf) : null
  const p1 = ghbPayments.find(p => p.payment_type === 'ghb_first_half')
  const p2 = ghbPayments.find(p => p.payment_type === 'ghb_second_half')
  const ghbPaidTotal = (p1 ? Number(p1.amount) : 0) + (p2 ? Number(p2.amount) : 0)

  const oneOffPaidTotal = oneOffs.filter(o => o.paid).reduce((s, o) => s + Number(o.amount), 0)
  const paidToDate = round2(wagesTotal + ghbPaidTotal + oneOffPaidTotal)

  const partialNote = contract.start_date.slice(8) !== '01'
    ? 'Boundary months may include days from an adjacent contract.' : null

  const cellPad = { padding: '0.6rem 0.4rem' }

  return (
    <AppShell>
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/contracts" style={{ fontSize: '0.9rem' }}>← Back to Contracts</Link>
      </div>

      <header style={{ marginBottom: '1rem' }}>
        <h1 style={{ marginBottom: 0 }}>{contract.crew?.full_name || 'Contract'}</h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          {fmtDate(contract.start_date)} → {contract.end_date ? fmtDate(contract.end_date) : 'ongoing'}
          {contract.return_date ? ` · returned ${fmtDate(contract.return_date)}` : ''}
          {' · '}
          <span style={{ color: STATUS_COLOR[contract.status], fontWeight: 600 }}>
            {STATUS_LABEL[contract.status] || contract.status}
          </span>
        </p>
      </header>

      {error && <div className="card" style={{ borderColor: 'var(--red)' }}><p className="error">{error}</p></div>}

      <div className="card">
        <h2>Contract totals</h2>
        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Landings</div>
            <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{landings.length}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Boxes</div>
            <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{totalBoxes.toLocaleString()}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Flat rate</div>
            <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{money(flatTotal, cur)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Box bonus</div>
            <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{money(boxTotal, cur)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Wages total</div>
            <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{money(wagesTotal, cur)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Paid to date (incl. GHB{oneOffs.length > 0 ? ' & one-offs' : ''})</div>
            <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{money(paidToDate, cur)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Going-home bonus</h2>
        {ghb === null && <p className="muted">Not set yet.</p>}
        {ghb !== null && (
          <p style={{ marginBottom: 0 }}>
            {money(ghb, cur)} total —{' '}
            <span style={{ color: p1 ? 'var(--green)' : 'var(--amber)', fontWeight: 600 }}>
              1st {money(firstHalf, cur)} {p1 ? `✓ paid ${fmtDate(p1.payment_date)}` : 'due on going home'}
            </span>
            {' · '}
            <span style={{ color: p2 ? 'var(--green)' : 'var(--amber)', fontWeight: 600 }}>
              2nd {money(secondHalf, cur)} {p2 ? `✓ paid ${fmtDate(p2.payment_date)}` : 'due on return'}
            </span>
          </p>
        )}
      </div>

      {oneOffs.length > 0 && (
        <div className="card">
          <h2>One-off bonuses during contract</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {oneOffs.map((o, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={cellPad}>{fmtDate(o.bonus_date)}</td>
                  <td style={cellPad}>{o.description}</td>
                  <td style={{ ...cellPad, fontWeight: 600 }}>{money(o.amount, cur)}</td>
                  <td style={cellPad}>
                    {o.paid
                      ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>✓ paid {fmtDate(o.paid_date)}</span>
                      : <span style={{ color: 'var(--amber)', fontWeight: 600 }}>unpaid</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Month by month</h2>
        {months.length === 0 && <p className="muted">No closed months yet for this contract.</p>}
        {months.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border)' }}>
                  <th style={cellPad}>Month</th>
                  <th style={cellPad}>Days</th>
                  <th style={cellPad}>Boxes</th>
                  <th style={cellPad}>Flat rate</th>
                  <th style={cellPad}>Box bonus</th>
                  <th style={cellPad}>Total</th>
                </tr>
              </thead>
              <tbody>
                {months.map(m => (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...cellPad, fontWeight: 600 }}>{fmtMonth(m.month)}</td>
                    <td style={cellPad}>{m.days_on_contract}</td>
                    <td style={cellPad}>{m.boxes_for_month.toLocaleString()}</td>
                    <td style={cellPad}>{money(m.flat_rate_paid, cur)}</td>
                    <td style={cellPad}>{money(m.box_bonus_paid, cur)}</td>
                    <td style={{ ...cellPad, fontWeight: 600 }}>{money(m.total_paid, cur)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td style={{ ...cellPad, fontWeight: 700 }}>Total</td>
                  <td></td>
                  <td style={{ ...cellPad, fontWeight: 700 }}>{months.reduce((s, m) => s + m.boxes_for_month, 0).toLocaleString()}</td>
                  <td style={{ ...cellPad, fontWeight: 700 }}>{money(flatTotal, cur)}</td>
                  <td style={{ ...cellPad, fontWeight: 700 }}>{money(boxTotal, cur)}</td>
                  <td style={{ ...cellPad, fontWeight: 700 }}>{money(wagesTotal, cur)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {partialNote && <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: 0 }}>{partialNote}</p>}
      </div>

      <div className="card">
        <h2>Landings ({landings.length})</h2>
        {landings.length === 0 && <p className="muted">No landings recorded for this contract.</p>}
        {landings.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {landings.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...cellPad, fontWeight: 600 }}>{fmtDate(l.landing_date)}</td>
                  <td style={cellPad}>{l.boxes.toLocaleString()} boxes</td>
                  <td style={{ ...cellPad }} className="muted">{l.notes && !l.notes.startsWith('v7 import') ? l.notes : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  )
}
