import React, { useState, useMemo, useRef, useEffect } from "react";
import BackNav from "../BackNav";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "../supabaseClient";
import { buildEstimatorPrices } from "../lib/market/estimatorPrices";

/* ============================================================
   Trip Gross Estimator v2 — Peterhead vs Hanstholm
   - Upload boat totals file (csv/tsv text or PDF) -> auto tally
   - Upload PD + DK price sheets (vision) -> review grids
   - Name-based grade mapping (species + size name), editable
   - Estimated gross per market, side by side, CSV export
   ============================================================ */

const FONT = `inherit`;
const MONO = `ui-monospace, SFMono-Regular, monospace`;
// App light theme (matches index.css): ink doubles as the primary button
// colour, so navy keeps those buttons looking like the rest of the app.
const C = {
  bg: "#ffffff", panel: "#FAFAFA", panel2: "#F2F2F2", line: "#d0d7de",
  ink: "#1F3864", dim: "#6b7280", pd: "#2E75B6", dk: "#c2410c",
  good: "#15803d", warn: "#b45309", bad: "#C00000",
};

/* Name-based grade dictionary: species -> size token -> {pd grade, dk sort, conf}
   Direction confirmed: 1 = smallest; names are authoritative.
   PD A1(big)..A5(small)/U9 ; DK sort 1(big), higher=smaller, 0=above 1. */
const GRADE_DICT = {
  CAT:{ SMALL:{pd:"U9 (low)",dk:"2",c:"med"}, MEDIUM:{pd:"U9",dk:"1",c:"med"}, LARGE:{pd:"U9 (high)",dk:"1",c:"med"} },
  COD:{ ROBBIE:{pd:"A5",dk:"5",c:"high"}, BABY:{pd:"A5",dk:"5",c:"high"}, "BIG BABY":{pd:"A4",dk:"4",c:"high"}, "BIG SMALL":{pd:"A4",dk:"4",c:"high"}, SMALL:{pd:"A5",dk:"5",c:"high"},
        MEDIUM:{pd:"A3",dk:"3",c:"high"}, SPRAG:{pd:"A2",dk:"2",c:"high"}, SELECTED:{pd:"A2",dk:"2",c:"high"}, COD:{pd:"A1",dk:"1",c:"high"}, LARGE:{pd:"A1",dk:"1",c:"high"}, "BOBBY DAZLER":{pd:"A1",dk:"1",c:"high"}, XL:{pd:"A1",dk:"0",c:"med"}, "X LARGE":{pd:"A1",dk:"0",c:"med"} },
  HADDOCK:{ "MINI METRO":{pd:"A4",dk:"3",c:"high"}, METRO:{pd:"A4",dk:"3",c:"med"}, CHIPPER:{pd:"A4",dk:"2",c:"med"},
        SEED:{pd:"A3",dk:"2",c:"high"}, "GOOD SEED":{pd:"A2",dk:"1",c:"high"}, PINGER:{pd:"A2",dk:"1",c:"high"}, CHAT:{pd:"A1",dk:"1",c:"high"},
        SELECTED:{pd:"A2",dk:"1",c:"high"}, MEDIUM:{pd:"A1",dk:"1",c:"high"}, LARGE:{pd:"A1",dk:"1",c:"high"}, XL:{pd:"A1",dk:"1",c:"med"} },
  HAKE:{ "X SMALL":{pd:"A4",dk:"4",c:"high"}, PINS:{pd:"A5",dk:"4",c:"med"}, BYROS:{pd:"A5",dk:"4",c:"med"}, SMALL:{pd:"A3",dk:"3",c:"high"}, SEL:{pd:"A2",dk:"2",c:"high"},
        SELECTED:{pd:"A2",dk:"2",c:"high"}, MEDIUM:{pd:"A1",dk:"1",c:"high"}, LARGE:{pd:"A1",dk:"1",c:"high"}, XL:{pd:"A1",dk:"0",c:"med"}, "X LARGE":{pd:"A1",dk:"0",c:"med"} },
  HALIBUT:{ "SIZE 1":{pd:"U9",dk:"1",c:"low"}, SMALL:{pd:"U9",dk:"2",c:"med"}, SELECTED:{pd:"U9",dk:"1",c:"med"}, MEDIUM:{pd:"U9",dk:"1",c:"med"}, LARGE:{pd:"U9",dk:"1",c:"med"} },
  "LEMON SOLE":{ SMALL:{pd:"A3",dk:"3",c:"low"}, MEDIUM:{pd:"A2",dk:"2",c:"low"}, LARGE:{pd:"A1",dk:"2",c:"low"} },
  LING:{ SMALL:{pd:"A3",dk:"3",c:"high"}, MEDIUM:{pd:"A2",dk:"2",c:"high"}, LARGE:{pd:"A1",dk:"1",c:"high"}, MIXED:{pd:"A2",dk:"2",c:"med"} },
  LYTHE:{ "X SMALL":{pd:"A4",dk:"4",c:"med"}, SMALL:{pd:"A4",dk:"4",c:"high"}, SEL:{pd:"A3",dk:"3",c:"high"}, SELECTED:{pd:"A3",dk:"3",c:"high"},
        MEDIUM:{pd:"A2",dk:"2",c:"high"}, LARGE:{pd:"A1",dk:"2",c:"med"} },
  MEGRIM:{ "X SMALL":{pd:"A3",dk:"3",c:"med"}, SMALL:{pd:"A3",dk:"3",c:"high"}, SELECTED:{pd:"A2",dk:"2",c:"med"}, MEDIUM:{pd:"A2",dk:"2",c:"med"}, LARGE:{pd:"A2",dk:"1",c:"med"}, BRUISED:{pd:"A3",dk:"3",c:"low"} },
  MONKFISH:{ FROGS:{pd:"A5",dk:"5",c:"high"}, SMALL:{pd:"A4",dk:"4",c:"high"}, SEL:{pd:"A3",dk:"3",c:"high"},
        SELECTED:{pd:"A3",dk:"3",c:"high"}, MEDIUM:{pd:"A2",dk:"2",c:"high"}, LARGE:{pd:"A1",dk:"1",c:"high"}, XL:{pd:"A1",dk:"1",c:"med"} },
  SAITHE:{ "X SMALL":{pd:"A4",dk:"4",c:"high"}, COLAS:{pd:"A4",dk:"4",c:"med"}, PODS:{pd:"A4",dk:"4",c:"med"}, SMALL:{pd:"A4",dk:"4",c:"high"}, SEL:{pd:"A3",dk:"3",c:"high"},
        SELECTED:{pd:"A3",dk:"3",c:"high"}, MEDIUM:{pd:"A2",dk:"2",c:"high"}, LARGE:{pd:"A1",dk:"1",c:"high"} },
  SQUID:{ LARGE:{pd:"U9 (high)",dk:"2",c:"low"}, SEL:{pd:"U9",dk:"2",c:"low"}, SELECTED:{pd:"U9",dk:"2",c:"low"}, MEDIUM:{pd:"U9",dk:"2",c:"low"}, SMALL:{pd:"U9 (low)",dk:"2",c:"low"} },
  TURBOT:{ "SIZE 1":{pd:"U9 (low)",dk:"3",c:"low"}, SMALL:{pd:"U9 (low)",dk:"3",c:"low"}, MEDIUM:{pd:"U9",dk:"2",c:"low"}, LARGE:{pd:"U9 (high)",dk:"1",c:"low"} },
  TUSK:{ "SIZE 1":{pd:"U9",dk:"1",c:"low"}, MIX:{pd:"U9",dk:"1",c:"med"} },
  PLAICE:{ SMALL:{pd:"A4",dk:"4",c:"high"}, SELECTED:{pd:"A3",dk:"3",c:"high"}, MEDIUM:{pd:"A2",dk:"2",c:"high"}, LARGE:{pd:"A1",dk:"1",c:"high"} },
  WHITING:{ "SMALL ROUND":{pd:"A4r (low)",dk:"2",c:"med"}, ROUND:{pd:"A4r",dk:"2",c:"med"}, SMALL:{pd:"A2",dk:"1",c:"med"}, SELECTED:{pd:"A2",dk:"1",c:"med"}, MEDIUM:{pd:"A2",dk:"1",c:"high"} },
  WITCH:{ "SIZE 3":{pd:"U9",dk:"3",c:"low"}, ROUND:{pd:"U9",dk:"2",c:"low"} },
};

const SP_TO_PD = { CAT:"Catfish", COD:"Cod", HADDOCK:"Haddock", HAKE:"Hake", HALIBUT:"Halibut",
  "LEMON SOLE":"Lemons", LING:"Ling", LYTHE:"Lythe", MEGRIM:"Megrim", MONKFISH:"Monks", PLAICE:"Plaice",
  SAITHE:"Coley", SQUID:"Squid", TURBOT:"Turbot", TUSK:"Tusk", WHITING:"Whiting", WITCH:"Witch", BRILL:"Brill", ROE:"—" };
const SP_TO_DK = { CAT:"Catfishes", COD:"Atlantic Cod", HADDOCK:"Haddock", HAKE:"European Hake",
  HALIBUT:"Atlantic Halibut", "LEMON SOLE":"Lemon Sole", LING:"Ling", LYTHE:"Pollack", MEGRIM:"Megrim", PLAICE:"European Plaice",
  MONKFISH:"Monkfish", SAITHE:"Saithe", SQUID:"Squid", TURBOT:"Turbot", TUSK:"Tusk", WHITING:"Whiting", WITCH:"Witch Flounder", BRILL:"Brill", ROE:"—" };

const DEFAULT_PD = {
  Cod:{A1:7.08,A2:7.26,A3:7.41}, Haddock:{A1:6.75,A2:6.98,A3:4.77,A4:2.42,A4c:2.50,A4m:2.50,A4ma:2.20},
  Whiting:{A2:4.08,A4r:2.10}, Catfish:{U9:2.06}, Ling:{A1:2.55,A2:2.55,A3:2.55},
  Coley:{A1:3.36,A2:3.10,A3:2.58,A4:2.50}, Monks:{A1:4.78,A2:5.00,A3:5.20,A4:4.60,A5:3.57},
  Lythe:{A1:6.25,A2:5.32,A4:4.45}, Lemons:{A2:10.80,A3:1.86}, Plaice:{A2:2.50,A4:0.75},
  Megrim:{A1:2.67,A2:1.33,A3:1.00,A4:0.90}, Hake:{A1:10.00,A2:8.33,A3:6.25,A4:4.74,A5:1.40},
  Turbot:{U9:11.55}, Halibut:{U9:9.27}, Witch:{U9:1.66}, Skate:{U9:2.25},
};
const DEFAULT_DK = {
  Squid:{"2":0.58,"9":0.58}, "Blue Ling":{"1":2.90,"2":2.90,"3":2.55,"9":1.39}, Tusk:{"2":3.91,"9":3.72},
  Megrim:{"2":7.14}, Catfishes:{"1":3.94,"2":4.17,"3":1.49},
  Monkfish:{"1":6.03,"2":5.76,"3":5.65,"4":5.47,"5":2.91},
  "Atlantic Halibut":{"0":11.02,"1":9.62,"2":8.60,"3":8.59,"4":8.67,"5":7.03,"9":8.70},
  Whiting:{"1":3.55,"2":2.32}, "Common Dab":{"1":1.16,"2":0.71}, "Norway Lobster":{"1":14.16,"2":8.23,"3":2.69},
  Haddock:{"1":6.52,"2":3.36,"3":2.12,"4":0.49,"9":0.73},
  "European Hake":{"0":8.72,"1":7.70,"2":6.12,"3":4.36,"4":1.61}, Ling:{"1":4.24,"2":4.11,"3":4.13},
  Pollack:{"2":9.72,"3":6.26,"4":5.20}, Mackerel:{"1":3.55,"2":3.15},
  Saithe:{"1":5.11,"2":5.65,"3":5.55,"4":3.83,"9":1.74},
  Turbot:{"0":23.21,"1":21.14,"2":16.93,"3":18.27,"4":13.09},
  "European Plaice":{"0":3.51,"1":3.30,"2":3.80,"3":2.64,"4":1.48,"9":0.93},
  "Lemon Sole":{"1":6.96,"2":5.80,"3":3.48}, "Greater Forkbeard":{"1":3.88,"2":3.27,"9":2.63},
  "Witch Flounder":{"1":6.61,"2":4.51,"3":1.62},
  "Atlantic Cod":{"0":8.64,"1":8.15,"2":7.79,"3":7.61,"4":6.26,"5":4.55},
};

const DEFAULT_TALLY = [
  ["CAT","1. Small (U9b)",12,488.3],["CAT","2. Large (U9a)",19,776.4],
  ["COD","1. Robbie (5b)",2,60.78],["COD","2. Baby (5a)",3,91.31],["COD","3. Big Baby (4)",7,212.66],["COD","4. Medium (3)",9,278.26],["COD","5. Sprag (2)",30,923.34],["COD","6. Large (1b)",11,331.45],["COD","7. X Large (1a)",2,62.25],
  ["HADDOCK","1. Mini Metro (4)",38,1537.31],["HADDOCK","2. Metro (3)",39,1575.73],["HADDOCK","3. Chipper (2b)",29,1176.3],["HADDOCK","4. Seed (2a)",19,773.33],["HADDOCK","5. Good Seed (1d)",20,816.18],["HADDOCK","6. Pinger (1c)",2,80.67],
  ["HAKE","2. X Small (4)",3,91.8],["HAKE","3. Small (3)",7,212.17],["HAKE","4. Selected (2)",33,1012.88],["HAKE","5. Medium (1c)",18,554.17],["HAKE","6. Large (1b)",8,246.25],["HAKE","7. X Large (1a)",1,30.44],
  ["HALIBUT","1. Small (U9b)",3,62.0],["HALIBUT","2. Large (U9a)",9,199.0],
  ["LEMON SOLE","1. Small (3)",1,30.5],["LEMON SOLE","2. Medium (2)",1,30.1],["LEMON SOLE","3. Large (1b)",4,123.8],
  ["LING","1. Small (3)",12,492.5],["LING","2. Medium (2)",22,901.8],["LING","3. Large (1)",57,2259.9],
  ["LYTHE","1. Small (4)",8,324.86],["LYTHE","2. Selected (3)",15,610.02],["LYTHE","3. Medium (2)",19,777.77],["LYTHE","4. Large (1)",23,937.44],
  ["MEGRIM","2. Small (3)",2,60.4],["MEGRIM","4. Medium (1b)",2,62.1],["MEGRIM","5. Large (1a)",5,155.0],
  ["MONKFISH","1. Frogs (5)",3,120.65],["MONKFISH","2. Small (4)",3,122.36],["MONKFISH","3. Selected (3)",11,452.49],["MONKFISH","4. Medium (2)",12,493.91],["MONKFISH","5. Large (1)",23,952.0],
  ["SAITHE","1. X Small (4b)",86,3482.12],["SAITHE","2. Small (4a)",73,2961.05],["SAITHE","3. Selected (3)",64,2608.42],["SAITHE","4. Medium (2)",20,816.38],["SAITHE","5. Large (1)",6,246.45],
  ["SQUID","2. Small (U9e)",10,252.45],["SQUID","3. Selected (U9d)",1,25.34],
  ["TURBOT","1. Small (U9b)",1,22.4],
  ["TUSK","1. Mix (U9a)",6,246.0],
  ["WHITING","1. Small Round (4)",2,80.97],["WHITING","2. Round (3)",25,1013.87],["WHITING","3. Small (2)",8,324.36],["WHITING","4. Medium (1b)",7,284.18],
].map((r,i)=>({id:i,sp:r[0],size:r[1],boxes:r[2],wt:r[3],avgBox:+(r[3]/r[2]).toFixed(1)}));

const fmtGBP=(n)=>n==null||isNaN(n)?"—":"£"+n.toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtKg=(n)=>n==null||isNaN(n)?"—":n.toLocaleString("en-GB",{maximumFractionDigits:1})+" kg";
const GRADE_LABEL = { A4c:"A4 Chipper", A4m:"A4 Metro", A4ma:"A4 Mini Metro", A4r:"A4 Round" };

// Haddock Metro pair — Mini Metro (A4ma) and Metro (A4m) come off ONE board row.
// The Peterhead price toggle has two states (hi=false AVG default, hi=true HIGH):
//   AVG : Mini = blend(low,avg)  ·  Metro = blend(avg,high)
//   HIGH: Mini = avg             ·  Metro = high
// The loader stores A4ma/A4m as the AVG-page values and A4m_av/A4m_hi as the
// HIGH-page values; this picks the right one (with a graceful fallback).
function metroPrice(o, gr, hi){
  if(!o) return undefined;
  if(gr==="A4ma") return hi ? (o.A4m_av!=null?o.A4m_av:o.A4ma) : (o.A4ma!=null?o.A4ma:o.A4m_av);
  if(gr==="A4m")  return hi ? (o.A4m_hi!=null?o.A4m_hi:o.A4m)  : (o.A4m!=null?o.A4m:o.A4m_hi);
  return undefined; // not a Metro grade
}
// Fallback box weight when a tally gives box counts but no weights (handwritten).
const DEFAULT_BOX_KG = 40;

const norm=(s)=>String(s||"").toUpperCase().replace(/^\d+\.?\s*/,"").replace(/\s*\([^)]*\)\s*$/,"").trim();

// Different boats label the same grade differently and often bake the species
// name into the label (e.g. "SML SAITHE", "LRG HADD", "SEL WHIT"). canonSize
// strips the species word and expands abbreviations to the canonical size
// tokens used in GRADE_DICT (SMALL, MEDIUM, LARGE, SELECTED, X SMALL, ...).
const canonSize=(rawSize,sp)=>{
  let t=norm(rawSize);
  // explicit multi-word forms first (before species-word stripping)
  const pre={"ROUND WH":"ROUND","SEL ROUND":"SMALL ROUND","SML ROUND":"SMALL ROUND","EXTRA SMALL":"X SMALL","XL LRG":"XL","BIG SMALL":"BIG BABY","MINI METRO":"MINI METRO","BOBBY DAZLER":"COD","BOBBY DAZZLER":"COD","GOOD SEED":"GOOD SEED"};
  if(pre[t])return pre[t];
  // drop a trailing species word so "SML SAITHE" -> "SML", "LRG HADD" -> "LRG"
  const spWords=["SAITHE","HADDOCK","HADD","WHITING","WHIT","MONKFISH","MONK","HAKE","SQUID","PLAICE","LEMON","MEGS","MEGRIM","LING","LYTHE","POLLACK","COD"];
  for(const w of spWords){const re=new RegExp("\\s*"+w+"\\s*$");if(re.test(t)){t=t.replace(re,"").trim();break;}}
  // expand common abbreviations
  const map={
    "LRG":"LARGE","LGE":"LARGE","LG":"LARGE",
    "SML":"SMALL","SM":"SMALL",
    "MED":"MEDIUM","MD":"MEDIUM",
    "SEL":"SELECTED","SELECT":"SELECTED",
    "XS":"X SMALL","X S":"X SMALL","XSML":"X SMALL",
    "X LARGE":"XL","XLRG":"XL","XL LRG":"XL",
    "RND":"ROUND","ROBBY":"ROBBIE",
  };
  if(map[t])t=map[t];
  return t;
};

// Species-name normaliser: different boats name the same species differently
// (CATFISH/CATFISHES -> CAT, POLLACK -> LYTHE, COLEY -> SAITHE, etc.). Maps an
// incoming boat species name to the app's canonical species key.
const canonSp=(raw)=>{
  let s=String(raw||"").toUpperCase().replace(/\([^)]*\)/g,"").trim();
  const A={
    "CATFISH":"CAT","CATFISHES":"CAT","CATS":"CAT","CAT":"CAT","WOLF FISH":"CAT","WOLFFISH":"CAT",
    "POLLACK":"LYTHE","POLLOCK":"LYTHE","LYTHE":"LYTHE","LYTHE/POLLACK":"LYTHE",
    "COLEY":"SAITHE","SAITHE":"SAITHE","COLES":"SAITHE",
    "MONKFISH":"MONKFISH","MONKS":"MONKFISH","MONK":"MONKFISH","ANGLER":"MONKFISH",
    "MEGRIM":"MEGRIM","MEGRIMS":"MEGRIM","MEGS":"MEGRIM","MEG":"MEGRIM",
    "LEMON SOLE":"LEMON SOLE","LEMONS":"LEMON SOLE","LEMON":"LEMON SOLE","LEMON SOLES":"LEMON SOLE",
    "WHITING":"WHITING","WHIT":"WHITING",
    "HADDOCK":"HADDOCK","HADD":"HADDOCK","HAD":"HADDOCK",
    "HAKE":"HAKE","COD":"COD","LING":"LING","PLAICE":"PLAICE","HALIBUT":"HALIBUT",
    "TURBOT":"TURBOT","BRILL":"BRILL","WITCH":"WITCH","WITCHES":"WITCH","WITCH FLOUNDER":"WITCH",
    "TUSK":"TUSK","SQUID":"SQUID","ROE":"ROE","RANS":"ROE","ROES":"ROE","FISH ROE":"ROE",
  };
  if(A[s])return A[s];
  // try stripping a trailing plural 'S' (e.g. "MONKS" handled above; generic safety)
  if(A[s.replace(/S$/,"")])return A[s.replace(/S$/,"")];
  return s; // unknown -> leave as-is (will show "no price" rather than mis-price)
};


// Extract the bracket code, e.g. "1. Robbie (5b)" -> "5B". This is the TRUE grade;
// the leading number before the name is just the scales touchscreen button position.
const bracket=(s)=>{const m=String(s||"").match(/\(([^)]*)\)\s*$/);return m?m[1].toUpperCase().trim():"";};

// Per-species bracket-code -> mapping. Currently Haddock only (per user).
// Haddock A4 has THREE named PD prices, so we use distinct pd keys: A4c=Chipper, A4m=Metro(high), A4ma=Metro(avg).
const BRACKET_DICT = {
  COD:{
    "5B":{pd:"A5",dk:"5",c:"high"},
    "5A":{pd:"A5",dk:"5",c:"high"},
    "4":{pd:"A4",dk:"4",c:"high"},
    "3":{pd:"A3",dk:"3",c:"high"},
    "2":{pd:"A2",dk:"2",c:"high"},
    "1B":{pd:"A1",dk:"1",c:"high"},
    "1A":{pd:"A1",dk:"0",c:"med"},   // 1a = top end -> DK Sort 0 (above grade)
  },
  HADDOCK:{
    "1A":{pd:"A1",dk:"1",c:"high"},
    "1B":{pd:"A1",dk:"1",c:"high"},
    "1C":{pd:"A1",dk:"1",c:"high"},   // Pinger
    "1D":{pd:"A2",dk:"1",c:"high"},   // Good Seed
    "2A":{pd:"A3",dk:"2",c:"high"},   // Seed
    "2B":{pd:"A4c",dk:"2",c:"high"},  // Chipper -> A4 Chipper price
    "3":{pd:"A4m",dk:"3",c:"high"},   // Metro -> A4 Metro HIGH column
    "4":{pd:"A4ma",dk:"3",c:"high"},  // Mini Metro -> A4 Metro AVE column
  },
};

function buildMapping(tally){
  // For species landed as one undifferentiated line (size label == species name,
  // e.g. pair sheet "CATS","HALIBUT","TUSK"), fall back to a sensible single grade.
  const SINGLE={ CAT:{pd:"U9",dk:"2",c:"low"}, HALIBUT:{pd:"U9",dk:"1",c:"low"}, TURBOT:{pd:"U9",dk:"2",c:"low"},
    WITCH:{pd:"U9",dk:"2",c:"low"}, TUSK:{pd:"U9",dk:"1",c:"low"}, LING:{pd:"A2",dk:"2",c:"low"},
    SQUID:{pd:"U9",dk:"2",c:"low"}, BRILL:{pd:"U9",dk:"—",c:"low"} };
  return tally.map((r)=>{
    const code=bracket(r.size);
    // Prefer per-species bracket-code mapping when available
    const bd=BRACKET_DICT[r.sp]&&code&&BRACKET_DICT[r.sp][code];
    if(bd) return { pdSp:SP_TO_PD[r.sp]||"—", pdGr:bd.pd, dkSp:SP_TO_DK[r.sp]||"—", dkSort:bd.dk, conf:bd.c };
    // Fallback: name-based mapping, with boat-synonym normalisation
    const tok=GRADE_DICT[r.sp]&&GRADE_DICT[r.sp][norm(r.size)]?norm(r.size):canonSize(r.size,r.sp);
    let d=GRADE_DICT[r.sp]&&GRADE_DICT[r.sp][tok];
    // Single-line species (size label is basically the species itself)
    if(!d&&SINGLE[r.sp]&&(norm(r.size)===r.sp||norm(r.size)===norm(SP_TO_PD[r.sp]||"")||/^(MIX|MIXED|UNSORTED|U\/R)$/.test(tok)||norm(r.size).includes(r.sp))) d=SINGLE[r.sp];
    if(!d) d={pd:"—",dk:"—",c:"low"};
    return { pdSp:SP_TO_PD[r.sp]||"—", pdGr:d.pd, dkSp:SP_TO_DK[r.sp]||"—", dkSort:d.dk, conf:d.c };
  });
}

/* ---- Nett layer: selling costs per market (all editable, persisted) ---- */
const NETT_KEY = "estimator_nett_v1";
const NETT_DEFAULT = {
  pd: { auctionPct: 2.5, agentPct: 3.0, labourMen: 6, labourRate: 0.15, consigned: false, portPct: 2.0, truckCost: 1000, truckCap: 450, otherFixed: 0 },
  dk: { pct: 7.5, boxLevy: 1.0, otherFixed: 0 },
};
function loadNett(){ try{ const v=JSON.parse(localStorage.getItem(NETT_KEY)); if(v&&v.pd&&v.dk) return {pd:{...NETT_DEFAULT.pd,...v.pd},dk:{...NETT_DEFAULT.dk,...v.dk}}; }catch{} return NETT_DEFAULT; }

export default function Estimator(){
  const [step,setStep]=useState(0);
  const [pd,setPd]=useState({});
  const [dk,setDk]=useState({});
  const [tally,setTally]=useState([]);
  const [map,setMap]=useState([]);
  const [tallyMode,setTallyMode]=useState("weight");
  const [fillMissing,setFillMissing]=useState(true);
  const [pdHigh,setPdHigh]=useState(false); // false = AVE (default), true = all PD grades use HIGH column
  // Manual per-grade price overrides set on the Check-mapping step (bump up/down for the next day's market).
  // Keyed by `${market}|${species}|${grade}` e.g. "pd|Haddock|A4m". Survives a board reload; clearable.
  const [priceOv,setPriceOv]=useState({});
  const [busy,setBusy]=useState({pd:false,dk:false,boat:false});
  const [nettCfg,setNettCfg]=useState(loadNett);
  const [boxesOverride,setBoxesOverride]=useState("");
  const [boardMsg,setBoardMsg]=useState("Loading latest board prices…");
  useEffect(()=>{try{localStorage.setItem(NETT_KEY,JSON.stringify(nettCfg));}catch{}},[nettCfg]);

  // Pull the 2 latest days per market from the Daily Prices board and feed them
  // straight into the PD/DK price grids — no price-sheet upload needed. Manual
  // upload/edit still works as a fallback for anything the board doesn't carry.
  async function loadBoardPrices(){
    setBoardMsg("Loading latest board prices…");
    try{
      const grab=async(src)=>{
        const {data:days}=await supabase.from("market_days").select("price_date").eq("source",src).order("price_date",{ascending:false}).limit(2);
        const dates=(days||[]).map(d=>d.price_date);
        if(!dates.length) return {dates:[],rows:[]};
        const {data:rows}=await supabase.from("market_prices").select("species,grade,subgrade,low,high,ave").eq("source",src).in("price_date",dates);
        return {dates,rows:rows||[]};
      };
      const [pdR,dkR]=await Promise.all([grab("PD"),grab("DK")]);
      const {pd:pdObj,dk:dkObj,missing}=buildEstimatorPrices(pdR.rows,dkR.rows);
      if(Object.keys(pdObj).length) setPd(pdObj);
      if(Object.keys(dkObj).length) setDk(dkObj);
      if(!pdR.dates.length && !dkR.dates.length){
        setBoardMsg("No board prices yet — upload price sheets under Daily Prices, or enter prices by hand below.");
      }else{
        setBoardMsg(`Board prices loaded — Peterhead ${pdR.dates[0]||"—"}, Hanstholm ${dkR.dates[0]||"—"} (2 latest days, averaged).${missing.length?" Not on the board: "+missing.join(", ")+" — add by hand if you landed them.":""}`);
      }
    }catch(e){ setBoardMsg(`Couldn't load board prices (${e.message}). Enter prices by hand, or check Daily Prices.`); }
  }
  useEffect(()=>{ loadBoardPrices(); },[]);

  const [msg,setMsg]=useState({pd:"",dk:"",boat:"Upload your boat tally (xlsx / CSV / PDF) to begin — prices come from the Daily Prices board automatically."});

  const effW=(r)=>tallyMode==="boxes"?r.boxes*r.avgBox:r.wt;

  // --- Robust price resolution -------------------------------------------
  // 1) Find the species object even if the parser named it slightly
  //    differently (e.g. "Monk"/"Monkfish" vs "Monks", "Lemon" vs "Lemons").
  // 2) If the exact grade has no price, step to the NEAREST grade on the SAME
  //    market (lower grade first, then higher).
  // 3) Returning 0 means "this species isn't on this market at all" — the
  //    caller then borrows the other market's price.
  const findSpeciesObj=(obj,name)=>{
    if(!name||name==="—")return null;
    if(obj[name])return obj[name];
    const keys=Object.keys(obj);
    const n=String(name).toLowerCase().replace(/[^a-z]/g,"");
    // exact normalised
    let k=keys.find((x)=>x.toLowerCase().replace(/[^a-z]/g,"")===n);
    // shared stem: longest common prefix is a big chunk of the shorter word
    if(!k)k=keys.find((x)=>{
      const xn=x.toLowerCase().replace(/[^a-z]/g,"");
      let i=0;while(i<n.length&&i<xn.length&&n[i]===xn[i])i++;
      return i>=4&&i>=Math.min(n.length,xn.length)-2; // e.g. monk|s vs monk|fish, lemon vs lemon|s
    });
    return k?obj[k]:null;
  };
  // grade order helpers — A-grades A1(big)..A5(small); DK sorts 0(above)..9(ungraded)
  const pdLadder=["A1","A2","A3","A4","A5","U9"];
  const dkLadder=["0","1","2","3","4","5","9"];
  const stepGrade=(spObj,grade,ladder,prefMid)=>{
    // "Mid" mode: for a plain grade (no explicit (low)/(high)), value at the
    // midpoint of AVE and HIGH — (avg+high)/2 — which is more realistic than
    // assuming the top price across the whole catch. Falls back to AVE alone
    // when no HIGH was captured (then avg+high/2 == avg anyway).
    const midOf=(aveKey,hiKey)=>{
      const a=spObj[aveKey], h=spObj[hiKey];
      if(a!=null&&h!=null)return +((a+h)/2);
      return a!=null?a:(h!=null?h:null);
    };
    if(prefMid&&!/\((low|high)\)\s*$/.test(String(grade))){
      if(spObj[grade]!=null||spObj[grade+" (high)"]!=null){
        const m=midOf(grade,grade+" (high)");
        if(m!=null)return {price:m,exact:true,via:grade};
      }
    }
    if(spObj[grade]!=null)return {price:spObj[grade],exact:true,via:grade};
    const base=String(grade).replace(/\s*\((low|high)\)\s*$/,"");
    if(prefMid&&(spObj[base]!=null||spObj[base+" (high)"]!=null)){
      const m=midOf(base,base+" (high)");
      if(m!=null)return {price:m,exact:false,via:base};
    }
    if(spObj[base]!=null)return {price:spObj[base],exact:false,via:base};
    // Haddock/Whiting A4 sub-grades (A4ma=Metro avg, A4m=Metro high, A4c=Chipper,
    // A4r=Round) are NOT on the A1..A5 ladder. If their own price is missing, fall
    // back ONLY within the A4 family — never step up the ladder to A1, which
    // massively over-values the catch. If no A4 price exists on this market,
    // return null so the caller borrows the other market instead.
    const A4_FALLBACK={A4ma:["A4ma","A4"],A4m:["A4m","A4"],A4c:["A4c","A4"],A4r:["A4r","A4"]};
    if(A4_FALLBACK[base]){
      for(const g of A4_FALLBACK[base]){ if(spObj[g]!=null)return {price:spObj[g],exact:false,via:g}; }
      return null;
    }
    let idx=ladder.indexOf(base);
    if(idx>=0){
      for(let d=1;d<ladder.length;d++){
        const lo=ladder[idx+d];        // lower grade (cheaper) first
        if(lo&&spObj[lo]!=null)return {price:spObj[lo],exact:false,via:lo};
        const hi=ladder[idx-d];        // then higher grade
        if(hi&&spObj[hi]!=null)return {price:spObj[hi],exact:false,via:hi};
      }
    }
    // last resort: any priced grade in this species
    const ek=Object.keys(spObj).find((k)=>spObj[k]!=null);
    if(ek)return {price:spObj[ek],exact:false,via:ek};
    return null;
  };
  // Returns {price, exact, via} or null when species absent from this market.
  const resolvePD=(sp,gr)=>{
    const o=findSpeciesObj(pd,sp); if(!o) return null;
    if(gr==="A4ma"||gr==="A4m"){ const p=metroPrice(o,gr,pdHigh); if(p!=null) return {price:p,exact:true,via:gr}; }
    return stepGrade(o,gr,pdLadder,pdHigh);
  };
  const resolveDK=(sp,so)=>{const o=findSpeciesObj(dk,sp);return o?stepGrade(o,so,dkLadder,false):null;};

  // Back-compat plain-number helpers (0 = not found on this market)
  const pdPrice=(sp,gr)=>{const r=resolvePD(sp,gr);return r?r.price:0;};
  const dkPrice=(sp,so)=>{const r=resolveDK(sp,so);return r?r.price:0;};

  const rows=useMemo(()=>tally.map((r,i)=>{
    const m=map[i]||{}; const w=effW(r);
    const pr=resolvePD(m.pdSp,m.pdGr), dr=resolveDK(m.dkSp,m.dkSort);
    // manual overrides (Check-mapping editor) win over the board price for that grade
    const povRaw=priceOv[`pd|${m.pdSp}|${m.pdGr}`], dovRaw=priceOv[`dk|${m.dkSp}|${m.dkSort}`];
    const hasPov=povRaw!=null&&povRaw!==""&&!isNaN(povRaw);
    const hasDov=dovRaw!=null&&dovRaw!==""&&!isNaN(dovRaw);
    // base prices: override, else same-market value (exact or nearest grade), else 0
    let pu=hasPov?+povRaw:(pr?pr.price:0), du=hasDov?+dovRaw:(dr?dr.price:0);
    const pHas=hasPov||!!pr, dHas=hasDov||!!dr;
    let note="";const notes=[];
    if(hasPov)notes.push("PD edited"); else if(pr&&!pr.exact)notes.push(`PD grade ${pr.via}`);   // same-market step
    if(hasDov)notes.push("DK edited"); else if(dr&&!dr.exact)notes.push(`DK sort ${dr.via}`);
    if(fillMissing){
      // Only borrow the OTHER market when this species has no price here (no board price and no override)
      if(!pHas&&!dHas){note="No price either market";}
      else if(!pHas){pu=du;notes.push("PD ← Hanstholm");}
      else if(!dHas){du=pu;notes.push("DK ← Peterhead");}
    }
    if(!note)note=notes.join(" · ");
    return {...r,m,w,pdPrice:pu,dkPrice:du,pdTotal:w*pu,dkTotal:w*du,diff:w*du-w*pu,note,
            pdExact:hasPov||(pr?pr.exact:false),dkExact:hasDov||(dr?dr.exact:false),pdHas:pHas,dkHas:dHas};
  }),[tally,map,pd,dk,tallyMode,fillMissing,pdHigh,priceOv]);

  const totals=useMemo(()=>{const t=rows.reduce((a,r)=>({w:a.w+r.w,pd:a.pd+r.pdTotal,dk:a.dk+r.dkTotal}),{w:0,pd:0,dk:0});return{...t,diff:t.dk-t.pd};},[rows]);
  const summary=useMemo(()=>{const m={};rows.forEach((r)=>{if(!m[r.sp])m[r.sp]={sp:r.sp,w:0,pd:0,dk:0};m[r.sp].w+=r.w;m[r.sp].pd+=r.pdTotal;m[r.sp].dk+=r.dkTotal;});return Object.values(m).map((s)=>({...s,diff:s.dk-s.pd}));},[rows]);

  const tallyBoxes=useMemo(()=>tally.reduce((a,r)=>a+(+r.boxes||0),0),[tally]);
  const nett=useMemo(()=>{
    const boxes=boxesOverride===""?tallyBoxes:(+boxesOverride||0);
    const p=nettCfg.pd,d=nettCfg.dk;
    const pdPct=(+p.auctionPct||0)+(+p.agentPct||0)+(p.consigned?(+p.portPct||0):0);
    const pdPctCost=totals.pd*pdPct/100;
    const pdLabour=(+p.labourMen||0)*(+p.labourRate||0)*boxes;
    const pdTruck=p.consigned&&(+p.truckCap||0)>0&&boxes>0?Math.ceil(boxes/(+p.truckCap))*(+p.truckCost||0):0;
    const pdOther=+p.otherFixed||0;
    const pdNett=totals.pd-pdPctCost-pdLabour-pdTruck-pdOther;
    const dkPctCost=totals.dk*(+d.pct||0)/100;
    const dkLevy=(+d.boxLevy||0)*boxes;
    const dkOther=+d.otherFixed||0;
    const dkNett=totals.dk-dkPctCost-dkLevy-dkOther;
    return {boxes,pdPct,pdPctCost,pdLabour,pdTruck,pdOther,pdNett,dkPct:+d.pct||0,dkPctCost,dkLevy,dkOther,dkNett,diff:dkNett-pdNett};
  },[totals,tallyBoxes,boxesOverride,nettCfg]);

  const fileToB64=(f)=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);});
  const fileToText=(f)=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsText(f);});
  const fileToBuf=(f)=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsArrayBuffer(f);});

  // Parse boat xlsx: rows are [Species, Size, Boxes, Weight]. Species header has '*' in Size col;
  // size sub-rows have blank Species; 'Total' row ends it. Weight may carry a 'kg' suffix.
  function parseBoatRows(rows){
    const out=[];let curSp=null;
    const numOf=(v)=>{if(v==null)return 0;const m=String(v).replace(/[^0-9.\-]/g,"");return +m||0;};
    rows.forEach((cells)=>{
      if(!cells||!cells.length)return;
      const first=(cells[0]==null?"":String(cells[0])).trim();
      const second=(cells[1]==null?"":String(cells[1])).trim();
      if(first&&/^[A-Z][A-Z \/]+$/.test(first)&&(second==="*"||second===""))  {curSp=first;return;}
      if(/^total$/i.test(first))return;
      if(!first&&curSp&&second){
        const boxes=numOf(cells[2]);const wt=numOf(cells[3]);
        if(wt)out.push({sp:curSp,size:second,boxes,wt});
      }
    });
    return out;
  }

  async function parsePrice(file,which){
    setBusy((b)=>({...b,[which]:true}));setMsg((m)=>({...m,[which]:"Reading…"}));
    try{
      const b64=await fileToB64(file);const mt=file.type||"image/png";
      const prompt=which==="pd"
        ?`Peterhead fish market sheet with three price columns LOW, HIGH, AVE (GBP). For EVERY priced row, extract the species, the grade (A1..A5 or U9), and ALL THREE prices. Respond with ONLY a JSON object, no explanation, no markdown. For each grade output the AVE under the grade key, plus two extra keys "<grade> (low)" = LOW and "<grade> (high)" = HIGH. Example {"Cod":{"A1":6.85,"A1 (low)":6.05,"A1 (high)":8.48}}. Skip rows where all three cells are blank. NAMING RULES (use these exact species names): the row "Lythe/Pollack" -> "Lythe"; the row "Megrims" -> "Megrim"; the row "Round Whiting" -> add to "Whiting" as keys "A4r"=AVE, "A4r (low)"=LOW, "A4r (high)"=HIGH; for squid use ONLY the "Squid Trawl" row, name it "Squid" and put its prices under grade "U9" (ignore Fresh/Rockall squid rows). SPECIAL CASE Haddock A4 has three rows Chipper/Metro/Round: also output keys "A4c"=Chipper AVE, "A4m"=Metro HIGH, "A4ma"=Metro AVE, "A4"=Chipper AVE (keep the (low)/(high) keys for A1..A3 etc as normal).`
        :`Hanstholm Danish auction sheet. Extract species + sort number (0,1,2,3,4,5,9) and the Avg. price (the second price on each row; the first is Max). Respond with ONLY a JSON object, no explanation, no markdown. Shape: {"Species":{"1":5.17}}. Sorts are strings. Keep names like "Atlantic Cod","European Hake".`;
      const resp=await fetch("/.netlify/functions/parse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({media:b64,mediaType:mt,prompt})});
      const data=await resp.json();
      if(!resp.ok){throw new Error((data&&data.error)||`server ${resp.status}`);}
      let t=data.text||"";
      if(!t||!t.trim()){throw new Error("empty reply");}
      // Robust: pull the JSON object from the first { to the last }
      const a=t.indexOf("{"),z=t.lastIndexOf("}");
      if(a<0||z<0||z<=a){throw new Error("no JSON found");}
      const jsonStr=t.slice(a,z+1);
      const parsed=JSON.parse(jsonStr);
      if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||!Object.keys(parsed).length){throw new Error("no species parsed");}
      if(which==="pd"&&parsed.Haddock){const h=parsed.Haddock;if(h.A4!=null){if(h.A4c==null)h.A4c=h.A4;if(h.A4m==null)h.A4m=h.A4;if(h.A4ma==null)h.A4ma=h.A4;}}
      if(which==="pd")setPd(parsed);else setDk(parsed);
      setMsg((m)=>({...m,[which]:`Parsed ${Object.keys(parsed).length} species — review & correct below.`}));
    }catch(e){setMsg((m)=>({...m,[which]:`Auto-parse failed (${e.message}). Your current prices are kept — edit by hand, or try a clearer photo / the PDF.`}));}
    finally{setBusy((b)=>({...b,[which]:false}));}
  }

  function parseBoatText(txt){
    const out=[];let curSp=null;
    txt.split(/\r?\n/).forEach((line)=>{
      const cells=line.split(/[\t,]/).map((c)=>c.trim().replace(/^"|"$/g,""));
      if(cells.length<2)return;
      const first=cells[0];
      if(first&&first===first.toUpperCase()&&/[A-Z]/.test(first)&&cells[1]==="*"){curSp=first;return;}
      if(/^total$/i.test(first))return;
      if(!first&&curSp){
        const size=cells[1];const boxes=+cells[2]||0;const wt=+cells[3]||0;
        if(size&&wt)out.push({sp:curSp,size,boxes,wt});
      }
    });
    return out;
  }

  // Ask the AI parser for a clean tally array. Either pass {b64,mediaType} for a
  // PDF/image, or {text} for spreadsheet rows the browser already read.
  async function aiBoatRows({b64,mediaType,text}){
    const prompt=`This is a fishing boat catch tally / landings report. It may be printed OR HANDWRITTEN, and laid out in any style (one boat, several boats side by side, or a simple handwritten column of species with grades and box counts). Extract ONE row per individual size/grade line. For each, give: species (CAPS), the size/grade label exactly as printed, number of boxes, and weight in kg. RULES: Skip species sub-total rows (e.g. "TOTAL", "GH TOTAL", "TOTAL HAD"), the grand total, blank rows, discards/bait/mix rows, and any "haul/discards" section. If the sheet shows several boats with a combined column, use the COMBINED total boxes & kg (not one single boat). If a line has weight but no box count, set boxes to 0. If a line has a box count but NO weight (common on handwritten tallies), set wt to 0 — do NOT invent a weight. Grade labels may be written as a number+name like "4 METRO", "3 CHIPPER", "5 ROBBY", "2 GOOD SEED" — keep the full label as printed. Numbers may use a comma as the decimal separator (e.g. "687,85" means 687.85) and a dot or space as a thousands separator (e.g. "2.534,83" or "2 534,83" means 2534.83) — convert to a plain number. Respond with ONLY a JSON array, no explanation, no markdown: [{"sp":"COD","size":"Sprag","boxes":19,"wt":687.85}].`;
    const body=b64?{media:b64,mediaType,prompt}:{text,prompt};
    const resp=await fetch("/.netlify/functions/parse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const data=await resp.json();
    if(!resp.ok){throw new Error((data&&data.error)||`server ${resp.status}`);}
    let t=data.text||"";
    const a=t.indexOf("["),z=t.lastIndexOf("]");
    if(a<0||z<0||z<=a){throw new Error("no JSON array found");}
    return JSON.parse(t.slice(a,z+1)).map((r)=>({sp:String(r.sp||"").toUpperCase(),size:String(r.size||""),boxes:+r.boxes||0,wt:+r.wt||0})).filter((r)=>r.sp&&(r.wt||r.boxes));
  }

  async function parseBoat(file){
    setBusy((b)=>({...b,boat:true}));setMsg((m)=>({...m,boat:"Reading boat file…"}));
    try{
      const name=(file.name||"").toLowerCase();let parsed=[];let usedAI=false;
      if(name.endsWith(".csv")||name.endsWith(".tsv")||name.endsWith(".txt")){
        parsed=parseBoatText(await fileToText(file));
        if(!parsed.length){usedAI=true;parsed=await aiBoatRows({text:await fileToText(file)});}
      }else if(name.endsWith(".pdf")){
        usedAI=true;
        parsed=await aiBoatRows({b64:await fileToB64(file),mediaType:"application/pdf"});
      }else if(/\.(jpe?g|png|webp|heic|heif)$/i.test(name)||(file.type||"").startsWith("image/")){
        usedAI=true;
        const mt=(file.type&&file.type.startsWith("image/"))?file.type:"image/jpeg";
        parsed=await aiBoatRows({b64:await fileToB64(file),mediaType:mt});
      }else if(name.endsWith(".xlsx")||name.endsWith(".xls")||name.endsWith(".xlsm")){
        const buf=await fileToBuf(file);
        const wb=XLSX.read(buf,{type:"array"});
        // Fast-path: try MY format on every sheet (prefer one named TOTALS).
        const order=[...wb.SheetNames].sort((a,b)=>(/total/i.test(b)?1:0)-(/total/i.test(a)?1:0));
        for(const sn of order){
          const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,blankrows:false,defval:""});
          const got=parseBoatRows(rows);
          if(got.length){parsed=got;break;}
        }
        // Fallback: hand the most likely sheet to the AI as text.
        if(!parsed.length){
          usedAI=true;
          const sn=order[0];
          const csv=XLSX.utils.sheet_to_csv(wb.Sheets[sn]);
          parsed=await aiBoatRows({text:`Sheet "${sn}":\n`+csv});
        }
      }else{
        setMsg((m)=>({...m,boat:"Unsupported file. Upload a boat .xlsx/.xls, a CSV, or the boat PDF."}));
        setBusy((b)=>({...b,boat:false}));return;
      }
      if(!parsed.length)throw new Error("no rows found");
      const boxOnly=parsed.some((r)=>r.boxes>0&&!(r.wt>0));
      const t=parsed.map((r,i)=>({id:i,sp:canonSp(r.sp),size:r.size,boxes:r.boxes,wt:r.wt,avgBox:r.boxes?(r.wt>0?+(r.wt/r.boxes).toFixed(1):DEFAULT_BOX_KG):0}));
      setTally(t);setMap(buildMapping(t));
      if(boxOnly)setTallyMode("boxes");
      setMsg((m)=>({...m,boat:`Loaded ${t.length} size lines across ${new Set(t.map((x)=>x.sp)).size} species${usedAI?" (read by AI — check carefully)":""}.${boxOnly?` Box-only tally — box weights set to ${DEFAULT_BOX_KG}kg, adjust per row.`:""} Mapping auto-built — check step 4.`}));
    }catch(e){setMsg((m)=>({...m,boat:`Couldn't read boat file (${e.message}). Sample tally still loaded.`}));}
    finally{setBusy((b)=>({...b,boat:false}));}
  }

  function exportPDF(){
    const doc=new jsPDF({unit:"pt",format:"a4"});
    const W=doc.internal.pageSize.getWidth();
    const M=40; let y=46;
    const PDc=[74,158,255], DKc=[255,122,69], ink=[20,28,36], dim=[120,130,140];
    const money=(n)=>"£"+(n||0).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2});
    const dateStr=new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});

    // Header
    doc.setFont("helvetica","bold");doc.setFontSize(18);doc.setTextColor(...ink);
    doc.text("Trip Gross Estimate",M,y);
    doc.setFont("helvetica","normal");doc.setFontSize(10.5);doc.setTextColor(...dim);
    doc.text("AUDACIOUS BF83",M,y+16);
    doc.text(`Generated ${dateStr}  ·  ${totals.w.toLocaleString("en-GB",{maximumFractionDigits:0})} kg landed`,M,y+30);
    y+=52;

    // Headline boxes
    const winner=totals.diff>=0?"HANSTHOLM":"PETERHEAD";
    const wc=totals.diff>=0?DKc:PDc;
    const bw=(W-2*M-16)/3;
    const box=(x,label,val,col)=>{
      doc.setDrawColor(225);doc.setFillColor(248,249,250);doc.roundedRect(x,y,bw,56,5,5,"FD");
      doc.setFontSize(8.5);doc.setTextColor(...dim);doc.setFont("helvetica","bold");
      doc.text(label.toUpperCase(),x+12,y+18);
      doc.setFontSize(15);doc.setTextColor(...col);doc.text(val,x+12,y+40);
    };
    box(M,"Peterhead gross",money(totals.pd),PDc);
    box(M+bw+8,"Hanstholm gross",money(totals.dk),DKc);
    box(M+2*bw+16,`${winner} better by`,(totals.diff>=0?"+":"")+money(Math.abs(totals.diff)),wc);
    y+=72;

    // Nett headline + cost breakdown
    const nWin=nett.diff>=0?"HANSTHOLM":"PETERHEAD"; const nwc2=nett.diff>=0?DKc:PDc;
    box(M,"Peterhead nett",money(nett.pdNett),PDc);
    box(M+bw+8,"Hanstholm nett",money(nett.dkNett),DKc);
    box(M+2*bw+16,`${nWin} better by (nett)`,(nett.diff>=0?"+":"")+money(Math.abs(nett.diff)),nwc2);
    y+=72;
    autoTable(doc,{
      startY:y, margin:{left:M,right:M},
      head:[["Selling costs",`Peterhead`,`Hanstholm`]],
      body:[
        ["% of gross",`${nett.pdPct.toFixed(2)}%  =  ${money(nett.pdPctCost)}`,`${nett.dkPct.toFixed(2)}%  =  ${money(nett.dkPctCost)}`],
        ["Per box",`labour ${money(nett.pdLabour)}`,`levy ${money(nett.dkLevy)}`],
        ...(nett.pdTruck>0?[["Trucking",money(nett.pdTruck),"—"]]:[]),
        ...((nett.pdOther>0||nett.dkOther>0)?[["Other",money(nett.pdOther),money(nett.dkOther)]]:[]),
        ["Boxes costed",String(nett.boxes),String(nett.boxes)],
      ],
      styles:{font:"helvetica",fontSize:8.5,cellPadding:3},
      headStyles:{fillColor:ink,textColor:255,fontSize:8.5},
    });
    y=doc.lastAutoTable.finalY+22;

    // By-species table
    autoTable(doc,{
      startY:y, margin:{left:M,right:M},
      head:[["Species","kg","Peterhead","Hanstholm","Difference","Better"]],
      body:summary.map((s)=>[s.sp,s.w.toFixed(0),money(s.pd),money(s.dk),(s.diff>=0?"+":"")+money(s.diff),Math.abs(s.diff)<0.01?"tie":s.diff>0?"Hanstholm":"Peterhead"]),
      foot:[["TOTAL",totals.w.toFixed(0),money(totals.pd),money(totals.dk),(totals.diff>=0?"+":"")+money(totals.diff),winner.charAt(0)+winner.slice(1).toLowerCase()]],
      styles:{font:"helvetica",fontSize:9,cellPadding:4},
      headStyles:{fillColor:ink,textColor:255,fontSize:8.5},
      footStyles:{fillColor:[240,242,245],textColor:ink,fontStyle:"bold"},
      columnStyles:{1:{halign:"right"},2:{halign:"right"},3:{halign:"right"},4:{halign:"right"}},
      didParseCell:(d)=>{ if(d.section==="body"&&(d.column.index===4||d.column.index===5)){const s=summary[d.row.index];if(s&&Math.abs(s.diff)>=0.01)d.cell.styles.textColor=s.diff>0?DKc:PDc;} },
    });
    y=doc.lastAutoTable.finalY+22;

    // Per-line detail table
    doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(...ink);
    doc.text("Detail — every line",M,y);y+=8;
    autoTable(doc,{
      startY:y, margin:{left:M,right:M},
      head:[["Species","Size","kg","PD gr","PD £/kg","PD total","DK sort","DK £/kg","DK total","Note"]],
      body:rows.map((r)=>[r.sp,r.size,r.w.toFixed(0),r.m.pdGr,(r.pdPrice||0).toFixed(2),money(r.pdTotal),r.m.dkSort,(r.dkPrice||0).toFixed(2),money(r.dkTotal),r.note||""]),
      styles:{font:"helvetica",fontSize:7.5,cellPadding:2.5,overflow:"linebreak"},
      headStyles:{fillColor:ink,textColor:255,fontSize:7.5},
      columnStyles:{2:{halign:"right"},4:{halign:"right"},5:{halign:"right"},7:{halign:"right"},8:{halign:"right"},9:{textColor:dim,fontSize:6.8}},
    });
    y=doc.lastAutoTable.finalY+18;

    if(y>770){doc.addPage();y=46;}
    doc.setFont("helvetica","italic");doc.setFontSize(8);doc.setTextColor(...dim);
    doc.text("Estimate only — based on the prices and mappings entered. Amber/substituted lines used the other market's price where one market had no price. Not a settlement.",M,y,{maxWidth:W-2*M});

    doc.save(`trip_gross_${new Date().toISOString().slice(0,10)}.pdf`);
  }

  const STEPS=["Boat tally","Peterhead prices","Hanstholm prices","Check mapping","Estimated gross"];
  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.ink,fontFamily:FONT,paddingBottom:80}}>
      <style>{`
        *{box-sizing:border-box} input,select{font-family:${MONO}}
        table{border-collapse:collapse;width:100%}
        th,td{padding:7px 10px;border-bottom:1px solid ${C.line};text-align:left;font-size:13px}
        th{color:${C.dim};font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
        td.r,th.r{text-align:right}
        .ci{width:70px;background:${C.panel2};border:1px solid ${C.line};color:${C.ink};padding:4px 6px;border-radius:5px;text-align:right}
        .si{background:${C.panel2};border:1px solid ${C.line};color:${C.ink};padding:4px 6px;border-radius:5px}
        tr:hover td{background:rgba(31,56,100,.04)}
      `}</style>

      <div style={{borderBottom:`1px solid ${C.line}`,padding:"18px 22px",background:C.panel,position:"sticky",top:0,zIndex:10}}>
        <div style={{display:"flex",alignItems:"baseline",gap:14,flexWrap:"wrap"}}>
          <BackNav />
          <div style={{fontSize:22,fontWeight:800,letterSpacing:"-.02em"}}>Where to Land</div>
          <div style={{color:C.dim,fontSize:13}}>Peterhead vs Hanstholm</div>
          <button onClick={loadBoardPrices} style={{background:"transparent",border:`1px solid ${C.line}`,color:C.ink,padding:"5px 11px",borderRadius:7,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:FONT}}>↻ Latest board prices</button>
          <div style={{marginLeft:"auto",display:"flex",gap:18}}>
            <Tot label="Peterhead" val={fmtGBP(totals.pd)} col={C.pd}/>
            <Tot label="Hanstholm" val={fmtGBP(totals.dk)} col={C.dk}/>
            <Tot label="Difference" val={(totals.diff>=0?"+":"")+fmtGBP(totals.diff)} col={totals.diff>=0?C.dk:C.pd}/>
          </div>
        </div>
        <div style={{display:"flex",gap:8,marginTop:16,flexWrap:"wrap"}}>
          {STEPS.map((s,i)=>(<button key={i} onClick={()=>setStep(i)} style={{background:i===step?C.ink:"transparent",color:i===step?C.bg:C.dim,border:`1px solid ${i===step?C.ink:C.line}`,padding:"6px 13px",borderRadius:20,fontSize:12.5,fontWeight:600,cursor:"pointer",fontFamily:FONT}}>{i+1}. {s}</button>))}
        </div>
        {boardMsg&&<div style={{fontSize:12,color:C.dim,marginTop:10}}>{boardMsg}</div>}
      </div>

      <div style={{maxWidth:1180,margin:"0 auto",padding:"26px 22px"}}>
        {step===0&&<BoatStep tally={tally} setTally={setTally} setMap={setMap} mode={tallyMode} setMode={setTallyMode} effW={effW} onUpload={parseBoat} busy={busy.boat} msg={msg.boat} next={()=>setStep(1)}/>}
        {step===1&&<PriceStep which="pd" title="Peterhead price sheet" accent={C.pd} prices={pd} setPrices={setPd} onUpload={(f)=>parsePrice(f,"pd")} busy={busy.pd} msg={msg.pd} next={()=>setStep(2)}/>}
        {step===2&&<PriceStep which="dk" title="Hanstholm price sheet" accent={C.dk} prices={dk} setPrices={setDk} onUpload={(f)=>parsePrice(f,"dk")} busy={busy.dk} msg={msg.dk} next={()=>setStep(3)}/>}
        {step===3&&<MapStep tally={tally} map={map} setMap={setMap} pd={pd} dk={dk} pdHigh={pdHigh} setPdHigh={setPdHigh} priceOv={priceOv} setPriceOv={setPriceOv} next={()=>setStep(4)}/>}
        {step===4&&<ResultStep rows={rows} totals={totals} summary={summary} fillMissing={fillMissing} setFillMissing={setFillMissing} tallyMode={tallyMode} exportPDF={exportPDF} nett={nett} nettCfg={nettCfg} setNettCfg={setNettCfg} tallyBoxes={tallyBoxes} boxesOverride={boxesOverride} setBoxesOverride={setBoxesOverride}/>}
      </div>
    </div>
  );
}

function Tot({label,val,col}){return(<div style={{textAlign:"right"}}><div style={{fontSize:10.5,color:C.dim,textTransform:"uppercase",letterSpacing:".05em"}}>{label}</div><div style={{fontSize:16,fontWeight:600,color:col,fontFamily:MONO}}>{val}</div></div>);}
function Card({children,accent}){return(<div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:12,padding:22,borderTop:accent?`3px solid ${accent}`:undefined}}>{children}</div>);}
function NextBtn({onClick,label="Next →"}){return(<button onClick={onClick} style={{background:C.good,color:"#06281a",border:"none",padding:"11px 22px",borderRadius:8,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:FONT,marginTop:20}}>{label}</button>);}
function UploadBtn({onUpload,busy,accent,label}){const ref=useRef();return(<><input ref={ref} type="file" accept="image/*,application/pdf,.csv,.tsv,.txt,.xlsx,.xls,.xlsm" style={{display:"none"}} onChange={(e)=>e.target.files[0]&&onUpload(e.target.files[0])}/><button onClick={()=>ref.current.click()} disabled={busy} style={{background:accent,color:"#031018",border:"none",padding:"10px 18px",borderRadius:8,fontWeight:700,cursor:busy?"wait":"pointer",fontFamily:FONT,fontSize:13.5}}>{busy?"Reading…":label}</button></>);}

function BoatStep({tally,setTally,setMap,mode,setMode,effW,onUpload,busy,msg,next}){
  const SPECIES=Object.keys(GRADE_DICT);
  const gradesFor=(sp)=>Object.keys(GRADE_DICT[sp]||{});
  const rebuild=(t)=>{setTally(t);setMap(buildMapping(t));};
  function updNum(id,f,v){setTally((p)=>p.map((r)=>r.id===id?{...r,[f]:v===""?0:+v}:r));}
  function updSp(id,v){rebuild(tally.map((r)=>r.id===id?{...r,sp:v}:r));}
  function updSize(id,v){rebuild(tally.map((r)=>r.id===id?{...r,size:v}:r));}
  function delRow(id){rebuild(tally.filter((r)=>r.id!==id));}
  const [na,setNa]=useState({sp:"HADDOCK",size:"",boxes:"",avgBox:""});
  function addRow(){
    if(!na.sp)return;
    const boxes=+na.boxes||0,avgBox=+na.avgBox||0,wt=+(boxes*avgBox).toFixed(1);
    if(!boxes&&!wt)return;
    const id=tally.reduce((m,r)=>Math.max(m,r.id),-1)+1;
    rebuild([...tally,{id,sp:canonSp(na.sp),size:na.size||na.sp,boxes,avgBox:avgBox||(boxes?DEFAULT_BOX_KG:0),wt:wt||0}]);
    setNa((n)=>({sp:n.sp,size:"",boxes:"",avgBox:n.avgBox})); // keep species + box wt for a fast next line
    if(mode!=="boxes")setMode("boxes");
  }
  const totW=tally.reduce((a,r)=>a+effW(r),0);
  const lblS={display:"flex",flexDirection:"column",gap:3,fontSize:11,color:C.dim,fontWeight:600};
  return(<Card>
    <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
      <div style={{fontSize:18,fontWeight:700}}>Boat tally</div>
      <UploadBtn onUpload={onUpload} busy={busy} accent={C.good} label="⬆ Upload tally (xlsx · CSV · PDF · photo)"/>
      <div style={{display:"flex",gap:6,background:C.panel2,padding:3,borderRadius:8}}>
        {[["weight","Weight"],["boxes","Boxes × avg"]].map(([m,l])=>(<button key={m} onClick={()=>setMode(m)} style={{background:mode===m?C.ink:"transparent",color:mode===m?C.bg:C.dim,border:"none",padding:"6px 12px",borderRadius:6,fontSize:12.5,fontWeight:600,cursor:"pointer",fontFamily:FONT}}>{l}</button>))}
      </div>
      <div style={{marginLeft:"auto",color:C.dim,fontSize:14,fontFamily:MONO}}>Total: <b style={{color:C.ink}}>{fmtKg(totW)}</b></div>
    </div>
    {msg&&<div style={{fontSize:12.5,color:busy?C.warn:C.dim,marginTop:10}}>{msg}</div>}
    <div style={{fontSize:11.5,color:C.dim,marginTop:6}}>Upload a printed or <b>handwritten</b> tally (photo / PDF / Excel / CSV), or build one by hand below. Every line is editable — change a species or grade and the price mapping updates automatically.</div>
    <div style={{marginTop:16,overflowX:"auto"}}>
      {tally.length===0
        ? <div style={{padding:"22px 16px",textAlign:"center",color:C.dim,fontSize:13.5,border:`1px dashed ${C.line}`,borderRadius:10}}>No catch loaded yet. Upload a tally above, or add lines by hand below.</div>
        : <table><thead><tr><th>Species</th><th>Size / grade</th>{mode==="boxes"?<><th className="r">Boxes</th><th className="r">Box kg</th><th className="r">Weight</th></>:<th className="r">Weight kg</th>}<th></th></tr></thead>
      <tbody>{tally.map((r)=>(<tr key={r.id}>
        <td><select className="si" style={{fontSize:13,minWidth:118}} value={r.sp} onChange={(e)=>updSp(r.id,e.target.value)}>{[...new Set([...SPECIES,r.sp])].map((s)=><option key={s} value={s}>{s}</option>)}</select></td>
        <td><input className="ci" list={`g-${r.sp}`} style={{minWidth:128}} value={r.size} onChange={(e)=>updSize(r.id,e.target.value)}/><datalist id={`g-${r.sp}`}>{gradesFor(r.sp).map((g)=><option key={g} value={g}/>)}</datalist></td>
        {mode==="boxes"
          ?<><td className="r"><input className="ci" style={{width:56}} type="number" value={r.boxes} onChange={(e)=>updNum(r.id,"boxes",e.target.value)}/></td><td className="r"><input className="ci" style={{width:60}} type="number" step="0.1" value={r.avgBox} onChange={(e)=>updNum(r.id,"avgBox",e.target.value)}/></td><td className="r" style={{color:C.dim,fontFamily:MONO}}>{(r.boxes*r.avgBox).toFixed(1)}</td></>
          :<td className="r"><input className="ci" style={{width:80}} type="number" step="0.01" value={r.wt} onChange={(e)=>updNum(r.id,"wt",e.target.value)}/></td>}
        <td className="r"><button onClick={()=>delRow(r.id)} title="Remove line" style={{background:"none",border:"none",color:C.warn,cursor:"pointer",fontSize:18,lineHeight:1,padding:"0 4px"}}>×</button></td>
      </tr>))}</tbody></table>}
    </div>
    <div style={{marginTop:14,padding:"12px 14px",border:`1px dashed ${C.line}`,borderRadius:10,background:C.panel2}}>
      <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>Add a line by hand</div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
        <label style={lblS}>Species<select className="si" style={{minWidth:130,fontSize:13}} value={na.sp} onChange={(e)=>setNa((n)=>({...n,sp:e.target.value}))}>{SPECIES.map((s)=><option key={s} value={s}>{s}</option>)}</select></label>
        <label style={lblS}>Grade / size<input className="ci" list={`g-add-${na.sp}`} placeholder="e.g. Metro" style={{minWidth:140}} value={na.size} onChange={(e)=>setNa((n)=>({...n,size:e.target.value}))}/><datalist id={`g-add-${na.sp}`}>{gradesFor(na.sp).map((g)=><option key={g} value={g}/>)}</datalist></label>
        <label style={lblS}>Boxes<input className="ci" style={{width:70}} type="number" placeholder="0" value={na.boxes} onChange={(e)=>setNa((n)=>({...n,boxes:e.target.value}))}/></label>
        <label style={lblS}>Box weight kg<input className="ci" style={{width:90}} type="number" step="0.1" placeholder={String(DEFAULT_BOX_KG)} value={na.avgBox} onChange={(e)=>setNa((n)=>({...n,avgBox:e.target.value}))}/></label>
        <button onClick={addRow} style={{background:C.good,border:"none",color:"#031018",cursor:"pointer",fontWeight:700,borderRadius:8,padding:"9px 16px",fontFamily:FONT,fontSize:13.5}}>+ Add line</button>
      </div>
    </div>
    <NextBtn onClick={next}/>
  </Card>);
}

function PriceStep({which,title,accent,prices,setPrices,onUpload,busy,msg,next}){
  function setCell(sp,gr,v){setPrices((p)=>({...p,[sp]:{...p[sp],[gr]:v===""?null:+v}}));}
  return(<Card accent={accent}>
    <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <div style={{fontSize:18,fontWeight:700}}>{title}</div>
      <UploadBtn onUpload={onUpload} busy={busy} accent={accent} label="⬆ Upload sheet"/>
      {msg&&<div style={{fontSize:12.5,color:busy?C.warn:C.dim}}>{msg}</div>}
    </div>
    <div style={{marginTop:18,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
      {Object.keys(prices).length===0&&<div style={{gridColumn:"1/-1",padding:"28px 16px",textAlign:"center",color:C.dim,fontSize:13.5,border:`1px dashed ${C.line}`,borderRadius:10}}>No prices loaded yet. Upload the sheet above — or skip, and prices from the other market will be used.</div>}
      {Object.keys(prices).map((sp)=>(<div key={sp} style={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:9,padding:"10px 12px"}}>
        <div style={{fontWeight:700,fontSize:13.5,marginBottom:7}}>{sp}</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:7}}>{Object.keys(prices[sp]).filter((gr)=>!/_|\((low|high)\)\s*$/.test(gr)).map((gr)=>(<div key={gr} style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:11,color:C.dim,fontFamily:MONO}}>{GRADE_LABEL[gr]||gr}</span><input className="ci" style={{width:56}} type="number" step="0.01" value={prices[sp][gr]??""} onChange={(e)=>setCell(sp,gr,e.target.value)}/></div>))}</div>
      </div>))}
    </div>
    <NextBtn onClick={next}/>
  </Card>);
}

function MapStep({tally,map,setMap,pd,dk,pdHigh,setPdHigh,priceOv,setPriceOv,next}){
  const [editSp,setEditSp]=useState(false);
  function upd(i,f,v){setMap((p)=>p.map((m,idx)=>idx===i?{...m,[f]:v}:m));}
  // manual price overrides keyed by `${market}|${species}|${grade}`
  const ovGet=(mkt,sp,gr)=>{const v=priceOv[`${mkt}|${sp}|${gr}`];return (v!=null&&v!=="")?v:"";};
  const ovSet=(mkt,sp,gr,v)=>setPriceOv((o)=>{const k=`${mkt}|${sp}|${gr}`;const n={...o};if(v===""||v==null)delete n[k];else n[k]=v;return n;});
  const editedCount=Object.keys(priceOv||{}).length;
  const pdSp=Object.keys(pd).concat("—"),dkSp=Object.keys(dk).concat("—");
  const cc={high:C.good,med:C.warn,low:C.bad};
  // alias-tolerant species finder (Monks~Monk~Monkfish, Lemons~Lemon, etc.)
  const findObj=(obj,name)=>{
    if(!name||name==="—")return null;
    if(obj[name])return obj[name];
    const keys=Object.keys(obj),n=String(name).toLowerCase().replace(/[^a-z]/g,"");
    let k=keys.find((x)=>x.toLowerCase().replace(/[^a-z]/g,"")===n);
    if(!k)k=keys.find((x)=>{const xn=x.toLowerCase().replace(/[^a-z]/g,"");return xn.startsWith(n)||n.startsWith(xn);});
    return k?obj[k]:null;
  };
  // px: look up a price, stepping to the nearest PRICED grade/sort in the SAME
  // market when the exact one is blank — matching the gross calculation exactly.
  // For PD, when "Mid" is on and the key is a plain grade, value at (avg+high)/2.
  const PDL=["A1","A2","A3","A4","A5","U9"], DKL=["0","1","2","3","4","5","9"];
  const midPx=(o,base)=>{const a=o[base],h=o[base+" (high)"];if(a!=null&&h!=null)return +((a+h)/2);return a!=null?a:(h!=null?h:null);};
  const px=(obj,sp,k,mid,ladder)=>{
    const o=findObj(obj,sp);if(!o)return null;
    if(k==="A4ma"||k==="A4m"){ const p=metroPrice(o,k,mid); if(p!=null)return p; }
    const plain=!/\((low|high)\)\s*$/.test(String(k));
    if(mid&&plain&&(o[k]!=null||o[k+" (high)"]!=null))return midPx(o,k);
    if(o[k]!=null)return o[k];
    const base=String(k).replace(/\s*\((low|high)\)\s*$/,"");
    if(mid&&(o[base]!=null||o[base+" (high)"]!=null))return midPx(o,base);
    if(o[base]!=null)return o[base];
    const L=ladder||[]; const idx=L.indexOf(base);
    if(idx>=0){for(let d=1;d<L.length;d++){
      const lo=L[idx+d]; if(lo&&o[lo]!=null)return o[lo];
      const hi=L[idx-d]; if(hi&&o[hi]!=null)return o[hi];
    }}
    return null;
  };
  return(<Card>
    <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
      <div style={{fontSize:18,fontWeight:700}}>Check grade mapping</div>
      <label style={{marginLeft:"auto",fontSize:12,color:C.dim,display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
        <input type="checkbox" checked={editSp} onChange={(e)=>setEditSp(e.target.checked)}/>Edit species too
      </label>
    </div>
    {/* Peterhead price-column toggle: AVG (default) <-> HIGH for all grades at once */}
    <div style={{marginTop:10,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",background:C.panel2,border:`1px solid ${C.line}`,borderRadius:10,padding:"9px 11px"}}>
      <span style={{fontSize:12.5,color:C.pd,fontWeight:700,letterSpacing:".03em"}}>PETERHEAD PRICES</span>
      <div style={{marginLeft:"auto",display:"flex",borderRadius:8,overflow:"hidden",border:`1px solid ${C.line}`}}>
        <button onClick={()=>setPdHigh(false)} style={{border:"none",cursor:"pointer",fontSize:13,fontWeight:700,padding:"7px 14px",background:!pdHigh?C.pd:"transparent",color:!pdHigh?"#04121f":C.dim}}>AVG</button>
        <button onClick={()=>setPdHigh(true)} style={{border:"none",cursor:"pointer",fontSize:13,fontWeight:700,padding:"7px 14px",background:pdHigh?C.pd:"transparent",color:pdHigh?"#04121f":C.dim}}>HIGH</button>
      </div>
    </div>
    <div style={{color:C.dim,fontSize:11.5,marginTop:6}}>
      {pdHigh
        ?"HIGH: every grade valued at the midpoint of its AVE and HIGH. Mini Metro uses the A4 Metro AVE; Metro uses the A4 Metro HIGH."
        :"AVG: every grade at its AVE. Mini Metro blends the A4 Metro LOW+AVE; Metro blends the A4 Metro AVE+HIGH. Tap HIGH to lift the whole board."}
    </div>
    <div style={{color:C.dim,fontSize:12.5,marginTop:8,display:"flex",gap:14,flexWrap:"wrap"}}>
      <span><Dot c={C.good}/> good</span><span><Dot c={C.warn}/> check</span><span><Dot c={C.bad}/> best-guess</span>
    </div>
    <div style={{marginTop:8,fontSize:12,color:C.dim}}>
      Tip: tap any price below to type tomorrow’s expected figure — the gross updates live. Edited prices show a blue box; tap ↺ to put the board price back.
    </div>
    {editedCount>0&&<div style={{marginTop:8,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",fontSize:12.5}}>
      <span style={{color:C.pd,fontWeight:700}}>{editedCount} price{editedCount>1?"s":""} edited by hand</span>
      <button onClick={()=>setPriceOv({})} style={{border:`1px solid ${C.line}`,background:"transparent",color:C.dim,borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:12,fontWeight:600}}>Reset all to board</button>
    </div>}

    <div style={{marginTop:14,display:"grid",gap:10}}>
      {tally.map((r,i)=>{
        const m=map[i];
        const pdO=findObj(pd,m.pdSp), dkO=findObj(dk,m.dkSp);
        const pg=(pdO?Object.keys(pdO).filter((k)=>!/_|\((low|high)\)\s*$/.test(k)):[]).concat("ANY","—");
        const ds=(dkO?Object.keys(dkO):[]).concat("—");
        const pdVal=px(pd,m.pdSp,m.pdGr,pdHigh,PDL), dkVal=px(dk,m.dkSp,m.dkSort,false,DKL);
        const pOv=ovGet("pd",m.pdSp,m.pdGr), dOv=ovGet("dk",m.dkSp,m.dkSort);
        const pEff=(pOv!==""&&!isNaN(pOv))?+pOv:pdVal, dEff=(dOv!==""&&!isNaN(dOv))?+dOv:dkVal;
        return(
          <div key={r.id} style={{background:C.panel2,border:`1px solid ${C.line}`,borderLeft:`4px solid ${cc[m.conf]}`,borderRadius:10,padding:"11px 13px"}}>
            {/* line header */}
            <div style={{display:"flex",alignItems:"baseline",gap:8}}>
              <span style={{fontWeight:800,fontSize:15}}>{r.sp}</span>
              <span style={{color:C.dim,fontSize:13}}>{r.size}</span>
              <span style={{marginLeft:"auto",fontSize:12,color:C.dim,fontFamily:MONO}}>{r.wt.toFixed(0)} kg</span>
            </div>
            {/* two columns: PD | DK */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:9}}>
              <div style={{background:pEff==null?"rgba(255,204,68,.08)":C.panel,borderRadius:8,padding:"8px 9px",borderTop:`2px solid ${pEff==null?C.warn:C.pd}`,border:pEff==null?`1px solid ${C.warn}`:"1px solid transparent"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
                  <span style={{fontSize:10.5,color:pEff==null?C.warn:C.pd,fontWeight:700,letterSpacing:".04em"}}>PETERHEAD</span>
                  {pEff==null&&<span style={{marginLeft:"auto",fontSize:9,fontWeight:800,color:"#06281a",background:C.warn,borderRadius:4,padding:"1px 5px",letterSpacing:".03em"}}>{dEff!=null?"WILL SUB":"NO PRICE"}</span>}
                </div>
                {editSp&&<select className="si" style={{width:"100%",marginBottom:5,fontSize:12}} value={m.pdSp} onChange={(e)=>upd(i,"pdSp",e.target.value)}>{pdSp.map((s)=><option key={s}>{s}</option>)}</select>}
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <select className="si" style={{flex:1,minWidth:120,fontSize:14,padding:"7px 8px",color:pEff==null?C.warn:C.ink}} value={m.pdGr} onChange={(e)=>upd(i,"pdGr",e.target.value)}>{pdVal==null&&!pg.includes(m.pdGr)&&<option value={m.pdGr}>{(GRADE_LABEL[m.pdGr]||m.pdGr)} · no price</option>}{[...new Set(pg)].map((g)=><option key={g} value={g}>{GRADE_LABEL[g]||g}</option>)}</select>
                  <span style={{fontSize:12,color:C.dim}}>£</span>
                  <input className="si" type="number" step="0.01" inputMode="decimal" value={pOv!==""?pOv:(pdVal!=null?pdVal:"")} placeholder={pdVal!=null?pdVal.toFixed(2):"—"} title={pdVal!=null?("Board price "+fmtGBP(pdVal)+" — type to override"):"No board price — type one to use it"} onChange={(e)=>ovSet("pd",m.pdSp,m.pdGr,e.target.value)} style={{width:60,fontSize:13,fontFamily:MONO,textAlign:"right",padding:"6px 6px",color:pEff!=null?C.ink:C.warn,border:pOv!==""?`1px solid ${C.pd}`:undefined,background:pOv!==""?"rgba(91,200,255,.10)":undefined}}/>
                  {pOv!==""&&<button onClick={()=>ovSet("pd",m.pdSp,m.pdGr,"")} title="Reset to board price" style={{border:"none",background:"transparent",color:C.dim,cursor:"pointer",fontSize:15,lineHeight:1,padding:"0 2px"}}>↺</button>}
                  {pEff==null&&dEff!=null&&<span style={{fontSize:11,color:C.dim,fontFamily:MONO}}>({fmtGBP(dEff)})</span>}
                </div>
              </div>
              <div style={{background:dEff==null?"rgba(255,204,68,.08)":C.panel,borderRadius:8,padding:"8px 9px",borderTop:`2px solid ${dEff==null?C.warn:C.dk}`,border:dEff==null?`1px solid ${C.warn}`:"1px solid transparent"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
                  <span style={{fontSize:10.5,color:dEff==null?C.warn:C.dk,fontWeight:700,letterSpacing:".04em"}}>HANSTHOLM</span>
                  {dEff==null&&<span style={{marginLeft:"auto",fontSize:9,fontWeight:800,color:"#06281a",background:C.warn,borderRadius:4,padding:"1px 5px",letterSpacing:".03em"}}>{pEff!=null?"WILL SUB":"NO PRICE"}</span>}
                </div>
                {editSp&&<select className="si" style={{width:"100%",marginBottom:5,fontSize:12}} value={m.dkSp} onChange={(e)=>upd(i,"dkSp",e.target.value)}>{dkSp.map((s)=><option key={s}>{s}</option>)}</select>}
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <select className="si" style={{flex:1,minWidth:110,fontSize:14,padding:"7px 8px",color:dEff==null?C.warn:C.ink}} value={m.dkSort} onChange={(e)=>upd(i,"dkSort",e.target.value)}>{dkVal==null&&!ds.includes(m.dkSort)&&<option value={m.dkSort}>{m.dkSort==="—"?"— none —":m.dkSort+" · no price"}</option>}{[...new Set(ds)].map((g)=><option key={g}>{g}</option>)}</select>
                  <span style={{fontSize:12,color:C.dim}}>£</span>
                  <input className="si" type="number" step="0.01" inputMode="decimal" value={dOv!==""?dOv:(dkVal!=null?dkVal:"")} placeholder={dkVal!=null?dkVal.toFixed(2):"—"} title={dkVal!=null?("Board price "+fmtGBP(dkVal)+" — type to override"):"No board price — type one to use it"} onChange={(e)=>ovSet("dk",m.dkSp,m.dkSort,e.target.value)} style={{width:60,fontSize:13,fontFamily:MONO,textAlign:"right",padding:"6px 6px",color:dEff!=null?C.ink:C.warn,border:dOv!==""?`1px solid ${C.dk}`:undefined,background:dOv!==""?"rgba(124,242,184,.10)":undefined}}/>
                  {dOv!==""&&<button onClick={()=>ovSet("dk",m.dkSp,m.dkSort,"")} title="Reset to board price" style={{border:"none",background:"transparent",color:C.dim,cursor:"pointer",fontSize:15,lineHeight:1,padding:"0 2px"}}>↺</button>}
                  {dEff==null&&pEff!=null&&<span style={{fontSize:11,color:C.dim,fontFamily:MONO}}>({fmtGBP(pEff)})</span>}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
    <NextBtn onClick={next} label="See gross →"/>
  </Card>);
}
function Dot({c}){return(<span style={{display:"inline-block",width:9,height:9,borderRadius:9,background:c,verticalAlign:"middle"}}/>);}

function ResultStep({rows,totals,summary,fillMissing,setFillMissing,tallyMode,exportPDF,nett,nettCfg,setNettCfg,tallyBoxes,boxesOverride,setBoxesOverride}){
  const winner=totals.diff>=0?"Hanstholm":"Peterhead";const wc=totals.diff>=0?C.dk:C.pd;
  const pct=Math.min(totals.pd,totals.dk)>0?(Math.abs(totals.diff)/Math.min(totals.pd,totals.dk)*100).toFixed(1):"0";
  const nWinner=nett.diff>=0?"Hanstholm":"Peterhead";const nwc=nett.diff>=0?C.dk:C.pd;
  const setPd=(k,v)=>setNettCfg((c)=>({...c,pd:{...c.pd,[k]:v}}));
  const setDk=(k,v)=>setNettCfg((c)=>({...c,dk:{...c.dk,[k]:v}}));
  return(<div style={{display:"grid",gap:20}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:16}}>
      <Big label="Peterhead gross" val={fmtGBP(totals.pd)} col={C.pd}/>
      <Big label="Hanstholm gross" val={fmtGBP(totals.dk)} col={C.dk}/>
      <Big label={`${winner} better by`} val={(totals.diff>=0?"+":"")+fmtGBP(totals.diff)} col={wc} sub={`${pct}% · ${fmtKg(totals.w)} landed`}/>
    </div>

    <Card accent={C.good}>
      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <div style={{fontSize:16,fontWeight:700}}>Nett — after selling costs</div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,fontSize:12.5,color:C.dim}}>
          Boxes aboard <NI val={boxesOverride===""?tallyBoxes:boxesOverride} on={(v)=>setBoxesOverride(v===tallyBoxes?"":v)} step="1" w={76}/>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12,marginTop:14}}>
        <div style={{background:C.panel2,border:`1px solid ${C.line}`,borderTop:`2px solid ${C.pd}`,borderRadius:9,padding:"11px 13px"}}>
          <div style={{fontSize:11,color:C.pd,fontWeight:700,letterSpacing:".04em",marginBottom:8}}>PETERHEAD COSTS</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:10,fontSize:12.5,color:C.dim,alignItems:"center"}}>
            <span>Auction % <NI val={nettCfg.pd.auctionPct} on={(v)=>setPd("auctionPct",v)}/></span>
            <span>Agent % <NI val={nettCfg.pd.agentPct} on={(v)=>setPd("agentPct",v)}/></span>
            <span>Labour: men <NI val={nettCfg.pd.labourMen} on={(v)=>setPd("labourMen",v)} step="1" w={48}/> × £/box <NI val={nettCfg.pd.labourRate} on={(v)=>setPd("labourRate",v)} w={58}/></span>
            <span>Other £ <NI val={nettCfg.pd.otherFixed} on={(v)=>setPd("otherFixed",v)} w={78}/></span>
          </div>
          <label style={{display:"flex",alignItems:"center",gap:7,marginTop:9,fontSize:12.5,color:C.dim,cursor:"pointer"}}>
            <input type="checkbox" checked={nettCfg.pd.consigned} onChange={(e)=>setPd("consigned",e.target.checked)}/>
            Consigned to PD (trucked from another port)
          </label>
          {nettCfg.pd.consigned&&<div style={{display:"flex",flexWrap:"wrap",gap:10,fontSize:12.5,color:C.dim,alignItems:"center",marginTop:7}}>
            <span>Landing port % <NI val={nettCfg.pd.portPct} on={(v)=>setPd("portPct",v)}/></span>
            <span>£/truck <NI val={nettCfg.pd.truckCost} on={(v)=>setPd("truckCost",v)} step="1" w={70}/></span>
            <span>boxes/truck <NI val={nettCfg.pd.truckCap} on={(v)=>setPd("truckCap",v)} step="1" w={58}/></span>
          </div>}
          <div style={{marginTop:10,fontSize:12,fontFamily:MONO,color:C.dim,lineHeight:1.7}}>
            − {nett.pdPct.toFixed(2)}% = {fmtGBP(nett.pdPctCost)}<br/>
            − labour {fmtGBP(nett.pdLabour)}{nett.pdTruck>0&&<><br/>− trucking {fmtGBP(nett.pdTruck)} ({Math.ceil(nett.boxes/(+nettCfg.pd.truckCap||1))} truck{Math.ceil(nett.boxes/(+nettCfg.pd.truckCap||1))>1?"s":""})</>}{nett.pdOther>0&&<><br/>− other {fmtGBP(nett.pdOther)}</>}
          </div>
        </div>
        <div style={{background:C.panel2,border:`1px solid ${C.line}`,borderTop:`2px solid ${C.dk}`,borderRadius:9,padding:"11px 13px"}}>
          <div style={{fontSize:11,color:C.dk,fontWeight:700,letterSpacing:".04em",marginBottom:8}}>HANSTHOLM COSTS</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:10,fontSize:12.5,color:C.dim,alignItems:"center"}}>
            <span>All-in % <NI val={nettCfg.dk.pct} on={(v)=>setDk("pct",v)}/></span>
            <span>Box levy £ <NI val={nettCfg.dk.boxLevy} on={(v)=>setDk("boxLevy",v)} w={58}/></span>
            <span>Other £ <NI val={nettCfg.dk.otherFixed} on={(v)=>setDk("otherFixed",v)} w={78}/></span>
          </div>
          <div style={{marginTop:6,fontSize:11,color:C.dim,fontStyle:"italic",lineHeight:1.5}}>
            All-in % is inclusive of all Hanstholm costs — labour, forklifts, handling, etc. No separate labour line needed.
          </div>
          <div style={{marginTop:10,fontSize:12,fontFamily:MONO,color:C.dim,lineHeight:1.7}}>
            − {nett.dkPct.toFixed(2)}% = {fmtGBP(nett.dkPctCost)}<br/>
            − box levy {fmtGBP(nett.dkLevy)}{nett.dkOther>0&&<><br/>− other {fmtGBP(nett.dkOther)}</>}
          </div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:16,marginTop:14}}>
        <Big label="Peterhead nett" val={fmtGBP(nett.pdNett)} col={C.pd}/>
        <Big label="Hanstholm nett" val={fmtGBP(nett.dkNett)} col={C.dk}/>
        <Big label={`${nWinner} better by (nett)`} val={(nett.diff>=0?"+":"")+fmtGBP(nett.diff)} col={nwc} sub={`${nett.boxes.toLocaleString("en-GB")} boxes costed`}/>
      </div>
    </Card>
    <Card>
      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:10}}>
        <div style={{fontSize:16,fontWeight:700}}>By species</div>
        <button onClick={exportPDF} style={{marginLeft:"auto",background:C.ink,color:C.bg,border:"none",padding:"8px 16px",borderRadius:7,fontWeight:700,cursor:"pointer",fontFamily:FONT,fontSize:13}}>⬇ Download PDF</button>
      </div>
      <label style={{fontSize:12.5,color:C.dim,display:"flex",alignItems:"center",gap:7,cursor:"pointer",marginBottom:12}}><input type="checkbox" checked={fillMissing} onChange={(e)=>setFillMissing(e.target.checked)}/>Fill missing prices from other market</label>

      <div style={{display:"grid",gap:8}}>
        {summary.map((s)=>{
          const win=Math.abs(s.diff)<0.01?null:s.diff>0?C.dk:C.pd;
          return(
            <div key={s.sp} style={{background:C.panel2,border:`1px solid ${C.line}`,borderLeft:`4px solid ${win||C.line}`,borderRadius:9,padding:"10px 12px"}}>
              <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                <span style={{fontWeight:800,fontSize:14.5}}>{s.sp}</span>
                <span style={{fontSize:12,color:C.dim,fontFamily:MONO}}>{s.w.toFixed(0)} kg</span>
                <span style={{marginLeft:"auto",fontSize:13,fontFamily:MONO,fontWeight:700,color:win||C.dim}}>{Math.abs(s.diff)<0.01?"tie":(s.diff>0?"+":"")+fmtGBP(s.diff)}</span>
              </div>
              <div style={{display:"flex",gap:16,marginTop:7}}>
                <div style={{flex:1}}><div style={{fontSize:10,color:C.pd,fontWeight:700,letterSpacing:".04em"}}>PETERHEAD</div><div style={{fontSize:14,fontFamily:MONO,marginTop:2}}>{fmtGBP(s.pd)}</div></div>
                <div style={{flex:1}}><div style={{fontSize:10,color:C.dk,fontWeight:700,letterSpacing:".04em"}}>HANSTHOLM</div><div style={{fontSize:14,fontFamily:MONO,marginTop:2}}>{fmtGBP(s.dk)}</div></div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:9,padding:"12px 14px",marginTop:12,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <span style={{fontWeight:800,fontSize:15}}>TOTAL</span>
        <span style={{fontSize:12,color:C.dim,fontFamily:MONO}}>{totals.w.toFixed(0)} kg</span>
        <div style={{marginLeft:"auto",display:"flex",gap:16,alignItems:"baseline"}}>
          <div><div style={{fontSize:10,color:C.pd,fontWeight:700}}>PD</div><div style={{fontFamily:MONO,fontWeight:700,color:C.pd}}>{fmtGBP(totals.pd)}</div></div>
          <div><div style={{fontSize:10,color:C.dk,fontWeight:700}}>DK</div><div style={{fontFamily:MONO,fontWeight:700,color:C.dk}}>{fmtGBP(totals.dk)}</div></div>
        </div>
      </div>
    </Card>
    {rows.some((r)=>r.note)&&<Card><div style={{fontSize:14,fontWeight:700,marginBottom:8,color:C.warn}}>Substituted / flagged lines</div><div style={{display:"grid",gap:5}}>{rows.filter((r)=>r.note).map((r)=>(<div key={r.id} style={{fontSize:12.5,color:C.dim,fontFamily:MONO}}><span style={{color:C.ink}}>{r.sp} {r.size}</span> — {r.note}</div>))}</div></Card>}
    <div style={{fontSize:12,color:C.dim,textAlign:"center"}}>Estimate only — uses {tallyMode==="boxes"?"boxes × avg box weight":"entered weights"} and the prices/mappings you confirmed. Not a settlement.</div>
  </div>);
}
function NI({val,on,step="0.01",w=70}){return(<input className="ci" style={{width:w}} type="number" step={step} value={val} onChange={(e)=>on(e.target.value===""?"":+e.target.value)}/>);}
function Big({label,val,col,sub}){return(<div style={{background:C.panel,border:`1px solid ${C.line}`,borderTop:`3px solid ${col}`,borderRadius:12,padding:"20px 22px"}}><div style={{fontSize:11.5,color:C.dim,textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div><div style={{fontSize:30,fontWeight:700,color:col,marginTop:6,letterSpacing:"-.02em",fontFamily:MONO}}>{val}</div>{sub&&<div style={{fontSize:12,color:C.dim,marginTop:4}}>{sub}</div>}</div>);}
