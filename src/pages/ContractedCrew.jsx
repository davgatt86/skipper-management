import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import CrewTabs from '../CrewTabs'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

// Section 2 of the crew page: contracted crew.
//
// This merges what were five separate tiles — Contracts, Landings, Month
// Closeout, One-Off Bonuses and Bonus Settings. They are all
// contracted-crew-only and they are one workflow, not five features:
//
//   contract runs → boxes land → month closes → bonus falls due
//
// So they are laid out in that order, each with the figure that tells you
// whether it needs attention, rather than as an unordered wall of links.
// Self-employed crew never appear here; they have no contract and no box
// bonus.

const SYMBOL = { GBP: '£', EUR: '€', USD: '$', DKK: 'kr', NOK: 'kr' }
function money(n, cur) {
  if (n === null || n === undefined) return '—'
  const raw = (cur || '£').trim()
  const sym = SYMBOL[raw.toUpperCase()] || (raw.length <= 2 ? raw : '£')
  return `${sym}${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const monthName = () => new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

// month_closeouts.month is a date, so it arrives as "2026-07-01".
const monthOf = (d) => (d
  ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  : null)

export default function ContractedCrew() {
  const { appUser } = useAuth()
  const [state, setState] = useState({ loading: true })

  useEffect(() => {
    async function load() {
      const monthStart = new Date().toISOString().slice(0, 8) + '01'
      const [crewRes, ctRes, lRes, coRes, ooRes, sRes] = await Promise.all([
        supabase.from('crew').select('id, full_name, status, crew_type').is('archived_at', null),
        supabase.from('contracts').select('id, crew_id, start_date, end_date, status, going_home_bonus'),
        supabase.from('landings').select('id, landing_date, boxes').gte('landing_date', monthStart),
        supabase.from('month_closeouts').select('id, month').order('month', { ascending: false }).limit(1),
        supabase.from('one_off_bonuses').select('id, amount, created_at').gte('created_at', monthStart),
        supabase.from('settings').select('*').maybeSingle(),
      ])
      const crew = (crewRes.data || []).filter((c) => (c.crew_type || 'contracted') !== 'self_employed')
      const crewIds = new Set(crew.map((c) => c.id))
      const contracts = (ctRes.data || []).filter((x) => crewIds.has(x.crew_id))
      const active = contracts.filter((x) => x.status === 'active' || (!x.end_date && x.status !== 'ended'))
      setState({
        loading: false,
        error: crewRes.error?.message || ctRes.error?.message || '',
        contractedCount: crew.length,
        aboard: crew.filter((c) => c.status === 'on_boat').length,
        activeContracts: active.length,
        noBonusSet: active.filter((x) => x.going_home_bonus == null).length,
        monthBoxes: (lRes.data || []).reduce((s, l) => s + Number(l.boxes || 0), 0),
        monthLandings: (lRes.data || []).length,
        lastCloseout: coRes.data?.[0]?.month || null,
        oneOffCount: (ooRes.data || []).length,
        oneOffTotal: (ooRes.data || []).reduce((s, b) => s + Number(b.amount || 0), 0),
        settings: sRes.data || null,
      })
    }
    load()
  }, [])

  const s = state
  const cur = s.settings?.currency
  const boxRate = s.settings ? Number(s.settings.box_rate) : null
  const canSeeOneOffs = ['skipper', 'viewer'].includes(appUser?.role)
  const isSkipper = appUser?.role === 'skipper'

  // Each step: where it goes, what it is, and the one figure worth seeing.
  const STEPS = [
    {
      to: '/contracts', n: 1, label: 'Contracts', show: true,
      what: 'The agreement each contracted crewman is working under.',
      figure: s.loading ? '…' : `${s.activeContracts} running`,
      warn: s.noBonusSet > 0 ? `${s.noBonusSet} with no going-home bonus set` : null,
    },
    {
      to: '/landings', n: 2, label: 'Landings', show: true,
      what: 'Boxes landed, and who was aboard for them. This is what the box bonus is paid on.',
      figure: s.loading ? '…' : `${(s.monthBoxes || 0).toLocaleString('en-GB')} boxes`,
      sub: s.loading ? '' : `${s.monthLandings} landing${s.monthLandings === 1 ? '' : 's'} in ${monthName()}`,
    },
    {
      to: '/closeout', n: 3, label: 'Month closeout', show: true,
      what: 'Settles the month: box bonus per man, and what falls due.',
      figure: s.loading ? '…' : (s.lastCloseout ? `last closed ${monthOf(s.lastCloseout)}` : 'never closed'),
      warn: !s.loading && !s.lastCloseout ? 'no month has been closed yet' : null,
    },
    {
      to: '/one-offs', n: 4, label: 'One-off bonuses', show: canSeeOneOffs,
      what: 'Anything paid outside the box bonus and going-home bonus.',
      figure: s.loading ? '…' : `${s.oneOffCount} this month`,
      sub: s.loading ? '' : (s.oneOffCount ? money(s.oneOffTotal, cur) : ''),
    },
    {
      to: '/settings', n: 5, label: 'Bonus settings', show: isSkipper,
      what: 'The box rate every bonus above is calculated from.',
      figure: s.loading ? '…' : (boxRate ? `${money(boxRate, cur)} per box` : 'not set'),
      warn: !s.loading && !boxRate ? 'box rate is not set, so bonuses compute to zero' : null,
    },
  ].filter((x) => x.show)

  return (
    <AppShell>
      <PageHeader title="Contracted crew" sub="Contract runs → boxes land → month closes → bonus falls due" />

      <CrewTabs />

      {s.error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error">{s.error}</p></div>}

      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          {s.loading ? 'Loading…' : (
            <>
              {s.contractedCount} contracted crew, {s.aboard} aboard. Self-employed crew are not
              shown here — they have no contract and no box bonus.
            </>
          )}
        </p>
      </div>

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {STEPS.map((step) => (
          <Link
            key={step.to}
            to={step.to}
            className="card"
            style={{ display: 'block', textDecoration: 'none', color: 'inherit', marginBottom: 0 }}
          >
            <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
              <div
                style={{
                  flex: '0 0 auto', width: 30, height: 30, borderRadius: '50%',
                  background: 'var(--hull)', color: '#fff', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono, monospace)', fontSize: '0.9rem',
                }}
              >
                {step.n}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <strong style={{ fontSize: '1.05rem' }}>{step.label}</strong>
                  <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: 'var(--hull)' }}>
                    {step.figure}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: '0.85rem', marginTop: '0.2rem' }}>{step.what}</div>
                {step.sub && <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.15rem' }}>{step.sub}</div>}
                {step.warn && (
                  <div style={{ fontSize: '0.82rem', marginTop: '0.3rem', color: 'var(--brass)', fontWeight: 700 }}>
                    {step.warn}
                  </div>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  )
}
