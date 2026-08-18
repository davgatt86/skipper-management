/* Re-ingest a sales note that was parsed by an older parser, as SQL.
 *
 * The CloudMailin webhook already self-heals — re-forwarding a note re-parses
 * it and replaces its rows in place. This is the same operation for notes that
 * cannot be re-forwarded, run from the PDF on disk: it prints the SQL rather
 * than executing it, so the change can be read before it is applied.
 *
 * REPLACE IN PLACE, NEVER DELETE THE LANDING. The landing keeps its id, so
 * days-at-sea, the crew-landing link and any manual edits survive. Only the
 * rows and the header totals are rewritten.
 *
 *   node scripts/reingest-sql.mjs <note.pdf> <landing-uuid> <fleet-uuid> [aliases.json]
 *
 * `aliases.json` is the fleet's rows from sales_buyer_flags — the same merges
 * the ingest path applies, because a re-ingest must not undo them.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { canonBuyerFrom } from '../src/lib/buyerAliases.js'

const require = createRequire(import.meta.url)
const ParseCore = require('../src/lib/parse-core.cjs')

const [, , file, landingId, fleetId, aliasFile] = process.argv
if (!file || !landingId || !fleetId) {
  console.error('usage: node scripts/reingest-sql.mjs <note.pdf> <landing-uuid> <fleet-uuid> [aliases.json]')
  process.exit(1)
}

const res = await ParseCore.parsePdf(
  new Uint8Array(readFileSync(file)), pdfjsLib, file.split(/[\\/]/).pop())

const canonBuyer = canonBuyerFrom(aliasFile ? JSON.parse(readFileSync(aliasFile, 'utf8')) : [])
const dkk = res.meta.currency === 'DKK'
const rec = res.reconcile || {}
const tot = res.rows.reduce((a, r) => ({
  boxes: a.boxes + (r.boxes || 0),
  weight: a.weight + (r.total_weight || 0),
  value: a.value + (r.total_value || 0),
}), { boxes: 0, weight: 0, value: 0 })
const r2 = (n) => Math.round(n * 100) / 100

const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`)
const n = (v) => (v == null || Number.isNaN(Number(v)) ? 'null' : String(Number(v)))

console.error(`parser  ${ParseCore.VERSION}`)
console.error(`market  ${res.market}   vessel ${res.meta.vessel}   date ${res.meta.isoDate}`)
console.error(`rows    ${res.rows.length}`)
console.error(`totals  ${r2(tot.boxes)} boxes  ${r2(tot.weight)} kg  £${r2(tot.value)}`)
console.error(`reconc  ${JSON.stringify(rec)}`)
if (rec.found && !rec.ok) console.error('WARNING: still does not reconcile — do not apply blind.')

const values = res.rows.map((r) => '(' + [
  q(landingId), q(fleetId), q(canonBuyer(r.buyer)), q(r.species || ''),
  q(r.species_canon || r.species || ''), q(r.presentation || ''), q(r.grade || ''),
  n(r.boxes || 0), n(r.box_weight || 0), n(r.total_weight || 0),
  n(dkk ? 0 : (r.price_per_kg || 0)), n(dkk ? 0 : (r.price_per_box || 0)),
  n(dkk ? 0 : (r.total_value || 0)), r.msc ? 'true' : 'false',
  n(dkk ? (r.total_value || 0) : null), n(dkk ? (r.price_per_kg || 0) : null),
].join(',') + ')').join(',\n')

const diff = rec.found
  ? JSON.stringify({ expected: rec.expected, actual: rec.actual, diffs: rec.diffs, basis: rec.boxBasis || null })
  : null

console.log(`-- ${file.split(/[\\/]/).pop()} · parser ${ParseCore.VERSION} · ${res.rows.length} rows
-- ${r2(tot.boxes)} boxes · ${r2(tot.weight)} kg · £${r2(tot.value)} · reconciles: ${rec.found ? rec.ok : 'no total on note'}
begin;

delete from public.sales_rows where landing_id = ${q(landingId)};

insert into public.sales_rows
  (landing_id, fleet_id, buyer, species, species_canon, presentation, grade,
   boxes, box_weight, weight_kg, price_per_kg, price_per_box, value, msc, value_dkk, ppk_dkk)
values
${values};

update public.sales_landings set
  boxes = ${n(r2(tot.boxes))},
  weight_kg = ${n(r2(tot.weight))},
  value = ${dkk ? '0' : n(r2(tot.value))},
  reconcile_ok = ${rec.found ? String(rec.ok) : 'null'},
  reconcile_diff = ${diff ? q(diff) + '::jsonb' : 'null'}
where id = ${q(landingId)};

commit;`)
