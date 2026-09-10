/* THE FUEL LOG AND THE OIL RECORD BOOK, TIED TOGETHER.
 *
 * David, Sep 2026: "can we link the fuel/oil and ORB? so entry into 1 puts
 * entry into other?"
 *
 * They record the same EVENTS and they are not the same record. The fuel log is
 * the boat's own working book — litres, grade, supplier, price. The Oil Record
 * Book Part I is statutory (reg 20, MS (Prevention of Oil Pollution) Regs 2019,
 * required because she is 498 GT), with prescribed codes, an officer's
 * signature on every operation and a master's on every page, and nothing ever
 * edited or deleted.
 *
 * ONE DIRECTION, AND IT OFFERS RATHER THAN WRITES.
 *
 * The direction is fuel log -> ORB, because the reverse would have to invent
 * the supplier, the grade and the price the fuel loop is built on, none of
 * which the regulation asks the book to carry.
 *
 * It offers because of three things, and the first two are hard:
 *
 *   1. `officer_name` is NOT NULL on an entry. Reg 20 requires each operation to
 *      be signed by the officer in charge of it. Filling that in automatically
 *      is the app signing a statutory record for a man who never saw it.
 *   2. AN ENTRY CAN NEVER BE EDITED OR DELETED. Correct a litres typo in the
 *      working log an hour later and an automatic entry would already be in the
 *      book — needing a formal correcting entry, a permanent paper trail of a
 *      mistake the fuel log never really made.
 *   3. Item 26.3 wants the identity of the tank and its total content after
 *      bunkering. The fuel log has no tank column, so a derived entry would be
 *      incomplete on exactly the part that makes it compliant.
 *
 * THE RECONCILIATION IS THE HALF THAT MATTERS MOST. `unrecorded()` lists fuel
 * movements with no entry against them, so the gap is visible whether or not
 * anybody presses the button — and a gap in this book is what an inspector
 * counts.
 */

/* Which code and item a movement belongs under. Measured against the ORB item
   list in `orb.js`, which is itself Appendix III to MARPOL Annex I. */
export const MAPPING = {
  fuel: {
    code: 'H',
    itemN: '26.3',
    what: 'Bunkering of fuel oil',
    /* 26.1 place and 26.2 start/stop are carried on the same entry by the
       `port`, `started_at` and `stopped_at` columns — one operation is one
       entry, not three. */
    needs: ['the tank, and its total content after bunkering'],
  },
  lube_oil: {
    code: 'H',
    itemN: '26.4',
    what: 'Bunkering of bulk lubricating oil',
    needs: ['the tank, and its total content after bunkering'],
  },
  dirty_oil: {
    code: 'C',
    itemN: '12.1',
    what: 'Disposal of oil residues to a reception facility',
    needs: ['the port of the reception facility, if the place is not it'],
  },
  waste: {
    code: 'C',
    itemN: '12.1',
    what: 'Disposal of oil residues to a reception facility',
    needs: ['the port of the reception facility, if the place is not it'],
  },
}

export const mappingFor = (kind) => MAPPING[kind] || null

/**
 * Fuel movements with no Oil Record Book entry against them.
 *
 * ONLY THIS VESSEL'S, and only kinds the book actually wants — a fuel log row
 * for a boat with no ORB duty is not a gap in anything.
 */
export function unrecorded(fuelRows = [], entries = [], { vesselId, asOf } = {}) {
  const linked = new Set(
    (Array.isArray(entries) ? entries : [])
      .map((e) => e && e.fuel_log_id).filter(Boolean))

  const today = day(asOf) || new Date().toISOString().slice(0, 10)

  return (Array.isArray(fuelRows) ? fuelRows : [])
    .filter((r) => r && mappingFor(r.kind))
    .filter((r) => !linked.has(r.id))
    /* A movement on another boat is not this book's business. A row with no
       vessel at all is — the fuel log predates the vessel column and those rows
       belong to the fleet's only boat. */
    .filter((r) => !vesselId || !r.vessel_id || r.vessel_id === vesselId)
    .filter((r) => day(r.entry_date) && day(r.entry_date) <= today)
    .sort((a, b) => day(b.entry_date).localeCompare(day(a.entry_date)))
}

/**
 * A draft entry, for a person to check and sign.
 *
 * NO OFFICER NAME, DELIBERATELY. It is the one field this cannot supply and the
 * one the regulation is most particular about, so it is left empty and the form
 * asks for it. `addEntry` would refuse a blank one anyway — the schema says
 * NOT NULL — and that refusal is the rule working, not an obstacle.
 */
export function draftFromFuel(row, { pageId, vesselId } = {}) {
  const m = mappingFor(row?.kind)
  if (!m) return null

  const litres = num(row.litres)
  const where = text(row.location)
  const who = text(row.counterparty)

  return {
    vesselId: vesselId || row.vessel_id || null,
    pageId: pageId || null,
    entryDate: day(row.entry_date),
    code: m.code,
    itemN: m.itemN,
    quantity: litres,
    /* THE BOOK WORKS IN CUBIC METRES and the fuel log in litres. Stated as
       litres with the unit beside it rather than divided by a thousand: a
       converted figure that looks like a read one cannot be checked against the
       delivery note afterwards, which is the settling-sheet rule. */
    unit: litres == null ? null : 'L',
    tank: null,
    port: where,
    narrative: [
      m.what,
      text(row.grade) ? 'grade ' + row.grade : '',
      who ? 'from ' + who : '',
      'Raised from the fuel log.',
    ].filter(Boolean).join('. '),
    startedAt: null,
    stoppedAt: null,
    officerName: '',
    fuelLogId: row.id,
    /* What a person still has to add before this is a compliant entry. */
    needs: m.needs,
  }
}

/**
 * What the two records say about the same period, side by side.
 *
 * A COUNT IS NOT A RECONCILIATION, so it reports the movements rather than a
 * number: which are in the book, which are not, and how much oil the missing
 * ones account for.
 */
export function reconcile(fuelRows = [], entries = [], opts = {}) {
  const missing = unrecorded(fuelRows, entries, opts)
  const byKind = {}
  for (const r of missing) {
    const k = r.kind
    byKind[k] = byKind[k] || { kind: k, n: 0, litres: 0, ...mappingFor(k) }
    byKind[k].n += 1
    byKind[k].litres += num(r.litres) || 0
  }
  const relevant = (Array.isArray(fuelRows) ? fuelRows : []).filter((r) => r && mappingFor(r.kind))
  return {
    missing,
    kinds: Object.values(byKind).sort((a, b) => b.litres - a.litres),
    /* NOT A PERCENTAGE. Two of three recorded is not 67% of a duty done — every
       one of them is its own entry and its own signature. */
    recorded: relevant.length - missing.length,
    total: relevant.length,
  }
}

/* ---- helpers ------------------------------------------------------------ */
const day = (d) => {
  const s = String(d || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}
function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const text = (v) => {
  const s = String(v ?? '').trim()
  return s || null
}
