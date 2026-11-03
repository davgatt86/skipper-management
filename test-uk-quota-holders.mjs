/* UK QUOTA HOLDERS — /quota-holders and src/lib/quota/ukHolders.js.
 *
 * The page ranks FQA holders by units and by ESTIMATED tonnes. The rules worth
 * pinning are the ones that stop an estimate passing for a reading: a stock the
 * uptake report does not cover has units and NO tonnes (never zero tonnes), a
 * holder spread over several licences and POs adds up to one row unless asked
 * to split, and a future year's rate is the latest year's moved by the user's %.
 *
 * Synthetic rows only: the register export is not committed to this public repo.
 */
import assert from 'node:assert'
import {
  league, normHolderKey, compare, aqTonnes, aqByCode, attachAq, isActiveBoat, tOf, breakdown as bd2, poOverview, poSpecies, ratesFor, projectRates, applyRowFilters, poShares, search, breakdown, unitsOf, tonnesOf, isLeasable, groupKey,
} from './src/lib/quota/ukHolders.js'
import { accessForPath, NAV } from './src/nav.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} != ${b}`); n++ }

let id = 0
const H = (holder, po, u, { lic = String(++id), vessel = '', htype = 'Vessel licence', admin = 'Marine Scotland' } = {}) =>
  ({ id: ++id, lic, vessel, holder, hkey: holder.toUpperCase().replace(/ LIMITED$/, ' LTD'), po, htype, admin, u })

const rows = [
  H('Alpha Fishing Ltd', 'SFO', { 'NS haddock': 1000, 'NS saithe': 100 }, { vessel: 'ALPHA', lic: '100' }),
  H('Alpha Fishing Limited', 'Fife', { 'NS haddock': 500, 'Nephrops VII': 40 }, { lic: '101', htype: 'Units held on behalf of fishing vessel agents and owners' }),
  H('Beta Ltd', 'SFO', { 'NS haddock': 1200 }, { vessel: 'BETA', lic: '200' }),
  H('Gamma Ltd', 'No PO', { 'NS haddock': 300 }, { vessel: 'GAMMA', lic: '300' }),
  H('PO Pool', 'Fife', { 'NS saithe': 900 }, { lic: '400', htype: 'Units held by PO for the common benefit of the membership, being under full control of the PO' }),
]
const species = [{ species: 'NS haddock', code: 'HAD/2AC4.' }, { species: 'NS saithe', code: 'POK/2C3A4' }, { species: 'Nephrops VII', code: null }]
const balances = [
  { po: 'SFO', stock: 'HAD/2AC4.', tac_t: 220, swaps_in_t: 10, swaps_out_t: 0, net_swaps_t: 10 },
  { po: 'Fife', stock: 'HAD/2AC4.', tac_t: 50, swaps_in_t: 0, swaps_out_t: 20, net_swaps_t: -20 },
  { po: 'UK total', stock: 'HAD/2AC4.', tac_t: 99999 },                       // not a PO: never in the rate
  { po: 'Non Sector Scotland', stock: 'HAD/2AC4.', tac_t: 5000 },             // not a PO either
  { po: 'SFO', stock: 'POK/2C3A4', tac_t: 50 },
  { po: 'Fife', stock: 'POK/2C3A4', tac_t: 450 },
]

/* ---- rates: PO TAC share ÷ units held in POs, and nothing invented ---------- */
const rates = ratesFor(species, balances, rows)
near(rates.get('NS haddock'), 270 / 2700, 'haddock: (220+50) t over the 2,700 units in POs (Gamma has no PO)')
near(rates.get('NS saithe'), 500 / 1000, 'saithe: 500 t over 1,000 PO units')
ok(!rates.has('Nephrops VII'), 'a stock with no uptake code has NO rate — not a rate of zero')
const t = tonnesOf(rows[1], [], rates)
near(t.t, 50, 'Alpha Limited: 500 haddock units at 0.1 t')
eq(t.missing, 40, 'and its 40 nephrops VII units are counted as missing, not as 0 t')

/* ---- next year: the latest rate moved by the user's % per stock ------------- */
const next = projectRates(rates, { 'NS haddock': 10, 'NS saithe': -20 })
near(next.get('NS haddock'), 0.11, '+10% on haddock')
near(next.get('NS saithe'), 0.4, '-20% on saithe')
near(projectRates(rates, {}).get('NS haddock'), 0.1, 'no % entered = unchanged')
near(projectRates(rates, { 'NS haddock': '' }).get('NS haddock'), 0.1, 'a blank box is 0%, not NaN')

/* ---- league: one holder across licences and POs, unless split ---------------- */
{
  const L = league(rows, { species: ['NS haddock'], metric: 'units', rates, top: 0 })
  eq(L.rows[0].name, 'Alpha Fishing Ltd', 'Alpha (1,500 over two licences and two POs) outranks Beta (1,200)')
  eq(L.rows[0].units, 1500, 'Ltd and Limited are one holder')
  eq(L.rows[0].pos, ['Fife', 'SFO'], 'and both POs are named')
  eq(L.count, 3, 'three holders hold haddock')
  eq(L.totalUnits, 3000, 'every haddock unit counted once')
  const S = league(rows, { species: ['NS haddock'], metric: 'units', rates, split: true, top: 0 })
  eq(S.count, 4, 'split: Alpha’s two holdings stand apart')
  ok(S.rows.every((r) => r.units <= 1200), 'and neither Alpha holding outranks Beta on its own')
  const T = league(rows, { species: ['NS haddock'], metric: 'units', rates, top: 1 })
  eq(T.rows.length, 1, 'top 1 shows one')
  near(T.shownShare, 0.5, 'and says it holds half')
  eq(T.count, 3, 'while still counting everyone')
}
{
  const L = league(rows, { species: [], metric: 'tonnes', rates, top: 0 })
  eq(L.rows[0].name, 'PO Pool', 'all stocks by tonnes: the pool’s 900 saithe units (450 t) lead')
  near(L.rows[0].tonnes, 450, '900 × 0.5')
  const a = L.rows.find((r) => r.name.startsWith('Alpha'))
  near(a.tonnes, 1500 * 0.1 + 100 * 0.5, 'Alpha: haddock + saithe, nephrops VII adds no tonnes')
  eq(a.missing, 40, 'and carries its untonned units as missing')
}
{
  const L = league(rows, { by: 'boat', species: ['NS haddock'], metric: 'units', rates, top: 0 })
  ok(L.rows.every((r) => r.vessels.length === 1), 'boats are vessel licences only')
  eq(L.offBoat, 500, 'the 500 units on a licence with no vessel are reported, not dropped silently')
  const P = league(rows, { by: 'po', species: ['NS haddock'], metric: 'units', rates, top: 0 })
  eq(P.rows.map((r) => r.name), ['SFO', 'Fife', 'Not in a PO (non-sector)'], 'POs ranked 2,200 / 500 / 300, and no-PO units are named as non-sector, never a bare "No PO"')
  const per = league(rows, { species: ['NS haddock', 'NS saithe'], metric: 'units', rates, top: 0 }).rows.find((r) => r.name.startsWith('Alpha'))
  eq(per.per['NS saithe'].units, 100, 'the per-stock columns carry each stock')
}
eq(groupKey(rows[0], 'holder', false), groupKey(rows[1], 'holder', false), 'the grouping key is the normalised name')
ok(groupKey(rows[0], 'holder', true) !== groupKey(rows[1], 'holder', true), 'split keys a holding by licence and PO')

/* ---- lease prospects: anything that is not a boat's own licence -------------- */
ok(!isLeasable(rows[0]) && isLeasable(rows[1]) && isLeasable(rows[4]), 'agents and PO pools lease; a vessel licence does not')
eq(applyRowFilters(rows, { leasable: true }).map((r) => r.holder), ['Alpha Fishing Limited', 'PO Pool'], 'the lease filter')
eq(applyRowFilters(rows, { po: 'Fife' }).length, 2, 'the PO filter')

/* ---- PO make-up: unit share beside quota and swaps --------------------------- */
{
  const s = poShares(rows, balances, species[0])
  const sfo = s.find((r) => r.po === 'SFO'), fife = s.find((r) => r.po === 'Fife')
  near(sfo.unitShare, 2200 / 3000, 'SFO holds 2,200 of 3,000 haddock units')
  near(fife.netOfTac, -20 / 50, 'Fife swapped out 40% of its haddock quota')
  ok(!s.some((r) => r.po === 'UK total' || r.po === 'Non Sector Scotland'), 'groups that are not POs are not listed as POs')
  eq(poShares(rows, [...balances, { po: 'Orkney', stock: 'HAD/2AC4.', tac_t: 0.2, net_swaps_t: 65 }], species[0]).find((r) => r.po === 'Orkney').netOfTac, null, 'no % against a quota under 10 t')
  const np = s.find((r) => r.po === 'No PO')
  eq(np.tac_t, 5000, 'units outside any PO are set against the Non Sector groups\u2019 quota')
  eq(np.label, 'Not in a PO (non-sector)', 'and labelled as non-sector')
  eq(np.netOfTac, null, 'but no net-% for it: its units are not what that quota is cut from')
  eq(poShares(rows, balances.filter((b) => !/^Non Sector/.test(b.po)), species[0]).find((r) => r.po === 'No PO').tac_t, null,
    'with no Non Sector line in the report the quota is null, not 0')
}

/* ---- PO make-up across all stocks, and one PO's stocks ------------------------ */
{
  const o = poOverview(rows, balances, species, rates)
  const sfo = o.find((r) => r.po === 'SFO'), fife = o.find((r) => r.po === 'Fife')
  near(sfo.tonnes, 2200 * 0.1 + 100 * 0.5, 'SFO: haddock and saithe tonnes together')
  near(sfo.tac_t, 270, 'SFO quota added over the two stocks (220 + 50)')
  near(fife.tonnes, 500 * 0.1 + 900 * 0.5, 'Fife: its nephrops VII units add no tonnes')
  near(o.reduce((a, r) => a + r.unitShare, 0), 1, 'shares of all tonnes add to 100%')
  eq(o[0].po, 'Fife', 'ranked by estimated tonnes, all stocks')
  eq(o.find((r) => r.po === 'No PO').tac_t, 5000, 'the non-sector line takes the Non Sector groups')
  const st = poSpecies(rows, balances, 'Fife', species, rates)
  eq(st.map((r) => r.species), ['NS saithe', 'NS haddock', 'Nephrops VII'], 'Fife\u2019s stocks, biggest tonnes first, units-only last')
  near(st.find((r) => r.species === 'NS haddock').unitShare, 500 / 3000, 'share of that stock\u2019s UK units')
  eq(st.find((r) => r.species === 'Nephrops VII').tonnes, null, 'a units-only stock has null tonnes, not 0')
  near(st.find((r) => r.species === 'NS haddock').netOfTac, -0.4, 'with its quota and swaps')
}

/* ---- one firm, two spellings ---------------------------------------------------- */
eq(normHolderKey('LUNAR FISHING CO LTD'), normHolderKey('LUNAR FISHING COMPANY LTD'), 'Co and Company group as one holder')
eq(normHolderKey('COMPANY  CONSTRUCT LTD'), 'COMPANY CONSTRUCT LTD', 'only the whole word CO is touched')

/* ---- side by side ----------------------------------------------------------------- */
{
  const C = compare([rows[0], rows[1]], [rows[2]], rates)
  const had = C.lines.find((l) => l.species === 'NS haddock')
  eq([had.ua, had.ub], [1500, 1200], 'A = Alpha over both its holdings, B = Beta')
  near(had.dt, 30, 'A holds 30 t more haddock')
  eq(C.lines.find((l) => l.species === 'NS saithe').ub, 0, 'a stock only A holds is still listed, B at nought units')
  const neph = C.lines.find((l) => l.species === 'Nephrops VII')
  ok(neph.ta === null && neph.dt === null, 'a units-only stock has no tonnes and no tonnes difference')
  eq(C.lines[C.lines.length - 1].species, 'Nephrops VII', 'and sits after every stock with an estimate')
  eq([C.ua, C.ub], [1640, 1200], 'unit totals')
  near(C.ta - C.tb, 150 + 50 - 120, 'tonne totals: A 200 t against B 120 t')
  eq([C.onlyA, C.onlyB], [2, 0], 'A holds two stocks B does not')
}

/* ---- Scottish additional quota: off the units, onto active boats -------------- */
{
  const fleet = [
    { id: 901, lic: '1', vessel: 'ONE', lt: '', htype: 'Vessel licence', admin: 'Marine Scotland', po: 'SFO', holder: 'A', hkey: 'A', u: { 'NS haddock': 100 } },
    { id: 902, lic: '2', vessel: 'TWO', lt: '', htype: 'Vessel licence', admin: 'Marine Scotland', po: 'SFO', holder: 'B', hkey: 'B', u: { 'NS haddock': 900, 'NS saithe': 50 } },
    { id: 903, lic: '3', vessel: 'THREE', lt: '', htype: 'Vessel licence', admin: 'Marine Scotland', po: 'SFO', holder: 'C', hkey: 'C', u: { 'NS saithe': 10 } },
    { id: 904, lic: '9', vessel: '', lt: 'D', htype: 'Units held on behalf of private persons that are not fishing vessel licencees', admin: '', po: 'SFO', holder: 'D', hkey: 'D', u: { 'NS haddock': 1000 } },
    { id: 905, lic: '4', vessel: 'FOUR', lt: '', htype: 'Vessel licence', admin: 'Marine Management Organisation', po: 'SFO', holder: 'E', hkey: 'E', u: { 'NS haddock': 500 } },
  ]
  ok(isActiveBoat(fleet[0]) && !isActiveBoat(fleet[3]) && !isActiveBoat(fleet[4]), 'active = a Scottish-administered vessel licence; not a dummy, not an English boat')
  const bal = [{ po: 'SFO', stock: 'HAD/2AC4.', tac_t: 300 }]
  const aq = aqTonnes([{ po: 'SFO', stock: 'HAD/2AC4.', f: 0.2 }], bal)
  near(aq.get('SFO|HAD/2AC4.'), 60, 'AQ = the 2024 share (20%) of this year\u2019s TAC share (300 t)')
  near(aqByCode(aq).get('HAD/2AC4.'), 60, 'summed by stock')
  const r = ratesFor([{ species: 'NS haddock', code: 'HAD/2AC4.' }], bal, fleet, aqByCode(aq))
  near(r.get('NS haddock'), (300 - 60) / 2500, 'the per-unit rate carries only the non-AQ 240 t')
  const S = attachAq(fleet, aq, [{ species: 'NS haddock', code: 'HAD/2AC4.' }], 'stock')
  eq(S.counts.get('SFO'), 3, 'three active boats in SFO')
  const by = Object.fromEntries(S.rows.map((x) => [x.id, x.aq?.['NS haddock'] || 0]))
  ok(Math.abs(by[901] - 30) < 1e-9 && Math.abs(by[902] - 30) < 1e-9, 'stock mode: the 60 t split evenly between the two active boats holding haddock')
  eq([by[903], by[904], by[905]], [0, 0, 0], 'none to a boat without haddock, the private holder, or the English boat')
  near(tOf(S.rows[0], 'NS haddock', r), 100 * 0.096 + 30, 'ONE: 100 units at the FQA rate plus 30 t AQ')
  near(tOf(S.rows[3], 'NS haddock', r), 1000 * 0.096, 'the private holder: units only, no AQ')
  const total = S.rows.reduce((a, x) => a + (tOf(x, 'NS haddock', r) || 0), 0)
  near(total, 2500 * 0.096 + 60, 'nothing lost or doubled: units at the rate plus all the AQ')
  const A = attachAq(fleet, aq, [{ species: 'NS haddock', code: 'HAD/2AC4.' }], 'all')
  near(A.rows.find((x) => x.id === 903).aq['NS haddock'], 20, 'all mode: 60 t over all three active boats, haddock or not')
  const L = league(A.rows, { species: ['NS haddock'], metric: 'tonnes', rates: r, top: 0 })
  ok(L.rows.some((x) => x.name === 'C'), 'a boat with AQ but no units of the stock still ranks')
  eq(bd2([A.rows.find((x) => x.id === 903)], r).find((x) => x.species === 'NS haddock').units, 0, 'and its breakdown shows the stock at nought units with tonnes')
  eq(attachAq(fleet, new Map([['Orkney|HAD/2AC4.', 5]]), [{ species: 'NS haddock', code: 'HAD/2AC4.' }]).unplaced, 5, 'AQ for a PO with no active boat is reported, not lost')
}

/* ---- look-up ------------------------------------------------------------------ */
eq(search(rows, 'alpha').length, 2, 'by name, both spellings')
eq(search(rows, 'BETA').length, 1, 'by vessel')
eq(search(rows, '300').map((r) => r.holder), ['Gamma Ltd'], 'by licence number')
eq(search(rows, 'a').length, 0, 'one letter is not a search')
{
  const b = breakdown(rows.slice(0, 2), rates)
  eq(b.find((x) => x.species === 'Nephrops VII').tonnes, null, 'breakdown: no rate stays null')
  eq(b.find((x) => x.species === 'NS haddock').units, 1500, 'breakdown adds a holder’s holdings')
}
eq(unitsOf(rows[0], []), 1100, 'no stocks picked means every stock')

/* ---- the route --------------------------------------------------------------- */
eq(accessForPath('/quota-holders'), 'fleetTools', 'its own access, not /quota’s')
{
  const item = NAV.flatMap((g) => g.items).find((i) => i.to === '/quota-holders')
  ok(item && item.notOnDemo, 'on the menu, and off the demo like the swaps page')
}

console.log(`uk-quota-holders: ${n} checks passed`)
