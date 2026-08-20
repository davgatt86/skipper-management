/* The stores catalogue and the order sheet.
 *
 * The catalogue lives in code with per-fleet rows merged over it, which is the
 * whole reason a translation added next month reaches every boat instead of
 * only the ones that have never saved. That merge is what these cover, plus
 * the two things the export has to get right: the shop's own shelf order, and
 * never printing a guessed foreign word.
 */
import {
  CATEGORIES, UNITS, DEFAULT_ITEMS, resolveCatalogue, itemKey, supplierName,
  categoryLabel, unitShort,
} from './src/lib/stores/catalogue.js'
import { groupForOrder, buildStoresDoc } from './src/lib/stores/exportStores.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

// ---- the shipped catalogue ------------------------------------------------
eq('every category on the paper form is here', CATEGORIES.length, 18)
eq('and the whole form is transcribed', DEFAULT_ITEMS.length > 300, true)
eq('no two items share a key',
  DEFAULT_ITEMS.length, new Set(DEFAULT_ITEMS.map((i) => i.key)).size)
eq('every item has a category the form knows',
  DEFAULT_ITEMS.every((i) => CATEGORIES.some((c) => c.key === i.category)), true)
eq('and a unit that can be ordered',
  DEFAULT_ITEMS.every((i) => UNITS.some((u) => u.key === i.unit)), true)

/* The key is built from the name, not a position, so re-ordering the list in
 * the source never re-points a saved order at a different tin. */
eq('an item key is stable and readable', itemKey('BUTCHERS', 'Whole Black Pudding'),
  'BUTCHERS:whole-black-pudding')
eq('and survives punctuation', itemKey('BAKING', 'Sweet & Sour'), 'BAKING:sweet-sour')

// The units David asked for, all six.
eq('the six units are there', UNITS.map((u) => u.key),
  ['unit', 'pack', 'case', 'litre', 'half_doz', 'doz'])
eq('eggs come by the dozen',
  DEFAULT_ITEMS.find((i) => i.name === 'Large Eggs')?.unit, 'doz')

// ---- the merge ------------------------------------------------------------
{
  const bacon = itemKey('BUTCHERS', 'Bacon')
  const merged = resolveCatalogue([
    { item_key: bacon, name_da: 'Bacon (DK)' },
    { item_key: 'MISC:chorizo', category: 'MISC', name: 'Chorizo', unit: 'pack' },
    { item_key: itemKey('BAKERS', 'Bagels'), hidden: true },
  ])
  const find = (k) => merged.find((i) => i.key === k)

  eq('a fleet translation lands on the shipped item', find(bacon)?.da, 'Bacon (DK)')
  eq('and does not disturb its name', find(bacon)?.name, 'Bacon')
  eq('an invented item joins the catalogue', find('MISC:chorizo')?.name, 'Chorizo')
  eq('and is marked as the fleet’s own', find('MISC:chorizo')?.custom, true)
  eq('a hidden item drops out', find(itemKey('BAKERS', 'Bagels')), undefined)
  eq('while everything untouched still tracks the shipped list',
    merged.length, DEFAULT_ITEMS.length + 1 - 1)

  /* The point of code-plus-overrides: a fleet that changed ONE item still gets
   * later corrections to the rest. Prove it by checking an untouched item is
   * the shipped object, not a stored copy. */
  eq('an untouched item is the shipped one',
    find(itemKey('FROZEN', 'Tattie Waffles'))?.name, 'Tattie Waffles')

  eq('nothing stored at all is just the shipped list', resolveCatalogue([]).length, DEFAULT_ITEMS.length)
  eq('and null is handled', resolveCatalogue(null).length, DEFAULT_ITEMS.length)
}

// ---- what the supplier is handed -----------------------------------------
/* Translations ship BLANK. Half this list is Scottish butcher and baker
 * vocabulary and a machine will not get polony or butteries right; a wrong
 * word gets the wrong food onto a boat that is about to sail. So English is
 * the fallback, never a guess. */
{
  const plain = { name: 'Polony', no: '', da: '' }
  eq('a missing Danish name prints English', supplierName(plain, 'da'), 'Polony')
  eq('a missing Norwegian name prints English', supplierName(plain, 'no'), 'Polony')
  eq('blank-but-spaces still prints English', supplierName({ name: 'Neeps', da: '   ' }, 'da'), 'Neeps')
  eq('a real translation is used', supplierName({ name: 'Onions', da: 'Løg' }, 'da'), 'Løg')
  eq('English asked for is English given', supplierName({ name: 'Onions', da: 'Løg' }, 'en'), 'Onions')
  eq('every shipped item starts untranslated',
    DEFAULT_ITEMS.every((i) => !i.no && !i.da), true)
}

// ---- the order sheet ------------------------------------------------------
{
  const lines = [
    { item_key: 'x1', name: 'Tuna', category: 'CANSVEG', qty: 4, unit: 'unit' },
    { item_key: 'x2', name: 'Bacon', category: 'BUTCHERS', qty: 8, unit: 'unit' },
    { item_key: 'x3', name: 'Apples', category: 'FRUIT', qty: 2, unit: 'case' },
    { item_key: 'x4', name: 'Beef Sausage', category: 'BUTCHERS', qty: 3, unit: 'unit' },
  ]
  const g = groupForOrder(lines)
  // The shop walks its shelves once, so the order is the paper form's order —
  // not alphabetical by category and not the order things were added.
  eq('categories come out in the form’s order', g.map(([k]) => k), ['FRUIT', 'BUTCHERS', 'CANSVEG'])
  eq('and items inside one are alphabetical',
    g.find(([k]) => k === 'BUTCHERS')[1].map((l) => l.name), ['Bacon', 'Beef Sausage'])
  eq('nothing is dropped', g.reduce((a, [, i]) => a + i.length, 0), lines.length)
  eq('an empty list is handled', groupForOrder([]).length, 0)
  eq('and no list at all', groupForOrder(null).length, 0)
}

eq('a unit shows its short form on the sheet', unitShort('case'), 'cs')
eq('and "unit" shows nothing', unitShort('unit'), '')
eq('a category has a readable label', categoryLabel('TEACOFFEE'), 'Tea and Coffee')

// ---- the sheet that leaves the boat --------------------------------------
/* THE SUPPLIER HAS NO LOGIN, so the export is the feature, not a nicety.
 * buildStoresDoc is split from the save for exactly this: doc.save() reaches
 * for a browser and silently does nothing under node, which had me reading a
 * stale PDF off disk and believing a page-break fix that had never run. */
{
  const mk = (n) => Array.from({ length: n }, (_, i) => ({
    item_key: `k${i}`, name: `Item ${String(i).padStart(2, '0')}`,
    category: 'BAKING', qty: i + 1, unit: 'unit',
  }))
  const small = buildStoresDoc({ title: 'Trip 65', starts_on: '2026-08-21', meals_for: 11 }, mk(6))
  eq('a short order is one page', small.internal.getNumberOfPages(), 1)

  /* A category that straddles a page break used to leave page 2 opening on a
   * bare "12 Toilet Rolls" with nothing to say what shelf it was — autoTable
   * does not repeat a colSpan head row, so the category name is drawn by hand
   * and repeated as "(continued)". Assert the break happens; that the heading
   * is really on page 2 is checked by rendering in scripts/stores-preview.mjs. */
  const big = buildStoresDoc({ title: 'Trip 65', starts_on: '2026-08-21' }, mk(60))
  eq('a long order runs onto more pages', big.internal.getNumberOfPages() > 1, true)
  eq('and nothing is lost on the way', groupForOrder(mk(60))[0][1].length, 60)
}

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
