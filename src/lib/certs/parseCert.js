// Auto-parse a photo/PDF of a crew certificate via the existing Anthropic
// vision proxy (netlify/functions/parse). Returns the extracted fields for the
// skipper to review before saving — cert layouts vary too much to trust blind.

const PROMPT = `You are reading a maritime / commercial fishing crew certificate or qualification (e.g. ENG1 medical, STCW basic safety training, sea survival / personal survival techniques, fire prevention & fire fighting, elementary first aid, proficiency in survival craft, GMDSS, deck or engine certificate of competency).

Return ONLY a JSON object — no markdown, no commentary — with exactly these keys:
{
  "cert_type":   "short human name of the certificate (use the document's own title if clearer)",
  "cert_number": "certificate or reference number, or null",
  "holder_name": "the crew member's full name as printed, or null",
  "issuer":      "issuing authority / approved training centre / examining doctor, or null",
  "issue_date":  "issue or examination date as YYYY-MM-DD, or null",
  "expiry_date": "expiry / valid-until date as YYYY-MM-DD, or null"
}

Rules:
- All dates must be ISO YYYY-MM-DD.
- If only an issue date and a validity period are shown (e.g. "valid for 5 years"), compute the expiry date.
- If a field is genuinely absent, use null. Do not guess.`

const fileToB64 = (f) => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(String(r.result).split(',')[1])
  r.onerror = rej
  r.readAsDataURL(f)
})

function extractJson(text) {
  const t = String(text || '')
  const a = t.indexOf('{')
  const z = t.lastIndexOf('}')
  if (a < 0 || z < a) throw new Error('No JSON found in the parser response')
  return JSON.parse(t.slice(a, z + 1))
}

const isoOrNull = (v) => {
  const m = String(v || '').match(/(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

import { applyCertExpiryRule } from './certRules'

// file -> { cert_type, cert_number, holder_name, issuer, issue_date, expiry_date, expiry_source }
export async function parseCertFile(file) {
  const media = await fileToB64(file)
  const mediaType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
  const resp = await fetch('/.netlify/functions/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media, mediaType, prompt: PROMPT }),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.error || `Parser error ${resp.status}`)
  const j = extractJson(data.text)
  const base = {
    cert_type: (j.cert_type || '').toString().trim(),
    cert_number: (j.cert_number || '').toString().trim() || null,
    holder_name: (j.holder_name || '').toString().trim() || null,
    issuer: (j.issuer || '').toString().trim() || null,
    issue_date: isoOrNull(j.issue_date),
    expiry_date: isoOrNull(j.expiry_date),
  }
  // Fill the expiry from the cert-type rule when the document didn't print one
  // (lifetime tickets stay blank; basic-safety certs get +3 years; ENG1 keeps its printed date).
  const ruled = applyCertExpiryRule(base)
  return { ...base, expiry_date: ruled.expiry_date, expiry_source: ruled.expiry_source }
}

// ---- Vessel certificates -------------------------------------------------
// A separate prompt from the crew one. Vessel papers are a different animal:
// registry, insurance, liferaft service, fire equipment, tonnage — and they
// name the SHIP, not a person, so asking for a holder just invites the model
// to put the boat's name in a field meant for a crewman.
const VESSEL_PROMPT = `You are reading a certificate belonging to a FISHING VESSEL itself (not to a crew member). Examples: UK Certificate of Registry, Certificate of Insurance, wreck-removal financial security, ILO 188 Document of Compliance, Record of Particulars, liferaft service or inspection certificate, lifejacket service certificate, fire extinguisher or fixed fire-suppression commissioning/maintenance certificate, ships medical stores certificate, certificate of measurement, builder's certificate, antifouling.

Return ONLY a JSON object — no markdown, no commentary — with exactly these keys:
{
  "cert_type":   "short human name of the certificate, using the document's own title",
  "cert_number": "certificate, official or reference number, or null",
  "issuer":      "issuing authority, insurer, service company or surveyor, or null",
  "issue_date":  "issue, examination or service date as YYYY-MM-DD, or null",
  "expiry_date": "expiry / valid-until / next-service-due date as YYYY-MM-DD, or null",
  "category":    "one of: Statutory, Insurance, Safety, Equipment, Other",
  "notes":       "anything printed that limits the certificate — a crew size it covers, a category, a stated validity period — or null"
}

Rules:
- All dates must be ISO YYYY-MM-DD.
- If only an issue date and a validity period are shown (e.g. "valid for 12 months"), compute the expiry date.
- Registry, tonnage, measurement, builder's and compliance documents are Statutory. Insurance and financial-security cover is Insurance. Liferafts, lifejackets, fire equipment and medical stores are Safety.
- If a field is genuinely absent, use null. Do not guess.`

// file -> { cert_type, cert_number, issuer, issue_date, expiry_date, category, notes }
export async function parseVesselCertFile(file) {
  const media = await fileToB64(file)
  const mediaType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
  const resp = await fetch('/.netlify/functions/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media, mediaType, prompt: VESSEL_PROMPT }),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.error || `Parser error ${resp.status}`)
  const j = extractJson(data.text)
  const CATS = ['Statutory', 'Insurance', 'Safety', 'Equipment', 'Other']
  const cat = (j.category || '').toString().trim()
  return {
    cert_type: (j.cert_type || '').toString().trim(),
    cert_number: (j.cert_number || '').toString().trim() || null,
    issuer: (j.issuer || '').toString().trim() || null,
    issue_date: isoOrNull(j.issue_date),
    expiry_date: isoOrNull(j.expiry_date),
    // Never let the model invent a bucket that isn't pickable on the page.
    category: CATS.includes(cat) ? cat : 'Other',
    notes: (j.notes || '').toString().trim() || null,
  }
}
