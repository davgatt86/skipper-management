// netlify/functions/gfw-departures.js
// Scheduled ingest: pulls fishing-vessel DEPARTURES from six Scottish ports
// (Global Fishing Watch port-visit events) into the vessel_departures table,
// which feeds the Peterhead Market Forecast page.
//
// A GFW "port visit" carries an `end` timestamp = when the vessel LEFT the
// port. We query the last few days, keep only fishing boats (GFW type=fishing
// OR a name match against the UK >=15m register, which rescues trawlers GFW
// mis-types as "other"), and upsert one row per boat per departure day.
// Oil-supply ships, ferries (e.g. the Pentland HAMNAVOE) and seismic vessels
// are dropped automatically.
//
// ── Netlify environment variables (Site settings -> Environment variables) ──
//   GFW_API_TOKEN              your Global Fishing Watch API access token
//   SUPABASE_URL               (already set for ingest-prices)
//   SUPABASE_SERVICE_ROLE_KEY  (already set for ingest-prices)
//   INGEST_SECRET              (already set) — lets you trigger a manual run
//   FORECAST_FLEET_ID          optional; defaults to the AUDACIOUS fleet id
//
// Schedule is set in netlify.toml (3x/day). Manual test in a browser:
//   https://<site>.netlify.app/.netlify/functions/gfw-departures?key=<INGEST_SECRET>

import { createClient } from '@supabase/supabase-js'

// Netlify scheduled function — runs at 06:00, 12:00, 18:00 UTC daily.
export const config = { schedule: '0 6,12,18 * * *' }

const GFW = 'https://gateway.api.globalfishingwatch.org/v3/events'
const DATASET = 'public-global-port-visits-events:latest'
const LOOKBACK_DAYS = 5          // window covers GFW's ~3-4 day lag, with overlap
const MIN_CONFIDENCE = 2         // drop confidence-1 (brief / uncertain visits)
const FLEET_ID = process.env.FORECAST_FLEET_ID || '00000000-0000-4000-8000-000000000001'

// Six watched ports: GFW anchorage id + display name + a bounding box to query.
const PORTS = [
  { id:'gbr-peterhead',     name:'Peterhead',     box:[[-1.82,57.48],[-1.74,57.48],[-1.74,57.53],[-1.82,57.53],[-1.82,57.48]] },
  { id:'gbr-fraserburgh',   name:'Fraserburgh',   box:[[-2.02,57.66],[-1.96,57.66],[-1.96,57.71],[-2.02,57.71],[-2.02,57.66]] },
  { id:'gbr-ullapool',      name:'Ullapool',      box:[[-5.18,57.88],[-5.13,57.88],[-5.13,57.92],[-5.18,57.92],[-5.18,57.88]] },
  { id:'gbr-lochinver',     name:'Lochinver',     box:[[-5.27,58.13],[-5.22,58.13],[-5.22,58.17],[-5.27,58.17],[-5.27,58.13]] },
  { id:'gbr-kinlochbervie', name:'Kinlochbervie', box:[[-5.07,58.44],[-5.02,58.44],[-5.02,58.48],[-5.07,58.48],[-5.07,58.44]] },
  { id:'gbr-scrabster',     name:'Scrabster',     box:[[-3.56,58.60],[-3.50,58.60],[-3.50,58.63],[-3.56,58.63],[-3.56,58.60]] },
]

// UK >=15m fishing-vessel register (normalised name keys) — the whitelist.
const REGISTER = new Set(["ACADEMUS","ACCORD","ACHIEVE","ACHILLES","ACIONNA","ADENIA","ADMIRALBLAKE","ADMIRALGORDON","ADMIRALGRENVILLE","ADMIRALRAMSAY","ADVENTURERII","AJAX","ALANNAHRILEY","ALBIEOFLADRAM","ALBION","ALCEDO","ALISONKAY","ALLIANCE","ALTAIRE","AMANDAOFLADRAM","AMBERLISA","AMETHYST","ANDROMEDA","ANGELINA","ANGELOFLADRAM","ANNALIJDIA","ANNEGINA","ANSGAR","ANTARCTIC","ANTARES","APOLLO","AQUARIA","AQUARIUS","ARCTURUS","ARDENT","ARGONAUT","ARGOSY","ARKANGEL","ARMAVENUNO","ARTEMIS","ASPIRE","ATLANTICDAWN","ATLAS","AUDACIOUS","AVRELLA","AYR","BARENTSZEEOFLADRAM","BENAIAHIV","BENARKLEII","BERYL","BILLYROWNEY","BLACKROSE","BLAKE","BONAMI","BOUNTIFUL","BOYANDREW","BOYENZO","BOYJOHN","BRIGHTERHOPE","BRIGHTRAY","BRISAN","BRISCA","BRITANNIAV","BROSME","BUDDINGROSE","CABOORTEGAL","CALEDONIAIII","CARALISA","CARINAII","CARVELA","CASTLEWOOD","CATHARINAOFLADRAM","CELESTIALDAWN","CHALLENGE","CHALLENGER","CHARISMA","CHARISMATIC","CHARMEL","CHLOEELLA","CHRISANDRAII","CHRISTINAS","CLAIREMARIE","COMRADES","CONSTANTFRIEND","COPIOUS","CORNELISGERTJAN","CORNISHMAN","COURAGE","COURAGEOUS","COWRIEBAY","CRIMSONARROW","CRIMSONSEA","CRYSTALRIVER","CRYSTALSEA","CRYSTALTIDE","DANIELLE","DAVANLIN","DAWNMAID","DAYAGELLE","DAYDAWN","DAYSTAR","DEESIDE","DEFIANT","DESTINY","DEVOTIONII","EDERSANDS","EDWARDHENRY","ELISABETHOFLADRAM","ELIZABETHN","ELLORAH","ELSHADDAI","EMERALDDAWN","EMILIAJAYNE","EMILYROSE","EMMALOUISE","EMULATOR","ENDEAVOUR","ENDEAVOURV","ENDURANCE","ENTERPRISE","ENTERPRISEIII","ESPEMARDOS","ETERNALFRIEND","ETERNALLIGHT","ETERNALPROMISE","EUROCLYDON","EVENINGSTAR","EXCEL","FAIRHAVENS","FAITHFUL","FAITHFULSTAR","FAITHLIE","FALCON","FAVONIUS","FAVOURITE","FEARNOTII","FIDELITY","FLOWINGSTREAM","FOREVERFAITHFUL","FORTITUDE","FRANCESCA","FRANKBONEFAAS","FRANKHENRY","FREDWOOD","FRIGATEBIRD","FRUITFULBOUGH","FRUITFULHARVEST","FRUITFULVINE","GEERTRUIDA","GEESKE","GENESIS","GENESISII","GEORGIADAWN","GEORGINAOFLADRAM","GLENDEVERON","GOLDENBELLS11","GOLDENGAINV","GOLDENREAPER","GONPEZI","GOODFELLOWSHIP","GOODHOPE","GOODINTENT","GOVENEKOFLADRAM","GRACEFUL","GRACIOUS","GRATEFUL","GREENPASTURES","GRIANANOIR","GUIDINGLIGHT","GUIDINGSTAR","HALCYON","HARVESTDAWN","HARVESTER","HARVESTHOPE","HARVESTMOON","HARVESTREAPERII","HAVILAH","HEATHERK","HEATHERSPRIG","HELENUS","HENDRIKAJACOBA","HENKSENIOR","HENRYMONTY","HERITAGE","HIGHLANDQUEEN","HONEYBOURNEIII","ILLUSTRIS","INCENTIVEII","INGENUITY","INTUITION","INVERDALE","ISLAS","JACOBA","JACOBAMARIA","JACQUELINEANNE","JAKARA","JANEOFLADRAM","JANNETJECORNELIS","JENISKA","JOLANNAM","JONGEJOHANNES","JOYOFLADRAM","JUBILEEQUEST","JULIAANNE","JULIAM","KARENANNIII","KARENN","KARENOFLADRAM","KAYLANA","KELLYOFLADRAM","KESTREL","KINGCHALLENGER","KINGEXPLORER","KINGFISHER","KIRKELLA","KOPALA","LAUNCHOUT","LAUREL","LEANNE","LIBERTY","LILYANNA","LOCHINCHARDIII","LOGIEN","LORNAJEAN","LOUISAN","LOUWESENIOR","LUCINDAANN","LUNARBOW","LYNNPRINCESS","MANUELLAURA","MARBLANCO","MAREATHER","MAREIXON","MARGARETANNE","MARGARETOFLADRAM","MARTINE","MERCURIUS","MIAJANEW","MICHAELEDWARD","MIKKELLOUISE","MINCHHUNTER","MOLLIEJAYNE","MONTEMAZANTEU","MONTYOFLADRAM","MORAYENDEAVOUR","MORNINGSTAR","MOYUNA","NATHALIE","NEELTJE","NEREUS","NIMROD","NJORDVENTURE","NORDSTJERNEN","NORLAN","NORTHERNDAWN","NORTHERNEAGLE","NORTHERNJOY","NORTHERNOSPREY","NORTHERNQUEST","NORTHERNSTAR","NORTHERNVENTURE","NORTHERNVIKING","NORTHSEA","NORTHSTAR","OCEANBOUNTY","OCEANCHALLENGE","OCEANENDEAVOUR","OCEANHARVEST","OCEANHARVESTER","OCEANPIONEER","OCEANPRIDE","OCEANQUEST","OCEANREAPERIV","OCEANROSE","OCEANSTAR","OCEANTRUST","OCEANUS","OCEANVENTURE","OCEANVISION","OCEANWAY","OGENITA","ONWARD","OPPORTUNEIV","ORION","ORLAROSE","ORLAS","OSPREY","OURANNA","OURGRACE","OURHAZEL","OURLASSIE","OURLASSIII","OURPAMELAJILL","OURPRIDE","PATRICIAMARTA","PEADARMARIE","PLEIADES","PORTUNUS","PRIMROSE","PROLIFIC","PROSPECTOR","PROSPERITY","PROSPEROUS","PROVIDER","QUANTUS","QUEENSBERRY","QUIETWATERS","QUOVADIS","RACHELOFLADRAM","RADIANCE","RADIANTMORN","RADIANTSTAR","REAPER","REBECCA","REBEKAHJAYNE","RELIANCE","RELIANCEIII","RENOWN","RENOWNJW","REPLENISH","RESEARCH","RESILIENT","RESOLUTE","RESOLUTION","REVIVAL","RIBHINNDONNII","RITAROSE","ROBINOFLADRAM","ROCCOREED","ROISMHAIRI","ROSEBLOOM","ROSEOFSHARON","ROYALSOVEREIGN","SAMOFLADRAM","SANCTAMARIA","SAPPHIREIV","SARAHH","SARALENA","SARDONYX","SEAGULL","SEAHARVESTER","SEASWALLOW","SEIONTA","SERAPHIM","SERENITY","SHALANNA","SHALIMARII","SHARONVALE","SHARYNLOUISE","SHAULORA","SHEIGRA","SHEKINAH","SHEMARAHII","SILVERCREST","SILVERCRESTII","SILVERDAWN","SILVERFERN","SILVERWAVE","SIRIUS","SIRMILES","SOLIDEOGLORIA","SPARKLINGLINE","SPARKLINGSTAR","SPARKLINGSTARIV","SPICA","STARAHBUCHAN","STAROFANNAN","STAROFJURA","STEADFAST","STEADFASTHOPE","STEFANIEM","STELISSA","STELLAMARIS","STELLAPOLARIS","STEPHANIE","STEPHOFLADRAM","STGEORGES","STILLOSTREA","STRATHMORE","STRATHYRE","SUCCESSIII","SUFFOLKCHIEFTAIN","SUMMERDAWNII","SUMMERROSE","SUNRISE","SUSAUNO","SYLVIABOWERS","TAHUME","TAITS","TIGERSII","TONNRUAIRI","TRANQUILITY","TRANQUILLITY","TRANSCEND","TREVESSAIV","TRUEVINE","TRUIVANHINTE","TWAGORDONS","TWILIGHT","UBEROUS","UDRA","UNITY","VALENTE","VALHALLA","VANDIJCK","VELLEE","VENTURE","VENTUREIV","VENTUROUS","VICTORYROSE","VIGILANT","VIKINGBORG","VIRTUOUS","VISIONV","VOYAGER","WAKEFUL","WESTERNPROMISE","WESTRAFJORD","WESTRO","WHITEHEATHERVI","WHITEROSE","WILLIAMHENRYII","WILLIAMOFLADRAM","WILLINGLAD","WINTEROFLADRAM","WIRON5","ZARONA","ZENITH","ZEPHYR"])

function tidy(raw){
  let s=(raw||'').toUpperCase()
  s=s.replace(/[._:\/]+/g,' ').replace(/\s*-\s*/g,' ').replace(/\s+/g,' ').trim()
  s=s.replace(/^(F ?V|M ?V|MFV|GV|SV|SFF GV|SFF|FB) /,'')
  return s.trim()
}
const displayName = raw => tidy(raw)                                   // keeps PLN, e.g. "GLENUGIE PD347"
const matchKey   = raw => tidy(raw).replace(/\s+[A-Z]{1,4} ?\d{1,4}$/,'').replace(/[^A-Z0-9]/g,'')

const fmt = d => d.toISOString().slice(0,10)
const ok  = b => ({ statusCode:200, body: typeof b==='string'?b:JSON.stringify(b) })

async function fetchPort(port, startDate, endDate, token){
  const out=[]; let offset=0; const limit=200
  for (let i=0;i<12;i++){
    const url=`${GFW}?limit=${limit}&offset=${offset}`
    const res=await fetch(url,{ method:'POST',
      headers:{ 'Authorization':`Bearer ${token}`, 'Content-Type':'application/json',
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

export const handler = async (event) => {
  const isHttp = !!(event && event.httpMethod)
  if (isHttp){
    const key=(event.queryStringParameters && event.queryStringParameters.key)||''
    if (!process.env.INGEST_SECRET || key!==process.env.INGEST_SECRET) return { statusCode:403, body:'forbidden' }
  }
  const token=process.env.GFW_API_TOKEN
  if (!token) return { statusCode:500, body:'GFW_API_TOKEN not set' }

  const now=new Date()
  const endDate=fmt(now)
  const startDate=fmt(new Date(now.getTime()-LOOKBACK_DAYS*864e5))

  const supabase=createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const summary={}; const rows=[]; const seen=new Set()
  try {
    for (const port of PORTS){
      const entries=await fetchPort(port, startDate, endDate, token)
      let kept=0
      for (const e of entries){
        const pv=e.port_visit||{}; const a=pv.endAnchorage||{}
        if (a.id!==port.id) continue                                  // only true departures from THIS port
        if (Number(pv.confidence||0) < MIN_CONFIDENCE) continue
        const v=e.vessel||{}; const raw=v.name||''
        if (!raw || !e.end) continue
        const isFish = v.type==='fishing'
        const inReg  = REGISTER.has(matchKey(raw))
        if (!isFish && !inReg) continue                               // not a fishing boat
        const name=displayName(raw)
        const date=String(e.end).slice(0,10)
        const dedup=`${name}|${date}`
        if (seen.has(dedup)) continue
        seen.add(dedup)
        rows.push({ fleet_id:FLEET_ID, vessel_name:name, departure_port:port.name,
                    departure_date:date, departed_at:e.end, source:'ais' })
        kept++
      }
      summary[port.name]={ raw:entries.length, kept }
    }

    let inserted=0
    if (rows.length){
      const { data, error }=await supabase.from('vessel_departures')
        .upsert(rows, { onConflict:'fleet_id,vessel_name,departure_date', ignoreDuplicates:true })
        .select('id')
      if (error) throw new Error('supabase: '+error.message)
      inserted=(data||[]).length
    }
    return ok({ window:`${startDate}..${endDate}`, ports:summary, candidates:rows.length, inserted })
  } catch (err){
    return { statusCode:502, body: JSON.stringify({ error:String(err && err.message || err), ports:summary }) }
  }
}
