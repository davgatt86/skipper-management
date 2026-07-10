import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

const SEV = {
  good: { bg:'#F0FDF4', bd:'#BBF7D0', dot:'#16A34A' },
  warn: { bg:'#FEF2F2', bd:'#FECACA', dot:'#DC2626' },
  info: { bg:'#F0F9FF', bd:'#BAE6FD', dot:'#0284C7' },
}
const TYPE_LABEL = { daily:'Daily jump', fourweek:'4-week', pd_dk:'PD vs DK', own_spike:'Your sales', forecast:'Forecast' }
const DEFAULTS = { daily_jump_pct:15, four_week_pct:25, pd_dk_gap_pct:20, own_spike_pct:20,
  enable_daily:true, enable_four_week:true, enable_pd_dk:true, enable_own:true }

export default function Alerts(){
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [cfg, setCfg] = useState(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')

  async function load(){
    setLoading(true)
    const { data } = await supabase.from('alerts').select('*').is('dismissed_at', null).order('created_at', { ascending:false })
    setRows((data || []).slice().sort((a,b) => (a.read_at?1:0) - (b.read_at?1:0)))
    const { data: s } = await supabase.from('alert_settings').select('data').maybeSingle()
    if (s?.data) setCfg({ ...DEFAULTS, ...s.data })
    setLoading(false)
  }
  useEffect(() => { if (isSkipper) load(); else setLoading(false) }, [isSkipper])

  const unread = useMemo(() => rows.filter(r => !r.read_at).length, [rows])

  async function markAllRead(){
    const ids = rows.filter(r => !r.read_at).map(r => r.id)
    if (!ids.length) return
    await supabase.from('alerts').update({ read_at: new Date().toISOString() }).in('id', ids)
    setRows(rs => rs.map(r => r.read_at ? r : { ...r, read_at: new Date().toISOString() }))
  }
  async function dismiss(id){
    await supabase.from('alerts').update({ dismissed_at: new Date().toISOString() }).eq('id', id)
    setRows(rs => rs.filter(r => r.id !== id))
  }
  async function clearAll(){
    const ids = rows.map(r => r.id)
    if (!ids.length) return
    await supabase.from('alerts').update({ dismissed_at: new Date().toISOString() }).in('id', ids)
    setRows([])
  }
  async function saveCfg(){
    setSaving(true); setNote('')
    const { error } = await supabase.from('alert_settings').upsert({ fleet_id: appUser.fleet_id, data: cfg, updated_at: new Date().toISOString() }, { onConflict:'fleet_id' })
    setSaving(false)
    setNote(error ? error.message : 'Saved — new thresholds apply from the next price update.')
  }
  const setN = (k,v) => setCfg(c => ({ ...c, [k]: v }))

  if (!isSkipper) return <div className="container"><p className="muted">Skipper access only. <Link to="/">← Back</Link></p></div>

  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', flexWrap:'wrap', gap:'0.5rem' }}>
        <h1 style={{ marginBottom:'0.2rem' }}>Alerts{unread>0 && <span style={{ marginLeft:8, fontSize:'0.8rem', background:'#DC2626', color:'#fff', borderRadius:20, padding:'1px 9px' }}>{unread}</span>}</h1>
        <p className="muted"><Link to="/">← Dashboard</Link></p>
      </div>

      <div className="card no-print" style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', alignItems:'center' }}>
        <button className="secondary" onClick={markAllRead} disabled={!unread}>Mark all read</button>
        <button className="secondary" onClick={clearAll} disabled={!rows.length}>Clear all</button>
        <button className="secondary" onClick={()=>setShowSettings(s=>!s)} style={{ marginLeft:'auto' }}>{showSettings?'Hide settings':'⚙ Alert settings'}</button>
      </div>

      {showSettings && (
        <div className="card">
          <h3 style={{ marginTop:0 }}>Your alert thresholds</h3>
          <p className="muted" style={{ fontSize:'0.82rem', marginTop:0 }}>Tune these to suit your boat. They apply the next time board prices come in.</p>
          <Row on={cfg.enable_daily} set={v=>setN('enable_daily',v)} label="Daily board-price jump" suffix="%" val={cfg.daily_jump_pct} onVal={v=>setN('daily_jump_pct',v)} hint="up or down vs yesterday" />
          <Row on={cfg.enable_four_week} set={v=>setN('enable_four_week',v)} label="Above 4-week average" suffix="%" val={cfg.four_week_pct} onVal={v=>setN('four_week_pct',v)} hint="price running hot" />
          <Row on={cfg.enable_pd_dk} set={v=>setN('enable_pd_dk',v)} label="Peterhead ↔ Denmark gap" suffix="%" val={cfg.pd_dk_gap_pct} onVal={v=>setN('pd_dk_gap_pct',v)} hint="where-to-land signal" />
          <Row on={cfg.enable_own} set={v=>setN('enable_own',v)} label="Your own sales spike" suffix="%" val={cfg.own_spike_pct} onVal={v=>setN('own_spike_pct',v)} hint="last landing vs your recent average" />
          <div style={{ marginTop:'0.7rem', display:'flex', gap:'0.6rem', alignItems:'center' }}>
            <button onClick={saveCfg} disabled={saving}>{saving?'Saving…':'Save thresholds'}</button>
            {note && <span className="muted" style={{ fontSize:'0.82rem' }}>{note}</span>}
          </div>
        </div>
      )}

      {loading ? <p className="muted">Loading…</p>
       : rows.length === 0 ? <div className="card"><p className="muted" style={{ margin:0 }}>No alerts right now. New ones appear here as board prices and your sales come in.</p></div>
       : rows.map(a => {
          const s = SEV[a.severity] || SEV.info
          return (
            <div key={a.id} className="card" style={{ background:s.bg, border:`1px solid ${s.bd}`, padding:'0.65rem 0.85rem', marginBottom:'0.5rem', display:'flex', alignItems:'flex-start', gap:'0.6rem' }}>
              <span style={{ width:9, height:9, borderRadius:9, background: a.read_at?'transparent':s.dot, border:`2px solid ${s.dot}`, marginTop:5, flex:'0 0 auto' }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', gap:'0.5rem', alignItems:'baseline', flexWrap:'wrap' }}>
                  <b style={{ color:'#0F172A' }}>{a.title}</b>
                  <span className="muted" style={{ fontSize:'0.68rem', textTransform:'uppercase', letterSpacing:'0.03em' }}>{TYPE_LABEL[a.type] || a.type}</span>
                </div>
                {a.body && <div className="muted" style={{ fontSize:'0.83rem', marginTop:2 }}>{a.body}</div>}
              </div>
              <button onClick={()=>dismiss(a.id)} title="Dismiss" style={{ border:'none', background:'none', cursor:'pointer', color:'#94A3B8', fontSize:'1.1rem', lineHeight:1, padding:'0 2px' }}>×</button>
            </div>
          )
        })}
      <p className="muted" style={{ fontSize:'0.74rem' }}>Alerts cover your main species only, and won't repeat the same one twice in a day.</p>
    </div>
  )
}

function Row({ on, set, label, val, onVal, suffix, hint }){
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', padding:'0.35rem 0', borderTop:'1px solid var(--border)', flexWrap:'wrap' }}>
      <label style={{ display:'flex', alignItems:'center', gap:'0.4rem', cursor:'pointer', minWidth:190 }}>
        <input type="checkbox" checked={on} onChange={e=>set(e.target.checked)} />
        <span style={{ fontWeight:600 }}>{label}</span>
      </label>
      <input type="number" min="0" step="1" value={val} disabled={!on} onChange={e=>onVal(Number(e.target.value))} style={{ width:70 }} />
      <span className="muted" style={{ fontSize:'0.85rem' }}>{suffix}</span>
      <span className="muted" style={{ fontSize:'0.78rem', marginLeft:'auto' }}>{hint}</span>
    </div>
  )
}
