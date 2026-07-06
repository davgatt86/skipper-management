import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { kpis, bySpecies, gradesFor, byBuyer, buyerSpecies, buyerSpeciesGrades, shortMarket, r2 } from '../lib/salesAgg'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtDate = (iso) => { if (!iso) return ''; const [y,m,d] = iso.split('-'); return `${d}/${m}/${String(y).slice(2)}` }
const money = (n) => '£' + Math.round(Number(n)||0).toLocaleString()
const pkgFmt = (n) => '£' + (Number(n)||0).toFixed(2)
const kInt = (n) => Math.round(Number(n)||0).toLocaleString()
const EMPTY = { value:0, kg:0, boxes:0, pkg:0 }

function idsFor(landings, sel){
  if (sel.mode === 'landing') return sel.landingId ? [sel.landingId] : []
  if (sel.mode === 'month')  return landings.filter(l => (l.landing_date||'').startsWith(`${sel.year}-${sel.month}`)).map(l => l.id)
  return landings.filter(l => (l.landing_date||'').startsWith(sel.year)).map(l => l.id)
}
function labelFor(landings, sel){
  if (sel.mode === 'landing'){ const l = landings.find(x=>x.id===sel.landingId); return l ? `${l.vessel} · ${fmtDate(l.landing_date)} · ${shortMarket(l.market)}${l.sale_no?' #'+l.sale_no:''}` : 'Pick a landing' }
  if (sel.mode === 'month') return `${MONTHS[Number(sel.month)-1]} ${sel.year}`
  return sel.year
}
// union two aggregation arrays into compare items sorted by combined value
function mergeCmp(aList, bList, keyField){
  const m = {}
  for (const x of aList) m[x[keyField]] = { key:x[keyField], label:x[keyField], a:x, b:EMPTY }
  for (const x of bList){ m[x[keyField]] = m[x[keyField]] || { key:x[keyField], label:x[keyField], a:EMPTY, b:EMPTY }; m[x[keyField]].b = x }
  return Object.values(m).sort((p,q) => (q.a.value+q.b.value) - (p.a.value+p.b.value))
}

function useRows(ids){
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(false)
  const key = ids.join(',')
  useEffect(() => { let cancel = false
    if (!ids.length){ setRows([]); return }
    ;(async () => { setLoading(true); const out = []
      try { for (let i=0;i<ids.length;i+=50){ const chunk = ids.slice(i,i+50); let from=0
          for(;;){ const { data, error } = await supabase.from('sales_rows').select('*').in('landing_id', chunk).range(from, from+999)
            if (error) throw error; out.push(...(data||[])); if (!data || data.length < 1000) break; from += 1000 } }
        if (!cancel) setRows(out)
      } catch { if (!cancel) setRows([]) }
      if (!cancel) setLoading(false)
    })(); return () => { cancel = true }
  }, [key])
  return { rows, loading }
}

export default function SalesCompare(){
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'
  const [landings, setLandings] = useState([])
  const [loading, setLoading] = useState(true)

  const now = new Date()
  const [A, setA] = useState({ mode:'landing', year:String(now.getFullYear()), month:String(now.getMonth()+1).padStart(2,'0'), landingId:'' })
  const [B, setB] = useState({ mode:'landing', year:String(now.getFullYear()), month:String(now.getMonth()+1).padStart(2,'0'), landingId:'' })

  const [openSp, setOpenSp] = useState('')            // species-section: which species -> grades
  const [openBuyer, setOpenBuyer] = useState('')      // buyer-section: which buyer -> species
  const [openBuyerSp, setOpenBuyerSp] = useState('')  // buyer-section: "buyer::species" -> grades

  useEffect(() => { if (!isSkipper){ setLoading(false); return } ;(async () => {
    const { data } = await supabase.from('sales_landings').select('*')
      .order('landing_date', { ascending:false }).order('created_at', { ascending:false })
    const ls = data || []; setLandings(ls); setLoading(false)
    if (ls[0]) setA(s => ({ ...s, landingId: ls[0].id }))
    if (ls[1]) setB(s => ({ ...s, landingId: ls[1].id }))
  })() }, [isSkipper])

  const years = useMemo(() => [...new Set(landings.map(l => (l.landing_date||'').slice(0,4)).filter(Boolean))].sort().reverse(), [landings])
  const aIds = useMemo(() => idsFor(landings, A), [landings, A])
  const bIds = useMemo(() => idsFor(landings, B), [landings, B])
  const { rows:aRows, loading:aL } = useRows(aIds)
  const { rows:bRows, loading:bL } = useRows(bIds)

  const aK = useMemo(() => kpis(aRows, aIds.length), [aRows, aIds.length])
  const bK = useMemo(() => kpis(bRows, bIds.length), [bRows, bIds.length])

  // Species section flat rows (species -> grades on expand)
  const speciesRows = useMemo(() => {
    const out = []
    for (const sp of mergeCmp(bySpecies(aRows), bySpecies(bRows), 'species')){
      out.push({ level:0, key:sp.key, label:sp.label, a:sp.a, b:sp.b, expandable:true, open:openSp===sp.key })
      if (openSp===sp.key)
        for (const gr of mergeCmp(gradesFor(aRows,sp.key), gradesFor(bRows,sp.key), 'grade'))
          out.push({ level:1, key:sp.key+'::'+gr.key, label:gr.label, a:gr.a, b:gr.b, expandable:false })
    }
    return out
  }, [aRows, bRows, openSp])

  // Buyer section flat rows (buyer -> species -> grades on expand)
  const buyerRows = useMemo(() => {
    const out = []
    for (const bu of mergeCmp(byBuyer(aRows), byBuyer(bRows), 'buyer')){
      out.push({ level:0, key:bu.key, label:bu.label, a:bu.a, b:bu.b, expandable:true, open:openBuyer===bu.key })
      if (openBuyer===bu.key){
        for (const sp of mergeCmp(buyerSpecies(aRows,bu.key), buyerSpecies(bRows,bu.key), 'species')){
          const spKey = bu.key+'::'+sp.key
          out.push({ level:1, key:spKey, label:sp.label, a:sp.a, b:sp.b, expandable:true, open:openBuyerSp===spKey })
          if (openBuyerSp===spKey)
            for (const gr of mergeCmp(buyerSpeciesGrades(aRows,bu.key,sp.key), buyerSpeciesGrades(bRows,bu.key,sp.key), 'grade'))
              out.push({ level:2, key:spKey+'::'+gr.key, label:gr.label, a:gr.a, b:gr.b, expandable:false })
        }
      }
    }
    return out
  }, [aRows, bRows, openBuyer, openBuyerSp])

  if (!isSkipper) return <div className="container"><p className="muted">Skipper access only. <Link to="/">← Back</Link></p></div>
  const aLabel = labelFor(landings, A), bLabel = labelFor(landings, B)

  const toggleSpecies = (r) => setOpenSp(v => v===r.key ? '' : r.key)
  const toggleBuyer = (r) => { if (r.level===0){ setOpenBuyer(v => v===r.key ? '' : r.key); setOpenBuyerSp('') } else if (r.level===1){ setOpenBuyerSp(v => v===r.key ? '' : r.key) } }

  return (
    <div className="container" style={{ maxWidth: 1180 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', flexWrap:'wrap', gap:'0.5rem' }}>
        <h1 style={{ marginBottom:'0.2rem' }}>Compare Sales</h1>
        <p className="muted"><Link to="/sales">← Fish Sales</Link> · <Link to="/">Dashboard</Link></p>
      </div>
      <p className="muted" style={{ fontSize:'0.85rem', marginTop:0 }}>Set each side to a landing, month or year. Centre shows B − A. Click a species (or buyer) to drill into grades.</p>

      {loading ? <div className="card"><p className="muted">Loading…</p></div> : (<>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.8rem' }}>
          <SidePicker tint="#1E3A5F" tag="A" landings={landings} years={years} sel={A} setSel={setA}/>
          <SidePicker tint="#0E7490" tag="B" landings={landings} years={years} sel={B} setSel={setB}/>
        </div>

        <div className="card" style={{ marginTop:'0.9rem' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1.1fr 1fr', gap:'0.5rem', alignItems:'center', marginBottom:'0.6rem' }}>
            <div style={{ fontWeight:700, color:'#1E3A5F' }}>{aLabel}</div>
            <div style={{ textAlign:'center', color:'var(--grey-400)', fontSize:'0.8rem' }}>difference (B − A)</div>
            <div style={{ fontWeight:700, color:'#0E7490', textAlign:'right' }}>{bLabel}</div>
          </div>
          {(aL||bL) && <p className="muted" style={{ fontSize:'0.78rem' }}>Loading rows…</p>}
          <KpiRow label="Gross"    a={aK.value} b={bK.value} fmt={money}  kind="money"/>
          <KpiRow label="Weight"   a={aK.kg}    b={bK.kg}    fmt={n=>kInt(n)+' kg'} kind="kg"/>
          <KpiRow label="Boxes"    a={aK.boxes} b={bK.boxes} fmt={kInt}   kind="int"/>
          <KpiRow label="Avg £/kg" a={aK.pkg}   b={bK.pkg}   fmt={pkgFmt} kind="pkg"/>
          <KpiRow label="Landings" a={aK.landings} b={bK.landings} fmt={n=>n} kind="int"/>
        </div>

        <CmpSection title="By species — click to see grades" aLabel={aLabel} bLabel={bLabel} rows={speciesRows} onToggle={toggleSpecies}
          empty="Pick two selections with sales to compare." />

        <CmpSection title="By buyer — click a buyer, then a species, for grades" aLabel={aLabel} bLabel={bLabel} rows={buyerRows} onToggle={toggleBuyer}
          empty="No buyer data for these selections." />

        <div style={{ marginTop:'0.8rem' }}>
          <button className="secondary" onClick={() => window.print()} disabled={!aRows.length && !bRows.length}>PDF / Print</button>
        </div>
      </>)}
    </div>
  )
}

function CmpSection({ title, aLabel, bLabel, rows, onToggle, empty }){
  return (
    <div className="card" style={{ marginTop:'0.9rem', overflowX:'auto' }}>
      <div style={{ fontWeight:700, color:'var(--navy)', marginBottom:'0.5rem' }}>{title}</div>
      <table style={{ borderCollapse:'collapse', width:'100%', fontSize:'0.85rem', minWidth:740 }}>
        <thead>
          <tr>
            <th style={thL}></th>
            <th style={thA} colSpan={3}>A · {aLabel}</th>
            <th style={{ ...thD, textAlign:'center', ...th }} colSpan={2}>+/−</th>
            <th style={thB} colSpan={3}>B · {bLabel}</th>
          </tr>
          <tr>
            <th style={thL}></th>
            <th style={thNum}>£</th><th style={thNum}>kg</th><th style={thNum}>£/kg</th>
            <th style={{ ...thNum, ...thD }}>Δ £</th><th style={{ ...thNum, ...thD }}>Δ £/kg</th>
            <th style={thNum}>£/kg</th><th style={thNum}>kg</th><th style={thNum}>£</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} onClick={r.expandable?()=>onToggle(r):undefined}
                style={{ borderTop:'1px solid var(--border)', cursor:r.expandable?'pointer':'default', background: r.level>0?'#FBFCFE':'transparent' }}>
              <td style={{ ...td, paddingLeft:`${0.5 + r.level*1.15}rem`, fontWeight: r.level===0?600:500, color: r.level===0?'var(--navy)':'#475569' }}>
                {r.expandable ? (r.open?'▾ ':'▸ ') : (r.level>0?'· ':'')}{r.label}
              </td>
              <td style={tdNum}>{r.a.value?money(r.a.value):'—'}</td>
              <td style={tdNum}>{r.a.kg?kInt(r.a.kg):'—'}</td>
              <td style={tdNum}>{r.a.pkg?pkgFmt(r.a.pkg):'—'}</td>
              <td style={{ ...tdNum, ...thD }}>{(r.a.value||r.b.value)?deltaText(r.a.value, r.b.value, money):'—'}</td>
              <td style={{ ...tdNum, ...thD }}>{(r.a.pkg&&r.b.pkg)?deltaText(r.a.pkg, r.b.pkg, pkgFmt):'—'}</td>
              <td style={tdNum}>{r.b.pkg?pkgFmt(r.b.pkg):'—'}</td>
              <td style={tdNum}>{r.b.kg?kInt(r.b.kg):'—'}</td>
              <td style={tdNum}>{r.b.value?money(r.b.value):'—'}</td>
            </tr>
          ))}
          {rows.length===0 && <tr><td colSpan={9} style={{ ...td, color:'var(--grey-400)' }}>{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function SidePicker({ tint, tag, landings, years, sel, setSel }){
  const set = (k,v) => setSel(s => ({ ...s, [k]:v }))
  const btn = (m,label) => (
    <button onClick={() => set('mode', m)} style={{ padding:'4px 10px', border:'none', cursor:'pointer', fontSize:'0.8rem',
      fontWeight: sel.mode===m?700:500, background: sel.mode===m?tint:'#fff', color: sel.mode===m?'#fff':'#334155' }}>{label}</button>)
  return (
    <div className="card" style={{ borderTop:`3px solid ${tint}` }}>
      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.6rem' }}>
        <span style={{ background:tint, color:'#fff', fontWeight:700, borderRadius:6, padding:'1px 8px', fontSize:'0.8rem' }}>{tag}</span>
        <div style={{ display:'inline-flex', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
          {btn('landing','Landing')}{btn('month','Month')}{btn('year','Year')}
        </div>
      </div>
      {sel.mode==='landing' && (
        <select value={sel.landingId} onChange={e=>set('landingId', e.target.value)} style={inp}>
          <option value="">— pick a landing —</option>
          {landings.map(l => <option key={l.id} value={l.id}>{l.vessel} · {fmtDate(l.landing_date)} · {shortMarket(l.market)}{l.sale_no?' #'+l.sale_no:''}</option>)}
        </select>)}
      {sel.mode==='month' && (
        <div style={{ display:'flex', gap:'0.5rem' }}>
          <select value={sel.month} onChange={e=>set('month', e.target.value)} style={inp}>{MONTHS.map((mn,i)=><option key={mn} value={String(i+1).padStart(2,'0')}>{mn}</option>)}</select>
          <select value={sel.year} onChange={e=>set('year', e.target.value)} style={inp}>{years.map(y=><option key={y} value={y}>{y}</option>)}</select>
        </div>)}
      {sel.mode==='year' && (
        <select value={sel.year} onChange={e=>set('year', e.target.value)} style={inp}>{years.map(y=><option key={y} value={y}>{y}</option>)}</select>)}
    </div>
  )
}

function deltaColor(d){ return d>0 ? '#16A34A' : d<0 ? '#DC2626' : 'var(--grey-400)' }
function deltaText(a, b, fmt){
  const d = r2((Number(b)||0) - (Number(a)||0))
  return <span style={{ color:deltaColor(d), fontWeight:600 }}>{d>0?'▲':d<0?'▼':'–'} {fmt(Math.abs(d))}</span>
}
function KpiRow({ label, a, b, fmt, kind }){
  const d = r2((Number(b)||0) - (Number(a)||0))
  const pct = a ? Math.round((d/a)*100) : null
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1.1fr 1fr', gap:'0.5rem', alignItems:'center', padding:'0.4rem 0', borderTop:'1px solid var(--border)' }}>
      <div><span style={{ color:'var(--grey-400)', fontSize:'0.72rem', display:'block' }}>{label}</span>
        <span style={{ fontWeight:700, fontSize:'1.05rem', color:'#1E3A5F' }}>{fmt(a)}</span></div>
      <div style={{ textAlign:'center' }}>
        <span style={{ color:deltaColor(d), fontWeight:700 }}>{d>0?'▲':d<0?'▼':'–'} {kind==='int'?Math.abs(d):fmt(Math.abs(d))}</span>
        {pct!==null && kind!=='int' && <span style={{ display:'block', fontSize:'0.72rem', color:deltaColor(d) }}>{d>0?'+':''}{pct}%</span>}
      </div>
      <div style={{ textAlign:'right' }}><span style={{ color:'var(--grey-400)', fontSize:'0.72rem', display:'block' }}>{label}</span>
        <span style={{ fontWeight:700, fontSize:'1.05rem', color:'#0E7490' }}>{fmt(b)}</span></div>
    </div>
  )
}

const inp = { padding:'6px 8px', borderRadius:7, border:'1px solid var(--border)', fontSize:'0.9rem', width:'100%' }
const th = { textAlign:'left', padding:'0.4rem 0.5rem', borderBottom:'2px solid var(--border)', whiteSpace:'nowrap', color:'var(--navy)', fontSize:'0.78rem' }
const thL = { ...th }
const thNum = { ...th, textAlign:'right' }
const thA = { ...th, textAlign:'center', color:'#1E3A5F' }
const thB = { ...th, textAlign:'center', color:'#0E7490' }
const thD = { background:'#F8FAFC' }
const td = { padding:'0.35rem 0.5rem', whiteSpace:'nowrap' }
const tdNum = { ...td, textAlign:'right', fontVariantNumeric:'tabular-nums' }
