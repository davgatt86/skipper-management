import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
// Split out so it can be tested: the classification had a bug that put the
// logbook alerts into the price stream, where "clear" would have taken them.
import { isMarket, isCompliance } from '../lib/alertStreams'

// colour-mix keeps these readable in BOTH themes: a tint of the signal colour
// over the current surface, so nothing glares on a night wheelhouse screen.
const SEV = {
  good: { bg:'color-mix(in srgb, var(--green) 14%, var(--surface))', bd:'var(--green)', dot:'var(--green)' },
  warn: { bg:'color-mix(in srgb, var(--red) 12%, var(--surface))',   bd:'var(--red)',   dot:'var(--red)' },
  info: { bg:'color-mix(in srgb, var(--navy) 12%, var(--surface))',  bd:'var(--navy)',  dot:'var(--navy)' },
}
const TYPE_LABEL = {
  daily:'Daily jump', fourweek:'4-week', pd_dk:'PD vs DK', own_spike:'Your sales', forecast:'Forecast',
  crew_passport:'Passport', crew_cert:'Crew ticket', vessel_cert:'Vessel cert',
  crew_bonus:'Bonus due', log_engine:'Engine log', log_fuel:'Bunkering',
  log_garbage:'Garbage book', log_crewlist:'Crew list', maintenance:'Maintenance',
}

const LINK_OF = {
  crew_passport:'/crew', crew_cert:'/crew-certs', vessel_cert:'/vessel-certs',
  crew_bonus:'/contracted-crew', log_engine:'/engine-logs', log_fuel:'/fuel-log',
  log_garbage:'/garbage-log', log_crewlist:'/crew-list', maintenance:'/maintenance',
}
const DEFAULTS = { daily_jump_pct:15, four_week_pct:25, pd_dk_gap_pct:20, own_spike_pct:20,
  enable_daily:true, enable_four_week:true, enable_pd_dk:true, enable_own:true,
  // How the price stream is kept quiet. Measured Aug 2026: without these it
  // ran at 28.7 alerts per fleet per day, because one species moving was
  // announced once per grade AND re-announced every board day for as long as
  // the condition held (18 days running, on the PD/DK gap). These must match
  // the coalesce() defaults in generate_alerts.
  price_cooldown_days:7, price_max_per_run:3, price_expire_days:21,
  // How long a book may go unwritten before it is worth saying so, and how far
  // ahead an expiry is worth flagging. These must match the defaults in
  // supabase/activity_alerts.sql and generate_compliance_alerts — the SQL
  // coalesces to the same numbers, so a fleet that has never opened this panel
  // behaves identically to one that has and changed nothing.
  activity_enabled:true,
  activity_engine_days:2, activity_fuel_days:10,
  activity_garbage_days:10, activity_crewlist_days:10,
  expiry_lead_days:60 }

export default function Alerts(){
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [cfg, setCfg] = useState(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState('')

  async function load(){
    setLoading(true)
    const { data } = await supabase.from('alerts').select('*').is('dismissed_at', null).order('created_at', { ascending:false })
    setRows((data || []).slice().sort((a,b) => (a.read_at?1:0) - (b.read_at?1:0)))
    const { data: s } = await supabase.from('alert_settings').select('data').maybeSingle()
    if (s?.data) setCfg({ ...DEFAULTS, ...s.data })
    setLoading(false)
  }
  useEffect(() => {
    if (!isSkipper) { setLoading(false); return }
    // Raise any new expiries first, then read. Idempotent, so this is safe to
    // do on every visit.
    supabase.rpc('generate_compliance_alerts', { lead_days: 60 }).then(load, load)
  }, [isSkipper])

  const compliance = useMemo(() => rows.filter(isCompliance), [rows])
  const market = useMemo(() => rows.filter(isMarket), [rows])
  const unread = useMemo(() => rows.filter(r => !r.read_at).length, [rows])
  const complianceUnread = useMemo(() => compliance.filter(r => !r.read_at).length, [compliance])

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
  // Scoped to one stream on purpose. Clearing a day's price alerts must never
  // take an expired certificate with it.
  async function clearMarket(){
    const ids = market.map(r => r.id)
    if (!ids.length) return
    await supabase.from('alerts').update({ dismissed_at: new Date().toISOString() }).in('id', ids)
    setRows(rs => rs.filter(isCompliance))
  }
  // Checking expiries is cheap and idempotent, so it runs on every load as
  // well as on demand — an expiry that falls due while nobody is looking
  // still turns up the next time the page is opened.
  async function checkExpiries(){
    setChecking(true)
    const { error } = await supabase.rpc('generate_compliance_alerts', { lead_days: 60 })
    setChecking(false)
    if (error) { setNote(error.message); return }
    load()
  }
  async function saveCfg(){
    setSaving(true); setNote('')
    const { error } = await supabase.from('alert_settings').upsert({ fleet_id: appUser.fleet_id, data: cfg, updated_at: new Date().toISOString() }, { onConflict:'fleet_id' })
    setSaving(false)
    setNote(error ? error.message : 'Saved — new thresholds apply from the next price update.')
  }
  const setN = (k,v) => setCfg(c => ({ ...c, [k]: v }))

  if (!isSkipper) return <AppShell><div className="card"><p className="muted">Skipper access only.</p></div></AppShell>

  return (
    <AppShell maxWidth={720}>
      <PageHeader title={<>Alerts{unread>0 && <span className="num" style={{ marginLeft:8, fontSize:'0.8rem', background:'var(--rust)', color:'#fff', borderRadius:20, padding:'1px 9px', verticalAlign:'middle' }}>{unread}</span>}</>} />

      <div className="card no-print" style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', alignItems:'center' }}>
        <button className="secondary" onClick={markAllRead} disabled={!unread}>Mark all read</button>
        <button className="secondary" onClick={clearMarket} disabled={!market.length}>Clear price alerts</button>
        <button className="secondary" onClick={checkExpiries} disabled={checking}>{checking?'Checking…':'Check expiries'}</button>
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

          <h3 style={{ marginBottom:'0.1rem' }}>How often price alerts may repeat</h3>
          <p className="muted" style={{ fontSize:'0.82rem', marginTop:0 }}>
            A price gap that holds for a fortnight is one piece of news, not fourteen. Without these the
            board ran at <b>29 alerts a day</b> and the certificates were buried underneath. The cooldown
            is per species, so a different fish still gets through at once.
          </p>
          <Row on={true} set={()=>{}} label="Don’t repeat a species for" suffix="days" val={cfg.price_cooldown_days} onVal={v=>setN('price_cooldown_days',v)} hint="7 is the usual" />
          <Row on={true} set={()=>{}} label="Most alerts per board" suffix="each" val={cfg.price_max_per_run} onVal={v=>setN('price_max_per_run',v)} hint="biggest movers first" />
          <Row on={true} set={()=>{}} label="Price alerts drop off after" suffix="days" val={cfg.price_expire_days} onVal={v=>setN('price_expire_days',v)} hint="a five-week-old board move is not news" />

          <h3 style={{ marginBottom:'0.1rem' }}>How long before a log is chased</h3>
          <p className="muted" style={{ fontSize:'0.82rem', marginTop:0 }}>
            Checked once a day at 06:00. A book is only ever chased if it has been used at least once —
            nothing here will nag you about a log you have never started. Untick the first row to switch
            the lot off.
          </p>
          <Row on={cfg.activity_enabled} set={v=>setN('activity_enabled',v)} label="Chase quiet logs" suffix="" val={cfg.activity_engine_days} onVal={v=>setN('activity_engine_days',v)} hint="engine log — days without an entry" />
          <Row on={cfg.activity_enabled} set={v=>setN('activity_enabled',v)} label="Bunkering" suffix="days" val={cfg.activity_fuel_days} onVal={v=>setN('activity_fuel_days',v)} hint="since the last fuel entry" />
          <Row on={cfg.activity_enabled} set={v=>setN('activity_enabled',v)} label="Garbage Record Book" suffix="days" val={cfg.activity_garbage_days} onVal={v=>setN('activity_garbage_days',v)} hint="MARPOL Annex V — inspectable" />
          <Row on={cfg.activity_enabled} set={v=>setN('activity_enabled',v)} label="Crew list" suffix="days" val={cfg.activity_crewlist_days} onVal={v=>setN('activity_crewlist_days',v)} hint="since one was last saved" />

          <h3 style={{ marginBottom:'0.1rem' }}>How far ahead an expiry is flagged</h3>
          <p className="muted" style={{ fontSize:'0.82rem', marginTop:0 }}>
            Passports, crew tickets and vessel certificates. Longer gives more warning and a longer list;
            shorter is quieter but leaves less time to act. Going-home bonuses have their own 30-day lead.
          </p>
          <Row on={true} set={()=>{}} label="Warn me before expiry" suffix="days" val={cfg.expiry_lead_days} onVal={v=>setN('expiry_lead_days',v)} hint="60 is the usual" />

          <div style={{ marginTop:'0.7rem', display:'flex', gap:'0.6rem', alignItems:'center' }}>
            <button onClick={saveCfg} disabled={saving}>{saving?'Saving…':'Save thresholds'}</button>
            {note && <span className="muted" style={{ fontSize:'0.82rem' }}>{note}</span>}
          </div>
        </div>
      )}

      {loading ? <p className="muted">Loading…</p> : (
        <>
          {/* ---- Vessel & crew. First, and never cleared with the prices. ---- */}
          <h2 style={{ marginBottom:'0.4rem' }}>
            Vessel &amp; crew
            {complianceUnread > 0 && (
              <span className="num" style={{ marginLeft:8, fontSize:'0.72rem', background:'var(--rust)', color:'#fff', borderRadius:20, padding:'1px 9px', verticalAlign:'middle' }}>{complianceUnread}</span>
            )}
          </h2>
          {compliance.length === 0 ? (
            <div className="card"><p className="muted" style={{ margin:0 }}>
              Nothing expiring in the next {cfg.expiry_lead_days} days, and no logbook overdue.
              Certificates, passports and vessel papers are checked each time this page opens.
            </p></div>
          ) : compliance.map(a => <AlertCard key={a.id} a={a} onDismiss={dismiss} />)}

          {/* ---- Market. ---- */}
          <h2 style={{ marginBottom:'0.4rem', marginTop:'1.4rem' }}>
            Market <span className="muted" style={{ fontWeight:400, fontSize:'0.85rem' }}>({market.length})</span>
          </h2>
          {market.length === 0 ? (
            <div className="card"><p className="muted" style={{ margin:0 }}>No price alerts right now. New ones appear as board prices and your sales come in.</p></div>
          ) : market.map(a => <AlertCard key={a.id} a={a} onDismiss={dismiss} />)}

          <p className="muted" style={{ fontSize:'0.74rem' }}>
            Price alerts cover your main species only, are raised once per species rather than once per
            grade, and stay quiet for {cfg.price_cooldown_days} days afterwards — so a gap that holds for
            a fortnight is said once. They drop off the page after {cfg.price_expire_days} days.
            Expiries and logbooks are never cleared with them: they are raised once per certificate per
            expiry date, and again if one lapses.
          </p>
        </>
      )}
    </AppShell>
  )
}

function AlertCard({ a, onDismiss }){
  const s = SEV[a.severity] || SEV.info
  const link = LINK_OF[a.type]
  return (
    <div className="card" style={{ background:s.bg, border:`1px solid ${s.bd}`, padding:'0.65rem 0.85rem', marginBottom:'0.5rem', display:'flex', alignItems:'flex-start', gap:'0.6rem' }}>
      <span style={{ width:9, height:9, borderRadius:9, background: a.read_at?'transparent':s.dot, border:`2px solid ${s.dot}`, marginTop:5, flex:'0 0 auto' }} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'baseline', flexWrap:'wrap' }}>
          <b style={{ color:'var(--text)' }}>{a.title}</b>
          <span className="muted" style={{ fontSize:'0.68rem', textTransform:'uppercase', letterSpacing:'0.03em' }}>{TYPE_LABEL[a.type] || a.type}</span>
        </div>
        {a.body && <div className="muted" style={{ fontSize:'0.83rem', marginTop:2 }}>{a.body}</div>}
        {link && <Link to={link} style={{ fontSize:'0.8rem' }}>Open →</Link>}
      </div>
      <button onClick={()=>onDismiss(a.id)} title="Dismiss" style={{ border:'none', background:'none', cursor:'pointer', color:'var(--grey-400)', fontSize:'1.1rem', lineHeight:1, padding:'0 2px' }}>×</button>
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
