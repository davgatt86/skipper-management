import { useEffect, useMemo, useState } from 'react'
import BackNav from '../BackNav'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function keyOf(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const todayKey = () => keyOf(new Date())
function addDays(dateStr, n){ const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate()+n); return d }
const isWeekend = d => d.getDay()===0 || d.getDay()===6
const niceDate = key => { const d = new Date(key+'T12:00:00'); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` }

// trip ~8 days: +7 possible (early), +8 likely, +9 possible (late)
const OFFSETS = [[7,'early'],[8,'likely'],[9,'late']]
const STATUS = {
  early:  { label:'Possible', tag:'+7', bg:'rgba(180,83,9,0.12)',  bd:'var(--amber)', fg:'var(--amber)' },
  likely: { label:'Likely',   tag:'+8', bg:'rgba(21,128,61,0.14)', bd:'var(--green)', fg:'var(--green)' },
  late:   { label:'Possible', tag:'+9', bg:'rgba(30,58,95,0.10)',  bd:'var(--navy)',  fg:'var(--navy)' },
}
const rank = s => s==='early'?0 : s==='likely'?1 : 2

export default function Forecast(){
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'
  const [deps, setDeps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ vessel_name:'', departure_port:'Peterhead', departure_date: todayKey() })
  const [saving, setSaving] = useState(false)

  async function load(){
    setLoading(true); setError('')
    const cutoff = keyOf(addDays(todayKey(), -10))
    const { data, error } = await supabase.from('vessel_departures').select('*')
      .gte('departure_date', cutoff).order('departure_date', { ascending:false })
    if (error) setError(error.message)
    setDeps(data || []); setLoading(false)
  }
  useEffect(()=>{ if(isSkipper) load(); else setLoading(false) }, [isSkipper])

  const days = useMemo(()=>{
    const today = todayKey(); const map = {}
    for (const dep of deps){
      const base = dep.departure_date || (dep.departed_at ? dep.departed_at.slice(0,10) : null)
      if (!base) continue
      for (const [off, status] of OFFSETS){
        const d = addDays(base, off)
        if (isWeekend(d)) continue                 // no Peterhead auction Sat/Sun
        const k = keyOf(d)
        if (k < today) continue                    // rolling: past days fall off
        ;(map[k] = map[k] || []).push({ vessel: dep.vessel_name, status })
      }
    }
    return Object.keys(map).sort().map(k => ({
      key:k, items: map[k].sort((a,b)=> rank(a.status)-rank(b.status) || a.vessel.localeCompare(b.vessel))
    }))
  }, [deps])

  async function addDeparture(){
    if (!draft.vessel_name.trim() || !draft.departure_date) return
    setSaving(true)
    const { error } = await supabase.from('vessel_departures').insert({
      fleet_id: appUser.fleet_id, vessel_name: draft.vessel_name.trim(),
      departure_port: draft.departure_port || null, departure_date: draft.departure_date,
      departed_at: new Date(draft.departure_date + 'T12:00:00').toISOString(), source:'manual',
    })
    setSaving(false)
    if (error){ setError(error.message); return }
    setDraft({ vessel_name:'', departure_port:'Peterhead', departure_date: todayKey() }); load()
  }
  async function removeDeparture(id){
    if (!confirm('Remove this departure?')) return
    const { error } = await supabase.from('vessel_departures').delete().eq('id', id)
    if (error) setError(error.message); else load()
  }

  if (!isSkipper) return (
    <div className="container"><div style={{marginBottom:'1rem'}}><BackNav/></div>
      <div className="card"><p className="muted">The market forecast is available to the skipper.</p></div></div>)

  return (
    <div className="container">
      <div style={{marginBottom:'1rem'}}><BackNav/></div>
      <div className="card">
        <h1 style={{marginBottom:'0.3rem'}}>Peterhead Market Forecast</h1>
        <p className="muted" style={{fontSize:'0.85rem', marginBottom:0}}>
          Boats likely landing, projected from departures. A trip runs ~8 days: <b>+7</b> possible, <b>+8</b> likely, <b>+9</b> possible. No auction Sat/Sun, so those days are skipped.
        </p>
      </div>
      {error && <div className="card" style={{borderColor:'var(--red)'}}><p className="error">{error}</p></div>}
      {loading ? <div className="card"><p className="muted">Loading…</p></div> : (
        <>
          <div className="card" style={{display:'flex', gap:'1rem', flexWrap:'wrap'}}>
            {['early','likely','late'].map(s=>(
              <span key={s} style={{display:'inline-flex', alignItems:'center', gap:'0.4rem', fontSize:'0.82rem'}}>
                <span style={{width:14,height:14,borderRadius:3,background:STATUS[s].bg,border:`2px solid ${STATUS[s].bd}`}}/>
                {STATUS[s].label} ({STATUS[s].tag})
              </span>))}
          </div>
          {days.length===0 ? (
            <div className="card"><p className="muted">No upcoming landings forecast. Departures will appear automatically once the MarineTraffic ingest is live — or add one below to test.</p></div>
          ) : days.map(day=>(
            <div key={day.key} className="card" style={{padding:'0.8rem 1rem'}}>
              <div style={{fontWeight:700, marginBottom:'0.5rem'}}>{niceDate(day.key)}</div>
              <div style={{display:'flex', flexDirection:'column', gap:'0.4rem'}}>
                {day.items.map((it,i)=>(
                  <div key={i} style={{display:'flex', alignItems:'center', gap:'0.6rem', padding:'0.4rem 0.6rem', borderRadius:8, background:STATUS[it.status].bg, border:`1px solid ${STATUS[it.status].bd}`}}>
                    <span style={{fontWeight:600}}>{it.vessel}</span>
                    <span style={{fontSize:'0.75rem', fontWeight:700, color:STATUS[it.status].fg, marginLeft:'auto'}}>{STATUS[it.status].label}</span>
                    <span className="muted" style={{fontSize:'0.72rem'}}>{STATUS[it.status].tag}</span>
                  </div>))}
              </div>
            </div>))}
          <div className="card">
            <h2 style={{marginTop:0, fontSize:'1.05rem'}}>Departures (last 10 days)</h2>
            <div style={{display:'grid', gap:'0.6rem', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', alignItems:'end', marginBottom:'0.8rem'}}>
              <label style={lbl}>Vessel<input value={draft.vessel_name} onChange={e=>setDraft(p=>({...p,vessel_name:e.target.value}))} placeholder="AUDACIOUS BF83" style={inp}/></label>
              <label style={lbl}>Port<input value={draft.departure_port} onChange={e=>setDraft(p=>({...p,departure_port:e.target.value}))} style={inp}/></label>
              <label style={lbl}>Sailed<input type="date" value={draft.departure_date} onChange={e=>setDraft(p=>({...p,departure_date:e.target.value}))} style={inp}/></label>
              <button onClick={addDeparture} disabled={saving || !draft.vessel_name.trim()}>{saving?'Adding…':'Add departure'}</button>
            </div>
            {deps.length===0 ? <p className="muted">None logged yet.</p> : (
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:'0.88rem'}}>
                <thead><tr><th style={th}>Vessel</th><th style={th}>Port</th><th style={th}>Sailed</th><th style={th}></th></tr></thead>
                <tbody>
                  {deps.map(d=>(
                    <tr key={d.id} style={{borderBottom:'1px solid var(--border)'}}>
                      <td style={td}>{d.vessel_name}</td>
                      <td style={{...td}} className="muted">{d.departure_port||'—'}</td>
                      <td style={td}>{d.departure_date ? niceDate(d.departure_date) : '—'}</td>
                      <td style={{...td, textAlign:'right'}}><button className="secondary" onClick={()=>removeDeparture(d.id)} style={{padding:'0.2rem 0.6rem', fontSize:'0.8rem'}}>Remove</button></td>
                    </tr>))}
                </tbody>
              </table>)}
          </div>
        </>)}
    </div>)
}
const lbl = { display:'flex', flexDirection:'column', gap:'0.25rem', fontSize:'0.8rem', fontWeight:600 }
const inp = { padding:'0.45rem 0.55rem', borderRadius:7, border:'1px solid var(--border)', fontSize:'0.95rem', fontWeight:400 }
const th = { textAlign:'left', padding:'0.4rem 0.5rem', borderBottom:'2px solid var(--border)', whiteSpace:'nowrap' }
const td = { padding:'0.4rem 0.5rem', whiteSpace:'nowrap' }
