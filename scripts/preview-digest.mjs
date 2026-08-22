/* Render the digest exactly as it will be sent, without sending it.
 *
 * The template is LIFTED OUT OF THE REAL FUNCTION rather than copied here, so
 * the preview cannot drift from what actually goes out. If someone edits
 * renderEmail(), this picks the change up on the next run.
 *
 *   node scripts/preview-digest.mjs [outfile.html]
 *
 * Alerts are read from stdin as JSON when piped, otherwise the sample below is
 * used. Nothing here touches the network or the database.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeOut } from './safeOut.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'netlify/functions/alert-digest.js'), 'utf8')

// Pull the two pure pieces out of the function source.
const grab = (re, what) => {
  const m = src.match(re)
  if (!m) { console.error(`could not find ${what} in alert-digest.js`); process.exit(1) }
  return m[0]
}
const escFn = grab(/const esc = [\s\S]*?\n/, 'esc()')
const renderFn = grab(/function renderEmail\(fleetName, alerts\) \{[\s\S]*?\n\}/, 'renderEmail()')

const SITE = process.env.SITE_URL || 'https://skippermanagement.co.uk'
const renderEmail = new Function('SITE', `${escFn}\n${renderFn}\nreturn renderEmail`)(SITE)

const sample = [
  { severity: 'warn', title: 'Certificate of Insurance expired', body: 'Expired on 31-03-2026 (129 days overdue) · NorthStandard Limited Trading as Sunderland Marine' },
  { severity: 'info', title: 'Portable Fire Extinguisher Commissioning/Maintenance Certificate due', body: 'Expires 26-08-2026 (19 days) · MARASAFE' },
]

const argFile = process.argv[2] || join(root, 'digest-preview.html')
safeOut(argFile, '.html')
let alerts = sample
if (!process.stdin.isTTY) {
  const raw = readFileSync(0, 'utf8').trim()
  if (raw) alerts = JSON.parse(raw)
}

const fleet = process.env.PREVIEW_FLEET || 'AUDACIOUS BF83'
const overdue = alerts.filter((a) => a.severity === 'warn').length
const subject = overdue
  ? `${fleet} — ${overdue} overdue, ${alerts.length} in total`
  : `${fleet} — ${alerts.length} falling due`

writeFileSync(argFile, renderEmail(fleet, alerts))
console.log(`subject: ${subject}`)
console.log(`written : ${argFile}  (${alerts.length} alerts, ${overdue} overdue)`)
