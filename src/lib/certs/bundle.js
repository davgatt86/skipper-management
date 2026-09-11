import { pageRange, pageLabel, pageOrNull } from '../invoices/pages.js'

/* A BUNDLE OF VESSEL CERTIFICATES — read, then MATCHED against what is on file.
 *
 * David, Sep 2026, on `L.S.A Certs.pdf`: "is it possible to read that like we
 * do with the invoices and direct the user to the page number of the cert?"
 *
 * THE REAL BUNDLE SAID WHAT THIS HAS TO DO. Six pages, one certificate each,
 * read off the scan before anything was written:
 *
 *   p1  ships medical stores           2026   on file, NO scan held
 *   p2  lifejacket service             2026   on file, NO scan held
 *   p3  liferaft service (Seago)       2025   renewed — 2026 on file
 *   p4  liferaft service (Marasafe)    2025   renewed — 2026 on file
 *   p5  gas suppression no. 3134       2024   on file WITH its own scan
 *   p6  portable extinguishers         2025   renewed — 2026 on file
 *
 * A read that simply ADDED what it found would have filed three certificates a
 * year out of date as though they were current, and duplicated the other three.
 * So nothing here is added by default. Every certificate read is put against the
 * record first and comes out as one of five things, which must not look alike:
 *
 *   attach      the same certificate is on file with no document: link this page
 *   hasFile     the same certificate is on file with its own scan: leave it be
 *   superseded  an older copy of a certificate held in a later one: not added
 *   duplicate   the reader returned one certificate twice: ignored
 *   new         nothing like it on file: offered, never added unasked
 *
 * WHAT IS CURRENT IS DECIDED AGAINST THE RECORD, NEVER BY THE READER. The
 * reader is told to return every certificate it finds, lapsed ones included,
 * because a superseded certificate can only be recognised if it is handed over.
 */

/* Same ten the page offers and the single-certificate reader clamps to. The
 * legacy `Safety` bucket is deliberately absent: nothing new goes there. */
export const CATEGORIES = ['Statutory', 'LSA', 'FFA', 'Radio', 'Pollution', 'Medical',
  'Machinery', 'Insurance', 'Equipment', 'Other']

/* WHAT KIND OF CERTIFICATE, read off its title — because the title DRIFTS.
 *
 * The same liferaft service arrives as "Inflatable Liferaft Service
 * Certificate" from Marasafe and "Liferaft Inspection & Service Schedule" from
 * Seago, and the on-file lifejacket record reads "SERVICE CERTIFICATE -
 * LIFEJACKET". Comparing titles would match none of them. The CATEGORY is no
 * use either: the 2026 liferaft certificates on file sit under the legacy
 * `Safety` bucket while the reader files them as LSA.
 *
 * ORDER MATTERS. Wreck removal comes before insurance, because both wreck
 * certificates on file contain the word "insurance" and are not the ordinary
 * Certificate of Insurance. A title matching nothing has no kind, and a
 * certificate with no kind is never matched on a date — only on its number. */
export const FAMILIES = [
  ['wreck', /wreck/i],
  ['insurance', /insurance/i],
  ['liferaft', /life\s*raft/i],
  ['lifejacket', /life\s*jacket/i],
  ['immersion', /immersion/i],
  ['epirb', /epirb|beacon/i],
  ['flares', /flare|pyrotechnic/i],
  ['medical', /medic/i],
  ['extinguisher', /extinguisher/i],
  ['suppression', /suppression|fixed fire/i],
  ['registry', /regist/i],
  ['measurement', /measurement|tonnage/i],
  ['ilo188', /\bilo\b|work in fishing/i],
  ['particulars', /particulars/i],
  ['fishing', /fishing vessel cert/i],
  ['builder', /builder/i],
  ['antifouling', /anti-?fouling|\btbt\b/i],
  ['radio', /radio|gmdss/i],
]

export function familyOf(certType) {
  const t = String(certType ?? '')
  if (!t.trim()) return null
  for (const [key, re] of FAMILIES) if (re.test(t)) return key
  return null
}

/* A certificate number, compared without its punctuation, and only if it is
 * long enough to identify anything. "1" on a form is a row number, not an
 * identity. */
export function normNumber(v) {
  const s = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return s.length >= 3 ? s : null
}

const iso = (v) => {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}
const text = (v) => String(v ?? '').trim() || null

/* HOW RECENT A CERTIFICATE IS: its expiry, or its issue date where no expiry
 * was read. A liferaft schedule printing only "Next Service: 07/2026" still has
 * a service date, and that is enough to tell it from next year's. */
const when = (c) => iso(c?.expiry_date) || iso(c?.issue_date)

/**
 * The reader's JSON, cleaned. Pages are checked against the page count read off
 * the PDF — a second time, since the function already did it: a column nobody
 * downstream can check is worth checking twice.
 */
export function mapBundle(data, pageCount = null) {
  const list = Array.isArray(data?.certificates) ? data.certificates : []
  return list.map((c, i) => {
    const cat = String(c?.category ?? '').trim()
    const { page_from, page_to } = pageRange(c?.page_from, c?.page_to, pageCount)
    return {
      idx: i,
      cert_type: text(c?.cert_type) || '',
      cert_number: text(c?.cert_number),
      issuer: text(c?.issuer),
      issue_date: iso(c?.issue_date),
      expiry_date: iso(c?.expiry_date),
      category: CATEGORIES.includes(cat) ? cat : 'Other',
      vessel_name: text(c?.vessel_name),
      item_serial: text(c?.item_serial),
      notes: text(c?.notes),
      page_from,
      page_to,
    }
  })
}

/**
 * Put each certificate read against the certificates on file.
 *
 * THE NUMBER IS THE STRONGEST EVIDENCE, AND ONLY WITHIN ONE KIND. An invoice
 * number is only unique within a firm — a Fraserburgh bill was once re-priced
 * in euros because 34561 was also a Dutch firm's number — and a certificate
 * number is the same. So a number match must agree on the kind as well, unless
 * the kind of either side could not be told.
 *
 * WITHOUT A NUMBER, THE SAME KIND ON THE SAME DATE. Two of the six real
 * certificates carry no number at all (medical stores, lifejackets) and are
 * recognised only this way. A date match never takes a row another certificate
 * has already claimed: two rafts serviced the same morning are two
 * certificates, not one read twice.
 *
 * AN OLDER COPY is one whose kind is held on file with a LATER date. Each later
 * certificate is paired with one older one where the numbers allow, so two
 * rafts renewed are two pairings. Where one renewal is the only later
 * certificate for several older ones it is still reported — a raft serviced
 * three years running is three old copies of one certificate — but flagged
 * `shared`, because it is also exactly what two rafts with only one renewed
 * would look like, and which of those it is cannot be told from the page.
 */
export function matchBundle(read = [], onFile = [], { asOf } = {}) {
  const today = iso(asOf) || new Date().toISOString().slice(0, 10)
  const files = (onFile || []).map((r) => ({
    row: r, fam: familyOf(r.cert_type), num: normNumber(r.cert_number),
  }))
  const claimed = new Set()
  const outranked = new Set()

  const rows = (read || []).map((c) => {
    const fam = familyOf(c.cert_type)
    const num = normNumber(c.cert_number)
    const base = { ...c, family: fam, target: null, newer: null, shared: false,
      expired: false, undated: !iso(c.issue_date) && !iso(c.expiry_date), unknownKind: !fam }

    if (num) {
      const hit = files.find((f) => f.num === num && (!fam || !f.fam || f.fam === fam))
      if (hit) {
        if (claimed.has(hit.row.id)) return { ...base, kind: 'duplicate', target: hit.row, how: 'number' }
        claimed.add(hit.row.id)
        return { ...base, kind: hit.row.file_path ? 'hasFile' : 'attach', target: hit.row, how: 'number' }
      }
    }

    if (fam) {
      const issued = iso(c.issue_date)
      const expires = iso(c.expiry_date)
      const hit = files.find((f) => f.fam === fam && !claimed.has(f.row.id) && (
        (issued && iso(f.row.issue_date) === issued) || (expires && iso(f.row.expiry_date) === expires)))
      if (hit) {
        claimed.add(hit.row.id)
        return { ...base, kind: hit.row.file_path ? 'hasFile' : 'attach', target: hit.row, how: 'date' }
      }

      const mine = when(c)
      if (mine) {
        const later = files
          .filter((f) => f.fam === fam && when(f.row) && when(f.row) > mine)
          .sort((a, b) => when(a.row).localeCompare(when(b.row)))
        if (later.length) {
          const fresh = later.filter((f) => !outranked.has(f.row.id))
          const pick = (fresh.length ? fresh : later)[0]
          outranked.add(pick.row.id)
          return { ...base, kind: 'superseded', newer: pick.row, shared: !fresh.length }
        }
      }
    }

    const exp = iso(c.expiry_date)
    return { ...base, kind: 'new', expired: !!(exp && exp < today) }
  })

  /* A shared renewal is only shared once it has actually been used twice, and
     the FIRST older copy to use it could not know that when it was matched. */
  const uses = new Map()
  for (const r of rows) if (r.kind === 'superseded') uses.set(r.newer.id, (uses.get(r.newer.id) || 0) + 1)
  for (const r of rows) if (r.kind === 'superseded' && uses.get(r.newer.id) > 1) r.shared = true

  rows.sort((a, b) => (a.page_from ?? Infinity) - (b.page_from ?? Infinity) || a.idx - b.idx)

  const counts = { attach: 0, hasFile: 0, superseded: 0, duplicate: 0, new: 0 }
  for (const r of rows) counts[r.kind]++
  return { rows, counts }
}

/** Which rows are ticked when the review opens.
 *
 *  LINKING A PAGE TO A CERTIFICATE ALREADY ON FILE is ticked: it touches
 *  nothing but the document, and the dates and number the skipper filed stay
 *  exactly as they are. ADDING a certificate is ticked only where there is
 *  nothing to doubt about it — never one that has already expired, one whose
 *  title was not read, one carrying no dates at all, or one of a kind the app
 *  could not recognise.
 *
 *  THE LAST TWO WERE TICKED IN THE FIRST CUT, AND THE PREVIEW CAUGHT IT. A
 *  certificate saved with no dates reads on the register as one that NEVER
 *  EXPIRES — nought and never-stated looking alike, again. And a kind the app
 *  cannot recognise is one it could not check for an older or newer copy, so it
 *  may be last year's: the very thing this review exists to stop being filed as
 *  current. */
export function defaultPick(row) {
  if (row.kind === 'attach') return true
  if (row.kind === 'new') return !!row.cert_type && !row.expired && !row.undated && !row.unknownKind
  return false
}

/** Pages of the bundle that no certificate was read off — a CANDIDATE, never a
 *  finding. Null where the page count is not known, because "no pages missed"
 *  and "nobody could count" must not read alike. */
export function uncoveredPages(rows = [], pageCount = null) {
  if (!Number.isInteger(pageCount) || pageCount < 1) return null
  const seen = new Set()
  for (const r of rows) {
    if (r.page_from == null) continue
    for (let p = r.page_from; p <= (r.page_to ?? r.page_from); p++) seen.add(p)
  }
  const out = []
  for (let p = 1; p <= pageCount; p++) if (!seen.has(p)) out.push(p)
  return out
}

/** What linking a page writes. ONLY THE DOCUMENT: the certificate's own dates,
 *  number and title are the skipper's filing and the bundle does not get to
 *  overwrite them. */
export function attachFor(row, { filePath, fileName }) {
  return { file_path: filePath, file_name: fileName, page_from: row.page_from, page_to: row.page_to }
}

/** A certificate not on file, as a row to insert. The equipment serial rides in
 *  the notes: it is what tells one liferaft's paperwork from the other's. */
export function draftFor(row, { filePath, fileName }) {
  const notes = [row.notes, row.item_serial ? `Serial ${row.item_serial}` : null]
    .filter(Boolean).join(' · ') || null
  return {
    cert_type: row.cert_type,
    category: row.category,
    cert_number: row.cert_number,
    issuer: row.issuer,
    issue_date: row.issue_date,
    expiry_date: row.expiry_date,
    notes,
    file_path: filePath,
    file_name: fileName,
    page_from: row.page_from,
    page_to: row.page_to,
  }
}

/**
 * Whether a stored file is still somebody's document.
 *
 * DELETING A CERTIFICATE USED TO DELETE ITS FILE, which was right while one file
 * was one certificate. A bundle is several certificates in one file, so
 * deleting any one of them would take the scan away from all the others —
 * silently, and discovered only when somebody next opened one.
 */
export function fileStillUsed(path, rows = [], exceptId = null) {
  if (!path) return false
  return rows.some((r) => r.id !== exceptId && r.file_path === path)
}

/** Open a document AT its page. Page 1 or none opens it at the top, which is
 *  what a viewer that ignores the fragment does anyway. */
export function withPage(url, page) {
  const p = pageOrNull(page)
  return p && p > 1 ? `${url}#page=${p}` : url
}

export { pageLabel }
