import { readFileSync } from 'node:fs'
import {
  familyOf, normNumber, mapBundle, matchBundle, defaultPick, uncoveredPages,
  attachFor, draftFor, fileStillUsed, withPage,
} from './src/lib/certs/bundle.js'

/* THE FIXTURES ARE THE REAL ONES, AND THERE IS ONE COPY OF THEM.
 *
 * `scripts/fixtures/lsa-bundle.json` holds Audacious's seventeen vessel
 * certificates as the database held them on 11-09-2026, and what the six pages
 * of `L.S.A Certs.pdf` actually print, read off the scan by eye before the
 * reader was changed. The rendered preview reads the same file, so the test and
 * the picture cannot drift apart. A fixture written from the module proves the
 * logic and nothing about the documents; this repo has three suites that passed
 * while the page was wrong for exactly that reason.
 */
const FIX = JSON.parse(readFileSync(new URL('./scripts/fixtures/lsa-bundle.json', import.meta.url), 'utf8'))
const onFile = FIX.onFile
const READ = FIX.read
const TODAY = FIX.asOf

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(a === b, `${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

eq(onFile.length, 17, 'the fixture holds all seventeen certificates on file')
eq(READ.certificates.length, FIX.pageCount, 'and one certificate per page of the bundle')

/* ---- what kind of certificate ------------------------------------------ */
eq(familyOf('Inflatable Liferaft Service Certificate'), 'liferaft', 'Marasafe liferaft title')
eq(familyOf('Liferaft Inspection & Service Schedule'), 'liferaft', 'and Seago\'s different title for the same thing')
eq(familyOf('SERVICE CERTIFICATE - LIFEJACKET'), 'lifejacket', 'the lifejacket record as filed')
eq(familyOf('SHIPS MEDICAL STORES CERTIFICATE'), 'medical', 'medical stores')
eq(familyOf('Gaseous Fire Suppression System Commissioning/Maintenance Certificate'), 'suppression', 'fixed suppression')
eq(familyOf('Portable Fire Extinguisher Commissioning/Maintenance Certificate'), 'extinguisher', 'portable extinguishers are not the fixed system')
/* WRECK BEFORE INSURANCE: both wreck certificates on file say "insurance". */
eq(familyOf('Certificate of Insurance or other financial security in respect of liability for the removal of wrecks'), 'wreck', 'the MCA wreck certificate is wreck, not insurance')
eq(familyOf('Certificate Furnished as Evidence of Insurance Pursuant to Article 12 of the Nairobi International Convention on the Removal of Wrecks, 2007'), 'wreck', 'and so is the Nairobi one')
eq(familyOf('Certificate of Insurance'), 'insurance', 'while the plain certificate of insurance is insurance')
eq(familyOf('Record of Particulars of a Fishing Vessel'), 'particulars', 'particulars are not the fishing vessel certificate')
eq(familyOf('UK Fishing Vessel Cert'), 'fishing', 'the UKFVC')
eq(familyOf('ILO Work in Fishing Convention (ILO 188) Document of Compliance'), 'ilo188', 'ILO 188')
eq(familyOf('TBT-Free Antifouling'), 'antifouling', 'antifouling')
eq(familyOf(''), null, 'no title, no kind')
eq(familyOf('Something Nobody Has Heard Of'), null, 'an unknown title has no kind rather than a guessed one')

/* Every title actually on file resolves to a kind. A certificate on the record
   with no kind could never be recognised as renewed by anything in a bundle. */
ok(onFile.every((r) => familyOf(r.cert_type)), 'every certificate on file has a kind')

/* ---- numbers ------------------------------------------------------------ */
eq(normNumber(' 3134 '), '3134', 'whitespace does not make a different number')
eq(normNumber('2026/SM/UK/M002470'), '2026SMUKM002470', 'punctuation is ignored')
eq(normNumber('1'), null, 'a one-character number identifies nothing')
eq(normNumber(null), null, 'no number is no number')

/* ---- cleaning the read ------------------------------------------------- */
const read = mapBundle(READ, FIX.pageCount)
eq(read.length, 6, 'six certificates off six pages')
eq(read[2].expiry_date, '2026-07-01', 'the month-only expiry is carried as read')
eq(read[3].item_serial, '18A(I)12019', 'the raft serial is kept apart from the certificate number')
eq(read[4].category, 'FFA', 'a known category is kept')
eq(mapBundle({ certificates: [{ cert_type: 'X', category: 'Safety' }] })[0].category, 'Other',
  'the legacy Safety bucket is never offered to a new certificate')
const beyond = mapBundle({ certificates: [{ cert_type: 'X', page_from: 9, page_to: 9 }] }, 6)[0]
eq(beyond.page_from, null, 'a page past the end of a 6-page bundle is dropped')
const backwards = mapBundle({ certificates: [{ cert_type: 'X', page_from: 4, page_to: 2 }] }, 6)[0]
eq(backwards.page_from, null, 'a range that ends before it starts is dropped whole, not swapped')
eq(mapBundle({ certificates: [{ cert_type: 'X', page_from: 3 }] }, 6)[0].page_to, 3,
  'a single page carries itself as both ends')
eq(mapBundle({ certificates: [{ cert_type: 'X', page_from: '' }] }, 6)[0].page_from, null,
  'a blank page is not page 0')
eq(mapBundle(null).length, 0, 'no result reads as no certificates, not a crash')

/* ---- THE REAL BUNDLE ---------------------------------------------------- */
const { rows, counts } = matchBundle(read, onFile, { asOf: TODAY })
const page = (n) => rows.find((r) => r.page_from === n)

eq(counts.attach, 2, 'two pages are the scans missing from certificates on file')
eq(counts.hasFile, 1, 'one is on file with its own scan already')
eq(counts.superseded, 3, 'three are last year\'s, since renewed')
eq(counts.new, 0, 'nothing in the bundle is a certificate the boat does not already hold')
eq(counts.duplicate, 0, 'and nothing is read twice')

eq(page(1).kind, 'attach', 'page 1 links to the medical stores certificate')
eq(page(1).target?.id, 'medical', '— the right one')
eq(page(1).how, 'date', 'recognised by kind and date, since it prints no number')
eq(page(2).kind, 'attach', 'page 2 links to the lifejacket certificate')
eq(page(2).target?.id, 'lifejacket', '— the right one')

/* NUMBER WINS, and the category disagreeing does not stop it. */
eq(page(5).kind, 'hasFile', 'page 5 is gas suppression 3134, already held with its own scan')
eq(page(5).target?.id, 'gfs3134', 'matched to 3134 and not the other suppression certificate')
eq(page(5).how, 'number', 'on its number — though filed under Safety on the record and FFA by the reader')

eq(page(3).kind, 'superseded', 'page 3 is the 2025 Seago liferaft service')
eq(page(4).kind, 'superseded', 'page 4 is the 2025 Marasafe liferaft service')
ok(page(3).newer && page(4).newer && page(3).newer.id !== page(4).newer.id,
  'two old raft certificates are paired with two DIFFERENT renewals')
ok(!page(3).shared && !page(4).shared, 'so neither is flagged as sharing a renewal')
eq(page(6).kind, 'superseded', 'page 6 is the 2025 extinguisher service')
eq(page(6).newer?.id, 'pfe9184', 'renewed by 9184, Feb 2026')

ok(rows.every((r, i) => i === 0 || (rows[i - 1].page_from ?? 99) <= (r.page_from ?? 99)),
  'rows come back in page order')

eq(defaultPick(page(1)), true, 'linking a missing scan is ticked')
eq(defaultPick(page(5)), false, 'a certificate with its own scan is left alone')
eq(defaultPick(page(3)), false, 'an older copy is never ticked')

eq(uncoveredPages(rows, 6).length, 0, 'every page of the six had a certificate')
eq(JSON.stringify(uncoveredPages(rows, 7)), '[7]', 'a seventh page read as nothing is named')
eq(uncoveredPages(rows, null), null, 'no page count is "not known", not "none missed"')

/* ---- the traps ---------------------------------------------------------- */
/* A NUMBER ONLY IDENTIFIES WITHIN ONE KIND. */
const radio = matchBundle([{ idx: 0, cert_type: 'Radio Survey Certificate', cert_number: '3134', issue_date: '2026-01-01', expiry_date: '2027-01-01', page_from: 1, page_to: 1 }], onFile, { asOf: TODAY })
eq(radio.rows[0].kind, 'new', 'a radio certificate numbered 3134 is not the gas suppression 3134')

/* THE READER RETURNING ONE CERTIFICATE TWICE. */
const twice = matchBundle([read[4], { ...read[4], idx: 9, page_from: 7, page_to: 7 }], onFile, { asOf: TODAY })
eq(twice.rows[0].kind, 'hasFile', 'the first reading of 3134 is matched')
eq(twice.rows[1].kind, 'duplicate', 'the second is reported as read twice')

/* TWO ITEMS SERVICED THE SAME MORNING ARE TWO CERTIFICATES. */
const sameDay = matchBundle([
  { idx: 0, cert_type: 'Lifejacket service', issue_date: '2026-03-17', expiry_date: '2027-03-17', page_from: 1, page_to: 1 },
  { idx: 1, cert_type: 'Lifejacket service', issue_date: '2026-03-17', expiry_date: '2027-03-17', page_from: 2, page_to: 2 },
], onFile, { asOf: TODAY })
eq(sameDay.rows[0].kind, 'attach', 'the first same-day lifejacket certificate links to the one on file')
ok(sameDay.rows[1].kind !== 'attach' && sameDay.rows[1].target === null,
  'the second is not bolted onto the same record')

/* A GENUINELY NEW CERTIFICATE. */
const epirb = matchBundle([{ idx: 0, cert_type: 'EPIRB Shore Based Maintenance Certificate', cert_number: 'EP-1001', issue_date: '2026-06-01', expiry_date: '2027-06-01', page_from: 1, page_to: 1 }], onFile, { asOf: TODAY })
eq(epirb.rows[0].kind, 'new', 'an EPIRB certificate the boat has never filed is new')
eq(defaultPick(epirb.rows[0]), true, 'and ticked to add')

/* NEW AND ALREADY EXPIRED — worth a look, never ticked. */
const lapsed = matchBundle([{ idx: 0, cert_type: 'Immersion Suit Service', issue_date: '2025-01-01', expiry_date: '2026-01-01', page_from: 1, page_to: 1 }], onFile, { asOf: TODAY })
eq(lapsed.rows[0].kind, 'new', 'an expired certificate with nothing on file to replace it is new')
eq(lapsed.rows[0].expired, true, 'and says it has expired')
eq(defaultPick(lapsed.rows[0]), false, 'and is not ticked to add')

/* THREE YEARS OF ONE RAFT, TWO RENEWALS ON FILE. The third is still an older
   copy — and flagged, because it also looks like two rafts with one renewed. */
const history = matchBundle([
  { idx: 0, cert_type: 'Liferaft Service', issue_date: '2023-07-01', expiry_date: '2024-07-01', page_from: 1, page_to: 1 },
  { idx: 1, cert_type: 'Liferaft Service', issue_date: '2024-07-01', expiry_date: '2025-07-01', page_from: 2, page_to: 2 },
  { idx: 2, cert_type: 'Liferaft Service', issue_date: '2025-07-01', expiry_date: '2026-07-01', page_from: 3, page_to: 3 },
], onFile, { asOf: TODAY })
eq(history.counts.superseded, 3, 'three old raft services are all older copies, never "new"')
eq(history.rows.filter((r) => r.shared).length, 2, 'the two measured against one renewal are both flagged')
eq(history.counts.new, 0, 'and none is offered for adding')

/* NO DATES AND NO NUMBER — nothing can be compared, so nothing is decided. */
const undated = matchBundle([{ idx: 0, cert_type: 'Liferaft Service', page_from: 1, page_to: 1 }], onFile, { asOf: TODAY })
eq(undated.rows[0].kind, 'new', 'an undated raft certificate is not called an older copy')
eq(undated.rows[0].undated, true, 'and says it carries no dates')
eq(defaultPick(undated.rows[0]), false,
  'and is not ticked to add — saved with no dates it would read as never expiring')

/* A KIND THE APP CANNOT RECOGNISE could not be checked for an older copy, so it
   may be last year's. Offered, never ticked. */
const unknown = matchBundle([{ idx: 0, cert_type: 'Fish Hold Stability Booklet Approval', issue_date: '2026-06-01', expiry_date: '2031-06-01', page_from: 1, page_to: 1 }], onFile, { asOf: TODAY })
eq(unknown.rows[0].kind, 'new', 'a certificate of a kind nothing recognises is new')
eq(unknown.rows[0].unknownKind, true, 'and says its kind was not recognised')
eq(defaultPick(unknown.rows[0]), false, 'and is not ticked to add')

/* THE WRECK CERTIFICATES DO NOT CROSS WITH THE ORDINARY INSURANCE. */
const cover = matchBundle([{ idx: 0, cert_type: 'Certificate of Insurance', issue_date: '2026-03-18', expiry_date: '2027-03-31', page_from: 1, page_to: 1 }], onFile, { asOf: TODAY })
eq(cover.rows[0].target?.id, 'insurance', 'the certificate of insurance matches the insurance, not a wreck certificate sharing its expiry')

/* ---- what saving writes ------------------------------------------------- */
const link = attachFor(page(1), { filePath: 'fleet/bundle.pdf', fileName: 'L.S.A Certs.pdf' })
eq(JSON.stringify(Object.keys(link).sort()), JSON.stringify(['file_name', 'file_path', 'page_from', 'page_to']),
  'linking writes the document and its pages and nothing else')
eq(link.page_from, 1, 'at the page it was read from')

const draft = draftFor(read[3], { filePath: 'fleet/bundle.pdf', fileName: 'L.S.A Certs.pdf' })
ok(/Serial 18A\(I\)12019/.test(draft.notes), 'a new raft certificate carries its serial in the notes')
eq(draft.page_from, 4, 'and its page')

/* ---- one file, several certificates ------------------------------------ */
const shared = [{ id: 'a', file_path: 'fleet/bundle.pdf' }, { id: 'b', file_path: 'fleet/bundle.pdf' }, { id: 'c', file_path: 'fleet/own.jpg' }]
eq(fileStillUsed('fleet/bundle.pdf', shared, 'a'), true, 'deleting one of two certificates in a bundle keeps the bundle')
eq(fileStillUsed('fleet/own.jpg', shared, 'c'), false, 'deleting the only certificate on a scan lets the scan go')
eq(fileStillUsed(null, shared, 'a'), false, 'no file is never "still used"')

/* ---- opening at the page ------------------------------------------------ */
eq(withPage('https://x/y.pdf', 3), 'https://x/y.pdf#page=3', 'page 3 opens at page 3')
eq(withPage('https://x/y.pdf', 1), 'https://x/y.pdf', 'page 1 needs no fragment')
eq(withPage('https://x/y.pdf', null), 'https://x/y.pdf', 'no page opens at the top')
eq(withPage('https://x/y.pdf', ''), 'https://x/y.pdf', 'a blank page opens at the top, not at page 0')
eq(withPage('https://x/y.pdf', 0), 'https://x/y.pdf', 'page 0 does not exist')

console.log(`cert bundle: ${pass} checks passed`)
if (fail) { console.log(`${fail} FAILED`); process.exit(1) }
