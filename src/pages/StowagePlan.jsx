import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import BackNav from "../BackNav";
import { supabase } from "../supabaseClient";
import { useAuth } from "../AuthContext";

// ── AUDACIOUS BF83 fishroom geometry (validated against the paper plan) ──────
const TIERS = {
  1:{pos:"Aft (bulkhead)",h:Array(16).fill(14)}, 2:{pos:"Aft",h:Array(16).fill(14)},
  3:{pos:"Aft",h:Array(16).fill(14)}, 4:{pos:"Aft-mid",h:Array(16).fill(14)},
  5:{pos:"Mid",h:[10,14,14,14,14,10]}, 6:{pos:"Mid",h:[12,14,14,14,14,12]},
  7:{pos:"Mid",h:[12,14,14,14,14,14,14,14,14,14,12]},
  8:{pos:"Fwd-mid",h:[5,10,12,14,14,14,14,14,14,14,14,14,12,10,5]},
  9:{pos:"Fwd",h:[5,9,12,14,14,14,14,14,14,14,12,9,5]},
  10:{pos:"Fwd",h:[5,10,13,14,14,14,14,14,13,10,5]}, 11:{pos:"Fwd (bow)",h:[4,10,14,14,14,14,14,10,4]},
};
const TIER_IDS = Object.keys(TIERS).map(Number);
const LAYERS = [14,13,12,11,10,9,8,7,6,5,4,3,2,1];
const capacityOf = (t)=>TIERS[t].h.reduce((a,b)=>a+b,0);
const TOTAL_CAP = TIER_IDS.reduce((a,t)=>a+capacityOf(t),0);
const exists = (t,l,s)=> l >= (15 - TIERS[t].h[s]);

const SPECIES = [
  {code:"HAD",name:"Haddock",c:"#1F6FEB",kg:40},{code:"COD",name:"Cod",c:"#E5484D",kg:30},
  {code:"WHI",name:"Whiting",c:"#12A594",kg:40},{code:"SAI",name:"Saithe",c:"#5B6570",kg:40},
  {code:"MON",name:"Monkfish",c:"#8250DF",kg:30},{code:"MEG",name:"Megrim",c:"#E8821E",kg:30},
  {code:"LEM",name:"Lemon Sole",c:"#9AA400",kg:35},{code:"PLA",name:"Plaice",c:"#B07B47",kg:30},
  {code:"SKA",name:"Skate/Ray",c:"#E06C9F",kg:35},{code:"SUB",name:"Sub-MCRS",c:"#111827",kg:30},
];
const SP = Object.fromEntries(SPECIES.map(s=>[s.code,s]));
const DEFAULT_KG = Object.fromEntries(SPECIES.map(s=>[s.code,s.kg]));
const ERASE="__ERASE__"; const KEY=(t,l,s)=>`${t}-${l}-${s}`;
const isTouch = ()=> typeof window!=="undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
const emptyMeta = ()=>({ trip:{}, record:[], hauls:[], temp:[], signoff:{} });
const niceWhen = (ts)=>{ if(!ts) return ""; const d=new Date(ts); return d.toLocaleDateString()+" "+d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); };

export default function StowagePlan(){
  const { appUser } = useAuth();
  const isSkipper = appUser?.role === "skipper";

  const [plans,setPlans]=useState([]);
  const [planId,setPlanId]=useState(null);
  const [tripNo,setTripNo]=useState("");
  const [newTrip,setNewTrip]=useState("");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  const [grid,setGrid]=useState({});
  const [kg,setKg]=useState(DEFAULT_KG);
  const [meta,setMeta]=useState(emptyMeta());

  const [section,setSection]=useState("fishroom");
  const [brush,setBrush]=useState("HAD");
  const [tier,setTier]=useState(1);
  const [mode,setMode]=useState(()=> isTouch()?"tap":"drag");
  const [anchor,setAnchor]=useState(null);
  const [showWt,setShowWt]=useState(false);
  const painting=useRef(false); const planLoaded=useRef(false);

  async function loadPlans(){
    setLoading(true);
    const { data, error } = await supabase.from("stowage_plans").select("id,trip_no,vessel,updated_at").order("updated_at",{ascending:false});
    if(error) setError(error.message);
    setPlans(data||[]); setLoading(false);
  }
  useEffect(()=>{ if(isSkipper) loadPlans(); else setLoading(false); },[isSkipper]);

  async function openPlan(id){
    setError(""); planLoaded.current=false;
    const { data, error } = await supabase.from("stowage_plans").select("*").eq("id",id).single();
    if(error){ setError(error.message); return; }
    const d = data.data||{};
    setGrid(d.grid||{}); setKg({...DEFAULT_KG,...(d.box_weights||{})});
    setMeta({ ...emptyMeta(), trip:d.trip||{}, record:d.record||[], hauls:d.hauls||[], temp:d.temp||[], signoff:d.signoff||{} });
    setPlanId(id); setTripNo(data.trip_no); setSection("fishroom");
    setTimeout(()=>{ planLoaded.current=true; },0);
  }
  async function createPlan(){
    const tn=newTrip.trim(); if(!tn) return;
    const { data, error } = await supabase.from("stowage_plans")
      .insert({ trip_no:tn, vessel:"AUDACIOUS BF83", data:{}, created_by:appUser.id }).select("id").single();
    if(error){ setError(error.message); return; }
    setNewTrip(""); await loadPlans(); openPlan(data.id);
  }
  async function deletePlan(id, e){
    e.stopPropagation();
    if(!confirm("Delete this trip's stowage plan? This can't be undone.")) return;
    const { error } = await supabase.from("stowage_plans").delete().eq("id",id);
    if(error) setError(error.message); else loadPlans();
  }
  function closePlan(){ setPlanId(null); planLoaded.current=false; loadPlans(); }

  // autosave whole document
  useEffect(()=>{ if(!planId || !planLoaded.current) return;
    const id=setTimeout(async()=>{
      setSaving(true);
      const { error } = await supabase.from("stowage_plans")
        .update({ data:{ grid, box_weights:kg, trip:meta.trip, record:meta.record, hauls:meta.hauls, temp:meta.temp, signoff:meta.signoff }, updated_at:new Date().toISOString() })
        .eq("id",planId);
      if(error) setError(error.message);
      setSaving(false);
    },700); return ()=>clearTimeout(id);
  },[grid,kg,meta,planId]);

  useEffect(()=>{ const up=()=>{painting.current=false}; window.addEventListener("pointerup",up); return()=>window.removeEventListener("pointerup",up); },[]);
  useEffect(()=>{ setAnchor(null); },[tier,mode,brush,section]);

  const paintCell=useCallback((t,l,s)=>{ if(!exists(t,l,s))return; setGrid(p=>{const n={...p};const k=KEY(t,l,s); if(brush===ERASE)delete n[k]; else n[k]=brush; return n;}); },[brush]);
  const fillCells=useCallback((cells)=>{ setGrid(p=>{const n={...p}; for(const k of cells){ if(brush===ERASE)delete n[k]; else n[k]=brush;} return n;}); },[brush]);
  const fillRect=useCallback((a,b)=>{ const l0=Math.min(a.l,b.l),l1=Math.max(a.l,b.l),s0=Math.min(a.s,b.s),s1=Math.max(a.s,b.s); const c=[]; for(let l=l0;l<=l1;l++)for(let s=s0;s<=s1;s++)if(exists(tier,l,s))c.push(KEY(tier,l,s)); fillCells(c); },[tier,fillCells]);
  const tierCells=(t)=>{const o=[]; for(const l of LAYERS)for(let s=0;s<TIERS[t].h.length;s++)if(exists(t,l,s))o.push(KEY(t,l,s)); return o;};
  const fillTier=()=>fillCells(tierCells(tier));
  const fillLayer=(l)=>fillCells(TIERS[tier].h.map((_,s)=>exists(tier,l,s)?KEY(tier,l,s):null).filter(Boolean));
  const fillSlot=(s)=>fillCells(LAYERS.map(l=>exists(tier,l,s)?KEY(tier,l,s):null).filter(Boolean));
  const tapCell=(l,s)=>{ if(!exists(tier,l,s))return; if(!anchor)setAnchor({l,s}); else{fillRect(anchor,{l,s});setAnchor(null);} };

  const totals=useMemo(()=>{const t={};let filled=0,wt=0; for(const v of Object.values(grid)){t[v]=(t[v]||0)+1;filled++;wt+=(kg[v]||0);} return{t,filled,wt};},[grid,kg]);
  const tierFill=useMemo(()=>{const m={}; for(const t of TIER_IDS)m[t]=0; for(const k of Object.keys(grid)){const t=+k.split("-")[0]; m[t]=(m[t]||0)+1;} return m;},[grid]);
  const setTrip=(k,v)=>setMeta(m=>({...m,trip:{...m.trip,[k]:v}}));
  const setSign=(k,v)=>setMeta(m=>({...m,signoff:{...m.signoff,[k]:v}}));
  const setLog=(name)=>(fn)=>setMeta(m=>({...m,[name]: typeof fn==="function"?fn(m[name]):fn}));

  const width=TIERS[tier].h.length; const cell=30; const brushName= brush===ERASE?"empty":SP[brush]?.name;
  const SECTIONS=[["trip","Trip"],["fishroom","Fishroom"],["record","Record"],["hauls","Hauls"],["totals","Totals"],["temp","Temp log"],["signoff","Sign-off"]];

  if(!isSkipper) return (
    <div className="container"><div style={{marginBottom:"1rem"}}><BackNav/></div>
      <div className="card"><p className="muted">The stowage plan is available to the skipper.</p></div></div>);

  // ── Trip picker ───────────────────────────────────────────────────────────
  if(!planId) return (
    <div className="container">
      <div style={{marginBottom:"1rem"}}><BackNav/></div>
      <div className="card">
        <h1 style={{marginBottom:"0.3rem"}}>Fishroom Stowage — AUDACIOUS BF83</h1>
        <p className="muted" style={{fontSize:"0.85rem",marginBottom:0}}>Pick a trip to open its plan, or start a new one. Each plan holds the box grid, trip totals, stowage record, temp log and sign-off.</p>
      </div>
      {error && <div className="card" style={{borderColor:"var(--red)"}}><p className="error">{error}</p></div>}
      <div className="card">
        <div style={{display:"flex",gap:"0.5rem",alignItems:"end",flexWrap:"wrap",marginBottom:"1rem"}}>
          <label style={lbl}>New trip no.<input value={newTrip} onChange={e=>setNewTrip(e.target.value)} placeholder="e.g. 60" style={inp}/></label>
          <button onClick={createPlan} disabled={!newTrip.trim()}>Start plan</button>
        </div>
        {loading ? <p className="muted">Loading…</p> : plans.length===0 ? <p className="muted">No stowage plans yet — start one above.</p> : (
          <div style={{display:"grid",gap:"0.5rem"}}>
            {plans.map(p=>(
              <div key={p.id} onClick={()=>openPlan(p.id)} style={{display:"flex",alignItems:"center",gap:"0.8rem",padding:"0.7rem 0.9rem",border:"1px solid var(--border)",borderRadius:9,cursor:"pointer"}}>
                <b>Trip {p.trip_no}</b>
                <span className="muted" style={{fontSize:"0.8rem"}}>{p.vessel}</span>
                <span className="muted" style={{fontSize:"0.75rem",marginLeft:"auto"}}>saved {niceWhen(p.updated_at)}</span>
                <button className="secondary" onClick={e=>deletePlan(p.id,e)} style={{padding:"0.2rem 0.6rem",fontSize:"0.8rem"}}>Delete</button>
              </div>))}
          </div>)}
      </div>
    </div>);

  // ── Plan editor ───────────────────────────────────────────────────────────
  return (
    <div className="container">
      <div style={{marginBottom:"1rem"}}><BackNav/></div>
      <div style={{maxWidth:920,margin:"0 auto",padding:"0 2px 40px"}}>
        <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
          <button onClick={closePlan} style={{...tbtn,marginRight:4}}>← Trips</button>
          <h2 style={{margin:"0 0 2px",fontSize:"1.15rem"}}>Trip {tripNo} — AUDACIOUS BF83</h2>
          <span style={{color:"#64748B",fontSize:".82rem"}}>{totals.filled} / {TOTAL_CAP} boxes · <b>{totals.wt.toLocaleString()} kg</b></span>
          <span style={{marginLeft:"auto",fontSize:".76rem",color:saving?"#B45309":"#16A34A"}}>{saving?"Saving…":"Saved"}</span>
        </div>
        <div style={{height:8,borderRadius:99,background:"#E2E8F0",overflow:"hidden",margin:"6px 0 12px"}}>
          <div style={{height:"100%",width:`${(totals.filled/TOTAL_CAP)*100}%`,background:"#1E3A5F"}}/>
        </div>
        {error && <p className="error">{error}</p>}

        <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:6,marginBottom:12}}>
          {SECTIONS.map(([id,label])=>{const on=section===id; return(
            <button key={id} onClick={()=>setSection(id)} style={{whiteSpace:"nowrap",padding:"6px 12px",borderRadius:8,cursor:"pointer",border:on?"2px solid #1E3A5F":"1px solid #CBD5E1",background:on?"#1E3A5F":"#fff",color:on?"#fff":"#334155",fontSize:".84rem",fontWeight:on?700:500}}>{label}</button>);})}
        </div>

        {section==="trip" && <TripDetails trip={meta.trip} set={setTrip}/>}

        {section==="fishroom" && (<>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            {SPECIES.map(sp=>{const on=brush===sp.code; return(
              <button key={sp.code} onClick={()=>setBrush(sp.code)} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 9px",borderRadius:8,cursor:"pointer",border:on?`2px solid ${sp.c}`:"1px solid #CBD5E1",background:on?sp.c+"1A":"#fff",fontWeight:on?700:500,fontSize:".82rem"}}>
                <span style={{width:13,height:13,borderRadius:3,background:sp.c}}/>{sp.name}<span style={{color:"#94A3B8"}}>{totals.t[sp.code]||0}</span></button>);})}
            <button onClick={()=>setBrush(ERASE)} style={{padding:"5px 9px",borderRadius:8,cursor:"pointer",border:brush===ERASE?"2px solid #64748B":"1px solid #CBD5E1",background:brush===ERASE?"#F1F5F9":"#fff",fontWeight:brush===ERASE?700:500,fontSize:".82rem"}}>⌫ Empty</button>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:8}}>
            <div style={{display:"inline-flex",border:"1px solid #CBD5E1",borderRadius:8,overflow:"hidden"}}>
              {[["drag","🖱 Drag (PC)"],["tap","👆 Tap corners (phone)"]].map(([m,label])=>(
                <button key={m} onClick={()=>setMode(m)} style={{padding:"5px 11px",border:"none",cursor:"pointer",fontSize:".8rem",fontWeight:mode===m?700:500,background:mode===m?"#1E3A5F":"#fff",color:mode===m?"#fff":"#334155"}}>{label}</button>))}
            </div>
            <span style={{fontSize:".78rem",color:anchor?"#B45309":"#64748B",fontWeight:anchor?700:400}}>
              {mode==="drag" ? <>Drag across boxes to fill with <b>{brushName}</b>.</>
               : anchor ? <>Now tap the opposite corner to fill with <b>{brushName}</b> — or <button onClick={()=>setAnchor(null)} style={{...tbtn,padding:"1px 6px"}}>cancel</button></>
               : <>Tap one box, then the opposite corner, to fill a block with <b>{brushName}</b>.</>}
            </span>
          </div>
          <p style={{margin:"0 0 10px",fontSize:".76rem",color:"#94A3B8"}}>Tap a <b>layer</b> (L) or <b>slot</b> (S) label to fill that row/column · <b>Fill tier</b> does the lot.</p>
          <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:12}}>
            {TIER_IDS.map(t=>{const on=t===tier; const pct=Math.round((tierFill[t]/capacityOf(t))*100); return(
              <button key={t} onClick={()=>setTier(t)} style={{padding:"5px 8px",borderRadius:7,cursor:"pointer",minWidth:52,border:on?"2px solid #1E3A5F":"1px solid #CBD5E1",background:on?"#1E3A5F":"#fff",color:on?"#fff":"#0F172A",fontSize:".78rem",fontWeight:on?700:500}}>
                T{t}<div style={{fontSize:".64rem",opacity:.8}}>{pct}%</div></button>);})}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:8}}>
            <b style={{fontSize:".92rem"}}>Tier {tier} — {TIERS[tier].pos}</b>
            <span style={{color:"#64748B",fontSize:".78rem"}}>{width} slots · {capacityOf(tier)} boxes · {tierFill[tier]} filled</span>
            <button onClick={fillTier} style={tbtn}>Fill tier with {brushName}</button>
          </div>
          <div style={{overflowX:"auto",paddingBottom:6,touchAction:"pan-x"}}>
            <table style={{borderCollapse:"collapse",userSelect:"none"}}><thead><tr><th style={{width:34}}/>
              {Array.from({length:width},(_,s)=>(<th key={s} onClick={()=>fillSlot(s)} title="Fill slot/column" style={{fontSize:".6rem",color:"#64748B",cursor:"pointer",padding:"2px 0",fontWeight:600}}>S{s+1}{TIERS[tier].h[s]<14&&<div style={{color:"#94A3B8",fontSize:".55rem"}}>▲{TIERS[tier].h[s]}</div>}</th>))}
            </tr></thead><tbody>
              {LAYERS.map(l=>(<tr key={l}>
                <td onClick={()=>fillLayer(l)} title="Fill layer/row" style={{fontSize:".62rem",color:"#64748B",cursor:"pointer",textAlign:"right",paddingRight:5,fontWeight:600,whiteSpace:"nowrap"}}>L{l}{l===14?"▲":l===1?"▼":""}</td>
                {Array.from({length:width},(_,s)=>{ const ok=exists(tier,l,s);
                  if(!ok)return<td key={s} style={{width:cell,height:cell,background:"repeating-linear-gradient(45deg,#F1F5F9,#F1F5F9 4px,#E2E8F0 4px,#E2E8F0 8px)",border:"1px solid #EEF2F6"}}/>;
                  const code=grid[KEY(tier,l,s)]; const sp=code&&SP[code]; const isA=anchor&&anchor.l===l&&anchor.s===s;
                  return<td key={s}
                    onPointerDown={mode==="drag"?(e=>{e.preventDefault();painting.current=true;paintCell(tier,l,s);}):undefined}
                    onPointerEnter={mode==="drag"?(()=>{if(painting.current)paintCell(tier,l,s);}):undefined}
                    onClick={mode==="tap"?(()=>tapCell(l,s)):undefined}
                    title={`T${tier}·L${l}·S${s+1}${sp?" · "+sp.name:""}`}
                    style={{width:cell,height:cell,border:isA?"3px solid #B45309":"1px solid #E2E8F0",cursor:"pointer",background:sp?sp.c:"#fff",touchAction:mode==="drag"?"none":"auto",color:"#fff",fontSize:".5rem",textAlign:"center",fontWeight:700}}>{code==="SUB"?"✗":""}</td>;})}
              </tr>))}
            </tbody></table>
          </div>
        </>)}

        {section==="record" && <LogTable title="Stowage record — one row per stow" cols={recordCols} rows={meta.record} setRows={setLog("record")}
          computed={[{label:"Est wt (kg)", fn:r=> r.boxes&&r.sp ? (Number(r.boxes)*(kg[r.sp]||0)).toLocaleString() : ""}]} />}

        {section==="hauls" && <LogTable title="Haul / shot totals" cols={haulCols} rows={meta.hauls} setRows={setLog("hauls")} />}

        {section==="totals" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",flexWrap:"wrap",gap:8}}>
              <b style={{fontSize:".95rem"}}>Trip totals by species <span style={{color:"#94A3B8",fontWeight:400,fontSize:".8rem"}}>(auto from the fishroom grid)</span></b>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>setShowWt(v=>!v)} style={tbtn}>{showWt?"Hide box weights":"Box weights"}</button>
                <button onClick={()=>{if(confirm("Clear the whole fishroom grid for this trip?"))setGrid({});}} style={{...tbtn,borderColor:"#FCA5A5",color:"#B91C1C"}}>Clear grid</button>
              </div>
            </div>
            {showWt && (<div style={{marginTop:10,padding:"10px 12px",border:"1px solid #E2E8F0",borderRadius:9,background:"#F8FAFC"}}>
              <div style={{fontSize:".78rem",color:"#64748B",marginBottom:8}}>One box weight per species — every box uses it. Defaults from the plan's target weights.</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:8}}>
                {SPECIES.map(sp=>(<label key={sp.code} style={{display:"flex",alignItems:"center",gap:7,fontSize:".82rem"}}>
                  <span style={{width:12,height:12,borderRadius:3,background:sp.c}}/>{sp.name}
                  <input type="number" min="0" step="1" value={kg[sp.code]} onChange={e=>setKg(k=>({...k,[sp.code]:e.target.value===""?0:Number(e.target.value)}))} style={{marginLeft:"auto",width:56,padding:"3px 5px",borderRadius:6,border:"1px solid #CBD5E1",textAlign:"right",fontSize:".82rem"}}/>
                  <span style={{color:"#94A3B8"}}>kg</span></label>))}
              </div></div>)}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:6,marginTop:12}}>
              {SPECIES.filter(sp=>totals.t[sp.code]).map(sp=>(
                <div key={sp.code} style={{display:"flex",alignItems:"center",gap:7,fontSize:".85rem"}}>
                  <span style={{width:12,height:12,borderRadius:3,background:sp.c}}/>{sp.name}
                  <span style={{marginLeft:"auto"}}><b>{totals.t[sp.code]}</b> <span style={{color:"#94A3B8"}}>bx ·</span> <b>{(totals.t[sp.code]*(kg[sp.code]||0)).toLocaleString()}</b> <span style={{color:"#94A3B8"}}>kg</span></span></div>))}
              {totals.filled>0 && (<div style={{display:"flex",alignItems:"center",gap:7,fontSize:".9rem",gridColumn:"1/-1",borderTop:"1px solid #E2E8F0",paddingTop:8,marginTop:2}}>
                <b>GRAND TOTAL</b><span style={{marginLeft:"auto"}}><b>{totals.filled}</b> <span style={{color:"#94A3B8"}}>bx ·</span> <b>{totals.wt.toLocaleString()}</b> <span style={{color:"#94A3B8"}}>kg</span></span></div>)}
              {totals.filled===0 && <span style={{color:"#94A3B8",fontSize:".85rem"}}>Nothing stowed yet — fill the fishroom grid and the totals appear here.</span>}
            </div>
          </div>)}

        {section==="temp" && <LogTable title="Temperature log — target 0–2 °C" cols={tempCols} rows={meta.temp} setRows={setLog("temp")}
          computed={[{label:"In range?", fn:r=> r.temp===""||r.temp==null ? "" : (Number(r.temp)>=0&&Number(r.temp)<=2 ? "✓ Y" : "✗ N")}]} />}

        {section==="signoff" && <SignOff s={meta.signoff} set={setSign} totals={totals}/>}
      </div>
    </div>);
}

function TripDetails({trip,set}){
  const F=(k,label,type="text")=>(<label style={{display:"flex",flexDirection:"column",gap:3,fontSize:".8rem",fontWeight:600}}>{label}
    <input type={type} value={trip[k]||""} onChange={e=>set(k,e.target.value)} style={inp}/></label>);
  return (<div><b style={{fontSize:".95rem"}}>1 · Trip details</b>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10,marginTop:10}}>
      {F("tripNo","Trip No.")}{F("sailed","Date sailed","date")}{F("skipper","Skipper")}
      {F("landed","Date landed","date")}{F("crew","Crew on board")}{F("port","Port of landing")}
      {F("grounds","Grounds fished")}{F("ice","Ice loaded on sailing (kg)","number")}{F("temp","Fishroom temp at sailing (°C)","number")}
      <label style={{display:"flex",flexDirection:"column",gap:3,fontSize:".8rem",fontWeight:600}}>Relief skipper trip?
        <select value={trip.relief||""} onChange={e=>set("relief",e.target.value)} style={inp}><option value="">—</option><option>Yes</option><option>No</option></select></label>
    </div></div>);
}
function SignOff({s,set,totals}){
  const F=(k,label,type="text")=>(<label style={{display:"flex",flexDirection:"column",gap:3,fontSize:".8rem",fontWeight:600}}>{label}
    <input type={type} value={s[k]||""} onChange={e=>set(k,e.target.value)} style={inp}/></label>);
  return(<div><b style={{fontSize:".95rem"}}>Declaration & sign-off</b>
    <p style={{fontSize:".8rem",color:"#475569",marginTop:6}}>I confirm all fish on this plan were caught, handled, iced and stowed per hygiene regulations and landing-obligation requirements. All sub-MCRS fish are stored separately in clearly labelled containers. This record ({totals.filled} boxes · {totals.wt.toLocaleString()} kg) is accurate to the best of my knowledge.</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10,marginTop:10}}>
      {F("skPrint","Skipper — print")}{F("skDate","Skipper — date","date")}{F("mtPrint","Crew chief / mate — print")}{F("mtDate","Mate — date","date")}
    </div>
    <label style={{display:"flex",alignItems:"center",gap:8,marginTop:12,fontSize:".85rem",fontWeight:600}}>
      <input type="checkbox" checked={!!s.confirmed} onChange={e=>set("confirmed",e.target.checked)}/> Declaration confirmed (signatures added on the printed / exported copy)</label>
  </div>);
}
function LogTable({title,cols,rows,setRows,computed=[]}){
  const add=()=>setRows(r=>[...r,{}]);
  const upd=(i,k,v)=>setRows(r=>r.map((row,j)=>j===i?{...row,[k]:v}:row));
  const del=i=>setRows(r=>r.filter((_,j)=>j!==i));
  const cellIn=(row,i,c)=>{ const v=row[c.key]??""; const on=e=>upd(i,c.key,e.target.value);
    if(c.type==="select") return <select value={v} onChange={on} style={cin(c.w)}><option value=""/>{c.options.map(o=><option key={o} value={o}>{o}</option>)}</select>;
    if(c.type==="spselect") return <select value={v} onChange={on} style={cin(c.w)}><option value=""/>{SPECIES.map(s=><option key={s.code} value={s.code}>{s.name}</option>)}</select>;
    if(c.type==="yn") return <select value={v} onChange={on} style={cin(c.w)}><option value=""/><option>Y</option><option>N</option></select>;
    return <input type={c.type==="num"?"number":"text"} value={v} onChange={on} style={cin(c.w)}/>; };
  return(<div><b style={{fontSize:".95rem"}}>{title}</b>
    <div style={{overflowX:"auto",marginTop:10}}>
      <table style={{borderCollapse:"collapse",fontSize:".8rem"}}>
        <thead><tr>{cols.map(c=><th key={c.key} style={thc}>{c.label}</th>)}{computed.map(c=><th key={c.label} style={{...thc,color:"#64748B"}}>{c.label}</th>)}<th style={thc}/></tr></thead>
        <tbody>
          {rows.map((row,i)=>(<tr key={i} style={{borderBottom:"1px solid #EEF2F6"}}>
            {cols.map(c=><td key={c.key} style={tdc}>{cellIn(row,i,c)}</td>)}
            {computed.map(c=><td key={c.label} style={{...tdc,fontWeight:700,color:"#334155",textAlign:"right"}}>{c.fn(row)}</td>)}
            <td style={tdc}><button onClick={()=>del(i)} style={{...tbtn,padding:"2px 7px",color:"#B91C1C",borderColor:"#FCA5A5"}}>✕</button></td>
          </tr>))}
          {rows.length===0 && <tr><td colSpan={cols.length+computed.length+1} style={{padding:"10px 4px",color:"#94A3B8"}}>No rows yet.</td></tr>}
        </tbody>
      </table>
    </div>
    <button onClick={add} style={{...tbtn,marginTop:10}}>+ Add row</button>
  </div>);
}

const recordCols=[
  {key:"haul",label:"Haul",type:"text",w:42},{key:"time",label:"Time",type:"text",w:56},
  {key:"tier",label:"Tier",type:"select",options:TIER_IDS.map(String),w:52},
  {key:"sp",label:"Species",type:"spselect",w:104},{key:"grade",label:"Grade",type:"text",w:60},
  {key:"boxes",label:"Boxes",type:"num",w:58},{key:"ice",label:"Ice OK",type:"yn",w:56},
  {key:"temp",label:"°C",type:"num",w:50},{key:"sub",label:"Sub-MCRS",type:"yn",w:64},{key:"initial",label:"Init",type:"text",w:46},
];
const haulCols=[
  {key:"haul",label:"Haul",type:"text",w:42},{key:"shot",label:"Shot time",type:"text",w:66},
  {key:"hauled",label:"Haul time",type:"text",w:66},{key:"dur",label:"Dur (h)",type:"num",w:54},
  {key:"pos",label:"Position / Grounds",type:"text",w:150},{key:"mix",label:"Species mix",type:"text",w:130},
  {key:"boxes",label:"Total boxes",type:"num",w:66},{key:"wt",label:"Est wt (kg)",type:"num",w:78},{key:"initial",label:"Init",type:"text",w:46},
];
const tempCols=[
  {key:"date",label:"Date",type:"text",w:84},{key:"time",label:"Time",type:"text",w:56},
  {key:"tier",label:"Tier",type:"select",options:TIER_IDS.map(String),w:52},{key:"temp",label:"°C",type:"num",w:52},
  {key:"action",label:"Action / Notes",type:"text",w:170},{key:"initial",label:"Init",type:"text",w:46},
];

const lbl={display:"flex",flexDirection:"column",gap:"0.25rem",fontSize:"0.8rem",fontWeight:600};
const tbtn={padding:"4px 9px",borderRadius:7,cursor:"pointer",border:"1px solid #CBD5E1",background:"#fff",fontSize:".78rem",fontWeight:600};
const inp={padding:"6px 8px",borderRadius:7,border:"1px solid #CBD5E1",fontSize:".9rem",fontWeight:400};
const cin=(w)=>({width:w||70,padding:"4px 5px",borderRadius:6,border:"1px solid #CBD5E1",fontSize:".8rem"});
const thc={textAlign:"left",padding:"4px 6px",borderBottom:"2px solid #E2E8F0",whiteSpace:"nowrap",fontSize:".72rem",color:"#334155"};
const tdc={padding:"3px 6px",verticalAlign:"middle"};
