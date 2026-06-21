// Renewal status for a certificate from its expiry date.
// Warning starts 60 days before expiry (David's choice).
export const CERT_LEAD_DAYS = 60

export function certStatus(expiry, lead = CERT_LEAD_DAYS) {
  if (!expiry) return { state: 'none', days: null, label: 'No expiry', color: 'var(--grey-400)' }
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const exp = new Date(String(expiry).slice(0, 10) + 'T00:00:00')
  const days = Math.round((exp - today) / 86400000)
  if (days < 0) return { state: 'expired', days, label: days === -1 ? 'Expired yesterday' : `Expired ${-days}d ago`, color: 'var(--red)' }
  if (days === 0) return { state: 'due', days, label: 'Expires today', color: 'var(--red)' }
  if (days <= lead) return { state: 'due', days, label: `Due in ${days}d`, color: 'var(--amber)' }
  return { state: 'valid', days, label: `Valid · ${days}d left`, color: 'var(--green)' }
}

// Sort key so the most urgent (expired, then soonest) come first; no-expiry last.
export function certUrgency(expiry) {
  const s = certStatus(expiry)
  if (s.days == null) return Number.POSITIVE_INFINITY
  return s.days
}
