import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import AppShell from "../AppShell";
import PageHeader from "../PageHeader";
import { supabase } from "../supabaseClient";
import { useAuth } from "../AuthContext";

// ── Per-vessel fishroom layouts, keyed by fleet id ──────────────────────────
const rect = (slots, high) => Array(slots).fill(high);
const LAYOUTS = {
  "00000000-0000-0000-0000-000000000001": {
    vessel:"AUDACIOUS BF83", high:14, capacity:1756,
    tiers:{
      1:{pos:"Aft (bulkhead)",h:rect(16,14)}, 2:{pos:"Aft",h:rect(16,14)},
      3:{pos:"Aft",h:rect(16,14)}, 4:{pos:"Aft-mid",h:rect(16,14)},
      5:{pos:"Mid",h:[10,14,14,14,14,10]}, 6:{pos:"Mid",h:[12,14,14,14,14,12]},
      7:{pos:"Mid",h:[12,14,14,14,14,14,14,14,14,14,12]},
      8:{pos:"Fwd-mid",h:[5,10,12,14,14,14,14,14,14,14,14,14,12,10,5]},
      9:{pos:"Fwd",h:[5,9,12,14,14,14,14,14,14,14,12,9,5]},
      10:{pos:"Fwd",h:[5,10,13,14,14,14,14,14,13,10,5]},
      11:{pos:"Fwd (bow)",h:[4,10,14,14,14,14,14,10,4]},
    },
  },
  "66df195c-a39e-4559-957c-9ad1f7e15bd9": {
    vessel:"BOY ANDREW WK-170", high:11, capacity:1221,
    tiers:{
      1:{pos:"Fwd (bow)",h:rect(5,11)}, 2:{pos:"Fwd",h:rect(6,11)},
      3:{pos:"Fwd-mid",h:rect(7,11)}, 4:{pos:"Fwd-mid",h:rect(9,11)},
      5:{pos:"Mid",h:rect(10,11)}, 6:{pos:"Mid",h:rect(11,11)},
      7:{pos:"Mid-aft",h:rect(11,11)}, 8:{pos:"Mid-aft",h:rect(13,11)},
      9:{pos:"Aft",h:rect(13,11)}, 10:{pos:"Aft",h:rect(13,11)},
      11:{pos:"Aft (bulkhead)",h:rect(13,11)},
    },
  },
};
const FALLBACK = { vessel:"", high:1, capacity:0, tiers:{} };

// Full default species range (FAO 3-alpha codes). Skippers add/edit their own in Setup.
const DEFAULT_SPECIES = [
  {code:"HAD",name:"Haddock",c:"#1F6FEB",kg:40},{code:"COD",name:"Cod",c:"#E5484D",kg:30},
  {code:"WHG",name:"Whiting",c:"#12A594",kg:40},{code:"POK",name:"Saithe",c:"#5B6570",kg:40},
  {code:"ANF",name:"Monkfish",c:"#8250DF",kg:30},{code:"MEG",name:"Megrim",c:"#E8821E",kg:30},
  {code:"LEM",name:"Lemon Sole",c:"#9AA400",kg:35},{code:"PLE",name:"Plaice",c:"#B07B47",kg:30},
  {code:"HKE",name:"Hake",c:"#D6409F",kg:30},{code:"LIN",name:"Ling",c:"#0EA5E9",kg:30},
  {code:"POL",name:"Pollack",c:"#65A30D",kg:30},{code:"TUR",name:"Turbot",c:"#7C3AED",kg:30},
  {code:"BLL",name:"Brill",c:"#DB2777",kg:30},{code:"HAL",name:"Halibut",c:"#059669",kg:30},
  {code:"WIT",name:"Witch",c:"#A16207",kg:35},{code:"DAB",name:"Dab",c:"#C026D3",kg:35},
  {code:"SOL",name:"Sole",c:"#0891B2",kg:30},{code:"JOD",name:"John Dory",c:"#EA580C",kg:30},
  {code:"CAT",name:"Catfish",c:"#4F46E5",kg:30},{code:"GUR",name:"Gurnard",c:"#BE123C",kg:30},
  {code:"SKA",name:"Skate/Ray",c:"#E06C9F",kg:35},{code:"BMS",name:"Sub-MCRS",c:"#111827",kg:30},
];

const ERASE="__ERASE__"; const KEY=(t,l,s)=>`${t}-${l}-${s}`;
const isTouch = ()=> typeof window!=="undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
const emptyMeta = ()=>({ trip:{}, haulInfo:{}, temp:[], signoff:{}, currentHaul:1 });
const niceWhen = (ts)=>{ if(!ts) return ""; const d=new Date(ts); return d.toLocaleDateString()+" "+d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); };
// grid cell can be legacy string or {s,h}
const cellSp = (v)=> v==null ? null : (typeof v==="string" ? v : v.s);
const cellHaul = (v)=> v==null ? 1 : (typeof v==="string" ? 1 : (v.h||1));

export default function StowagePlan(){
  const { appUser } = useAuth();
  const isSkipper = appUser?.role === "skipper";
  const layout = LAYOUTS[appUser?.fleet_id] || null;
  const L = layout || FALLBACK;

  const TIER_IDS = Object.keys(L.tiers).map(Number);
  const LAYERS = Array.from({length:L.high},(_,i)=>L.high-i);
  const capacityOf = (t)=> (L.tiers[t]?.h||[]).reduce((a,b)=>a+b,0);
  const TOTAL_CAP = L.capacity || TIER_IDS.reduce((a,t)=>a+capacityOf(t),0);
  const exists = (t,l,s)=> !!L.tiers[t] && l >= (L.high - L.tiers[t].h[s] + 1);

  const [species, setSpecies] = useState(DEFAULT_SPECIES);
  const cfgLoaded = useRef(false);
  const [plans,setPlans]=useState([]);
  const [planId,setPlanId]=useState(null);
  const [tripNo,setTripNo]=useState("");
  const [newTrip,setNewTrip]=useState("");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  const [grid,setGrid]=useState({});
  const [meta,setMeta]=useState(emptyMeta());

  const [section,setSection]=useState("fishroom");
  const [brush,setBrush]=useState("HAD");
  const [tier,setTier]=useState(1);
  const [mode,setMode]=useState(()=> isTouch()?"tap":"drag");
  const [anchor,setAnchor]=useState(null);
  const painting=useRef(false); const planLoaded=useRef(false);

  const SP = useMemo(()=> Object.fromEntries(species.map(s=>[s.code,s])), [species]);
  const kgOf = useCallback((code)=> SP[code]?.kg || 0, [SP]);
  const curHaul = meta.currentHaul || 1;

  // ── config (species + weights) load/save, per fleet, persists across trips ──
  useEffect(()=>{ if(!isSkipper || !layout){ return; } ;(async()=>{
    try{ const { data } = await supabase.from("stowage_config").select("data").eq("fleet_id", appUser.fleet_id).maybeSingle();
      const sp = data?.data?.species;
      if(Array.isArray(sp) && sp.length) setSpecies(sp);
    }catch{} finally{ cfgLoaded.current = true; }
  })(); },[isSkipper, appUser?.fleet_id, !!layout]);
  useEffect(()=>{ if(!cfgLoaded.current || !isSkipper) return;
    const id=setTimeout(async()=>{
      try{ await supabase.from("stowage_config").upsert({ fleet_id: appUser.fleet_id, data:{ species }, updated_at:new Date().toISOString() }, { onConflict:"fleet_id" }); }catch{}
    },600); return ()=>clearTimeout(id);
  },[species]);

  async function loadPlans(){
    setLoading(true);
    const { data, error } = await supabase.from("stowage_plans").select("id,trip_no,vessel,updated_at").order("updated_at",{ascending:false});
    if(error) setError(error.message);
    setPlans(data||[]); setLoading(false);
  }
  useEffect(()=>{ if(isSkipper && layout) loadPlans(); else setLoading(false); },[isSkipper, appUser?.fleet_id]);

  async function openPlan(id){
    setError(""); planLoaded.current=false;
    const { data, error } = await supabase.from("stowage_plans").select("*").eq("id",id).single();
    if(error){ setError(error.message); return; }
    const d = data.data||{};
    setGrid(d.grid||{});
    setMeta({ ...emptyMeta(), trip:d.trip||{}, haulInfo:d.haulInfo||{}, temp:d.temp||[], signoff:d.signoff||{}, currentHaul:d.currentHaul||1 });
    setPlanId(id); setTripNo(data.trip_no); setSection("fishroom"); setTier(1);
    setTimeout(()=>{ planLoaded.current=true; },0);
  }
  async function createPlan(){
    const tn=newTrip.trim(); if(!tn) return;
    const { data, error } = await supabase.from("stowage_plans")
      .insert({ trip_no:tn, vessel:L.vessel, data:{}, created_by:appUser.id }).select("id").single();
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

  useEffect(()=>{ if(!planId || !planLoaded.current) return;
    const id=setTimeout(async()=>{
      setSaving(true);
      const { error } = await supabase.from("stowage_plans")
        .update({ data:{ grid, trip:meta.trip, haulInfo:meta.haulInfo, temp:meta.temp, signoff:meta.signoff, currentHaul:meta.currentHaul }, updated_at:new Date().toISOString() })
        .eq("id",planId);
      if(error) setError(error.message);
      setSaving(false);
    },700); return ()=>clearTimeout(id);
  },[grid,meta,planId]);

  useEffect(()=>{ const up=()=>{painting.current=false}; window.addEventListener("pointerup",up); return()=>window.removeEventListener("pointerup",up); },[]);
  useEffect(()=>{ setAnchor(null); },[tier,mode,brush,section]);

  const put = useCallback((t,l,s)=>{ if(!exists(t,l,s))return; setGrid(p=>{const n={...p};const k=KEY(t,l,s); if(brush===ERASE)delete n[k]; else n[k]={s:brush,h:curHaul}; return n;}); },[brush,layout,curHaul]);
  const putMany = useCallback((cells)=>{ setGrid(p=>{const n={...p}; for(const k of cells){ if(brush===ERASE)delete n[k]; else n[k]={s:brush,h:curHaul};} return n;}); },[brush,curHaul]);
  const fillRect = useCallback((a,b)=>{ const l0=Math.min(a.l,b.l),l1=Math.max(a.l,b.l),s0=Math.min(a.s,b.s),s1=Math.max(a.s,b.s); const c=[]; for(let l=l0;l<=l1;l++)for(let s=s0;s<=s1;s++)if(exists(tier,l,s))c.push(KEY(tier,l,s)); putMany(c); },[tier,putMany,layout]);
  const tierCells=(t)=>{const o=[]; for(const l of LAYERS)for(let s=0;s<L.tiers[t].h.length;s++)if(exists(t,l,s))o.push(KEY(t,l,s)); return o;};
  const fillTier=()=>putMany(tierCells(tier));
  const fillLayer=(l)=>putMany(L.tiers[tier].h.map((_,s)=>exists(tier,l,s)?KEY(tier,l,s):null).filter(Boolean));
  const fillSlot=(s)=>putMany(LAYERS.map(l=>exists(tier,l,s)?KEY(tier,l,s):null).filter(Boolean));
  const tapCell=(l,s)=>{ if(!exists(tier,l,s))return; if(!anchor)setAnchor({l,s}); else{fillRect(anchor,{l,s});setAnchor(null);} };

  const totals=useMemo(()=>{const t={};let filled=0,wt=0; for(const v of Object.values(grid)){ const s=cellSp(v); if(!s) continue; t[s]=(t[s]||0)+1;filled++;wt+=kgOf(s);} return{t,filled,wt};},[grid,SP]);
  const tierFill=useMemo(()=>{const m={}; for(const t of TIER_IDS)m[t]=0; for(const k of Object.keys(grid)){const t=+k.split("-")[0]; m[t]=(m[t]||0)+1;} return m;},[grid,appUser?.fleet_id]);
  // per-haul auto aggregation from the grid
  const haulAgg=useMemo(()=>{ const m={}; for(const v of Object.values(grid)){ const s=cellSp(v); if(!s) continue; const h=cellHaul(v); m[h]=m[h]||{boxes:0,kg:0,sp:{}}; m[h].boxes++; m[h].kg+=kgOf(s); m[h].sp[s]=(m[h].sp[s]||0)+1; } return m; },[grid,SP]);
  const maxHaul=useMemo(()=>Math.max(curHaul, ...Object.keys(haulAgg).map(Number), 1), [curHaul,haulAgg]);

  const setTrip=(k,v)=>setMeta(m=>({...m,trip:{...m.trip,[k]:v}}));
  const setSign=(k,v)=>setMeta(m=>({...m,signoff:{...m.signoff,[k]:v}}));
  const setTemp=(fn)=>setMeta(m=>({...m,temp: typeof fn==="function"?fn(m.temp):fn}));
  const setHaulInfo=(h,k,v)=>setMeta(m=>({...m,haulInfo:{...m.haulInfo,[h]:{...(m.haulInfo?.[h]||{}),[k]:v}}}));
  const addHaul=()=>setMeta(m=>({...m,currentHaul:(m.currentHaul||1)+1}));
  const setCurHaul=(h)=>setMeta(m=>({...m,currentHaul:h}));

  const width = layout ? L.tiers[tier].h.length : 0; const cell=30; const brushName= brush===ERASE?"empty":SP[brush]?.name;
  const SECTIONS=[["trip","Trip"],["fishroom","Fishroom"],["hauls","Hauls"],["totals","Totals"],["temp","Temp log"],["signoff","Sign-off"],["setup","Setup"]];
  const tempCols=[
    {key:"date",label:"Date",type:"text",w:84},{key:"time",label:"Time",type:"text",w:56},
    {key:"tier",label:"Tier",type:"select",options:TIER_IDS.map(String),w:52},{key:"temp",label:"°C",type:"num",w:52},
    {key:"action",label:"Action / Notes",type:"text",w:170},{key:"initial",label:"Init",type:"text",w:46},
  ];

  const doPrint = () => { try { printRecord({ L, LAYERS, grid, SP, species, tripNo, meta, totals, haulAgg, maxHaul, TOTAL_CAP, existsFn:exists }); } catch(e){ setError("Print failed: "+e.message); } };

  if(!isSkipper) return (
    <AppShell>
      <div className="card"><p className="muted">The stowage plan is available to the skipper.</p></div>
    </AppShell>);

  if(!layout) return (
    <AppShell>
      <PageHeader title="Fishroom Stowage" />
      <div className="card">
        <p style={{marginBottom:"0.6rem"}}>Your vessel's fishroom layout hasn't been added yet — every boat's hold is different (tiers, widths, stack height), so the plan has to be built to your boat.</p>
        <p className="muted" style={{marginBottom:0}}>Send the host/owner a PDF copy of your stowage plan / fishroom layout and it'll be added in due course.</p>
      </div>
    </AppShell>);

  if(!planId) return (
    <AppShell>
      <PageHeader title={`Fishroom Stowage — ${L.vessel}`} sub="Pick a trip to open its plan, or start a new one." />
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
    </AppShell>);

  return (
    <AppShell>
      <div style={{maxWidth:920,margin:"0 auto",padding:"0 2px 40px"}}>
        <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
          <button onClick={closePlan} style={{...tbtn,marginRight:4}}>← Trips</button>
          <h2 style={{margin:"0 0 2px",fontSize:"1.15rem"}}>Trip {tripNo} — {L.vessel}</h2>
          <span style={{color:"#475569",fontSize:".82rem"}}>{totals.filled} / {TOTAL_CAP} boxes · <b>{totals.wt.toLocaleString()} kg</b></span>
          <button onClick={doPrint} style={{...tbtn,marginLeft:"auto"}}>🖨 Print record</button>
          <span style={{fontSize:".76rem",color:saving?"#B45309":"#16A34A"}}>{saving?"Saving…":"Saved"}</span>
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
          {/* haul control */}
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:10,padding:"8px 10px",background:"#F1F5F9",borderRadius:9}}>
            <b style={{fontSize:".85rem"}}>Painting into</b>
            <select value={curHaul} onChange={e=>setCurHaul(Number(e.target.value))} style={{...cin(90),fontWeight:700}}>
              {Array.from({length:maxHaul},(_,i)=>i+1).map(h=><option key={h} value={h}>Haul {h}</option>)}
            </select>
            <button onClick={addHaul} style={tbtn}>+ Add haul</button>
            <span className="muted" style={{fontSize:".76rem"}}>Boxes you fill now are tagged to this haul. The Hauls tab totals them up automatically.</span>
          </div>

          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            {species.map(sp=>{const on=brush===sp.code; return(
              <button key={sp.code} onClick={()=>setBrush(sp.code)} title={sp.name+" ("+sp.code+")"} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:8,cursor:"pointer",border:on?`2px solid ${sp.c}`:"1px solid #94A3B8",background:on?sp.c+"1A":"#fff",fontWeight:600,fontSize:".84rem",color:"#0F172A"}}>
                <span style={{width:14,height:14,borderRadius:3,background:sp.c,flexShrink:0}}/>{sp.name}<span style={{color:"#64748B",fontWeight:500}}>{totals.t[sp.code]||0}</span></button>);})}
            <button onClick={()=>setBrush(ERASE)} style={{padding:"6px 10px",borderRadius:8,cursor:"pointer",border:brush===ERASE?"2px solid #64748B":"1px solid #94A3B8",background:brush===ERASE?"#E2E8F0":"#fff",fontWeight:600,fontSize:".84rem",color:"#0F172A"}}>⌫ Empty</button>
          </div>

          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:8}}>
            <div style={{display:"inline-flex",border:"1px solid #CBD5E1",borderRadius:8,overflow:"hidden"}}>
              {[["drag","🖱 Drag (PC)"],["tap","👆 Tap corners (phone)"]].map(([m,label])=>(
                <button key={m} onClick={()=>setMode(m)} style={{padding:"5px 11px",border:"none",cursor:"pointer",fontSize:".8rem",fontWeight:mode===m?700:500,background:mode===m?"#1E3A5F":"#fff",color:mode===m?"#fff":"#334155"}}>{label}</button>))}
            </div>
            <span style={{fontSize:".78rem",color:anchor?"#B45309":"#475569",fontWeight:anchor?700:500}}>
              {mode==="drag" ? <>Drag across boxes to fill with <b>{brushName}</b>.</>
               : anchor ? <>Now tap the opposite corner to fill with <b>{brushName}</b> — or <button onClick={()=>setAnchor(null)} style={{...tbtn,padding:"1px 6px"}}>cancel</button></>
               : <>Tap one box, then the opposite corner, to fill a block with <b>{brushName}</b>.</>}
            </span>
          </div>
          <p style={{margin:"0 0 10px",fontSize:".76rem",color:"#64748B"}}>Tap a <b>layer</b> (L) or <b>slot</b> (S) label to fill that row/column · <b>Fill tier</b> does the lot.</p>
          <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:12}}>
            {TIER_IDS.map(t=>{const on=t===tier; const pct=Math.round((tierFill[t]/capacityOf(t))*100); return(
              <button key={t} onClick={()=>setTier(t)} style={{padding:"5px 8px",borderRadius:7,cursor:"pointer",minWidth:52,border:on?"2px solid #1E3A5F":"1px solid #CBD5E1",background:on?"#1E3A5F":"#fff",color:on?"#fff":"#0F172A",fontSize:".78rem",fontWeight:on?700:500}}>
                T{t}<div style={{fontSize:".64rem",opacity:.8}}>{pct}%</div></button>);})}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:8}}>
            <b style={{fontSize:".92rem"}}>Tier {tier} — {L.tiers[tier].pos}</b>
            <span style={{color:"#475569",fontSize:".78rem"}}>{width} slots · {capacityOf(tier)} boxes · {tierFill[tier]} filled</span>
            <button onClick={fillTier} style={tbtn}>Fill tier with {brushName}</button>
          </div>
          <div style={{overflowX:"auto",paddingBottom:6,touchAction:"pan-x"}}>
            <table style={{borderCollapse:"collapse",userSelect:"none"}}><thead><tr><th style={{width:34}}/>
              {Array.from({length:width},(_,s)=>(<th key={s} onClick={()=>fillSlot(s)} title="Fill slot/column" style={{fontSize:".6rem",color:"#64748B",cursor:"pointer",padding:"2px 0",fontWeight:600}}>S{s+1}{L.tiers[tier].h[s]<L.high&&<div style={{color:"#94A3B8",fontSize:".55rem"}}>▲{L.tiers[tier].h[s]}</div>}</th>))}
            </tr></thead><tbody>
              {LAYERS.map(l=>(<tr key={l}>
                <td onClick={()=>fillLayer(l)} title="Fill layer/row" style={{fontSize:".62rem",color:"#64748B",cursor:"pointer",textAlign:"right",paddingRight:5,fontWeight:600,whiteSpace:"nowrap"}}>L{l}{l===L.high?"▲":l===1?"▼":""}</td>
                {Array.from({length:width},(_,s)=>{ const ok=exists(tier,l,s);
                  if(!ok)return<td key={s} style={{width:cell,height:cell,background:"repeating-linear-gradient(45deg,#F1F5F9,#F1F5F9 4px,#E2E8F0 4px,#E2E8F0 8px)",border:"1px solid #EEF2F6"}}/>;
                  const v=grid[KEY(tier,l,s)]; const code=cellSp(v); const sp=code&&SP[code]; const isA=anchor&&anchor.l===l&&anchor.s===s;
                  return<td key={s}
                    onPointerDown={mode==="drag"?(e=>{e.preventDefault();painting.current=true;put(tier,l,s);}):undefined}
                    onPointerEnter={mode==="drag"?(()=>{if(painting.current)put(tier,l,s);}):undefined}
                    onClick={mode==="tap"?(()=>tapCell(l,s)):undefined}
                    title={`T${tier}·L${l}·S${s+1}${sp?" · "+sp.name+" (H"+cellHaul(v)+")":""}`}
                    style={{width:cell,height:cell,border:isA?"3px solid #B45309":"1px solid #E2E8F0",cursor:"pointer",background:sp?sp.c:"#fff",touchAction:mode==="drag"?"none":"auto",color:"#fff",fontSize:".46rem",textAlign:"center",fontWeight:700,lineHeight:1}}>{code?code:""}</td>;})}
              </tr>))}
            </tbody></table>
          </div>
          <p style={{fontSize:".72rem",color:"#94A3B8",marginTop:6}}>Each box shows its species code. Hatched = shelf void.</p>
        </>)}

        {section==="hauls" && (
          <div>
            <b style={{fontSize:".95rem"}}>Hauls <span style={{color:"#94A3B8",fontWeight:400,fontSize:".8rem"}}>(box counts auto-filled from the fishroom — add times/position by hand)</span></b>
            {Array.from({length:maxHaul},(_,i)=>i+1).map(h=>{ const agg=haulAgg[h]; const info=meta.haulInfo?.[h]||{};
              return (<div key={h} className="card" style={{marginTop:10,padding:"0.7rem 0.9rem"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <b style={{color:"var(--navy)"}}>Haul {h}</b>
                  {agg ? <span style={{fontSize:".82rem"}}><b>{agg.boxes}</b> boxes · <b>{Math.round(agg.kg).toLocaleString()}</b> kg</span> : <span className="muted" style={{fontSize:".8rem"}}>nothing stowed yet</span>}
                  {h===curHaul && <span style={{fontSize:".7rem",background:"#1E3A5F",color:"#fff",borderRadius:5,padding:"1px 6px"}}>painting now</span>}
                </div>
                {agg && <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:6}}>
                  {Object.entries(agg.sp).sort((a,b)=>b[1]-a[1]).map(([code,n])=>(
                    <span key={code} style={{display:"flex",alignItems:"center",gap:5,fontSize:".78rem",border:"1px solid var(--border)",borderRadius:6,padding:"1px 7px"}}>
                      <span style={{width:10,height:10,borderRadius:2,background:SP[code]?.c||"#999"}}/>{SP[code]?.name||code} <b>{n}</b></span>))}
                </div>}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginTop:10}}>
                  {[["shot","Shot time"],["hauled","Haul time"],["dur","Duration (h)"],["pos","Position / grounds"],["initial","Initial"]].map(([k,label])=>(
                    <label key={k} style={{display:"flex",flexDirection:"column",gap:3,fontSize:".76rem",fontWeight:600}}>{label}
                      <input value={info[k]||""} onChange={e=>setHaulInfo(h,k,e.target.value)} style={inp}/></label>))}
                </div>
              </div>);})}
          </div>)}

        {section==="totals" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",flexWrap:"wrap",gap:8}}>
              <b style={{fontSize:".95rem"}}>Trip totals by species <span style={{color:"#94A3B8",fontWeight:400,fontSize:".8rem"}}>(auto from the fishroom grid)</span></b>
              <button onClick={()=>{if(confirm("Clear the whole fishroom grid for this trip?"))setGrid({});}} style={{...tbtn,borderColor:"#FCA5A5",color:"#B91C1C"}}>Clear grid</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:6,marginTop:12}}>
              {species.filter(sp=>totals.t[sp.code]).map(sp=>(
                <div key={sp.code} style={{display:"flex",alignItems:"center",gap:7,fontSize:".85rem"}}>
                  <span style={{width:12,height:12,borderRadius:3,background:sp.c}}/>{sp.name} <span style={{color:"#94A3B8",fontSize:".72rem"}}>{sp.code}</span>
                  <span style={{marginLeft:"auto"}}><b>{totals.t[sp.code]}</b> <span style={{color:"#94A3B8"}}>bx ·</span> <b>{(totals.t[sp.code]*kgOf(sp.code)).toLocaleString()}</b> <span style={{color:"#94A3B8"}}>kg</span></span></div>))}
              {totals.filled>0 && (<div style={{display:"flex",alignItems:"center",gap:7,fontSize:".9rem",gridColumn:"1/-1",borderTop:"1px solid #E2E8F0",paddingTop:8,marginTop:2}}>
                <b>GRAND TOTAL</b><span style={{marginLeft:"auto"}}><b>{totals.filled}</b> <span style={{color:"#94A3B8"}}>bx ·</span> <b>{totals.wt.toLocaleString()}</b> <span style={{color:"#94A3B8"}}>kg</span></span></div>)}
              {totals.filled===0 && <span style={{color:"#94A3B8",fontSize:".85rem"}}>Nothing stowed yet — fill the fishroom grid and the totals appear here.</span>}
            </div>
          </div>)}

        {section==="temp" && <LogTable title="Temperature log — target 0–2 °C" cols={tempCols} rows={meta.temp} setRows={setTemp}
          computed={[{label:"In range?", fn:r=> r.temp===""||r.temp==null ? "" : (Number(r.temp)>=0&&Number(r.temp)<=2 ? "✓ Y" : "✗ N")}]} />}

        {section==="signoff" && <SignOff s={meta.signoff} set={setSign} totals={totals}/>}

        {section==="setup" && <SetupTab species={species} setSpecies={setSpecies}/>}
      </div>
    </AppShell>);
}

function TripDetails({trip,set}){
  const F=(k,label,type="text")=>(<label style={{display:"flex",flexDirection:"column",gap:3,fontSize:".8rem",fontWeight:600}}>{label}
    <input type={type} value={trip[k]||""} onChange={e=>set(k,e.target.value)} style={inp}/></label>);
  return (<div><b style={{fontSize:".95rem"}}>Trip details</b>
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
    <p style={{fontSize:".8rem",color:"#475569",marginTop:6}}>I confirm all fish on this plan were caught, handled, iced and stowed per hygiene regulations and landing-obligation requirements. All sub-MCRS (BMS) fish are stored separately in clearly labelled containers. This record ({totals.filled} boxes · {totals.wt.toLocaleString()} kg) is accurate to the best of my knowledge.</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10,marginTop:10}}>
      {F("skPrint","Skipper — print")}{F("skDate","Skipper — date","date")}{F("mtPrint","Crew chief / mate — print")}{F("mtDate","Mate — date","date")}
    </div>
    <label style={{display:"flex",alignItems:"center",gap:8,marginTop:12,fontSize:".85rem",fontWeight:600}}>
      <input type="checkbox" checked={!!s.confirmed} onChange={e=>set("confirmed",e.target.checked)}/> Declaration confirmed (signatures added on the printed copy)</label>
  </div>);
}
function SetupTab({species,setSpecies}){
  const upd=(i,k,v)=>setSpecies(list=>list.map((x,j)=>j===i?{...x,[k]:v}:x));
  const del=i=>{ if(confirm("Remove this species?")) setSpecies(list=>list.filter((_,j)=>j!==i)); };
  const add=()=>setSpecies(list=>[...list,{code:"",name:"New species",c:"#64748B",kg:30}]);
  const reset=()=>{ if(confirm("Reset the species list back to the default range?")) setSpecies(DEFAULT_SPECIES); };
  return (<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",flexWrap:"wrap",gap:8}}>
      <b style={{fontSize:".95rem"}}>Species & box weights</b>
      <button className="secondary" onClick={reset} style={{fontSize:".78rem",padding:"3px 9px"}}>Reset to default</button>
    </div>
    <p className="muted" style={{fontSize:".78rem",marginTop:4}}>Add the species your boat catches, set the code (logbook 3-letter), colour and box weight (kg). Weights are used everywhere and stay set for every trip until you change them.</p>
    <div style={{overflowX:"auto",marginTop:10}}>
      <table style={{borderCollapse:"collapse",fontSize:".84rem",minWidth:520}}>
        <thead><tr>{["Colour","Species","Code","Box kg",""].map(h=><th key={h} style={thc}>{h}</th>)}</tr></thead>
        <tbody>
          {species.map((sp,i)=>(<tr key={i} style={{borderTop:"1px solid var(--border)"}}>
            <td style={tdc}><input type="color" value={sp.c} onChange={e=>upd(i,"c",e.target.value)} style={{width:34,height:28,border:"none",background:"none",cursor:"pointer"}}/></td>
            <td style={tdc}><input value={sp.name} onChange={e=>upd(i,"name",e.target.value)} style={cin(150)}/></td>
            <td style={tdc}><input value={sp.code} onChange={e=>upd(i,"code",e.target.value.toUpperCase().slice(0,4))} style={{...cin(64),textTransform:"uppercase",fontWeight:700}}/></td>
            <td style={tdc}><input type="number" min="0" value={sp.kg} onChange={e=>upd(i,"kg",e.target.value===""?0:Number(e.target.value))} style={{...cin(64),textAlign:"right"}}/></td>
            <td style={tdc}><button onClick={()=>del(i)} style={{...tbtn,padding:"2px 7px",color:"#B91C1C",borderColor:"#FCA5A5"}}>✕</button></td>
          </tr>))}
        </tbody>
      </table>
    </div>
    <button onClick={add} style={{...tbtn,marginTop:10}}>+ Add species</button>
  </div>);
}
function LogTable({title,cols,rows,setRows,computed=[]}){
  const add=()=>setRows(r=>[...r,{}]);
  const upd=(i,k,v)=>setRows(r=>r.map((row,j)=>j===i?{...row,[k]:v}:row));
  const del=i=>setRows(r=>r.filter((_,j)=>j!==i));
  const cellIn=(row,i,c)=>{ const v=row[c.key]??""; const on=e=>upd(i,c.key,e.target.value);
    if(c.type==="select") return <select value={v} onChange={on} style={cin(c.w)}><option value=""/>{c.options.map(o=><option key={o} value={o}>{o}</option>)}</select>;
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

// ── Print: opens a clean self-contained record for boarding ─────────────────
function printRecord({ L, LAYERS, grid, SP, species, tripNo, meta, totals, haulAgg, maxHaul, TOTAL_CAP, existsFn }){
  const cSp=(v)=> v==null?null:(typeof v==="string"?v:v.s);
  const esc=(x)=>String(x==null?"":x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const t=meta.trip||{};
  const used = species.filter(sp=>totals.t[sp.code]);
  const legend = used.map(sp=>`<span class="lg"><i style="background:${sp.c}"></i><b>${esc(sp.code)}</b> ${esc(sp.name)} · ${sp.kg}kg</span>`).join("");
  const tiers = Object.keys(L.tiers).map(Number);
  const grids = tiers.map(tn=>{
    const h=L.tiers[tn].h, width=h.length;
    let rows="";
    for(const l of LAYERS){
      let cells="";
      for(let s=0;s<width;s++){
        if(!existsFn(tn,l,s)){ cells+=`<td class="void"></td>`; continue; }
        const v=grid[`${tn}-${l}-${s}`]; const code=cSp(v); const sp=code&&SP[code];
        cells+= sp ? `<td style="background:${sp.c}">${esc(code)}</td>` : `<td></td>`;
      }
      rows+=`<tr>${cells}</tr>`;
    }
    return `<div class="tier"><div class="th">Tier ${tn} — ${esc(L.tiers[tn].pos)}</div><table class="grid">${rows}</table></div>`;
  }).join("");
  const haulRows = Array.from({length:maxHaul},(_,i)=>i+1).map(hn=>{ const a=haulAgg[hn]; const info=meta.haulInfo?.[hn]||{};
    const mix=a?Object.entries(a.sp).sort((x,y)=>y[1]-x[1]).map(([c,n])=>`${esc(c)} ${n}`).join(", "):"—";
    return `<tr><td>${hn}</td><td>${esc(info.shot||"")}</td><td>${esc(info.hauled||"")}</td><td>${esc(info.pos||"")}</td><td>${mix}</td><td style="text-align:right">${a?a.boxes:0}</td><td style="text-align:right">${a?Math.round(a.kg).toLocaleString():0}</td></tr>`;
  }).join("");
  const totalRows = used.map(sp=>`<tr><td><i class="sw" style="background:${sp.c}"></i>${esc(sp.code)} ${esc(sp.name)}</td><td style="text-align:right">${totals.t[sp.code]}</td><td style="text-align:right">${(totals.t[sp.code]*(sp.kg||0)).toLocaleString()}</td></tr>`).join("");
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>Stowage record — ${esc(L.vessel)} trip ${esc(tripNo)}</title>
  <style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:14px;font-size:12px}
    h1{font-size:16px;margin:0 0 2px} .sub{color:#555;margin:0 0 8px}
    .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:2px 16px;margin:6px 0 10px;font-size:11px}
    .legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin:6px 0 10px;font-size:11px}
    .lg{display:inline-flex;align-items:center;gap:4px} .lg i{width:11px;height:11px;border-radius:2px;display:inline-block}
    .tiers{display:flex;flex-wrap:wrap;gap:10px} .tier{margin-bottom:6px} .th{font-size:10px;font-weight:bold;margin-bottom:2px}
    table.grid{border-collapse:collapse} table.grid td{width:15px;height:15px;border:0.5px solid #ccc;text-align:center;font-size:6px;font-weight:bold;color:#fff;padding:0}
    table.grid td.void{background:#eee;border-color:#eee} table.grid td:empty{background:#fff}
    h2{font-size:12px;margin:12px 0 4px;border-bottom:1px solid #000;padding-bottom:2px}
    table.data{border-collapse:collapse;width:100%;font-size:10px} table.data th,table.data td{border:0.5px solid #999;padding:2px 4px;text-align:left}
    .sw{width:9px;height:9px;border-radius:2px;display:inline-block;margin-right:4px}
    .foot{margin-top:10px;font-size:10px;color:#333} .sign{margin-top:8px;font-size:11px}
    @media print{@page{margin:10mm}}
  </style></head><body>
  <h1>Fishroom Stowage Record — ${esc(L.vessel)}</h1>
  <p class="sub">Trip ${esc(tripNo)} · ${totals.filled} / ${TOTAL_CAP} boxes · ${totals.wt.toLocaleString()} kg · printed ${new Date().toLocaleString()}</p>
  <div class="meta">
    <div><b>Skipper:</b> ${esc(t.skipper||"")}</div><div><b>Sailed:</b> ${esc(t.sailed||"")}</div><div><b>Landed:</b> ${esc(t.landed||"")}</div>
    <div><b>Port:</b> ${esc(t.port||"")}</div><div><b>Grounds:</b> ${esc(t.grounds||"")}</div><div><b>Crew:</b> ${esc(t.crew||"")}</div>
  </div>
  <div class="legend">${legend||'<span>No fish stowed</span>'}</div>
  <h2>Fishroom</h2>
  <div class="tiers">${grids}</div>
  <h2>Hauls</h2>
  <table class="data"><thead><tr><th>Haul</th><th>Shot</th><th>Hauled</th><th>Position/grounds</th><th>Species mix (code × boxes)</th><th>Boxes</th><th>Est kg</th></tr></thead><tbody>${haulRows}</tbody></table>
  <h2>Trip totals by species</h2>
  <table class="data"><thead><tr><th>Species</th><th>Boxes</th><th>Est kg</th></tr></thead><tbody>${totalRows}<tr><th>TOTAL</th><th style="text-align:right">${totals.filled}</th><th style="text-align:right">${totals.wt.toLocaleString()}</th></tr></tbody></table>
  <p class="sign"><b>Declaration:</b> All fish caught, handled, iced and stowed per hygiene &amp; landing-obligation rules; sub-MCRS (BMS) stored separately and labelled.</p>
  <p class="sign">Skipper: ${esc(meta.signoff?.skPrint||"________________")} &nbsp; Signed: ________________ &nbsp; Date: ${esc(meta.signoff?.skDate||"__________")}</p>
  </body></html>`;
  const w=window.open("","_blank");
  if(!w){ alert("Allow pop-ups to print the record."); return; }
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(()=>{ try{ w.print(); }catch{} }, 350);
}

const lbl={display:"flex",flexDirection:"column",gap:"0.25rem",fontSize:"0.8rem",fontWeight:600};
const tbtn={padding:"4px 9px",borderRadius:7,cursor:"pointer",border:"1px solid #CBD5E1",background:"#fff",fontSize:".78rem",fontWeight:600,color:"#0F172A"};
const inp={padding:"6px 8px",borderRadius:7,border:"1px solid #CBD5E1",fontSize:".9rem",fontWeight:400};
const cin=(w)=>({width:w||70,padding:"4px 5px",borderRadius:6,border:"1px solid #CBD5E1",fontSize:".8rem"});
const thc={textAlign:"left",padding:"4px 6px",borderBottom:"2px solid #E2E8F0",whiteSpace:"nowrap",fontSize:".72rem",color:"#334155"};
const tdc={padding:"3px 6px",verticalAlign:"middle"};
