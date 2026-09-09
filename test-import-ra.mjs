import assert from 'node:assert'
import { toRows, hazardsFromRows, titleFromCover, COLUMNS } from './src/lib/certification/importRa.js'

let n = 0
const ok = (c, why) => { assert.ok(c, why); n++ }
const eq = (a, b, why) => { assert.deepStrictEqual(a, b, why); n++ }

/* A pdf.js text item, at a real x from the measured columns. */
const at = (x, y, str) => ({ str, transform: [0, 0, 0, 0, x, y] })

/* ---- THE COLUMNS ARE POSITIONAL, NOT DELIMITED -------------------------
 * Grouped by line alone these interleave into nonsense, because a wrapped cell
 * puts the tail of column two beside the tail of column four. This is the real
 * shape off the Shooting and Hauling sheet.
 */
{
  const items = [
    at(45, 500, '9'), at(125, 500, 'Gear coming stuck on sea bed'),
    at(283, 500, 'Falling into the water leading to'), at(456, 500, 'lifejackets to be worn on deck. crew'),
    at(621, 500, 'Drowning or serious'), at(734, 500, 'Medium Risk'),
    at(45, 488, '18/07/2023'), at(283, 488, 'hypothermia or drowning'),
    at(456, 488, 'trained on man overboard'), at(621, 488, 'injury'),
    at(45, 470, 'Comments:'),
  ]
  const [h] = hazardsFromRows(toRows(items))

  eq(h.hazard, 'Gear coming stuck on sea bed', 'the hazard comes out of column two whole')
  /* THE CONTINUATION LINE BELONGS TO ITS OWN COLUMN. Joined by line it would
     read "Falling into the water leading to lifejackets to be worn on deck". */
  eq(h.controls, 'lifejackets to be worn on deck. crew trained on man overboard',
     'and the controls out of column four, wrap and all')
  eq(h.consequence, 'Falling into the water leading to hypothermia or drowning. Drowning or serious injury',
     'the two consequence columns are folded into one')
  eq(h.sourceLevel, 'Medium', 'the worded level is kept, without the word Risk')
  eq(h.assessedOn, '2023-07-18', 'and the date under the id is read as a date')
}

/* ---- UNRATED, AND THAT IS THE POINT ------------------------------------
 * David: leave them unrated and he will score them in the app. A Low/Medium/
 * High turned into a likelihood and a severity would be an invention wearing
 * his judgement's clothes, and `rating()` would then report it as if somebody
 * had scored it.
 */
{
  const items = [at(45, 9, '3'), at(125, 9, 'Noise'), at(734, 9, 'High Risk')]
  const [h] = hazardsFromRows(toRows(items))
  ok(!('likelihood' in h), 'the parser returns no likelihood at all')
  ok(!('severity' in h), 'and no severity')
  eq(h.sourceLevel, 'High', 'only the words that were on the page')
}

/* ---- FURNITURE IS NOT CONTENT ------------------------------------------ */
{
  const items = [
    at(45, 60, 'Risk id'), at(125, 60, 'Hazard Area/Activity'), at(734, 60, 'Risk Level'),
    at(45, 50, '6'), at(125, 50, 'Hot surfaces'), at(456, 50, 'gloves to be worn'),
    at(45, 40, 'Comments:'),
    at(45, 30, 'Reviewed by:'), at(283, 30, 'Checked by:'), at(456, 30, 'Date:'),
    at(45, 20, 'Powered by TCPDF (www.tcpdf.org)'),
  ]
  const out = hazardsFromRows(toRows(items))
  eq(out.length, 1, 'the repeating header, the signature line and the footer are not hazards')
  eq(out[0].hazard, 'Hot surfaces', 'only the row with a risk id on it is')
}

/* ---- A NEW ID OPENS A NEW HAZARD --------------------------------------
 * Aegir's "Risk id" REPEATS — it is a category number, not a key. Nine hazards
 * on the Engine Room sheet share id 6, so it must never be used to identify a
 * hazard, only to spot where one begins.
 */
{
  const items = [
    at(45, 90, '6'), at(125, 90, 'Head level obstructions'),
    at(45, 80, '6'), at(125, 80, 'Hot surfaces'),
    at(45, 70, '6'), at(125, 70, 'Noise'),
  ]
  const out = hazardsFromRows(toRows(items))
  eq(out.map((h) => h.hazard), ['Head level obstructions', 'Hot surfaces', 'Noise'],
     'three hazards sharing one id are still three hazards')
  eq(new Set(out.map((h) => h.ref)).size, 1, 'and the id really is the same on all three')
}

/* ---- NOTHING IS INVENTED ----------------------------------------------- */
{
  eq(hazardsFromRows([]), [], 'no rows gives no hazards')
  eq(hazardsFromRows(toRows([])), [], 'and no items gives no rows')
  const [h] = hazardsFromRows(toRows([at(45, 5, '1'), at(125, 5, 'Bare hazard')]))
  eq(h.controls, '', 'a hazard with no controls read carries an empty string, not a guess')
  eq(h.sourceLevel, null, 'and no level at all rather than a default')
}

/* ---- THE TITLE OFF THE COVER ------------------------------------------- */
{
  eq(titleFromCover(['Risk Assessment Review', 'for Shooting and Hauling', 'AUDACIOUS – BF83']),
     'Shooting and Hauling', 'the title is read off the cover page')
  eq(titleFromCover(['nothing useful']), '', 'and is empty rather than wrong when it is not there')
}

/* ---- THE BANDS ARE MEASURED, NOT GUESSED ------------------------------- */
{
  eq(COLUMNS.map((c) => c.from), [0, 120, 280, 450, 615, 730],
     'the six columns start where the real documents put them')
  eq(COLUMNS.length, 6, 'six columns on the Aegir sheet')
}

console.log('import ra: ' + n + ' checks passed')
