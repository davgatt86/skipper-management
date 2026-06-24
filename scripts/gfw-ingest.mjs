// scripts/gfw-ingest.mjs
// Peterhead Market Forecast ingest — runs in GitHub Actions (cron 3x/day),
// NOT in a Netlify function. Global Fishing Watch port-visit queries are slow
// and highly variable (measured 5s to 30s+ for the SAME query), which blows
// past Netlify's function limits. GitHub Actions gives a 6-hour budget, so the
// slow/variable GFW calls are no problem here.
//
// It pulls fishing-vessel DEPARTURES from six Scottish ports and upserts one
// row per boat per departure day into Supabase `vessel_departures`, which feeds
// the forecast page. Fishing boats are kept if GFW type==fishing OR the name
// matches the UK >=15m register (rescues trawlers GFW mis-types as "other").
//
// Required environment (set as GitHub repo secrets):
//   GFW_API_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FORECAST_FLEET_ID  (optional; defaults to the AUDACIOUS BF83 fleet id)

const GFW = 'https://gateway.api.globalfishingwatch.org/v3/events'
const DATASET = 'public-global-port-visits-events:latest'
const LOOKBACK_DAYS = 5          // must cover GFW's ~4-day lag (shorter windows return nothing)
const MIN_CONFIDENCE = 2
const PER_CALL_TIMEOUT_MS = 45000
const FLEET_ID = process.env.FORECAST_FLEET_ID || '00000000-0000-0000-0000-000000000001'

const TOKEN = process.env.GFW_API_TOKEN
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const PORTS = [
  { id:'gbr-peterhead',     name:'Peterhead',     box:[[-1.82,57.48],[-1.74,57.48],[-1.74,57.53],[-1.82,57.53],[-1.82,57.48]] },
  { id:'gbr-fraserburgh',   name:'Fraserburgh',   box:[[-2.02,57.66],[-1.96,57.66],[-1.96,57.71],[-2.02,57.71],[-2.02,57.66]] },
  { id:'gbr-ullapool',      name:'Ullapool',      box:[[-5.18,57.88],[-5.13,57.88],[-5.13,57.92],[-5.18,57.92],[-5.18,57.88]] },
  { id:'gbr-lochinver',     name:'Lochinver',     box:[[-5.27,58.13],[-5.22,58.13],[-5.22,58.17],[-5.27,58.17],[-5.27,58.13]] },
  { id:'gbr-kinlochbervie', name:'Kinlochbervie', box:[[-5.07,58.44],[-5.02,58.44],[-5.02,58.48],[-5.07,58.48],[-5.07,58.44]] },
  { id:'gbr-scrabster',     name:'Scrabster',     box:[[-3.56,58.60],[-3.50,58.60],[-3.50,58.63],[-3.56,58.63],[-3.56,58.60]] },
]

const REGISTER = new Set(["ACADEMUS","ACCORD","ACHIEVE","ACHILLES","ACIONNA","ADENIA","ADMIRALBLAKE","ADMIRALGORDON","ADMIRALGRENVILLE","ADMIRALRAMSAY","ADVENTURERII","AJAX","ALANNAHRILEY","ALBIEOFLADRAM","ALBION","ALCEDO","ALISONKAY","ALLIANCE","ALTAIRE","AMANDAOFLADRAM","AMBERLISA","AMETHYST","ANDROMEDA","ANGELINA","ANGELOFLADRAM","ANNALIJDIA","ANNEGINA","ANSGAR","ANTARCTIC","ANTARES","APOLLO","AQUARIA","AQUARIUS","ARCTURUS","ARDENT","ARGONAUT","ARGOSY","ARKANGEL","ARMAVENUNO","ARTEMIS","ASPIRE","ATLANTICDAWN","ATLAS","AUDACIOUS","AVRELLA","AYR","BARENTSZEEOFLADRAM","BENAIAHIV","BENARKLEII","BERYL","BILLYROWNEY","BLACKROSE","BLAKE","BONAMI","BOUNTIFUL","BOYANDREW","BOYENZO","BOYJOHN","BRIGHTERHOPE","BRIGHTRAY","BRISAN","BRISCA","BRITANNIAV","BROSME","BUDDINGROSE","CABOORTEGAL","CALEDONIAIII","CARALISA","CARINAII","CARVELA","CASTLEWOOD","CATHARINAOFLADRAM","CELESTIALDAWN","CHALLENGE","CHALLENGER","CHARISMA","CHARISMATIC","CHARMEL","CHLOEELLA","CHRISANDRAII","CHRISTINAS","CLAIREMARIE","COMRADES","CONSTANTFRIEND","COPIOUS","CORNELISGERTJAN","CORNISHMAN","COURAGE","COURAGEOUS","COWRIEBAY","CRIMSONARROW","CRIMSONSEA","CRYSTALRIVER","CRYSTALSEA","CRYSTALTIDE","DANIELLE","DAVANLIN","DAWNMAID","DAYAGELLE","DAYDAWN","DAYSTAR","DEESIDE","DEFIANT","DESTINY","DEVOTIONII","EDERSANDS","EDWARDHENRY","ELISABETHOFLADRAM","ELIZABETHN","ELLORAH","ELSHADDAI","EMERALDDAWN","EMILIAJAYNE","EMILYROSE","EMMALOUISE","EMULATOR","ENDEAVOUR","ENDEAVOURV","ENDURANCE","ENTERPRISE","ENTERPRISEIII","ESPEMARDOS","ETERNALFRIEND","ETERNALLIGHT","ETERNALPROMISE","EUROCLYDON","EVENINGSTAR","EXCEL","FAIRHAVENS","FAITHFUL","FAITHFULSTAR","FAITHLIE","FALCON","FAVONIUS","FAVOURITE","FEARNOTII","FIDELITY","FLOWINGSTREAM","FOREVERFAITHFUL","FORTITUDE","FRANCESCA","FRANKBONEFAAS","FRANKHENRY","FREDWOOD","FRIGATEBIRD","FRUITFULBOUGH","FRUITFULHARVEST","FRUITFULVINE","GEERTRUIDA","GEESKE","GENESIS","GENESISII","GEORGIADAWN","GEORGINAOFLADRAM","GLENDEVERON","GOLDENBELLS11","GOLDENGAINV","GOLDENREAPER","GONPEZI","GOODFELLOWSHIP","GOODHOPE","GOODINTENT","GOVENEKOFLADRAM","GRACEFUL","GRACIOUS","GRATEFUL","GREENPASTURES","GRIANANOIR","GUIDINGLIGHT","GUIDINGSTAR","HALCYON","HARVESTDAWN","HARVESTER","HARVESTHOPE","HARVESTMOON","HARVESTREAPERII","HAVILAH","HEATHERK","HEATHERSPRIG","HELENUS","HENDRIKAJACOBA","HENKSENIOR","HENRYMONTY","HERITAGE","HIGHLANDQUEEN","HONEYBOURNEIII","ILLUSTRIS","INCENTIVEII","INGENUITY","INTUITION","INVERDALE","ISLAS","JACOBA","JACOBAMARIA","JACQUELINEANNE","JAKARA","JANEOFLADRAM","JANNETJECORNELIS","JENISKA","JOLANNAM","JONGEJOHANNES","JOYOFLADRAM","JUBILEEQUEST","JULIAANNE","JULIAM","KARENANNIII","KARENN","KARENOFLADRAM","KAYLANA","KELLYOFLADRAM","KESTREL","KINGCHALLENGER","KINGEXPLORER","KINGFISHER","KIRKELLA","KOPALA","LAUNCHOUT","LAUREL","LEANNE","LIBERTY","LILYANNA","LOCHINCHARDIII","LOGIEN","LORNAJEAN","LOUISAN","LOUWESENIOR","LUCINDAANN","LUNARBOW","LYNNPRINCESS","MANUELLAURA","MARBLANCO","MAREATHER","MAREIXON","MARGARETANNE","MARGARETOFLADRAM","MARTINE","MERCURIUS","MIAJANEW","MICHAELEDWARD","MIKKELLOUISE","MINCHHUNTER","MOLLIEJAYNE","MONTEMAZANTEU","MONTYOFLADRAM","MORAYENDEAVOUR","MORNINGSTAR","MOYUNA","NATHALIE","NEELTJE","NEREUS","NIMROD","NJORDVENTURE","NORDSTJERNEN","NORLAN","NORTHERNDAWN","NORTHERNEAGLE","NORTHERNJOY","NORTHERNOSPREY","NORTHERNQUEST","NORTHERNSTAR","NORTHERNVENTURE","NORTHERNVIKING","NORTHSEA","NORTHSTAR","OCEANBOUNTY","OCEANCHALLENGE","OCEANENDEAVOUR","OCEANHARVEST","OCEANHARVESTER","OCEANPIONEER","OCEANPRIDE","OCEANQUEST","OCEANREAPERIV","OCEANROSE","OCEANSTAR","OCEANTRUST","OCEANUS","OCEANVENTURE","OCEANVISION","OCEANWAY","OGENITA","ONWARD","OPPORTUNEIV","ORION","ORLAROSE","ORLAS","OSPREY","OURANNA","OURGRACE","OURHAZEL","OURLASSIE","OURLASSIII","OURPAMELAJILL","OURPRIDE","PATRICIAMARTA","PEADARMARIE","PLEIADES","PORTUNUS","PRIMROSE","PROLIFIC","PROSPECTOR","PROSPERITY","PROSPEROUS","PROVIDER","QUANTUS","QUEENSBERRY","QUIETWATERS","QUOVADIS","RACHELOFLADRAM","RADIANCE","RADIANTMORN","RADIANTSTAR","REAPER","REBECCA","REBEKAHJAYNE","RELIANCE","RELIANCEIII","RENOWN","RENOWNJW","REPLENISH","RESEARCH","RESILIENT","RESOLUTE","RESOLUTION","REVIVAL","RIBHINNDONNII","RITAROSE","ROBINOFLADRAM","ROCCOREED","ROISMHAIRI","ROSEBLOOM","ROSEOFSHARON","ROYALSOVEREIGN","SAMOFLADRAM","SANCTAMARIA","SAPPHIREIV","SARAHH","SARALENA","SARDONYX","SEAGULL","SEAHARVESTER","SEASWALLOW","SEIONTA","SERAPHIM","SERENITY","SHALANNA","SHALIMARII","SHARONVALE","SHARYNLOUISE","SHAULORA","SHEIGRA","SHEKINAH","SHEMARAHII","SILVERCREST","SILVERCRESTII","SILVERDAWN","SILVERFERN","SILVERWAVE","SIRIUS","SIRMILES","SOLIDEOGLORIA","SPARKLINGLINE","SPARKLINGSTAR","SPARKLINGSTARIV","SPICA","STARAHBUCHAN","STAROFANNAN","STAROFJURA","STEADFAST","STEADFASTHOPE","STEFANIEM","STELISSA","STELLAMARIS","STELLAPOLARIS","STEPHANIE","STEPHOFLADRAM","STGEORGES","STILLOSTREA","STRATHMORE","STRATHYRE","SUCCESSIII","SUFFOLKCHIEFTAIN","SUMMERDAWNII","SUMMERROSE","SUNRISE","SUSAUNO","SYLVIABOWERS","TAHUME","TAITS","TIGERSII","TONNRUAIRI","TRANQUILITY","TRANQUILLITY","TRANSCEND","TREVESSAIV","TRUEVINE","TRUIVANHINTE","TWAGORDONS","TWILIGHT","UBEROUS","UDRA","UNITY","VALENTE","VALHALLA","VANDIJCK","VELLEE","VENTURE","VENTUREIV","VENTUROUS","VICTORYROSE","VIGILANT","VIKINGBORG","VIRTUOUS","VISIONV","VOYAGER","WAKEFUL","WESTERNPROMISE","WESTRAFJORD","WESTRO","WHITEHEATHERVI","WHITEROSE","WILLIAMHENRYII","WILLIAMOFLADRAM","WILLINGLAD","WINTEROFLADRAM","WIRON5","ZARONA","ZENITH","ZEPHYR"])

function tidy(raw){
  let s=(raw||'').toUpperCase()
  s=s.replace(/[._:\/]+/g,' ').replace(/\s*-\s*/g,' ').replace(/\s+/g,' ').trim()
  s=s.replace(/^(F ?V|M ?V|MFV|GV|SV|SFF GV|SFF|FB) /,'')
  return s.trim()
}
const displayName = raw => tidy(raw)
const matchKey   = raw => tidy(raw).replace(/\s+[A-Z]{1,4} ?\d{1,4}$/,'').replace(/[^A-Z0-9]/g,'')
const fmt = d => d.toISOString().slice(0,10)

async function fetchPort(port, startDate, endDate){
  const out=[]; let offset=0; const limit=200
  for (let i=0;i<12;i++){
    const res=await fetch(`${GFW}?limit=${limit}&offset=${offset}`,{ method:'POST',
      signal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS),
      headers:{ 'Authorization':`Bearer ${TOKEN}`, 'Content-Type':'application/json',
                'User-Agent':'skipper-management-forecast/1.0', 'Accept':'application/json' },
      body: JSON.stringify({ datasets:[DATASET], startDate, endDate,
        geometry:{ type:'Polygon', coordinates:[port.box] } }) })
    if (!res.ok){ throw new Error(`GFW ${port.name} ${res.status}: ${(await res.text()).slice(0,160)}`) }
    const j=await res.json()
    const entries=j.entries||[]
    out.push(...entries)
    const total=j.total||0; offset+=limit
    if (offset>=total || entries.length<limit) break
  }
  return out
}

// Upsert via Supabase REST (no supabase-js dependency needed in CI).
async function upsert(rows){
  if (!rows.length) return 0
  const url=`${SUPABASE_URL}/rest/v1/vessel_departures?on_conflict=fleet_id,vessel_name,departure_date`
  const res=await fetch(url,{ method:'POST',
    headers:{ 'apikey':SERVICE_KEY, 'Authorization':`Bearer ${SERVICE_KEY}`,
              'Content-Type':'application/json',
              'Prefer':'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(rows) })
  if (!res.ok){ throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0,200)}`) }
  const inserted=await res.json()
  return Array.isArray(inserted) ? inserted.length : 0
}

function collect(port, entries, rows, seen){
  let kept=0
  for (const e of entries){
    const pv=e.port_visit||{}; const a=pv.endAnchorage||{}
    if (a.id!==port.id) continue                                    // only true departures from THIS port
    if (Number(pv.confidence||0) < MIN_CONFIDENCE) continue
    const v=e.vessel||{}; const raw=v.name||''
    if (!raw || !e.end) continue
    const isFish = v.type==='fishing'
    const inReg  = REGISTER.has(matchKey(raw))
    if (!isFish && !inReg) continue
    const name=displayName(raw)
    const date=String(e.end).slice(0,10)
    const dedup=`${name}|${date}`
    if (seen.has(dedup)) continue
    seen.add(dedup)
    rows.push({ fleet_id:FLEET_ID, vessel_name:name, departure_port:port.name,
                departure_date:date, departed_at:e.end, source:'ais' })
    kept++
  }
  return kept
}

async function main(){
  for (const [k,v] of Object.entries({GFW_API_TOKEN:TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY:SERVICE_KEY})){
    if (!v){ console.error(`Missing env: ${k}`); process.exit(1) }
  }
  const now=new Date()
  const endDate=fmt(now)
  const startDate=fmt(new Date(now.getTime()-LOOKBACK_DAYS*864e5))
  const summary={}; const rows=[]; const seen=new Set()

  // Pass 1: all ports in parallel.
  let pending = PORTS.slice()
  let results = await Promise.allSettled(pending.map(p => fetchPort(p, startDate, endDate)))
  const failed=[]
  results.forEach((r,i)=>{
    const port=pending[i]
    if (r.status==='fulfilled'){ summary[port.name]={ raw:r.value.length, kept:collect(port, r.value, rows, seen) } }
    else { failed.push(port); summary[port.name]={ error:String((r.reason&&r.reason.message)||r.reason) } }
  })

  // Pass 2: retry any that failed (GFW is flaky; a retry usually clears it).
  if (failed.length){
    console.log('retrying ports:', failed.map(p=>p.name).join(', '))
    const retry = await Promise.allSettled(failed.map(p => fetchPort(p, startDate, endDate)))
    retry.forEach((r,i)=>{
      const port=failed[i]
      if (r.status==='fulfilled'){ summary[port.name]={ raw:r.value.length, kept:collect(port, r.value, rows, seen), retried:true } }
      else { summary[port.name]={ error:String((r.reason&&r.reason.message)||r.reason), retried:true } }
    })
  }

  const inserted=await upsert(rows)
  console.log('gfw-ingest OK', JSON.stringify({ window:`${startDate}..${endDate}`, ports:summary, candidates:rows.length, inserted }))
}

main().catch(err => { console.error('gfw-ingest FAILED', String(err&&err.stack||err)); process.exit(1) })
