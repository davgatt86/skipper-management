// Default expiry rules for crew certificates, applied when the certificate
// itself does not print an expiry date. David's regime:
//   - Deck / Engineer Officer Certificate of Competency -> lifetime (no expiry)
//   - Seafarer medical (ENG1)                            -> always use the printed expiry
//   - All basic safety certificates                      -> 3 years from completion
//     (Safety Awareness, Basic Fire Fighting & Prevention, Elementary First Aid,
//      Personal Survival Techniques, sea survival, etc.)
//
// Each rule is matched against the parsed cert_type text. Order matters:
// competency and medical are checked before the broad safety matcher.

export const CERT_RULES = [
  {
    id: 'coc',
    label: 'Certificate of Competency — lifetime',
    lifetime: true,
    years: null,
    test: /(certificate of competency|deck officer|engineer(?:ing)? officer|class\s*[12]\b|skipper'?s?\s*(?:full|ticket|certificate)|second hand)/i,
  },
  {
    id: 'medical',
    label: 'Seafarer medical (ENG1) — printed expiry',
    printedOnly: true,
    years: null,
    test: /(eng\s?-?1\b|seafarer medical|ml\s?-?5\b|medical fitness|medical certificate)/i,
  },
  {
    id: 'safety',
    label: 'Basic safety certificate — 3-year refresh',
    years: 3,
    test: /(safety awareness|accident prevention|fire[\s-]?fighting|fire prevention|first aid|sea survival|personal survival|survival techniques|survival craft|basic safety|sea ?survival|stcw|proficiency)/i,
  },
]

function addYears(iso, n) {
  if (!iso || n == null) return null
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  if (isNaN(d)) return null
  d.setFullYear(d.getFullYear() + n)
  return d.toISOString().slice(0, 10)
}

export function matchCertRule(certType) {
  return CERT_RULES.find((r) => r.test.test(String(certType || ''))) || null
}

// Given parsed fields, return the expiry to use plus where it came from.
//   expiry_source: 'printed' | 'rule-3yr' | 'lifetime' | 'manual'
// 'manual' means we couldn't derive it and the skipper should set it.
export function applyCertExpiryRule({ cert_type, issue_date, expiry_date }) {
  if (expiry_date) return { expiry_date, expiry_source: 'printed', lifetime: false }
  const rule = matchCertRule(cert_type)
  if (rule?.lifetime) return { expiry_date: null, expiry_source: 'lifetime', lifetime: true }
  if (rule?.printedOnly) return { expiry_date: null, expiry_source: 'manual', lifetime: false }
  if (rule?.years && issue_date) {
    const e = addYears(issue_date, rule.years)
    if (e) return { expiry_date: e, expiry_source: `rule-${rule.years}yr`, lifetime: false }
  }
  return { expiry_date: null, expiry_source: 'manual', lifetime: false }
}

export const EXPIRY_SOURCE_LABEL = {
  printed: 'from certificate',
  'rule-3yr': 'auto · 3-year refresh',
  lifetime: 'lifetime — no expiry',
  manual: 'set by hand',
}
