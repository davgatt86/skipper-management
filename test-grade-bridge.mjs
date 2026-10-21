/* PETERHEAD GRADES AGAINST HANSTHOLM SORTS.
 *
 * David: *"check pd grading table and hanstholm sorts (grades) and look for
 * similarities for comparing price market vs market."*
 *
 * Both markets grade by weight and publish the bands, so whether a Peterhead
 * price and a Hanstholm price are for the same fish is measurable. The bands
 * are transcribed from the two documents — the crew grading table and
 * hanstholmfiskeauktion.dk/Sorts read 21-10-2026 — and the answer is better
 * than expected: 36 of the 66 Peterhead grades cut at exactly the same kilos.
 */
import assert from 'node:assert'
import { PD_GRADES, DK_SORTS, NOT_COMPARABLE, bridgeFor, exactPairs, bandText } from './src/lib/market/gradeBridge.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }
const row = (sp, code) => bridgeFor(sp).find(r => r.code === code)

/* ---- THE BANDS ARE THE DOCUMENTS', not a tidied version of them ------- */
eq(PD_GRADES.Haddock.find(g => g[0] === '4'), ['4', 'M Metro', 0.17, 0.37], 'M Metro off the grading table')
eq(DK_SORTS.Haddock.find(g => g[0] === '4'), ['4', 0.17, 0.37], 'and Hanstholm size 4')
eq(PD_GRADES.Cod.length, 8, 'eight cod grades at Peterhead')
eq(DK_SORTS.Cod.length, 6, 'six at Hanstholm')

/* ---- HADDOCK: THE TWO MARKETS AGREE EXACTLY ON THE BULK GRADES -------- *
 * Metro and Mini Metro are the same kilos in both markets, which makes them
 * the fairest price comparison this boat has — and they are most of the A4. */
eq(row('Haddock', '3').fit, 'exact', 'Metro is the same band in both markets')
eq(row('Haddock', '3').dk, ['3'], 'PD Metro = DK size 3')
eq(row('Haddock', '4').fit, 'exact', 'and so is Mini Metro')
eq(row('Haddock', '4').dk, ['4'], 'PD M Metro = DK size 4')

/* THE TOP OF THE HADDOCK IS NOT COMPARABLE GRADE FOR GRADE. Peterhead cuts
   1+ kg into four and Hanstholm keeps it as one, so a Hanstholm size-1 price
   is a blend of four Peterhead grades. Comparable against the GROUP, never
   against one of them — which is why the group is reported. */
eq(row('Haddock', '1a').fit, 'pdFiner', 'Peterhead splits the big haddock')
eq(row('Haddock', '1a').group, ['1a', '1b', '1c', '1d'], 'into these four')
eq(row('Haddock', '2a').group, ['2a', '2b'], 'and Seed/Chipper share one Hanstholm size')

/* ---- THE SPECIES THAT LINE UP BEST ------------------------------------ */
eq(bridgeFor('Pollack').map(r => r.fit), ['exact', 'exact', 'exact', 'exact'],
  'lythe matches on every grade — the two markets grade it identically')
eq(bridgeFor('Mackerel').map(r => r.fit), ['exact', 'exact', 'exact'], 'and so does mackerel')
eq(bridgeFor('Monkfish').filter(r => r.fit === 'exact').length, 5, 'monks match on five of six')
eq(row('Monkfish', '5b').fit, 'none', 'only PD X Small has nothing below it at Hanstholm')
eq(bridgeFor('Saithe').slice(0, 3).map(r => r.fit), ['exact', 'exact', 'exact'], 'black matches down to Sel')
eq(row('Saithe', '4a').group, ['4a', '4b', '4c'], 'and PD cuts their size 4 into three')

/* ---- COD: THE MIDDLE OF THE LADDER IS THE SAME FISH ------------------- */
eq(['1a', '2', '3', '4'].map(c => row('Cod', c).fit), ['exact', 'exact', 'exact', 'exact'],
  'XL, Sprag, Medium and Big Baby are identical bands')
eq(row('Cod', '1b').group, ['1b', '1c'], 'PD splits their size 1 into Large and Cod')
eq(row('Cod', '5a').group, ['5a', '5b'], 'and their size 5 into Baby and Robbie')

/* ---- WHERE HANSTHOLM IS THE FINER OF THE TWO -------------------------- *
 * It runs the other way on catfish and witch, and that is worth keeping
 * straight: there the PETERHEAD price is the blend. */
eq(row('Catfish', 'U9b').fit, 'dkFiner', 'Hanstholm cuts the small catfish in two')
eq(row('Catfish', 'U9b').dk, ['2', '3'], 'their sizes 2 and 3')
eq(row('Witch', 'U9a').fit, 'dkFiner', 'and the large witch')

/* ---- THEIR OWN SHEET HAS A GAP, AND IT IS RECORDED AS PRINTED --------- *
 * Hanstholm whiting size 3 reads 0,25-0,30 while size 2 starts at 0,35, so
 * nothing grades 0.30-0.35. Widening it to meet would be inventing a band
 * nobody sells to; it is left as printed and simply does not match. */
eq(DK_SORTS.Whiting.find(g => g[0] === '3'), ['3', 0.25, 0.3], 'their size 3 as printed')
ok(row('Whiting', '3').fit !== 'exact', 'so PD Round does not claim to be the same band')
eq(['2', '4'].map(c => row('Whiting', c).fit), ['exact', 'exact'], 'the whiting either side of it do match')

/* ---- A SPECIES ON ONE MARKET ONLY SAYS SO ----------------------------- *
 * A missing species and a species that matched nothing look identical in a
 * table of results, and they are different facts. */
ok(!DK_SORTS.Megrim, 'Hanstholm publishes no megrim sorts')
eq(bridgeFor('Megrim'), null, 'so there is no bridge to offer')
ok(/no megrim sorts/i.test(NOT_COMPARABLE.Megrim), 'and the reason is written down')
ok(/LENGTH|cm/i.test(NOT_COMPARABLE.Squid), 'squid is graded by length at Peterhead, so size cannot be compared')

/* ---- THE HEADLINE ----------------------------------------------------- */
{
  const pairs = exactPairs()
  const all = Object.values(PD_GRADES).reduce((s, g) => s + g.length, 0)
  const comparable = Object.entries(PD_GRADES)
    .filter(([sp]) => DK_SORTS[sp]).reduce((s, [, g]) => s + g.length, 0)
  /* THREE DIFFERENT NUMBERS, and collapsing them would overstate the answer:
     every grade on the table, the ones whose species Hanstholm grades at all,
     and the ones that are genuinely the same band. */
  eq(all, 75, 'seventy-five Peterhead grades in the table')
  eq(comparable, 66, 'sixty-six of them are on a species Hanstholm also grades')
  eq(pairs.length, 36, 'and thirty-six of those are an exact band match')
  ok(pairs.every(p => p.code && p.dk), 'every pair names both sides')
  ok(pairs.some(p => p.species === 'Haddock' && p.code === '4'), 'Mini Metro is among them')
}

eq(bandText(0.17, 0.37), '0.17-0.37 kg', 'a band reads as kilos')
eq(bandText(12, null), '12+ kg', 'and an open top says so')

console.log(`grade bridge: ${n} checks passed`)
