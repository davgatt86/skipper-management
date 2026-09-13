/* THE READER'S TENANT BOUNDARY, ASSERTED AS SOURCE.
 *
 * `su-parse-document` runs on the SERVICE-ROLE KEY, so storage RLS never sees
 * its download and no policy anywhere can stand in for the check inside it.
 * That makes this the one boundary in the app with nothing behind it — and it
 * shipped covering certificates only, so any signed-in login could hand in a
 * path from another boat's folder and have the reader extract it.
 *
 * There is no way to run the function from here: it needs a real skipper's
 * JWT. So this asserts the SHAPE of the guard in the source, the way
 * `test-gmail-script.mjs` asserts its regex as a literal — it cannot prove the
 * function refuses, and it does prove nobody has quietly narrowed the guard
 * back to certificates or moved it after the job is made.
 */
import { readFileSync } from 'node:fs'

const src = readFileSync(process.argv[2] || 'supabase/functions/su-parse-document/index.ts', 'utf8')
const serve = src.slice(src.indexOf('Deno.serve'))
let pass = 0, bad = 0
const ok = (cond, why) => {
  if (cond) { pass++; console.log('  ok    ' + why) }
  else { bad++; console.log('  FAIL  ' + why) }
}

const guardAt = serve.indexOf('admin.auth.getUser')
const insertAt = serve.indexOf('su_parse_jobs").insert')
ok(guardAt > 0, 'the caller is resolved from the Authorization header')
ok(insertAt > guardAt, 'and resolved BEFORE a job is made — a refusal costs no read')
ok(!/if \(doc_type === "vessel_cert_bundle"\) \{\s*\n\s*const auth/.test(serve),
   'the guard is not gated behind the certificate bundle alone')
ok(/me\.role !== "skipper"/.test(serve), 'only a skipper reads any of these documents')
ok(/su_boats"\)\.select\("id"\)\.in\("id", folders\)\.eq\("fleet_id", me\.fleet_id\)/.test(serve),
   'a su-documents folder must be a boat in the caller’s own fleet')
ok(/su_fleet_agents"\)\.select\("boat_id"\)[\s\S]{0,80}agent_fleet_id", me\.fleet_id/.test(serve),
   'OR a boat their fleet holds an agent grant over — su_visible_boat() mirrored, since it cannot be called on the service-role key')
ok(/const isUuid = /.test(serve) && serve.indexOf('const isUuid') < serve.indexOf('su_boats")'),
   'a folder that is not a uuid is refused before it reaches .in(), which would error rather than match nothing')
ok(/insert\(\{ doc_type: doc_type \|\| "settlement", fleet_id: me\.fleet_id \}\)/.test(serve),
   'the job carries the caller’s fleet — the column the poll policy checks')

/* THE ENGINE ROOM SHEET — the one read an officer may start, and so the one
   place the role check opens. It must open by exactly that much. */
ok(/if \(doc_type === "engine_sheet"\) \{\s*if \(!\["skipper", "officer", "engineer"\]\.includes\(me\.role\)\)/.test(serve),
   'an engine room sheet may be read by the skipper or an officer, and by no other role')
ok(/if \(doc_type === "vessel_cert_bundle" \|\| doc_type === "engine_sheet"\) \{\s*if \(folders\.some\(\(f\) => f !== me\.fleet_id\)\)/.test(serve),
   'an engine sheet photo must sit in the caller’s own fleet folder')
const readInsertAt = serve.indexOf('engine_sheet_reads").insert')
ok(readInsertAt > guardAt && readInsertAt > serve.indexOf('folders.some((f) => f !== me.fleet_id)'),
   'and its read is made only after both checks')
ok(/engine_sheet_reads"\)\.insert\(\{ fleet_id: me\.fleet_id, file_path: String\(paths\[0\]\), created_by: uid/.test(serve),
   'the read carries the caller’s fleet and who took the photo')
ok(/const fields = cleanFields\(rawFields\);\s*if \(!fields\)/.test(serve),
   'the rows the client asks for are cleaned, and a list that does not parse is refused')

console.log(`reader guard: ${pass} checks passed`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
