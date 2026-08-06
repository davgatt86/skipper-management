import { useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function keyOf(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const todayKey = () => keyOf(new Date())
function addDays(dateStr, n){ const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate()+n); return d }
const isWeekend = d => d.getDay()===0 || d.getDay()===6
const niceDate = key => { const d = new Date(key+'T12:00:00'); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` }

// trip ~7-8 days: +7 likely, +8 possible. No Peterhead auction Sat/Sun.
const OFFSETS = [[7,'likely'],[8,'possible']]
const STATUS = {
  likely:   { label:'Likely',   tag:'+7', bg:'rgba(21,128,61,0.14)', bd:'var(--green)', fg:'var(--green)' },
  possible: { label:'Possible', tag:'+8', bg:'rgba(180,83,9,0.12)',  bd:'var(--amber)', fg:'var(--amber)' },
}
const rank = s => s==='likely' ? 0 : 1
const norm = s => (s || '').trim().toLowerCase()

export default function Forecast(){
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'
  const [deps, setDeps] = useState([])
  const [hidden, setHidden] = useState([])
  const [sel, setSel] = useState({})
  const [showHidden, setShowHidden] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ vessel_name:'', departure_port:'Peterhead', departure_date: todayKey() })
  const [saving, setSaving] = useState(false)

  const hiddenSet = useMemo(() => new Set(hidden.map(norm)), [hidden])

  async function load(){
    setLoading(true); setError('')
    const cutoff = keyOf(addDays(todayKey(), -10))
    const [{ data: hv }, { data, error }] = await Promise.all([
      supabase.from('hidden_vessels').select('vessel_name'),
      supabase.from('vessel_departures').select('*').gte('departure_date', cutoff).order('departure_date', { ascending:false }),
    ])
    if (error) setError(error.message)
    const hides = (hv || []).map(r => r.vessel_name)
    const all = data || []
    setHidden(hides); setDeps(all)
    const hset = new Set(hides.map(norm))
    const purge = all.filter(d => d.fleet_id === appUser?.fleet_id && hset.has(norm(d.vessel_name))).map(d => d.id)
    if (purge.length) supabase.from('vessel_departures').delete().in('id', purge).then(() => {}, () => {})
    setLoading(false)
  }
  useEffect(() => { if (isSkipper) load(); else setLoading(false) }, [isSkipper])

  const visibleDeps = useMemo(() => deps.filter(d => !hiddenSet.has(norm(d.vessel_name))), [deps, hiddenSet])

  const days = useMemo(() => {
    const today = todayKey(); const map = {}
    for (const dep of visibleDeps){
      const base = dep.departure_date || (dep.departed_at ? dep.departed_at.slice(0,10) : null)
      if (!base) continue
      for (const [off, status] of OFFSETS){
        const d = addDays(base, off)
        if (isWeekend(d)) continue
        const k = keyOf(d)
        if (k < today) continue
        const day = (map[k] = map[k] || {})
        if (!day[dep.vessel_name] || rank(status) < rank(day[dep.vessel_name])) day[dep.vessel_name] = status
      }
    }
    return Object.keys(map).sort().map(k => ({
      key: k,
      items: Object.entries(map[k]).map(([vessel, status]) => ({ vessel, status }))
        .sort((a,b) => rank(a.status) - rank(b.status) || a.vessel.localeCompare(b.vessel)),
    }))
  }, [visibleDeps])

  // Own vessel goes live on the forecast (its 'likely' = +7 day) -> alert naming
  // who else is due that day. Dedup'd, one per boat per trip.
  useEffect(() => {
    if (!isSkipper || !appUser?.fleet_id || !days.length) return
    const own = new Set(deps.filter(d => d.fleet_id === appUser.fleet_id).map(d => norm(d.vessel_name)))
    if (!own.size) return
    const today = todayKey()
    const rows = []
    for (const g of days) {
      if (g.key < today) continue
      const mine = g.items.filter(it => own.has(norm(it.vessel)) && it.status === 'likely')
      if (!mine.length) continue
      const others = [...new Set(g.items.filter(it => !own.has(norm(it.vessel))).map(it => it.vessel))]
      const list = others.slice(0, 4).join(', ')
      const extra = others.length > 4 ? ` +${others.length - 4}` : ''
      for (const m of mine) rows.push({
        fleet_id: appUser.fleet_id, type: 'forecast', severity: 'info',
        title: `${m.vessel} likely landing ${niceDate(g.key)}`,
        body: others.length ? `Also due that day: ${list}${extra}` : 'No other boats forecast that day.',
        meta: { vessel: m.vessel, date: g.key, others },
        dedup_key: `forecast:${m.vessel}:${g.key}`,
      })
    }
    if (rows.length) supabase.from('alerts').upsert(rows, { onConflict: 'fleet_id,dedup_key', ignoreDuplicates: true }).then(() => {}, () => {})
  }, [days, deps, isSkipper])

  const grouped = useMemo(() => {
    const m = {}
    for (const d of visibleDeps){
      const k = d.vessel_name || '—'
      const dt = d.departure_date || (d.departed_at ? d.departed_at.slice(0,10) : null)
      const cur = m[k] || { vessel_name:k, count:0, latest:null, port:d.departure_port }
      cur.count++
      if (dt && (!cur.latest || dt > cur.latest)) { cur.latest = dt; cur.port = d.departure_port }
      m[k] = cur
    }
    return Object.values(m).sort((a,b) => (b.latest||'').localeCompare(a.latest||'') || a.vessel_name.localeCompare(b.vessel_name))
  }, [visibleDeps])

  const selectedNames = useMemo(() => Object.keys(sel).filter(k => sel[k]), [sel])
  const allChecked = grouped.length > 0 && selectedNames.length === grouped.length
  function toggleAll(){ setSel(allChecked ? {} : Object.fromEntries(grouped.map(g => [g.vessel_name, true]))) }
  function toggleOne(name){ setSel(s => ({ ...s, [name]: !s[name] })) }

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
  async function removeVessel(name){
    if (!confirm(`Remove all departures for ${name}? It may reappear on the next import - use Hide to stop that for good.`)) return
    const { error } = await supabase.from('vessel_departures').delete().eq('fleet_id', appUser.fleet_id).eq('vessel_name', name)
    if (error) setError(error.message); else load()
  }
  async function hideSelected(){
    const names = selectedNames
    if (!names.length) return
    if (!confirm(`Hide ${names.length} vessel${names.length>1?'s':''} from the forecast for good? They won't come back on future imports.`)) return
    setSaving(true); setError('')
    const { error: e1 } = await supabase.from('hidden_vessels')
      .upsert(names.map(n => ({ fleet_id: appUser.fleet_id, vessel_name: n })), { onConflict:'fleet_id,vessel_name', ignoreDuplicates:true })
    const { error: e2 } = await supabase.from('vessel_departures').delete().eq('fleet_id', appUser.fleet_id).in('vessel_name', names)
    setSaving(false); setSel({})
    if (e1 || e2){ setError((e1||e2).message); return }
    load()
  }
  async function unhide(name){
    const { error } = await supabase.from('hidden_vessels').delete().eq('fleet_id', appUser.fleet_id).eq('vessel_name', name)
    if (error) setError(error.message); else load()
  }

  if (!isSkipper) return (
    <AppShell>
      <div className="card"><p className="muted">The market forecast is available to the skipper.</p></div>
    </AppShell>)

  return (
    <AppShell>
      <PageHeader
        title="Peterhead Market Forecast"
        sub="Boats likely landing, projected from departures. A trip runs ~7-8 days: +7 likely, +8 possible. No auction Sat/Sun, so those days are skipped."
      />
      {error && <div className="card" style={{borderColor:'var(--red)'}}><p className="error">{error}</p></div>}
      {loading ? <div className="card"><p className="muted">Loading...</p></div> : (
        <>
          <div className="card" style={{display:'flex', gap:'1rem', flexWrap:'wrap'}}>
            {['likely','possible'].map(s=>(
              <span key={s} style={{display:'inline-flex', alignItems:'center', gap:'0.4rem', fontSize:'0.82rem'}}>
                <span style={{width:14,height:14,borderRadius:3,background:STATUS[s].bg,border:`2px solid ${STATUS[s].bd}`}}/>
                {STATUS[s].label} ({STATUS[s].tag})
              </span>))}
          </div>
          {days.length===0 ? (
            <div className="card"><p className="muted">No upcoming landings forecast. Departures appear automatically from the import - or add one below to test.</p></div>
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
              <button onClick={addDeparture} disabled={saving || !draft.vessel_name.trim()}>{saving?'Adding...':'Add departure'}</button>
            </div>

            {grouped.length===0 ? <p className="muted">None showing{hidden.length?' (some hidden).':' yet.'}</p> : (<>
              <div style={{display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap', marginBottom:'0.5rem'}}>
                <button className="secondary" onClick={hideSelected} disabled={!selectedNames.length || saving} style={{padding:'0.3rem 0.8rem', fontSize:'0.85rem'}}>
                  Hide selected{selectedNames.length ? ` (${selectedNames.length})` : ''} - won't reimport
                </button>
                <span className="muted" style={{fontSize:'0.78rem'}}>{grouped.length} vessel{grouped.length!==1?'s':''} showing</span>
              </div>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:'0.88rem'}}>
                <thead><tr>
                  <th style={{...th, width:28}}><input type="checkbox" checked={allChecked} onChange={toggleAll} title="Select all"/></th>
                  <th style={th}>Vessel</th><th style={th}>Port</th><th style={th}>Latest</th><th style={th}></th>
                </tr></thead>
                <tbody>
                  {grouped.map(g=>(
                    <tr key={g.vessel_name} style={{borderBottom:'1px solid var(--border)'}}>
                      <td style={td}><input type="checkbox" checked={!!sel[g.vessel_name]} onChange={()=>toggleOne(g.vessel_name)}/></td>
                      <td style={td}>{g.vessel_name}{g.count>1 && <span className="muted" style={{fontSize:'0.72rem'}}> x{g.count}</span>}</td>
                      <td style={{...td}} className="muted">{g.port||'-'}</td>
                      <td style={td}>{g.latest ? niceDate(g.latest) : '-'}</td>
                      <td style={{...td, textAlign:'right'}}><button className="secondary" onClick={()=>removeVessel(g.vessel_name)} style={{padding:'0.2rem 0.6rem', fontSize:'0.8rem'}}>Remove</button></td>
                    </tr>))}
                </tbody>
              </table>
            </>)}

            <div style={{marginTop:'0.9rem', borderTop:'1px solid var(--border)', paddingTop:'0.7rem'}}>
              <button className="secondary" onClick={()=>setShowHidden(s=>!s)} style={{padding:'0.25rem 0.7rem', fontSize:'0.82rem'}}>
                {showHidden?'Hide':'Show'} hidden vessels ({hidden.length})
              </button>
              {showHidden && (
                hidden.length===0 ? <p className="muted" style={{fontSize:'0.82rem', marginTop:'0.5rem'}}>None hidden. Tick vessels above and "Hide selected" to keep them off the forecast permanently.</p> : (
                  <div style={{display:'flex', flexWrap:'wrap', gap:'0.4rem', marginTop:'0.6rem'}}>
                    {hidden.slice().sort((a,b)=>a.localeCompare(b)).map(name=>(
                      <span key={name} style={{display:'inline-flex', alignItems:'center', gap:'0.4rem', background:'var(--grey-50)', border:'1px solid var(--border)', borderRadius:20, padding:'2px 6px 2px 10px', fontSize:'0.8rem'}}>
                        {name}
                        <button onClick={()=>unhide(name)} title="Un-hide" style={{border:'none', background:'none', cursor:'pointer', color:'#94A3B8', fontSize:'1rem', lineHeight:1}}>x</button>
                      </span>))}
                  </div>
                )
              )}
            </div>
          </div>
        </>)}
    </AppShell>)
}
const lbl = { display:'flex', flexDirection:'column', gap:'0.25rem', fontSize:'0.8rem', fontWeight:600 }
const inp = { padding:'0.45rem 0.55rem', borderRadius:7, border:'1px solid var(--border)', fontSize:'0.95rem', fontWeight:400 }
const th = { textAlign:'left', padding:'0.4rem 0.5rem', borderBottom:'2px solid var(--border)', whiteSpace:'nowrap' }
const td = { padding:'0.4rem 0.5rem', whiteSpace:'nowrap' }
