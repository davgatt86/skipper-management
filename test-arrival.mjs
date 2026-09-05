import { arrivalFromName, arrivalSubject } from './src/lib/invoices/arrival.js'

let bad = 0
const ok = (name, cond) => { console.log((cond ? '  ok    ' : '  FAIL  ') + name); if (!cond) bad++ }
const day = (n) => (n ? String(n).slice(0, 10) : n)

/* The real names, off the two David uploaded and off the Drive folder. */
ok('reads the real 2015 name',
   day(arrivalFromName('2015-04-24 SKM_C224e15042414370.pdf')) === '2015-04-24')
ok('reads the other one',
   day(arrivalFromName('2015-12-15 SKMBT_C35151215141800.pdf')) === '2015-12-15')
ok('reads a weekly bundle',
   day(arrivalFromName('2026-08-31 20260831082919614.pdf')) === '2026-08-31')
ok('reads a single invoice with spaces in its name',
   day(arrivalFromName('2019-02-28 Invoice 26919 from FRASERBURGH HARBOUR COMMISSIONERS - 31_10_2018.pdf')) === '2019-02-28')

/* NULL, NOT TODAY. The whole point is that a bundle whose date is unknown must
   not be given one that looks exactly like a real one. */
ok('no prefix gives null', arrivalFromName('SKM_C3350170728085100.pdf') === null)
ok('empty gives null',     arrivalFromName('') === null)
ok('undefined gives null', arrivalFromName(undefined) === null)
ok('a date with no space after it does not count',
   arrivalFromName('2015-04-24_SKM.pdf') === null)
ok('a date in the middle does not count',
   arrivalFromName('scan 2015-04-24 x.pdf') === null)

/* A NAME CAN LIE. Checked as a real date rather than as digits, so a bad one is
   refused here instead of by Postgres at the end of an upload of hundreds. */
ok('month 13 is refused',  arrivalFromName('2015-13-01 x.pdf') === null)
ok('31 February is refused', arrivalFromName('2015-02-31 x.pdf') === null)
ok('29 Feb in a leap year is fine',
   day(arrivalFromName('2016-02-29 x.pdf')) === '2016-02-29')
ok('29 Feb in a common year is refused',
   arrivalFromName('2015-02-29 x.pdf') === null)

/* NOT FROM THE FUTURE — a scanner with its clock wrong would otherwise sit at
   the top of the arrivals list for ever. */
const nextYear = new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString().slice(0, 10)
ok('a future date is refused', arrivalFromName(nextYear + ' x.pdf') === null)
ok('today is accepted',
   day(arrivalFromName(new Date().toISOString().slice(0, 10) + ' x.pdf')) !== null)

/* Midnight UTC, so the day cannot slip backwards for a reader west of Greenwich. */
ok('lands on midnight UTC',
   arrivalFromName('2015-04-24 x.pdf') === '2015-04-24T00:00:00.000Z')

/* KNOWN AND UNKNOWN MUST NOT READ ALIKE. */
ok('a read date says so',   /arrived 2015-04-24/.test(arrivalSubject('2015-04-24 x.pdf')))
ok('an unknown one says so', /unknown/.test(arrivalSubject('x.pdf')))
ok('the two subjects differ', arrivalSubject('2015-04-24 x.pdf') !== arrivalSubject('x.pdf'))

console.log(bad ? '\n' + bad + ' FAILURES' : '\nall ' + 18 + ' checks passed')
process.exit(bad ? 1 : 0)
