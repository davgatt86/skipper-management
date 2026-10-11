/* WHY A NOTE CAME BACK EMPTY — the three outcomes, told apart.
 *
 * Written after Sandy McLeman uploaded six real Hanstholm notes in Aug 2026
 * and got `no rows parsed (Unscannable)` — a message that names an internal
 * label, asserts nothing about the file and tells him nothing to do. He could
 * not report the error because the message was not one.
 *
 * The assertions that matter most are the NEGATIVE ones: the no-text case must
 * never be reported as a fault in the app, and the recognised-market case must
 * never be reported as a fault in the file. Getting those two the wrong way
 * round sends the skipper chasing the office for a document that was fine, or
 * leaves a real bug sitting on his side of the fence.
 */
import assert from 'node:assert'
import { whyNoRows, noRowsLine } from './src/lib/salesNoRows.js'

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); n++ }

/* ---- the three codes ------------------------------------------------- */
eq(whyNoRows({ market: 'Unscannable', rows: [] }).code, 'noText', 'no text layer')
eq(whyNoRows({ market: 'Unknown', rows: [] }).code, 'unknown', 'text, unrecognised market')
eq(whyNoRows({ market: 'Hanstholm Afregning', rows: [] }).code, 'noRows', 'market read, nothing came off')
eq(whyNoRows({ market: 'Don Fishing · Peterhead', rows: [] }).code, 'noRows', 'any named market')

/* A missing or empty result is not a claim that the file is unreadable — it is
 * simply unknown, which is the honest of the two. */
eq(whyNoRows(undefined).code, 'unknown', 'no result at all')
eq(whyNoRows({}).code, 'unknown', 'no market on the result')

/* ---- whose problem it is --------------------------------------------- */
eq(whyNoRows({ market: 'Unscannable' }).ours, false, 'nothing here can ever read a file with no text')
eq(whyNoRows({ market: 'Unknown' }).ours, true, 'a format nobody taught it is ours to add')
eq(whyNoRows({ market: 'Hanstholm' }).ours, true, 'a market it claims to read is ours to fix')

/* ---- what the skipper is told ---------------------------------------- */
const noText = whyNoRows({ market: 'Unscannable' }).say
ok(/no text/i.test(noText), 'says the file carries no text')
ok(/original/i.test(noText), 'says to get the original')
ok(/scan|photo|printed/i.test(noText), 'names the kinds of copy that do this')

/* IT MUST NOT ASSERT A CAUSE IT CANNOT SEE. Sandy's six were printed through
 * Bullzip, which is knowable only from the metadata and is not what the check
 * measures — the check measures that there is no text. A message naming a
 * print driver would be wrong the first time somebody photographs a note. */
for (const word of ['Bullzip', 'Ghostscript', 'driver']) {
  ok(!new RegExp(word, 'i').test(noText), `does not blame ${word}`)
}

/* And it must not read as the app being broken, which is exactly how the old
 * wording read and why nobody could report it. */
for (const word of ['error', 'failed', 'bug', 'Unscannable']) {
  ok(!new RegExp(word, 'i').test(noText), `does not say "${word}" about a file nothing can read`)
}

/* The other way round: a market the app claims to read, then nothing off it,
 * IS ours, and says so rather than leaving it looking like a bad file. */
const mine = whyNoRows({ market: 'Hanstholm Afregning' }).say
ok(/fault here/i.test(mine), 'owns a fault in a format it claims to read')
ok(/Hanstholm Afregning/.test(mine), 'names the format it thought it had')

/* ---- the log line ----------------------------------------------------- */
const line = noRowsLine('INS 353 06-08-2026.pdf', { market: 'Unscannable', rows: [] })
ok(line.includes('INS 353 06-08-2026.pdf'), 'names the file')
ok(!/\(Unscannable\)/.test(line), 'no internal market label in the line')
ok(line.length > 80, 'the line is an explanation, not a code')

console.log(`test-sales-norows: ${n} checks passed`)
