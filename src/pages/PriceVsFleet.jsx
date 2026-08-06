import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const pkg = (n) => n == null ? '—' : '£' + Number(n).toFixed(2)
const pctText = (own, fleet) => {
  if (own == null || fleet == null || fleet === 0) return null
  return ((own - fleet) / fleet) * 100
}
// grade display order: A1+,A1,A2+,A2… haddock A4 Chipper/Metro/Mini Metro… A5,A9,U9,B1–B5
const LETTER_ORDER = { A:0, U:1, B:2 }
const SUB_ORDER = { 'CHIPPER':1, 'METRO':2, 'MINI METRO':3 }
function gradeOrderKey(label){
  const parts = String(label).toUpperCase().split('\u00b7').map(x=>x.trim())
  const g = parts[0] || '', sub = parts[1] || ''
  const letter = (g.match(/[A-Z]+/) || ['Z'])[0]
  const num = Number((g.match(/\d+/) || [99])[0])
  const lg = LETTER_ORDER[letter] ?? 8
  const subOrd = sub ? (SUB_ORDER[sub] ?? 8) : 0
  const plus = /\+/.test(g) ? 0 : 1
  return String(lg) + String(num).padStart(2,'0') + subOrd + plus
}

const iso = (d) => d.toISOString().slice(0,10)

export default function PriceVsFleet(){
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'
  const now = new Date()
  const thisYear = now.getFullYear()

  const [mode, setMode] = useState('ytd')            // 'ytd' | 'month'
  const [year, setYear] = useState(thisYear)
  const [month, setMonth] = useState(now.getMonth()+1)

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState('')               // expanded species
  const [grades, setGrades] = useState({})           // species -> grade rows

  const period = useMemo(() => {
    if (mode === 'ytd') return { from: `${thisYear}-01-01`, to: iso(now), label: `${thisYear} so far` }
    const mm = String(month).padStart(2,'0')
    const last = new Date(year, month, 0).getDate()
    return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2,'0')}`, label: `${MONTHS[month-1]} ${year}` }
  }, [mode, year, month])

  useEffect(() => { if (!isSkipper) { setLoading(false); return } ;(async () => {
    setLoading(true); setError(''); setOpen(''); setGrades({})
    const { data, error } = await supabase.rpc('price_vs_fleet_species', { p_from: period.from, p_to: period.to })
    if (error) setError(error.message)
    setRows((data || []).slice().sort((a,b) => (b.own_pkg||0) - (a.own_pkg||0)))
    setLoading(false)
  })() }, [isSkipper, period.from, period.to])

  async function toggle(species){
    if (open === species) { setOpen(''); return }
    setOpen(species)
    if (!grades[species]) {
      const { data, error } = await supabase.rpc('price_vs_fleet_grades', { p_from: period.from, p_to: period.to, p_species: species })
      if (!error) setGrades(g => ({ ...g, [species]: (data || []).slice().sort((a,b) => gradeOrderKey(a.grade).localeCompare(gradeOrderKey(b.grade))) }))
    }
  }

  if (!isSkipper) return <AppShell><div className="card"><p className="muted">Skipper access only.</p></div></AppShell>

  const years = [thisYear, thisYear-1, thisYear-2]

  return (
    <AppShell maxWidth={760}>
      <PageHeader
        title="Your prices vs the fleet"
        sub="Average £/kg you got for each species against the fleet average, anonymous — no boats, tonnage or dates. Tap a species for its grades. A species only shows a fleet figure once at least 3 boats are behind it."
      />

      {/* period toggle */}
      <div className="card" style={{ display:'flex', alignItems:'center', gap:'0.6rem', flexWrap:'wrap' }}>
        <div style={{ display:'inline-flex', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
          {[['ytd','Year so far'],['month','Month']].map(([m,label]) => (
            <button key={m} onClick={()=>setMode(m)} style={{ padding:'5px 12px', border:'none', cursor:'pointer', fontSize:'0.85rem',
              fontWeight: mode===m?700:500, background: mode===m?'var(--navy)':'var(--surface)', color: mode===m?'var(--on-navy)':'var(--grey-400)' }}>{label}</button>
          ))}
        </div>
        {mode==='month' && (<>
          <select value={month} onChange={e=>setMonth(Number(e.target.value))} style={sel}>
            {MONTHS.map((mn,i)=><option key={mn} value={i+1}>{mn}</option>)}
          </select>
          <select value={year} onChange={e=>setYear(Number(e.target.value))} style={sel}>
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </>)}
        <span className="muted" style={{ fontSize:'0.8rem', marginLeft:'auto' }}>{period.label}</span>
      </div>

      {error && <div className="card" style={{ borderColor:'var(--red)' }}><p className="error">{error}</p></div>}

      <div className="card" style={{ padding:0, overflow:'hidden' }}>
        <div style={{ ...rowStyle, fontWeight:700, color:'var(--navy)', borderBottom:'2px solid var(--border)', background:'var(--surface-2)' }}>
          <span>Species</span><span style={num}>You £/kg</span><span style={num}>Fleet £/kg</span><span style={num}>vs fleet</span>
        </div>
        {loading ? <div style={{ padding:'1rem' }} className="muted">Loading…</div>
         : rows.length === 0 ? <div style={{ padding:'1rem' }} className="muted">No sales in {period.label}.</div>
         : rows.map(r => {
            const p = pctText(r.own_pkg, r.fleet_pkg)
            const isOpen = open === r.species
            return (
              <div key={r.species}>
                <div onClick={()=>toggle(r.species)} style={{ ...rowStyle, cursor:'pointer', borderTop:'1px solid var(--border)' }}>
                  <span style={{ fontWeight:600, color:'var(--navy)' }}>{isOpen?'▾ ':'▸ '}{r.species}</span>
                  <span style={num}>{pkg(r.own_pkg)}</span>
                  <span style={num}>{r.fleet_pkg == null
                    ? <span title="Not enough boats yet" style={{ color:'var(--grey-400)' }}>—</span>
                    : pkg(r.fleet_pkg)}</span>
                  <span style={num}>{p == null ? '' : <b style={{ color: p>0?'var(--green)':p<0?'var(--red)':'var(--grey-400)' }}>{p>0?'+':''}{p.toFixed(1)}%</b>}</span>
                </div>
                {isOpen && (grades[r.species] || []).map(g => {
                  const gp = pctText(g.own_pkg, g.fleet_pkg)
                  return (
                    <div key={g.grade} style={{ ...rowStyle, borderTop:'1px solid var(--border)', background:'var(--surface-2)' }}>
                      <span style={{ paddingLeft:'1.4rem', color:'var(--grey-700)' }}>{g.grade}</span>
                      <span style={num}>{pkg(g.own_pkg)}</span>
                      <span style={num}>{g.fleet_pkg == null ? <span style={{ color:'var(--grey-400)' }}>—</span> : pkg(g.fleet_pkg)}</span>
                      <span style={num}>{gp == null ? '' : <b style={{ color: gp>0?'var(--green)':gp<0?'var(--red)':'var(--grey-400)' }}>{gp>0?'+':''}{gp.toFixed(1)}%</b>}</span>
                    </div>
                  )
                })}
                {isOpen && grades[r.species] && grades[r.species].length===0 && (
                  <div style={{ ...rowStyle, borderTop:'1px solid var(--border)', background:'var(--surface-2)', color:'var(--grey-400)' }}><span style={{ paddingLeft:'1.4rem' }}>No grade detail.</span><span/><span/><span/></div>
                )}
              </div>
            )
          })}
      </div>
      <p className="muted" style={{ fontSize:'0.75rem' }}>Value-weighted averages (total value ÷ total weight). Rate-pending Danish notes are left out until a rate is set.</p>
    </AppShell>
  )
}

const rowStyle = { display:'grid', gridTemplateColumns:'1.6fr 1fr 1fr 0.9fr', alignItems:'center', gap:'0.4rem', padding:'0.55rem 0.8rem', fontSize:'0.88rem' }
const num = { textAlign:'right', fontVariantNumeric:'tabular-nums' }
const sel = { padding:'5px 8px', borderRadius:7, border:'1px solid var(--border)', fontSize:'0.85rem' }
