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
  categoryLabel, unitShort, unitLong,
} from './src/lib/stores/catalogue.js'
import { groupForOrder, buildStoresDoc } from './src/lib/stores/exportStores.js'
import { SHEET_WORDS, words, bothWords, missingTranslations, UNIT_WORDS } from './src/lib/stores/i18n.js'

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

// ---- what the SHOP reads --------------------------------------------------
/* "CS" is obvious on the boat and means nothing across a counter. The person
 * picking this order has never seen the app, and reading "12 cs" as 12 loose
 * items is a week's food short — so the sheet spells the unit out and gives it
 * its own column. Short forms stay on screen, where space is tight and the
 * crew knows them. */
eq('a case is spelt out for the shop', unitLong('case', 1), 'case')
eq('and pluralised when there is more than one', unitLong('case', 12), 'cases')
eq('packs likewise', unitLong('pack', 4), 'packs')
eq('litres likewise', unitLong('litre', 5), 'litres')
// Both invariant. Nobody has ever written "6 dozens of eggs".
eq('dozen does not pluralise', unitLong('doz', 6), 'dozen')
eq('nor does half dozen', unitLong('half_doz', 3), 'half dozen')
// A loose item needs no word at all — printing "each" on four rows in five is
// noise on a sheet somebody is picking from.
eq('a plain unit prints nothing', unitLong('unit', 9), '')
eq('an unknown unit prints nothing rather than guessing', unitLong('barrel', 2), '')
eq('zero reads as a plural', unitLong('case', 0), 'cases')

// ---- a unit the boat has CHOSEN, versus one I guessed ---------------------
/* The shipped units are my reading of the paper form, which only carries the
 * unit sometimes — "VEG COOK OIL 1LITRE" says it, "Softies" does not. So the
 * page has to be able to show what has never been confirmed rather than
 * presenting a guess as fact. */
{
  const k = itemKey('BAKERS', 'Brown Softies')
  eq('a shipped unit is not confirmed',
    resolveCatalogue([]).find((i) => i.key === k)?.unitConfirmed, undefined)
  const picked = resolveCatalogue([{ item_key: k, unit: 'pack' }])
  eq('the boat’s own choice is taken', picked.find((i) => i.key === k)?.unit, 'pack')
  eq('and marked as confirmed', picked.find((i) => i.key === k)?.unitConfirmed, true)
  /* Only the unit is stored, so a later correction to the shipped NAME still
   * reaches a boat that has fixed the unit — the whole reason the catalogue
   * lives in code with overrides merged over it. */
  eq('and the shipped name still comes through',
    picked.find((i) => i.key === k)?.name, 'Brown Softies')
  eq('as does the shipped category',
    picked.find((i) => i.key === k)?.category, 'BAKERS')
}


// ---- the supplier's language ----------------------------------------------
/* THE RULE THE WHOLE FEATURE RESTS ON: a translated word never appears without
 * its English. If a word of mine is wrong, the shop still has something it can
 * read, and being wrong costs nothing. Break that and the feature becomes a
 * way to order the wrong food confidently. */
{
  eq('every language has every sheet word',
    Object.values(SHEET_WORDS).every((w) =>
      Object.keys(SHEET_WORDS.en).every((k) => w[k] && w[k].trim())), true)
  eq('an unknown language falls back to English', words('fr'), SHEET_WORDS.en)
  eq('and so does no language at all', words(undefined), SHEET_WORDS.en)

  eq('a translated head carries the English', bothWords('da', 'qty'), 'ANTAL / QTY')
  eq('English alone is not doubled up', bothWords('en', 'qty'), 'QTY')
  // Where a word happens to be identical, it is not printed twice.
  eq('an identical word is not repeated', bothWords('no', 'item'),
    SHEET_WORDS.no.item === 'ITEM' ? 'ITEM' : 'VARE / ITEM')

  // The unit words are the only other thing translated in code, and they are
  // the same generic order-form vocabulary. Everything else is the boat's.
  for (const l of ['no', 'da']) {
    eq(`${l} unit words are all pairs`,
      Object.values(UNIT_WORDS[l]).every((v) => Array.isArray(v) && v.length === 2 && v[0] && v[1]), true)
  }
  eq('a case in Danish', unitLong('case', 12, 'da'), 'kasser')
  eq('one case in Danish', unitLong('case', 1, 'da'), 'kasse')
  eq('a pack in Norwegian', unitLong('pack', 3, 'no'), 'pakker')
  eq('dozen is invariant in Danish too', unitLong('doz', 6, 'da'), 'dusin')
  // A unit with no foreign word falls back to English rather than to nothing —
  // an English word the shop queries beats a blank cell.
  eq('an untranslated unit falls back to English', unitLong('litre', 5, 'fr'), 'litres')
  eq('a plain unit is still silent in Danish', unitLong('unit', 4, 'da'), '')
}

// ---- being honest about what did NOT translate ----------------------------
/* A half-translated order that does not say it is half translated is the
 * failure worth guarding against: the cook believes the list is ready and the
 * first anyone knows is a short delivery. */
{
  const byKey = new Map([
    ['a', { key: 'a', name: 'Onions', no: 'Løk', da: 'Løg' }],
    ['b', { key: 'b', name: 'Butteries', no: '', da: '' }],
    ['c', { key: 'c', name: 'Polony', no: '   ', da: 'Polony' }],
  ])
  const lines = [
    { item_key: 'a', name: 'Onions' },
    { item_key: 'b', name: 'Butteries' },
    { item_key: 'c', name: 'Polony' },
  ]
  eq('English asks for no translations at all', missingTranslations(lines, byKey, 'en'), [])
  eq('Danish names the one gap',
    missingTranslations(lines, byKey, 'da').map((l) => l.name), ['Butteries'])
  // Whitespace is not a translation.
  eq('Norwegian counts blank-but-spaces as missing',
    missingTranslations(lines, byKey, 'no').map((l) => l.name), ['Butteries', 'Polony'])
  // An item that is not in the catalogue at all still has to be reported,
  // not quietly skipped.
  eq('an unknown item counts as missing',
    missingTranslations([{ item_key: 'zzz', name: 'Mystery' }], byKey, 'da').map((l) => l.name),
    ['Mystery'])
  eq('no lines is handled', missingTranslations(null, byKey, 'da'), [])
}

// ---- the catalogue is still NOT machine-translated -------------------------
/* The guard against the one change that would break the whole argument. Half
 * this list is Scottish butcher and baker vocabulary — polony, Lorne, neeps,
 * softies, butteries, tattie waffles — and no machine gets those right. If a
 * future me is ever tempted to seed translations, this fails first. */
eq('every shipped item still ships untranslated',
  DEFAULT_ITEMS.every((i) => !i.no && !i.da), true)
{
  const it = { name: 'Tattie Waffles', no: '', da: '' }
  eq('an untranslated item prints English on a Danish sheet', supplierName(it, 'da'), 'Tattie Waffles')
  eq('and on a Norwegian one', supplierName(it, 'no'), 'Tattie Waffles')
}

// ---- the sheet renders in all three ---------------------------------------
{
  const mk = { item_key: 'k', name: 'Large Eggs', category: 'CHILL', qty: 6, unit: 'doz' }
  const byKey = new Map([['k', { key: 'k', name: 'Large Eggs', no: 'Store egg', da: 'Store æg' }]])
  for (const l of ['en', 'no', 'da']) {
    const doc = buildStoresDoc({ title: 'Trip 65', starts_on: '2026-08-21', meals_for: 11 },
      [mk], byKey, l)
    eq(`the sheet builds in ${l}`, doc.internal.getNumberOfPages(), 1)
  }
}


console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
